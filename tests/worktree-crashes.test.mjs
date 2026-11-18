import test from 'node:test';
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { writeFile,readFile,access } from 'node:fs/promises';
import { join } from 'node:path';
import { createBackend } from '../src/backend.mjs';
import { withLock } from '../src/common.mjs';
import { groupAlive } from '../src/git-process-group.mjs';
import { worktreeFixture } from './helpers/worktree-fixture.mjs';

import { withFakeHerdr } from './helpers/fake-herdr.mjs';
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(predicate,ms=5000){const end=Date.now()+ms;while(!await predicate()&&Date.now()<end)await pause(10);assert.ok(await predicate(),'Crash fixture checkpoint missing');}
async function present(path){try{await access(path);return true;}catch{return false;}}
async function terminate(pgid){if(!groupAlive(pgid))return;try{process.kill(-pgid,'SIGKILL');}catch(error){if(error.code!=='ESRCH')throw error;}await until(()=>!groupAlive(pgid));}
async function slowCheckout(f) {
  const script=join(f.root,'slow-smudge.mjs'),started=join(f.root,'smudge-started'),gate=join(f.root,'smudge-gate');
  await writeFile(script,`import fs from 'node:fs';let data='';process.stdin.on('data',chunk=>data+=chunk);process.stdin.on('end',()=>{fs.writeFileSync(${JSON.stringify(started)},String(process.pid));const timer=setInterval(()=>{if(fs.existsSync(${JSON.stringify(gate)})){clearInterval(timer);process.stdout.write(data);}},10);});\n`);
  await writeFile(join(f.repo,'.gitattributes'),'*.slow filter=fixtureSlow\n');await writeFile(join(f.repo,'file.slow'),'fixture');
  await f.command('git',['-C',f.repo,'config','filter.fixtureSlow.clean','cat']);await f.command('git',['-C',f.repo,'config','filter.fixtureSlow.smudge',process.execPath+' '+script]);await f.command('git',['-C',f.repo,'config','filter.fixtureSlow.required','true']);
  await f.command('git',['-C',f.repo,'add','.gitattributes','file.slow']);await f.commit(f.repo,'slow checkout fixture');
  return {started,gate};
}

test('parent death before go leaves no Git artifact and the worker exits at EOF',async t=>{
  const f=await worktreeFixture(t),plan=await f.plan(),job=join(f.root,'before-go.json');await writeFile(job,JSON.stringify({root:f.home,plan}));
  const producer=fork(new URL('./helpers/worktree-before-go-process.mjs',import.meta.url),[job],{silent:true});let group;
  try {
    const [{preparationId,workerPid}]=await once(producer,'message');group=workerPid;
    const exited=once(producer,'exit');producer.kill('SIGKILL');await exited;await until(()=>!groupAlive(group));
    await assert.rejects(access(plan.worktree),{code:'ENOENT'});
    const proof=await f.backend.dispatch('worktree-reconcile',{preparationId});assert.equal(proof.status,'released');assert.equal(proof.automaticRelease,true);
    assert.equal((await f.read('workspace-state.json')).attempts[0].status,'failed-released');
  }finally{if(producer.exitCode===null)producer.kill('SIGKILL');if(group)await terminate(group);}
});

test('worker death during Git keeps the lane, then finishes only the existing detached checkout',async t=>{
  const f=await worktreeFixture(t),slow=await slowCheckout(f),backend=createBackend(withFakeHerdr({root:f.home,tracker:f.tracker,exec:f.exec,workspaceOptions:{alertAfterMs:100}},'/fixture/forbidden-hc'));
  const plan=await f.plan(),result=await backend.dispatch('worktree-prepare',{planId:plan.planId});assert.equal(result.status,'creating');
  const attempt=(await f.read('workspace-state.json')).attempts[0],group=attempt.worker.pgid;
  try {
    await until(()=>present(slow.started));
    await withLock(f.home,async()=>{}); // The registry lock is not held by slow Git.
    process.kill(attempt.worker.pid,'SIGKILL');await pause(50);assert.equal(groupAlive(group),true);
    assert.equal((await f.backend.dispatch('worktree-reconcile',{preparationId:attempt.preparationId})).status,'creating');
    const other=await f.plan({issueId:'two'});assert.equal((await f.prepare(other)).code,'LANE_BUSY');
    await writeFile(slow.gate,'continue');await until(()=>!groupAlive(group));
    assert.equal((await f.backend.dispatch('worktree-reconcile',{preparationId:attempt.preparationId})).status,'needs-finalization');
    const completed=await f.prepare(plan);assert.equal(completed.status,'prepared');assert.equal(completed.preparationId,attempt.preparationId);
    assert.equal((await f.command('git',['-C',f.repo,'worktree','list','--porcelain'])).stdout.match(/^worktree /gm).length,2);
  }finally{await terminate(group);}
});

