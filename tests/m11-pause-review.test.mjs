import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setup, news, devRuns, FG2, leadMission } from './helpers/dev-chain-setup.mjs';
import { createMissionRegistry } from '../src/mission.mjs';
import { createQuestionRegistry, createQuestionActions } from '../src/questions.mjs';
import { createRequestRegistry } from '../src/requests.mjs';
import { asScreen } from './helpers/versions.mjs';
import { createBackend } from '../src/backend.mjs';
import { withFakeHerdr } from './helpers/fake-herdr.mjs';
import { pageBand } from '../mods/fabrique-console-v4-ticket/page.js';

// ---- M11, first review. The pause is a barrier held under the lock of the launches (the lane of the mission): once it
// is confirmed, nothing starts. In pause nothing wakes an agent. A QA launch whose answer was lost keeps its
// reservation. « Paused » only when nothing may run. No change of step in pause.
const M={sessionId:'s1'},ONE={mission:'M-1'};
const A='a'.repeat(40),C='c'.repeat(40);
const DEV_A={ticket:'XJ-2',kind:'dev',commit:A,repo:'admin',summary:'fait',at:'2026-11-09T10:00:00.000Z'};
const DEV_C={ticket:'XJ-3',kind:'dev',commit:C,repo:'admin',summary:'fait',at:'2026-11-09T11:00:00.000Z'};
const accepted=(ticket,commit,at)=>({ticket,kind:'review-1',commit,verdict:'accepted',summary:'ok',at});
const stateOf=async t=>(await t.chain.read(ONE)).pause;
// The lane of the fake core says when a caller waits for its lock (M11 review 2): the click of « Pause » is then known to
// stand behind the operation under way, with no fixed delay. Its retry gives the turn back at once.
function laneWaits(){
  const box={};box.waiting=new Promise(r=>{box.hit=r;});
  box.wait=()=>{box.hit();return new Promise(r=>setTimeout(r,5));};
  return box;
}

// A transport that holds one call of the fake Herdr (a « faux noyau qui attend ») until it is released, and notes when
// a start takes effect: a dev made by the core, a tab made by the window.
function gated(){
  const box={t:null},events=[],lw=laneWaits();let held=null;
  const invoke=async(file,args,options)=>{
    if(held&&!held.hit&&held.match(file,args)){held.hit=true;held.reached();await held.open;}
    const out=await box.t.core.invoke(file,args,options);
    if(file==='hc'&&args[0]==='run')events.push('start:dev');
    if(file==='herdr-app'&&args[0]==='do'&&args[1]==='tab.new')events.push('start:'+JSON.parse(args[2]).name);
    return out;
  };
  const hold=match=>{let release;const open=new Promise(r=>{release=r;});const h={match,hit:false,open,reached:null};h.at=new Promise(r=>{h.reached=r;});h.release=release;held=h;return h;};
  return {box,events,invoke,hold,wait:lw.wait,waiting:lw.waiting};
}
// the user clicks « Pause » while a start is under way: the click is noted the moment the engine confirms it.
const pauseDuring=async(t,g,h,running)=>{
  await h.at;
  const p=t.chain.pause(ONE).then(r=>{g.events.push('paused');return r;},error=>{g.events.push('refused');return {error};});
  await g.waiting;h.release();
  await running;return p;
};
const startsAfterPause=events=>events.slice(events.indexOf('paused')+1).filter(e=>e.startsWith('start:'));

test('a pause written between the check and the launch of a dev: it is confirmed only once the launch is done, never before it (M11 review 1)',async()=>{
  const g=gated(),t=await setup({invoke:g.invoke,wait:g.wait});g.box.t=t;
  try{
    // The core waits on the first reading of the lane, after the gate of the launch and before the request.
    const h=g.hold((file,args)=>file==='hc'&&args[0]==='get');
    const p=await pauseDuring(t,g,h,t.chain.launch({...M,tickets:[FG2]}));
    assert.ok(g.events.includes('paused'));
    assert.deepEqual(startsAfterPause(g.events),[],'no start after a confirmed pause');
    assert.equal(p.pause.state,'requested','the dev launched before it is the agent that finishes its turn');
    await t.chain.tick(M);
    assert.equal(devRuns(t.calls,'XJ-2'),1);
  }finally{await t.cleanup();}
});

