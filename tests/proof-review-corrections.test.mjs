import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile,readFile,chmod,symlink,rm,utimes,mkdir } from 'node:fs/promises';
import { join,delimiter } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fixture,issue } from './helpers/backend-fixture.mjs';
import { captureCode } from '../src/proof-code.mjs';

const launch=f=>f.backend.dispatch('launch',{issueId:issue.id,tool:'codex'});
const proofs=(f,session)=>f.backend.dispatch('test-proofs',{sessionId:session.id});
const gitCommit=(f,cwd)=>f.command('git',['-C',cwd,'-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-m','fixture']);
const shellQuote=value=>"'"+value.replaceAll("'","'\\''")+"'";
async function waitFor(path) {
  const end=Date.now()+10000;
  while(Date.now()<end) {
    try{return await readFile(path,'utf8');}catch(error){if(error.code!=='ENOENT')throw error;}
    await new Promise(resolve=>setTimeout(resolve,10));
  }
  assert.fail('The fixture did not reach its barrier.');
}

test('an untracked symlink cannot share a fingerprint with an executable file containing its target',async t=>{
  const f=await fixture(t),name=join(f.repo,'n');await symlink('target-x',name);
  const link=await captureCode(f.repo);assert.ok(link.stateHash);
  await rm(name);await writeFile(name,'target-x');await chmod(name,0o755);
  const file=await captureCode(f.repo);assert.ok(file.stateHash);
  assert.notEqual(file.stateHash,link.stateHash);
});

test('capturing a tracked file never executes its configured Git clean filter',async t=>{
  const f=await fixture(t),marker=join(f.root,'filter-ran'),script=join(f.root,'filter.cjs');
  await writeFile(script,`const fs=require('fs');const value=fs.readFileSync(0);fs.writeFileSync(${JSON.stringify(marker)},'ran');process.stdout.write(value);`);
  await f.command('git',['-C',f.repo,'config','filter.fixture.clean',shellQuote(process.execPath)+' '+shellQuote(script)]);
  await writeFile(join(f.repo,'.gitattributes'),'*.dat filter=fixture\n');await writeFile(join(f.repo,'sample.dat'),'sample\n');
  await f.command('git',['-C',f.repo,'add','.gitattributes','sample.dat']);await gitCommit(f,f.repo);
  // Prove the fixture's filter really ran during setup, then invalidate stat data.
  assert.equal(await readFile(marker,'utf8'),'ran');await rm(marker);
  await utimes(join(f.repo,'sample.dat'),new Date(0),new Date(0));
  const captured=await captureCode(f.repo);assert.ok(captured.stateHash);assert.equal(captured.dirty,false);
  await assert.rejects(readFile(marker),{code:'ENOENT'});
});

test('staged additions and deletions remain dirty when observing without Git status',async t=>{
  const f=await fixture(t);await writeFile(join(f.repo,'tracked.txt'),'one\n');await f.command('git',['-C',f.repo,'add','tracked.txt']);await gitCommit(f,f.repo);
  assert.equal((await captureCode(f.repo)).dirty,false);
  await f.command('git',['-C',f.repo,'rm','tracked.txt']);
  const deleted=await captureCode(f.repo);assert.ok(deleted.stateHash);assert.equal(deleted.dirty,true);
  await writeFile(join(f.repo,'replacement.txt'),'two\n');await f.command('git',['-C',f.repo,'add','replacement.txt']);
  const added=await captureCode(f.repo);assert.ok(added.stateHash);assert.equal(added.dirty,true);assert.notEqual(added.stateHash,deleted.stateHash);
});

test('a forged QA JSON id cannot redirect proof reads outside the validated filename',async t=>{
  const f=await fixture(t),{session}=await launch(f),{run}=await f.backend.dispatch('qa',{sessionId:session.id});
  const proof=await f.read(`proofs/${run.id}.json`),outside={...proof,proofId:randomUUID()};
  await f.write('redirected.json',outside);
  await f.write(`qa/${run.id}.json`,{...run,id:'../redirected'});
  await assert.rejects(proofs(f,session),{code:'INVALID_DATA'});
  await assert.rejects(f.backend.dispatch('snapshot'),{code:'INVALID_DATA'});
});

test('a mismatched running QA id is refused before observation or a replacement launch',async t=>{
  const f=await fixture(t),{session}=await launch(f),{run}=await f.backend.dispatch('qa',{sessionId:session.id});
  await f.write(`qa/${run.id}.json`,{...run,id:'../redirected',status:'running',finishedAt:null,workerPid:process.pid});
  await assert.rejects(f.backend.dispatch('snapshot'),{code:'INVALID_DATA'});
  await assert.rejects(f.backend.dispatch('qa',{sessionId:session.id}),{code:'INVALID_DATA'});
});

test('an elapsed observation budget produces an explicit unknown code snapshot',async t=>{
  const f=await fixture(t),captured=await captureCode(f.repo,{deadline:Date.now()-1});
  assert.equal(captured.stateHash,null);assert.equal(captured.sha,null);assert.equal(captured.reason,'QA_CODE_UNREADABLE');
});

