import test from 'node:test';
import assert from 'node:assert/strict';
import { setup, news, FG2 } from './helpers/dev-chain-setup.mjs';

// ---- M9 review 2 (decision 97): a launch of a reviewer whose answer is lost is settled only by the window showing its
// tab; the delay alone proves no absence, and no second reviewer is ever made beside it.
const A='a'.repeat(40),d1='2026-11-09T10:00:00.000Z';
const at=s=>Date.parse('2026-11-09T'+s+':00.000Z');

test('a launch whose answer is lost and whose tab shows only after the delay never gives two reviewers (M9 review 2)', async()=>{
  let clock=at('10:00');
  const t=await setup({now:()=>clock});
  try{
    await t.chain.launch({sessionId:'s1',tickets:[FG2]});
    t.reports.push({ticket:'XJ-2',kind:'dev',commit:A,repo:'admin',summary:'fait',at:d1});
    // The first launch of the review is made, its answer lost, and the window does not show it for a long while.
    let late=true;
    t.core.faults.do=command=>command==='tab.new'?'lost':null;
    t.core.faults.hidden=a=>late&&a.tab_name==='XJ-2 · revue';
    await t.chain.tick({sessionId:'s1'});
    t.core.faults.do=null;
    const reviews=()=>news(t.calls).filter(x=>x==='XJ-2 · revue').length;
    assert.equal(reviews(),1);
    // Well past the delay, two watchers pass: the window still shows no reviewer, but nothing proves it absent.
    const other=t.make({now:()=>clock});
    for(let i=0;i<3;i++){clock+=2*60000;await t.chain.tick({sessionId:'s1'});await other.tick({sessionId:'s1'});}
    assert.equal(reviews(),1,'no new reviewer on the delay alone');
    // It shows at last: one reviewer, the first.
    late=false;clock+=60000;await t.chain.tick({sessionId:'s1'});await other.tick({sessionId:'s1'});
    assert.equal(reviews(),1);
    assert.equal(t.agents.filter(a=>a.tab_name==='XJ-2 · revue').length,1,'one reviewer tab');
    // Seen once, it is the reviewer: stopped later, it is launched again as any other.
    t.tab('XJ-2 · revue').status=null;clock+=60000;await t.chain.tick({sessionId:'s1'});
    assert.equal(reviews(),2,'the doubt settled by the window, a stop is a stop again');
  }finally{await t.cleanup();}
});
