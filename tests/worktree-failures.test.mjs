import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile,readFile,mkdir,access,lstat,rename } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBackend } from '../src/backend.mjs';
import { worktreeFixture } from './helpers/worktree-fixture.mjs';
import { groupAlive } from '../src/git-process-group.mjs';

import { withFakeHerdr } from './helpers/fake-herdr.mjs';
const wait=async predicate=>{const end=Date.now()+4000;while(!await predicate()&&Date.now()<end)await new Promise(resolve=>setTimeout(resolve,10));assert.ok(await predicate(),'Fixture checkpoint was not reached');};
async function killGroup(pgid) {try{process.kill(-pgid,'SIGKILL');}catch(error){if(error.code!=='ESRCH')throw error;}await wait(()=>!groupAlive(pgid));}

test('a clean checkout failure leaves no orphan development branch and retains its reservation',async t=>{
  const f=await worktreeFixture(t),script=join(f.root,'fail-filter.mjs');await writeFile(script,'process.exit(1);\n');
  await writeFile(join(f.repo,'.gitattributes'),'*.bad filter=fixture\n');await writeFile(join(f.repo,'content.bad'),'fixture');
  await f.command('git',['-C',f.repo,'config','filter.fixture.clean','cat']);
  await f.command('git',['-C',f.repo,'config','filter.fixture.smudge',process.execPath+' '+script]);
  await f.command('git',['-C',f.repo,'config','filter.fixture.required','true']);
  await f.command('git',['-C',f.repo,'add','.gitattributes','content.bad']);await f.commit(f.repo,'fixture filter');
  const plan=await f.plan(),result=await f.prepare(plan);assert.equal(result.status,'failed-certain');
  assert.equal((await f.command('git',['-C',f.repo,'for-each-ref','--format=%(refname)','refs/heads/tracker/one'])).stdout.trim(),'');
  const state=await f.read('workspace-state.json');assert.equal(state.attempts[0].status,'failed-certain');
});

test('unsafe Tracker branch spellings fall back even when check-ref-format accepts them',async t=>{
  const f=await worktreeFixture(t);
  for(const name of ['@','refs/heads/zz','main','.hidden','nested//name','@{-1}']) {
    f.issues.get('one').branchName=name;const plan=await f.plan();assert.equal(plan.status,'planned');assert.equal(plan.branchSource,'fallback');
  }
});

test('case-insensitive branch collisions are refused before any creation',async t=>{
  const f=await worktreeFixture(t);await f.command('git',['-C',f.repo,'branch','Tracker/One']);
  assert.equal((await f.plan()).code,'BRANCH_COLLISION');
});

test('a preexisting tracking-ref lock stays untouched while an object-only observation succeeds',async t=>{
  const f=await worktreeFixture(t),path=join(f.repo,'.git','refs','remotes','origin','main.lock');await writeFile(path,'user-owned-lock');
  const result=await f.plan();assert.equal(result.status,'planned');assert.equal(result.base.verified,true);assert.equal(await readFile(path,'utf8'),'user-owned-lock');
});

test('overlong workspace paths are refused with an explicit code',async t=>{
  const f=await worktreeFixture(t);f.config.worktreesRoot=join(f.root,'x'.repeat(1000));await f.write('config.json',f.config);
  assert.equal((await f.plan()).code,'WORKTREE_PATH_TOO_LONG');
});

test('a crash after Git before publishing state is adopted by proof without another checkout',async t=>{
  const f=await worktreeFixture(t),backend=createBackend(withFakeHerdr({root:f.home,tracker:f.tracker,exec:f.exec,workspaceOptions:{workerPath:fileURLToPath(new URL('./helpers/worktree-paused-worker.mjs',import.meta.url)),alertAfterMs:100}},'/fixture/forbidden-hc'));
  const plan=await backend.dispatch('worktree-plan',{issueId:'one',tool:'codex',role:'dev'});
  const running=await backend.dispatch('worktree-prepare',{planId:plan.planId});assert.equal(running.status,'creating');
  const id=running.preparationId,attempt=(await f.read('workspace-state.json')).attempts[0],group=attempt.worker.pgid;
  try {
    await wait(async()=>{try{await access(join(f.home,'after-git-'+id));return true;}catch{return false;}});
    process.kill(attempt.worker.pid,'SIGKILL');await wait(()=>!groupAlive(group));
    const result=await f.backend.dispatch('worktree-reconcile',{preparationId:id});assert.equal(result.status,'prepared');
    const reused=await f.prepare(plan);assert.equal(reused.status,'prepared');assert.equal(reused.preparationId,id);
    assert.equal((await f.command('git',['-C',f.repo,'worktree','list','--porcelain'])).stdout.match(/^worktree /gm).length,2);
  }finally{if(groupAlive(group))await killGroup(group);}
});

test('preparation never changes source HEAD, main, index or working files',async t=>{
  const f=await worktreeFixture(t),paths=[join(f.repo,'.git','HEAD'),join(f.repo,'.git','refs','heads','main'),join(f.repo,'.git','index')];
  const snapshot=async()=>Promise.all(paths.map(async path=>{try{const info=await lstat(path);return {bytes:await readFile(path),ino:info.ino,mtimeMs:info.mtimeMs};}catch(error){if(error.code==='ENOENT')return null;throw error;}}));
  const before=await snapshot();assert.equal((await f.prepare(await f.plan())).status,'prepared');assert.deepEqual(await snapshot(),before);
});

test('a prepared workspace is not adopted after its recorded parent directory is replaced',async t=>{
  const f=await worktreeFixture(t),result=await f.prepare(await f.plan()),old=join(f.root,'old-managed');
  await rename(f.worktreesRoot,old);await mkdir(f.worktreesRoot);await rename(join(old,'fixture'),join(f.worktreesRoot,'fixture'));
  const proof=await f.backend.dispatch('worktree-reconcile',{preparationId:result.preparationId});
  assert.equal(proof.status,'uncertain');assert.ok(proof.manualCleanup.every(command=>!command.argv.includes('remove')&&!command.argv.includes('unlock')));
});

test('cleanup instructions cannot unlock or remove a checkout whose ownership marker changed',async t=>{
  const f=await worktreeFixture(t),result=await f.prepare(await f.plan());
  await f.command('git',['-C',f.repo,'worktree','unlock',result.preparation.worktree]);
  await f.command('git',['-C',f.repo,'worktree','lock','--reason','user-owned',result.preparation.worktree]);
  const proof=await f.backend.dispatch('worktree-reconcile',{preparationId:result.preparationId});
  assert.equal(proof.status,'uncertain');assert.ok(proof.manualCleanup.every(command=>!command.argv.includes('remove')&&!command.argv.includes('unlock')));
});
