import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { createLauncher } from '../src/launch.mjs';
import { planTicket, setup, leadMission, devRuns } from './helpers/dev-chain-setup.mjs';

// The launch of before, once the plan of its mission is approved (M5, last pass): it goes through the lane of the
// mission, the one place a dev terminal is asked for, whichever ticket or issue it names, a resume included; a review
// is the chain's. Never two devs alive for one mission.
const ISSUES={'XJ-1':{id:'i1',identifier:'XJ-1',title:'Paiement'},'XJ-2':{id:'u2',identifier:'XJ-2',title:'Lot XJ-2'},'XJ-3':{id:'u3',identifier:'XJ-3',title:'Lot XJ-3'}};
function launcherOf(t,{chainLaunch=t.chain.launch}={}) {
  const runs=[],asked=[];
  const launcher=createLauncher({root:t.root,getTickets:async()=>({detail:async id=>({issue:ISSUES[id]})}),loadConfig:async()=>({version:1,projects:[{key:'alpha',repo:'/repo',tests:[]}]}),
    loadState:async()=>({version:1,sessions:[]}),readTerminals:async()=>[],statePath:join(t.root,'state.json'),ensureWorktree:async()=>{throw new Error('no worktree of before');},
    createSession:async()=>{throw new Error('no session of before');},qaFor:async()=>null,observedSession:async s=>s,herdr:{run:async args=>{runs.push(args);throw new Error('no run of before');}},
    missions:(t.missions),chainLaunch:async input=>{asked.push(input);return chainLaunch(input);}});
  return {launcher,runs,asked};
}
async function approved(plan) {
  const t=await setup({},{},{plan});
  t.missions=(await leadMission(t.root)).missions;
  return t;
}
const INDEPENDENT=[planTicket('XJ-2',1),planTicket('XJ-3',2)];

test('approved, the launch of before asks the lane of the mission for the ticket it names, with the plan\'s tool, model and effort',async()=>{
  const t=await approved(INDEPENDENT);
  try{
    const {launcher,runs,asked}=launcherOf(t);
    const out=await launcher.launch({issueId:'XJ-2',tool:'codex'});
    assert.deepEqual(asked,[{mission:'M-1',tickets:[{identifier:'XJ-2',tool:'claude',model:'claude-sonnet-5-5',effort:'high'}],fresh:false,resume:false}]);
    assert.equal(out.mission,'M-1');assert.equal(out.via,'lane');
    assert.equal(devRuns(t.calls,'XJ-2'),1,'the dev of the lane');assert.equal(runs.length,0,'no terminal of before');
    await assert.rejects(()=>readFile(join(t.root,'state.json'),'utf8'),e=>e.code==='ENOENT','no session of before written');
  }finally{await t.cleanup();}
});
test('never two devs alive for one mission: a second ticket, the issue itself, a resume, all go through the same lane',async()=>{
  const t=await approved(INDEPENDENT);
  try{
    const {launcher,asked}=launcherOf(t);
    await launcher.launch({issueId:'XJ-2',tool:'claude'});
    await launcher.launch({issueId:'XJ-3',tool:'claude'}).catch(()=>{});
    await launcher.launch({issueId:'XJ-1',tool:'claude'}).catch(()=>{});
    await launcher.launch({issueId:'XJ-3',tool:'claude',resume:true}).catch(()=>{});
    assert.equal(devRuns(t.calls,'XJ-2')+devRuns(t.calls,'XJ-3'),1,'one dev alive');
    assert.deepEqual(asked.map(a=>[a.tickets.map(x=>x.identifier).join(','),a.resume]),[['XJ-2',false],['XJ-3',false],['XJ-2,XJ-3',false],['XJ-3',true]],'the issue itself asks for the tickets of its plan');
  }finally{await t.cleanup();}
});
test('approved, a review of before is refused: the reviewers of a mission are started by its chain; nothing is asked',async()=>{
  const t=await approved(INDEPENDENT);
  try{
    const {launcher,runs,asked}=launcherOf(t);
    await assert.rejects(()=>launcher.launch({issueId:'XJ-2',tool:'codex',review:true}),e=>e.code==='REVIEW_IN_LANE');
    assert.equal(asked.length,0);assert.equal(runs.length,0);assert.equal(t.calls.filter(([c])=>c==='hc.run').length,0);
  }finally{await t.cleanup();}
});
test('not approved, the gate of before still refuses, the lane is not asked',async()=>{
  const t=await setup({},{},{plan:INDEPENDENT,approved:false});
  try{
    t.missions=(await leadMission(t.root)).missions;
    const {launcher,asked}=launcherOf(t);
    await assert.rejects(()=>launcher.launch({issueId:'XJ-2',tool:'claude'}),e=>e.code==='NOT_APPROVED');
    assert.equal(asked.length,0);
  }finally{await t.cleanup();}
});
