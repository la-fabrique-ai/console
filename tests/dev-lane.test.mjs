import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { devName, devTabId, createDevLane } from '../src/dev-lane.mjs';
import { AppError } from '../src/common.mjs';
import { fakeHerdr } from './helpers/fake-herdr.mjs';

// The lane of the devs of a mission (ticket 3 of the workflow v2): one dev terminal alive at most, asked for under the
// lock of the mission only, for the ticket that holds the lane, after the core said no other lives; freed on a stop
// seen in the core only. The core is the one fake Herdr (helpers/fake-herdr.mjs), which answers as the real one was seen to.
const M='M-1',LABELS=(ticket,launch)=>({'fabrique-console.mission':M,'fabrique-console.ticket':ticket,'fabrique-console.launch':String(launch)});
// A lane on a store in memory (the file of the chain, in the real thing) and a lock in memory with the manners of the
// real one: exclusive, refused at once, not reentrant.
function bench({core=fakeHerdr(),data={}}={}) {
  const d={lane:null,old:false,laneSeq:0,done:{},...data},held=new Set(),writes=[];
  const lock=async(dir,task)=>{if(held.has(dir))throw new AppError('BUSY','Another local operation is in progress.');held.add(dir);try{return await task();}finally{held.delete(dir);}};
  const lane=createDevLane({root:'/nowhere',kernel:core.herdr.kernel,load:async()=>d,change:async(_m,fn)=>{const r=fn(d);writes.push(JSON.parse(JSON.stringify(d.lane)));return r;},lock,wait:async()=>{},now:()=>0});
  const under=task=>lane.withLane(M,task);
  const ask=(ticket,more={})=>under(()=>lane.request(M,{ticket,cwd:'/wt',argv:['sleep','600'],space:'sp',...more}));
  return {d,core,lane,under,ask,writes,held,look:()=>under(()=>lane.look(M))};
}
const devsAlive=core=>core.live().filter(t=>t.labels['fabrique-console.mission']===M);

test('the name of the dev of a mission is one name per mission, fit for hc, and the id of its tab tells its launch', ()=>{
  assert.match(devName('M-1'),/^mc-dev-[a-z0-9]{1,25}$/);
  assert.equal(devName('M-1'),devName('M-1'));assert.notEqual(devName('M-1'),devName('M-11'));
  assert.equal(devTabId('XJ-2',3),'mc-dev-xj-2-3');
});

test('the core as the lane reads it: live, finished, none, a name taken, an answer lost, a core that does not answer', async()=>{
  const core=fakeHerdr(),k=core.herdr.kernel;
  assert.deepEqual(await k.get('mc-dev-x'),{state:'none',address:null,labels:{},status:null});
  const made=await k.run({name:'mc-dev-x',cwd:'/wt',labels:LABELS('XJ-2',1),argv:['sleep','600']});
  assert.match(made.address,/^t\d+$/);
  const seen=await k.get('mc-dev-x');
  assert.equal(seen.state,'live');assert.equal(seen.address,made.address);assert.deepEqual(seen.labels,LABELS('XJ-2',1));
  await assert.rejects(()=>k.run({name:'mc-dev-x',cwd:'/wt',labels:LABELS('XJ-3',2),argv:['sleep','600']}),e=>e.code==='NAME_TAKEN');
  assert.equal(core.live().length,1,'the second run made nothing');
  assert.equal((await k.kill(made.address)).state,'finished');
  assert.equal((await k.get(made.address)).state,'finished','a killed terminal is still read by its address');
  assert.equal((await k.get('mc-dev-x')).state,'finished','by its name, the finished one that held it');
  assert.equal((await k.kill('mc-dev-nobody')).state,'none','nothing to kill is nothing alive');
  const again=await k.run({name:'mc-dev-x',cwd:'/wt',labels:LABELS('XJ-2',2),argv:['sleep','600']});
  assert.notEqual(again.address,made.address,'the name of a finished terminal is free');
  core.faults.run='lost';
  await assert.rejects(()=>k.run({name:'mc-dev-y',cwd:'/wt',labels:{},argv:['sleep','600']}),e=>e.code==='LAUNCH_UNCERTAIN');
  assert.equal((await k.get('mc-dev-y')).state,'live','made all the same');
  core.faults.get='mute';
  await assert.rejects(()=>k.get('mc-dev-x'),e=>e.code==='HC_UNAVAILABLE');
  core.faults.get=null;core.faults.kill='fail';
  await assert.rejects(()=>k.kill('mc-dev-x'),e=>e.code==='HC_UNAVAILABLE');
  // An answer that is not the one of hc is no answer.
  const odd=fakeHerdr({on:async()=>({stdout:'not json'})}).herdr.kernel;
  await assert.rejects(()=>odd.get('x'),e=>e.code==='HC_UNAVAILABLE');
  await assert.rejects(()=>odd.run({name:'mc-dev-z',cwd:'/wt',labels:{},argv:['x']}),e=>e.code==='LAUNCH_UNCERTAIN');
  await assert.rejects(()=>fakeHerdr({on:async()=>({stdout:'{"address":"t1","state":"odd"}'})}).herdr.kernel.get('x'),e=>e.code==='HC_UNAVAILABLE');
});

