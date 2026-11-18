import test from 'node:test';
import assert from 'node:assert/strict';
import { desk } from './helpers/requests.mjs';

// ---- M10, « Blocage expliqué »: a ticket stopped is a request of the Inbox (type stuck) that says why, who is on it,
// what is being tried, and since when it is stopped. Its instant is the instant of the stop, and it stays the same
// however many times the request is written again (tries added, the watcher started again): the time shown on the
// banner, the card and the details always starts from it.
const STOP={type:'stuck',cause:'blocked',mission:'M-1',project:'alpha',issue:'XJ-1',ticket:'XJ-2',question:null,title:'Migration 0026 fails locally',text:'La migration 0026 ne passe pas sur la base locale.',blocked:['XJ-2'],proofs:[],
  since:'2026-11-13T08:52:00.000Z',owner:'lead',forUser:false,migration:'0026'};

test('a ticket stopped says since when, who is on it, the migration that fails and what is tried (M10)',async t=>{
  const f=await desk(t);
  const {item}=await f.inbox.ask(STOP);
  assert.equal(item.since,'2026-11-13T08:52:00.000Z','the instant of the stop, not the instant the request was written');
  assert.equal(item.owner,'lead');assert.equal(item.forUser,false);assert.equal(item.migration,'0026');
  assert.deepEqual(item.tries??[],[]);
  const shown=(await f.shown()).find(i=>i.id===item.id);
  assert.deepEqual([shown.since,shown.owner,shown.forUser,shown.migration],['2026-11-13T08:52:00.000Z','lead',false,'0026'],'the page reads them where the engine writes them');
});

test('the tries written again keep the instant of the stop; the same words change nothing; a new stop after it is lifted is a new instant (M10)',async t=>{
  const f=await desk(t);
  const first=(await f.inbox.ask(STOP)).item;
  f.later(10);
  const tries=[{text:'Dev 1 a relancé la migration telle quelle',at:'2026-11-13T08:54:00.000Z',outcome:'same'},{text:'Le Lead fait dédoublonner les rangs',outcome:'running'},{text:'Sinon : régénérer le projet de test',last:true}];
  const {since:_ignored,...again}=STOP;
  const next=await f.inbox.ask({...again,tries});
  assert.equal(next.created,true);assert.equal(next.replaced,first.id,'the request with its tries takes the place of the one before');
  assert.equal(next.item.since,STOP.since,'its instant is kept');
  assert.deepEqual(next.item.tries,tries);
  assert.equal(f.notified.length,1,'a stop written again notifies nobody again');
  const same=await f.inbox.ask({...again,tries});
  assert.equal(same.created,false);assert.equal(same.item.id,next.item.id);
  await f.inbox.mark(next.item.id,{state:'resolved'});
  f.later(5);
  const other=(await f.inbox.ask({...again})).item;
  assert.notEqual(other.id,next.item.id);
  assert.equal(other.since,other.createdAt,'stopped again after it was lifted: from this new instant');
});

test('what a stop says is checked: an instant, the Lead as the one on it, a short migration, ten tries at most (M10)',async t=>{
  const f=await desk(t);
  const {item}=await f.inbox.ask({...STOP,since:'yesterday',owner:'someone',migration:'x'.repeat(500),tries:[{text:''},{text:'ok',outcome:'other',at:'soon',last:'yes'},...Array.from({length:20},(_,n)=>({text:'try '+n}))]});
  assert.equal(item.since,item.createdAt,'an instant that cannot be read is the instant of the request');
  assert.equal(item.owner,undefined);
  assert.equal(item.migration.length,40);
  assert.equal(item.tries.length,10);
  assert.deepEqual(item.tries[0],{text:'ok'},'a try without its text is left out, and so is what it says wrongly');
});

// ---- The chain: a dev that cannot go on says it (fabrique-console-report block); the tool says the ticket stopped, from the
// instant the dev said it, with the Lead on it and nothing for the user to do, and tells the Lead once. Panne: the
// watcher started again during the stop asks the Lead nothing more, and the time keeps its start.
import { setup, FG2 } from './helpers/dev-chain-setup.mjs';
import { createRequestRegistry } from '../src/requests.mjs';
const A='a'.repeat(40),B='b'.repeat(40),at=s=>Date.parse('2026-11-09T'+s+':00.000Z');
const BLOCK={ticket:'XJ-2',kind:'block',name:'XJ-2.block-1762682520000.json',at:'2026-11-09T10:02:00.000Z',reason:'La migration 0026 ne passe pas sur la base locale : deux tickets ont le même rang.',migration:'0026'};

