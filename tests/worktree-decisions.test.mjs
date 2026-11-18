import test from 'node:test';
import assert from 'node:assert/strict';
import { access,writeFile,readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { createBackend } from '../src/backend.mjs';
import { createWorkspaceState,activeAttempt } from '../src/workspace-state.mjs';
import { worktreeFixture } from './helpers/worktree-fixture.mjs';
import { groupAlive } from '../src/git-process-group.mjs';
import { withLock } from '../src/common.mjs';
import { emptyWorkspaceFixture } from './helpers/empty-workspace-fixture.mjs';

import { withFakeHerdr } from './helpers/fake-herdr.mjs';
async function reservation(f,goState) {
  const plan=await f.plan(),id=randomUUID();
  const attempt={...plan,plan,preparationId:id,issueId:plan.issue.id,role:'dev',tool:'codex',ownerPid:process.pid,ownerActive:false,worker:null,status:'reserved',phase:'create',...(goState?{goState}:{}),updatedAt:new Date().toISOString()};
  await createWorkspaceState(f.home).update(state=>state.attempts.push(attempt));return id;
}
async function failedBeforeAttach(t) {
  const f=await worktreeFixture(t),backend=createBackend(withFakeHerdr({root:f.home,tracker:f.tracker,exec:f.exec,workspaceOptions:{workerPath:fileURLToPath(new URL('./helpers/worktree-detached-worker.mjs',import.meta.url))}},'/fixture/forbidden-hc'));
  const plan=await f.plan(),result=await backend.dispatch('worktree-prepare',{planId:plan.planId});assert.equal(result.status,'needs-finalization');
  return {...f,id:result.preparationId,worktree:result.preparation.worktree,proof:result};
}

test('only an initial reservation durably known to have never sent go is automatically released',async t=>{
  const f=await worktreeFixture(t),id=await reservation(f,'not-sent');
  const result=await f.backend.dispatch('worktree-reconcile',{preparationId:id});assert.equal(result.status,'released');
  assert.equal(activeAttempt((await f.read('workspace-state.json')).attempts[0]),false);
  assert.equal((await f.prepare(await f.plan({issueId:'two'}))).status,'prepared');
});

for(const goState of ['requested',null])test(`an absent group without proof of never sending go still requires explicit release (${goState})`,async t=>{
  const f=await worktreeFixture(t),id=await reservation(f,goState);
  const result=await f.backend.dispatch('worktree-reconcile',{preparationId:id});assert.equal(result.status,'failed-certain');
  assert.equal(activeAttempt((await f.read('workspace-state.json')).attempts[0]),true);
});

test('owned partial Git checkout removal is refused even with explicit confirmation',async t=>{
  const f=await failedBeforeAttach(t);assert.equal(f.proof.cleanupProposal,null);
  assert.equal((await f.backend.dispatch('worktree-cleanup',{preparationId:f.id})).code,'CONFIRMATION_REQUIRED');
  assert.equal((await f.backend.dispatch('worktree-cleanup',{preparationId:f.id,confirmed:true,expectedHash:'old-confirmation'})).code,'CLEANUP_MANUAL_REQUIRED');
  await access(f.worktree);
  assert.equal((await f.command('git',['-C',f.repo,'worktree','list','--porcelain'])).stdout.match(/^worktree /gm).length,2);
  assert.equal(activeAttempt((await f.read('workspace-state.json')).attempts[0]),true);
});

test('a user change in a partial checkout always requires manual cleanup and remains locked',async t=>{
  const f=await failedBeforeAttach(t);assert.equal(f.proof.cleanupProposal,null);
  await writeFile(join(f.worktree,'user-note'),'preserve');
  assert.equal((await f.backend.dispatch('worktree-cleanup',{preparationId:f.id,confirmed:true,expectedHash:'old-confirmation'})).code,'CLEANUP_MANUAL_REQUIRED');
  assert.equal(await readFile(join(f.worktree,'user-note'),'utf8'),'preserve');
  assert.match((await f.command('git',['-C',f.repo,'worktree','list','--porcelain'])).stdout,/locked fabrique-console:/);
});

test('a foreign ownership marker prevents a cleanup proposal or execution',async t=>{
  const f=await failedBeforeAttach(t),hash=f.proof.cleanupProposal?.hash;
  await f.command('git',['-C',f.repo,'worktree','unlock',f.worktree]);await f.command('git',['-C',f.repo,'worktree','lock','--reason','user-owned',f.worktree]);
  const result=await f.backend.dispatch('worktree-reconcile',{preparationId:f.id});assert.equal(result.cleanupProposal,null);
  assert.equal((await f.backend.dispatch('worktree-cleanup',{preparationId:f.id,confirmed:true,expectedHash:hash})).code,'CLEANUP_MANUAL_REQUIRED');await access(f.worktree);
});

test('a behind branch offers origin and prepares its exact SHA without changing local main',async t=>{
  const f=await worktreeFixture(t);const remote=await f.commit(f.peer,'remote change');await f.publish();
  const local=await f.plan();assert.deepEqual(local.base.options.map(option=>option.source),['local','origin']);
  assert.deepEqual(local.base.fetch.writes,['objects','temporary-locks']);
  const plan=await f.plan({baseSource:'origin'});assert.equal(plan.base.source,'origin');assert.equal(plan.base.chosenSha,remote);
  assert.equal((await f.prepare(plan)).code,'BASE_CONFIRMATION_REQUIRED');
  const result=await f.prepare(plan,{confirmation:{manifestHash:plan.manifestHash}});assert.equal(result.status,'prepared');
  assert.equal((await f.command('git',['-C',result.preparation.worktree,'rev-parse','HEAD'])).stdout.trim(),remote);
  assert.equal((await f.command('git',['-C',f.repo,'rev-parse','main'])).stdout.trim(),f.base);
});

test('the remote base choice is refused without a fresh verified behind relation',async t=>{
  const f=await worktreeFixture(t);assert.equal((await f.plan({baseSource:'origin'})).code,'REMOTE_BASE_UNAVAILABLE');
  await f.command('git',['-C',f.repo,'remote','remove','origin']);assert.equal((await f.plan({baseSource:'origin'})).code,'REMOTE_BASE_UNAVAILABLE');
});

test('ignored user files require manual cleanup and cannot be deleted by confirmation',async t=>{
  const f=await failedBeforeAttach(t);assert.equal(f.proof.cleanupProposal,null);
  await writeFile(join(f.repo,'.git','info','exclude'),'*.local\n');await writeFile(join(f.worktree,'private.local'),'user fixture');
  assert.equal((await f.backend.dispatch('worktree-cleanup',{preparationId:f.id,confirmed:true,expectedHash:'old-confirmation'})).code,'CLEANUP_MANUAL_REQUIRED');
  assert.equal((await f.backend.dispatch('worktree-reconcile',{preparationId:f.id})).cleanupProposal,null);
  assert.equal(await readFile(join(f.worktree,'private.local'),'utf8'),'user fixture');
  assert.match((await f.command('git',['-C',f.repo,'worktree','list','--porcelain'])).stdout,/locked fabrique-console:/);
});

for(const phase of ['cleanup-starting','cleaned'])test(`SIGKILL at ${phase} retains the empty-directory reservation and never creates a checkout`,async t=>{
  const f=await emptyWorkspaceFixture(t);await writeFile(join(f.home,'cleanup-pause-phase'),phase);
  const backend=createBackend(withFakeHerdr({root:f.home,tracker:f.tracker,exec:f.exec,workspaceOptions:{workerPath:fileURLToPath(new URL('./helpers/worktree-paused-cleanup-worker.mjs',import.meta.url)),alertAfterMs:100}},'/fixture/forbidden-hc'));
  const result=await backend.dispatch('worktree-cleanup',{preparationId:f.id,confirmed:true,expectedHash:f.proof.cleanupProposal.hash});assert.equal(result.status,'creating');
  const group=(await f.read('workspace-state.json')).attempts[0].worker.pgid;
  const wait=async predicate=>{const end=Date.now()+5000;while(!await predicate()&&Date.now()<end)await new Promise(resolve=>setTimeout(resolve,10));assert.ok(await predicate());};
  try {
    await wait(async()=>{try{await access(join(f.home,'cleanup-checkpoint'));return true;}catch{return false;}});
    if(phase==='cleanup-starting')await writeFile(join(f.worktree,'user-note'),'preserve');
    await withLock(f.home,async()=>{});process.kill(-group,'SIGKILL');await wait(()=>!groupAlive(group));
    const proof=await f.backend.dispatch('worktree-reconcile',{preparationId:f.id});assert.equal(proof.status,phase==='cleaned'?'failed-certain':'uncertain');
    assert.equal(activeAttempt((await f.read('workspace-state.json')).attempts[0]),true);
    const repeat=await f.backend.dispatch('worktree-prepare',{planId:f.proof.preparation.planId});assert.equal(repeat.status,proof.status);
    if(phase==='cleaned')await assert.rejects(access(f.worktree),{code:'ENOENT'});else await access(f.worktree);
  }finally{if(groupAlive(group)){process.kill(-group,'SIGKILL');await wait(()=>!groupAlive(group));}}
});