test('the dev is asked of the core with the argv of an agent kept by the core, under the name of its mission, labelled', async()=>{
  const seen=[],k=fakeHerdr({on:async(file,args,options)=>{seen.push([file,args,options]);return {stdout:'{"address":"t4","name":"n","state":"live"}'};}}).herdr.kernel;
  await k.run({name:'mc-dev-x',cwd:'/wt',labels:{a:'1',b:'2'},argv:['claude','--model','m','do\nthis']});
  assert.deepEqual(seen[0].slice(0,2),['hc',['run','--bg','--json','--no-parent','--outlive-parent','--keep','--name','mc-dev-x','--cwd','/wt','--label','a=1','--label','b=2','--','claude','--model','m','do\nthis']]);
  await assert.rejects(()=>k.run({name:'Bad Name',cwd:'/wt',labels:{},argv:['x']}),e=>e.code==='INVALID_ARGUMENT');
  await assert.rejects(()=>k.run({name:'mc-dev-x',cwd:'/wt',labels:{a:'1\n2'},argv:['x']}),e=>e.code==='INVALID_ARGUMENT');
  assert.equal(seen.length,1,'nothing reached the core');
});

// ---- The table of the approach (section 5), one test per line.
test('table 1 — free, launch T, no dev alive: asked(T) is written before the core is asked, then one run under the name of the mission', async()=>{
  const b=bench();let atRun=null;
  b.core.faults.run=()=>{atRun=JSON.parse(JSON.stringify(b.d.lane));return null;};
  const out=await b.ask('XJ-2');
  assert.deepEqual(atRun,{ticket:'XJ-2',launch:1,tab:'asked',terminal:null},'asked, on the store, before the run');
  assert.equal(out.launched,true);assert.equal(out.launch,1);assert.equal(out.tab,'mc-dev-xj-2-1');
  const [t]=devsAlive(b.core);
  assert.equal(t.name,devName(M));assert.deepEqual(t.labels,{...LABELS('XJ-2',1),'herdr.space':'sp','herdr.tab':'mc-dev-xj-2-1'});
  assert.deepEqual(b.d.lane,{ticket:'XJ-2',launch:1,tab:'asked',terminal:t.address},'still asked: seen comes from a reading of the core');
  assert.equal(typeof b.d.done['dev|XJ-2'],'number','the time of its first launch');
});

test('table 3 — held by T, launch U: nothing changes, nothing is made (serial)', async()=>{
  const b=bench();await b.ask('XJ-2');await b.look();const before=JSON.stringify(b.d.lane);
  assert.deepEqual(await b.ask('XJ-3'),{launched:false,reason:'serial'});
  assert.deepEqual(await b.ask('XJ-3',{resume:true}),{launched:false,reason:'serial'});
  assert.equal(JSON.stringify(b.d.lane),before);assert.equal(b.core.terminals.length,1);
});

