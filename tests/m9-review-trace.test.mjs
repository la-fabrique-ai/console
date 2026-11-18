import test from 'node:test';
import assert from 'node:assert/strict';
import { timingsOf, historyMarks } from '../src/dev-chain.mjs';
import { setup, news, FG2 } from './helpers/dev-chain-setup.mjs';

// ---- Ticket M9: the trace of the reviews, round after round. Each report file is replaced at every round
// (src/dev-report.mjs): the verdict of each review is kept among the marks of the chain (said|…), so that a round
// « changes requested » then « accepted » is still told once the files only hold the last one.
const A='a'.repeat(40),B='b'.repeat(40),d1='2026-11-09T10:00:00.000Z',d2='2026-11-09T10:10:00.000Z';
const at=s=>Date.parse('2026-11-09T'+s+':00.000Z');
const verdicts=list=>list.filter(s=>/^review-/.test(s.step)).map(s=>[s.step,s.commit,s.delivered,s.verdict]);

test('the verdict of each review of each round is told by the engine, the files holding only the last round (M9)',()=>{
  const k1='XJ-2|'+A+'|'+d1,k2='XJ-2|'+B+'|'+d2;
  const done={'dev|XJ-2':at('09:50'),['done|'+k1]:at('10:00'),['rev|'+k1+'|1']:at('10:00'),['verdict|'+k1+'|1']:at('10:05'),['said|'+k1+'|1']:'changes_requested',['fix|'+k1]:at('10:05'),
    ['done|'+k2]:at('10:10'),['rev|'+k2+'|1']:at('10:10'),['verdict|'+k2+'|1']:at('10:15'),['said|'+k2+'|1']:'accepted',['ok|XJ-2|'+B]:at('10:15')};
  const own=[{ticket:'XJ-2',kind:'dev',commit:B,at:d2},{ticket:'XJ-2',kind:'review-1',commit:B,verdict:'accepted',at:'2026-11-09T10:15:00.000Z'}];
  const steps=timingsOf(done,own,{now:at('10:20')})['XJ-2'];
  assert.deepEqual(verdicts(steps),[['review-1',A,d1,'changes_requested'],['review-1',B,d2,'accepted']]);
  assert.deepEqual(steps.map(s=>s.step),['dev','review-1','fix','review-1'],'one fix, between the two rounds');
});

test('a verdict nothing tells is not invented: unknown without its mark nor its report; accepted by the acceptance of its round (M9)',()=>{
  const k1='XJ-2|'+A+'|'+d1,k2='XJ-2|'+B+'|'+d2;
  // Round 1: a verdict seen before this version (no said mark), its file replaced since. Round 2: accepted, no file.
  const done={'dev|XJ-2':at('09:50'),['done|'+k1]:at('10:00'),['rev|'+k1+'|1']:at('10:00'),['verdict|'+k1+'|1']:at('10:05'),['fix|'+k1]:at('10:05'),
    ['done|'+k2]:at('10:10'),['rev|'+k2+'|1']:at('10:10'),['ok|XJ-2|'+B]:at('10:15')};
  assert.deepEqual(verdicts(timingsOf(done,[],{now:at('10:20')})['XJ-2']),[['review-1',A,d1,null],['review-1',B,d2,'accepted']]);
  // A review under way has no verdict at all.
  const running=timingsOf({'dev|XJ-2':at('09:50'),['done|'+k1]:at('10:00'),['rev|'+k1+'|1']:at('10:00')},[],{now:at('10:02')})['XJ-2'];
  assert.ok(!('verdict' in running.at(-1)),JSON.stringify(running));
});

test('a mission taken up from its reports keeps the verdicts the reports prove (M9)',()=>{
  const flow={'XJ-2':{dev:{commit:A,at:d1},reviews:[{verdict:'changes_requested',at:'2026-11-09T10:05:00.000Z'}],stage:'fix'}};
  const marks=Object.fromEntries(historyMarks([{id:'XJ-2'}],flow,{step:'dev'}));
  assert.equal(marks['said|XJ-2|'+A+'|'+d1+'|1'],'changes_requested');
});

test('a round « changes requested » then « accepted » stays told by the chain after the reports are replaced (M9)', async()=>{
  const t=await setup();
  try{
    await t.chain.launch({sessionId:'s1',tickets:[FG2]});
    const dev=(commit,at)=>({ticket:'XJ-2',kind:'dev',commit,repo:'admin',summary:'fait',at});
    const review=(commit,verdict,at)=>({ticket:'XJ-2',kind:'review-1',commit,verdict,summary:'x',at});
    // Each agent replaces its own file: one dev report, one review report, at any time.
    const put=r=>{const i=t.reports.findIndex(x=>x.ticket===r.ticket&&x.kind===r.kind);if(i>=0)t.reports.splice(i,1);t.reports.push(r);};
    put(dev(A,d1));await t.chain.tick({sessionId:'s1'});
    put(review(A,'changes_requested','2026-11-09T10:05:00.000Z'));await t.chain.tick({sessionId:'s1'});
    put(dev(B,d2));await t.chain.tick({sessionId:'s1'});
    put(review(B,'accepted','2026-11-09T10:15:00.000Z'));await t.chain.tick({sessionId:'s1'});
    const steps=(await t.chain.read({sessionId:'s1'})).timings['XJ-2'];
    assert.deepEqual(verdicts(steps),[['review-1',A,d1,'changes_requested'],['review-1',B,d2,'accepted']]);
  }finally{await t.cleanup();}
});
