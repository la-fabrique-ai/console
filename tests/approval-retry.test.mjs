import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { AppError } from '../src/common.mjs';
import { APPROVAL } from '../src/mission.mjs';
import { planOf } from '../src/plan.mjs';
import { desk } from './helpers/requests.mjs';
import { planTicket, setup, FG2 } from './helpers/dev-chain-setup.mjs';
import { pageConfirm } from '../mods/fabrique-console-v4-ticket/blocks.js';
import { LEAD_BUSY } from '../ui/v3/view.js';

// M5 review 2: a new click on a mission whose copy is already written (its launch known not to have left) checks again
// that the mission is neither over nor started and that its plan is still the one approved; the Lead at work or held in
// its terminal is checked under the same lock as the copy, by the rule of the page; and the watcher that cannot launch
// a dev for want of the approval says so in the journal of the mission, once.

const PLAN={tickets:[planTicket('XJ-2',1),planTicket('XJ-3',2,{deps:['XJ-2']})]};
const record=async(f,plan=PLAN)=>{let revision;await f.missions.update('M-1',m=>{m.plan={...planOf(plan),revision:(m.plan?.revision||0)+1,savedAt:'2026-11-13T08:00:00.000Z',tracker:{verified:true}};revision=m.plan.revision;});return revision;};
const approve=(f,seen)=>f.lead.launch({mission:'M-1',seen});
// A copy written, and a launch known not to have left (the message refused before Herdr): a click may ask it again.
async function failedOnce(t){
  const f=await desk(t,{send:async()=>{throw new AppError('SEND_FAILED','The message could not be sent to the agent.');}}),seen=await record(f);
  await assert.rejects(()=>approve(f,seen),e=>e.code==='SEND_FAILED');
  f.send=null;assert.ok((await f.missions.read('M-1')).approval);assert.equal((await f.missions.read('M-1')).launch.state,'failed');
  return {f,seen};
}

test('a new click on a mission already started, or over, is refused as the first: nothing is sent',async t=>{
  for(const [step,code] of [['building','MISSION_STARTED'],['qa','MISSION_STARTED'],['validated','MISSION_OVER'],['closed','MISSION_OVER']]) {
    const {f,seen}=await failedOnce(t),copy=JSON.stringify((await f.missions.read('M-1')).approval);
    await f.missions.update('M-1',m=>{m.step=step;});
    await assert.rejects(()=>approve(f,seen),e=>e.code===code,step);
    assert.equal(f.sent.length,1,step+': the one message of the first click');
    const m=await f.missions.read('M-1');assert.equal(m.launch.state,'failed');assert.equal(JSON.stringify(m.approval),copy);
  }
});

test('a new click once the plan was rewritten after the copy: the revision of before is refused; the one drawn is approved again (M7)',async t=>{
  const {f,seen}=await failedOnce(t);
  const next=await record(f,{tickets:[PLAN.tickets[0]]});
  await assert.rejects(()=>approve(f,seen),e=>e.code==='PLAN_REVISED'&&e.message===APPROVAL.changed);
  assert.equal(f.sent.length,1);assert.equal((await f.missions.read('M-1')).approval.revision,seen);
  assert.equal((await approve(f,next)).launch,'asked','no more dead end: the plan drawn is approved, and the launch asked again');
  const m=await f.missions.read('M-1');
  assert.equal(f.sent.length,2);assert.equal(m.approval.revision,next);assert.equal(m.approval.kind,'reapproval');assert.equal(m.approval.previous[0].revision,seen);
});

test('the Lead at work or held in its terminal: refused, as the page refuses it, before the copy and on a new click',async t=>{
  for(const status of ['working','blocked']) {
    const f=await desk(t),seen=await record(f);
    f.leadTab.status=status;
    // Decision 87: the Lead at work keeps the words of decision 74; the Lead waiting in its terminal has its own.
    await assert.rejects(()=>approve(f,seen),e=>e.code==='LEAD_WORKING'&&e.message===(status==='blocked'?APPROVAL.waiting:APPROVAL.working),status);
    assert.equal((await f.missions.read('M-1')).approval,undefined,status);assert.equal(f.sent.length,0);
  }
  const {f,seen}=await failedOnce(t);
  f.leadTab.status='working';
  await assert.rejects(()=>approve(f,seen),e=>e.code==='LEAD_WORKING','a new click while the Lead works');
  assert.equal(f.sent.length,1);
  f.leadTab.status='idle';assert.equal((await approve(f,seen)).launch,'asked');assert.equal(f.sent.length,2);
});

test('the Lead that starts working as the copy is about to be written: refused under the same lock, no copy',async t=>{
  const f=await desk(t),seen=await record(f),through=f.inbox.withWaiting;
  // The status is read under the lock of the copy, not before it.
  f.inbox.withWaiting=(id,task)=>{f.leadTab.status='working';return through(id,task);};
  await assert.rejects(()=>approve(f,seen),e=>e.code==='LEAD_WORKING');
  assert.equal((await f.missions.read('M-1')).approval,undefined);assert.equal(f.sent.length,0);
});

test('one rule for the page and the engine: the statuses of the Lead that hold the approval are the same',async t=>{
  const ticket=(id,n)=>({id,n,state:'todo',title:id,dev:'claude',model:'claude-opus-5-5',effort:'high',deps:[]});
  const mission={id:'M-1',step:'analysing',issue:{identifier:'XJ-1'},tickets:[ticket('XJ-2',1)],plan:{revision:1,tickets:[]},lead:{sessionId:'s1'}};
  assert.deepEqual([...LEAD_BUSY].sort(),['blocked','working']);
  for(const status of ['idle','done','working','blocked']) {
    const page=pageConfirm({mission,lead:{address:'t7',status}})!==null;
    const f=await desk(t),seen=await record(f);f.leadTab.status=status;
    const engine=await approve(f,seen).then(()=>true,e=>{if(e.code!=='LEAD_WORKING')throw e;return false;});
    assert.equal(engine,page,status);
  }
});

test('the watcher that cannot launch a dev for want of the approval says it in the journal of the mission, once',async()=>{
  const t=await setup({},{},{approved:false});
  try{
    await mkdir(join(t.root,'state'),{recursive:true});
    await writeFile(join(t.root,'state','devchain-M-1.json'),JSON.stringify({done:{},log:[],seen:{},paths:{},bases:{},on:true,digest:[],withheld:[],digestAt:0,settled:false,lane:null,laneSeq:0})+'\n');
    for(let n=0;n<3;n++)await t.make().tick({sessionId:'s1'});
    const journal=(await t.chain.read({mission:'M-1'})).log,said=journal.filter(l=>l.tone==='fail'&&/approuv/.test(l.detail||''));
    assert.equal(said.length,1,JSON.stringify(journal));assert.match(said[0].text,/XJ-2/);
    assert.ok(!journal.some(l=>/lancés/.test(l.text)),'nothing said launched: '+JSON.stringify(journal));
    assert.equal(t.calls.filter(([c])=>c==='hc.run').length,0);
  }finally{await t.cleanup();}
});
