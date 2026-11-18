import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile,readFile,access } from 'node:fs/promises';
import { join } from 'node:path';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { worktreeFixture } from './helpers/worktree-fixture.mjs';
import { createBackend } from '../src/backend.mjs';
import { createWorkspaceState } from '../src/workspace-state.mjs';
import { groupAlive } from '../src/git-process-group.mjs';
import { processBirth } from '../src/process-identity.mjs';
import { withLock } from '../src/common.mjs';
import { createFetchRegistry } from '../src/fetch-registry.mjs';

const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(predicate){const end=Date.now()+7000;while(!await predicate()&&Date.now()<end)await delay(10);assert.ok(await predicate(),'Fetch checkpoint missing');}
async function slow(f) {
  const script=join(f.root,'upload-wait.mjs'),metadata=join(f.root,'fetch-owner.json'),gate=join(f.root,'fetch-gate'),starts=join(f.root,'fetch-starts');
  await writeFile(script,`import fs from 'node:fs';import {execFileSync} from 'node:child_process';const owner=Number(execFileSync('/bin/ps',['-p',String(process.pid),'-o','pgid='],{encoding:'utf8'}).trim());const birth=execFileSync('/bin/ps',['-p',String(owner),'-o','lstart='],{encoding:'utf8',env:{...process.env,LC_ALL:'C',TZ:'UTC'}}).trim();fs.appendFileSync(${JSON.stringify(starts)},'start\\n');const pending=${JSON.stringify(metadata)}+'.'+process.pid+'.tmp';fs.writeFileSync(pending,JSON.stringify({owner,birth}));fs.renameSync(pending,${JSON.stringify(metadata)});setInterval(()=>{if(fs.existsSync(${JSON.stringify(gate)}))process.exit(1);},10);\n`);
  await f.command('git',['-C',f.repo,'config','remote.origin.uploadpack',process.execPath+' '+script]);
  return {gate,starts,metadata,identity:async()=>{await until(async()=>{try{await access(metadata);return true;}catch{return false;}});return JSON.parse(await readFile(metadata,'utf8'));}};
}

test('SIGKILL of the fetch supervisor leaves a durable lease and blocks another fetch until the orphan group ends',async t=>{
  const f=await worktreeFixture(t),s=await slow(f),backend=createBackend({root:f.home,exec:f.exec,tracker:f.tracker,workspaceOptions:{fetchTimeoutMs:1000}});
  const request=backend.dispatch('worktree-plan',{issueId:'one',tool:'codex',role:'dev'}),identity=await s.identity();
  try {
    assert.equal(await processBirth(identity.owner),identity.birth);process.kill(identity.owner,'SIGKILL');
    assert.equal((await request).code,'FETCH_TERMINATION_UNCONFIRMED');assert.equal(groupAlive(identity.owner),true);
    const blocked=await backend.dispatch('worktree-plan',{issueId:'two',tool:'codex',role:'dev'});assert.equal(blocked.code,'FETCH_RECOVERY_REQUIRED');
    const pending=(await f.read('workspace-state.json')).fetches;assert.equal(pending.length,1);assert.equal(pending[0].worker.pgid,identity.owner);assert.ok(pending[0].worker.birth);assert.ok(pending[0].bootId);
    assert.equal((await readFile(s.starts,'utf8')).match(/start/g).length,1);
  }finally{await writeFile(s.gate,'finish');await until(()=>!groupAlive(identity.owner));}
  await f.command('git',['-C',f.repo,'config','--unset','remote.origin.uploadpack']);assert.equal((await f.plan()).status,'planned');
  assert.equal((await f.read('workspace-state.json')).fetches.length,0);
});

test('a tracking lock cannot hide the durable orphan identity and its recovery guidance',async t=>{
  const f=await worktreeFixture(t);await seed(f);await writeFile(join(f.repo,'.git','refs','remotes','origin','main.lock'),'fixture lock');
  const backend=createBackend({root:f.home,exec:f.exec,tracker:f.tracker,workspaceOptions:{fetchProof:{bootId:async()=> 'old-boot',birth:async()=> 'old-birth',alive:()=>true,waitMs:0}}});
  const result=await backend.dispatch('worktree-plan',{issueId:'one',tool:'codex',role:'dev'});
  assert.equal(result.code,'FETCH_RECOVERY_REQUIRED');assert.ok(result.message.includes('876543'));
});

async function seed(f,worker={pid:876543,pgid:876543,nonce:'old',birth:'old-birth'}) {
  await createWorkspaceState(f.home).update(state=>{state.fetches=[{id:'old-fetch',gitCommonDir:join(f.repo,'.git'),status:'uncertain',bootId:'old-boot',owner:{pid:876542,birth:'parent-birth'},ownerActive:false,worker,createdAt:new Date().toISOString()}];});
}
for(const mode of ['EPERM','same-birth','reused-birth','new-boot'])test(`fetch intent proof ${mode} is conservative or clears only a proven old identity`,async t=>{
  const f=await worktreeFixture(t);await seed(f);
  const proof={bootId:async()=>mode==='new-boot'?'new-boot':'old-boot',birth:async()=>mode==='reused-birth'?'different-birth':'old-birth',alive:()=>{if(mode==='EPERM')throw Object.assign(new Error('fixture denial'),{code:'EPERM'});return true;},waitMs:0};
  const backend=createBackend({root:f.home,exec:f.exec,tracker:f.tracker,workspaceOptions:{fetchProof:proof}});
  const result=await backend.dispatch('worktree-plan',{issueId:'one',tool:'codex',role:'dev'});
  if(['EPERM','same-birth'].includes(mode)){assert.equal(result.code,'FETCH_RECOVERY_REQUIRED');assert.equal((await f.read('workspace-state.json')).fetches[0].id,'old-fetch');}
  else {assert.equal(result.status,'planned');assert.equal((await f.read('workspace-state.json')).fetches.length,0);}
});

