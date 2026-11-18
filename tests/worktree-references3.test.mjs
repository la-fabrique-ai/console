import test from 'node:test';
import assert from 'node:assert/strict';
import { rm,symlink,writeFile,readFile,readdir,lstat,readlink,access,mkdir,rename } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBackend } from '../src/backend.mjs';
import { worktreeFixture } from './helpers/worktree-fixture.mjs';

const refs=async f=>(await f.command('git',['-C',f.repo,'for-each-ref','--format=%(refname) %(objectname) %(symref)'])).stdout;
async function referenceFiles(repo) {
  const snapshot={};
  async function visit(path,key) {
    let info;try{info=await lstat(path);}catch(error){if(error.code==='ENOENT')return;throw error;}
    if(info.isSymbolicLink())snapshot[key]={link:await readlink(path)};
    else if(info.isDirectory())for(const name of (await readdir(path)).sort())await visit(join(path,name),key+'/'+name);
    else snapshot[key]=(await readFile(path)).toString('hex');
  }
  for(const name of ['refs','packed-refs','HEAD','config','logs','FETCH_HEAD'])await visit(join(repo,'.git',name),name);
  return snapshot;
}
for(const arrangement of ['ordinary','local-symbolic-branch','physical-reference-directory','physical-directory-diverged','configured-refspecs'])test(`remote observation preserves every source reference with ${arrangement}`,async t=>{
  const f=await worktreeFixture(t),remoteSha=await f.commit(f.peer,'remote advance');await f.publish();
  await f.command('git',['-C',f.repo,'tag','preserved-tag']);
  await f.command('git',['-C',f.repo,'update-ref','refs/notes/preserved',f.base]);
  await f.command('git',['-C',f.repo,'pack-refs','--all']);
  if(arrangement==='local-symbolic-branch')await f.command('git',['-C',f.repo,'symbolic-ref','refs/heads/user-work','refs/remotes/origin/main']);
  if(arrangement==='physical-directory-diverged')await f.commit(f.repo,'unpublished local work');
  if(arrangement.startsWith('physical-')) {
    await f.command('git',['-C',f.repo,'checkout','--detach']);
    // I2: the loose tracking-ref directory physically aliases local branches.
    await rm(join(f.repo,'.git','refs','remotes','origin'),{recursive:true,force:true});
    await mkdir(join(f.repo,'.git','refs','remotes'),{recursive:true});
    await symlink('../heads',join(f.repo,'.git','refs','remotes','origin'));
  }
  if(arrangement==='configured-refspecs') {
    await f.command('git',['-C',f.repo,'config','remote.origin.fetch','+refs/heads/*:refs/heads/*']);
    await f.command('git',['-C',f.repo,'config','remote.origin.mirror','true']);
    await f.command('git',['-C',f.repo,'config','fetch.prune','true']);
    await f.command('git',['-C',f.repo,'config','fetch.pruneTags','true']);
    await f.command('git',['-C',f.repo,'config','remote.origin.tagOpt','--tags']);
  }
  const before=await refs(f),files=await referenceFiles(f.repo),result=await f.plan();
  assert.equal(result.status,'planned');assert.equal(result.base.verified,true);assert.equal(result.base.remoteSha,remoteSha);
  assert.equal(await refs(f),before,'An observation must not publish any Git reference, including indirect local branches.');
  assert.deepEqual(await referenceFiles(f.repo),files,'No packed ref, reflog, HEAD, config or FETCH_HEAD may be written.');
  if(arrangement==='local-symbolic-branch')assert.equal((await f.command('git',['-C',f.repo,'rev-parse','user-work'])).stdout.trim(),f.base);
  assert.equal(result.base.fetch.writes.some(kind=>kind.includes('ref')),false);
});

test('the preview identifies the remote snapshot and date without claiming to update the cached tracking ref',async t=>{
  const f=await worktreeFixture(t),remoteSha=await f.commit(f.peer,'remote snapshot');await f.publish();
  const before=Date.now(),plan=await f.plan({baseSource:'origin'}),after=Date.now();
  assert.equal(plan.status,'planned');assert.equal(plan.base.fetch.observedSha,remoteSha);
  const observed=Date.parse(plan.base.fetch.observedAt);assert.ok(observed>=before&&observed<=after);
  assert.equal(plan.base.fetch.trackingRefUpdated,false);
  assert.equal(plan.base.options.find(option=>option.source==='origin').sha,remoteSha);
  assert.equal((await f.command('git',['-C',f.repo,'rev-parse','origin/main'])).stdout.trim(),f.base);
  const result=await f.prepare(plan,{confirmation:{manifestHash:plan.manifestHash}});assert.equal(result.status,'prepared');
  assert.equal((await f.command('git',['-C',result.preparation.worktree,'rev-parse','HEAD'])).stdout.trim(),remoteSha);
  assert.equal((await f.command('git',['-C',f.repo,'rev-parse','origin/main'])).stdout.trim(),f.base);
});

