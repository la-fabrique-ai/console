import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, realpath, rm, stat, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createMissionRegistry } from '../src/mission.mjs';
import { createVisits, acceptedOf, sinceVisit, noteOf } from '../src/visits.mjs';
import { createBackend, SCREEN_COMMANDS } from '../src/backend.mjs';
import { AGENT_MARK } from '../ui/v3/view.js';
import { withFakeHerdr } from './helpers/fake-herdr.mjs';
import { night as nightOf, MIN, HOUR, T0, iso } from './helpers/m14-night.mjs';
import { pageSince, pageRecap, recapShown, visitAck, pageVisible } from '../mods/fabrique-console-v4-ticket/blocks.js';
import { pageBand } from '../mods/fabrique-console-v4-ticket/page.js';

// Ticket M14, « Since your last visit ». The engine keeps one cursor per mission (src/visits.mjs): the instant of the
// last fact the page showed. A reading never moves it; only the acknowledgement of the screen does (mission-visit-seen),
// sent by the page after it drew the recap, while it is visible. After an absence during which a ticket is accepted,
// the page shows that fact, once; at the next visit it shows nothing of it.

// The night: tests/helpers/m14-night.mjs (real chain, reports and git). What the page does with a reading it drew:
// the acknowledgement it owes, sent.
async function night(tt){
  const world=await nightOf(fn=>tt.after(fn)),{c}=world;
  const shown=async(actions,read,visible=true)=>{
    const rows=pageSince({overnight:read.overnight||null,asks:[],tickets:read.mission.plan.tickets.map(x=>({id:x.id})),now:c.t})?.rows||[];
    const due=visitAck({mission:read.mission.id,visit:read.visit,drawn:rows,visible});
    return due?actions.visitSeen(due):null;
  };
  return {...world,shown};
}
// The page of the ticket run as in Herdr (tests/helpers/ticket-visit-probe.mjs): its real loop, a fake window.
const probe=scenario=>spawnSync(process.execPath,['--experimental-vm-modules','--no-warnings',fileURLToPath(new URL('./helpers/ticket-visit-probe.mjs',import.meta.url)),fileURLToPath(new URL('..',import.meta.url)),scenario],{encoding:'utf8',timeout:60000});
const passed=(child,said)=>{assert.equal(child.status,0,child.stderr||child.stdout);assert.match(child.stdout,said);};

test('the criterion: a ticket accepted during an absence is shown once at the next visit, and nothing at the visit after',async tt=>{
  const {c,engine,accept,shown}=await night(tt),actions=engine();
  // Visit 1, in the evening: nothing happened yet, nothing drawn, nothing acknowledged (review 2).
  c.at(T0+20*MIN);
  const evening=await actions.read({mission:'M-1'});
  assert.equal('overnight' in evening,false);assert.equal(evening.visit.since,null);
  assert.equal(await shown(actions,evening),null);
  // The page closes. During the night the chain accepts XJ-2.
  await accept();
  // Visit 2, in the morning: the first visit that has a fact shows it, once.
  c.at(T0+14*HOUR);
  const morning=await actions.read({mission:'M-1'});
  assert.equal(morning.overnight.accepted,1);
  assert.deepEqual(morning.overnight.events.map(e=>[e.kind,e.ticket]),[['accepted','XJ-2']],'one line, for XJ-2');
  assert.equal(morning.overnight.since,null,'no acknowledgement before');
  assert.ok(Date.parse(morning.overnight.events[0].at)>T0+3*HOUR-MIN&&Date.parse(morning.overnight.events[0].at)<T0+4*HOUR,'at the instant of the acceptance');
  assert.equal(morning.overnight.events[0].note,'one review','E2: no « drift from the plan » is made up');
  const tickets=morning.mission.plan.tickets.map(x=>({id:x.id}));
  assert.deepEqual(pageSince({overnight:morning.overnight,asks:[],tickets,now:T0+14*HOUR}).rows.map(r=>r.text),['XJ-2 accepted'],'the page draws it once');
  const seen=await shown(actions,morning);
  assert.equal(seen.upTo,morning.overnight.events[0].at,'acknowledged up to the instant of the fact drawn');
  // Visit 3, a few seconds later (no window of 30 s any more): nothing of it.
  c.at(T0+14*HOUR+5000);
  const next=await actions.read({mission:'M-1'});
  assert.equal('overnight' in next,false);
  assert.equal(pageSince({overnight:next.overnight||null,asks:[],tickets}),null);
});

