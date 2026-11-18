import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile,rmdir,rm,rename,mkdir,symlink,writeFile } from 'node:fs/promises';
import { join,dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBackend } from '../src/backend.mjs';
import { worktreeFixture } from './helpers/worktree-fixture.mjs';

test('a tracking reference made symbolic while the network command runs cannot move main',async t=>{
  const f=await worktreeFixture(t);await f.commit(f.peer,'remote advance');await f.publish();await f.command('git',['-C',f.repo,'checkout','--detach']);
  const script=join(f.root,'change-tracking.mjs');
  await writeFile(script,`import {spawnSync} from 'node:child_process';const changed=spawnSync('git',['-C',${JSON.stringify(f.repo)},'symbolic-ref','refs/remotes/origin/main','refs/heads/main'],{stdio:'ignore'});if(changed.status!==0)process.exit(1);const served=spawnSync('git',['upload-pack',...process.argv.slice(2)],{stdio:'inherit'});process.exit(served.status??1);\n`);
  await f.command('git',['-C',f.repo,'config','remote.origin.uploadpack',process.execPath+' '+script]);
  const before=(await f.command('git',['-C',f.repo,'for-each-ref','--format=%(refname) %(objectname)','refs/heads/'])).stdout;
  await f.plan();
  assert.equal((await f.command('git',['-C',f.repo,'for-each-ref','--format=%(refname) %(objectname)','refs/heads/'])).stdout,before);
});

test('a tracking reference changed concurrently is not overwritten by a stale observed remote value',async t=>{
  const f=await worktreeFixture(t),remote=await f.commit(f.peer,'remote advance');await f.publish();
  await f.command('git',['-C',f.repo,'switch','-c','preserved-work']);const preserved=await f.commit(f.repo,'user work');await f.command('git',['-C',f.repo,'checkout','--detach',f.base]);
  const script=join(f.root,'change-direct-tracking.mjs');
  await writeFile(script,`import {spawnSync} from 'node:child_process';const changed=spawnSync('git',['-C',${JSON.stringify(f.repo)},'update-ref','refs/remotes/origin/main',${JSON.stringify(preserved)}],{stdio:'ignore'});if(changed.status!==0)process.exit(1);const served=spawnSync('git',['upload-pack',...process.argv.slice(2)],{stdio:'inherit'});process.exit(served.status??1);\n`);
  await f.command('git',['-C',f.repo,'config','remote.origin.uploadpack',process.execPath+' '+script]);
  const before=(await f.command('git',['-C',f.repo,'for-each-ref','--format=%(refname) %(objectname)','refs/heads/'])).stdout,result=await f.plan();
  assert.equal(result.base.verified,true);assert.equal(result.base.remoteSha,remote);
  assert.equal((await f.command('git',['-C',f.repo,'rev-parse','refs/remotes/origin/main'])).stdout.trim(),preserved);
  assert.equal((await f.command('git',['-C',f.repo,'for-each-ref','--format=%(refname) %(objectname)','refs/heads/'])).stdout,before);
});

for(const target of ['refs/heads/main','refs/heads/missing-user-branch'])test(`symbolic tracking destination ${target} stays untouched during object-only observation`,async t=>{
  const f=await worktreeFixture(t),remote=await f.commit(f.peer,'remote advance');await f.publish();
  await f.command('git',['-C',f.repo,'checkout','--detach']);await f.command('git',['-C',f.repo,'symbolic-ref','refs/remotes/origin/main',target]);
  const before=(await f.command('git',['-C',f.repo,'for-each-ref','--format=%(refname) %(objectname)','refs/heads/'])).stdout;
  const result=await f.plan();
  assert.equal((await f.command('git',['-C',f.repo,'for-each-ref','--format=%(refname) %(objectname)','refs/heads/'])).stdout,before,'No local branch may move or appear.');
  assert.equal(result.status,'planned');assert.equal(result.base.verified,true);assert.equal(result.base.remoteSha,remote);
  assert.equal((await f.command('git',['-C',f.repo,'symbolic-ref','refs/remotes/origin/main'])).stdout.trim(),target);
});

test('configured bundle URI is refused before bundle refs or repository configuration are written',async t=>{
  const f=await worktreeFixture(t),bundle=join(f.root,'fixture.bundle');await f.commit(f.peer,'bundle advance');
  await f.command('git',['-C',f.peer,'bundle','create',bundle,'--all']);await f.command('git',['-C',f.repo,'config','fetch.bundleURI',bundle]);
  const before=await readFile(join(f.repo,'.git','config')),refs=(await f.command('git',['-C',f.repo,'for-each-ref','--format=%(refname) %(objectname)'])).stdout;
  const result=await f.plan();
  assert.equal((await f.command('git',['-C',f.repo,'for-each-ref','--format=%(refname) %(objectname)'])).stdout,refs);
  assert.deepEqual(await readFile(join(f.repo,'.git','config')),before);assert.equal(result.code,'FETCH_BUNDLE_UNSUPPORTED');
});

