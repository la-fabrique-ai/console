import test from 'node:test';
import assert from 'node:assert/strict';
import { setup, news, FG2, planTicket } from './helpers/dev-chain-setup.mjs';
import { desk, click } from './helpers/requests.mjs';
import { createRequestRegistry } from '../src/requests.mjs';
import { createQuestionRegistry } from '../src/questions.mjs';
import { createMissionRegistry } from '../src/mission.mjs';

// ---- M9 review 2 (decision 97): a decision of the user belongs to the review its request comes from (recipient.from),
// never to one guessed from the hours of the reports.
const A='a'.repeat(40),d1='2026-11-09T10:00:00.000Z';
const at=s=>Date.parse('2026-11-09T'+s+':00.000Z');

// The engine's own data: a reviewer's question, escalated as a verdict to decide, answered by the user.
const asked=async(t,{from,ticket='XJ-2',kind='verdict'})=>{
  const f=await desk(t),{question}=await f.asked({ticket,from,fromTab:ticket+' · revue',question:'Accepter tel quel ?',options:['Accept as is','Have it fixed'],source:ticket+'.ask-'+from+'.json'});
  const {item}=await f.actions.escalate({mission:'M-1',ticket,type:'decision',...(kind?{kind}:{}),title:'Verdict '+ticket,text:'La revue laisse le verdict.',recommendation:'Accept as is',why:'Remarque mineure',options:['Accept as is','Have it fixed'],question:question.id});
  return {f,item,question};
};

test('a decision taken says the review its request comes from (M9 review 2)', async t=>{
  const {f,item}=await asked(t,{from:'review-2'});
  assert.equal(item.recipient.from,'review-2','the request keeps where its question comes from');
  await click(f,await f.one(item.id),'Accept as is');
  const [d]=await f.inbox.taken({mission:'M-1'});
  assert.deepEqual([d.kind,d.ticket,d.answer,d.from],['verdict','XJ-2','Accept as is','review-2']);
});

test('a strong ticket: a decision on review 2 taken before the report of review 1 stays with review 2 (M9 review 2)', async()=>{
  let clock=at('10:00');
  const t=await setup({now:()=>clock},{},{plan:[planTicket('XJ-2',1,{difficulty:'heavy'}),planTicket('XJ-3',2,{deps:['XJ-2']})]});
  try{
    // The register's own shape: `from` is the provenance of the request (recipient.from).
    let decisions=[{id:'D-1',item:'I-1',by:'owner',role:'owner',kind:'verdict',short:'Verdict XJ-2',said:'Accept as is',title:'Verdict',answer:'Accept as is',at:'2026-11-09T10:04:00.000Z',ticket:'XJ-2',from:'review-2'},
      {id:'D-2',item:'I-2',kind:'verdict',answer:'Have it fixed',at:'2026-11-09T10:04:30.000Z',ticket:'XJ-2',from:'lead'}];
    const questions=createQuestionRegistry({root:t.root,now:()=>clock}),missions=createMissionRegistry({root:t.root,now:()=>clock});
    const real=createRequestRegistry({root:t.root,now:()=>clock,notify:async()=>{},questions,missions});
    const chain=t.make({inbox:new Proxy(real,{get:(o,k)=>k==='taken'?async()=>decisions:o[k]}),questions,missions});
    await chain.launch({sessionId:'s1',tickets:[FG2]});
    t.reports.push({ticket:'XJ-2',kind:'dev',commit:A,repo:'admin',summary:'fait',at:d1});
    await chain.tick({sessionId:'s1'});
    assert.equal(news(t.calls).filter(x=>/^XJ-2 · revue/.test(x)).length,2,'a strong ticket: two reviews at once');
    // the user decided at 10:04 on review 2; review 1 reports at 10:06, review 2 at 10:08.
    clock=at('10:05');await chain.tick({sessionId:'s1'});
    clock=at('10:06');t.reports.push({ticket:'XJ-2',kind:'review-1',commit:A,verdict:'accepted',summary:'ok',at:'2026-11-09T10:06:00.000Z'});
    await chain.tick({sessionId:'s1'});
    clock=at('10:08');t.reports.push({ticket:'XJ-2',kind:'review-2',commit:A,verdict:'accepted',summary:'Accepté sur décision.',at:'2026-11-09T10:08:00.000Z'});
    await chain.tick({sessionId:'s1'});decisions=[];clock=at('10:09');await chain.tick({sessionId:'s1'});
    const steps=(await chain.read({sessionId:'s1'})).timings['XJ-2'];
    assert.equal(steps.find(s=>s.step==='review-1').decided,undefined,'never put on review 1 by the hours');
    assert.deepEqual(steps.find(s=>s.step==='review-2').decided,{by:'owner',role:'owner',answer:'Accept as is'});
  }finally{await t.cleanup();}
});
