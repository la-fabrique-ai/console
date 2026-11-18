import test from 'node:test';
import assert from 'node:assert/strict';
import { setup, news, FG2 } from './helpers/dev-chain-setup.mjs';

const A='a'.repeat(40),d1='2026-11-09T10:00:00.000Z';
const at=s=>Date.parse('2026-11-09T'+s+':00.000Z');
// ---- Panne: the watcher started again during a review, the reviewer cut in the middle of it. One reviewer only is
// launched again, and the round is neither lost nor counted twice.
test('a reviewer cut in the middle of its review is launched again once, by one watcher, its round kept (M9)', async()=>{
  let clock=at('10:00');
  const t=await setup({now:()=>clock});
  try{
    await t.chain.launch({sessionId:'s1',tickets:[FG2]});
    t.reports.push({ticket:'XJ-2',kind:'dev',commit:A,repo:'admin',summary:'fait',at:d1});
    await t.chain.tick({sessionId:'s1'});
    const reviews=()=>news(t.calls).filter(x=>x==='XJ-2 · revue').length;
    assert.equal(reviews(),1);
    // The watcher started again during the review: the reviewer still works, nothing is launched.
    clock+=60000;const again=t.make({now:()=>clock});await again.tick({sessionId:'s1'});
    assert.equal(reviews(),1,'the reviewer alive is not launched again');
    // The reviewer is cut: its tab is gone, no verdict written. Two watchers pass, twice each.
    t.agents.splice(t.agents.indexOf(t.tab('XJ-2 · revue')),1);clock+=60000;
    const other=t.make({now:()=>clock});
    await again.tick({sessionId:'s1'});await other.tick({sessionId:'s1'});await again.tick({sessionId:'s1'});await other.tick({sessionId:'s1'});
    assert.equal(reviews(),2,'one reviewer launched again, once');
    assert.ok(t.tab('XJ-2 · revue'),'the reviewer is back');
    // Its verdict comes: the round counts once, its time from the first launch.
    clock+=4*60000;t.reports.push({ticket:'XJ-2',kind:'review-1',commit:A,verdict:'accepted',summary:'ok',at:'2026-11-09T10:06:00.000Z'});
    await other.tick({sessionId:'s1'});
    const read=await other.read({sessionId:'s1'}),steps=read.timings['XJ-2'];
    assert.deepEqual(steps.map(s=>[s.step,s.verdict??null]),[['dev',null],['review-1','accepted']],JSON.stringify(steps));
    assert.equal(steps[1].minutes,6,'from the first launch (10:00) to its verdict (10:06)');
    assert.equal(read.metrics['XJ-2'].rounds,1);
    assert.equal(read.log.filter(l=>/revue relancée/.test(l.text)).length,1,'said once in the journal');
  }finally{await t.cleanup();}
});

// M10 review, P1: tab.new answered with its terminal, and the window never shows that tab. Its absence is not proven: it
// may only be slow to show, and a late tab would make two reviewers. The doubt is kept as for a launch whose answer was
// lost: nothing is launched again, whatever the delay, and five minutes after the launch it is a stop in the Inbox.
test('a reviewer whose launch was answered and whose tab never shows keeps its doubt: never launched again, a stop at five minutes (M10 review)', async()=>{
  let clock=at('10:00');
  const t=await setup({now:()=>clock});
  try{
    const { createRequestRegistry } = await import('../src/requests.mjs');
    const inbox=createRequestRegistry({root:t.root,now:()=>clock});
    const stops=async()=>(await inbox.list({mission:'M-1'})).filter(i=>i.type==='stuck'&&i.cause==='reviewer');
    await t.chain.launch({sessionId:'s1',tickets:[FG2]});
    t.reports.push({ticket:'XJ-2',kind:'dev',commit:A,repo:'admin',summary:'fait',at:d1});
    const launchedAt=clock;
    await t.chain.tick({sessionId:'s1'});
    // Gone before any pass saw it: it may only be slow to show.
    t.agents.splice(t.agents.indexOf(t.tab('XJ-2 · revue')),1);clock+=5000;
    await t.chain.tick({sessionId:'s1'});
    assert.equal(news(t.calls).filter(x=>x==='XJ-2 · revue').length,1);
    // Still not shown a minute, then four minutes after its launch: nothing launched again, nothing said yet.
    clock+=60000;await t.chain.tick({sessionId:'s1'});await t.chain.tick({sessionId:'s1'});
    clock+=3*60000;await t.chain.tick({sessionId:'s1'});
    assert.equal(news(t.calls).filter(x=>x==='XJ-2 · revue').length,1,'no relaunch while the absence is not proven');
    assert.deepEqual(await stops(),[]);
    // Five minutes after its launch: a stop in the Inbox, once, from the instant of the launch, whatever watcher passes.
    clock+=60000;const other=t.make({now:()=>clock});
    await t.chain.tick({sessionId:'s1'});await other.tick({sessionId:'s1'});
    const [stop,...more]=await stops();
    assert.deepEqual(more,[]);
    assert.equal(stop.since,new Date(launchedAt).toISOString());
    assert.equal(news(t.calls).filter(x=>x==='XJ-2 · revue').length,1,'never launched again');
  }finally{await t.cleanup();}
});

