import test from 'node:test';
import assert from 'node:assert/strict';
import { rename,symlink,writeFile,readFile,lstat,unlink,mkdir } from 'node:fs/promises';
import { dirname,join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBackend } from '../src/backend.mjs';
import { createWorkspaceState } from '../src/workspace-state.mjs';
import { worktreeFixture } from './helpers/worktree-fixture.mjs';
import { createFetchRegistry } from '../src/fetch-registry.mjs';

const dispatch=async(backend,action,input)=>{try{return await backend.dispatch(action,input);}catch(error){return {code:error.code??'UNEXPECTED_THROW'};}};
async function uncertain(t) {
  const f=await worktreeFixture(t),backend=createBackend({root:f.home,exec:f.exec,tracker:f.tracker,workspaceOptions:{workerPath:fileURLToPath(new URL('./helpers/worktree-detached-worker.mjs',import.meta.url))}});
  const plan=await f.plan(),result=await backend.dispatch('worktree-prepare',{planId:plan.planId});assert.equal(result.status,'needs-finalization');
  await f.command('git',['-C',result.preparation.worktree,'switch','-c',plan.branch]);await writeFile(join(result.preparation.worktree,'user-note'),'preserve');
  const parent=dirname(result.preparation.worktree),moved=join(f.root,'preserved-parent');await rename(parent,moved);await symlink(moved,parent);
  const proof=await f.backend.dispatch('worktree-reconcile',{preparationId:result.preparationId});assert.equal(proof.status,'uncertain');
  return {...f,workspacePlan:plan,id:result.preparationId,worktree:result.preparation.worktree,proof};
}
test('forced release behind a replaced ancestor requires exact explicit confirmation, preserves data and audits the prior state',async t=>{
  const f=await uncertain(t),before=(await f.read('workspace-state.json')).attempts[0],original=(await f.command('git',['-C',f.repo,'rev-parse',f.workspacePlan.branch])).stdout;
  const input={preparationId:f.id,force:true,expectedHash:f.proof.preparationHash,reason:'Manually inspected moved directory'};
  assert.equal((await dispatch(f.backend,'worktree-release',input)).code,'CONFIRMATION_REQUIRED');
  assert.equal((await dispatch(f.backend,'worktree-release',{...input,confirmed:true,expectedHash:'wrong'})).code,'CONFIRMATION_MISMATCH');
  const originalKill=process.kill,signals=[];process.kill=(pid,signal)=>{if(signal!==0)signals.push(signal);return originalKill(pid,signal);};
  let result;try{result=await dispatch(f.backend,'worktree-release',{...input,confirmed:true});}finally{process.kill=originalKill;}
  assert.equal(result.status,'released');assert.deepEqual(signals,[]);
  assert.equal(await readFile(join(f.worktree,'user-note'),'utf8'),'preserve');assert.equal((await lstat(dirname(f.worktree))).isSymbolicLink(),true);
  assert.equal((await f.command('git',['-C',f.repo,'rev-parse',f.workspacePlan.branch])).stdout,original);
  const saved=(await f.read('workspace-state.json')).attempts[0],audit=saved.forcedRelease;
  assert.ok(audit);assert.equal(audit.actor.uid,process.getuid());assert.ok(audit.actor.username);assert.ok(Number.isFinite(Date.parse(audit.at)));assert.deepEqual(audit.previousState,before);assert.equal(audit.expectedHash,f.proof.preparationHash);
  assert.equal((await f.plan()).code,'BRANCH_COLLISION');
});