test('table 4 — asked(T), the core shows the terminal of this launch alive: seen(T), with its address', async()=>{
  const b=bench();b.core.faults.run='lost';
  const out=await b.ask('XJ-2');
  assert.equal(out.launched,false);assert.equal(out.reason,'uncertain');
  assert.deepEqual(b.d.lane,{ticket:'XJ-2',launch:1,tab:'asked',terminal:null},'asked is not erased by a failure');
  const view=await b.look();
  assert.equal(view.state,'live');
  assert.deepEqual(b.d.lane,{ticket:'XJ-2',launch:1,tab:'seen',terminal:b.core.terminals[0].address},'found again by the name of the mission, known by its labels');
});

test('table 5 — asked(T), the core shows no terminal: still asked(T), a doubt, and nothing is made without a gesture', async()=>{
  for(const fault of ['mute','dies']){
    const b=bench();b.core.faults.run=fault;
    await b.ask('XJ-2');b.core.faults.run=null;
    const made=b.core.terminals.length,view=await b.look();
    assert.equal(view.state,'doubt',fault);assert.equal(b.d.lane.tab,'asked');
    assert.deepEqual(await b.ask('XJ-2',{auto:true}),{launched:false,reason:'doubt'},'the tool does not try again on its own');
    assert.deepEqual(await b.ask('XJ-3',{auto:true}),{launched:false,reason:'serial'});
    assert.equal(b.core.terminals.length,made,'nothing more was asked of the core');
  }
});

test('table 6 — asked(T), T launched again by hand: the run is asked again under the same name, and the core refuses it if the first is alive', async()=>{
  // The first request never reached the core: the second makes the dev, of the same launch.
  const a=bench();a.core.faults.run='mute';await a.ask('XJ-2');a.core.faults.run=null;
  const out=await a.ask('XJ-2');
  assert.equal(out.launched,true);assert.equal(out.launch,1,'the same launch, asked again');
  assert.equal(devsAlive(a.core).length,1);assert.equal(a.d.lane.tab,'asked');
  // The first request reaches the core late, before the second: the second is refused by the core, one dev lives.
  const b=bench();b.core.faults.run='late';await b.ask('XJ-2');b.core.faults.run=null;
  assert.equal((await b.look()).state,'doubt');
  b.core.arrive();
  assert.deepEqual(await b.ask('XJ-2'),{launched:false,reason:'already'});
  assert.equal(devsAlive(b.core).length,1);assert.equal(b.d.lane.tab,'seen');
  // The first request reaches the core after the second one made its dev: the core refuses the late one.
  const c=bench();c.core.faults.run='late';await c.ask('XJ-2');c.core.faults.run=null;
  assert.equal((await c.ask('XJ-2')).launched,true);
  assert.equal(c.core.arrive(),null,'refused by the core: the name is held');
  assert.equal(devsAlive(c.core).length,1);
});

test('table 7 — seen(T), T launched again, its terminal alive: nothing changes, nothing is made (already)', async()=>{
  const b=bench();await b.ask('XJ-2');await b.look();const before=JSON.stringify(b.d.lane);
  assert.deepEqual(await b.ask('XJ-2',{resume:true}),{launched:false,reason:'already'});
  assert.deepEqual(await b.ask('XJ-2'),{launched:false,reason:'already'});
  assert.equal(JSON.stringify(b.d.lane),before);assert.equal(b.core.terminals.length,1);
});

for(const auto of [false,true])test('table 8 — seen(T), T launched again, its terminal seen stopped: asked(T) of a new launch, one run (auto='+auto+')', async()=>{
  const b=bench();await b.ask('XJ-2');await b.look();
  b.core.end(b.core.terminals[0]);
  assert.equal((await b.look()).state,'gone');assert.equal(b.d.lane.ticket,'XJ-2','the lane is still its own');
  assert.deepEqual(await b.ask('XJ-2'),{launched:false,reason:'already'},'a launch that is not a resume does not bring a dev back');
  assert.deepEqual(await b.ask('XJ-3',{resume:true}),{launched:false,reason:'serial'});
  const out=await b.ask('XJ-2',{resume:true,auto});
  assert.equal(out.launched,true);assert.equal(out.launch,2);
  assert.equal(devsAlive(b.core).length,1);assert.equal(devsAlive(b.core)[0].labels['fabrique-console.launch'],'2');
  assert.deepEqual(b.d.lane,{ticket:'XJ-2',launch:2,tab:'asked',terminal:devsAlive(b.core)[0].address});
  assert.deepEqual(await b.ask('XJ-2',{resume:true,auto}),{launched:false,reason:'already'},'never resume an already live replacement');
});

