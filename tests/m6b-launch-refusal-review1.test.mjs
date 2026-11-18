// M6 (b), the engine, review 1 of the refusal of a launch (decision 111): no race between the green read and the launch
// (the lock of the check is kept from the reading to the launch, and to the message to the Lead); the first dev known by
// a durable proof, never by the step of the mission; a refusal writes nothing, even for an adopted or resumed mission and
// for the watcher on its own. Fakes only: never a real base, container, Herdr or agent.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createMissionActions, createMissionRegistry } from '../src/mission.mjs';
import { createQuestionActions, createQuestionRegistry } from '../src/questions.mjs';
import { createRequestRegistry } from '../src/requests.mjs';
import { createEnvironmentView } from '../src/environment-view.mjs';
import { isMarker, MARKER_PREFIX } from '../src/environment-check.mjs';
import { T } from '../ui/v3/texts.js';
import { setup, leadMission, devRuns, FG2 } from './helpers/dev-chain-setup.mjs';
import { environmentWorld } from './helpers/environment-world.mjs';

const after=t=>fn=>t.after(fn);
const NOT_RECORDS=/(^|\/)(operation\.guard|legacy-archive\.json)$/;
function snapshot(dir) {
  const out={};
  const walk=d=>{for(const name of readdirSync(d)){const p=join(d,name);if(statSync(p).isDirectory())walk(p);else if(!NOT_RECORDS.test(p))out[p.slice(dir.length)]=readFileSync(p,'utf8');}};
  try{walk(dir);}catch(error){if(error.code!=='ENOENT')throw error;}
  return out;
}
const STEPS=[{key:'database',ok:true,status:'green'},{key:'migrations',ok:true,status:'green',journal:3,pending:0},{key:'accounts',ok:true,status:'green',accounts:{po:true,dev:true}}];
const READY={state:'ready',ok:true,recheck:true,at:'2026-11-16T10:00:00.000Z',checks:STEPS};
const UNCHECKED={state:'unchecked',ok:false,cause:'NOT_CHECKED',recheck:true,checks:[]};
const chainFile=(root,id)=>join(root,'state','devchain-'+id+'.json');
const writeChain=(root,id,data)=>{mkdirSync(join(root,'state'),{recursive:true});writeFileSync(chainFile(root,id),JSON.stringify({done:{},log:[],seen:{},paths:{},bases:{},on:true,digest:[],withheld:[],digestAt:0,settled:false,lane:null,laneSeq:0,...data})+'\n');};
const unblocked=T.issue.follow.unblocked('XJ-2');

test('the watcher with its chain on tries the launch on its own: not green, it says nothing and starts nothing; green, the dev starts',async t=>{
  let current=UNCHECKED;
  const c=await setup({environment:async()=>current});t.after(c.cleanup);
  writeChain(c.root,'M-1',{});
  for(let n=0;n<3;n++)await c.make().tick({sessionId:'s1'});
  assert.equal(devRuns(c.calls,'XJ-2'),0,'no dev');
  assert.equal(c.calls.filter(([x])=>x==='hc.run').length,0,'nothing asked of the core');
  const chain=JSON.parse(readFileSync(chainFile(c.root,'M-1'),'utf8'));
  assert.ok(!chain.log.some(l=>l.text===unblocked),'« unblocked » is never said of a launch refused');
  assert.equal(chain.done['dev|XJ-2'],undefined,'no dev noted asked');
  // Green: the same watcher starts it, once.
  current=READY;
  await c.make().tick({sessionId:'s1'});
  assert.equal(devRuns(c.calls,'XJ-2'),1,'the watcher really launches when green');
  assert.ok(JSON.parse(readFileSync(chainFile(c.root,'M-1'),'utf8')).log.some(l=>l.text===unblocked));
});

