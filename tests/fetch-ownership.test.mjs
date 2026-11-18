import test from 'node:test';
import assert from 'node:assert/strict';
import { runGitGroup } from '../src/git-process-group.mjs';
import { worktreeFixture } from './helpers/worktree-fixture.mjs';
import { writeFile,readFile,access } from 'node:fs/promises';
import { join } from 'node:path';
import { createBackend } from '../src/backend.mjs';
import { groupAlive } from '../src/git-process-group.mjs';
import { processBirth } from '../src/process-identity.mjs';

test('fetch never signals a group number after its owned leader has been reaped',async t=>{
  const f=await worktreeFixture(t),original=process.kill,unsafe=[];
  // Model a number reused immediately after reaping. Real Git is executed; only
  // the OS answer for an absent/recycled group is substituted, not a Git result.
  process.kill=(pid,signal)=>{
    if(pid<0) {
      let reaped=false;try{original(-pid,0);}catch(error){if(error.code==='ESRCH')reaped=true;else throw error;}
      if(reaped){if(signal!==0)unsafe.push(signal);return true;}
    }
    return original(pid,signal);
  };
  try{const result=await runGitGroup(f.repo,['--version'],{timeoutMs:5000});assert.deepEqual(unsafe,[],'A group number is not proof of ownership after the leader exits.');assert.equal(result.terminated,false,'A still-present group cannot be declared terminated.');}
  finally{process.kill=original;}
});

test('an externally suspended fetch owner is unconfirmed and cannot authorize workspace planning',async t=>{
  const f=await worktreeFixture(t),script=join(f.root,'stop-owner.mjs'),metadata=join(f.root,'owner-identity.json');let identity;
  await writeFile(script,`import fs from 'node:fs';import {execFileSync} from 'node:child_process';const owner=Number(execFileSync('/bin/ps',['-p',String(process.pid),'-o','pgid='],{encoding:'utf8'}).trim());const birth=execFileSync('/bin/ps',['-p',String(owner),'-o','lstart='],{encoding:'utf8',env:{...process.env,LC_ALL:'C',TZ:'UTC'}}).trim();fs.writeFileSync(${JSON.stringify(metadata)},JSON.stringify({owner,birth}));process.kill(owner,'SIGSTOP');setInterval(()=>{},1000);\n`);
  await f.command('git',['-C',f.repo,'config','remote.origin.uploadpack',process.execPath+' '+script]);
  const backend=createBackend({root:f.home,exec:f.exec,tracker:f.tracker,workspaceOptions:{fetchTimeoutMs:1000}});
  const start=performance.now();
  try {
    const result=await backend.dispatch('worktree-plan',{issueId:'one',tool:'codex',role:'dev'});
    identity=JSON.parse(await readFile(metadata,'utf8'));
    assert.equal(result.code,'FETCH_TERMINATION_UNCONFIRMED');assert.ok(performance.now()-start<5000);
    await assert.rejects(access(f.worktreesRoot),{code:'ENOENT'});
  }finally {
    identity??=JSON.parse(await readFile(metadata,'utf8'));
    assert.equal(await processBirth(identity.owner),identity.birth,'Only resume this test’s still-owned suspended supervisor.');
    process.kill(identity.owner,'SIGCONT');
    const end=Date.now()+3000;while(groupAlive(identity.owner)&&Date.now()<end)await new Promise(resolve=>setTimeout(resolve,10));assert.equal(groupAlive(identity.owner),false);
  }
});

test('fetch termination is performed by the live supervisor itself, not numeric group signals in its parent',async t=>{
  const f=await worktreeFixture(t),original=process.kill,signals=[];
  process.kill=(pid,signal)=>{if(pid<0&&signal!==0)signals.push(signal);return original(pid,signal);};
  try{const result=await runGitGroup(f.repo,['--version'],{timeoutMs:5000});assert.equal(result.ok,true);assert.deepEqual(signals,[]);}
  finally{process.kill=original;}
});
