import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir,writeFile,readFile,symlink,access } from 'node:fs/promises';
import { join } from 'node:path';
import { worktreeFixture } from './helpers/worktree-fixture.mjs';
import { createBackend } from '../src/backend.mjs';

import { withFakeHerdr } from './helpers/fake-herdr.mjs';
test('prepare refreshes the issue, creates the exact planned isolated checkout and never launches an agent',async t=>{
  const f=await worktreeFixture(t),plan=await f.plan(),result=await f.prepare(plan);
  assert.equal(result.status,'prepared');assert.equal(result.agentLaunched,false);
  const p=result.preparation;assert.match(p.instanceId,/^[a-f0-9-]{36}$/);
  assert.equal(p.worktree,join(f.worktreesRoot,'fixture',`app-fix-1-dev-${p.instanceId}`));
  assert.equal(p.branch,'tracker/one');assert.equal(p.base.chosenSha,f.base);
  assert.equal((await f.command('git',['-C',p.worktree,'branch','--show-current'])).stdout.trim(),p.branch);
  assert.ok(f.trackerCalls.every(call=>call.options.refresh===true));
  assert.ok(f.commands.every(call=>call.file==='git'||call.file.endsWith('/git')));
  assert.ok(!f.commands.some(call=>call.args.some(arg=>['reset','pull','stash','push'].includes(arg))));
});

test('the same plan is reused without another checkout and preserves user changes',async t=>{
  const f=await worktreeFixture(t),plan=await f.plan(),first=await f.prepare(plan),path=join(first.preparation.worktree,'user-note');
  await writeFile(path,'preserve me');const second=await f.prepare(plan);
  assert.equal(second.status,'prepared');assert.equal(second.reused,true);assert.equal(second.preparation.preparationId,first.preparation.preparationId);
  assert.equal(await readFile(path,'utf8'),'preserve me');
});

test('invalid Tracker branch gets an explicit safe fallback rather than becoming an option',async t=>{
  const f=await worktreeFixture(t);f.issues.get('one').branchName='--upload-pack=hostile';const plan=await f.plan();
  assert.equal(plan.branchSource,'fallback');assert.match(plan.branch,/^fabrique-console\/fix-1-[a-f0-9-]+$/);
  assert.equal((await f.prepare(plan)).status,'prepared');
});

test('an existing branch is refused without switching or overwriting it',async t=>{
  const f=await worktreeFixture(t);await f.command('git',['-C',f.repo,'branch','tracker/one']);
  const before=(await f.command('git',['-C',f.repo,'rev-parse','tracker/one'])).stdout;
  assert.equal((await f.plan()).code,'BRANCH_COLLISION');
  assert.equal((await f.command('git',['-C',f.repo,'rev-parse','tracker/one'])).stdout,before);
});

test('a path occupied after planning is never adopted or overwritten',async t=>{
  const f=await worktreeFixture(t),plan=await f.plan();await mkdir(plan.worktree,{recursive:true});await writeFile(join(plan.worktree,'owned-by-user'),'fixture');
  assert.equal((await f.prepare(plan)).code,'WORKTREE_COLLISION');assert.equal(await readFile(join(plan.worktree,'owned-by-user'),'utf8'),'fixture');
});

test('a destination symlink is refused without writing to its target',async t=>{
  const f=await worktreeFixture(t),plan=await f.plan(),outside=join(f.root,'outside');await mkdir(outside);
  await mkdir(join(f.worktreesRoot,'fixture'),{recursive:true});await symlink(outside,plan.worktree);
  assert.equal((await f.prepare(plan)).code,'WORKTREE_COLLISION');await assert.rejects(access(join(outside,'.git')),{code:'ENOENT'});
});

test('a symlink worktreesRoot is refused rather than creating elsewhere',async t=>{
  const f=await worktreeFixture(t),outside=join(f.root,'outside');await mkdir(outside);await symlink(outside,f.worktreesRoot);
  assert.equal((await f.plan()).code,'WORKTREES_ROOT_UNSAFE');
});

