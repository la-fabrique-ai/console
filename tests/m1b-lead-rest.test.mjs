import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setup, leadMission, FG2 } from './helpers/dev-chain-setup.mjs';
import { withNews, LEAD_REST_MS } from '../src/dev-chain.mjs';
import { createLeadWake, leadLock } from '../src/lead-wake.mjs';
import { createQuestionActions } from '../src/questions.mjs';

// Chantier 1, lot 1B: the Lead is woken only to decide. No progress note every two minutes; a Lead that rests long
// in Develop or Validate is put to rest (its tab closed), and woken again, fresh, when it is needed.
const MIN=60000;
async function leadSetup(step='building',more={}){
  let clock=Date.parse('2026-11-16T10:00:00.000Z');
  const t=await setup({},{role:'lead',missionId:'M-1'});
  const {missions}=await leadMission(t.root);
  await missions.update('M-1',m=>{m.step=step;});
  // The window as the chain sees it: `lsFails` makes its reading fail, as a window that does not answer.
  const window=new Proxy(t.core.herdr.window,{get:(w,k)=>k==='ls'?async(...a)=>{if(t.lsFails)throw new Error('window gone');return w.ls(...a);}:w[k]});
  const chain=t.make({now:()=>clock,window,...more});
  // The watcher passes every two minutes: time goes on by such steps, a pass at each.
  const idle=async ms=>{for(let left=ms;left>0;left-=2*MIN){clock+=Math.min(2*MIN,left);await chain.tick({sessionId:'s1'});}};
  return Object.assign(t,{chain,missions,advance:ms=>{clock+=ms;},idle,at:()=>clock,window,again:()=>t.make({now:()=>clock,window,...more})});
}

