import test from 'node:test';
import assert from 'node:assert/strict';
import { setup, leadMission, devRuns, FG2 } from './helpers/dev-chain-setup.mjs';
import { createMissionActions } from '../src/mission.mjs';
import { createQuestionRegistry } from '../src/questions.mjs';
import { createRequestRegistry } from '../src/requests.mjs';
import { pageBand } from '../mods/fabrique-console-v4-ticket/page.js';
import { launchState } from '../mods/fabrique-console-v4-ticket/nav.js';

// M5 review 2: the launch the user approved is said started only once a dev was really asked of the core. A launch that
// fails right after the Lead received it (the worktree, the Herdr space, the tracker) is said not started, in the journal
// of the mission, never started: the approval is offered again, and a new click asks the launch again, cleanly.
const T0=Date.parse('2026-11-14T10:00:00Z');
const unknownLaunch=async(t,state='unknown')=>{
  const {missions}=await leadMission(t.root);
  await missions.update('M-1',m=>{m.launch={state,at:new Date(T0).toISOString(),saidAt:new Date(T0).toISOString()};if(state==='asked')m.launchAskedAt=m.launch.saidAt;});
  return missions;
};
const failing={
  worktree:{ensureWorktree:async()=>{throw Object.assign(new Error('git worktree add failed'),{code:'WORKTREE_FAILED'});}},
  tracker:{detail:async()=>{throw Object.assign(new Error('Tracker down'),{code:'TICKET_UNAVAILABLE'});}},
  space:{window:null},
};

for(const [kind,code] of [['worktree','WORKTREE_FAILED'],['tracker','TRACKER_UNAVAILABLE'],['space','NO_SPACE']]) {
  test('a launch whose fate was unknown, then a failure of the '+kind+': not started, never started, and the chain stays off',async()=>{
    const t=await setup();
    try{
      let now=T0+60000;const missions=await unknownLaunch(t);
      const more=kind==='space'?{window:{...t.core.herdr.window,ls:async()=>({...(await t.core.herdr.window.ls()),agents:[],spaces:[]}),run:async(c,a)=>{if(c==='space.new')throw new Error('no space');return t.core.herdr.window.run(c,a);}}}:failing[kind];
      const chain=t.make({now:()=>now,...more});
      await assert.rejects(()=>chain.launch({mission:'M-1',fresh:false,tickets:[FG2]}),e=>e.code===code,code);
      let m=await missions.read('M-1');
      assert.equal(m.launch.state,'failed');assert.equal(m.launch.settled,'not-started');assert.notEqual(m.step,'building');
      assert.ok(m.log.some(e=>/^Launch failed( \([A-Z_]+\))?\. No dev was started\. You can request the launch again\.$/.test(e.text)),JSON.stringify(m.log));
      assert.equal((await chain.read({mission:'M-1'})).on,false,'the chain is not on: no dev was asked');
      // The watcher afterwards: never « started ».
      now=T0+20*60000;await t.make({now:()=>now}).tick({sessionId:'s1'});
      m=await missions.read('M-1');
      assert.equal(m.launch.state,'failed');assert.notEqual(m.launch.settled,'started');assert.equal(devRuns(t.calls,'XJ-2'),0);
    }finally{await t.cleanup();}
  });
}

test('a launch the Lead received (asked), then the worktree fails: not started, and a new click asks it again once',async()=>{
  const t=await setup({},{},{approved:false});
  try{
    const at=T0,{missions}=await leadMission(t.root),questions=createQuestionRegistry({root:t.root}),told=[];
    const screen=createMissionActions({root:t.root,now:()=>at,registry:missions,questions,inbox:createRequestRegistry({root:t.root,questions,missions}),loadState:async()=>({sessions:[t.session]}),window:t.core.herdr.window,send:async x=>{told.push(x);return {sent:true};}});
    const seen=()=>missions.read('M-1').then(m=>m.plan.revision);
    assert.equal((await screen.launch({mission:'M-1',seen:await seen()})).launch,'asked');assert.equal(told.length,1);
    const broken=t.make({...failing.worktree});
    await assert.rejects(()=>broken.launch({mission:'M-1',fresh:false,tickets:[FG2]}),e=>e.code==='WORKTREE_FAILED');
    await t.make().tick({sessionId:'s1'});
    const m=await missions.read('M-1');
    assert.equal(m.launch.state,'failed');assert.equal(m.launch.settled,'not-started');assert.equal(devRuns(t.calls,'XJ-2'),0,'the watcher launches nothing on its own');
    // The page offers the approval again, at once (the message of two minutes ago is no longer « asked »).
    assert.equal(launchState(m,{address:'t1',status:'idle'},at+1000),'offer');
    assert.equal(pageBand({mission:m,lead:{address:'t1',status:'idle'},now:at+1000}).button?.key,'approve');
    // A new click: the launch is asked of the Lead again, once; the copy is not written again.
    const copy=JSON.stringify(m.approval);
    assert.equal((await screen.launch({mission:'M-1',seen:await seen()})).launch,'asked');
    assert.equal(told.length,2);assert.equal(JSON.stringify((await missions.read('M-1')).approval),copy);
    // The worktree back, the Lead launches: one dev, and the launch is started.
    assert.ok((await t.chain.launch({mission:'M-1',fresh:false,tickets:[FG2]})).launched.some(x=>x.launched));
    assert.equal(devRuns(t.calls,'XJ-2'),1);
  }finally{await t.cleanup();}
});

test('a dev asked of the core whose answer is lost keeps the chain on: its doubt is the lane\'s, and the launch is not said failed',async()=>{
  const t=await setup();
  try{
    const missions=await unknownLaunch(t,'asked');
    t.core.faults.run='lost';const lost=t.make();
    const out=await lost.launch({mission:'M-1',fresh:false,tickets:[FG2]});
    assert.equal(out.launched[0].launched,false);
    assert.equal((await lost.read({mission:'M-1'})).on,true);
    assert.equal((await missions.read('M-1')).launch.state,'asked');
  }finally{await t.cleanup();}
});