test('P1 an answer never received, then the tool started again: no fact is lost; two pages, the first without its answer, both get it',async tt=>{
  const {c,engine,accept,shown}=await night(tt);
  await accept();
  c.at(T0+14*HOUR);
  // Page A reads; its answer never arrives (nothing drawn, nothing acknowledged). The page closes, the tool restarts.
  await engine().read({mission:'M-1'});
  c.at(T0+14*HOUR+MIN);
  const again=engine(),b=await again.read({mission:'M-1'});
  assert.deepEqual(b.overnight?.events.map(e=>e.ticket),['XJ-2'],'after the restart, the fact is still to show');
  // A second page opened at once: page A has no answer, page B shows the fact; both read it.
  const pageA=await engine().read({mission:'M-1'});
  assert.deepEqual(pageA.overnight?.events.map(e=>e.ticket),['XJ-2']);
  // Hidden, page B acknowledges nothing: still there for the next reading.
  assert.equal(await shown(again,b,false),null);
  assert.deepEqual((await engine().read({mission:'M-1'})).overnight?.events.map(e=>e.ticket),['XJ-2']);
  // Page B shows it, visible: acknowledged. Page A, with its older reading, acknowledges after it: the cursor never goes back.
  const byB=await shown(again,b),byA=await shown(engine(),pageA);
  assert.equal(byA.upTo,byB.upTo);
  c.at(T0+15*HOUR);
  assert.equal('overnight' in await engine().read({mission:'M-1'}),false);
});

test('P1 an agent cannot hide a fact: mission-read writes nothing, takes no visit, and mission-visit-seen is a command of the screens',async tt=>{
  assert.ok(SCREEN_COMMANDS.includes('mission-visit-seen'));
  const root=await realpath(await mkdtemp(join(tmpdir(),'fabrique-console-m14-agent-')));tt.after(()=>rm(root,{recursive:true,force:true}));
  const backendOf=env=>createBackend(withFakeHerdr({root,env:{...process.env,FABRIQUE_CONSOLE_AGENT:'',...env},exec:async()=>{throw new Error('nothing runs');}}));
  await createMissionRegistry({root}).create({project:'alpha',issue:{id:'i1',identifier:'XJ-1',title:'Paiement',url:'u'},request:'Payer'});
  const agent=backendOf({[AGENT_MARK]:'1'}),screen=backendOf({});
  const read=await agent.dispatch('mission-read',{mission:'M-1'});
  assert.equal(read.visit.since,null,'a reading tells, for any reader');
  await assert.rejects(()=>agent.dispatch('mission-read',{mission:'M-1',visit:'v1'}),{code:'INVALID_ARGUMENT'});
  const upTo=iso(Date.now()-HOUR);
  await assert.rejects(()=>agent.dispatch('mission-visit-seen',{mission:'M-1',upTo}),e=>e.code==='AGENT_SESSION'&&e.message.includes('réservée au propriétaire'));
  await assert.rejects(stat(join(root,'state','visits','M-1.json')),{code:'ENOENT'},'neither the reading nor the refused acknowledgement wrote');
  const seen=await screen.dispatch('mission-visit-seen',{mission:'M-1',upTo});
  assert.equal(seen.upTo,upTo);
  assert.deepEqual(Object.keys(JSON.parse(await readFile(join(root,'state','visits','M-1.json'),'utf8'))).sort(),['at','upTo'],'one cursor, no visit kept');
  for(const bad of [{mission:'M-1'},{mission:'M-1',upTo:'yesterday'},{mission:'M-1',upTo:seen.upTo,visit:'x'},{mission:'../M-1',upTo:seen.upTo}])
    await assert.rejects(()=>screen.dispatch('mission-visit-seen',bad),{code:'INVALID_ARGUMENT'});
});

