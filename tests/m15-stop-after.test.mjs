import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setup, news, devRuns, FG2 } from './helpers/dev-chain-setup.mjs';
import { createMissionRegistry, stopAfterOf } from '../src/mission.mjs';
import { createBackend, SCREEN_COMMANDS } from '../src/backend.mjs';
import { withFakeHerdr } from './helpers/fake-herdr.mjs';
import { AGENT_MARK } from '../ui/v3/view.js';
import { launchAsk } from '../src/agent-texts.mjs';

// ---- Chantier 1, point 16 (the user, 2026-11-16): the limit the user gives at the launch is kept. « On s'arrête à la fin
// de Develop »: once every ticket is accepted, neither the QA agent nor the Validation start, and the mission says it is
// held there. The limit is the user's: set from the screens (or by Pilot when it hands the issue to a Lead), never by the
// Lead. Set back to Validate, the mission goes on as before.
const M={sessionId:'s1'},ONE={mission:'M-1'};
const A='a'.repeat(40),C='c'.repeat(40);
const qa=t=>news(t.calls).filter(x=>x==='QA · XJ-1').length;
const toValidation=t=>t.sent.filter(x=>x.terminal==='t1'&&/XJ-2/.test(x.text)&&/XJ-3/.test(x.text)&&/[Vv]alidation/.test(x.text)).length;

// Both tickets developed and accepted, as the watcher sees them.
async function bothAccepted(t,chain=t.chain){
  await chain.launch({...M,tickets:[FG2]});
  t.reports.push({ticket:'XJ-2',kind:'dev',commit:A,repo:'admin',summary:'fait',at:'2026-11-09T10:00:00.000Z'});await chain.tick(M);
  t.reports.push({ticket:'XJ-2',kind:'review-1',commit:A,verdict:'accepted',summary:'ok',at:'2026-11-09T10:05:00.000Z'});
  for(const a of t.agents)if(a.tab_name.startsWith('XJ-2'))a.status='idle';
  await chain.tick(M);await chain.tick(M);
  assert.equal(devRuns(t.calls,'XJ-3'),1,'XJ-3 starts after XJ-2');
  t.reports.push({ticket:'XJ-3',kind:'dev',commit:C,repo:'admin',summary:'fait',at:'2026-11-09T11:00:00.000Z'});await chain.tick(M);
  t.reports.push({ticket:'XJ-3',kind:'review-1',commit:C,verdict:'accepted',summary:'ok',at:'2026-11-09T11:05:00.000Z'});
  for(const a of t.agents)if(a.tab_name.startsWith('XJ-3'))a.status='idle';
  await chain.tick(M);await chain.tick(M);
}
const limit=(root,value)=>createMissionRegistry({root}).update('M-1',m=>{m.stopAfter=value;});

test('the limit of a mission: Validate unless the user said Develop',()=>{
  assert.equal(stopAfterOf({}),'validate','a mission of before goes to Validation, as it did');
  assert.equal(stopAfterOf({stopAfter:'develop'}),'develop');
  assert.equal(stopAfterOf({stopAfter:'validate'}),'validate');
  assert.equal(stopAfterOf({stopAfter:'nonsense'}),'validate');
});

test('stopped after Develop: every ticket accepted, no QA agent and no Validation; said once, even after a restart (point 16)',async()=>{
  const t=await setup();
  try{
    await limit(t.root,'develop');
    await bothAccepted(t);
    assert.equal(qa(t),0,'no QA agent');
    assert.equal(toValidation(t),0,'the Lead is not asked for the Validation');
    assert.deepEqual(t.steps,[],'the session does not move to the check');
    const m=await createMissionRegistry({root:t.root}).read('M-1');
    assert.notEqual(m.step,'qa');assert.notEqual(m.step,'validating');
    assert.ok(m.heldAt,'the mission says it is held at the end of Develop');
    const held=l=>(l.log||[]).filter(x=>/Develop/.test(x.text)&&/stop/i.test(x.text)).length;
    assert.equal(held(await t.chain.read(ONE)),1,'said once in the journal');
    assert.equal(t.notified.filter(([,text])=>/Stopped here/.test(text)).length,1,'the user is notified of this stop, once');
    // The tool starts again, and ticks: still nothing.
    const again=t.make();await again.tick(M);await again.tick(M);
    assert.equal(qa(t),0);assert.equal(toValidation(t),0);
    assert.equal(held(await again.read(ONE)),1,'not said twice');
  }finally{await t.cleanup();}
});

test('set back to Validate, the held mission goes on: one QA agent and the Validation (point 16)',async()=>{
  const t=await setup();
  try{
    await limit(t.root,'develop');
    await bothAccepted(t);
    assert.equal(qa(t),0);
    await limit(t.root,'validate');
    await t.chain.tick(M);await t.chain.tick(M);
    assert.equal(qa(t),1,'the QA agent starts once');
    assert.deepEqual(t.steps,[{sessionId:'s1',step:'check'}]);
  }finally{await t.cleanup();}
});