test('table 9 and 10 — held by T, T over: its dev is killed, working or not, and the lane is free only once the core says it stopped', async()=>{
  const b=bench();await b.ask('XJ-2');await b.look();
  // The kill fails: the lane stays held, it is asked again at the next pass.
  b.core.faults.kill='fail';
  await assert.rejects(()=>b.under(()=>b.lane.release(M)),e=>e.code==='HC_UNAVAILABLE');
  assert.equal(b.d.lane.ticket,'XJ-2');
  // The kill is answered and the terminal still lives when read again (a supposition): held.
  b.core.faults.kill='stays';
  assert.deepEqual(await b.under(()=>b.lane.release(M)),{freed:false,ticket:'XJ-2'});
  assert.equal(b.d.lane.ticket,'XJ-2');
  assert.deepEqual(await b.ask('XJ-3'),{launched:false,reason:'serial'},'the next one does not start');
  b.core.faults.kill=null;
  assert.deepEqual(await b.under(()=>b.lane.release(M)),{freed:true,ticket:'XJ-2'});
  assert.equal(b.d.lane,null);assert.equal(devsAlive(b.core).length,0);
  assert.equal((await b.ask('XJ-3')).launched,true);
});

test('a lane asked for and never seen is freed the same way: what lives under the name of the mission for its ticket is killed and seen stopped', async()=>{
  const b=bench();b.core.faults.run='lost';await b.ask('XJ-2');b.core.faults.run=null;
  assert.equal(b.d.lane.terminal,null);assert.equal(devsAlive(b.core).length,1);
  assert.deepEqual(await b.under(()=>b.lane.release(M)),{freed:true,ticket:'XJ-2'});
  assert.equal(devsAlive(b.core).length,0,'the dev made behind a lost answer is stopped, not left');
});

test('a lane asked for whose dev nobody saw is not freed on absences: only a stop seen in the core frees it', async()=>{
  // The request has not reached the core yet: nothing under the name, and that proves no stop.
  const b=bench();b.core.faults.run='late';await b.ask('XJ-2');b.core.faults.run=null;
  assert.deepEqual(b.d.lane,{ticket:'XJ-2',launch:1,tab:'asked',terminal:null});
  assert.deepEqual(await b.under(()=>b.lane.release(M)),{freed:false,ticket:'XJ-2'});
  assert.deepEqual(b.d.lane,{ticket:'XJ-2',launch:1,tab:'asked',terminal:null});
  assert.deepEqual(await b.ask('XJ-3'),{launched:false,reason:'serial'},'the next one does not start');
  // It arrives: its terminal is killed and seen stopped, and only then the lane is free.
  b.core.arrive();assert.equal(devsAlive(b.core).length,1);
  assert.deepEqual(await b.under(()=>b.lane.release(M)),{freed:true,ticket:'XJ-2'});
  assert.equal(b.d.lane,null);assert.equal(devsAlive(b.core).length,0);
  // A core that never answered: held for as long.
  const c=bench();c.core.faults.run='mute';await c.ask('XJ-2');c.core.faults.run=null;
  for(let i=0;i<3;i++)assert.deepEqual(await c.under(()=>c.lane.release(M)),{freed:false,ticket:'XJ-2'});
  assert.equal(c.d.lane.ticket,'XJ-2');
  // The terminal of this very launch, found stopped under the name of the mission: a stop seen.
  // (its program died at its start, and its address was never kept).
  const e=bench();e.core.faults.run='dies';await e.ask('XJ-2');e.core.faults.run=null;e.d.lane={...e.d.lane,terminal:null};
  assert.deepEqual(await e.under(()=>e.lane.release(M)),{freed:true,ticket:'XJ-2'});
  // A terminal of another launch stopped under that name says nothing of this one.
  const f=bench({data:{lane:{ticket:'XJ-2',launch:2,tab:'asked',terminal:null},laneSeq:2,done:{'dev|XJ-2':1}}});
  await f.core.invoke('hc',['run','--name',devName(M),'--cwd','/wt','--label','fabrique-console.mission='+M,'--label','fabrique-console.ticket=XJ-2','--label','fabrique-console.launch=1','--','sleep','600']);
  f.core.end(f.core.terminals[0]);
  assert.deepEqual(await f.under(()=>f.lane.release(M)),{freed:false,ticket:'XJ-2'});
});