test('a reviewer cut again and again is launched again twice at most, then said once (M9)', async()=>{
  let clock=at('10:00');
  const t=await setup({now:()=>clock});
  try{
    await t.chain.launch({sessionId:'s1',tickets:[FG2]});
    t.reports.push({ticket:'XJ-2',kind:'dev',commit:A,repo:'admin',summary:'fait',at:d1});
    await t.chain.tick({sessionId:'s1'});
    // Each reviewer is seen by a pass before it is cut (M10 review: a tab never seen is a doubt, never a cut).
    for(let i=0;i<4;i++){clock+=1000;await t.chain.tick({sessionId:'s1'});const tab=t.tab('XJ-2 · revue');if(tab)t.agents.splice(t.agents.indexOf(tab),1);clock+=120000;await t.chain.tick({sessionId:'s1'});}
    assert.equal(news(t.calls).filter(x=>x==='XJ-2 · revue').length,3,'the first launch and two more');
    const log=(await t.chain.read({sessionId:'s1'})).log;
    assert.equal(log.filter(l=>/plus relancé/.test(l.text)).length,1);
  }finally{await t.cleanup();}
});

// ---- M9 review, P1: an agent run by tab.new leaves its shell when it exits (the guide of Herdr), so a reviewer stopped
// keeps its tab. The tab alone proves nothing: a terminal there that no program reports a status for is a reviewer that
// stopped; a status the page does not know is never read as a stop.
test('a reviewer stopped whose tab stays open is launched again once, its old tab closed; an unknown status is no stop (M9 review)', async()=>{
  let clock=at('10:00');
  const t=await setup({now:()=>clock});
  try{
    await t.chain.launch({sessionId:'s1',tickets:[FG2]});
    t.reports.push({ticket:'XJ-2',kind:'dev',commit:A,repo:'admin',summary:'fait',at:d1});
    await t.chain.tick({sessionId:'s1'});
    const reviews=()=>news(t.calls).filter(x=>x==='XJ-2 · revue').length,first=t.tab('XJ-2 · revue');
    assert.equal(reviews(),1);
    // A status nobody knows, long after the launch: not a stop.
    first.status='rebooting';clock+=5*60000;await t.chain.tick({sessionId:'s1'});
    assert.equal(reviews(),1,'an unknown status is never taken for a stop');
    // The agent exited, its shell stays: the window lists the terminal with no status. Two watchers, twice each.
    first.status=null;clock+=60000;
    const other=t.make({now:()=>clock});
    await t.chain.tick({sessionId:'s1'});await other.tick({sessionId:'s1'});await t.chain.tick({sessionId:'s1'});await other.tick({sessionId:'s1'});
    assert.equal(reviews(),2,'one reviewer launched again, once');
    assert.ok(t.calls.some(([c,a])=>c==='tab.close'&&a.id===first.tab),'the tab of the reviewer that stopped is closed first');
    assert.equal(t.agents.filter(a=>a.tab_name==='XJ-2 · revue').length,1,'one reviewer tab, the new one');
    assert.equal(t.tab('XJ-2 · revue').status,'working');
    const read=await other.read({sessionId:'s1'});
    assert.equal(read.log.filter(l=>/revue relancée/.test(l.text)).length,1);
  }finally{await t.cleanup();}
});

