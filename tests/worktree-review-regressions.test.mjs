import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile,readFile,access } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBackend } from '../src/backend.mjs';
import { createCommands } from '../src/commands.mjs';
import { executeWorkspaceCleanup } from '../src/workspace-cleanup.mjs';
import { executeWorkspaceJob } from '../src/workspace-execution.mjs';
import { createWorkspaceState } from '../src/workspace-state.mjs';
import { worktreeFixture } from './helpers/worktree-fixture.mjs';

import { withFakeHerdr } from './helpers/fake-herdr.mjs';
async function partial(t,{tracked=false}={}) {
  const f=await worktreeFixture(t);
  if(tracked){await writeFile(join(f.repo,'tracked.txt'),'original');await f.command('git',['-C',f.repo,'add','tracked.txt']);await f.commit(f.repo,'tracked fixture');}
  const backend=createBackend(withFakeHerdr({root:f.home,tracker:f.tracker,exec:f.exec,workspaceOptions:{workerPath:fileURLToPath(new URL('./helpers/worktree-detached-worker.mjs',import.meta.url))}},'/fixture/forbidden-hc'));
  const plan=await f.plan(),result=await backend.dispatch('worktree-prepare',{planId:plan.planId});assert.equal(result.status,'needs-finalization');
  const reconcile=()=>f.backend.dispatch('worktree-reconcile',{preparationId:result.preparationId});
  return {...f,plan,id:result.preparationId,worktree:result.preparation.worktree,initial:result,reconcile};
}
async function present(path){try{await access(path);return true;}catch{return false;}}

test('cleanup preserves an advanced detached HEAD and its worktree reference',async t=>{
  const f=await partial(t),commit=await f.commit(f.worktree,'user detached work'),proof=await f.reconcile();
  const result=await f.backend.dispatch('worktree-cleanup',{preparationId:f.id,confirmed:true,expectedHash:proof.cleanupProposal?.hash??'old-proposal'});
  assert.equal(await present(f.worktree),true,JSON.stringify({result,commit}));
  assert.equal((await f.command('git',['-C',f.worktree,'rev-parse','HEAD'])).stdout.trim(),commit);
  assert.equal(result.code,'CLEANUP_MANUAL_REQUIRED');assert.equal(proof.cleanupProposal,null);
});

for(const flag of ['--assume-unchanged','--skip-worktree'])test(`cleanup preserves a tracked modification hidden by ${flag}`,async t=>{
  const f=await partial(t,{tracked:true});await f.command('git',['-C',f.worktree,'update-index',flag,'tracked.txt']);await writeFile(join(f.worktree,'tracked.txt'),'user modified');
  assert.equal((await f.command('git',['-C',f.worktree,'status','--porcelain'])).stdout.trim(),'','The fixture must reproduce a falsely clean Git status.');
  const proof=await f.reconcile(),result=await f.backend.dispatch('worktree-cleanup',{preparationId:f.id,confirmed:true,expectedHash:proof.cleanupProposal?.hash??'old-proposal'});
  assert.equal(await present(f.worktree),true,JSON.stringify(result));assert.equal(await readFile(join(f.worktree,'tracked.txt'),'utf8'),'user modified');
  assert.equal(result.code,'CLEANUP_MANUAL_REQUIRED');
});

test('a saved git-worktree confirmation is refused by the executor before any Git call',async t=>{
  const f=await partial(t),attempt=(await f.read('workspace-state.json')).attempts[0];
  // Represents a durable cleanup request written by the preceding release.
  attempt.cleanup=f.initial.cleanupProposal??{kind:'git-worktree'};
  attempt.status='creating';attempt.phase='cleanup';attempt.worker={pid:process.pid,pgid:process.pid,nonce:'legacy-cleanup'};
  await createWorkspaceState(f.home).update(state=>Object.assign(state.attempts[0],attempt));
  await writeFile(join(f.worktree,'.DS_Store'),'user ignored fixture');let calls=0;
  const git=createCommands({exec:f.command}).git;
  await executeWorkspaceJob({root:f.home,preparationId:f.id,nonce:'legacy-cleanup',git:async(...args)=>{calls++;return git(...args);}});
  const saved=(await f.read('workspace-state.json')).attempts[0];assert.equal(saved.errorCode,'CLEANUP_MANUAL_REQUIRED');assert.equal(saved.status,'uncertain');assert.equal(calls,0);
  assert.equal(await readFile(join(f.worktree,'.DS_Store'),'utf8'),'user ignored fixture');
});

test('a late ignored file cannot enter any recursive Git removal path',async t=>{
  const f=await partial(t),attempt=(await f.read('workspace-state.json')).attempts[0];attempt.cleanup=f.initial.cleanupProposal??{kind:'git-worktree'};
  await writeFile(join(f.repo,'.git','info','exclude'),'*.late\n');
  const git=createCommands({exec:f.command}).git;let removed=false,error;
  try{await executeWorkspaceCleanup({attempt,git:async(cwd,args)=>{
    if(args.includes('remove')){removed=true;await writeFile(join(f.worktree,'user.late'),'late user file');}
    return git(cwd,args);
  },publish:async()=>{}});}catch(value){error=value;}
  assert.equal(removed,false,JSON.stringify({error:error?.code,lateFileStillExists:await present(join(f.worktree,'user.late'))}));
  assert.equal(error?.code,'CLEANUP_MANUAL_REQUIRED');await access(f.worktree);
});

test('a Git checkout gets inspection advice but never destructive cleanup argv',async t=>{
  const f=await partial(t),proof=await f.reconcile();assert.equal(proof.cleanupProposal,null);
  assert.ok(proof.manualCleanup.every(command=>!command.argv.includes('unlock')&&!command.argv.includes('remove')));
  assert.ok(proof.manualCleanup.some(command=>command.argv.includes('ls-files')));
  assert.ok(proof.manualCleanup.some(command=>command.argv.includes('--ignored')));
});