test('with no limit said, nothing changes: QA and Validation as before',async()=>{
  const t=await setup();
  try{
    await bothAccepted(t);
    assert.equal(qa(t),1);
    assert.deepEqual(t.steps,[{sessionId:'s1',step:'check'}]);
    assert.equal((await createMissionRegistry({root:t.root}).read('M-1')).heldAt,undefined);
  }finally{await t.cleanup();}
});

// ---- The commands.
const backendOf=async(t,env={})=>{
  const root=await realpath(await mkdtemp(join(tmpdir(),'fabrique-console-stop-after-')));t.after(()=>rm(root,{recursive:true,force:true}));
  const backend=createBackend(withFakeHerdr({root,env:{...process.env,FABRIQUE_CONSOLE_AGENT:'',...env},exec:async()=>{throw new Error('nothing runs');}}));
  return {root,backend,missions:createMissionRegistry({root})};
};
const create=missions=>missions.create({project:'alpha',issue:{id:'i1',identifier:'XJ-1',title:'Paiement',url:'u'},request:'Payer'});

test('mission-stop-after: a command of the screens, refused from a session of an agent (point 16)',async t=>{
  assert.ok(SCREEN_COMMANDS.includes('mission-stop-after'));
  const {backend,missions}=await backendOf(t,{[AGENT_MARK]:'1'});
  await create(missions);
  await assert.rejects(()=>backend.dispatch('mission-stop-after',{mission:'M-1',stopAfter:'develop'}),e=>e.code==='AGENT_SESSION');
  assert.equal((await missions.read('M-1')).stopAfter,undefined,'nothing written');
});

test('mission-stop-after: develop or validate only; not on a mission past Develop or over (point 16)',async t=>{
  const {backend,missions}=await backendOf(t);
  await create(missions);
  await assert.rejects(()=>backend.dispatch('mission-stop-after',{mission:'M-1',stopAfter:'qa'}),e=>e.code==='INVALID_ARGUMENT');
  const out=await backend.dispatch('mission-stop-after',{mission:'M-1',stopAfter:'develop'});
  assert.equal(out.stopAfter,'develop');
  assert.equal((await missions.read('M-1')).stopAfter,'develop');
  // Back to Validate: allowed at any time before the end; it lifts the hold.
  await missions.update('M-1',m=>{m.step='building';m.heldAt='2026-11-09T12:00:00.000Z';});
  assert.equal((await backend.dispatch('mission-stop-after',{mission:'M-1',stopAfter:'validate'})).stopAfter,'validate');
  assert.equal((await missions.read('M-1')).heldAt,undefined,'the hold is lifted');
  // Past Develop, Develop can no longer be the limit.
  await missions.setStep('M-1','validating','validation demandée');
  await assert.rejects(()=>backend.dispatch('mission-stop-after',{mission:'M-1',stopAfter:'develop'}),e=>e.code==='MISSION_PAST_DEVELOP');
  await missions.setStep('M-1','closed','clos');
  await assert.rejects(()=>backend.dispatch('mission-stop-after',{mission:'M-1',stopAfter:'validate'}),e=>e.code==='MISSION_OVER');
});

test('stopped after Develop, the Lead cannot take the mission to Validation (point 16)',async t=>{
  const {backend,missions}=await backendOf(t);
  await create(missions);
  await missions.setStep('M-1','building','devs');
  await missions.update('M-1',m=>{m.stopAfter='develop';});
  await assert.rejects(()=>backend.dispatch('lead-request',{mission:'M-1',kind:'validation',text:'Bilan'}),e=>e.code==='MISSION_STOPS_AFTER_DEVELOP');
  assert.equal((await missions.read('M-1')).step,'building','the step did not move');
  assert.equal((await backend.dispatch('inbox-list',{})).items.filter(i=>i.type==='validation').length,0,'nothing written');
});

test('the launch message tells the Lead where to stop (point 16)',()=>{
  assert.match(launchAsk({issue:'XJ-1',at:'2026-11-09T09:05:00.000Z',stopAfter:'develop'}),/fin de Develop/);
  assert.doesNotMatch(launchAsk({issue:'XJ-1',at:'2026-11-09T09:05:00.000Z'}),/fin de Develop/);
});

test('lead-launch: the limit comes from Pilot, never from the Lead itself (point 16)',async t=>{
  const {root,backend}=await backendOf(t,{[AGENT_MARK]:'1',FABRIQUE_CONSOLE_ROLE:'lead'});
  await assert.rejects(()=>backend.dispatch('lead-launch',{project:'alpha',issueId:'i1',request:'Payer',stopAfter:'develop'}),e=>e.code==='STOP_AFTER_RESERVED');
  assert.equal((await createMissionRegistry({root}).list()).length,0,'nothing written');
});

