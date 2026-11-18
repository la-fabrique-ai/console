import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir,writeFile,readFile,rmdir,rename,symlink,lstat,access } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createBackend } from '../src/backend.mjs';
import { createCommands } from '../src/commands.mjs';
import { claimTarget } from '../src/workspace-paths.mjs';
import { createWorkspaceState,activeAttempt } from '../src/workspace-state.mjs';
import { proposeCleanup } from '../src/workspace-cleanup.mjs';
import { executeWorkspaceJob } from '../src/workspace-execution.mjs';
import { worktreeFixture } from './helpers/worktree-fixture.mjs';

import { withFakeHerdr } from './helpers/fake-herdr.mjs';
async function empty(t) {
  const f=await worktreeFixture(t),plan=await f.plan(),claimedPath=await claimTarget(plan),store=createWorkspaceState(f.home),git=createCommands({exec:f.command}).git;
  const attempt={...plan,plan,preparationId:randomUUID(),issueId:plan.issue.id,role:'dev',tool:'codex',status:'failed-certain',phase:'failed-certain',goState:'requested',ownerActive:false,worker:null,claimedPath};
  const proposal=await proposeCleanup(attempt,{state:'failed-owned-empty'},git);assert.ok(proposal);
  await store.update(state=>state.attempts.push(attempt));return {...f,store,git,attempt,proposal};
}
async function runInjected(f,removeEmptyDirectory) {
  const nonce=randomUUID();await f.store.update(state=>Object.assign(state.attempts[0],{cleanup:f.proposal,status:'creating',phase:'cleanup',worker:{pid:process.pid,pgid:process.pid,nonce}}));
  await executeWorkspaceJob({root:f.home,preparationId:f.attempt.preparationId,nonce,git:f.git,removeEmptyDirectory});
  return (await f.store.read()).value.attempts[0];
}

test('an owned empty directory is removed only after exact explicit confirmation',async t=>{
  const f=await empty(t),id=f.attempt.preparationId,proof=await f.backend.dispatch('worktree-reconcile',{preparationId:id});
  assert.equal((await f.backend.dispatch('worktree-cleanup',{preparationId:id})).code,'CONFIRMATION_REQUIRED');await access(f.attempt.worktree);
  assert.equal((await f.backend.dispatch('worktree-cleanup',{preparationId:id,confirmed:true,expectedHash:proof.cleanupProposal.hash})).status,'failed-certain');
  await assert.rejects(access(f.attempt.worktree),{code:'ENOENT'});assert.equal(activeAttempt((await f.store.read()).value.attempts[0]),true);
});

test('a claimed directory containing only .DS_Store is nonempty and is retained',async t=>{
  const f=await empty(t);await writeFile(join(f.attempt.worktree,'.DS_Store'),'user file');
  const proof=await f.backend.dispatch('worktree-reconcile',{preparationId:f.attempt.preparationId});assert.equal(proof.cleanupProposal,null);
  assert.equal(await readFile(join(f.attempt.worktree,'.DS_Store'),'utf8'),'user file');
});

test('a directory replaced by a symlink at the rmdir boundary is refused and its target survives',async t=>{
  const f=await empty(t),outside=join(f.root,'outside');await mkdir(outside);await writeFile(join(outside,'user'),'preserve');
  const result=await runInjected(f,async path=>{await rename(path,path+'-original');await symlink(outside,path);await rmdir(path);});
  assert.equal(result.status,'uncertain');assert.equal(result.errorCode,'ENOTDIR');assert.equal(activeAttempt(result),true);
  assert.equal((await lstat(f.attempt.worktree)).isSymbolicLink(),true);assert.equal(await readFile(join(outside,'user'),'utf8'),'preserve');
});

test('a file written at the rmdir boundary survives ENOTEMPTY and keeps an uncertain reservation',async t=>{
  const f=await empty(t),result=await runInjected(f,async path=>{await writeFile(join(path,'user.ignored'),'preserve');await rmdir(path);});
  assert.equal(result.status,'uncertain');assert.equal(result.errorCode,'ENOTEMPTY');assert.equal(activeAttempt(result),true);
  assert.equal(await readFile(join(f.attempt.worktree,'user.ignored'),'utf8'),'preserve');
});

async function branchFixture(t) {
  const f=await worktreeFixture(t),backend=createBackend(withFakeHerdr({root:f.home,tracker:f.tracker,exec:f.exec,workspaceOptions:{workerPath:fileURLToPath(new URL('./helpers/worktree-detached-worker.mjs',import.meta.url))}},'/fixture/forbidden-hc'));
  const plan=await f.plan(),result=await backend.dispatch('worktree-prepare',{planId:plan.planId});assert.equal(result.status,'needs-finalization');
  const worktree=result.preparation.worktree;
  await f.command('git',['-C',worktree,'switch','-c',plan.branch,plan.base.chosenSha]);return {...f,plan,id:result.preparationId,worktree};
}
test('manual cleanup requires both the failed checkout and its leftover branch before explicit release',async t=>{
  const f=await branchFixture(t);await writeFile(join(f.worktree,'user-note'),'preserve manually');
  const refused=await f.backend.dispatch('worktree-cleanup',{preparationId:f.id,confirmed:true,expectedHash:'obsolete'});assert.equal(refused.code,'CLEANUP_MANUAL_REQUIRED');
  await rename(join(f.worktree,'user-note'),join(f.root,'preserved-note'));
  await f.command('git',['-C',f.repo,'worktree','unlock',f.worktree]);await f.command('git',['-C',f.repo,'worktree','remove',f.worktree]);
  const remaining=await f.backend.dispatch('worktree-reconcile',{preparationId:f.id});assert.equal(remaining.status,'uncertain');
  assert.equal((await f.backend.dispatch('worktree-release',{preparationId:f.id,confirmed:true,expectedHash:remaining.preparationHash})).code,'PREPARATION_UNCERTAIN');
  await f.command('git',['-C',f.repo,'branch','-d',f.plan.branch]);
  const empty=await f.backend.dispatch('worktree-reconcile',{preparationId:f.id});assert.equal(empty.status,'failed-certain');
  assert.equal((await f.backend.dispatch('worktree-release',{preparationId:f.id,confirmed:true,expectedHash:empty.preparationHash})).status,'released');
  assert.equal(await readFile(join(f.root,'preserved-note'),'utf8'),'preserve manually');
});

test('a leftover branch alone cannot be mistaken for a fully cleaned preparation',async t=>{
  const f=await branchFixture(t);await f.command('git',['-C',f.repo,'worktree','unlock',f.worktree]);await f.command('git',['-C',f.repo,'worktree','remove',f.worktree]);
  const proof=await f.backend.dispatch('worktree-reconcile',{preparationId:f.id});assert.equal(proof.status,'uncertain');
  assert.equal((await f.backend.dispatch('worktree-release',{preparationId:f.id,confirmed:true,expectedHash:proof.preparationHash})).code,'PREPARATION_UNCERTAIN');
});
