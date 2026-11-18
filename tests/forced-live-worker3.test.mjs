import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { worktreeFixture } from './helpers/worktree-fixture.mjs';
import { createWorkspaceState } from '../src/workspace-state.mjs';
import { processBirth,systemBootId } from '../src/process-identity.mjs';
import { createFetchRegistry } from '../src/fetch-registry.mjs';

async function liveWorker(t) {
  const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{detached:true,stdio:'ignore',shell:false});await once(child,'spawn');
  t.after(async()=>{if(child.exitCode===null&&child.signalCode===null){const done=once(child,'exit');child.kill('SIGKILL');await done;}});
  const birth=await processBirth(child.pid);assert.ok(birth);
  return {pid:child.pid,pgid:child.pid,birth,nonce:randomUUID()};
}
for(const identified of [true,false])test(`forced reservation release ${identified?'refuses an identified live worker':'retains the escape for an inconclusive live group'}`,async t=>{
  const f=await worktreeFixture(t),plan=await f.plan(),worker=await liveWorker(t),id=randomUUID(),store=createWorkspaceState(f.home);
  await store.update(state=>state.attempts.push({...plan,plan,preparationId:id,issueId:plan.issue.id,role:'dev',tool:'codex',ownerPid:process.pid,ownerActive:false,worker:{...worker,birth:identified?worker.birth:null},status:'reserved',phase:'create',goState:'requested',updatedAt:new Date().toISOString()}));
  const proof=await f.backend.dispatch('worktree-reconcile',{preparationId:id});assert.equal(proof.status,'creating');
  const before=(await store.read()).value.attempts[0],result=await f.backend.dispatch('worktree-release',{preparationId:id,force:true,confirmed:true,expectedHash:proof.preparationHash});
  if(identified) {
    assert.equal(result.code,'WORKER_ACTIVE');assert.deepEqual((await store.read()).value.attempts[0],before);
  }else {assert.equal(result.status,'released');assert.equal(result.forced,true);assert.ok((await store.read()).value.attempts[0].forcedRelease);}
  assert.doesNotThrow(()=>process.kill(worker.pid,0));
});

for(const identified of [true,false])test(`forced fetch abandonment ${identified?'refuses its identified live supervisor':'remains possible with inconclusive identity'}`,async t=>{
  const f=await worktreeFixture(t),worker=await liveWorker(t),store=createWorkspaceState(f.home),bootId=await systemBootId();assert.ok(bootId);
  await store.update(state=>{state.fetches=[{id:'live-fetch',gitCommonDir:join(f.repo,'.git'),status:'uncertain',bootId,owner:{pid:process.pid,birth:'fixture-owner'},ownerActive:false,worker:{...worker,birth:identified?worker.birth:null},createdAt:new Date().toISOString()}];});
  const registry=createFetchRegistry({store}),item=(await registry.inspect({})).fetches[0],before=(await store.read()).value;
  const result=await registry.abandon({fetchId:item.id,confirmed:true,expectedHash:item.confirmationHash});
  if(identified){assert.equal(result.code,'WORKER_ACTIVE');assert.deepEqual((await store.read()).value,before);}
  else{assert.equal(result.status,'abandoned');assert.equal((await store.read()).value.fetchAbandonments.length,1);}
  assert.doesNotThrow(()=>process.kill(worker.pid,0));
});
