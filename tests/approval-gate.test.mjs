import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createQuestionActions, createQuestionRegistry } from '../src/questions.mjs';
import { createRequestRegistry } from '../src/requests.mjs';
import { planTicket, recordPlan, setup, leadMission, devRuns, FG2 } from './helpers/dev-chain-setup.mjs';
import { fixture, issue, approveIssue } from './helpers/backend-fixture.mjs';
import { createMissionRegistry, createMissionActions } from '../src/mission.mjs';
import { NOT_APPROVED } from '../src/dev-chain.mjs';

// Ticket M5, the gate of the chain: no dev starts without the frozen copy of the plan the user approved, whichever way it
// is asked for (the Lead's launch, a fix, a resume, dev-launch, the watcher on its own); and the failure between the
// approval and the launch: a watcher restarted starts one dev, and the copy is not written again.

test('no dev starts without the approval: the Lead\'s launch, a fix, a resume, the command of the devs and the watcher on its own',async()=>{
  const t=await setup({},{},{approved:false});
  try{
    await assert.rejects(()=>t.chain.launch({mission:'M-1',tickets:[FG2]}),e=>e.code==='NOT_APPROVED'&&/approuv/.test(e.message));
    const lead=createQuestionActions({questions:null,inbox:null,missions:(await leadMission(t.root)).missions,launch:t.chain.launch});
    for(const kind of ['launch','fix','resume'])await assert.rejects(()=>lead.request({mission:'M-1',kind,tickets:[FG2]}),e=>e.code==='NOT_APPROVED',kind);
    // The watcher on its own: a chain set on (a mission of before this ticket, say) launches nothing either.
    await mkdir(join(t.root,'state'),{recursive:true});
    await writeFile(join(t.root,'state','devchain-M-1.json'),JSON.stringify({done:{},log:[],seen:{},paths:{},bases:{},on:true,digest:[],withheld:[],digestAt:0,settled:false,lane:null,laneSeq:0})+'\n');
    for(let n=0;n<3;n++)await t.make().tick({sessionId:'s1'});
    assert.equal(devRuns(t.calls,'XJ-2'),0);assert.equal(t.calls.filter(([c])=>c==='hc.run').length,0,'nothing asked of the core');
  }finally{await t.cleanup();}
});

test('panne: the watcher restarted between the approval and the launch: from the click, one dev starts, the copy is not written again',async()=>{
  const t=await setup({},{},{approved:false});
  try{
    // The real way in: the click of the user (mission-launch) on the plan the screen drew, its copy, the message to the Lead.
    let at=Date.parse('2026-11-13T09:00:00Z');
    const {missions}=await leadMission(t.root),questions=createQuestionRegistry({root:t.root}),told=[];
    const screen=createMissionActions({root:t.root,now:()=>at,registry:missions,questions,inbox:createRequestRegistry({root:t.root,questions,missions}),loadState:async()=>({sessions:[t.session]}),window:t.core.herdr.window,send:async x=>{told.push(x);return {sent:true};}});
    await assert.rejects(()=>t.chain.launch({mission:'M-1',fresh:false,tickets:[FG2]}),e=>e.code==='NOT_APPROVED','nothing before the click');
    const out=await screen.launch({mission:'M-1',seen:(await missions.read('M-1')).plan.revision});
    assert.equal(out.approved,true);assert.equal(told.length,1);assert.match(told[0].text,/lead-request/);
    const before=JSON.stringify((await missions.read('M-1')).approval);
    // The Lead asks, as it is told; the watcher dies and comes back (a new chain): its pass and the Lead asking again
    // come together.
    const lead=createQuestionActions({questions:null,inbox:null,missions,launch:t.chain.launch}),restarted=t.make();
    const outs=await Promise.allSettled([lead.request({mission:'M-1',kind:'launch',tickets:[FG2]}),restarted.tick({sessionId:'s1'}),restarted.launch({mission:'M-1',fresh:false,tickets:[FG2]})]);
    for(let n=0;n<3;n++)await t.make().tick({sessionId:'s1'});
    assert.equal(devRuns(t.calls,'XJ-2'),1,'one dev: '+JSON.stringify(outs.map(o=>o.reason?.code||o.value?.launched)));
    assert.equal(devRuns(t.calls,'XJ-3'),0);
    // A click again, later: the copy stays byte for byte, and the launch is not asked twice.
    at+=60000;await screen.launch({mission:'M-1',seen:(await missions.read('M-1')).plan.revision}).catch(()=>{});
    assert.equal(JSON.stringify((await missions.read('M-1')).approval),before);assert.equal(told.length,1);
  }finally{await t.cleanup();}
});

test('the chain keeps the approval when the plan is recorded again',async()=>{
  const t=await setup();
  try{
    const {missions}=await leadMission(t.root),before=(await missions.read('M-1')).approval;
    await recordPlan(missions,'M-1',[planTicket('XJ-2',1)]);
    assert.deepEqual((await missions.read('M-1')).approval,before);
    assert.ok((await t.chain.launch({mission:'M-1',tickets:[FG2]})).launched.some(x=>x.launched));
  }finally{await t.cleanup();}
});


test('the launch of before (launch, resume included) starts no dev without the approval: the same gate as the chain',async t=>{
  const f=await fixture(t,{approved:false}),runs=()=>f.calls.filter(c=>c.args[0]==='run').length;
  // No mission covers the issue: refused before anything is written or run.
  await assert.rejects(()=>f.backend.dispatch('launch',{issueId:issue.id,tool:'codex'}),e=>e.code==='NOT_APPROVED'&&e.message===NOT_APPROVED);
  await assert.rejects(()=>f.backend.dispatch('launch',{issueId:issue.id,tool:'codex',resume:true}),e=>e.code==='NOT_APPROVED');
  // A mission of the issue whose plan is not approved: refused all the same.
  const missions=createMissionRegistry({root:f.home});
  await missions.create({project:'example',issue:{id:issue.id,identifier:issue.identifier},request:'r'});
  await assert.rejects(()=>f.backend.dispatch('launch',{issueId:issue.id,tool:'codex',review:true}),e=>e.code==='NOT_APPROVED');
  assert.equal(runs(),0,'nothing asked of the core');
  assert.equal((await f.read('state.json').catch(()=>({sessions:[]}))).sessions.length,0,'no session written');
  // Approved, the same command launches; a resume of it as well.
  await approveIssue(f.home,issue);
  const {session}=await f.backend.dispatch('launch',{issueId:issue.id,tool:'codex'});
  assert.ok(session.worktree);assert.equal(runs(),1);
  // A sub-ticket the approved plan names is covered by the copy of its mission.
  const sub={...issue,id:'sub-issue',identifier:'CHAR-8'};
  f.tracker.detail=async()=>({issue:sub});
  await assert.rejects(()=>f.backend.dispatch('launch',{issueId:sub.id,tool:'codex'}),e=>e.code==='NOT_APPROVED');
  await missions.update('M-1',m=>{m.approval.plan={tickets:[{id:'CHAR-8'}]};});
  assert.ok((await f.backend.dispatch('launch',{issueId:sub.id,tool:'codex'})).session.worktree);
});
