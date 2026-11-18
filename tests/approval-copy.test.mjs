import test from 'node:test';
import assert from 'node:assert/strict';
import { planTicket, recordPlan, setup, leadMission, devRuns, FG2 } from './helpers/dev-chain-setup.mjs';
import { copyRefusal } from '../src/mission.mjs';

// Decision 77: the approval covers the tickets of the frozen copy, and only them. A ticket added to the plan after the
// approval, or changed since, does not start, whoever asks (the Lead, the watcher on its own); it is refused clearly and
// said in the journal of the mission, once. Its reapproval and its display come with M7.
const FG3={...FG2,identifier:'XJ-3'};
const journalOf=async t=>(await t.chain.read({mission:'M-1'})).log;
// Decision 87: « Launch blocked for XJ-4. », with the reason in the words of the interface.
const saidCopy=journal=>journal.filter(l=>l.tone==='fail'&&/^Launch blocked for XJ-\d\.$/.test(l.text)&&['This ticket is not covered by your approval.','This ticket differs from its approved version.'].includes(l.detail));

test('the rule: absent from the copy, or different from it, is refused; its identity read since is not a change',()=>{
  const ticket=planTicket('XJ-2',1);
  const m=(copy,today)=>({approval:{at:'x',plan:{tickets:copy}},plan:{tickets:today}});
  assert.equal(copyRefusal(m([{...ticket,uid:null}],[{...ticket,uid:'u2'}]),'XJ-2'),null);
  assert.equal(copyRefusal(m([ticket],[ticket,planTicket('XJ-9',2)]),'XJ-9').code,'NOT_IN_COPY');
  assert.equal(copyRefusal(m([ticket],[{...ticket,model:'claude-opus-5-5'}]),'XJ-2').code,'COPY_CHANGED');
  assert.equal(copyRefusal(m([ticket],[]),'XJ-2').code,'COPY_CHANGED','dropped from the plan of today');
  assert.equal(copyRefusal({approval:{at:'x'},plan:{tickets:[ticket]}},'XJ-2').code,'NOT_IN_COPY','a copy without its plan covers nothing');
  for(const code of ['NOT_IN_COPY','COPY_CHANGED'])assert.match(copyRefusal(code==='NOT_IN_COPY'?m([],[ticket]):m([ticket],[{...ticket,effort:'low'}]),'XJ-2').message,/^Lancement de XJ-2 refusé : /);
});

test('a ticket added to the plan after the approval: the Lead\'s launch is refused, no dev, said once in the journal',async()=>{
  const t=await setup();
  try{
    const {missions}=await leadMission(t.root);
    await recordPlan(missions,'M-1',[planTicket('XJ-2',1),planTicket('XJ-3',2,{deps:['XJ-2']}),planTicket('XJ-4',3)]);
    t.issue.children.push(t.kid('XJ-4','u4'));
    const FG4={...FG2,identifier:'XJ-4'};
    for(let n=0;n<2;n++)assert.deepEqual((await t.chain.launch({mission:'M-1',fresh:false,tickets:[FG4]})).launched,[{identifier:'XJ-4',launched:false,reason:'not-in-copy'}]);
    assert.equal(devRuns(t.calls,'XJ-4'),0);
    const said=saidCopy(await journalOf(t));assert.equal(said.length,1);assert.match(said[0].text,/XJ-4/);
    // The tickets the copy covers still start.
    assert.ok((await t.chain.launch({mission:'M-1',fresh:false,tickets:[FG2]})).launched[0].launched);
  }finally{await t.cleanup();}
});

test('a ticket changed after the approval: refused to the Lead and to the watcher on its own, said once',async()=>{
  const t=await setup();
  try{
    const {missions}=await leadMission(t.root);
    // XJ-3 given another model after the approval; XJ-2 as approved.
    await recordPlan(missions,'M-1',[planTicket('XJ-2',1),planTicket('XJ-3',2,{deps:['XJ-2'],model:'claude-opus-5-5'})]);
    const FG3new={...FG3,model:'claude-opus-5-5'};
    assert.deepEqual((await t.chain.launch({mission:'M-1',fresh:false,tickets:[FG3new]})).launched,[{identifier:'XJ-3',launched:false,reason:'copy-changed'}]);
    // XJ-2 goes, is accepted and merged: the turn of XJ-3 comes, and the watcher does not start it.
    assert.ok((await t.chain.launch({mission:'M-1',fresh:false,tickets:[FG2]})).launched[0].launched);
    const c='a'.repeat(40);t.reports.push({ticket:'XJ-2',kind:'dev',commit:c,repo:'admin',summary:'fait',at:'2026-11-09T10:00:00.000Z'},{ticket:'XJ-2',kind:'review-1',commit:c,verdict:'accepted',summary:'ok',at:'2026-11-09T10:30:00.000Z'});
    for(let n=0;n<4;n++)await t.chain.tick({sessionId:'s1'});
    assert.equal(devRuns(t.calls,'XJ-3'),0,'the watcher launches no ticket outside the copy');
    const said=saidCopy(await journalOf(t)).filter(l=>/XJ-3/.test(l.text));assert.equal(said.length,1,JSON.stringify(await journalOf(t)));
  }finally{await t.cleanup();}
});

test('a sub-ticket the plan approved does not name (a correction asked later) does not start before its reapproval',async()=>{
  const t=await setup({},{},{plan:[planTicket('XJ-2',1)]});
  try{
    t.issue.children=[t.kid('XJ-2','u2'),t.kid('XJ-9','u9')];
    const FG9={...FG2,identifier:'XJ-9',tool:'codex',model:'gpt-6.1-sol'};
    assert.deepEqual((await t.chain.launch({mission:'M-1',fresh:false,tickets:[FG9]})).launched,[{identifier:'XJ-9',launched:false,reason:'not-in-copy'}]);
    assert.equal(devRuns(t.calls,'XJ-9'),0);
  }finally{await t.cleanup();}
});