test('killing the whole creating group leaves a partial workspace reserved and never recreates it',async t=>{
  const f=await worktreeFixture(t),slow=await slowCheckout(f),backend=createBackend(withFakeHerdr({root:f.home,tracker:f.tracker,exec:f.exec,workspaceOptions:{alertAfterMs:100}},'/fixture/forbidden-hc'));
  const plan=await f.plan(),result=await backend.dispatch('worktree-prepare',{planId:plan.planId});
  const attempt=(await f.read('workspace-state.json')).attempts[0],group=attempt.worker.pgid;
  try {
    await until(()=>present(slow.started));await terminate(group);
    const proof=await f.backend.dispatch('worktree-reconcile',{preparationId:attempt.preparationId});assert.equal(proof.status,'uncertain');assert.ok(proof.manualCleanup.length);
    const repeated=await f.prepare(plan);assert.equal(repeated.status,'uncertain');assert.equal(repeated.preparationId,result.preparationId);
    assert.equal((await f.backend.dispatch('worktree-release',{preparationId:attempt.preparationId,confirmed:true,expectedHash:proof.preparationHash})).code,'PREPARATION_UNCERTAIN');
    assert.equal((await f.command('git',['-C',f.repo,'worktree','list','--porcelain'])).stdout.match(/^worktree /gm).length,2);
  }finally{await terminate(group);}
});

test('a lost parent response during Git is reconciled after the detached worker completes',async t=>{
  const f=await worktreeFixture(t),slow=await slowCheckout(f),plan=await f.plan(),job=join(f.root,'lost-parent.json');
  await writeFile(job,JSON.stringify({root:f.home,issues:[...f.issues.values()],action:'worktree-prepare',input:{planId:plan.planId},workspaceOptions:{alertAfterMs:100},holdAtResult:true}));
  const producer=fork(new URL('./helpers/worktree-client-process.mjs',import.meta.url),[job],{silent:true});let group;
  try {
    await once(producer,'message');const done=once(producer,'message');producer.send('go');const [message]=await done;
    assert.equal(message.result.status,'creating');const attempt=(await f.read('workspace-state.json')).attempts[0];group=attempt.worker.pgid;
    await until(()=>present(slow.started));const exited=once(producer,'exit');producer.kill('SIGKILL');await exited;
    await writeFile(slow.gate,'continue');await until(()=>!groupAlive(group));
    const proof=await f.backend.dispatch('worktree-reconcile',{preparationId:attempt.preparationId});assert.equal(proof.status,'prepared');
    assert.equal((await f.prepare(plan)).preparationId,attempt.preparationId);
  }finally{if(producer.exitCode===null)producer.kill('SIGKILL');if(group)await terminate(group);}
});

test('fetch timeout kills its slow helper group, reports unknown and leaves local main unchanged',async t=>{
  const f=await worktreeFixture(t),script=join(f.root,'slow-upload-pack.mjs'),pidFile=join(f.root,'upload-pid');
  await writeFile(script,`import fs from 'node:fs';fs.writeFileSync(${JSON.stringify(pidFile)},String(process.pid));process.on('SIGTERM',()=>{});setInterval(()=>{},1000);\n`);
  await f.command('git',['-C',f.repo,'config','remote.origin.uploadpack',process.execPath+' '+script]);
  const backend=createBackend(withFakeHerdr({root:f.home,tracker:f.tracker,exec:f.exec,workspaceOptions:{fetchTimeoutMs:1000}},'/fixture/forbidden-hc'));
  const start=performance.now(),request=backend.dispatch('worktree-plan',{issueId:'one',tool:'codex',role:'dev'});
  await until(()=>present(pidFile));await withLock(f.home,async()=>{});
  const plan=await request;
  assert.equal(plan.base.relation,'unknown');assert.equal(plan.base.fetch.reason,'timeout');assert.ok(performance.now()-start<5000);
  const pid=Number(await readFile(pidFile,'utf8'));assert.throws(()=>process.kill(pid,0),{code:'ESRCH'});
  assert.equal((await f.command('git',['-C',f.repo,'rev-parse','main'])).stdout.trim(),f.base);
});
