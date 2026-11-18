import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, chmod, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// The native check of the traces (scripts/trace-native-check.mjs) is meant for the real agents, at the first trial with
// them, and is never run by the suite against them. Here it runs against fake agents that behave as the installed
// programs say they do, to show that it proves what it says and fails when it is not so: a real agent is never started.
const CHECK=fileURLToPath(new URL('../scripts/trace-native-check.mjs',import.meta.url));

// A fake Claude: no transcript when it inherits the child marker, unless the env of its --settings forces it; else
// its session under <CLAUDE_CONFIG_DIR>/projects/<folder>/<id>.jsonl. `obeys:false`: the setting changes nothing.
// `witness`: how the run without settings (the witness) ends: 'ok', 'fails' (exit 3), 'killed' (by a signal); never
// a session written, as a run that stops before it writes any.
const fakeClaude=(obeys,witness='ok')=>`#!/usr/bin/env node
const a=process.argv.slice(2),id=a[a.indexOf('--session-id')+1];let forced=false;
if(!a.includes('--settings')&&'${witness}'==='fails')process.exit(3);
if(!a.includes('--settings')&&'${witness}'==='killed')process.kill(process.pid,'SIGKILL');
const s=a.indexOf('--settings');if(s>=0)forced=JSON.parse(a[s+1]).env?.CLAUDE_CODE_FORCE_SESSION_PERSISTENCE==='1';
if(process.env.CLAUDE_CODE_CHILD_SESSION&&!(${obeys}&&forced))process.exit(0);
const fs=require('node:fs'),path=require('node:path');
const dir=path.join(process.env.CLAUDE_CONFIG_DIR,'projects',process.cwd().replace(/[^a-zA-Z0-9]/g,'-'));
fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,id+'.jsonl'),'{}\\n');
`;
// A fake Codex: its rollout under the day it starts, then the command its prompt names, run with the variables of its
// -c shell_environment_policy.set and, when \`gives\`, CODEX_THREAD_ID.
const fakeCodex=gives=>`#!/usr/bin/env node
const a=process.argv.slice(2),env={...process.env},id='019a7c1e-0000-7000-8000-'+String(Date.now()).slice(-12).padStart(12,'0');
for(let i=0;i<a.length;i++)if(a[i]==='-c'){const m=/^shell_environment_policy\\.set\\.(\\w+)="(.*)"$/.exec(a[i+1]);if(m)env[m[1]]=m[2];}
if(${gives})env.CODEX_THREAD_ID=id;
const fs=require('node:fs'),path=require('node:path'),d=new Date(),p=n=>String(n).padStart(2,'0');
const day=path.join(process.env.CODEX_HOME,'sessions',String(d.getFullYear()),p(d.getMonth()+1),p(d.getDate()));
fs.mkdirSync(day,{recursive:true});fs.writeFileSync(path.join(day,'rollout-'+d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate())+'T'+p(d.getHours())+'-'+p(d.getMinutes())+'-'+p(d.getSeconds())+'-'+id+'.jsonl'),'{}\\n');
const command=/: (node '.*' --note --root '.*')$/.exec(a.at(-1))[1];
const r=require('node:child_process').spawnSync('/bin/sh',['-c',command],{env,stdio:'ignore'});process.exit(r.status??1);
`;

async function check({claudeObeys=true,codexGives=true,witness='ok'}={}) {
  const base=await mkdtemp(join(tmpdir(),'fabrique-console-trace-native-')),bin=join(base,'bin');
  try{
    await mkdir(bin);
    await writeFile(join(bin,'claude'),fakeClaude(claudeObeys,witness));await writeFile(join(bin,'codex'),fakeCodex(codexGives));
    await chmod(join(bin,'claude'),0o755);await chmod(join(bin,'codex'),0o755);
    const env={PATH:process.env.PATH,HOME:base,TMPDIR:join(base,'tmp'),CLAUDE_CONFIG_DIR:join(base,'claude'),CODEX_HOME:join(base,'codex')};
    await mkdir(env.TMPDIR);
    const out=await new Promise((done,failed)=>{
      let stdout='';const child=spawn(process.execPath,[CHECK,'--claude',join(bin,'claude'),'--codex',join(bin,'codex'),'--timeout','30'],{env,stdio:['ignore','pipe','ignore']});
      child.stdout.on('data',c=>stdout+=c);child.once('error',failed);child.once('close',code=>done({code,stdout}));
    });
    // Its scratch folder (the traces of the check) is gone; the sessions stay where the agents wrote them.
    assert.deepEqual(await readdir(env.TMPDIR),[]);
    return {code:out.code,result:JSON.parse(out.stdout)};
  }finally{await rm(base,{recursive:true,force:true});}
}

test('the native check of the traces proves both agents when they behave as their programs say',async()=>{
  const {code,result}=await check();
  assert.equal(code,0,JSON.stringify(result));
  assert.equal(result.proven,true);
  assert.deepEqual(result.claude.witness.sessionWritten,false,'the marker alone writes nothing');
  assert.deepEqual([result.claude.agent.settings,result.claude.agent.sessionFound],[true,true]);
  assert.deepEqual([result.codex.traceKey,result.codex.linked,result.codex.sessionFound],[true,true,true]);
});

test('the native check fails, and says why, when the setting changes nothing or Codex gives no id to its commands',async()=>{
  const claude=await check({claudeObeys:false});
  assert.equal(claude.code,1);assert.equal(claude.result.claude.proven,false);assert.equal(claude.result.codex.proven,true);
  assert.match(claude.result.claude.why,/no session file/);
  const codex=await check({codexGives:false});
  assert.equal(codex.code,1);assert.equal(codex.result.codex.proven,false);assert.match(codex.result.codex.why,/never linked/);
});

test('the native check is inconclusive when the witness did not finish with success: failed or stopped, its silence proves nothing (M12 review 2)',async()=>{
  for(const [witness,exit] of [['fails',3],['killed','SIGKILL']]){
    const {code,result}=await check({witness});
    assert.equal(code,1,witness+': '+JSON.stringify(result));
    assert.equal(result.proven,false);assert.equal(result.claude.proven,false);assert.equal(result.codex.proven,true);
    assert.equal(result.claude.witness.exit,exit);assert.equal(result.claude.witness.sessionWritten,false);
    assert.equal(result.claude.agent.sessionFound,true,'the agent itself wrote its session');
    assert.match(result.claude.why,/witness did not finish with success/);
  }
});