test('a check that starts during the launch of the first dev, or during the message to the Lead, is refused; one under way refuses the launch',async t=>{
  const w=await environmentWorld(after(t)),view=createEnvironmentView({root:w.root,loadConfig:w.loadConfig,check:w.check.check});
  await w.enroll();
  assert.equal((await view.run({project:'example'})).state,'ready');
  const read=()=>view.read({project:'example'}),hold=(_input,task)=>view.hold({project:'example'},task);
  const during=[],shown=[];
  const tryCheck=async()=>{shown.push((await read()).state);during.push(await w.check.check({project:'example'}).then(()=>'ran',e=>e.code));};
  const c=await setup({environment:read,environmentHold:hold,ensureWorktree:async()=>{await tryCheck();return {path:'/wt',branch:'xj-1',base:'release/x',created:[],rebased:[],command:"'node' '/r.mjs'"};}},{},{approved:false});
  t.after(c.cleanup);
  const {missions}=await leadMission(c.root),questions=createQuestionRegistry({root:c.root});
  const screen=createMissionActions({root:c.root,now:()=>Date.parse('2026-11-16T09:00:00Z'),registry:missions,questions,inbox:createRequestRegistry({root:c.root,questions,missions}),
    loadState:async()=>({sessions:[c.session]}),window:c.core.herdr.window,send:async()=>{await tryCheck();return {sent:true};},environment:read,environmentHold:hold});
  // The message to the Lead: a check asked meanwhile cannot start.
  assert.equal((await screen.launch({mission:'M-1',seen:(await missions.read('M-1')).plan.revision})).approved,true);
  assert.deepEqual(during,['ENVIRONMENT_BUSY'],'no check during the message to the Lead');
  assert.deepEqual(shown,['ready'],'the page, read meanwhile, is not told a check runs');
  // The check refused removed its own marker (the markers per check of review 3): the view is still green, with no
  // check run again (the limit 1 of the refusal is gone); then the launch of the first dev.
  assert.deepEqual(readdirSync(join(w.root,'environment','example')).filter(isMarker),[],'no marker left by the check refused');
  assert.equal((await read()).state,'ready','green again without a check run again');
  const out=await c.chain.launch({mission:'M-1',tickets:[FG2]});
  assert.ok(out.launched.some(x=>x.launched),JSON.stringify(out));
  assert.deepEqual(during,['ENVIRONMENT_BUSY','ENVIRONMENT_BUSY'],'no check during the launch');
  assert.equal(devRuns(c.calls,'XJ-2'),1);
  // The lock is given back: a check runs once the launch is over.
  assert.equal((await view.run({project:'example'})).state,'ready');
  // Two holds at once (two launches of the project): both go, neither is taken for a check.
  const both=await Promise.all([1,2].map(()=>view.hold({project:'example'},async v=>{await new Promise(r=>setTimeout(r,50));return v.state;})));
  assert.deepEqual(both,['ready','ready']);
  // A check under way (its kernel lock held): the launch of a first dev is refused.
  const d=await setup({environment:read,environmentHold:hold},{},{approved:true});t.after(d.cleanup);
  const {operationLock}=await import('../src/operation-lock.mjs');
  await operationLock(join(w.root,'environment','example'),async()=>{
    await assert.rejects(()=>d.chain.launch({mission:'M-1',tickets:[FG2]}),{code:'ENVIRONMENT_NOT_READY'});
  });
  assert.equal(devRuns(d.calls,'XJ-2'),0);
  // Under a hold of this process, a marker of another check (dead, or about to be refused): not green.
  const dir=join(w.root,'environment','example'),other=join(dir,MARKER_PREFIX+'a'.repeat(24));
  writeFileSync(other,JSON.stringify({id:'a'.repeat(24),pid:process.pid,at:'2026-11-16T09:00:00.000Z'}));
  assert.equal(await view.hold({project:'example'},async v=>v.state),'interrupted','a marker of another check under the hold');
  rmSync(other);
  assert.equal(await view.hold({project:'example'},async v=>v.state),'ready','no marker under the hold: green');
});