test('a pause written while a reviewer is being made: confirmed after it, and nothing starts after it (M11 review 1)',async()=>{
  const g=gated(),t=await setup({invoke:g.invoke,wait:g.wait});g.box.t=t;
  try{
    await t.chain.launch({...M,tickets:[FG2]});
    t.reports.push({...DEV_A});
    const h=g.hold((file,args)=>file==='herdr-app'&&args[0]==='do'&&args[1]==='tab.new'&&/ · revue/.test(args[2]));
    await pauseDuring(t,g,h,t.chain.tick(M));
    assert.deepEqual(startsAfterPause(g.events),[]);
    t.tab('XJ-2 · dev').status='idle';t.tab('XJ-2 · revue').status='idle';
    await t.chain.tick(M);await t.chain.tick(M);
    assert.deepEqual(startsAfterPause(g.events),[]);
    assert.equal((await stateOf(t)).state,'paused');
  }finally{await t.cleanup();}
});

// The launch of the QA agent takes the mission to Validation (step qa): the pause clicked meanwhile is read again under
// the lock and refused (M11 review 2), and nothing starts after it.
test('a pause clicked while the QA agent is being made: refused once the launch took the mission out of Develop, and nothing starts after it (M11 review 1, review 2)',async()=>{
  const g=gated(),t=await setup({invoke:g.invoke,wait:g.wait});g.box.t=t;
  try{
    await t.chain.launch({...M,tickets:[FG2]});
    t.reports.push({...DEV_A});await t.chain.tick(M);
    t.reports.push(accepted('XJ-2',A,'2026-11-09T10:05:00.000Z'));
    for(const a of t.agents)if(a.tab_name.startsWith('XJ-2'))a.status='idle';
    await t.chain.tick(M);await t.chain.tick(M);
    t.reports.push({...DEV_C});await t.chain.tick(M);
    t.reports.push(accepted('XJ-3',C,'2026-11-09T11:05:00.000Z'));
    for(const a of t.agents)if(a.tab_name.startsWith('XJ-3'))a.status='idle';
    const h=g.hold((file,args)=>file==='herdr-app'&&args[0]==='do'&&args[1]==='tab.new'&&/QA · XJ-1/.test(args[2]));
    const r=await pauseDuring(t,g,h,(async()=>{await t.chain.tick(M);await t.chain.tick(M);})());
    assert.equal(r.error?.code,'PAUSE_NOT_DEVELOP');
    assert.ok(g.events.includes('refused'));
    assert.deepEqual(g.events.slice(g.events.indexOf('refused')+1).filter(e=>e.startsWith('start:')),[]);
    assert.equal(news(t.calls).filter(x=>x==='QA · XJ-1').length,1);
    assert.equal((await stateOf(t)).state,'none','nothing written');
  }finally{await t.cleanup();}
});

test('a pause written while the corrections are being sent: confirmed after them, never before (M11 review 1)',async()=>{
  const events=[],lw=laneWaits();let hold=null;
  const t=await setup({wait:lw.wait,send:async x=>{if(hold&&/XJ-2\.review-1\.json/.test(x.text)){const h=hold;hold=null;h.reached();await h.open;events.push('start:fix');}t.sent.push(x);return {sent:true};}});
  try{
    await t.chain.launch({...M,tickets:[FG2]});
    t.reports.push({...DEV_A});await t.chain.tick(M);
    t.reports.push({ticket:'XJ-2',kind:'review-1',commit:A,verdict:'changes_requested',summary:'bug X',at:'2026-11-09T10:05:00.000Z'});
    let release,reached;const open=new Promise(r=>{release=r;}),at=new Promise(r=>{reached=r;});hold={open,reached};
    const running=t.chain.tick(M);await at;
    const p=t.chain.pause(ONE).then(()=>events.push('paused'));
    await lw.waiting;release();await running;await p;
    assert.deepEqual(events,['start:fix','paused']);
  }finally{await t.cleanup();}
});

