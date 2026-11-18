import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile,writeFile,readdir,rm,symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { fixture,issue } from './helpers/backend-fixture.mjs';
import { runWorker } from '../src/qa-worker.mjs';
import { assertInterfaceShape } from './helpers/interface-shape.mjs';

const launch=f=>f.backend.dispatch('launch',{issueId:issue.id,tool:'codex'});
const proofs=async(f,session)=>{
  const result=await f.backend.dispatch('test-proofs',{sessionId:session.id});
  assertInterfaceShape('TestProofs',result);return result;
};
async function commit(f,cwd,name='tracked.txt',content='committed\n') {
  await writeFile(join(cwd,name),content);
  await f.command('git',['-C',cwd,'add',name]);
  await f.command('git',['-C',cwd,'-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-m','fixture change']);
  return (await f.command('git',['-C',cwd,'rev-parse','HEAD'])).stdout.trim();
}
async function profile(f,script,{terminal=false}={}) {
  f.config.projects[0].tests.unit={argv:[process.execPath,'-e',script],timeoutMs:10000,terminal};
  await f.write('config.json',f.config);
}
async function waitFor(path) {
  const until=Date.now()+10000;
  while(Date.now()<until) {
    try{return await readFile(path,'utf8');}catch(error){if(error.code!=='ENOENT')throw error;}
    await new Promise(resolve=>setTimeout(resolve,10));
  }
  assert.fail('The QA fixture did not reach its barrier.');
}

test('QA produces immutable C5 evidence and every run remains readable by session and ticket',async t=>{
  const f=await fixture(t),{session}=await launch(f);
  const {run}=await f.backend.dispatch('qa',{sessionId:session.id,profile:'unit'});
  const result=await proofs(f,session);assert.equal(result.proofs.length,1);
  const p=result.proofs[0];
  assert.equal(p.proofId,run.id);assert.equal(p.sessionId,session.id);assert.equal(p.runId,null);
  assert.equal(p.project,'example');assert.equal(p.repo,f.repo);assert.equal(p.sha,f.base);
  assert.equal(p.dirty,false);assert.equal(p.diffHash,null);assert.equal(p.profile,'unit');
  assert.deepEqual(p.argv,[process.execPath,'-e','console.log("fixture-result")']);
  assert.match(p.profilesVersion,/^sha256:[a-f0-9]{64}$/);assert.equal(p.environment,'local');
  assert.equal(p.exitCode,0);assert.equal(p.status,'réussi');assert.equal(p.originalStatus,'réussi');
  assert.ok(Date.parse(p.finishedAt)>=Date.parse(p.startedAt));
  assert.equal(p.before.sha,f.base);assert.equal(p.after.sha,f.base);
  const path=join(f.home,'proofs',`${p.proofId}.json`),original=await readFile(path,'utf8');
  await f.backend.dispatch('qa',{sessionId:session.id});
  assert.equal((await proofs(f,session)).proofs.length,2);
  assert.equal((await f.backend.dispatch('test-proofs',{issueId:issue.id})).proofs.length,2);
  assert.equal(await readFile(path,'utf8'),original);
});

test('a new commit expires successful evidence without rewriting its original result or advertising passed QA',async t=>{
  const f=await fixture(t),{session}=await launch(f);
  const {run}=await f.backend.dispatch('qa',{sessionId:session.id});
  const path=join(f.home,'proofs',`${run.id}.json`);
  const original=await readFile(path,'utf8');await commit(f,session.worktree);
  const [p]=(await proofs(f,session)).proofs;
  assert.equal(p.status,'périmé');assert.equal(p.originalStatus,'réussi');assert.equal(p.sha,f.base);
  assert.equal(await readFile(path,'utf8'),original);
  assert.equal((await f.backend.dispatch('snapshot')).sessions[0].qa.status,'stale');
});

test('a dirty proof expires when cleaned and changed diff contents expire without a commit',async t=>{
  const f=await fixture(t),{session}=await launch(f);
  const head=await commit(f,session.worktree);await writeFile(join(session.worktree,'tracked.txt'),'first dirty\n');
  await f.backend.dispatch('qa',{sessionId:session.id});
  const [p]=(await proofs(f,session)).proofs;assert.equal(p.sha,head);assert.equal(p.dirty,true);
  assert.match(p.diffHash,/^[a-f0-9]{64}$/);assert.equal(p.status,'réussi');
  await writeFile(join(session.worktree,'tracked.txt'),'other dirty\n');
  assert.equal((await proofs(f,session)).proofs[0].status,'périmé');
  await f.command('git',['-C',session.worktree,'restore','tracked.txt']);
  assert.equal((await proofs(f,session)).proofs[0].status,'périmé');
});

