import test from 'node:test';
import assert from 'node:assert/strict';
import { worktreeFixture } from './helpers/worktree-fixture.mjs';

test('fetch ignores configured mappings to local branches even with a detached source checkout',async t=>{
  const f=await worktreeFixture(t);await f.commit(f.peer,'remote advance');await f.publish();
  await f.command('git',['-C',f.repo,'checkout','--detach']);
  await f.command('git',['-C',f.repo,'config','--add','remote.origin.fetch','+refs/heads/main:refs/heads/main']);
  const before=(await f.command('git',['-C',f.repo,'for-each-ref','--format=%(refname) %(objectname)','refs/heads/'])).stdout;
  const plan=await f.plan();
  assert.equal((await f.command('git',['-C',f.repo,'for-each-ref','--format=%(refname) %(objectname)','refs/heads/'])).stdout,before,'Planning must never move even an unchecked-out local branch.');
  assert.equal(plan.base.relation,'behind');assert.equal(plan.base.localSha,f.base);
});

for(const [existing,proposed] of [['tracker','tracker/one'],['tracker/one','tracker']])test(`branch prefix collision ${existing} / ${proposed} is refused before reservation`,async t=>{
  const f=await worktreeFixture(t);await f.command('git',['-C',f.repo,'branch',existing]);f.issues.get('one').branchName=proposed;
  assert.equal((await f.plan()).code,'BRANCH_COLLISION');
  assert.equal((await f.read('workspace-state.json').catch(()=>({attempts:[]}))).attempts.length,0);
});

test('reviewing an exact existing commit does not ask confirmation for its unused offline main base',async t=>{
  const f=await worktreeFixture(t);await f.command('git',['-C',f.repo,'remote','remove','origin']);
  const plan=await f.plan({role:'review',reviewCommit:f.base});assert.equal(plan.base.relation,'unknown');assert.equal(plan.needsConfirmation,false);
  assert.equal((await f.prepare(plan)).status,'prepared');
});