// ---- Rule 2: in pause nothing wakes an agent.
const talk=t=>{const questions=createQuestionRegistry({root:t.root}),inbox=createRequestRegistry({root:t.root,notify:async()=>{}}),missions=createMissionRegistry({root:t.root});return {questions,inbox,actions:asScreen(createQuestionActions({questions,inbox,missions,launch:t.chain.launch}),inbox)};};
const ASK={name:'XJ-2.ask-1794000000000.json',ticket:'XJ-2',kind:'ask',at:'2026-11-10T10:00:00.000Z',question:'Quel rôle ?',options:['Garder','Fusionner'],from:'dev'};
const to=(t,terminal)=>t.sent.filter(x=>x.terminal===terminal);

test('in pause an answer is kept, never delivered: it reaches the dev once, after Resume (M11 review 1)',async()=>{
  const t=await setup(),{questions,actions}=talk(t);
  try{
    await leadMission(t.root);await t.chain.launch({mission:'M-1',tickets:[FG2]});t.reports.push({...ASK});
    await t.chain.tick(M);
    t.tab('XJ-2 · dev').status='blocked';
    await t.chain.pause(ONE);
    await actions.answer({question:'Q-1',text:'Garder'});
    // The answer is carried by the name of its file (decision 61): what reaches the dev is counted.
    const before=to(t,'tx1').length,answers=()=>to(t,'tx1').length-before;
    await t.chain.tick(M);await t.chain.tick(M);
    assert.equal(answers(),0,'the answer waits for Resume');
    assert.equal((await questions.read('Q-1')).state,'answered','kept');
    await t.chain.resume(ONE);await t.chain.tick(M);await t.chain.tick(M);
    assert.equal(answers(),1,'delivered once after Resume');
  }finally{await t.cleanup();}
});

test('in pause a question of a dev is kept and no Lead is made again; after Resume the Lead is made once (M11 review 1)',async()=>{
  const launched=[],t=await setup({leadLaunch:async input=>{launched.push(input);return {session:{id:'s1',terminalId:'t9'}};}}),{questions}=talk(t);
  try{
    await leadMission(t.root);await t.chain.launch({mission:'M-1',tickets:[FG2]});
    await t.chain.pause(ONE);
    t.reports.push({...ASK});t.agents.splice(t.agents.findIndex(a=>a.address==='t1'),1);
    await t.chain.tick(M);await t.chain.tick(M);
    assert.deepEqual(launched,[],'no Lead made in pause');
    assert.equal(to(t,'t9').length,0);
    assert.equal((await questions.list({mission:'M-1'})).length,1,'the question is kept, for the Inbox');
    await t.chain.resume(ONE);await t.chain.tick(M);await t.chain.tick(M);
    assert.deepEqual(launched,[{mission:'M-1'}]);
    assert.equal(to(t,'t9').length,1);
  }finally{await t.cleanup();}
});

test('in pause a stop said by a dev is written in the Inbox, and the Lead is told only after Resume (M11 review 1)',async()=>{
  const t=await setup(),inbox=createRequestRegistry({root:t.root,notify:async()=>{}});
  try{
    await t.chain.launch({...M,tickets:[FG2]});
    await t.chain.pause(ONE);
    t.reports.push({ticket:'XJ-2',kind:'block',name:'XJ-2.block-1762682520000.json',at:'2026-11-09T10:02:00.000Z',reason:'La migration 0026 ne passe pas.',migration:'0026'});
    const toLead=()=>t.sent.filter(x=>x.terminal==='t1'&&/lead-block/.test(x.text)).length;
    await t.chain.tick(M);await t.chain.tick(M);
    assert.equal(toLead(),0,'the Lead is not woken in pause');
    assert.equal((await inbox.list({mission:'M-1'})).filter(i=>i.type==='stuck'&&i.cause==='blocked').length,1,'the stop is shown');
    await t.chain.resume(ONE);await t.chain.tick(M);await t.chain.tick(M);
    assert.equal(toLead(),1);
  }finally{await t.cleanup();}
});

