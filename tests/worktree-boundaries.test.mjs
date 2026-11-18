import test from 'node:test';
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { writeFile,readFile,access } from 'node:fs/promises';
import { join } from 'node:path';
import { createBackend } from '../src/backend.mjs';
import { withLock } from '../src/common.mjs';
import { supportsWorkspaceGit } from '../src/workspace-git.mjs';
import { worktreeFixture } from './helpers/worktree-fixture.mjs';

import { withFakeHerdr } from './helpers/fake-herdr.mjs';
test('review capacity is separate from a full development limit and bounded per project',async t=>{
  const f=await worktreeFixture(t);f.config.wip.maxParallelDevs=1;await f.write('config.json',f.config);
  assert.equal((await f.prepare(await f.plan())).status,'prepared');
  for(let i=0;i<3;i++)assert.equal((await f.prepare(await f.plan({role:'review',reviewCommit:f.base}))).status,'prepared');
  assert.equal((await f.prepare(await f.plan({role:'review',reviewCommit:f.base}))).code,'REVIEW_CAPACITY');
});

test('the registry lock remains free while refreshing a ticket from Tracker',async t=>{
  const f=await worktreeFixture(t);let signal,release;
  const entered=new Promise(resolve=>signal=resolve),gate=new Promise(resolve=>release=resolve);
  const backend=createBackend(withFakeHerdr({root:f.home,exec:f.exec,tracker:{...f.tracker,detail:async(...args)=>{signal();await gate;return f.tracker.detail(...args);}}},'/fixture/forbidden-hc'));
  const request=backend.dispatch('worktree-plan',{issueId:'one',tool:'codex',role:'dev'});
  try{await entered;await withLock(f.home,async()=>{});}finally{release();}
  assert.equal((await request).status,'planned');
});

test('a worktrees root inside the source repository is refused',async t=>{
  const f=await worktreeFixture(t);f.config.worktreesRoot=join(f.repo,'managed');await f.write('config.json',f.config);
  assert.equal((await f.plan()).code,'WORKTREES_ROOT_UNSAFE');await assert.rejects(access(f.config.worktreesRoot),{code:'ENOENT'});
});

test('unsupported Git capabilities fail explicitly before creation',async()=>{
  await assert.rejects(supportsWorkspaceGit(async(_program,args)=>({stdout:args.includes('--version')?'git version 2.0.0':'usage: unsupported flags'}),'/unused'),{code:'GIT_UNSUPPORTED'});
});

test('real preparation strips inherited Git repository, worktree, index and configuration overrides',async t=>{
  const f=await worktreeFixture(t),plan=await f.plan(),job=join(f.root,'poisoned-client.json'),index=join(f.peer,'.git','index');
  const before=await readFile(index);
  await writeFile(job,JSON.stringify({root:f.home,issues:[...f.issues.values()],action:'worktree-prepare',input:{planId:plan.planId}}));
  const child=fork(new URL('./helpers/worktree-client-process.mjs',import.meta.url),[job],{silent:true,env:{...process.env,GIT_DIR:join(f.peer,'.git'),GIT_WORK_TREE:f.peer,GIT_INDEX_FILE:join(f.root,'poison-index'),GIT_CONFIG_COUNT:'1',GIT_CONFIG_KEY_0:'core.bare',GIT_CONFIG_VALUE_0:'true'}});
  try {
    await once(child,'message');const done=once(child,'message');child.send('go');const [{result,error}]=await done;
    assert.equal(error,undefined);assert.equal(result.status,'prepared');assert.equal(result.preparation.repo,f.repo);
    assert.equal((await f.command('git',['-C',result.preparation.worktree,'rev-parse','--git-common-dir'])).stdout.trim(),join(f.repo,'.git'));
    assert.deepEqual(await readFile(index),before);await assert.rejects(access(join(f.root,'poison-index')),{code:'ENOENT'});
    assert.equal((await f.command('git',['-C',f.peer,'worktree','list','--porcelain'])).stdout.match(/^worktree /gm).length,1);
  }finally{if(child.exitCode===null){const exited=once(child,'exit');child.kill('SIGKILL');await exited;}}
});