test('no progress note is sent to the Lead after a dev reports', async()=>{
  const t=await leadSetup();
  try{
    await t.chain.launch({sessionId:'s1',tickets:[FG2]});
    t.reports.push({ticket:'XJ-2',kind:'dev',commit:'a'.repeat(40),repo:'admin',summary:'fait',at:'2026-11-16T10:01:00.000Z'});
    await t.chain.tick({sessionId:'s1'});t.advance(5*MIN);await t.chain.tick({sessionId:'s1'});
    assert.deepEqual(t.sent.filter(x=>x.terminal==='t1'&&/Point d'avancement/.test(x.text)),[]);
    // The facts stay in the journal of the mission.
    assert.ok((await t.chain.read({sessionId:'s1'})).log.some(e=>/XJ-2/.test(e.text)));
  }finally{await t.cleanup();}
});

test('the news since the last wake goes at the end of the next message to the Lead, made from references only', ()=>{
  assert.equal(withNews('Tous les tickets sont acceptés.',[]),'Tous les tickets sont acceptés.');
  const text=withNews('Tous les tickets sont acceptés.',['XJ-2 : dev rendu, revue lancée','XJ-2 : accepté par la revue']);
  assert.match(text,/^Tous les tickets sont acceptés\./);
  assert.match(text,/XJ-2 : dev rendu, revue lancée · XJ-2 : accepté par la revue/);
});

test('a Lead idle long in Develop is put to rest once: its tab closed, the mission says when', async()=>{
  const t=await leadSetup();
  try{
    t.tab('PO · XJ-1').status='idle';
    await t.chain.tick({sessionId:'s1'});
    await t.idle(LEAD_REST_MS-MIN);
    assert.equal(t.calls.filter(([c,a])=>c==='tab.close'&&a.id==='po').length,0,'not yet');
    await t.idle(2*MIN);
    assert.equal(t.calls.filter(([c,a])=>c==='tab.close'&&a.id==='po').length,1);
    const m=await t.missions.read('M-1');
    assert.equal(typeof m.lead.restedAt,'string');
    assert.equal(m.lead.sessionId,'s1','the same Lead, to be woken again');
    await t.idle(30*MIN);
    assert.equal(t.calls.filter(([c,a])=>c==='tab.close'&&a.id==='po').length,1,'once');
  }finally{await t.cleanup();}
});

test('a Lead that works again starts its idle time over', async()=>{
  const t=await leadSetup();
  try{
    const lead=t.tab('PO · XJ-1');lead.status='idle';
    await t.chain.tick({sessionId:'s1'});
    await t.idle(LEAD_REST_MS-MIN);lead.status='working';await t.idle(2*MIN);
    lead.status='idle';await t.idle(2*MIN);
    assert.equal(t.calls.filter(([c,a])=>c==='tab.close'&&a.id==='po').length,0);
  }finally{await t.cleanup();}
});

test('a Lead is never put to rest in Prepare, where the user talks with it', async()=>{
  for(const step of ['delegated','analysing']){
    const t=await leadSetup(step);
    try{
      t.tab('PO · XJ-1').status='idle';
      await t.chain.tick({sessionId:'s1'});await t.idle(LEAD_REST_MS+MIN);
      assert.equal(t.calls.filter(([c,a])=>c==='tab.close'&&a.id==='po').length,0,step);
    }finally{await t.cleanup();}
  }
});

// The lock of a mission held by the test, taken for sure before it goes on: `release` lets it go.
async function holdLock(root,mission){
  let release,entered;const held=new Promise(r=>{release=r;}),inside=new Promise(r=>{entered=r;});
  const done=leadLock(root,mission,()=>{entered();return held;});
  await inside;
  return {release,done};
}
const closes=t=>t.calls.filter(([c,a])=>c==='tab.close'&&a.id==='po').length;
const restIt=async t=>{t.tab('PO · XJ-1').status='idle';await t.chain.tick({sessionId:'s1'});await t.idle(LEAD_REST_MS+MIN);};

test('a Lead on screen is never put to rest: the user may be typing to it', async()=>{
  const t=await leadSetup();
  try{
    t.look({space:'sp',tab:'po',name:'PO · XJ-1'});
    t.tab('PO · XJ-1').status='idle';
    await t.chain.tick({sessionId:'s1'});await t.idle(LEAD_REST_MS+MIN);
    assert.equal(closes(t),0);
  }finally{await t.cleanup();}
});

test('a close whose answer is lost still leaves a Lead at rest, to be woken', async()=>{
  const t=await leadSetup();
  try{
    t.core.faults.do=command=>command==='tab.close'?'lost':null;
    await restIt(t);
    assert.equal(t.agents.some(a=>a.address==='t1'),false,'the tab is closed');
    assert.equal(typeof (await t.missions.read('M-1')).lead.restedAt,'string');
  }finally{await t.cleanup();}
});

test('a close refused leaves the Lead awake, said once, and tried again after another idle time', async()=>{
  const t=await leadSetup();
  try{
    t.core.faults.do=command=>command==='tab.close'?'fail':null;
    await restIt(t);
    assert.equal((await t.missions.read('M-1')).lead.restedAt,undefined);
    assert.ok((await t.chain.read({sessionId:'s1'})).log.some(e=>/pas pu être mis au repos/.test(e.text)));
    t.core.faults.do=null;
    await t.chain.tick({sessionId:'s1'});assert.equal(closes(t),1,'not at once: only the refused one');
    await t.idle(LEAD_REST_MS+MIN);
    assert.equal(typeof (await t.missions.read('M-1')).lead.restedAt,'string');
  }finally{await t.cleanup();}
});

test('a watcher silent for a while counts the idle time of the Lead from when it sees it again', async()=>{
  const t=await leadSetup();
  try{
    t.tab('PO · XJ-1').status='idle';
    await t.chain.tick({sessionId:'s1'});
    t.advance(LEAD_REST_MS+MIN);await t.chain.tick({sessionId:'s1'});
    assert.equal(closes(t),0,'the gap is not counted');
  }finally{await t.cleanup();}
});

test('the chain still tells a Lead at rest: the message goes to its session, for the send to wake it', async()=>{
  const t=await leadSetup();
  try{
    await t.missions.update('M-1',m=>{m.lead={...m.lead,restedAt:'2026-11-16T09:00:00.000Z'};});
    t.agents.splice(t.agents.findIndex(a=>a.address==='t1'),1);
    await t.chain.launch({sessionId:'s1',tickets:[FG2]});
    t.reports.push({ticket:'XJ-2',kind:'block',name:'XJ-2.block.json',reason:'migration',at:'2026-11-16T10:01:00.000Z'});
    await t.chain.tick({sessionId:'s1'});
    assert.ok(t.sent.some(x=>x.sessionId==='s1'),JSON.stringify(t.sent.map(x=>x.text.slice(0,60))));
    assert.equal((await t.missions.read('M-1')).lead.lastSeen,null,'a Lead at rest is never seen');
  }finally{await t.cleanup();}
});

// The send of the backend over a Lead at rest in t1: waking it opens t9. The devs are told with the session of their
// Lead too (its id, their own terminal), as the chain does.
async function wakeSetup(){
  const root=await mkdtemp(join(tmpdir(),'fabrique-console-wake-'));
  const sent=[],woken=[];
  const state={sessions:[{id:'s1',role:'lead',missionId:'M-1',terminalId:'t1'}]};
  const mission={id:'M-1',lead:{sessionId:'s1',restedAt:'2026-11-16T09:00:00.000Z',closedTerminals:['t1']}};
  const missions={list:async()=>{if(w.listFails)throw new Error('unreadable');return [JSON.parse(JSON.stringify({...mission,issue:{id:'i1',identifier:'XJ-1'}}))];},read:async()=>JSON.parse(JSON.stringify(mission)),update:async(id,f)=>{const x=JSON.parse(JSON.stringify(mission));if(f(x)!==false)Object.assign(mission,x);return mission;}};
  const w={root,sent,woken,state,mission,failSend:false,listFails:false,cleanup:()=>rm(root,{recursive:true,force:true})};
  // Another process of the backend: the same files, nothing kept in memory between the two.
  w.another=()=>createLeadWake({root,loadState:async()=>state,missions,
    leadLaunch:async({mission:id})=>{woken.push(id);await new Promise(r=>setTimeout(r,20));delete mission.lead.restedAt;state.sessions[0].terminalId='t9';return {session:{id:'s1',terminalId:'t9'}};},
    send:async x=>{sent.push(x);if(w.failSend)throw Object.assign(new Error('lost'),{code:'SEND_UNSURE'});return {sent:true};}});
  w.wake=w.another();
  return w;
}

test('every message to a Lead at rest wakes it first, once, then goes to its new terminal', async()=>{
  const w=await wakeSetup();
  try{
    await w.wake({sessionId:'s1',terminal:'t1',text:'a'});
    await w.wake({sessionId:'s1',terminal:'t9',text:'b'});
    assert.deepEqual(w.woken,['M-1']);
    assert.deepEqual(w.sent.map(x=>[x.terminal,x.text]),[['t9','a'],['t9','b']]);
    assert.equal(typeof w.mission.lead.toldAt,'string','the mission says when the Lead was last told');
  }finally{await w.cleanup();}
});

test('a message to a dev, sent with the session of its Lead at rest, goes to the dev and wakes nobody', async()=>{
  const w=await wakeSetup();
  try{
    await w.wake({sessionId:'s1',terminal:'t5',text:'c'});
    assert.deepEqual(w.woken,[]);
    assert.deepEqual(w.sent.map(x=>[x.terminal,x.text]),[['t5','c']]);
    assert.equal(w.mission.lead.toldAt,undefined);
  }finally{await w.cleanup();}
});

test('a second message given the closed terminal of a Lead just woken goes to its new terminal', async()=>{
  const w=await wakeSetup();
  try{
    await w.wake({sessionId:'s1',terminal:'t1',text:'a'});
    await w.wake({sessionId:'s1',terminal:'t1',text:'b'});
    assert.deepEqual(w.woken,['M-1']);
    assert.deepEqual(w.sent.map(x=>x.terminal),['t9','t9']);
  }finally{await w.cleanup();}
});

test('two messages at once, given the closed terminal, wake the Lead once and both reach its new terminal', async()=>{
  const w=await wakeSetup();
  try{
    await Promise.all([w.wake({sessionId:'s1',terminal:'t1',text:'a'}),w.wake({sessionId:'s1',terminal:'t1',text:'b'})]);
    assert.deepEqual(w.woken,['M-1']);
    assert.deepEqual(w.sent.map(x=>x.terminal),['t9','t9']);
  }finally{await w.cleanup();}
});

test('another process given the closed terminal of a Lead woken meanwhile reaches its new terminal', async()=>{
  const w=await wakeSetup();
  try{
    await w.wake({sessionId:'s1',terminal:'t1',text:'a'});
    await w.another()({sessionId:'s1',terminal:'t1',text:'b'});
    assert.deepEqual(w.woken,['M-1']);
    assert.deepEqual(w.sent.map(x=>x.terminal),['t9','t9']);
  }finally{await w.cleanup();}
});

test('a message whose answer is lost still says the Lead was told: it may have arrived', async()=>{
  const w=await wakeSetup();
  try{
    delete w.mission.lead.restedAt;w.state.sessions[0].terminalId='t9';w.failSend=true;
    await assert.rejects(w.wake({sessionId:'s1',terminal:'t9',text:'a'}));
    assert.equal(typeof w.mission.lead.toldAt,'string');
  }finally{await w.cleanup();}
});

test('a launch of the Lead waits while its rest holds the lock of the mission', async()=>{
  const w=await wakeSetup();
  try{
    const {release,done:resting}=await holdLock(w.root,'M-1');
    const launching=w.wake.launch({mission:'M-1'});
    await new Promise(r=>setTimeout(r,60));
    assert.deepEqual(w.woken,[],'not while the rest holds the lock');
    release();await resting;await launching;
    assert.deepEqual(w.woken,['M-1']);
  }finally{await w.cleanup();}
});

test('a launch given anything but the id of a mission is refused before any lock is taken', async()=>{
  const w=await wakeSetup();
  try{
    for(const mission of ['../../..','M-1/../x',7])await assert.rejects(w.wake.launch({mission}),{code:'INVALID_ARGUMENT'});
    assert.deepEqual(w.woken,[]);
  }finally{await w.cleanup();}
});

test('a Lead launched again in its tab while the rest waited for the lock is not closed', async()=>{
  // The rest asks for its lock only after it saw the Lead idle long: the test holds it there, for sure, then lets it go.
  let asked,open;const asking=new Promise(r=>{asked=r;}),gate=new Promise(r=>{open=r;});
  const t=await leadSetup('building',{restLock:async(root,id,task)=>{asked();await gate;return leadLock(root,id,task);}});
  try{
    t.tab('PO · XJ-1').status='idle';
    await t.chain.tick({sessionId:'s1'});
    await t.idle(LEAD_REST_MS-MIN);
    const passing=t.idle(2*MIN);
    await asking;
    // Meanwhile a launch took the Lead up again: a new terminal, at work, in the same tab.
    const lead=t.tab('PO · XJ-1');lead.address='t9';lead.status='working';t.session.terminalId='t9';
    open();await passing;
    assert.equal(closes(t),0);
    assert.equal((await t.missions.read('M-1')).lead.restedAt,undefined);
  }finally{open();await t.cleanup();}
});

test('a close refused by the window, which does not answer then, leaves the Lead awake', async()=>{
  const t=await leadSetup();
  try{
    t.core.faults.do=command=>{if(command==='tab.close'){t.lsFails=true;return 'fail';}return null;};
    await restIt(t);
    assert.equal((await t.missions.read('M-1')).lead.restedAt,undefined);
    assert.equal(t.agents.some(a=>a.address==='t1'),true);
  }finally{await t.cleanup();}
});

test('a Lead put to rest keeps its closed terminal with its mission, for a message given it later', async()=>{
  const t=await leadSetup();
  try{
    await restIt(t);
    assert.deepEqual((await t.missions.read('M-1')).lead.closedTerminals,['t1']);
  }finally{await t.cleanup();}
});

test('a Lead told while it was idle starts its idle time over: it is not closed right after', async()=>{
  const t=await leadSetup();
  try{
    t.tab('PO · XJ-1').status='idle';
    await t.chain.tick({sessionId:'s1'});
    await t.idle(LEAD_REST_MS-MIN);
    // A message reaches it (its status still idle at once): the send of the backend says when.
    await t.missions.update('M-1',m=>{m.lead={...m.lead,toldAt:new Date(t.at()).toISOString()};});
    await t.idle(2*MIN);
    assert.equal(closes(t),0);
    assert.equal((await t.missions.read('M-1')).lead.restedAt,undefined);
  }finally{await t.cleanup();}
});

test('a close whose answer is lost, and a window that does not answer then, leave the Lead at rest', async()=>{
  const t=await leadSetup();
  try{
    t.core.faults.do=command=>{if(command==='tab.close'){t.lsFails=true;return 'lost';}return null;};
    await restIt(t);
    assert.equal(typeof (await t.missions.read('M-1')).lead.restedAt,'string');
  }finally{await t.cleanup();}
});

test('a new watcher counts the idle time of the Lead from its own first pass', async()=>{
  const t=await leadSetup();
  try{
    t.tab('PO · XJ-1').status='idle';
    await t.chain.tick({sessionId:'s1'});
    await t.idle(LEAD_REST_MS-MIN);
    // The watcher is started again two minutes later: what the Lead did meanwhile was not seen.
    t.advance(2*MIN);const next=t.again();
    await next.tick({sessionId:'s1'});
    assert.equal(closes(t),0);
  }finally{await t.cleanup();}
});

test('a resume refused because its dev still runs tells the Lead to ask the user at once', async()=>{
  const actions=createQuestionActions({questions:{},inbox:{},missions:{read:async()=>({id:'M-1'})},
    launch:async()=>({launched:[{identifier:'XJ-2',launched:false,reason:'already'}]}),unpaused:async(id,task)=>task()});
  const out=await actions.request({mission:'M-1',kind:'resume',tickets:[{identifier:'XJ-2'}]});
  assert.match(out.next,/tourne encore/);assert.match(out.next,/lead-escalate/);
  const fine=createQuestionActions({questions:{},inbox:{},missions:{read:async()=>({id:'M-1'})},launch:async()=>({launched:[{identifier:'XJ-2',launched:true}]}),unpaused:async(id,task)=>task()});
  assert.equal((await fine.request({mission:'M-1',kind:'resume',tickets:[{identifier:'XJ-2'}]})).next,undefined);
});

// End of a mission (point 30 and 31 of the brief): once closed, its Lead's tab is closed as soon as the Lead is idle,
// once; a Lead still at work is left to finish.
test('a closed mission keeps no Lead: its tab is closed once the Lead is idle, and only once', async()=>{
  const t=await leadSetup('validating');
  try{
    t.agents[0].status='working';
    await t.missions.update('M-1',m=>{m.step='closed';m.closeAskedAt='2026-11-17T08:00:00.000Z';});
    t.agents[0].status='idle';await t.chain.tickAll();
    assert.equal(t.calls.filter(([c,a])=>c==='tab.close'&&a.id==='po').length,0,'a mission closed before this version is left alone');
    t.agents[0].status='working';
    await t.missions.update('M-1',m=>{m.closeAskedAt='2026-11-17T21:00:00.000Z';});
    await t.chain.tickAll();
    assert.equal(t.calls.filter(([c,a])=>c==='tab.close'&&a.id==='po').length,0,'a Lead at work is left to finish');
    t.agents[0].status='idle';
    await t.chain.tickAll();await t.chain.tickAll();
    assert.equal(t.calls.filter(([c,a])=>c==='tab.close'&&a.id==='po').length,1);
    assert.ok((await t.missions.read('M-1')).lead.closedOutAt);
  }finally{await t.cleanup();}
});
