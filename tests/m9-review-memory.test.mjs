import test from 'node:test';
import assert from 'node:assert/strict';
import { setup, FG2 } from './helpers/dev-chain-setup.mjs';
import { createRequestRegistry } from '../src/requests.mjs';
import { createQuestionRegistry } from '../src/questions.mjs';
import { createMissionRegistry } from '../src/mission.mjs';
import { remarkCount } from '../src/dev-chain.mjs';
import { reportDigest } from '../mods/fabrique-console-v4-ticket/nav.js';

// What the chain keeps for good of each round of review (M9 review): the number of remarks of a review that asked for
// changes (E4), and the verdict the user decided when the reviewer left it to him, with where it comes from (E5). The
// file of a review is replaced at the next round; these stay.
const A='a'.repeat(40),B='b'.repeat(40),d1='2026-11-09T10:00:00.000Z',d2='2026-11-09T10:20:00.000Z';
const at=s=>Date.parse('2026-11-09T'+s+':00.000Z');
const TWO_REMARKS='Deux points à reprendre. (1) le cas du panier vide ; (2) le test du refus manque.';

test('the engine counts the remarks of a review as the page does (M9 review)',()=>{
  for(const text of [TWO_REMARKS,'Rien à redire.','(1) un seul point.','Trois. (1) a ; (2) b ; (3) c.',''])assert.equal(remarkCount(text),reportDigest(text).remarks.length,text);
});

test('the number of remarks of a review that asked for changes is kept once its file is replaced (M9 review, E4)', async()=>{
  let clock=at('10:00');
  const t=await setup({now:()=>clock});
  try{
    await t.chain.launch({sessionId:'s1',tickets:[FG2]});
    t.reports.push({ticket:'XJ-2',kind:'dev',commit:A,repo:'admin',summary:'fait',at:d1});
    await t.chain.tick({sessionId:'s1'});
    clock=at('10:06');t.reports.push({ticket:'XJ-2',kind:'review-1',commit:A,verdict:'changes_requested',summary:TWO_REMARKS,at:'2026-11-09T10:06:00.000Z'});
    await t.chain.tick({sessionId:'s1'});
    // The next round replaces both files.
    clock=at('10:20');t.reports.length=0;t.reports.push({ticket:'XJ-2',kind:'dev',commit:B,repo:'admin',summary:'corrigé',at:d2});
    await t.chain.tick({sessionId:'s1'});
    clock=at('10:24');t.reports.push({ticket:'XJ-2',kind:'review-1',commit:B,verdict:'accepted',summary:'ok',at:'2026-11-09T10:24:00.000Z'});
    await t.chain.tick({sessionId:'s1'});
    const steps=(await t.chain.read({sessionId:'s1'})).timings['XJ-2'];
    const asked=steps.find(s=>s.step==='review-1'&&s.verdict==='changes_requested'),ok=steps.find(s=>s.step==='review-1'&&s.verdict==='accepted');
    assert.equal(asked.remarks,2,JSON.stringify(steps));
    assert.equal(ok.remarks,undefined,'an acceptance tells no remarks');
  }finally{await t.cleanup();}
});

test('a verdict the user decided is kept with its provenance, beside the word of the reviewer, after its request is gone (M9 review, E5)', async()=>{
  let clock=at('10:00');
  const t=await setup({now:()=>clock});
  try{
    // The decisions the register says were taken: the one of the user on the verdict of XJ-2, then none (archived).
    let decisions=[{id:'D-1',item:'I-1',by:'owner',role:'owner',kind:'verdict',short:'Verdict XJ-2',said:'Accept as is',title:'Verdict',answer:'Accept as is',at:'2026-11-09T10:05:00.000Z',ticket:'XJ-2',from:'review-1'},
      {id:'D-2',item:'I-2',kind:'question',answer:'Oui',at:'2026-11-09T10:05:00.000Z',ticket:'XJ-2'}];
    const questions=createQuestionRegistry({root:t.root,now:()=>clock}),missions=createMissionRegistry({root:t.root,now:()=>clock});
    const real=createRequestRegistry({root:t.root,now:()=>clock,notify:async()=>{},questions,missions});
    const inbox=new Proxy(real,{get:(o,k)=>k==='taken'?async()=>decisions:o[k]});
    const chain=t.make({inbox,questions,missions});
    await chain.launch({sessionId:'s1',tickets:[FG2]});
    t.reports.push({ticket:'XJ-2',kind:'dev',commit:A,repo:'admin',summary:'fait',at:d1});
    await chain.tick({sessionId:'s1'});
    // The reviewer left the verdict to the user; he decided at 10:05; the reviewer wrote its report at 10:06.
    clock=at('10:06');t.reports.push({ticket:'XJ-2',kind:'review-1',commit:A,verdict:'accepted',summary:'Accepté sur décision.',at:'2026-11-09T10:06:00.000Z'});
    await chain.tick({sessionId:'s1'});
    decisions=[];clock=at('10:07');await chain.tick({sessionId:'s1'});
    const review=(await chain.read({sessionId:'s1'})).timings['XJ-2'].find(s=>s.step==='review-1');
    assert.equal(review.verdict,'accepted','the word of the reviewer, kept as it is');
    assert.deepEqual(review.decided,{by:'owner',role:'owner',answer:'Accept as is'},'the decision of the user, and from whom');
  }finally{await t.cleanup();}
});

test('a decision taken before the delivery under review is not given to its review (M9 review, E5)', async()=>{
  let clock=at('10:00');
  const t=await setup({now:()=>clock});
  try{
    const decisions=[{id:'D-1',item:'I-1',kind:'verdict',answer:'Have it fixed',at:'2026-11-09T09:50:00.000Z',ticket:'XJ-2'}];
    const questions=createQuestionRegistry({root:t.root,now:()=>clock}),missions=createMissionRegistry({root:t.root,now:()=>clock});
    const real=createRequestRegistry({root:t.root,now:()=>clock,notify:async()=>{},questions,missions});
    const chain=t.make({inbox:new Proxy(real,{get:(o,k)=>k==='taken'?async()=>decisions:o[k]}),questions,missions});
    await chain.launch({sessionId:'s1',tickets:[FG2]});
    t.reports.push({ticket:'XJ-2',kind:'dev',commit:A,repo:'admin',summary:'fait',at:d1});
    await chain.tick({sessionId:'s1'});
    clock=at('10:06');t.reports.push({ticket:'XJ-2',kind:'review-1',commit:A,verdict:'accepted',summary:'ok',at:'2026-11-09T10:06:00.000Z'});
    await chain.tick({sessionId:'s1'});
    assert.equal((await chain.read({sessionId:'s1'})).timings['XJ-2'].find(s=>s.step==='review-1').decided,undefined);
  }finally{await t.cleanup();}
});