test('table 11 — free, the core shows a dev alive under the name of the mission: blocked, nothing is made', async()=>{
  const b=bench();
  await b.core.invoke('hc',['run','--name',devName(M),'--cwd','/wt','--label','fabrique-console.mission='+M,'--label','fabrique-console.ticket=XJ-9','--label','fabrique-console.launch=7','--','sleep','600']);
  assert.equal((await b.look()).state,'foreign');
  assert.deepEqual(await b.ask('XJ-2'),{launched:false,reason:'blocked'});
  assert.equal(b.d.lane,null);assert.equal(b.core.terminals.length,1);
  // Held, and the terminal under the name of the mission is the one of another launch: blocked too, never taken for its own.
  const c=bench();await c.ask('XJ-2');await c.look();c.core.end(c.core.terminals[0]);
  await c.core.invoke('hc',['run','--name',devName(M),'--cwd','/wt','--label','fabrique-console.mission='+M,'--label','fabrique-console.ticket=XJ-2','--label','fabrique-console.launch=9','--','sleep','600']);
  assert.equal((await c.look()).state,'foreign');
  assert.deepEqual(await c.ask('XJ-2',{resume:true}),{launched:false,reason:'blocked'});
  assert.deepEqual(await c.under(()=>c.lane.release(M)),{freed:false,ticket:'XJ-2'},'nor killed: it is not the dev of this lane');
  // Asked, and the terminal alive under the name of the mission bears another launch of the same ticket: the number of
  // the launch says whose terminal it is. Not seen, not killed: blocked.
  const e=bench({data:{lane:{ticket:'XJ-2',launch:2,tab:'asked',terminal:null},laneSeq:2,done:{'dev|XJ-2':1}}});
  await e.core.invoke('hc',['run','--name',devName(M),'--cwd','/wt','--label','fabrique-console.mission='+M,'--label','fabrique-console.ticket=XJ-2','--label','fabrique-console.launch=1','--','sleep','600']);
  assert.equal((await e.look()).state,'foreign');assert.equal(e.d.lane.tab,'asked','a terminal of another launch does not vouch for this one');
  assert.deepEqual(await e.ask('XJ-2'),{launched:false,reason:'blocked'});
  assert.deepEqual(await e.under(()=>e.lane.release(M)),{freed:false,ticket:'XJ-2'});
  assert.equal(e.core.live().length,1);
});

test('table 12 — the core cannot be read: nothing changes, nothing is made', async()=>{
  const b=bench();b.core.faults.get='mute';
  await assert.rejects(()=>b.ask('XJ-2'),e=>e.code==='HC_UNAVAILABLE');
  assert.equal(b.d.lane,null);assert.equal(b.core.terminals.length,0);assert.deepEqual(b.writes,[]);
  b.core.faults.get=null;await b.ask('XJ-2');await b.look();const before=JSON.stringify(b.d.lane);
  b.core.faults.get='mute';
  await assert.rejects(()=>b.look(),e=>e.code==='HC_UNAVAILABLE');
  await assert.rejects(()=>b.under(()=>b.lane.release(M)),e=>e.code==='HC_UNAVAILABLE');
  assert.equal(JSON.stringify(b.d.lane),before,'unknown is never taken for absent');
  assert.equal(devsAlive(b.core).length,1);
});

test('table 13 — the process died between the note and the run: the lane is found asked, and taken up as a doubt', async()=>{
  // What a death right after the note leaves: the lane asked, written whole, and no terminal.
  const b=bench({data:{lane:{ticket:'XJ-2',launch:1,tab:'asked',terminal:null},laneSeq:1,done:{'dev|XJ-2':1}}});
  assert.equal((await b.look()).state,'doubt');
  assert.deepEqual(await b.ask('XJ-3'),{launched:false,reason:'serial'});
  assert.deepEqual(await b.ask('XJ-2',{auto:true}),{launched:false,reason:'doubt'});
  assert.equal(b.core.terminals.length,0);assert.deepEqual(b.d.lane,{ticket:'XJ-2',launch:1,tab:'asked',terminal:null});
  // A request that fails for a reason that is not the core's leaves the note too.
  const c=bench();c.core.faults.run=()=>{throw new Error('the process is gone');};
  assert.equal((await c.ask('XJ-2')).launched,false);
  assert.deepEqual(c.d.lane,{ticket:'XJ-2',launch:1,tab:'asked',terminal:null});
});