test('review 2, P1 the focus of the window: the page of the ticket shown in a window without the focus draws its line and acknowledges nothing; with the focus, once',()=>{
  const screen='fabrique-console-v4-ticket';
  assert.equal(pageVisible({layout:screen,screen,win:{active:false}}),false,'the window without the focus');
  assert.equal(pageVisible({layout:screen,screen}),false,'no signal: not visible');
  assert.equal(pageVisible({layout:screen,screen,win:{}}),false,'a window that does not say: not visible');
  assert.equal(pageVisible({layout:'fabrique-console-v4-devs',screen,win:{active:true}}),false,'another layout shown');
  assert.equal(pageVisible({layout:screen,screen,win:{active:true}}),true);
});

test('review 2, P4 the cycle of the page, window inactive: render, regular readings, no acknowledgement; focused, acknowledged once',()=>{
  passed(probe('inactive'),/^inactive: drawn but not acknowledged/m);
});

test('review 2, P4 the cycle of the page, no signal of the window (it fails, or says nothing): no acknowledgement',()=>{
  passed(probe('absent'),/^absent: drawn but not acknowledged/m);
});

test('review 2, P2 and P4 a first visit: no line drawn, no acknowledgement; a fact drawn by a regular reading is acknowledged up to its instant',()=>{
  passed(probe('first'),/^first: nothing drawn, nothing acknowledged/m);
});

test('review 2, P2 a first visit shows the facts of the mission, and only a line drawn is acknowledged',()=>{
  const at='2026-11-14T21:00:00.000Z',first=sinceVisit({record:{upTo:null,at:null},done:{'ok|XJ-2|a':Date.parse(at)}});
  assert.deepEqual(first.overnight?.events.map(e=>[e.ticket,e.at]),[['XJ-2',at]],'the first visit shows what happened');
  assert.equal(first.overnight.since,null);
  for(const visit of [{since:null,upTo:null},{since:null,upTo:at},{since:at,upTo:at}])
    assert.equal(visitAck({mission:'M-1',visit,drawn:[],visible:true}),null,'no line drawn: nothing acknowledged ('+JSON.stringify(visit)+')');
  assert.deepEqual(visitAck({mission:'M-1',visit:first.visit,drawn:[{at}],visible:true}),{mission:'M-1',upTo:at});
});

test('review 2, P3 a file holding null, or any value that is not an object, is unreadable, never absent: the recap is unavailable, nothing is written, nothing acknowledged',async tt=>{
  const {t,c,engine,accept}=await night(tt),actions=engine();
  await accept();c.at(T0+14*HOUR);
  const visits=join(t.root,'state','visits','M-1.json'),chain=join(t.root,'state','devchain-M-1.json'),good=await readFile(chain,'utf8');
  await mkdir(join(t.root,'state','visits'),{recursive:true});
  for(const junk of ['null','3','"x"','[]','true']){
    await writeFile(visits,junk);
    const read=await actions.read({mission:'M-1'});
    assert.equal(read.mission.id,'M-1');assert.deepEqual(read.visit,{unavailable:true},'visits '+junk);assert.equal('overnight' in read,false);
    await assert.rejects(()=>actions.visitSeen({mission:'M-1',upTo:iso(c.t-MIN)}),{code:'INVALID_DATA'},'visits '+junk);
    assert.equal(await readFile(visits,'utf8'),junk,'never written over');
  }
  await rm(visits);
  for(const junk of ['null','3','"x"','[]']){
    await writeFile(chain,junk);
    const read=await actions.read({mission:'M-1'});
    assert.equal(read.mission.id,'M-1');assert.deepEqual(read.visit,{unavailable:true},'chain '+junk);assert.equal('overnight' in read,false);
    const recap=pageRecap(null,'M-1',read),since=pageSince({overnight:recapShown(recap),asks:[],tickets:[{id:'XJ-2'}]});
    assert.equal(since.note,"Couldn't refresh this recap. Nothing new is marked as seen.");
    assert.equal(visitAck({mission:'M-1',visit:read.visit,drawn:since.rows,visible:true}),null);
  }
  await writeFile(chain,good);
  assert.deepEqual((await actions.read({mission:'M-1'})).overnight.events.map(e=>e.ticket),['XJ-2'],'repaired, the fact is there');
});

