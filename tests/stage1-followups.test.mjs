import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile,writeFile,stat } from 'node:fs/promises';
import { join } from 'node:path';
import { observeBase } from '../src/workspace-git.mjs';
import { worktreeFixture } from './helpers/worktree-fixture.mjs';
import { verifyReference,readSources } from '../scripts/interface-reference.mjs';

test('a blobless clone with a new remote tree requires manual materialization instead of another preview',async t=>{
  const f=await worktreeFixture(t);
  await f.command('git',['-C',f.remote,'config','uploadpack.allowFilter','true']);
  const clone=join(f.root,'blobless');await f.command('git',['clone','--filter=blob:none','file://'+f.remote,clone]);
  await writeFile(join(f.peer,'new-file'),'new remote blob');await f.command('git',['-C',f.peer,'add','new-file']);
  await f.commit(f.peer,'remote tree');await f.publish();
  const blob=(await f.command('git',['-C',f.peer,'rev-parse','HEAD:new-file'])).stdout.trim();
  f.config.projects[0].repos[0].path=clone;await f.write('config.json',f.config);
  const plan=await f.plan({baseSource:'origin'});assert.equal(plan.status,'planned');
  await assert.rejects(f.command('git',['-C',clone,'--no-lazy-fetch','cat-file','-e',blob]));
  const result=await f.prepare(plan,{confirmation:{manifestHash:plan.manifestHash}});
  assert.equal(result.preparation.errorCode,'BASE_TREE_NOT_MATERIALIZED');
  await assert.rejects(stat(plan.worktree),{code:'ENOENT'});
  await assert.rejects(f.command('git',['-C',clone,'--no-lazy-fetch','cat-file','-e',blob]));
});

test('missing comparison objects are observed without lazy fetch and yield an unknown relation',async()=>{
  const sha='a'.repeat(40),remote='b'.repeat(40),calls=[];
  const git=async(_repo,args)=>{calls.push(args);if(args.includes('rev-list'))throw new Error('missing object');if(args.includes('--is-shallow-repository'))return 'false';if(args.includes('remote'))return 'origin';return sha;};
  const result=await observeBase({git,invoke:async()=>{throw {code:1};},repo:'/fixture',mainBranch:'main',runFetch:async()=>({ok:true,terminated:true,remoteSha:remote})});
  assert.equal(result.relation,'unknown');assert.equal(result.verification.reason,'relation-unavailable');assert.equal(result.ahead,null);
  assert.equal(calls.find(args=>args.includes('rev-list'))[0],'--no-lazy-fetch');
});

test('an unavailable review commit is checked without lazy fetch and yields a typed refusal',async()=>{
  const sha='a'.repeat(40);let checked;
  const git=async(_repo,args)=>{if(args.includes('cat-file')){checked=args;throw new Error('missing commit');}if(args.includes('--is-shallow-repository'))return 'false';if(args.includes('remote'))return '';return sha;};
  await assert.rejects(observeBase({git,invoke:async()=>{},repo:'/fixture',mainBranch:'main',reviewCommit:sha}),{code:'REVIEW_COMMIT_UNAVAILABLE'});assert.equal(checked[0],'--no-lazy-fetch');
});

test('the public code catalogue specifies and validates channels including mixed confirmation and guarded fetch refusal',async()=>{
  const reference=JSON.parse(await readFile(new URL('../docs/backend-interface.json',import.meta.url),'utf8'));
  const sources=await readSources();
  for(const item of Object.values(reference.codes))assert.ok(['error','refusal','both','warning','reason','worker'].includes(item.channel));
  assert.equal(reference.codes.CONFIRMATION_REQUIRED.channel,'both');assert.equal(reference.codes.FETCH_INTENT_NOT_FOUND.channel,'refusal');
  const invalid=structuredClone(reference);delete invalid.codes.CONFIRMATION_REQUIRED.channel;
  assert.throws(()=>verifyReference(invalid,sources),/channel/);
});