// ---- M9 review, P2: the answer of tab.new lost on a relaunch, the reviewer made but shown late. The doubt is kept: no
// new reviewer is made until the window says what became of it, and the attempt counts in the cap of two.
test('a relaunch whose answer is lost keeps its doubt: nothing made again before the window settles it, and it counts (M9 review)', async()=>{
  let clock=at('10:00');
  const t=await setup({now:()=>clock});
  try{
    await t.chain.launch({sessionId:'s1',tickets:[FG2]});
    t.reports.push({ticket:'XJ-2',kind:'dev',commit:A,repo:'admin',summary:'fait',at:d1});
    await t.chain.tick({sessionId:'s1'});await t.chain.tick({sessionId:'s1'}); // its tab seen by a pass (M10 review)
    const reviews=()=>news(t.calls).filter(x=>x==='XJ-2 · revue').length,stop=()=>{t.tab('XJ-2 · revue').status=null;};
    // Stopped; the relaunch is made, its answer lost, and the window does not show it yet.
    stop();clock+=60000;
    let late=true;
    t.core.faults.do=command=>command==='tab.new'?'lost':null;
    t.core.faults.hidden=a=>late&&a.tab_name==='XJ-2 · revue';
    await t.chain.tick({sessionId:'s1'});
    assert.equal(reviews(),2);
    t.core.faults.do=null;
    // The passes right after: nothing made again, though the window shows no reviewer.
    clock+=5000;await t.chain.tick({sessionId:'s1'});clock+=20000;await t.chain.tick({sessionId:'s1'});
    assert.equal(reviews(),2,'no new reviewer before the doubt is settled');
    // The window shows it: it was made. It works, nothing more.
    late=false;clock+=10000;await t.chain.tick({sessionId:'s1'});
    assert.equal(reviews(),2);
    // Stopped again: one relaunch left, the lost one counted.
    stop();clock+=60000;await t.chain.tick({sessionId:'s1'});
    assert.equal(reviews(),3,'the second relaunch');
    stop();clock+=60000;await t.chain.tick({sessionId:'s1'});await t.chain.tick({sessionId:'s1'});
    assert.equal(reviews(),3,'the cap of two counts the relaunch whose answer was lost');
    assert.equal((await t.chain.read({sessionId:'s1'})).log.filter(l=>/plus relancé/.test(l.text)).length,1);
  }finally{await t.cleanup();}
});

test('a relaunch the window refuses leaves nothing claimed: tried again at the next pass (M9 review)', async()=>{
  let clock=at('10:00');
  const t=await setup({now:()=>clock});
  try{
    await t.chain.launch({sessionId:'s1',tickets:[FG2]});
    t.reports.push({ticket:'XJ-2',kind:'dev',commit:A,repo:'admin',summary:'fait',at:d1});
    await t.chain.tick({sessionId:'s1'});await t.chain.tick({sessionId:'s1'}); // its tab seen by a pass (M10 review)
    t.agents.splice(t.agents.indexOf(t.tab('XJ-2 · revue')),1);clock+=60000;
    t.core.faults.do=command=>command==='tab.new'?'fail':null;
    await t.chain.tick({sessionId:'s1'});
    t.core.faults.do=null;clock+=5000;await t.chain.tick({sessionId:'s1'});
    assert.equal(t.calls.filter(([c,a])=>c==='tab.new'&&a.name==='XJ-2 · revue').length,3,'the first launch, the refused one, the one tried again');
    assert.equal(news(t.calls).filter(x=>x==='XJ-2 · revue').length,3);
    assert.ok(t.tab('XJ-2 · revue'));
  }finally{await t.cleanup();}
});