test('P1 the chain unreadable: the recap is unavailable, never « nothing »; the mission reads; nothing is acknowledged; repaired, the fact comes back',async tt=>{
  const {t,c,engine,accept}=await night(tt),actions=engine();
  await accept();
  const file=join(t.root,'state','devchain-M-1.json'),good=await readFile(file,'utf8');
  await writeFile(file,'{not json');
  c.at(T0+14*HOUR);
  const read=await actions.read({mission:'M-1'});
  assert.equal(read.mission.id,'M-1','the mission is read all the same');
  assert.deepEqual(read.visit,{unavailable:true});assert.equal('overnight' in read,false);
  const recap=pageRecap(null,'M-1',read),since=pageSince({overnight:recapShown(recap),asks:[],tickets:[{id:'XJ-2'}]});
  assert.equal(since.note,"Couldn't refresh this recap. Nothing new is marked as seen.");
  assert.equal(visitAck({mission:'M-1',visit:read.visit,drawn:since.rows,visible:true}),null);
  await writeFile(file,good);
  assert.deepEqual((await actions.read({mission:'M-1'})).overnight.events.map(e=>e.ticket),['XJ-2']);
});

test('P2 the visits unreadable: the mission reads, the recap is unavailable, and the cursor is never written over',async tt=>{
  const {t,c,engine}=await night(tt),actions=engine();
  const file=join(t.root,'state','visits','M-1.json');
  await mkdir(join(t.root,'state','visits'),{recursive:true});
  for(const junk of ['{oops','{"visits":[]}']){
    await writeFile(file,junk);
    const read=await actions.read({mission:'M-1'});
    assert.equal(read.mission.id,'M-1');assert.deepEqual(read.visit,{unavailable:true});
    await assert.rejects(()=>actions.visitSeen({mission:'M-1',upTo:iso(c.t-MIN)}),{code:'INVALID_DATA'});
    assert.equal(await readFile(file,'utf8'),junk);
  }
});

test('P2 once, without a window: a fact accepted after the drawing and before the acknowledgement stays to show; one drawn never comes back',async tt=>{
  const root=await mkdtemp(join(tmpdir(),'fabrique-console-m14-once-'));tt.after(()=>rm(root,{recursive:true,force:true}));
  let now=T0;const visits=createVisits({root,now:()=>now});
  await visits.seen('M-1',iso(T0));
  // Read and drawn at T0+10 min: XJ-2. XJ-3 is accepted one second after the drawing, before the acknowledgement.
  now=T0+10*MIN;
  const drawn=sinceVisit({record:await visits.read('M-1'),done:{'ok|XJ-2|a':T0+5*MIN}});
  const rows=pageSince({overnight:drawn.overnight,tickets:[{id:'XJ-2'},{id:'XJ-3'}],now}).rows;
  const done={'ok|XJ-2|a':T0+5*MIN,'ok|XJ-3|b':T0+10*MIN+1000};
  now=T0+10*MIN+2000;await visits.seen('M-1',visitAck({mission:'M-1',visit:drawn.visit,drawn:rows,visible:true}).upTo);
  // Read again two seconds later: XJ-3 only, XJ-2 never again.
  now=T0+10*MIN+4000;
  assert.deepEqual(sinceVisit({record:await visits.read('M-1'),done}).overnight.events.map(e=>e.ticket),['XJ-3']);
  // An acknowledgement older than the cursor (a page late) never moves it back.
  await visits.seen('M-1',iso(T0));
  assert.deepEqual(sinceVisit({record:await visits.read('M-1'),done}).overnight.events.map(e=>e.ticket),['XJ-3']);
  assert.equal((await visits.seen('M-1',iso(now+HOUR))).upTo,iso(now),'never beyond the present');
  assert.deepEqual(sinceVisit({record:await visits.read('M-1'),done:{...done,'ok|XJ-4|e':now+1000}}).overnight.events.map(e=>e.ticket),['XJ-4'],'a fact to come still shows');
});

