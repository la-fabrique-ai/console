import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fixture } from './helpers/backend-fixture.mjs';
import { previewFixture } from './helpers/repository-preview-fixture.mjs';
import { resolveRepositories } from '../src/repository-config.mjs';
import { createCommands } from '../src/commands.mjs';

async function poisoned(values,action) {
  const before=Object.fromEntries(Object.keys(values).map(key=>[key,process.env[key]]));
  Object.assign(process.env,values);
  try{return await action();}finally{for(const [key,value] of Object.entries(before))if(value===undefined)delete process.env[key];else process.env[key]=value;}
}

test('defaultGit cannot validate a non-Git directory using an inherited foreign GIT_DIR',async t=>{
  const f=await fixture(t),path=join(f.root,'non-git');await mkdir(path);
  const config=structuredClone(f.config);config.projects[0].repo=path;
  await poisoned({GIT_DIR:join(f.repo,'.git'),GIT_WORK_TREE:path},async()=>{
    await assert.rejects(resolveRepositories(config),{code:'INVALID_CONFIG'});
  });
});

test('the shared Git command adapter does not inherit an overriding Git repository',async t=>{
  const f=await fixture(t),path=join(f.root,'non-git');await mkdir(path);
  const {git}=createCommands({exec:f.command});
  await poisoned({GIT_DIR:join(f.repo,'.git'),GIT_WORK_TREE:path},async()=>{
    await assert.rejects(git(path,['rev-parse','--show-toplevel']),{code:'GIT_ERROR'});
  });
});

test('a direct Git invocation uses the same isolated environment as the Git adapter',async t=>{
  const f=await fixture(t),path=join(f.root,'non-git');await mkdir(path);
  const {invoke}=createCommands({exec:f.command});
  await poisoned({GIT_DIR:join(f.repo,'.git'),GIT_WORK_TREE:path},async()=>{
    await assert.rejects(invoke('git',['-C',path,'rev-parse','--show-toplevel']),error=>error.code===128);
  });
});

test('preview roots and identity ignore all inherited Git overrides and disable optional locks',async t=>{
  const f=await previewFixture(t),path=join(f.paths.alpha.app,'nested');await mkdir(path);
  f.config.projects[0].repos.find(r=>r.key==='app').path=path;await f.write('config.json',f.config);
  await poisoned({GIT_DIR:join(f.repo,'.git'),GIT_WORK_TREE:path,GIT_COMMON_DIR:join(f.repo,'.git'),GIT_INDEX_FILE:join(f.root,'injected-index'),GIT_CEILING_DIRECTORIES:f.root,GIT_OPTIONAL_LOCKS:'1',GIT_TERMINAL_PROMPT:'1',GIT_UNKNOWN_OVERRIDE:'ignored'},async()=>{
    assert.equal((await f.preview(f.ticket('alpha',['app']))).code,'REPO_NOT_ROOT');
  });
  for(const {options} of f.commands) {
    assert.deepEqual(Object.keys(options.env).filter(key=>key.startsWith('GIT_')).sort(),['GIT_OPTIONAL_LOCKS','GIT_TERMINAL_PROMPT']);
    assert.equal(options.env.GIT_OPTIONAL_LOCKS,'0');assert.equal(options.env.GIT_TERMINAL_PROMPT,'0');
  }
});
