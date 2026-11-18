import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { planTicket, TWO, setup, leadMission, devRuns, news, FG2 } from './helpers/dev-chain-setup.mjs';
import { createMissionActions, driftOf } from '../src/mission.mjs';
import { createQuestionRegistry } from '../src/questions.mjs';
import { createRequestRegistry } from '../src/requests.mjs';
import { createBackend, SCREEN_COMMANDS } from '../src/backend.mjs';
import { AGENT_MARK, SCREEN_ONLY } from '../ui/v3/view.js';
import { withFakeHerdr } from './helpers/fake-herdr.mjs';

// M7, decisions 77 and 80: the user approves what changed since the approval, by a click on the screen, under the same
// barrier as « Approve and start the dev ». The frozen copy is then the plan of today (and the sub-tickets approved with
// it); the copy of before stays readable, whole, in the mission. The tickets added or changed then go as any other:
// a ticket of the plan rewritten by the Lead, a correction added in Validation. A plan rewritten before any dev left is
// approved again by « Approve and start the dev » itself: no more dead end on PLAN_REVISED.
const T0=Date.parse('2026-11-14T10:00:00Z');
const FG3={...FG2,identifier:'XJ-3'};
const screenOf=(t,{now=()=>T0,send}={})=>{
  const questions=createQuestionRegistry({root:t.root}),registry=t.registry;
  return createMissionActions({root:t.root,now,registry,questions,chain:t.chain,inbox:createRequestRegistry({root:t.root,questions,missions:registry}),loadState:async()=>({sessions:[t.session]}),window:t.core.herdr.window,loadConfig:async()=>({}),send:send||(async()=>({sent:true}))});
};
const ready=async(...args)=>{const t=await setup(...args);t.registry=(await leadMission(t.root)).missions;return t;};
const accept=(t,ticket,c,hour)=>t.reports.push({ticket,kind:'dev',commit:c.repeat(40),repo:'admin',summary:'fait',at:'2026-11-09T'+hour+':00:00.000Z'},{ticket,kind:'review-1',commit:c.repeat(40),verdict:'accepted',summary:'ok',at:'2026-11-09T'+hour+':30:00.000Z'});

test('Develop: the Lead rewrites a ticket; the drift shows it, a click approves it, and the ticket starts as rewritten',async()=>{
  const t=await ready();
  try{
    const screen=screenOf(t);
    assert.ok((await t.chain.launch({mission:'M-1',fresh:false,tickets:[FG2]})).launched[0].launched);
    const first=(await t.registry.read('M-1')).approval;
    await screen.savePlan({mission:'M-1',plan:{tickets:[TWO[0],{...TWO[1],model:'claude-opus-5-5'}]}});
    const FG3new={...FG3,model:'claude-opus-5-5'};
    assert.deepEqual((await t.chain.launch({mission:'M-1',fresh:false,tickets:[FG3new]})).launched.map(x=>x.reason),['copy-changed'],'not before the click');
    const read=await screen.read({mission:'M-1'});
    assert.deepEqual(read.drift.map(x=>[x.ticket,x.kind]),[['XJ-3','changed']]);
    const out=await screen.reapprove({mission:'M-1',seen:read.driftSeen});
    assert.deepEqual(out,{mission:'M-1',approved:true,reapproved:['XJ-3']});
    const m=await t.registry.read('M-1');
    assert.deepEqual(driftOf(m),[],'nothing left to approve');
    assert.equal(m.approval.kind,'reapproval');assert.equal(m.approval.by,'owner');assert.equal(m.approval.via,'screen');
    assert.equal(m.approval.at,new Date(T0).toISOString());
    assert.deepEqual(m.approval.approves.map(x=>[x.ticket,x.kind]),[['XJ-3','changed']]);
    assert.equal(m.approval.previous.length,1);assert.deepEqual(m.approval.previous[0],first,'the approval of before stays readable, whole');
    assert.ok(m.log.some(e=>e.text==='Changes approved by you: XJ-3.'),JSON.stringify(m.log));
    // What the page reads of it: the history, without the plans.
    const shown=(await screen.read({mission:'M-1'})).approval;
    assert.deepEqual(shown.history.map(h=>h.at),[first.at]);assert.equal('previous' in shown,false);assert.equal('plan' in shown,false);
    // XJ-2 accepted: XJ-3 goes as rewritten.
    accept(t,'XJ-2','a','10');for(const a of t.agents)if(a.tab_name.startsWith('XJ-2'))a.status='idle';
    for(let n=0;n<3;n++)await t.chain.tick({sessionId:'s1'});
    assert.equal(devRuns(t.calls,'XJ-3'),1,'the watcher starts it on its own');
  }finally{await t.cleanup();}
});

test('Validation: a correction added in the tracker is drift, approved by a click, then starts on its own',async()=>{
  const t=await ready({},{role:'lead'},{plan:[planTicket('XJ-2',1)]});
  try{
    const screen=screenOf(t);t.issue.children=[t.kid('XJ-2','u2')];
    await t.chain.launch({mission:'M-1',fresh:false,tickets:[FG2]});
    accept(t,'XJ-2','a','10');for(const a of t.agents)if(a.tab_name.startsWith('XJ-2'))a.status='idle';
    for(let n=0;n<3;n++)await t.chain.tick({sessionId:'s1'});
    assert.equal(news(t.calls).filter(x=>x==='QA · XJ-1').length,1,'in Validation');
    t.issue.children.push(t.kid('XJ-9','u9'));t.chain.forget();
    await t.chain.tick({sessionId:'s1'});await t.chain.tick({sessionId:'s1'});
    assert.equal(devRuns(t.calls,'XJ-9'),0,'outside the copy, the correction waits');
    const read=await screen.read({mission:'M-1'});
    assert.deepEqual(read.drift.map(x=>[x.ticket,x.kind]),[['XJ-9','added']]);
    await screen.reapprove({mission:'M-1',seen:read.driftSeen});
    assert.deepEqual((await t.registry.read('M-1')).approval.extra.map(e=>e.id),['XJ-9']);
    await t.chain.tick({sessionId:'s1'});
    assert.equal(devRuns(t.calls,'XJ-9'),1,'the correction starts');
  }finally{await t.cleanup();}
});