async function client(f,options,name) {
  const file=join(f.root,name+'.json');await writeFile(file,JSON.stringify({root:f.home,issues:[...f.issues.values()],action:'worktree-plan',input:{issueId:'one',tool:'codex',role:'dev'},workspaceOptions:options}));
  const child=fork(new URL('./helpers/worktree-client-process.mjs',import.meta.url),[file],{silent:true}),messages=[];child.on('message',m=>messages.push(m));
  await until(()=>messages.some(m=>m.ready));return {child,done:async()=>{await until(()=>messages.some(m=>m.done));return messages.find(m=>m.done);}};
}
async function stop(child){if(child.exitCode===null&&child.signalCode===null){const end=once(child,'exit');child.kill('SIGKILL');await end;}}
test('two real previews wait boundedly for the same Git and the busy refusal is replayable',async t=>{
  const f=await worktreeFixture(t),s=await slow(f),a=await client(f,{fetchTimeoutMs:6000},'a');let b,identity;
  try {
    a.child.send('go');identity=await s.identity();await withLock(f.home,async()=>{});
    b=await client(f,{fetchTimeoutMs:1000,fetchWaitMs:200},'b');b.child.send('go');const outcome=await b.done();assert.equal(outcome.result?.code,'FETCH_BUSY',JSON.stringify(outcome));
    assert.equal((await readFile(s.starts,'utf8')).match(/start/g).length,1);
    await writeFile(s.gate,'finish');assert.equal((await a.done()).result.status,'planned');
    await until(()=>!groupAlive(identity.owner));await f.command('git',['-C',f.repo,'config','--unset','remote.origin.uploadpack']);assert.equal((await f.plan()).status,'planned');
  }finally{await writeFile(s.gate,'finish');if(identity)await until(()=>!groupAlive(identity.owner));await stop(a.child);if(b)await stop(b.child);}
});

for(const mode of ['intention','identity','go'])test(`parent SIGKILL at fetch ${mode} is recoverable without starting a second live fetch`,async t=>{
  const f=await worktreeFixture(t),s=mode==='go'?await slow(f):null,job=join(f.root,'checkpoint.json'),messages=[];
  await writeFile(job,JSON.stringify({root:f.home,common:join(f.repo,'.git'),repo:f.repo,mode,args:mode==='go'?['fetch','--refmap=','--no-write-fetch-head','origin','refs/heads/main:refs/remotes/origin/main']:['--version']}));
  const child=fork(new URL('./helpers/fetch-checkpoint-process.mjs',import.meta.url),[job],{silent:true});child.on('message',m=>messages.push(m));let worker;
  try {
    if(mode==='intention')await until(()=>messages.some(m=>m.stage==='intention'));
    else {await until(()=>messages.some(m=>m.stage==='identity'));worker=messages.find(m=>m.stage==='identity').worker;if(s)await s.identity();}
    const pending=(await f.read('workspace-state.json')).fetches;assert.equal(pending.length,1);
    if(worker)assert.equal(pending[0].worker.nonce,worker.nonce);else assert.equal(pending[0].worker,null);
    await stop(child);if(worker)await until(()=>!groupAlive(worker.pgid));
    if(s)await f.command('git',['-C',f.repo,'config','--unset','remote.origin.uploadpack']);
    assert.equal((await f.plan()).status,'planned');assert.equal((await f.read('workspace-state.json')).fetches.length,0);
  }finally{if(s)await writeFile(s.gate,'finish');await stop(child);if(worker)await until(()=>!groupAlive(worker.pgid));}
});

test('a synchronous pre-spawn failure clears its intention without touching another generation',async t=>{
  const f=await worktreeFixture(t),store=createWorkspaceState(f.home),registry=createFetchRegistry({store});
  await assert.rejects(registry.run(join(f.repo,'.git'),()=>{throw new Error('fixture pre-spawn failure');}),/fixture pre-spawn failure/);
  assert.equal((await store.read()).value.fetches.length,0);assert.equal((await f.plan()).status,'planned');
});

test('a registry from before fetch intentions is read without migration or loss of plans',async t=>{
  const f=await worktreeFixture(t),first=await f.plan(),store=createWorkspaceState(f.home);await store.update(state=>{delete state.fetches;});
  assert.equal((await f.plan({issueId:'two'})).status,'planned');const value=(await store.read()).value;
  assert.equal(value.version,1);assert.ok(value.plans.some(plan=>plan.planId===first.planId));assert.deepEqual(value.fetches,[]);
});