test('a mission passed to validation before any dev: dev-launch is still checked; once a dev left, the environment no longer holds it',async t=>{
  let current=UNCHECKED;
  const c=await setup({environment:async()=>current});t.after(c.cleanup);
  const {missions}=await leadMission(c.root),questions=createQuestionRegistry({root:c.root}),inbox=createRequestRegistry({root:c.root,questions,missions,notify:async()=>{}});
  const lead=createQuestionActions({questions,inbox,missions,launch:c.chain.launch,unpaused:c.chain.unpaused});
  await lead.request({mission:'M-1',kind:'validation',text:'Bilan'});
  assert.equal((await missions.read('M-1')).step,'validating');
  const before=snapshot(join(c.root,'state'));
  await assert.rejects(()=>c.chain.launch({mission:'M-1',tickets:[FG2]}),{code:'ENVIRONMENT_NOT_READY'});
  await assert.rejects(()=>lead.request({mission:'M-1',kind:'launch',tickets:[FG2]}),{code:'ENVIRONMENT_NOT_READY'});
  assert.deepEqual(snapshot(join(c.root,'state')),before,'nothing written');
  assert.equal(devRuns(c.calls,'XJ-2'),0);
  // Green: the first dev leaves, and its proof is written.
  current=READY;
  assert.ok((await c.chain.launch({mission:'M-1',tickets:[FG2]})).launched.some(x=>x.launched));
  assert.equal(typeof (await missions.read('M-1')).devStartedAt,'string','the durable proof of the first dev');
  // Not green again: the launches of after are no longer held by the environment.
  current=UNCHECKED;
  const again=await c.chain.launch({mission:'M-1',tickets:[FG2]}).then(()=>null,e=>e.code);
  assert.notEqual(again,'ENVIRONMENT_NOT_READY');
});

test('a mission adopted or resumed: refused, its chain is neither moved nor started',async t=>{
  for(const from of ['adoptedFrom','resumedFrom']) {
    const c=await setup({environment:async()=>UNCHECKED});t.after(c.cleanup);
    const {missions}=await leadMission(c.root);
    await missions.update('M-1',m=>{m[from]='s0';});
    writeChain(c.root,'s0',{on:false,log:[{at:'10:00',text:'fil ancien',tone:'ok',detail:''}]});
    const before=snapshot(join(c.root,'state'));
    await assert.rejects(()=>c.chain.launch({mission:'M-1',tickets:[FG2]}),{code:'ENVIRONMENT_NOT_READY'},from);
    assert.deepEqual(snapshot(join(c.root,'state')),before,from+': nothing written');
    assert.equal(existsSync(chainFile(c.root,'M-1')),false,from+': the chain stays where it was');
    assert.equal(devRuns(c.calls,'XJ-2'),0);
  }
});

test('review 2: no folder at the first look, then an enrollment and a green check before the reading: the green read without the lock is refused',async t=>{
  const w=await environmentWorld(after(t));
  let armed=false;
  const loadConfig=async()=>{if(armed){armed=false;await w.enroll();await w.check.check({project:'example'});}return w.loadConfig();};
  const view=createEnvironmentView({root:w.root,loadConfig,check:w.check.check});
  assert.equal(existsSync(join(w.root,'environment','example')),false,'no folder before the hold');
  const hold=(_input,task)=>{armed=true;return view.hold({project:'example'},task);};
  // The hold alone: the view given to the task is not green.
  const state=await hold({},async v=>v.state);
  assert.notEqual(state,'ready');
  assert.equal((await view.read({project:'example'})).state,'ready','the race did happen: the check is green');
  // The launch of a first dev in the same race: refused, no dev started.
  rmSync(join(w.root,'environment','example'),{recursive:true,force:true});
  const c=await setup({environment:()=>view.read({project:'example'}),environmentHold:hold},{},{approved:true});t.after(c.cleanup);
  await assert.rejects(()=>c.chain.launch({mission:'M-1',tickets:[FG2]}),{code:'ENVIRONMENT_NOT_READY'});
  assert.equal(devRuns(c.calls,'XJ-2'),0);
});
