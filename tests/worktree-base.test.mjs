import test from 'node:test';
import assert from 'node:assert/strict';
import { rename,readFile,access } from 'node:fs/promises';
import { join } from 'node:path';
import { worktreeFixture } from './helpers/worktree-fixture.mjs';

for(const scenario of ['equal','ahead','behind','diverged'])test(`plan reports complete local and remote base for ${scenario}`,async t=>{
  const f=await worktreeFixture(t);
  if(['ahead','diverged'].includes(scenario))await f.commit(f.repo,'local');
  if(['behind','diverged'].includes(scenario)){await f.commit(f.peer,'remote');await f.publish();}
  const local=(await f.command('git',['-C',f.repo,'rev-parse','refs/heads/main'])).stdout.trim();
  const remote=(await f.command('git',['--git-dir',f.remote,'rev-parse','refs/heads/main'])).stdout.trim();
  const result=await f.plan();
  assert.equal(result.status,'planned');assert.equal(result.base.relation,scenario);
  assert.equal(result.base.localSha,local);assert.equal(result.base.remoteSha,remote);assert.equal(result.base.chosenSha,local);
  assert.match(local,/^[a-f0-9]{40}$/);assert.match(remote,/^[a-f0-9]{40}$/);
  assert.equal(result.base.fetch.status,'succeeded');assert.ok(Number.isFinite(Date.parse(result.base.fetch.lastSucceededAt)));
  assert.equal(result.needsConfirmation,['behind','diverged'].includes(scenario));
  assert.equal((await f.command('git',['-C',f.repo,'rev-parse','refs/heads/main'])).stdout.trim(),local);
  await assert.rejects(access(f.worktreesRoot),{code:'ENOENT'});
});

test('missing origin gives an unknown base with no invented fetch date',async t=>{
  const f=await worktreeFixture(t);await f.command('git',['-C',f.repo,'remote','remove','origin']);
  const result=await f.plan();assert.equal(result.status,'planned');assert.equal(result.base.relation,'unknown');
  assert.equal(result.base.remoteSha,null);assert.equal(result.base.fetch.lastSucceededAt,null);assert.equal(result.needsConfirmation,true);
});

test('offline fetch never treats a cached remote ref as a freshly verified base',async t=>{
  const f=await worktreeFixture(t),first=await f.plan();
  await rename(f.remote,join(f.root,'offline-remote'));
  const result=await f.plan();assert.equal(result.base.relation,'unknown');assert.equal(result.base.fetch.status,'failed');
  assert.equal(first.base.remoteSha,f.base);assert.equal(result.base.remoteSha,null);assert.equal(result.base.fetch.lastSucceededAt,first.base.fetch.lastSucceededAt);
  assert.equal(result.needsConfirmation,true);
});

test('detached source checkout still uses the configured main branch and remains detached',async t=>{
  const f=await worktreeFixture(t);await f.command('git',['-C',f.repo,'checkout','--detach']);
  const result=await f.plan();assert.equal(result.base.localSha,f.base);assert.equal(result.base.relation,'equal');
  assert.equal((await f.command('git',['-C',f.repo,'branch','--show-current'])).stdout.trim(),'');
});

test('behind base requires the exact current manifest confirmation and preserves local main',async t=>{
  const f=await worktreeFixture(t);await f.commit(f.peer,'remote');await f.publish();const plan=await f.plan();
  assert.equal((await f.prepare(plan)).code,'BASE_CONFIRMATION_REQUIRED');
  assert.equal((await f.prepare(plan,{confirmation:{manifestHash:'0'.repeat(64)}})).code,'CONFIRMATION_MISMATCH');
  const result=await f.prepare(plan,{confirmation:{manifestHash:plan.manifestHash}});assert.equal(result.status,'prepared');
  assert.equal((await f.command('git',['-C',result.preparation.worktree,'rev-parse','HEAD'])).stdout.trim(),plan.base.localSha);
  assert.equal((await f.command('git',['-C',f.repo,'rev-parse','main'])).stdout.trim(),plan.base.localSha);
});

test('a changed issue after planning invalidates preparation without creating a worktree',async t=>{
  const f=await worktreeFixture(t),plan=await f.plan();f.issues.get('one').description='Changed acceptance criteria';
  const result=await f.prepare(plan);assert.equal(result.code,'PLAN_CHANGED');await assert.rejects(access(f.worktreesRoot),{code:'ENOENT'});
  assert.ok(f.trackerCalls.length>=2);assert.ok(f.trackerCalls.every(call=>call.options.refresh===true));
});

test('a changed base after planning invalidates the manifest even when no confirmation was needed',async t=>{
  const f=await worktreeFixture(t),plan=await f.plan();await f.commit(f.repo,'new-local');
  assert.equal((await f.prepare(plan)).code,'PLAN_CHANGED');await assert.rejects(access(f.worktreesRoot),{code:'ENOENT'});
});

test('a missing main branch is not replaced by the current checkout or an arbitrary remote SHA',async t=>{
  const f=await worktreeFixture(t);f.config.projects[0].repos[0].mainBranch='missing';await f.write('config.json',f.config);
  assert.equal((await f.plan()).code,'BASE_UNAVAILABLE');
});