test('forced release still refuses a new preparation at an occupied destination',async t=>{
  const f=await uncertain(t);await f.command('git',['-C',f.repo,'branch','-m',f.workspacePlan.branch,'preserved-work']);
  const proof=await f.backend.dispatch('worktree-reconcile',{preparationId:f.id});
  assert.equal((await dispatch(f.backend,'worktree-release',{preparationId:f.id,force:true,confirmed:true,expectedHash:proof.preparationHash})).status,'released');
  const parent=dirname(f.worktree);await unlink(parent);await rename(join(f.root,'preserved-parent'),parent);
  const next=await f.plan();assert.equal(next.status,'planned');await mkdir(next.worktree,{recursive:true});await writeFile(join(next.worktree,'user'),'preserve new occupant');
  assert.equal((await f.prepare(next)).code,'WORKTREE_COLLISION');assert.equal(await readFile(join(next.worktree,'user'),'utf8'),'preserve new occupant');
  assert.equal(await readFile(join(f.worktree,'user-note'),'utf8'),'preserve');
});

test('a stale forced reservation confirmation changes no state',async t=>{
  const f=await uncertain(t),store=createWorkspaceState(f.home);await store.update(state=>{state.attempts[0].phase='changed-since-inspection';});
  assert.equal((await dispatch(f.backend,'worktree-release',{preparationId:f.id,force:true,confirmed:true,expectedHash:f.proof.preparationHash})).code,'CONFIRMATION_MISMATCH');
  assert.equal((await f.read('workspace-state.json')).attempts[0].forcedRelease,undefined);
});

test('forced release is not a replacement for normal release when absence is proven',async t=>{
  const f=await uncertain(t);
  // The original parent is a symlink: restore its original identity before the normal cleanup.
  const parent=dirname(f.worktree),moved=join(f.root,'preserved-parent');await unlink(parent);await rename(moved,parent);
  await f.command('git',['-C',f.repo,'worktree','unlock',f.worktree]);await rename(join(f.worktree,'user-note'),join(f.root,'preserved-note'));await f.command('git',['-C',f.repo,'worktree','remove',f.worktree]);await f.command('git',['-C',f.repo,'branch','-d',f.workspacePlan.branch]);
  const proof=await f.backend.dispatch('worktree-reconcile',{preparationId:f.id});assert.equal(proof.status,'failed-certain');
  assert.equal((await dispatch(f.backend,'worktree-release',{preparationId:f.id,force:true,confirmed:true,expectedHash:proof.preparationHash})).code,'FORCE_NOT_REQUIRED');
  assert.equal((await f.backend.dispatch('worktree-release',{preparationId:f.id,confirmed:true,expectedHash:proof.preparationHash})).status,'released');
});

async function fetchFixture(t) {
  const f=await worktreeFixture(t),store=createWorkspaceState(f.home);
  await store.update(state=>{state.fetches=[{id:'uncertain-fetch',gitCommonDir:join(f.repo,'.git'),status:'uncertain',ownerActive:false,owner:{pid:765432,birth:'parent'},worker:{pid:765433,pgid:765433,birth:'birth',nonce:'nonce'},bootId:'boot',createdAt:'2026-11-06T09:00:00Z'}];});
  // A present group without a readable birth is inconclusive, not a known-live worker.
  const backend=createBackend({root:f.home,exec:f.exec,tracker:f.tracker,workspaceOptions:{fetchProof:{bootId:async()=> 'boot',birth:async()=> null,alive:()=>true}}});
  return {...f,store,backend};
}
test('abandoning an uncertain fetch requires an exact current fingerprint and writes a durable actor/state audit without signals',async t=>{
  const f=await fetchFixture(t),inspect=await dispatch(f.backend,'fetch-inspect',{});assert.ok(inspect.fetches);
  const item=inspect.fetches[0];assert.match(item.confirmationHash,/^[a-f0-9]{64}$/);
  const input={fetchId:item.id,expectedHash:item.confirmationHash,reason:'Manually inspected uncertain group'};
  assert.equal((await dispatch(f.backend,'fetch-abandon',input)).code,'CONFIRMATION_REQUIRED');
  assert.equal((await dispatch(f.backend,'fetch-abandon',{...input,confirmed:true,expectedHash:'wrong'})).code,'CONFIRMATION_MISMATCH');
  const before=(await f.store.read()).value.fetches[0],original=process.kill,signals=[];process.kill=(pid,signal)=>{if(signal!==0)signals.push(signal);return original(pid,signal);};
  let result;try{result=await dispatch(f.backend,'fetch-abandon',{...input,confirmed:true});}finally{process.kill=original;}
  assert.equal(result.status,'abandoned');assert.deepEqual(signals,[]);
  const value=(await f.store.read()).value;assert.deepEqual(value.fetches,[]);assert.equal(value.fetchAbandonments.length,1);
  const audit=value.fetchAbandonments[0];assert.deepEqual(audit.previousState,before);assert.equal(audit.expectedHash,item.confirmationHash);assert.equal(audit.actor.uid,process.getuid());assert.ok(Number.isFinite(Date.parse(audit.at)));
});