// ---- M9 review 3 (decision 98), the scenario of the review: the shell of the reviewer that stopped is hidden when it
// is launched again, so it is never closed; the answer of that relaunch is lost. When the window shows both tabs again,
// the old shell bears the same name as the new reviewer: it must not settle the doubt. Each attempt is known by its own
// terminal, and only the tab of that attempt says it was made. Never two reviewers at work.
test('only the tab of the very attempt settles a lost relaunch: an old shell of the same name never does, and two reviewers never work (M9 review 3)', async()=>{
  let clock=at('10:00');
  const t=await setup({now:()=>clock});
  try{
    await t.chain.launch({sessionId:'s1',tickets:[FG2]});
    t.reports.push({ticket:'XJ-2',kind:'dev',commit:A,repo:'admin',summary:'fait',at:d1});
    await t.chain.tick({sessionId:'s1'});await t.chain.tick({sessionId:'s1'}); // its tab seen by a pass (M10 review)
    const reviews=()=>news(t.calls).filter(x=>x==='XJ-2 · revue').length,named=()=>t.agents.filter(a=>a.tab_name==='XJ-2 · revue');
    const working=()=>named().filter(a=>a.status==='working').length,first=t.tab('XJ-2 · revue');
    // The reviewer stops, its shell stays; at the relaunch the window hides every tab of that name, and the answer of
    // tab.new is lost.
    first.status=null;clock+=60000;
    let late=true;
    t.core.faults.do=command=>command==='tab.new'?'lost':null;
    t.core.faults.hidden=a=>late&&a.tab_name==='XJ-2 · revue';
    await t.chain.tick({sessionId:'s1'});
    t.core.faults.do=null;
    assert.equal(reviews(),2);
    assert.equal(named().length,2,'the old shell, hidden, could not be closed');
    // The window shows both again: the old shell first, the new reviewer at work.
    late=false;
    for(let i=0;i<4;i++){clock+=60000;await t.chain.tick({sessionId:'s1'});assert.ok(working()<=1,'never two reviewers at work (pass '+i+')');}
    assert.equal(reviews(),2,'the reviewer of the lost relaunch is the one: nothing launched again');
    assert.equal(working(),1);
    assert.ok(!t.agents.includes(first),'the old shell, shown again, is closed');
    // Settled by its own tab: when that reviewer stops in turn, the last relaunch is made, once.
    t.tab('XJ-2 · revue').status=null;clock+=60000;await t.chain.tick({sessionId:'s1'});await t.chain.tick({sessionId:'s1'});
    assert.equal(reviews(),3);
    assert.equal(working(),1);
  }finally{await t.cleanup();}
});

test('an old shell of the same name, shown while the lost relaunch is not, settles nothing: no reviewer is made (M9 review 3)', async()=>{
  let clock=at('10:00');
  const t=await setup({now:()=>clock});
  try{
    await t.chain.launch({sessionId:'s1',tickets:[FG2]});
    t.reports.push({ticket:'XJ-2',kind:'dev',commit:A,repo:'admin',summary:'fait',at:d1});
    await t.chain.tick({sessionId:'s1'});
    const reviews=()=>news(t.calls).filter(x=>x==='XJ-2 · revue').length,first=t.tab('XJ-2 · revue');
    first.status=null;clock+=60000;
    let hide=a=>a.tab_name==='XJ-2 · revue';
    t.core.faults.do=command=>command==='tab.new'?'lost':null;
    t.core.faults.hidden=a=>hide(a);
    await t.chain.tick({sessionId:'s1'});
    t.core.faults.do=null;
    // Only the old shell shows again; the reviewer of the relaunch stays hidden.
    hide=a=>a.tab_name==='XJ-2 · revue'&&a!==first;
    for(let i=0;i<3;i++){clock+=60000;await t.chain.tick({sessionId:'s1'});}
    assert.equal(reviews(),2,'the doubt stays: nothing is made again');
  }finally{await t.cleanup();}
});

