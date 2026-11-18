import test from 'node:test';
import assert from 'node:assert/strict';
import { setup, leadMission, devRuns, FG2 } from './helpers/dev-chain-setup.mjs';
import { createMissionActions } from '../src/mission.mjs';
import { sayOnce } from '../src/dev-chain.mjs';
import { createQuestionRegistry } from '../src/questions.mjs';
import { createRequestRegistry } from '../src/requests.mjs';
import { launchState } from '../mods/fabrique-console-v4-ticket/nav.js';

// M7, the rests of M5 (decision 80). A launch the Lead asked for that starts no dev, whatever the reason (a failure of
// the ticket itself before the core is asked, or every ticket refused for good), is said not started: never « parti »,
// never « Launch checked: … » as if a dev had left (decision 87). A ticket refused for its turn (it waits) leaves the series on, as before.
const T0=Date.parse('2026-11-14T10:00:00Z');
const FG3={...FG2,identifier:'XJ-3'};
const askedLaunch=async t=>{
  const {missions}=await leadMission(t.root);
  await missions.update('M-1',m=>{m.launch={state:'asked',at:new Date(T0).toISOString(),saidAt:new Date(T0).toISOString()};m.launchAskedAt=m.launch.saidAt;});
  return missions;
};
const neverLeft=async(t,missions)=>{
  const m=await missions.read('M-1');
  assert.equal(m.launch.state,'failed',JSON.stringify(m.launch));assert.equal(m.launch.settled,'not-started');
  assert.ok(m.log.some(e=>/^Launch failed( \([A-Z_]+\))?\. No dev was started\. You can request the launch again\.$/.test(e.text)),JSON.stringify(m.log));
  assert.ok(!m.log.some(e=>/^Launch checked: the (ticket sequence|mission is in)/.test(e.text)),'never said left');
  assert.notEqual(m.step,'building');
};

test('the branch of the ticket fails before the core is asked: not started, the chain off, never said left',async()=>{
  const t=await setup({ticketBranch:async()=>{throw Object.assign(new Error('branch xj-1-XJ-2 already used'),{code:'BRANCH_TAKEN'});}});
  try{
    let now=T0+60000;const missions=await askedLaunch(t),chain=t.make({now:()=>now});
    const out=await chain.launch({mission:'M-1',fresh:false,tickets:[FG2]});
    assert.equal(out.launched[0].launched,false);assert.equal(devRuns(t.calls,'XJ-2'),0);
    assert.equal((await chain.read({mission:'M-1'})).on,false,'no dev was asked: the chain is not on');
    await neverLeft(t,missions);
    // The watcher long after: still not started, and it launches nothing on its own.
    now=T0+20*60000;await t.make({now:()=>now}).tick({sessionId:'s1'});
    await neverLeft(t,missions);assert.equal(devRuns(t.calls,'XJ-2'),0);
    assert.equal(launchState(await missions.read('M-1'),{address:'t1',status:'idle'},now),'offer','the approval is offered again');
  }finally{await t.cleanup();}
});

for(const [what,ticket,reason] of [['the plan gives it otherwise',{...FG2,model:'claude-opus-5-5'},'plan-differs'],['its identity was never read',FG2,'unverified']]) {
  test('every ticket asked is refused for good ('+what+'): not started, never said left',async()=>{
    const t=await setup();
    try{
      const missions=await askedLaunch(t);
      if(reason==='unverified')await missions.update('M-1',m=>{m.plan.tickets=m.plan.tickets.map(x=>({...x,uid:null}));m.approval.plan.tickets=m.approval.plan.tickets.map(x=>({...x,uid:null}));});
      if(reason==='unverified')t.issue.children=[];
      const out=await t.chain.launch({mission:'M-1',fresh:false,tickets:[ticket]});
      assert.deepEqual(out.launched.map(x=>x.reason),[reason]);
      assert.equal((await t.chain.read({mission:'M-1'})).on,false);
      await neverLeft(t,missions);
    }finally{await t.cleanup();}
  });
}

