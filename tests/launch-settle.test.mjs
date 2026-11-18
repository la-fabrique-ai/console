import test from 'node:test';
import assert from 'node:assert/strict';
import { setup, leadMission, FG2 } from './helpers/dev-chain-setup.mjs';
import { launchSettled, LAUNCH_SETTLE_MS } from '../src/mission.mjs';

// Decision 72: a launch whose fate is unknown is never sent again on its own; the tool establishes whether the dev left
// (the chain launched it, the mission left Prepare: asked) or not (no dev, the Lead at rest, long after the message:
// failed, and the approval may be asked again by a click). Herdr out of reach establishes nothing.
const T0=Date.parse('2026-11-14T10:00:00Z'),min=n=>n*60000;

test('the rule: started as soon as a dev is known launched; not started only once the Lead rests long after the message',()=>{
  const m=(state,more={})=>({step:'analysing',launch:{state,at:new Date(T0).toISOString(),saidAt:new Date(T0).toISOString()},...more});
  assert.equal(launchSettled(m('unknown'),{chainOn:true,lead:'working',now:T0}),'asked');
  assert.equal(launchSettled(m('unknown',{step:'building'}),{chainOn:false,lead:'idle',now:T0}),'asked');
  assert.equal(launchSettled(m('unknown'),{chainOn:false,lead:'idle',now:T0+LAUNCH_SETTLE_MS-1}),null,'too early');
  assert.equal(launchSettled(m('unknown'),{chainOn:false,lead:'working',now:T0+min(60)}),null,'the Lead at work may be launching');
  assert.equal(launchSettled(m('unknown'),{chainOn:false,lead:'blocked',now:T0+min(60)}),null,'the Lead held in its terminal');
  assert.equal(launchSettled(m('unknown'),{chainOn:false,lead:'idle',now:T0+LAUNCH_SETTLE_MS}),'failed');
  assert.equal(launchSettled(m('unknown'),{chainOn:false,lead:'absent',now:T0+LAUNCH_SETTLE_MS}),'failed');
  assert.equal(launchSettled(m('unknown'),{chainOn:false,lead:null,now:T0+min(60)}),null,'Herdr out of reach: nothing is established');
  assert.equal(launchSettled(m('asking'),{chainOn:false,lead:'idle',now:T0+LAUNCH_SETTLE_MS}),'failed','a stop midway, as unknown');
  for(const state of ['asked','failed'])assert.equal(launchSettled(m(state),{chainOn:true,lead:'idle',now:T0+min(60)}),null,state);
  assert.equal(launchSettled({step:'analysing'},{chainOn:true,lead:'idle',now:T0}),null);
});