for(const change of ['untracked','index','binary','symlink'])test(`the proof fingerprint detects changed ${change} with the same HEAD`,async t=>{
  const f=await fixture(t),{session}=await launch(f);await commit(f,session.worktree);
  if(change==='untracked')await writeFile(join(session.worktree,'new.bin'),Buffer.from([0,1,2]));
  if(change==='index')await writeFile(join(session.worktree,'tracked.txt'),'staged later\n');
  if(change==='binary')await writeFile(join(session.worktree,'tracked.txt'),Buffer.from([0,3,4]));
  if(change==='symlink')await symlink('missing-one',join(session.worktree,'new-link'));
  await f.backend.dispatch('qa',{sessionId:session.id});assert.equal((await proofs(f,session)).proofs[0].status,'réussi');
  if(change==='untracked')await writeFile(join(session.worktree,'new.bin'),Buffer.from([0,1,3]));
  if(change==='index')await f.command('git',['-C',session.worktree,'add','tracked.txt']);
  if(change==='binary')await writeFile(join(session.worktree,'tracked.txt'),Buffer.from([0,3,5]));
  if(change==='symlink'){await rm(join(session.worktree,'new-link'));await symlink('missing-two',join(session.worktree,'new-link'));}
  assert.equal((await proofs(f,session)).proofs[0].status,'périmé');
});

test('a running test can be read while a concurrent second launch is rejected and cannot replace it',async t=>{
  const f=await fixture(t),{session}=await launch(f),started=join(f.root,'started'),go=join(f.root,'go');
  await profile(f,`const fs=require('fs');fs.writeFileSync(${JSON.stringify(started)},'ready');const t=setInterval(()=>{if(fs.existsSync(${JSON.stringify(go)})){clearInterval(t);}},10);`);
  const first=f.backend.dispatch('qa',{sessionId:session.id});
  try {
    await waitFor(started);
    const running=await proofs(f,session);assert.equal(running.proofs.length,1);
    assert.equal(running.proofs[0].status,'inconnu');assert.equal(running.proofs[0].finishedAt,null);
    await assert.rejects(f.backend.dispatch('qa',{sessionId:session.id}),{code:'QA_RUNNING'});
    assert.equal((await f.read('state.json')).sessions[0].qaId,running.proofs[0].proofId);
  }finally {await writeFile(go,'go');await first;}
  const final=await proofs(f,session);assert.equal(final.proofs.length,1);assert.equal(final.proofs[0].status,'réussi');
});

test('unreadable current HEAD makes existing proofs unknown without deleting their outputs',async t=>{
  const f=await fixture(t),{session}=await launch(f);const {run}=await f.backend.dispatch('qa',{sessionId:session.id});
  const gitdir=(await f.command('git',['-C',session.worktree,'rev-parse','--absolute-git-dir'])).stdout.trim();
  await writeFile(join(gitdir,'HEAD'),'unreadable-head\n');
  const [p]=(await proofs(f,session)).proofs;assert.equal(p.status,'inconnu');assert.equal(p.originalStatus,'réussi');
  assert.equal((await f.read(`qa/${run.id}.json`)).stdout,'fixture-result\n');
});

test('historical QA is readable as unknown evidence and is never silently upgraded',async t=>{
  const f=await fixture(t),{session}=await launch(f),id=randomUUID();
  const old={id,sessionId:session.id,profile:'unit',argv:['old-test'],cwd:session.worktree,execution:'inline',workerPid:process.pid,status:'passed',startedAt:'2026-01-01T00:00:00Z',finishedAt:'2026-01-01T00:00:01Z',exitCode:0,stdout:'old output\n',stderr:'',terminalId:null};
  await f.write(`qa/${id}.json`,old).catch(async error=>{if(error.code!=='ENOENT')throw error;const {mkdir}=await import('node:fs/promises');await mkdir(join(f.home,'qa'));await f.write(`qa/${id}.json`,old);});
  const state=await f.read('state.json');state.sessions[0].qaId=id;await f.write('state.json',state);
  const [p]=(await proofs(f,session)).proofs;assert.equal(p.status,'inconnu');assert.equal(p.sha,null);assert.equal(p.legacy,true);
  assert.equal((await f.backend.dispatch('snapshot')).sessions[0].qa.status,'unknown');
  assert.deepEqual(await f.read(`qa/${id}.json`),old);
  await f.backend.dispatch('qa',{sessionId:session.id});assert.equal((await proofs(f,session)).proofs.length,2);
});

