import test from 'node:test';
import assert from 'node:assert/strict';
import { planTicket, TWO, setup, leadMission, devRuns, news, FG2 } from './helpers/dev-chain-setup.mjs';
import { createMissionActions, driftOf } from '../src/mission.mjs';
import { createQuestionRegistry } from '../src/questions.mjs';
import { createRequestRegistry } from '../src/requests.mjs';

// The fourth round of M7 (decision 85, rule 1): a ticket kept out of the copy (`outside`, removed from the plan by a
// reapproval) is never reviewed nor merged, even when its dev still runs or reports; the delivery waits until its dev
// stops; its work stays on its branch. The scenario of the independent review (M7 review 3).
const T0=Date.parse('2026-11-14T10:00:00Z');
const screenOf=t=>{
  const questions=createQuestionRegistry({root:t.root}),inbox=createRequestRegistry({root:t.root,questions,missions:t.registry});
  return createMissionActions({root:t.root,now:()=>T0,registry:t.registry,questions,chain:t.chain,inbox,loadState:async()=>({sessions:[t.session]}),window:t.core.herdr.window,loadConfig:async()=>({}),send:async()=>({sent:true})});
};
const report=(t,ticket,kind,c,hour,more={})=>t.reports.push({ticket,kind,commit:c.repeat(40),repo:'admin',summary:'fait',at:'2026-11-09T'+hour+':00:00.000Z',...more});
const devStatus=(t,ticket,status)=>{for(const a of t.agents)if(String(a.tab_name).startsWith(ticket))a.status=status;};
const ticks=async(t,n=3)=>{for(let i=0;i<n;i++)await t.chain.tick({sessionId:'s1'});};

test('decision 85: XJ-3 launched, removed, reapproved, its dev finishing: no review, no merge, the QA only once its dev stopped',async()=>{
  const merges=[];
  const t=await setup({ticketMerge:async({ticket})=>{merges.push(ticket);return {status:'merged'};}});
  t.registry=(await leadMission(t.root)).missions;
  try{
    const screen=screenOf(t);
    // XJ-2 is accepted and merged; XJ-3 starts on its own, and works.
    assert.ok((await t.chain.launch({mission:'M-1',fresh:false,tickets:[FG2]})).launched[0].launched);
    report(t,'XJ-2','dev','a','10');report(t,'XJ-2','review-1','a','10',{verdict:'accepted',summary:'ok'});devStatus(t,'XJ-2','idle');
    await ticks(t);
    assert.equal(devRuns(t.calls,'XJ-3'),1,'XJ-3 was launched');
    devStatus(t,'XJ-3','working');
    await ticks(t,1);
    // The plan is saved again without XJ-3: the drift says its dev runs, and the reapproval keeps it out.
    await screen.savePlan({mission:'M-1',plan:{tickets:[TWO[0]]}});
    await ticks(t,1);
    const seen=await screen.read({mission:'M-1'});
    assert.deepEqual(seen.drift.filter(d=>d.ticket==='XJ-3').map(d=>[d.kind,d.running]),[['removed',true]],'the drift says the dev of XJ-3 runs');
    await screen.reapprove({mission:'M-1',seen:seen.driftSeen});
    assert.ok((await t.registry.read('M-1')).approval.outside.includes('XJ-3'));
    const before=t.calls.length;
    // Its dev still works: the delivery waits.
    await ticks(t);
    assert.equal(news(t.calls).filter(x=>x==='QA · XJ-1').length,0,'no QA while the dev of XJ-3 works');
    assert.notEqual((await t.registry.read('M-1')).step,'validating');
    // Its dev reports, then a review comes as accepted anyway: nothing is reviewed, nothing merged.
    report(t,'XJ-3','dev','b','11');
    await ticks(t);
    assert.deepEqual(news(t.calls.slice(before)).filter(x=>x.includes('XJ-3')),[],'no reviewer for XJ-3');
    report(t,'XJ-3','review-1','b','11',{verdict:'accepted',summary:'ok'});
    await ticks(t);
    assert.deepEqual(merges,['XJ-2'],'XJ-3 is never merged');
    assert.equal(news(t.calls).filter(x=>x==='QA · XJ-1').length,0,'no QA while the dev of XJ-3 is not stopped');
    // Its turn ends: its dev is stopped, its work stays (no merge, nothing removed), the QA starts on XJ-2 alone.
    devStatus(t,'XJ-3','idle');
    await ticks(t,4);
    assert.equal(t.agents.some(a=>String(a.tab_name).startsWith('XJ-3')),false,'its dev is stopped');
    assert.equal((await t.registry.read('M-1')).tickets.find(x=>x.id==='XJ-3')?.running,undefined,'and no longer said running');
    assert.equal(news(t.calls).filter(x=>x==='QA · XJ-1').length,1,'the QA starts once its dev stopped');
    assert.equal((await t.registry.read('M-1')).step,'validating');
    assert.deepEqual(merges,['XJ-2']);
    assert.equal(devRuns(t.calls,'XJ-3'),1,'never launched again');
    assert.equal(t.issue.children.find(k=>k.identifier==='XJ-3').state.type,'unstarted','the tracker is untouched');
  }finally{await t.cleanup();}
});

const A=planTicket('XJ-2',1),B=planTicket('XJ-3',2,{deps:['XJ-2']});
test('a ticket removed whose dev the chain says running is said running in the drift; one never launched is not',()=>{
  assert.equal(driftOf({approval:{at:'x',plan:{tickets:[A,B]}},plan:{tickets:[A]},tickets:[]})[0].running,undefined);
  // The dev of a ticket removed still runs (the chain says so in the tickets of the mission): the drift says it.
  const running=driftOf({approval:{at:'x',plan:{tickets:[A,B]}},plan:{tickets:[A]},tickets:[{id:'XJ-3',state:'dev',running:true}]})[0];
  assert.equal(running.running,true);
});
