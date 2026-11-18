import test from 'node:test';
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { writeFile,mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { worktreeFixture } from './helpers/worktree-fixture.mjs';

async function client(t,f,input,index) {
  const path=join(f.root,`client-${index}.json`);
  await writeFile(path,JSON.stringify({root:f.home,issues:[...f.issues.values()],action:'worktree-prepare',input}));
  const child=fork(new URL('./helpers/worktree-client-process.mjs',import.meta.url),[path],{silent:true});
  const messages=[];child.on('message',message=>messages.push(message));
  t.after(()=>{if(child.exitCode===null)child.kill('SIGKILL');});
  const until=async key=>{const end=Date.now()+10000;while(!messages.some(m=>m[key])&&Date.now()<end)await new Promise(resolve=>setTimeout(resolve,5));const result=messages.find(m=>m[key]);assert.ok(result,JSON.stringify(messages));return result;};
  await until('ready');return {child,until};
}

test('two real clients cannot prepare two implementations in one Git lane',async t=>{
  const f=await worktreeFixture(t),a=await f.plan(),b=await f.plan({issueId:'two'});
  const clients=await Promise.all([client(t,f,{planId:a.planId},'a'),client(t,f,{planId:b.planId},'b')]);clients.forEach(c=>c.child.send('go'));
  const results=await Promise.all(clients.map(c=>c.until('done')));
  assert.equal(results.filter(r=>r.result?.status==='prepared').length,1,JSON.stringify(results));
  assert.ok(results.some(r=>['LANE_BUSY','PLAN_CHANGED'].includes(r.result?.code)),JSON.stringify(results));
});

test('two real clients asking for the same plan receive the same instance',async t=>{
  const f=await worktreeFixture(t),plan=await f.plan();
  const clients=await Promise.all([client(t,f,{planId:plan.planId},'a'),client(t,f,{planId:plan.planId},'b')]);clients.forEach(c=>c.child.send('go'));
  const results=await Promise.all(clients.map(c=>c.until('done')));
  assert.ok(results.every(r=>!r.error),JSON.stringify(results));
  const ids=results.map(r=>r.result.preparation?.preparationId??r.result.preparationId).filter(Boolean);
  assert.equal(new Set(ids).size,1,JSON.stringify(results));
  const reconciled=await f.backend.dispatch('worktree-reconcile',{preparationId:ids[0]});assert.equal(reconciled.status,'prepared');
});

test('a parallel lane approval names the exact occupants and cannot override ticket uniqueness',async t=>{
  const f=await worktreeFixture(t),first=await f.prepare(await f.plan()),plan=await f.plan({issueId:'two'});
  assert.equal((await f.prepare(plan,{confirmation:{manifestHash:plan.manifestHash,parallel:{reason:'Independent modules',occupantIds:[]}}})).code,'PARALLEL_CONFIRMATION_MISMATCH');
  const result=await f.prepare(plan,{confirmation:{manifestHash:plan.manifestHash,parallel:{reason:'Independent modules',occupantIds:[first.preparation.preparationId]}}});
  assert.equal(result.status,'prepared');
  const other=await f.plan({tool:'claude'});assert.equal(other.code,'TICKET_ALREADY_RESERVED');
});

test('capacity spans independent Git repositories and is never enlarged by parallel approval',async t=>{
  const f=await worktreeFixture(t);f.config.wip.maxParallelDevs=1;await f.write('config.json',f.config);
  await f.prepare(await f.plan());
  const second=join(f.root,'second');await mkdir(second);await f.command('git',['init','-b','main',second]);await f.commit(second,'fixture');
  f.config.projects[0].repos.push({key:'second',path:second,labels:['second'],mainBranch:'main',tests:{}});
  f.config.projects[0].repos[0].labels=['first'];await f.write('config.json',f.config);f.issues.get('two').labels=[{name:'second'}];
  const plan=await f.plan({issueId:'two'});
  const result=await f.prepare(plan,{confirmation:{manifestHash:plan.manifestHash}});assert.equal(result.code,'GLOBAL_CAPACITY');
});

test('release is explicit and keeps the checkout and branch for the user',async t=>{
  const f=await worktreeFixture(t),first=await f.prepare(await f.plan()),id=first.preparation.preparationId;
  assert.equal((await f.backend.dispatch('worktree-release',{preparationId:id})).code,'CONFIRMATION_REQUIRED');
  const proof=await f.backend.dispatch('worktree-reconcile',{preparationId:id});
  const released=await f.backend.dispatch('worktree-release',{preparationId:id,confirmed:true,expectedHash:proof.preparationHash});assert.equal(released.status,'released');
  assert.equal((await f.command('git',['-C',first.preparation.worktree,'rev-parse','HEAD'])).stdout.trim(),f.base);
  assert.equal((await f.command('git',['-C',f.repo,'rev-parse','tracker/one'])).stdout.trim(),f.base);
});

test('a legacy session resumed after stoppedAt is still counted conservatively',async t=>{
  const f=await worktreeFixture(t);await f.write('state.json',{version:1,sessions:[{id:'legacy',repo:f.repo,stoppedAt:'2026-11-06T08:00:00Z',launchAttemptAt:'2026-11-06T09:00:00Z',launchUncertain:false}]});
  assert.equal((await f.prepare(await f.plan())).code,'LEGACY_RESERVATION_UNKNOWN');
});