test('the reapproval approves what the screen drew, and only that; nothing written when refused',async()=>{
  const t=await ready();
  try{
    const screen=screenOf(t);
    await assert.rejects(()=>screen.reapprove({mission:'M-1',seen:'0123456789abcdef'}),e=>e.code==='MISSION_NOT_STARTED'&&e.message==='The mission is still in Prepare. Use the plan’s approval button.','before any dev: Approve and start the dev');
    await t.chain.launch({mission:'M-1',fresh:false,tickets:[FG2]});
    await assert.rejects(()=>screen.reapprove({mission:'M-1',seen:'0123456789abcdef'}),e=>e.code==='NO_DRIFT'&&e.message==='There are no changes to approve.');
    await screen.savePlan({mission:'M-1',plan:{tickets:[...TWO,planTicket('XJ-4',3)]}});
    const seen=(await screen.read({mission:'M-1'})).driftSeen;
    // The plan moves again while the page shows the drift of before.
    await screen.savePlan({mission:'M-1',plan:{tickets:[...TWO,planTicket('XJ-4',3,{model:'claude-opus-5-5'})]}});
    const before=JSON.stringify((await t.registry.read('M-1')).approval);
    await assert.rejects(()=>screen.reapprove({mission:'M-1',seen}),e=>e.code==='DRIFT_CHANGED'&&e.message==='The plan has changed again. Review the latest changes before approving.');
    await assert.rejects(()=>screen.reapprove({mission:'M-1'}),e=>e.code==='SEEN_REQUIRED'&&e.message==='Reopen the changes, review them, then approve.');
    await assert.rejects(()=>screen.reapprove({mission:'M-1',seen,more:1}),e=>e.code==='INVALID_ARGUMENT');
    assert.equal(JSON.stringify((await t.registry.read('M-1')).approval),before);
    const now=(await screen.read({mission:'M-1'})).driftSeen;
    await t.registry.update('M-1',m=>{m.step='closed';});
    await assert.rejects(()=>screen.reapprove({mission:'M-1',seen:now}),e=>e.code==='MISSION_OVER');
  }finally{await t.cleanup();}
});

test('Prepare: the plan rewritten after the approval, a launch not started: « Approve and start the dev » approves the new plan, the old copy kept',async()=>{
  const t=await ready({},{},{approved:false});
  try{
    const told=[],screen=screenOf(t,{send:async x=>{told.push(x);return {sent:true};}});
    const click=async seen=>screen.launch({mission:'M-1',seen:seen??(await t.registry.read('M-1')).plan.revision});
    await click();const first=(await t.registry.read('M-1')).approval;
    // The worktree fails: not started. The Lead rewrites its plan.
    await t.make({ensureWorktree:async()=>{throw Object.assign(new Error('git worktree add failed'),{code:'WORKTREE_FAILED'});}}).launch({mission:'M-1',fresh:false,tickets:[FG2]}).catch(()=>{});
    assert.equal((await t.registry.read('M-1')).launch.state,'failed');
    const old=(await t.registry.read('M-1')).plan.revision;
    await screen.savePlan({mission:'M-1',plan:{tickets:[{...TWO[0],model:'claude-opus-5-5'},TWO[1]]}});
    await assert.rejects(()=>click(old),e=>e.code==='PLAN_REVISED','a page that drew the plan of before');
    assert.equal((await click()).launch,'asked');assert.equal(told.length,2);
    const m=await t.registry.read('M-1');
    assert.equal(m.approval.revision,m.plan.revision);assert.deepEqual(m.approval.previous,[first]);
    assert.ok(m.log.some(e=>e.text==='Updated plan approved by you.'),JSON.stringify(m.log));
    assert.ok((await t.chain.launch({mission:'M-1',fresh:false,tickets:[{...FG2,model:'claude-opus-5-5'}]})).launched[0].launched,'the rewritten ticket starts');
    // The same click again: the copy is not written again.
    const copy=JSON.stringify((await t.registry.read('M-1')).approval);
    await click().catch(()=>{});assert.equal(JSON.stringify((await t.registry.read('M-1')).approval),copy);
  }finally{await t.cleanup();}
});

test('the barrier: mission-reapprove is a command of the screens, refused from a session of an agent, writing nothing',async t=>{
  assert.ok(SCREEN_COMMANDS.includes('mission-reapprove'));
  assert.match(SCREEN_ONLY,/mission-reapprove/);
  const root=await realpath(await mkdtemp(join(tmpdir(),'fabrique-console-reapprove-')));t.after(()=>rm(root,{recursive:true,force:true}));
  const backend=createBackend(withFakeHerdr({root,env:{...process.env,[AGENT_MARK]:'1'},exec:async()=>{throw new Error('nothing runs');}}));
  await assert.rejects(()=>backend.dispatch('mission-reapprove',{mission:'M-1',seen:'0123456789abcdef'}),e=>e.code==='AGENT_SESSION'&&/réservée au propriétaire/.test(e.message));
  assert.deepEqual(await readdir(root),[]);
});