test('a ticket refused for its turn (it waits for another) leaves the series on, as before',async()=>{
  const t=await setup();
  try{
    const missions=await askedLaunch(t);
    const out=await t.chain.launch({mission:'M-1',fresh:false,tickets:[FG3]});
    assert.deepEqual(out.launched.map(x=>x.reason),['waits']);
    assert.equal((await t.chain.read({mission:'M-1'})).on,true);
    assert.equal((await missions.read('M-1')).launch.state,'asked');
  }finally{await t.cleanup();}
});

// The click and the failure meet (M5 review, minor 2): the Lead fails before the click has written « asked ». The
// failure stays: « asked » written after it would leave an asked launch with no dev and nothing to click.
test('the Lead fails its launch while the click is still sending: the failure is not covered by « asked »',async()=>{
  const t=await setup({},{},{approved:false});
  try{
    const {missions}=await leadMission(t.root),questions=createQuestionRegistry({root:t.root});
    const broken=t.make({ensureWorktree:async()=>{throw Object.assign(new Error('git worktree add failed'),{code:'WORKTREE_FAILED'});}});
    const screen=createMissionActions({root:t.root,now:()=>T0,registry:missions,questions,inbox:createRequestRegistry({root:t.root,questions,missions}),loadState:async()=>({sessions:[t.session]}),window:t.core.herdr.window,
      send:async()=>{await broken.launch({mission:'M-1',fresh:false,tickets:[FG2]}).catch(()=>{});return {sent:true};}});
    await screen.launch({mission:'M-1',seen:(await missions.read('M-1')).plan.revision});
    const m=await missions.read('M-1');
    assert.equal(m.launch.state,'failed',JSON.stringify(m.launch));
    assert.equal(launchState(m,{address:'t1',status:'idle'},T0+1000),'offer');
  }finally{await t.cleanup();}
});

// A refusal said in the journal (refusedOnce): a journal that fails never turns the refusal into a failure of the launch.
test('said once: a journal that fails is no error, and the claim is given back to be said at the next pass',async()=>{
  const claims=new Set(),given=[];
  const tools=say=>({claim:async k=>{if(claims.has(k))return false;claims.add(k);return true;},unclaim:async k=>{claims.delete(k);given.push(k);},say});
  assert.equal(await sayOnce(tools(async()=>{throw new Error('disk full');}),'k'),false);
  assert.deepEqual(given,['k']);assert.equal(claims.has('k'),false);
  assert.equal(await sayOnce(tools(async()=>{}),'k'),true);
  assert.equal(await sayOnce(tools(async()=>{}),'k'),false,'once');
  assert.equal(await sayOnce({claim:async()=>{throw new Error('locked');},unclaim:async()=>{},say:async()=>{}},'x'),false,'a claim that fails is no error either');
});