test('P2 no visit is evicted: a page open while many others acknowledge keeps its lines until it leaves the mission',async()=>{
  const story=(events,more={})=>({mission:{id:'M-1'},visit:{since:'2026-11-14T19:10:00.000Z',upTo:'2026-11-14T19:10:00.000Z'},...(events?{overnight:{accepted:events.length,since:'2026-11-14T19:10:00.000Z',events}}:{}),...more});
  const fg2={kind:'accepted',ticket:'XJ-2',at:'2026-11-15T01:32:00.000Z',note:'one review'},fg3={kind:'accepted',ticket:'XJ-3',at:'2026-11-15T07:00:00.000Z'};
  let recap=pageRecap(null,'M-1',story([fg2]));
  // Nine other pages acknowledged since: the readings of this page tell nothing new, its line stays.
  for(let n=0;n<9;n++)recap=pageRecap(recap,'M-1',story(null));
  assert.deepEqual(recapShown(recap).events,[fg2]);
  assert.equal(recap.since,'2026-11-14T19:10:00.000Z','the title of this visit is kept');
  // A fact told later joins it, each fact once.
  recap=pageRecap(recap,'M-1',story([fg3,fg2]));
  assert.deepEqual(recap.events.map(e=>e.ticket),['XJ-3','XJ-2']);assert.equal(recap.accepted,2);
  // Another mission: a new recap; a reading of another mission leaves this one as it is.
  assert.equal(pageRecap(recap,'M-1',{mission:{id:'M-2'}}),recap);
  assert.equal(recapShown(pageRecap(recap,'M-2',story(null,{mission:{id:'M-2'}}))),null);
  // Acknowledged once per showing, then each time it grows.
  const visit={since:'2026-11-14T19:10:00.000Z',upTo:'2026-11-14T19:10:00.000Z'},rows=pageSince({overnight:recap,tickets:[{id:'XJ-2'},{id:'XJ-3'}]}).rows;
  const first=visitAck({mission:'M-1',visit,drawn:rows,visible:true});
  assert.deepEqual(first,{mission:'M-1',upTo:fg3.at});
  assert.equal(visitAck({mission:'M-1',visit,drawn:rows,acked:first,visible:true}),null);
});

test('the facts: each ticket once at its last acceptance, verdicts still waiting, the newest first',()=>{
  const since='2026-11-14T18:20:00.000Z',after=m=>Date.parse(since)+m*MIN,record={upTo:since,at:since};
  assert.deepEqual(sinceVisit({record:{upTo:null,at:null}}),{visit:{since:null,upTo:null}},'nothing yet: nothing to show');
  assert.equal('overnight' in sinceVisit({record,done:{'ok|XJ-2|a':after(-5)}}),false,'accepted before: nothing');
  assert.equal('overnight' in sinceVisit({record,done:{'ok|XJ-2|a':true}}),false,'an acceptance without an instant is never new');
  const done={'ok|XJ-2|a':after(5),'ok|XJ-2|b':after(50),'ok|XJ-3|c':after(30),'dev|XJ-4':after(1),'ok|XJ-5|d':after(-1)};
  assert.deepEqual(acceptedOf(done),{'XJ-2':after(50),'XJ-3':after(30),'XJ-5':after(-1)});
  const items=[{id:'I-1',kind:'verdict',ticket:'XJ-4',createdAt:iso(after(60))},{id:'I-2',kind:'verdict',ticket:'XJ-6',createdAt:iso(after(70)),answer:'x'},{id:'I-3',kind:'question',ticket:'XJ-7',createdAt:iso(after(80))},{id:'I-4',kind:'verdict',ticket:'XJ-8',createdAt:iso(after(-3))}];
  const timings={'XJ-2':[{step:'dev'},{step:'review-1',verdict:'changes_requested'},{step:'fix'},{step:'review-1',verdict:'accepted'},{step:'review-2',verdict:'accepted'}]};
  const n=sinceVisit({record,done,timings,items}).overnight;
  assert.equal(n.accepted,2);assert.equal(n.since,since);
  assert.deepEqual(n.events.map(e=>[e.kind,e.ticket,e.item??null]),[['verdict','XJ-4','I-1'],['accepted','XJ-2',null],['accepted','XJ-3',null]]);
  assert.equal(n.events[1].at,iso(after(50)));
  assert.equal(n.events[1].note,'one fixing round, two reviews');
  assert.equal(n.events[0].note,'the reviewer leaves it to you');
  assert.equal('note' in n.events[2],false,'nothing known of XJ-3: no note');
});