test('a mission started with the mechanism of before is refused everything of the lane, and nothing of the lane resets it', async()=>{
  const b=bench({data:{old:true,lane:undefined,done:{'dev|XJ-2':5,'asked|XJ-2':6,'preparing|XJ-3':7,'resumed|XJ-2':8,'shown|XJ-2':9,'stopped|XJ-2|5':10,'ok|XJ-2|abc':11}}});
  assert.equal((await b.look()).state,'old');
  assert.deepEqual(await b.ask('XJ-2'),{launched:false,reason:'old'});
  assert.deepEqual(await b.under(()=>b.lane.release(M)),{freed:false,ticket:null});
  assert.equal(b.core.terminals.length,0);assert.deepEqual(b.writes,[],'not rebuilt, not guessed');
  // No word of a caller makes it a mission of the lane: a dev of before may live under another name.
  assert.equal(b.lane.reset,undefined);assert.equal(b.d.old,true);
});

// ---- The lock.
test('the lane is read and written under its lock only', async()=>{
  const b=bench();
  await assert.rejects(()=>b.lane.look(M),e=>e.code==='DEV_LANE_UNLOCKED');
  await assert.rejects(()=>b.lane.request(M,{ticket:'XJ-2',cwd:'/wt',argv:['x'],space:'sp'}),e=>e.code==='DEV_LANE_UNLOCKED');
  await assert.rejects(()=>b.lane.release(M),e=>e.code==='DEV_LANE_UNLOCKED');
  assert.equal(b.core.terminals.length,0);
});

test('the lock is not reentrant, only its acquisition is tried again, and a BUSY of the task is handed up as it is', async()=>{
  const b=bench();
  // Taken inside itself: refused, at once without patience, after the patience of a command otherwise.
  await b.under(async()=>{
    await assert.rejects(()=>b.lane.withLane(M,async()=>'in',{patient:false}),e=>e.code==='DEV_LANE_BUSY');
  });
  // A command waits for the acquisition alone, ten seconds of its clock, then says busy; the task never ran.
  let clock=0,ran=0,tries=0;
  const held=new Set(['x']),lane=createDevLane({root:'/nowhere',kernel:null,load:null,change:null,now:()=>clock,wait:async()=>{clock+=500;},
    lock:async(_dir,task)=>{tries++;if(held.size)throw new AppError('BUSY','Another local operation is in progress.');return task();}});
  await assert.rejects(()=>lane.withLane(M,async()=>{ran++;}),e=>e.code==='DEV_LANE_BUSY');
  assert.equal(ran,0);assert.ok(tries>10&&clock>=10000&&clock<11000,'tried again for ten seconds: '+tries+' tries, '+clock+' ms');
  // Freed meanwhile: the command goes through.
  clock=0;tries=0;const free=createDevLane({root:'/nowhere',kernel:null,load:null,change:null,now:()=>clock,wait:async()=>{clock+=500;if(clock>=2000)held.clear();},
    lock:async(_dir,task)=>{tries++;if(held.size)throw new AppError('BUSY','x');return task();}});
  assert.equal(await free.withLane(M,async()=>'done'),'done');
  // A BUSY thrown by the task itself is not an acquisition: the task is not played again.
  let played=0;
  await assert.rejects(()=>b.lane.withLane(M,async()=>{played++;throw new AppError('BUSY','from the task');}),e=>e.code==='BUSY'&&e.message==='from the task');
  assert.equal(played,1);
  // The watcher does not wait.
  let waits=0;const quick=createDevLane({root:'/nowhere',kernel:null,load:null,change:null,now:()=>0,wait:async()=>{waits++;},lock:async()=>{throw new AppError('BUSY','x');}});
  await assert.rejects(()=>quick.withLane(M,async()=>{},{patient:false}),e=>e.code==='DEV_LANE_BUSY');
  assert.equal(waits,0);
});

