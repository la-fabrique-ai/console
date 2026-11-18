// Real mode is strictly unchanged by the trial launcher: no sandbox, no check, no wrapper, no variable added; the CLI
// runs its action in its own process, as before M17, and asks the real keychain (here a fake one, loaded first).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createBackend } from '../src/backend.mjs';
import { hcRunArgs } from '../src/agents.mjs';
import { traceArgv } from '../src/traces.mjs';

import { withFakeHerdr } from './helpers/fake-herdr.mjs';
const here=path=>fileURLToPath(new URL(path,import.meta.url));
const CLI=here('../src/cli.mjs'),PRELOAD=pathToFileURL(here('./helpers/trial-guard-preload.mjs')).href;
// A real state folder of the test: Tracker read by GraphQL, whose token comes from the keychain (never the network).
const realRoot=t=>{const root=mkdtempSync(join(tmpdir(),'fabrique-console-real-'));t.after(()=>rmSync(root,{recursive:true,force:true}));writeFileSync(join(root,'config.json'),JSON.stringify({version:1,tracker:{transport:'graphql'},projects:[]}));return root;};

test('real mode: the same argv, no environment added, the real tracker asked',async t=>{
  const root=realRoot(t);
  const calls=[],exec=async(file,args,options={})=>{calls.push({file,args,options});if(args[0]==='run')return {stdout:JSON.stringify({id:'t1',status:'idle'})};if(String(file).endsWith('hc'))return {stdout:'{"terminals":[]}'};throw Object.assign(new Error('refused by the test'),{code:1});};
  const backend=createBackend(withFakeHerdr({root,env:{},exec}));
  await backend.dispatch('agent-start',{tool:'codex'});
  const launch=calls.find(c=>c.args[0]==='run');
  assert.equal(launch.file,'/fixture/hc');
  // The argv the agents table builds, traced (M12): the key of its trace for its commands, nothing else.
  const built=hcRunArgs({tool:'codex',cwd:join(homedir(),'Developer'),name:'fabrique-console-agent-codex',labels:{'herdr.space':'fabrique-console-agent','herdr.tab':'fabrique-console-agent-codex','fabrique-console.app':'fabrique-console','fabrique-console.role':'agent','fabrique-console.tool':'codex'}});
  const key=readdirSync(join(root,'state','traces'))[0].slice(0,-5),dash=built.indexOf('--');
  assert.deepEqual(launch.args,[...built.slice(0,dash+1),...traceArgv(built.slice(dash+1),key).argv]);
  assert.equal(launch.options.env,undefined);
  await assert.rejects(backend.dispatch('ticket-detail',{id:'DEMO-1'}));
  assert.ok(calls.some(c=>c.file==='/usr/bin/security'),'the keychain is asked, as before');
  assert.equal(existsSync(join(root,'trial-journal.jsonl')),false,'no journal of a trial');
});

test('real mode: the CLI runs its action itself, never in a sandbox, and asks the keychain as before',t=>{
  const root=realRoot(t);
  const log=join(root,'guard.jsonl');
  const run=spawnSync(process.execPath,['--import',PRELOAD,CLI,'ticket-detail',JSON.stringify({id:'DEMO-1'})],{encoding:'utf8',env:{...process.env,FABRIQUE_CONSOLE_HOME:root,FABRIQUE_CONSOLE_TEST_GUARD_LOG:log,FABRIQUE_CONSOLE_MC_TRIAL:''}});
  const envelope=JSON.parse(run.stdout.trim().split('\n').pop());
  assert.equal(envelope.ok,false);
  const seen=readFileSync(log,'utf8').split('\n').filter(Boolean).map(l=>JSON.parse(l));
  assert.ok(seen.some(e=>e.kind==='keychain'),'real mode asks the keychain, as before');
  assert.ok(!seen.some(e=>/sandbox-exec/.test(e.file)),'no sandbox in real mode');
});

test('real mode: the exec of the backend is the one it was before M17',()=>{
  const common=readFileSync(here('../src/common.mjs'),'utf8');
  assert.match(common,/^export const exec = promisify\(execFile\);$/m);
});