test('an outdated fetch-abandon confirmation preserves its changed intention',async t=>{
  const f=await fetchFixture(t),inspect=await dispatch(f.backend,'fetch-inspect',{});assert.ok(inspect.fetches);const item=inspect.fetches[0];
  await f.store.update(state=>{state.fetches[0].note='changed';});
  assert.equal((await dispatch(f.backend,'fetch-abandon',{fetchId:item.id,confirmed:true,expectedHash:item.confirmationHash})).code,'CONFIRMATION_MISMATCH');
  assert.equal((await f.store.read()).value.fetches[0].id,item.id);assert.equal((await f.store.read()).value.fetchAbandonments,undefined);
});

test('fetch abandonment is refused when its completion is already provable',async t=>{
  const f=await fetchFixture(t),backend=createBackend({root:f.home,exec:f.exec,tracker:f.tracker,workspaceOptions:{fetchProof:{bootId:async()=> 'boot',birth:async()=> 'birth',alive:()=>false}}});
  const inspect=await dispatch(backend,'fetch-inspect',{}),item=inspect.fetches[0];assert.equal(item.terminationProven,true);
  assert.equal((await dispatch(backend,'fetch-abandon',{fetchId:item.id,confirmed:true,expectedHash:item.confirmationHash})).code,'FORCE_NOT_REQUIRED');
  assert.equal((await f.store.read()).value.fetchAbandonments,undefined);
  assert.equal((await backend.dispatch('worktree-plan',{issueId:'one',tool:'codex',role:'dev'})).status,'planned');
});

test('completion of an abandoned generation cannot remove a newer fetch intention',async t=>{
  const f=await worktreeFixture(t),store=createWorkspaceState(f.home),registry=createFetchRegistry({store,bootId:async()=> 'boot',birth:async()=> null,alive:()=>true});
  let finishOld,finishNew,oldRegistered,newRegistered;
  const oldReady=new Promise(resolve=>oldRegistered=resolve),newReady=new Promise(resolve=>newRegistered=resolve);
  const old=registry.run(join(f.repo,'.git'),async beforeGo=>{await beforeGo({pid:765433,pgid:765433,nonce:'old'});oldRegistered();return new Promise(resolve=>finishOld=resolve);});
  await oldReady;const item=(await registry.inspect({})).fetches[0];assert.equal((await registry.abandon({fetchId:item.id,confirmed:true,expectedHash:item.confirmationHash})).status,'abandoned');
  const next=registry.run(join(f.repo,'.git'),async beforeGo=>{await beforeGo({pid:765434,pgid:765434,nonce:'new'});newRegistered();return new Promise(resolve=>finishNew=resolve);});
  await newReady;finishOld({terminated:true});await old;
  assert.equal((await store.read()).value.fetches.length,1);assert.equal((await store.read()).value.fetches[0].worker.nonce,'new');
  finishNew({terminated:true});await next;assert.equal((await store.read()).value.fetches.length,0);assert.equal((await store.read()).value.fetchAbandonments.length,1);
});