async function failed(t) {
  const f=await worktreeFixture(t),backend=createBackend({root:f.home,tracker:f.tracker,exec:f.exec,workspaceOptions:{workerPath:fileURLToPath(new URL('./helpers/worktree-detached-worker.mjs',import.meta.url))}});
  const plan=await f.plan(),result=await backend.dispatch('worktree-prepare',{planId:plan.planId});assert.equal(result.status,'needs-finalization');
  return {...f,plan,id:result.preparationId,worktree:result.preparation.worktree};
}
test('manual cleanup can remove project ancestors and still reconcile then explicitly release',async t=>{
  const f=await failed(t);await f.command('git',['-C',f.worktree,'switch','-c',f.plan.branch]);
  await f.command('git',['-C',f.repo,'worktree','unlock',f.worktree]);await f.command('git',['-C',f.repo,'worktree','remove',f.worktree]);await f.command('git',['-C',f.repo,'branch','-d',f.plan.branch]);
  await rmdir(dirname(f.worktree));await rmdir(f.worktreesRoot);
  const result=await f.backend.dispatch('worktree-reconcile',{preparationId:f.id});assert.equal(result.status,'failed-certain');
  assert.equal((await f.backend.dispatch('worktree-release',{preparationId:f.id,confirmed:true,expectedHash:result.preparationHash})).status,'released');
});

test('a replacement repository at the same path cannot prove the original preparation absent',async t=>{
  const f=await failed(t);await f.command('git',['-C',f.repo,'worktree','unlock',f.worktree]);await f.command('git',['-C',f.repo,'worktree','remove',f.worktree]);
  await rename(f.repo,f.repo+'-original');await mkdir(f.repo);await f.command('git',['init','-b','main',f.repo]);await f.commit(f.repo,'replacement');
  const proof=await f.backend.dispatch('worktree-reconcile',{preparationId:f.id});assert.equal(proof.status,'uncertain');
});

test('a marked Git checkout moved to another path cannot release its lane after branch rename',async t=>{
  const f=await failed(t),moved=join(f.root,'moved-worktree');
  await f.command('git',['-C',f.worktree,'switch','-c',f.plan.branch]);await f.command('git',['-C',f.repo,'worktree','unlock',f.worktree]);
  await f.command('git',['-C',f.repo,'worktree','move',f.worktree,moved]);await f.command('git',['-C',moved,'branch','-m','preserved-work']);
  await f.command('git',['-C',f.repo,'worktree','lock','--reason',`fabrique-console:${f.id}:${f.plan.instanceId}`,moved]);await rmdir(dirname(f.worktree));
  const proof=await f.backend.dispatch('worktree-reconcile',{preparationId:f.id});assert.equal(proof.status,'uncertain');
  assert.equal((await f.backend.dispatch('worktree-release',{preparationId:f.id,confirmed:true,expectedHash:proof.preparationHash})).code,'PREPARATION_UNCERTAIN');
});

test('a manually moved parent with stale Git registration and renamed branch remains uncertain',async t=>{
  const f=await failed(t);await f.command('git',['-C',f.worktree,'switch','-c',f.plan.branch]);
  await rename(dirname(f.worktree),join(f.root,'moved-parent'));await f.command('git',['-C',f.repo,'branch','-m',f.plan.branch,'preserved-work']);
  assert.equal((await f.backend.dispatch('worktree-reconcile',{preparationId:f.id})).status,'uncertain');
});

test('an ancestor replaced by a symlink cannot prove absence behind it',async t=>{
  const f=await failed(t);await f.command('git',['-C',f.repo,'worktree','unlock',f.worktree]);await f.command('git',['-C',f.repo,'worktree','remove',f.worktree]);
  await rmdir(dirname(f.worktree));const outside=join(f.root,'outside');await mkdir(outside);await symlink(outside,dirname(f.worktree));
  assert.equal((await f.backend.dispatch('worktree-reconcile',{preparationId:f.id})).status,'uncertain');
});

test('manual filesystem deletion needs prune advice and cannot release a stale Git registration',async t=>{
  const f=await failed(t);await rm(f.worktree,{recursive:true});
  const result=await f.backend.dispatch('worktree-reconcile',{preparationId:f.id});assert.equal(result.status,'uncertain');
  assert.ok(result.manualCleanup.some(command=>command.argv.includes('prune')));
});