// ---- Rule 3: a QA launch whose answer was lost keeps its reservation, and is reconciled before any launch again.
const toAccepted=async t=>{
  await t.chain.launch({...M,tickets:[FG2]});
  t.reports.push({...DEV_A});await t.chain.tick(M);
  t.reports.push(accepted('XJ-2',A,'2026-11-09T10:05:00.000Z'));
  for(const a of t.agents)if(a.tab_name.startsWith('XJ-2'))a.status='idle';
  await t.chain.tick(M);await t.chain.tick(M);
  t.reports.push({...DEV_C});await t.chain.tick(M);
  t.reports.push(accepted('XJ-3',C,'2026-11-09T11:05:00.000Z'));
  for(const a of t.agents)if(a.tab_name.startsWith('XJ-3'))a.status='idle';
};
const qaMade=t=>news(t.calls).filter(x=>x==='QA · XJ-1').length;

test('a QA launch whose answer was lost, its tab not shown: never a second QA, the pause refused out of Develop, nor after a restart (M11 review 1, review 2)',async()=>{
  const t=await setup();
  try{
    await toAccepted(t);
    t.core.faults.do=(command,args)=>command==='tab.new'&&args.name==='QA · XJ-1'?'lost':null;
    t.core.faults.hidden=a=>a.tab_name==='QA · XJ-1';
    await t.chain.tick(M);
    assert.equal(qaMade(t),1);
    t.core.faults.do=null;
    // Its launch took the mission to Validation: no pause there (decision 106 point 7), and nothing is written.
    await assert.rejects(()=>t.chain.pause(ONE),e=>e.code==='PAUSE_NOT_DEVELOP');
    await t.chain.tick(M);
    assert.equal((await stateOf(t)).state,'none');
    const again=t.make();await again.tick(M);await again.tick(M);await t.chain.tick(M);
    assert.equal(qaMade(t),1,'no second QA');
    // It shows at last: it is that QA, settled, and still no other.
    t.core.faults.hidden=null;
    await t.chain.tick(M);await t.chain.tick(M);
    assert.equal(qaMade(t),1);
  }finally{await t.cleanup();}
});

test('a QA made for sure, then a write after it fails: its reservation stays, never a second QA (M11 review 1)',async()=>{
  const registry=createMissionRegistryLater();
  const t=await setup({missions:registry.proxy});registry.bind(createMissionRegistry({root:t.root}));
  try{
    await toAccepted(t);
    registry.failStep='qa';
    await t.chain.tick(M);
    assert.equal(qaMade(t),1);
    // The QA ends its turn: a reservation given back would make a second one now.
    t.tab('QA · XJ-1').status='idle';
    await t.chain.tick(M);await t.chain.tick(M);
    assert.equal(qaMade(t),1);
  }finally{await t.cleanup();}
});
// The registry of the missions, with a step that fails on demand.
function createMissionRegistryLater(){
  const out={real:null,failStep:null,bind(r){out.real=r;}};
  out.proxy=new Proxy({},{get:(_o,key)=>key==='setStep'?async(id,step,line)=>{if(step===out.failStep)throw new Error('disk full');return out.real.setStep(id,step,line);}:(...args)=>out.real[key](...args)});
  return out;
}