for(const [name,script] of [['truncated',"process.stdout.write('x'.repeat(600000))"],['signaled',"process.kill(process.pid,'SIGTERM')"],['failed','process.exit(7)']])test(`${name} QA preserves its observed outcome and never invents success`,async t=>{
  const f=await fixture(t),{session}=await launch(f);await profile(f,script);
  const {run}=await f.backend.dispatch('qa',{sessionId:session.id});
  const [p]=(await proofs(f,session)).proofs;
  assert.equal(p.status,name==='failed'?'échoué':'inconnu');
  assert.equal(p.originalStatus,name==='failed'?'échoué':'inconnu');
  if(name==='truncated'){assert.equal(p.outputTruncated,true);assert.equal(p.exitCode,0);}
  if(name==='signaled'){assert.equal(p.signal,'SIGTERM');assert.equal(p.exitCode,null);}
  if(name==='failed'){assert.equal(p.exitCode,7);assert.equal(run.status,'failed');}
});

test('a worktree modified during the test cannot produce current successful evidence',async t=>{
  const f=await fixture(t),{session}=await launch(f);
  await profile(f,"require('fs').writeFileSync('new.txt','changed by QA')");
  await f.backend.dispatch('qa',{sessionId:session.id});
  const [p]=(await proofs(f,session)).proofs;
  assert.equal(p.originalStatus,'inconnu');assert.notEqual(p.status,'réussi');
  assert.equal(p.before.dirty,false);assert.equal(p.after.dirty,true);
});

test('terminal workers bind evidence to the actual worker launch and retain an uncompleted intent as unknown',async t=>{
  const f=await fixture(t),{session}=await launch(f);await profile(f,'console.log("terminal-test")',{terminal:true});
  const {run}=await f.backend.dispatch('qa',{sessionId:session.id});
  assert.equal((await proofs(f,session)).proofs[0].status,'inconnu');
  const head=await commit(f,session.worktree);
  await runWorker(f.home,run.id);
  const [p]=(await proofs(f,session)).proofs;assert.equal(p.sha,head);assert.equal(p.status,'réussi');
  assert.equal((await readdir(join(f.home,'proofs'))).filter(name=>name===`${run.id}.json`).length,1);
});

test('review reports identify the base and reviewed source commit and expire after a source commit',async t=>{
  const f=await fixture(t),{session:dev}=await launch(f),head=await commit(f,dev.worktree);
  const {session:review}=await f.backend.dispatch('launch',{issueId:issue.id,tool:'claude',review:true});
  const first=await f.backend.dispatch('propose',{sessionId:review.id});
  assertInterfaceShape('LegacyProposal',first);
  assert.equal(first.report.baseSha,f.base);assert.equal(first.report.headSha,head);assert.equal(first.report.status,'current');
  assert.ok(first.content.includes(head));assert.ok(first.content.includes(f.base));
  await commit(f,dev.worktree,'second.txt','next commit\n');
  const stale=await f.backend.dispatch('propose',{sessionId:review.id});
  assert.equal(stale.report.headSha,head);assert.equal(stale.report.status,'périmé');assert.notEqual(stale.report.currentSha,head);
});

test('deleting a tracked directory is measurable dirty evidence rather than an unreadable worktree',async t=>{
  const f=await fixture(t),{session}=await launch(f);
  const {mkdir}=await import('node:fs/promises');await mkdir(join(session.worktree,'nested'));
  await commit(f,session.worktree,'nested/file.txt');await rm(join(session.worktree,'nested'),{recursive:true});
  await f.backend.dispatch('qa',{sessionId:session.id});
  const [p]=(await proofs(f,session)).proofs;assert.equal(p.dirty,true);assert.equal(p.status,'réussi');
});

test('tracked binary files larger than a typical patch limit can still produce exact evidence',async t=>{
  const f=await fixture(t),{session}=await launch(f);
  await commit(f,session.worktree,'asset.bin',Buffer.alloc(17*1024*1024,0));
  await f.backend.dispatch('qa',{sessionId:session.id});
  const [p]=(await proofs(f,session)).proofs;assert.equal(p.status,'réussi');assert.equal(p.dirty,false);
});

