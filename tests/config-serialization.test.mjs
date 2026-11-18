import test from 'node:test';
import assert from 'node:assert/strict';
import { rename,symlink,readFile,readdir,access } from 'node:fs/promises';
import { join } from 'node:path';
import { fixture,issue } from './helpers/backend-fixture.mjs';
import { configV2 } from './helpers/config-v2-fixture.mjs';
import { createDurableStorage } from '../src/durable-storage.mjs';

async function maskedRepository(f) {
  const target=join(f.root,'lin_api_docs'),alias=join(f.root,'safe-alias');
  await rename(f.repo,target);await symlink(target,alias);return alias;
}
for(const version of [1,2])test(`V${version} save refuses a resolved path that would be redacted before any publication`,async t=>{
  const f=await fixture(t),alias=await maskedRepository(f);
  let config;
  if(version===1){config=structuredClone(f.config);config.projects[0].repo=alias;}
  else{config=configV2();config.projects[0].repos.splice(1);config.projects[0].repos[0].path=alias;}
  await f.write('config.json',config);
  const {revision}=await f.backend.dispatch('read-config'),before=await readFile(join(f.home,'config.json'));
  await assert.rejects(f.backend.dispatch('config-save',{config,baseRevision:revision}),{code:'INVALID_CONFIG'});
  assert.deepEqual(await readFile(join(f.home,'config.json')),before);
  assert.ok(!(await readdir(f.home)).includes('backups'));
});

test('migration rejects an unsafe resolved path before backup or prepared journal',async t=>{
  const f=await fixture(t),alias=await maskedRepository(f);f.config.projects[0].repo=alias;await f.write('config.json',f.config);
  const before=await readFile(join(f.home,'config.json'));
  await assert.rejects(f.backend.dispatch('config-migrate',{confirmed:true,worktreesRoot:join(f.root,'worktrees')}),{code:'MIGRATION_UNSUPPORTED_FIELDS'});
  assert.deepEqual(await readFile(join(f.home,'config.json')),before);
  const files=await readdir(f.home);assert.ok(!files.includes('backups'));assert.ok(!files.includes('migrations'));
});

test('durable serialization itself refuses to redact a document silently',async t=>{
  const f=await fixture(t),path=join(f.home,'new-document.json');
  await assert.rejects(createDurableStorage().write(path,{repo:'/example/lin_api_docs'}),{code:'INVALID_CONFIG'});
  await assert.rejects(access(path),{code:'ENOENT'});
});

test('QA resolves the same native casing as the saved session on an insensitive filesystem',async t=>{
  const f=await fixture(t),variant=join(f.root,'RePo');
  try{await access(variant);}catch{t.skip('Fixture volume is case sensitive');return;}
  const {session}=await f.backend.dispatch('launch',{issueId:issue.id,tool:'codex'});
  f.config.projects[0].repo=variant;await f.write('config.json',f.config);
  assert.equal((await f.backend.dispatch('qa',{sessionId:session.id})).run.status,'passed');
});