test('a repository symlink resolves to the real authorized Git while destination stays inside worktreesRoot',async t=>{
  const f=await worktreeFixture(t),alias=join(f.root,'alias');await symlink(f.repo,alias);
  f.config.projects[0].repos[0].path=alias;await f.write('config.json',f.config);
  const result=await f.prepare(await f.plan());assert.equal(result.status,'prepared');assert.equal(result.preparation.repo,f.repo);
  assert.ok(result.preparation.worktree.startsWith(f.worktreesRoot+'/fixture/'));
});

test('two independent review plans create distinct detached checkouts at the examined commit',async t=>{
  const f=await worktreeFixture(t),a=await f.plan({role:'review',reviewCommit:f.base}),b=await f.plan({role:'review',tool:'claude',reviewCommit:f.base});
  const first=await f.prepare(a),second=await f.prepare(b);assert.equal(first.status,'prepared');assert.equal(second.status,'prepared');
  assert.notEqual(first.preparation.instanceId,second.preparation.instanceId);assert.notEqual(first.preparation.worktree,second.preparation.worktree);
  for(const {preparation:p} of [first,second]){assert.equal(p.branch,null);assert.equal((await f.command('git',['-C',p.worktree,'branch','--show-current'])).stdout.trim(),'');assert.equal((await f.command('git',['-C',p.worktree,'rev-parse','HEAD'])).stdout.trim(),f.base);}
});

test('another family cannot create a second implementation for the same ticket and Git',async t=>{
  const f=await worktreeFixture(t);assert.equal((await f.prepare(await f.plan())).status,'prepared');
  const second=await f.plan({tool:'claude'});assert.equal(second.code,'TICKET_ALREADY_RESERVED');
});

test('another ticket cannot take an occupied Git lane without explicit parallel approval',async t=>{
  const f=await worktreeFixture(t);await f.prepare(await f.plan());const second=await f.plan({issueId:'two'});
  assert.equal((await f.prepare(second)).code,'LANE_BUSY');
});

test('V1 state and QA bytes are preserved and an explicitly stopped legacy session consumes no new slot',async t=>{
  const f=await worktreeFixture(t),state={version:1,sessions:[{id:'legacy',repo:f.repo,stoppedAt:'2026-11-06T08:00:00Z',launchUncertain:false}]};
  await f.write('state.json',state);await mkdir(join(f.home,'qa'));await f.write('qa/legacy.json',{status:'historical'});
  const paths=[join(f.home,'state.json'),join(f.home,'qa','legacy.json')],before=await Promise.all(paths.map(path=>readFile(path)));
  assert.equal((await f.prepare(await f.plan())).status,'prepared');assert.deepEqual(await Promise.all(paths.map(path=>readFile(path))),before);
});

test('legacy activity that is unknown cannot silently count as an empty lane',async t=>{
  const f=await worktreeFixture(t);await f.write('state.json',{version:1,sessions:[{id:'legacy',repo:f.repo,status:'unknown'}]});
  assert.equal((await f.prepare(await f.plan())).code,'LEGACY_RESERVATION_UNKNOWN');
});

test('a failed worker start is reconcilable even while the calling process remains alive',async t=>{
  const f=await worktreeFixture(t),backend=createBackend(withFakeHerdr({root:f.home,tracker:f.tracker,exec:f.exec,workspaceOptions:{workerPath:join(f.root,'missing-worker.mjs')}},'/fixture/forbidden-hc'));
  const plan=await backend.dispatch('worktree-plan',{issueId:'one',tool:'codex',role:'dev'});
  const failed=await backend.dispatch('worktree-prepare',{planId:plan.planId});assert.equal(failed.code,'WORKER_START_UNCERTAIN');
  const attempt=(await f.read('workspace-state.json')).attempts[0];
  const result=await backend.dispatch('worktree-reconcile',{preparationId:attempt.preparationId});
  assert.equal(result.status,'failed-certain');assert.equal(failed.preparationId,attempt.preparationId);
});