test('Git index flags cannot hide a worktree edit from the proof fingerprint',async t=>{
  const f=await fixture(t),{session}=await launch(f);await commit(f,session.worktree);
  await f.command('git',['-C',session.worktree,'update-index','--assume-unchanged','tracked.txt']);
  await f.backend.dispatch('qa',{sessionId:session.id});
  await writeFile(join(session.worktree,'tracked.txt'),'hidden edit\n');
  assert.equal((await proofs(f,session)).proofs[0].status,'périmé');
  await f.backend.dispatch('qa',{sessionId:session.id});
  const current=(await proofs(f,session)).proofs.find(p=>p.status==='réussi');assert.ok(current);assert.equal(current.dirty,true);
});

test('an abandoned terminal launch keeps its evidence unknown even when a terminal disappeared',async t=>{
  const f=await fixture(t),{session}=await launch(f);await profile(f,'process.exit(0)',{terminal:true});
  await f.backend.dispatch('qa',{sessionId:session.id});f.setTerminals([]);
  assert.equal((await f.backend.dispatch('snapshot')).sessions[0].qa.status,'interrupted');
  const [p]=(await proofs(f,session)).proofs;assert.equal(p.status,'inconnu');assert.equal(p.finishedAt,null);
});

test('invalid proof selectors are rejected instead of leaking all session evidence',async t=>{
  const f=await fixture(t),{session}=await launch(f);
  for(const input of [{},{sessionId:session.id,issueId:issue.id},{issueId:''}])await assert.rejects(f.backend.dispatch('test-proofs',input),{code:'INVALID_ARGUMENT'});
  assert.deepEqual((await f.backend.dispatch('test-proofs',{issueId:'no-local-session'})).proofs,[]);
});

test('two independent CLI processes cannot run the same session profile simultaneously',async t=>{
  const f=await fixture(t),{session}=await launch(f),started=join(f.root,'cli-started'),go=join(f.root,'cli-go');
  await profile(f,`const fs=require('fs');fs.writeFileSync(${JSON.stringify(started)},'ready');const t=setInterval(()=>{if(fs.existsSync(${JSON.stringify(go)}))clearInterval(t);},10);`);
  const args=[fileURLToPath(new URL('../src/cli.mjs',import.meta.url)),'qa',JSON.stringify({sessionId:session.id})];
  const options={env:{...process.env,FABRIQUE_CONSOLE_HOME:f.home}};
  const first=f.command(process.execPath,args,options).then(result=>({result}),error=>({error}));
  let outcome;
  try {
    await waitFor(started);
    const second=await f.command(process.execPath,args,options).then(result=>({result}),error=>({error}));
    assert.ok(second.error);assert.equal(JSON.parse(second.error.stdout).error.code,'QA_RUNNING');
    const [p]=(await proofs(f,session)).proofs;assert.equal(p.status,'inconnu');
  }finally {await writeFile(go,'go');outcome=await first;}
  assert.ok(outcome.result,outcome.error?.message);assert.equal(JSON.parse(outcome.result.stdout).ok,true);
  const final=await proofs(f,session);assert.equal(final.proofs.length,1);assert.equal(final.proofs[0].status,'réussi');
});

test('a legacy review missing the copied commit reports unknown rather than claiming a comparison',async t=>{
  const f=await fixture(t);await launch(f);
  const {session:review}=await f.backend.dispatch('launch',{issueId:issue.id,tool:'claude',review:true});
  const state=await f.read('state.json');delete state.sessions.find(s=>s.id===review.id).reviewSource.head;
  await f.write('state.json',state);
  const result=await f.backend.dispatch('propose',{sessionId:review.id});
  assert.equal(result.report.headSha,null);assert.equal(result.report.status,'inconnu');
});

test('edits inside an initialized submodule invalidate the parent worktree proof',async t=>{
  const f=await fixture(t),{session}=await launch(f);
  await f.command('git',['-C',session.worktree,'-c','protocol.file.allow=always','submodule','add',f.repo,'dependency']);
  await commit(f,session.worktree);
  await f.backend.dispatch('qa',{sessionId:session.id});assert.equal((await proofs(f,session)).proofs[0].status,'réussi');
  await writeFile(join(session.worktree,'dependency','new.txt'),'submodule edit\n');
  assert.equal((await proofs(f,session)).proofs[0].status,'périmé');
  await f.backend.dispatch('qa',{sessionId:session.id});
  const current=(await proofs(f,session)).proofs.find(p=>p.status==='réussi');assert.ok(current);assert.equal(current.dirty,true);
});
