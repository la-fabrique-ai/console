import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, realpath, rm, symlink, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDevFlow } from '../src/dev-flow.mjs';
import { createMissionActions, createMissionRegistry, qaRunOf } from '../src/mission.mjs';
import { qaLaunchOf } from '../src/dev-chain.mjs';

// The QA agent of a development as the Development page reads it (M-4, PRB-41, 2026-11-12): launched by the chain,
// capturing its tests in <worktree>/.fabrique-console/qa/, its report in .fabrique-console/qa.json. A real folder, the chain faked.
const LAUNCH='2026-11-12T09:52:22.118Z',after=minutes=>new Date(Date.parse(LAUNCH)+minutes*60000);
async function fixture(t) {
  const root=await realpath(await mkdtemp(join(tmpdir(),'fabrique-console-qa-line-')));t.after(()=>rm(root,{recursive:true,force:true}));
  const worktree=join(root,'PRB-41'),shots=join(worktree,'.fabrique-console','qa');await mkdir(shots,{recursive:true});
  const flow=createDevFlow({loadState:async()=>({sessions:[{id:'s1',role:'lead',worktree}]})});
  const registry=createMissionRegistry({root}),chain={done:{}};
  chain.read=async()=>({log:[],on:true,metrics:{},reports:[],qa:qaLaunchOf(chain.done)});
  await registry.create({project:'beta',issue:{id:'i1',identifier:'PRB-41',title:'Durcir',url:'u'},request:'r',lead:{sessionId:'s1',lastSeen:null},worktree,step:'validating'});
  const actions=createMissionActions({registry,chain,validation:flow.validation,questions:{list:async()=>[]},inbox:{list:async()=>[],taken:async()=>[]}});
  const dated=async(path,when,body='x')=>{await writeFile(path,body);await utimes(path,when,when);};
  const shot=(name,minutes)=>dated(join(shots,name),after(minutes));
  const report=minutes=>dated(join(worktree,'.fabrique-console','qa.json'),after(minutes),JSON.stringify({verdict:'ok',summary:'Fait.',tests:[{id:'1',title:'Liste',steps:'Ouvrir',expected:'100 lignes'}]}));
  return {root,worktree,shots,chain,shot,report,read:()=>actions.read({mission:'M-1'})};
}

test('a QA launched with no report yet: the tests it has captured since its launch, and when it captured the last', async t=>{
  const f=await fixture(t);f.chain.done['qa|PRB-142,PRB-144']=Date.parse(LAUNCH);
  await f.shot('old.png',-30);await f.shot('1.png',16);await f.shot('1-bas.png',17);await f.shot('2.png',18);await f.shot('3-selection.png',20);
  await f.shot('notes.txt',21);await mkdir(join(f.shots,'4.png'));
  const out=await f.read();
  assert.deepEqual(out.qaRun,{launchedAt:LAUNCH,reportAt:null,done:false,tests:3,lastShotAt:after(20).toISOString()},'1, 2 and 3; a capture of the run before, a note and a folder are not');
  assert.equal(out.qa,null,'no test plan yet');
});

test('a QA done: its report written after its launch, and its test plan shown as before', async t=>{
  const f=await fixture(t);f.chain.done['qa|PRB-142,PRB-144']=Date.parse(LAUNCH);
  await f.shot('1.png',16);await f.report(27);
  const out=await f.read();
  assert.equal(out.qaRun.done,true);assert.equal(out.qaRun.reportAt,after(27).toISOString());assert.equal(out.qaRun.tests,1);
  assert.equal(out.qa.plan.length,1,'the test plan as the page shows it today');
});

test('a QA launched again for a correction ticket follows its new run: the report and captures of the last run do not count', async t=>{
  const f=await fixture(t);f.chain.done['qa|PRB-142,PRB-144']=Date.parse(LAUNCH);
  await f.shot('1.png',16);await f.report(27);
  f.chain.done['qa|PRB-142,PRB-144,PRB-153']=after(60).getTime();
  const out=await f.read();
  assert.deepEqual(out.qaRun,{launchedAt:after(60).toISOString(),reportAt:null,done:false,tests:0,lastShotAt:null});
  await f.shot('1.png',65);await f.report(80);
  const next=(await f.read()).qaRun;assert.deepEqual([next.done,next.tests,next.reportAt],[true,1,after(80).toISOString()]);
});

test('a QA never launched has no line; one taken up from its reports has no launch time', async t=>{
  const f=await fixture(t);
  assert.equal((await f.read()).qaRun,null);
  f.chain.done['qa|PRB-142']=true;await f.shot('1.png',16);
  assert.deepEqual((await f.read()).qaRun,{launchedAt:null,reportAt:null,done:false,tests:1,lastShotAt:after(16).toISOString()});
  await f.report(27);assert.equal((await f.read()).qaRun.done,true);
});

test('only the captures of the folder itself are read: a link elsewhere gives none', async t=>{
  const f=await fixture(t),elsewhere=join(f.root,'elsewhere');f.chain.done['qa|PRB-142']=Date.parse(LAUNCH);
  await mkdir(elsewhere);await writeFile(join(elsewhere,'1.png'),'x');
  await rm(f.shots,{recursive:true});await symlink(elsewhere,f.shots);
  assert.equal((await f.read()).qaRun.tests,0);
  await rm(f.shots);await mkdir(f.shots);await symlink(join(elsewhere,'1.png'),join(f.shots,'1.png'));
  assert.equal((await f.read()).qaRun.tests,0,'a link in the folder is not a capture');
});

test('the last launch of the QA is the latest one the chain claimed', ()=>{
  assert.equal(qaLaunchOf({}),null);assert.equal(qaLaunchOf({'dev|XJ-2':1}),null);
  assert.deepEqual(qaLaunchOf({'qa|XJ-2':Date.parse(LAUNCH),'qa|XJ-2,XJ-4':after(60).getTime(),'validation|XJ-2':after(90).getTime()}),{launchedAt:after(60).toISOString()});
  assert.deepEqual(qaLaunchOf({'qa|XJ-2':true}),{launchedAt:null});
  assert.equal(qaRunOf(null,null,[]),null);
  assert.deepEqual(qaRunOf(null,after(5).toISOString(),[{test:'1',at:after(1).toISOString()}]),{launchedAt:null,reportAt:after(5).toISOString(),done:true,tests:1,lastShotAt:after(1).toISOString()},'a report with no launch known is done');
});