for(const loss of ['blob','gc'])test(`a remote snapshot after ${loss==='gc'?'gc --prune=now':'a missing blob'} refuses before claiming a checkout directory`,async t=>{
  const f=await worktreeFixture(t);await writeFile(join(f.peer,'payload'),'remote-only content');await f.command('git',['-C',f.peer,'add','payload']);
  const remoteSha=await f.commit(f.peer,'snapshot with content');await f.publish();
  await writeFile(join(f.home,'object-loss-mode'),loss);
  const backend=createBackend({root:f.home,exec:f.exec,tracker:f.tracker,workspaceOptions:{workerPath:fileURLToPath(new URL('./helpers/worktree-missing-object-worker3.mjs',import.meta.url))}});
  const plan=await backend.dispatch('worktree-plan',{issueId:'one',tool:'codex',role:'dev',baseSource:'origin'});assert.equal(plan.base.chosenSha,remoteSha);
  const result=await backend.dispatch('worktree-prepare',{planId:plan.planId,confirmation:{manifestHash:plan.manifestHash}});
  await access(join(f.home,'missing-object-checkpoint'));
  const attempt=(await f.read('workspace-state.json')).attempts[0];
  assert.equal(attempt.errorCode,'REMOTE_BASE_UNAVAILABLE');assert.equal(result.status,'failed-certain');
  await assert.rejects(access(plan.worktree),{code:'ENOENT'});
  assert.equal(attempt.claimedPath,undefined,'Incomplete closure must be refused before claiming the directory.');
});

for(const protocol of ['0','2'])test(`remote movement between query and download uses one observed SHA with protocol v${protocol}`,async t=>{
  const f=await worktreeFixture(t),announced=await f.commit(f.peer,'announced commit');await f.publish();
  const later=await f.commit(f.peer,'later commit');await f.publish();
  await f.command('git',['--git-dir',f.remote,'update-ref','refs/heads/main',announced]);
  await f.command('git',['-C',f.repo,'config','protocol.version',protocol]);
  const script=join(f.root,'advance-after-query.mjs'),checkpoint=join(f.root,'remote-query-count');
  await writeFile(script,`import fs from 'node:fs';import {spawnSync} from 'node:child_process';const marker=${JSON.stringify(checkpoint)};const count=fs.existsSync(marker)?Number(fs.readFileSync(marker,'utf8')):0;fs.writeFileSync(marker,String(count+1));const served=spawnSync('git',['upload-pack',...process.argv.slice(2)],{stdio:'inherit'});if(count===0){const moved=spawnSync('git',['--git-dir',${JSON.stringify(f.remote)},'update-ref','refs/heads/main',${JSON.stringify(later)},${JSON.stringify(announced)}],{stdio:'ignore'});if(moved.status!==0)process.exit(1);}process.exit(served.status??1);\n`);
  await f.command('git',['-C',f.repo,'config','remote.origin.uploadpack',process.execPath+' '+script]);
  const result=await f.plan();assert.equal(result.status,'planned');assert.ok(Number(await readFile(checkpoint,'utf8'))>=2);
  if(protocol==='0') {
    assert.equal(result.base.fetch.status,'failed');assert.equal(result.base.verified,false);assert.equal(result.base.remoteSha,null);
    assert.equal(result.base.options.some(option=>option.source==='origin'),false);
  }else {assert.equal(result.base.fetch.status,'succeeded');assert.equal(result.base.remoteSha,announced);assert.notEqual(result.base.remoteSha,later);}
});

test('offline observation does not substitute a stale tracking SHA for a remote observation',async t=>{
  const f=await worktreeFixture(t);await rename(f.remote,f.remote+'-offline');
  const before=await refs(f),result=await f.plan();assert.equal(result.status,'planned');
  assert.equal(result.base.fetch.status,'failed');assert.equal(result.base.remoteSha,null);assert.equal(result.base.verified,false);
  assert.equal(await refs(f),before);assert.equal(result.base.options.some(option=>option.source==='origin'),false);
});

test('a shallow source never offers a verified remote relation or an origin base',async t=>{
  const f=await worktreeFixture(t);await f.commit(f.peer,'first advance');await f.publish();
  const repo=join(f.root,'shallow');await f.command('git',['clone','--depth=1','file://'+f.remote,repo]);
  f.config.projects[0].repos[0].path=repo;await f.write('config.json',f.config);
  await f.commit(f.peer,'second advance');await f.publish();const shallow=await readFile(join(repo,'.git','shallow'));
  const result=await f.plan();assert.equal(result.status,'planned');assert.equal(result.base.verified,false);assert.equal(result.base.relation,'unknown');
  assert.equal(result.base.options.some(option=>option.source==='origin'),false);assert.equal(result.needsConfirmation,true);
  assert.equal((await f.plan({baseSource:'origin'})).code,'REMOTE_BASE_UNAVAILABLE');assert.deepEqual(await readFile(join(repo,'.git','shallow')),shallow);
});