// ---- Rule 4: « Paused » only when nothing may run; the cause is shown, an alert if it lasts.
test('a reviewer whose launch was lost and is not shown keeps the mission « Pausing », with its cause, then an alert (M11 review 1)',async()=>{
  let clock=Date.parse('2026-11-09T10:01:00.000Z');
  const t=await setup({now:()=>clock});
  try{
    await t.chain.launch({...M,tickets:[FG2]});
    t.reports.push({...DEV_A});
    t.core.faults.do=(command,args)=>command==='tab.new'&&/ · revue/.test(args.name)?'lost':null;
    t.core.faults.hidden=a=>/ · revue/.test(a.tab_name);
    await t.chain.tick(M);
    t.core.faults.do=null;
    await t.chain.pause(ONE);
    t.tab('XJ-2 · dev').status='idle';
    await t.chain.tick(M);await t.chain.tick(M);
    let p=await stateOf(t);
    assert.equal(p.state,'requested','a reviewer that may be at work keeps it asked');
    assert.deepEqual(p.waiting.map(w=>[w.role,w.ticket,w.why]),[['reviewer','XJ-2','not-seen']]);
    assert.ok(!p.alert,'no alert yet');
    clock+=6*60000;await t.chain.tick(M);
    p=await stateOf(t);
    assert.equal(p.state,'requested','never paused on a delay');
    assert.equal(p.alert,true,'the cause lasts: an alert');
    // It shows: nothing runs any more once its turn is over.
    t.core.faults.hidden=null;t.tab('XJ-2 · revue').status='done';
    await t.chain.tick(M);await t.chain.tick(M);
    p=await stateOf(t);
    assert.equal(p.state,'paused');
    assert.equal(p.waiting,undefined);
  }finally{await t.cleanup();}
});

test('the banner says what « Pausing » waits for, and turns to an alert when the cause lasts (M11 review 1)',()=>{
  const mission={step:'building',tickets:[{id:'XJ-2',state:'review',rounds:0}]};
  const waits={state:'requested',at:'2026-11-09T10:00:00.000Z',waiting:[{role:'reviewer',ticket:'XJ-2',why:'not-seen',since:'2026-11-09T10:00:00.000Z'}],agent:{role:'reviewer'}};
  const calm=pageBand({mission,pause:waits});
  assert.equal(calm.tone,'off');
  assert.match(calm.det,/XJ-2/);
  assert.equal(calm.button.key,'resume');
  const loud=pageBand({mission,pause:{...waits,alert:true}});
  assert.equal(loud.tone,'stop','an alert');
  assert.match(loud.det,/XJ-2/);
  assert.equal(loud.button.key,'resume','still no resume on its own: the user decides');
});

// ---- Rule 5: no change of step in pause.
const backendOf=async t=>{
  const root=await realpath(await mkdtemp(join(tmpdir(),'fabrique-console-pause-')));t.after(()=>rm(root,{recursive:true,force:true}));
  const make=()=>createBackend(withFakeHerdr({root,env:{...process.env,FABRIQUE_CONSOLE_AGENT:''},exec:async()=>{throw new Error('nothing runs');}}));
  return {root,backend:make()};
};
test('in pause the Lead cannot take the mission to Validation nor close it; after Resume it can (M11 review 1)',async t=>{
  const {root,backend}=await backendOf(t),missions=createMissionRegistry({root});
  await missions.create({project:'alpha',issue:{id:'i1',identifier:'XJ-1',title:'Paiement',url:'u'},request:'Payer'});
  await missions.setStep('M-1','building','devs');
  await backend.dispatch('mission-pause',ONE);
  await assert.rejects(()=>backend.dispatch('lead-request',{mission:'M-1',kind:'validation',text:'Bilan'}),e=>e.code==='MISSION_PAUSED');
  await missions.update('M-1',m=>{m.closeAskedAt='2026-11-09T12:00:00.000Z';});
  await assert.rejects(()=>backend.dispatch('lead-close',ONE),e=>e.code==='MISSION_PAUSED');
  assert.equal((await missions.read('M-1')).step,'building','the step did not move');
  assert.equal((await backend.dispatch('inbox-list',{})).items.filter(i=>i.type==='validation').length,0,'nothing written');
  await backend.dispatch('mission-resume',ONE);
  await backend.dispatch('lead-request',{mission:'M-1',kind:'validation',text:'Bilan'});
  assert.equal((await missions.read('M-1')).step,'validating');
});