test('a dev that says its ticket stopped: one stop in the Inbox from that instant, the Lead on it, told once, even after the watcher starts again (M10)',async()=>{
  let clock=at('10:03');
  const t=await setup({now:()=>clock});
  try{
    const inbox=createRequestRegistry({root:t.root,now:()=>clock});
    await t.chain.launch({sessionId:'s1',tickets:[FG2]});
    t.reports.push({...BLOCK});
    await t.chain.tick({sessionId:'s1'});
    const stops=async()=>(await inbox.list({mission:'M-1'})).filter(i=>i.type==='stuck'&&i.cause==='blocked');
    const toLead=()=>t.sent.filter(x=>x.terminal==='t1'&&/XJ-2/.test(x.text)&&/lead-block/.test(x.text));
    let [stop,...more]=await stops();
    assert.deepEqual(more,[]);
    assert.deepEqual([stop.ticket,stop.since,stop.owner,stop.forUser,stop.migration],['XJ-2','2026-11-09T10:02:00.000Z','lead',false,'0026']);
    assert.equal(stop.text,BLOCK.reason);
    assert.equal(toLead().length,1,'the Lead is told once');
    assert.doesNotMatch(toLead()[0].text,/deux tickets ont le même rang/,'the words of the dev stay in its file: the message names it');
    // Panne: the watcher started again, twice, ten minutes later.
    clock+=10*60000;
    const again=t.make({now:()=>clock});await again.tick({sessionId:'s1'});await again.tick({sessionId:'s1'});await t.chain.tick({sessionId:'s1'});
    [stop,...more]=await stops();
    assert.deepEqual(more,[]);
    assert.equal(stop.since,'2026-11-09T10:02:00.000Z','the time still starts from the stop');
    assert.equal(toLead().length,1,'one request to the Lead, whatever watcher passes');
    const read=await again.read({sessionId:'s1'});
    assert.equal(read.log.filter(l=>l.text==='XJ-2 stopped, Lead called').length,1,'said once in the journal, in the words of the mockup (screen 12)');
    // The dev goes on and delivers: the stop is lifted.
    clock+=60000;t.reports.push({ticket:'XJ-2',kind:'dev',commit:A,repo:'admin',summary:'fait',at:new Date(clock).toISOString()});
    await again.tick({sessionId:'s1'});
    assert.deepEqual(await stops(),[]);
    assert.equal(toLead().length,1);
  }finally{await t.cleanup();}
});

test('a stop said before the last delivery of its dev is over: nothing is opened for it (M10)',async()=>{
  let clock=at('10:30');
  const t=await setup({now:()=>clock});
  try{
    const inbox=createRequestRegistry({root:t.root,now:()=>clock});
    await t.chain.launch({sessionId:'s1',tickets:[FG2]});
    t.reports.push({...BLOCK},{ticket:'XJ-2',kind:'dev',commit:B,repo:'admin',summary:'fait',at:'2026-11-09T10:20:00.000Z'});
    await t.chain.tick({sessionId:'s1'});
    assert.deepEqual((await inbox.list({mission:'M-1'})).filter(i=>i.type==='stuck'),[]);
    assert.equal(t.sent.filter(x=>x.terminal==='t1'&&/lead-block/.test(x.text)).length,0);
  }finally{await t.cleanup();}
});

test('the Lead writes what it tries, says when the user is needed, and lifts the stop; its instant never moves (M10)',async t=>{
  const f=await desk(t);
  await assert.rejects(()=>f.actions.block({mission:'M-1',ticket:'XJ-2',tries:[{text:'x'}]}),e=>e.code==='NOT_FOUND','no stop open for that ticket');
  const first=(await f.inbox.ask(STOP)).item;
  f.later(12);
  const tries=[{text:'Dev 1 a relancé la migration telle quelle',at:'2026-11-13T08:54:00.000Z',outcome:'same'},{text:'Le Lead fait dédoublonner les rangs',at:'2026-11-13T09:02:00.000Z',outcome:'running'},{text:'Sinon : régénérer le projet de test',last:true}];
  const {item}=await f.actions.block({mission:'M-1',ticket:'XJ-2',tries});
  assert.notEqual(item.id,first.id);
  assert.deepEqual([item.since,item.owner,item.forUser,item.migration,item.text],[STOP.since,'lead',false,'0026',STOP.text],'what it said stays');
  assert.deepEqual(item.tries,tries);
  const asks=(await f.actions.block({mission:'M-1',ticket:'XJ-2',tries,forUser:true})).item;
  assert.equal(asks.forUser,true);assert.equal(asks.since,STOP.since);
  await assert.rejects(()=>f.actions.block({mission:'M-1',ticket:'XJ-2',owner:'me'}),e=>e.code==='INVALID_ARGUMENT');
  const lifted=await f.actions.block({mission:'M-1',ticket:'XJ-2',lifted:true});
  assert.equal(lifted.lifted,true);
  assert.deepEqual((await f.shown()).filter(i=>i.type==='stuck'),[],'gone once it is lifted');
});

test('a stop whose ticket is canceled in the tracker is lifted (M10)',async()=>{
  let clock=at('10:03');
  const t=await setup({now:()=>clock});
  try{
    const inbox=createRequestRegistry({root:t.root,now:()=>clock});
    await t.chain.launch({sessionId:'s1',tickets:[FG2]});
    t.reports.push({...BLOCK});
    await t.chain.tick({sessionId:'s1'});
    const stops=async()=>(await inbox.list({mission:'M-1'})).filter(i=>i.type==='stuck'&&i.cause==='blocked');
    assert.equal((await stops()).length,1);
    t.issue.children[0].state={type:'canceled'};clock+=60000;
    await t.chain.tick({sessionId:'s1'});await t.chain.tick({sessionId:'s1'});
    assert.deepEqual(await stops(),[]);
  }finally{await t.cleanup();}
});