test('the real lock: held by another process for as long as its task lasts, refused meanwhile, and dropped when that process dies', async()=>{
  const root=await mkdtemp(join(tmpdir(),'fabrique-console-lane-'));
  const helper=fileURLToPath(new URL('./helpers/dev-lane-holder.mjs',import.meta.url));
  const lane=createDevLane({root,kernel:null,load:null,change:null});
  const hold=()=>{const child=spawn(process.execPath,[helper,root,M],{stdio:['pipe','pipe','inherit']});return {child,ready:new Promise(done=>child.stdout.once('data',done)),gone:new Promise(done=>child.once('exit',done))};};
  try{
    // A task that lasts: no delay gives the lock back, only its end.
    const a=hold();await a.ready;
    await assert.rejects(()=>lane.withLane(M,async()=>'in',{patient:false}),e=>e.code==='DEV_LANE_BUSY');
    await new Promise(done=>setTimeout(done,400));
    await assert.rejects(()=>lane.withLane(M,async()=>'in',{patient:false}),e=>e.code==='DEV_LANE_BUSY','still held: its task is not over');
    // Another mission is not held.
    assert.equal(await lane.withLane('M-2',async()=>'in',{patient:false}),'in');
    a.child.stdin.end();await a.gone;
    assert.equal(await lane.withLane(M,async()=>'in',{patient:false}),'in','its task over, the lock is free');
    // The process that holds it is killed: the lock falls with it.
    const b=hold();await b.ready;
    await assert.rejects(()=>lane.withLane(M,async()=>'in',{patient:false}),e=>e.code==='DEV_LANE_BUSY');
    b.child.kill('SIGKILL');await b.gone;
    assert.equal(await lane.withLane(M,async()=>'in',{patient:false}),'in');
    // In one process too: not reentrant, with the real lock.
    await lane.withLane(M,async()=>{await assert.rejects(()=>lane.withLane(M,async()=>'in',{patient:false}),e=>e.code==='DEV_LANE_BUSY');});
  }finally{await rm(root,{recursive:true,force:true});}
});

// ---- The guard: one place makes a dev terminal.
test('one place in the sources asks the core for a dev, and the task of a dev goes nowhere else', async()=>{
  const dir=fileURLToPath(new URL('../src/',import.meta.url)),sources={};
  for(const name of (await readdir(dir)).filter(n=>n.endsWith('.mjs')))sources[name]=await readFile(join(dir,name),'utf8');
  const count=(text,needle)=>text.split(needle).length-1;
  const runs=Object.entries(sources).filter(([,text])=>text.includes('kernel.run(')).map(([name,text])=>[name,count(text,'kernel.run(')]);
  // The traces of the agents (M12) wrap the kernel the lane is given and hand its one run on, traced: they make none.
  assert.deepEqual(runs,[['dev-lane.mjs',1],['traces.mjs',1]],'the only run of a dev terminal');
  assert.match(sources['traces.mjs'],/const kernel=\{\.\.\.herdr\.kernel,run:async input=>\{\s*const opened=await agent\(input\?\.argv,[^]*?return bound\(opened,await herdr\.kernel\.run\(\{\.\.\.input,argv:opened\.argv\}\)\);\s*\}\}/,'the traces only forward the run they are asked, then bind its answer');
  const tasks=Object.entries(sources).filter(([,text])=>text.includes('devTask(')).map(([name,text])=>[name,count(text,'devTask(')]);
  assert.deepEqual(tasks,[['dev-chain.mjs',1]],'the task of a dev is built once');
  const chain=sources['dev-chain.mjs'],at=chain.indexOf('devTask('),statement=chain.slice(chain.lastIndexOf('\n',at),chain.indexOf('\n',at));
  assert.match(statement,/lane\.request\(/,'and handed to the lane, not to a tab of the window');
  assert.equal(/tab\.new[^\n]*devTabName/.test(chain),false,'no tab of the window is made under the name of a dev');
  assert.equal(/\.lane\s*=[^=]/.test(chain),false,'the chain does not write the lane');
});