test('the note: fixing rounds, then the reviews it had (review 1, review 2), in the words of the mockup',()=>{
  assert.equal(noteOf([{step:'dev'},{step:'review-1',verdict:'accepted'}]),'one review');
  assert.equal(noteOf([{step:'review-1',verdict:'accepted'},{step:'review-2',verdict:'accepted'}]),'two reviews');
  assert.equal(noteOf([{step:'review-1',verdict:'changes_requested'},{step:'fix'},{step:'review-1',verdict:'changes_requested'},{step:'fix'},{step:'review-1',verdict:'accepted'}]),'two fixing rounds, one review');
  assert.equal(noteOf([{step:'dev'}]),null);assert.equal(noteOf(undefined),null);
});

test('the band: the morning return says what was accepted while a decision waits',()=>{
  const mission={id:'M-1',step:'building',on:true,plan:{tickets:[{id:'XJ-4',n:1}]},tickets:[{id:'XJ-4',state:'review'}]};
  const band=pageBand({mission,items:[{id:'I-1',mission:'M-1',type:'decision',kind:'verdict',ticket:'XJ-4',to:'legacyOwner',state:'pending',createdAt:'2026-11-15T06:40:00.000Z'}],on:true,overnight:{accepted:2,since:iso(Date.now()-2*24*HOUR)}});
  assert.equal(band.big,'Overnight: 2 tickets accepted · 1 decision is waiting on you');
});

test('review 2, E1 and E3: « Overnight » only while a decision waits and for an absence that covers the night, else « Since your last visit »',()=>{
  const mission={id:'M-1',step:'building',on:true,plan:{tickets:[{id:'XJ-4',n:1},{id:'XJ-5',n:2}]},tickets:[{id:'XJ-4',state:'review'},{id:'XJ-5',state:'todo'}]};
  const items=[{id:'I-1',mission:'M-1',type:'decision',kind:'verdict',ticket:'XJ-4',to:'legacyOwner',state:'pending',createdAt:'2026-11-15T13:40:00.000Z'}];
  const local=(d,h,m=0)=>new Date(2026,10,d,h,m).getTime(),now=local(15,15);
  const big=(since,more={})=>pageBand({mission,items,on:true,overnight:{accepted:2,since},now,...more}).big;
  assert.equal(big(new Date(local(14,19,10)).toISOString()),'Overnight: 2 tickets accepted · 1 decision is waiting on you','the absence began the day before');
  assert.equal(big(new Date(local(15,9)).toISOString()),'Since your last visit: 2 tickets accepted · 1 decision is waiting on you','the same day: not the night');
  assert.equal(big(null),'So far: 2 tickets accepted · 1 decision is waiting on you','a first visit: not the night, no visit before');
  assert.doesNotMatch(pageBand({mission,items:[],on:true,overnight:{accepted:2,since:new Date(local(14,19)).toISOString()},now}).big,/Overnight|Since your last visit/,'E1: no decision waits, no recap in the band');
});

test('decision 110: the first visit (no visit before) is titled « So far », a visit before keeps « Since your last visit »',()=>{
  const events=[{kind:'accepted',ticket:'XJ-2',at:'2026-11-15T09:00:00.000Z',note:'two fixing rounds, one review'}],tickets=[{id:'XJ-2'}],now=Date.parse('2026-11-15T15:00:00.000Z');
  assert.equal(pageSince({overnight:{accepted:1,since:null,events},tickets,now}).title,'So far');
  assert.equal(pageSince({overnight:{accepted:1,since:'2026-11-15T08:00:00.000Z',events},tickets,now}).title,'Since your last visit');
});