async function unknownLaunch(t,at=T0){
  const {missions}=await leadMission(t.root);
  await missions.update('M-1',m=>{m.launch={state:'unknown',at:new Date(at).toISOString(),saidAt:new Date(at).toISOString()};});
  return missions;
}
test('the watcher: the Lead at rest long after an unknown launch, no dev: failed, said in the journal, nothing sent',async()=>{
  const t=await setup();
  try{
    let now=T0;const missions=await unknownLaunch(t),chain=t.make({now:()=>now});
    now=T0+min(5);await chain.tick({sessionId:'s1'});
    assert.equal((await missions.read('M-1')).launch.state,'unknown','too early');
    now=T0+LAUNCH_SETTLE_MS+1000;await chain.tick({sessionId:'s1'});
    const m=await missions.read('M-1');
    assert.equal(m.launch.state,'failed');assert.equal(m.launch.settled,'not-started');assert.ok(m.launch.settledAt);
    assert.ok(m.log.some(e=>e.text==='Launch checked: no dev start was recorded. You can request the launch again.'),JSON.stringify(m.log));
    assert.equal(t.sent.length,0,'nothing is sent again on its own');
  }finally{await t.cleanup();}
});
test('the watcher: the dev launched by the chain settles an unknown launch as started',async()=>{
  const t=await setup();
  try{
    let now=T0;const missions=await unknownLaunch(t),chain=t.make({now:()=>now});
    await chain.launch({mission:'M-1',fresh:false,tickets:[FG2]});
    await chain.tick({sessionId:'s1'});
    const m=await missions.read('M-1');
    assert.equal(m.launch.state,'asked');assert.equal(m.launch.settled,'started');
    // Decision 87: said by what proves it, never « the dev left ».
    assert.ok(m.log.some(e=>e.text==='Launch checked: the ticket sequence is enabled.'),JSON.stringify(m.log));
  }finally{await t.cleanup();}
});
test('the watcher: the mission past Prepare, the chain off, settles an unknown launch by its stage (decision 87)',async()=>{
  const t=await setup();
  try{
    let now=T0;const missions=await unknownLaunch(t),chain=t.make({now:()=>now});
    await missions.update('M-1',m=>{m.step='building';});
    await chain.tick({sessionId:'s1'});
    const m=await missions.read('M-1');
    assert.equal(m.launch.state,'asked');assert.equal(m.launch.settled,'started');
    assert.ok(m.log.some(e=>e.text==='Launch checked: the mission is in Develop.'),JSON.stringify(m.log));
    assert.ok(!m.log.some(e=>/ticket sequence/.test(e.text)),'the chain is off: never said enabled');
  }finally{await t.cleanup();}
});
test('the watcher: the Lead at work, or Herdr out of reach, settle nothing',async()=>{
  const t=await setup();
  try{
    let now=T0+LAUNCH_SETTLE_MS*3;const missions=await unknownLaunch(t);
    t.agents[0].status='working';await t.make({now:()=>now}).tick({sessionId:'s1'});
    assert.equal((await missions.read('M-1')).launch.state,'unknown');
    t.agents[0].status='idle';
    const mute=t.make({now:()=>now,window:{...t.core.herdr.window,ls:async()=>{throw Object.assign(new Error('mute'),{code:'HC_UNAVAILABLE'});}}});
    await mute.tick({sessionId:'s1'}).catch(()=>{});
    assert.equal((await missions.read('M-1')).launch.state,'unknown');
  }finally{await t.cleanup();}
});

// M5 review 2: a Lead that ended its turn (done), or whose session is stopped, rests as an idle one does: the banner
// « Checking the launch… » always goes in the end.
test('the rule: a Lead done, or stopped, rests as an idle one does',()=>{
  const m={step:'analysing',launch:{state:'unknown',at:new Date(T0).toISOString(),saidAt:new Date(T0).toISOString()}};
  assert.equal(launchSettled(m,{chainOn:false,lead:'done',now:T0+LAUNCH_SETTLE_MS}),'failed');
  assert.equal(launchSettled(m,{chainOn:false,lead:'done',now:T0+LAUNCH_SETTLE_MS-1}),null,'too early');
  assert.equal(launchSettled(m,{chainOn:false,lead:'stopped',now:T0+LAUNCH_SETTLE_MS}),'failed');
});
test('the watcher: the Lead done long after an unknown launch, no dev: failed, nothing sent',async()=>{
  const t=await setup();
  try{
    let now=T0+LAUNCH_SETTLE_MS+1000;const missions=await unknownLaunch(t);
    t.agents[0].status='done';await t.make({now:()=>now}).tick({sessionId:'s1'});
    const m=await missions.read('M-1');
    assert.equal(m.launch.state,'failed');assert.equal(m.launch.settled,'not-started');assert.equal(t.sent.length,0);
  }finally{await t.cleanup();}
});
test('the watcher: the session of the Lead stopped settles the unknown launch as not started, by the mission',async()=>{
  const t=await setup();
  try{
    let now=T0+min(5);const missions=await unknownLaunch(t),chain=t.make({now:()=>now});
    t.session.stoppedAt=new Date(T0).toISOString();
    await chain.tick({mission:'M-1'});
    assert.equal((await missions.read('M-1')).launch.state,'unknown','too early');
    now=T0+LAUNCH_SETTLE_MS+1000;await chain.tickAll();
    const m=await missions.read('M-1');
    assert.equal(m.launch.state,'failed');assert.equal(m.launch.settled,'not-started');
    assert.ok(m.log.some(e=>e.text==='Launch checked: no dev start was recorded. You can request the launch again.'),JSON.stringify(m.log));assert.equal(t.sent.length,0);
  }finally{await t.cleanup();}
});