// ---- Review 1 of 1A (Codex).
test('lead-launch: a dev, a reviewer or a QA agent cannot set the limit either; only Pilot, by its mark (review 1)',async t=>{
  const {root,backend}=await backendOf(t,{[AGENT_MARK]:'1',FABRIQUE_CONSOLE_ROLE:''});
  await assert.rejects(()=>backend.dispatch('lead-launch',{project:'alpha',issueId:'i1',request:'Payer',stopAfter:'validate'}),e=>e.code==='STOP_AFTER_RESERVED');
  assert.equal((await createMissionRegistry({root}).list()).length,0,'nothing written');
});

test('Pilot carries its own role mark, distinct from the Lead and from the other agents (review 1)',async()=>{
  const { agentMark, PILOT_ROLE } = await import('../ui/v3/view.js');
  assert.equal(PILOT_ROLE,'pilot');
  assert.match(agentMark('claude','pilot').join(' '),/"FABRIQUE_CONSOLE_ROLE":"pilot"/);
  assert.doesNotMatch(agentMark('claude').join(' '),/FABRIQUE_CONSOLE_ROLE/);
});

test('the limit is read under the lock of the lane: a Develop limit written while the Validation waited for it wins (review 1)',async t=>{
  const { createQuestionActions } = await import('../src/questions.mjs');
  const {missions}=await backendOf(t);
  await create(missions);await missions.setStep('M-1','building','devs');
  const asked=[];
  const actions=createQuestionActions({questions:null,inbox:{ask:async x=>{asked.push(x);return {item:'I-1',created:true};}},missions,launch:null,
    // The screen confirms Develop while the request waits for the lane.
    unpaused:async(id,task)=>{await missions.update(id,m=>{m.stopAfter='develop';});return task();}});
  await assert.rejects(()=>actions.request({mission:'M-1',kind:'validation',text:'Bilan'}),e=>e.code==='MISSION_STOPS_AFTER_DEVELOP');
  assert.equal(asked.length,0);assert.equal((await missions.read('M-1')).step,'building');
});

test('mission-stop-after writes under the lock of the lane of the chain (review 1)',async t=>{
  const { createMissionActions } = await import('../src/mission.mjs');
  const {missions}=await backendOf(t);
  await create(missions);
  const held=[];
  const actions=createMissionActions({registry:missions,chain:{underLane:async(id,task)=>{held.push(id);const out=await task();held.push('released');return out;}}});
  await actions.stopAfter({mission:'M-1',stopAfter:'develop'});
  assert.deepEqual(held,['M-1','released']);
  assert.equal((await missions.read('M-1')).stopAfter,'develop');
});

test('a correction after the hold: the mission is no longer held while it is worked on, then held again (review 1)',async()=>{
  const t=await setup();
  try{
    await limit(t.root,'develop');
    await bothAccepted(t);
    const reg=createMissionRegistry({root:t.root});
    assert.ok((await reg.read('M-1')).heldAt);
    // XJ-3 delivered again (a correction): in review, not over.
    t.reports.push({ticket:'XJ-3',kind:'dev',commit:'d'.repeat(40),repo:'admin',summary:'correction',at:'2026-11-09T12:00:00.000Z'});
    await t.chain.tick(M);
    assert.equal((await reg.read('M-1')).heldAt,undefined,'no longer held while worked on');
    t.reports.push({ticket:'XJ-3',kind:'review-1',commit:'d'.repeat(40),verdict:'accepted',summary:'ok',at:'2026-11-09T12:05:00.000Z'});
    for(const a of t.agents)if(a.tab_name.startsWith('XJ-3'))a.status='idle';
    await t.chain.tick(M);await t.chain.tick(M);
    assert.ok((await reg.read('M-1')).heldAt,'held again');
    assert.equal(qa(t),0);
  }finally{await t.cleanup();}
});

test('a notification of the hold that failed is tried again at the next pass, then not again (1A review 2)',async()=>{
  let fails=1;const shown=[];
  const t=await setup({notify:async(title,text)=>{if(/Stopped here/.test(text)&&fails-->0)return false;shown.push(text);return true;}});
  try{
    await limit(t.root,'develop');
    await bothAccepted(t);
    await t.chain.tick(M);await t.chain.tick(M);
    assert.equal(shown.filter(x=>/Stopped here/.test(x)).length,1,'shown once, after the failure');
  }finally{await t.cleanup();}
});

test('macNotify says whether the notification was shown (1A review 2)',async()=>{
  const { macNotify } = await import('../src/dev-chain.mjs');
  assert.equal(await macNotify({invoke:async()=>{}})('t','x'),true);
  assert.equal(await macNotify({invoke:async()=>{throw new Error('osascript');}})('t','x'),false);
});