test('a Git command timeout turns previously successful evidence unknown',async t=>{
  const f=await fixture(t),{session}=await launch(f);await f.backend.dispatch('qa',{sessionId:session.id});
  const bin=join(f.root,'slow-bin');await mkdir(bin);
  await writeFile(join(bin,'git'),'#!/bin/sh\nexec /bin/sleep 4\n',{mode:0o700});
  const previous=process.env.PATH;process.env.PATH=bin+delimiter+previous;
  try {
    const [p]=(await proofs(f,session)).proofs;assert.equal(p.status,'inconnu');assert.equal(p.originalStatus,'réussi');
  }finally {process.env.PATH=previous;}
});

test('a detached HEAD with the same code preserves valid evidence',async t=>{
  const f=await fixture(t),{session}=await launch(f);await f.backend.dispatch('qa',{sessionId:session.id});
  await f.command('git',['-C',session.worktree,'switch','--detach',f.base]);
  const [p]=(await proofs(f,session)).proofs;assert.equal(p.status,'réussi');assert.equal(p.sha,f.base);
});

test('an unsupported FIFO is observed as unknown without attempting to read its stream',async t=>{
  const f=await fixture(t),{session}=await launch(f);await f.backend.dispatch('qa',{sessionId:session.id});
  await f.command('mkfifo',[join(session.worktree,'unreadable-pipe')]);
  const [p]=(await proofs(f,session)).proofs;assert.equal(p.status,'inconnu');assert.equal(p.originalStatus,'réussi');
});

test('an ignored FIFO stays outside the declared Git working-set contract',async t=>{
  const f=await fixture(t);await writeFile(join(f.repo,'.gitignore'),'ignored-pipe\n');
  await f.command('git',['-C',f.repo,'add','.gitignore']);await gitCommit(f,f.repo);
  const before=await captureCode(f.repo);await f.command('mkfifo',[join(f.repo,'ignored-pipe')]);
  const after=await captureCode(f.repo);assert.ok(after.stateHash);assert.equal(after.stateHash,before.stateHash);
});

test('a supported submodule with nested directories stays measurable after special-file scanning',async t=>{
  const f=await fixture(t),{session}=await launch(f);
  await mkdir(join(f.repo,'nested'));await writeFile(join(f.repo,'nested','file.txt'),'nested\n');
  await f.command('git',['-C',f.repo,'add','nested/file.txt']);await gitCommit(f,f.repo);
  await f.command('git',['-C',session.worktree,'-c','protocol.file.allow=always','submodule','add',f.repo,'dependency']);
  await gitCommit(f,session.worktree);
  const captured=await captureCode(session.worktree);assert.ok(captured.stateHash);assert.equal(captured.dirty,false);
});

test('two processes released together contend for one QA launch, rather than a second request after startup',async t=>{
  const f=await fixture(t),{session}=await launch(f),release=join(f.root,'requests-go'),qaRelease=join(f.root,'qa-go');
  f.config.projects[0].tests.unit={argv:[process.execPath,'-e',`const fs=require('fs');const t=setInterval(()=>{if(fs.existsSync(${JSON.stringify(qaRelease)}))clearInterval(t);},10);`],timeoutMs:10000,terminal:false};
  await f.write('config.json',f.config);
  const backendURL=new URL('../src/backend.mjs',import.meta.url).href;
  const code=`import{readFile,writeFile}from'node:fs/promises';import{createBackend}from ${JSON.stringify(backendURL)};
    const [root,id,ready,entered,go]=process.argv.slice(1);await writeFile(ready,'ready');
    for(;;){try{await readFile(go);break;}catch(e){if(e.code!=='ENOENT')throw e;}await new Promise(r=>setTimeout(r,5));}
    await writeFile(entered,'entered');try{await createBackend({root}).dispatch('qa',{sessionId:id});process.stdout.write(JSON.stringify({ok:true}));}
    catch(e){process.stdout.write(JSON.stringify({ok:false,code:e.code}));}`;
  const jobs=['one','two'].map(name=>({ready:join(f.root,name+'-ready'),entered:join(f.root,name+'-entered')}));
  const running=jobs.map(job=>f.command(process.execPath,['--input-type=module','-e',code,f.home,session.id,job.ready,job.entered,release]).then(result=>JSON.parse(result.stdout)));
  try {
    await Promise.all(jobs.map(job=>waitFor(job.ready)));await writeFile(release,'go');
    await Promise.all(jobs.map(job=>waitFor(job.entered)));
    const loser=await Promise.race(running);assert.deepEqual(loser,{ok:false,code:'QA_RUNNING'});
    assert.equal((await proofs(f,session)).proofs.length,1);
  }finally {await writeFile(release,'go');await writeFile(qaRelease,'go');await Promise.allSettled(running);}
  const results=await Promise.all(running);assert.equal(results.filter(r=>r.ok).length,1);assert.equal(results.filter(r=>r.code==='QA_RUNNING').length,1);
  assert.equal((await proofs(f,session)).proofs[0].status,'réussi');
});