test('a relaunch answered with its terminal as an object, or with none, is known by its own tab all the same (M9 review 3)', async()=>{
  for(const shape of ['object','none']){
    let clock=at('10:00');
    const t=await setup({now:()=>clock},{},{});
    try{
      await t.chain.launch({sessionId:'s1',tickets:[FG2]});
      t.reports.push({ticket:'XJ-2',kind:'dev',commit:A,repo:'admin',summary:'fait',at:d1});
      await t.chain.tick({sessionId:'s1'});
      const reviews=()=>news(t.calls).filter(x=>x==='XJ-2 · revue').length,working=()=>t.agents.filter(a=>a.tab_name==='XJ-2 · revue'&&a.status==='working').length;
      const first=t.tab('XJ-2 · revue');first.status=null;clock+=60000;
      const real=t.core.herdr.window.run;
      t.core.herdr.window.run=async(command,args)=>{const out=await real(command,args);return command==='tab.new'?(shape==='object'?{terminal:{id:out.terminal}}:{}):out;};
      let late=true;t.core.faults.hidden=a=>late&&a.tab_name==='XJ-2 · revue';
      await t.chain.tick({sessionId:'s1'});
      late=false;
      for(let i=0;i<3;i++){clock+=60000;await t.chain.tick({sessionId:'s1'});assert.ok(working()<=1,shape);}
      assert.equal(reviews(),2,shape);assert.equal(working(),1,shape);
    }finally{await t.cleanup();}
  }
});

// ---- M9 review 3 (decision 98), point 2: a reviewer whose launch was lost and whose tab never shows is not launched
// again (decision 48, rule 1): it becomes a ticket stopped, explained in the Inbox (M10), once, from the instant of that
// launch, whatever watcher passes. It is lifted when its tab shows at last.
test('a reviewer tab that never shows is a stop said once in the Inbox, from the instant of its launch, lifted when it shows (M9 review 3)', async()=>{
  let clock=at('10:00');
  const t=await setup({now:()=>clock});
  try{
    const { createRequestRegistry } = await import('../src/requests.mjs');
    const inbox=createRequestRegistry({root:t.root,now:()=>clock});
    await t.chain.launch({sessionId:'s1',tickets:[FG2]});
    t.reports.push({ticket:'XJ-2',kind:'dev',commit:A,repo:'admin',summary:'fait',at:d1});
    await t.chain.tick({sessionId:'s1'});
    const first=t.tab('XJ-2 · revue');first.status=null;clock+=60000;
    const lostAt=clock;let hidden=true;
    t.core.faults.do=command=>command==='tab.new'?'lost':null;
    t.core.faults.hidden=a=>hidden&&a.tab_name==='XJ-2 · revue'&&a!==first;
    await t.chain.tick({sessionId:'s1'});
    t.core.faults.do=null;
    const stops=async()=>(await inbox.list({mission:'M-1'})).filter(i=>i.type==='stuck'&&i.cause==='reviewer');
    clock+=60000;await t.chain.tick({sessionId:'s1'});
    assert.equal((await stops()).length,0,'a minute is not yet a tab that never shows');
    clock+=5*60000;
    const other=t.make({now:()=>clock});
    await t.chain.tick({sessionId:'s1'});await other.tick({sessionId:'s1'});await t.chain.tick({sessionId:'s1'});
    const [stop,...more]=await stops();
    assert.deepEqual(more,[],'said once, whatever watcher passes');
    assert.equal(stop.ticket,'XJ-2');
    assert.equal(stop.since,new Date(lostAt).toISOString(),'from the instant of the launch that did not show');
    assert.ok(stop.title&&stop.text,'it says what stops the ticket');
    assert.equal(news(t.calls).filter(x=>x==='XJ-2 · revue').length,2,'nothing launched again');
    // Its tab shows at last: the stop is lifted.
    hidden=false;clock+=60000;await other.tick({sessionId:'s1'});
    assert.deepEqual(await stops(),[]);
  }finally{await t.cleanup();}
});