// The state « asked » (M5 review, P2): the Lead got the message and did nothing. Once the two minutes of the page are
// over, with the Lead resting and no dev asked, a click asks the Lead again, once per click; never while a dev is asked,
// never while the Lead works. Two messages never make two devs: the lane of the mission refuses the second.
test('asked, and the Lead did nothing: a click after two minutes asks again, and two messages never make two devs',async()=>{
  const t=await setup({},{},{approved:false});
  try{
    let now=T0;const {missions}=await leadMission(t.root),questions=createQuestionRegistry({root:t.root}),told=[];
    const screen=createMissionActions({root:t.root,now:()=>now,registry:missions,questions,chain:t.chain,inbox:createRequestRegistry({root:t.root,questions,missions}),loadState:async()=>({sessions:[t.session]}),window:t.core.herdr.window,send:async x=>{told.push(x);return {sent:true};}});
    const click=async()=>screen.launch({mission:'M-1',seen:(await missions.read('M-1')).plan.revision});
    assert.equal((await click()).launch,'asked');assert.equal(told.length,1);
    now=T0+60000;assert.equal((await click()).launch,'asked');assert.equal(told.length,1,'within the two minutes, nothing is sent again');
    // Two clicks at the same moment, after the two minutes: asked again, once.
    now=T0+3*60000;const clicks=await Promise.allSettled([click(),click()]);
    assert.ok(clicks.some(c=>c.value?.launch==='asked'),JSON.stringify(clicks.map(c=>c.value||c.reason?.code)));assert.equal(told.length,2,'asked again, once');
    const m=await missions.read('M-1');assert.equal(m.launch.again,1);assert.ok(m.log.some(e=>e.text==='New launch request recorded for the Lead.'),JSON.stringify(m.log));
    // The Lead acts on both messages at the same moment, through two chains (two processes of the tool): one dev.
    await Promise.allSettled([t.chain.launch({mission:'M-1',fresh:false,tickets:[FG2]}),t.make().launch({mission:'M-1',fresh:false,tickets:[FG2]})]);
    assert.equal(devRuns(t.calls,'XJ-2'),1);
    // A dev asked (the chain on): never sent again.
    now=T0+10*60000;await missions.update('M-1',x=>{x.step='analysing';});
    await click().catch(()=>{});assert.equal(told.length,2);
  }finally{await t.cleanup();}
});

// The same, one after the other (M7 review 2: kept beside the simultaneous cases): a single click after the two minutes
// asks again once, a click right after sends nothing more; two launches one after the other make one dev, the second
// refused by the lane (already).
test('asked, and the Lead did nothing: one click after the other, and two launches one after the other, one dev',async()=>{
  const t=await setup({},{},{approved:false});
  try{
    let now=T0;const {missions}=await leadMission(t.root),questions=createQuestionRegistry({root:t.root}),told=[];
    const screen=createMissionActions({root:t.root,now:()=>now,registry:missions,questions,chain:t.chain,inbox:createRequestRegistry({root:t.root,questions,missions}),loadState:async()=>({sessions:[t.session]}),window:t.core.herdr.window,send:async x=>{told.push(x);return {sent:true};}});
    const click=async()=>screen.launch({mission:'M-1',seen:(await missions.read('M-1')).plan.revision});
    assert.equal((await click()).launch,'asked');assert.equal(told.length,1);
    now=T0+3*60000;assert.equal((await click()).launch,'asked');assert.equal(told.length,2,'asked again, once');
    assert.equal((await click()).launch,'asked');assert.equal(told.length,2,'a click right after sends nothing more');
    assert.equal((await missions.read('M-1')).launch.again,1);
    const first=await t.chain.launch({mission:'M-1',fresh:false,tickets:[FG2]});
    assert.equal(first.launched[0].launched,true,JSON.stringify(first));
    const second=await t.chain.launch({mission:'M-1',fresh:false,tickets:[FG2]});
    assert.equal(second.launched[0].launched,false);assert.equal(second.launched[0].reason,'already',JSON.stringify(second));
    assert.equal(devRuns(t.calls,'XJ-2'),1);
  }finally{await t.cleanup();}
});

test('asked, the Lead at work: refused as before, nothing sent again',async()=>{
  const t=await setup({},{},{approved:false});
  try{
    let now=T0;const {missions}=await leadMission(t.root),questions=createQuestionRegistry({root:t.root}),told=[];
    const screen=createMissionActions({root:t.root,now:()=>now,registry:missions,questions,chain:t.chain,inbox:createRequestRegistry({root:t.root,questions,missions}),loadState:async()=>({sessions:[t.session]}),window:t.core.herdr.window,send:async x=>{told.push(x);return {sent:true};}});
    const click=async()=>screen.launch({mission:'M-1',seen:(await missions.read('M-1')).plan.revision});
    await click();now=T0+3*60000;t.agents[0].status='working';
    await assert.rejects(click,e=>e.code==='LEAD_WORKING');assert.equal(told.length,1);
  }finally{await t.cleanup();}
});
