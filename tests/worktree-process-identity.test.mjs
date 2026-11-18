import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { createWorkspaceState } from '../src/workspace-state.mjs';
import { inspectWorkerGroup,processBirth } from '../src/process-identity.mjs';
import { worktreeFixture } from './helpers/worktree-fixture.mjs';

test('a stale group record with a different process birth can be explicitly released without killing the unrelated process',async t=>{
  const f=await worktreeFixture(t),plan=await f.plan(),id=randomUUID();
  const unrelated=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{detached:true,stdio:'ignore',shell:false});await once(unrelated,'spawn');
  try {
    // Simulates PGID reuse: an old durable identity now names a real, newer group.
    await createWorkspaceState(f.home).update(state=>state.attempts.push({...plan,plan,preparationId:id,issueId:plan.issue.id,role:'dev',tool:'codex',ownerPid:process.pid,ownerActive:false,worker:{pid:unrelated.pid,pgid:unrelated.pid,nonce:'old-worker',birth:'Thu Jan  1 00:00:00 1970'},status:'reserved',phase:'create',updatedAt:new Date().toISOString()}));
    const proof=await f.backend.dispatch('worktree-reconcile',{preparationId:id});assert.equal(proof.status,'failed-certain');
    assert.equal((await f.backend.dispatch('worktree-release',{preparationId:id,confirmed:true,expectedHash:proof.preparationHash})).status,'released');
    assert.doesNotThrow(()=>process.kill(unrelated.pid,0));
  }finally{const exited=once(unrelated,'exit');unrelated.kill('SIGKILL');await exited;}
});

test('a live group with matching or unavailable birth remains active',async()=>{
  const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{detached:true,stdio:'ignore',shell:false});await once(child,'spawn');
  try {
    const birth=await processBirth(child.pid);assert.ok(birth);
    assert.equal((await inspectWorkerGroup({pid:child.pid,pgid:child.pid,birth})).state,'alive');
    assert.equal((await inspectWorkerGroup({pid:child.pid,pgid:child.pid,birth:null})).state,'alive');
  }finally{const exited=once(child,'exit');child.kill('SIGKILL');await exited;}
});
