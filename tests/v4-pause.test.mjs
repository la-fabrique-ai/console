import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {pageBand,pageWorkers,pauseOf,stuckSpan} from '../mods/fabrique-console-v4-ticket/page.js';
import {lineTickets,lineCard,lineDetail} from '../mods/fabrique-console-v4-ticket/line.js';
import {pageSheet,pageStrip} from '../mods/fabrique-console-v4-ticket/blocks.js';

// The pause (screens 08 and 11, N02 of the final list) and a ticket stopped (screens 12 and 13).
const T0=new Date(2026,10,13,10,24).getTime(),local=(h,min)=>new Date(2026,10,13,h,min).toISOString();
const IDS=['PRB-142','PRB-144','PRB-149','PRB-145','PRB-146','PRB-147','PRB-150','PRB-151','PRB-148'];
const ticket=(id,n,state,extra={})=>({id,n,state,title:'Titre '+id,dev:'claude',model:'claude-opus-5-5',effort:'high',deps:[],...extra});
const mission=(states,extra={})=>({id:'M-1',project:'beta',step:'building',issue:{identifier:'PRB-41'},tickets:IDS.map((id,i)=>ticket(id,i+1,states[i]||'todo')),branch:'prb-41',lead:{sessionId:'s1'},...extra});
const AT_08=['accepted','accepted','accepted','accepted','dev'],AT_12=['accepted','accepted','dev'];
const LEAD={address:'t1',space:'sp',tab:'tb',tab_name:'Lead · PRB-41',status:'idle'};
const agent=(address,tab_name,status='working')=>({address,space:'sp',tab:'tab-'+address,tab_name,status});
const band=(states,more={})=>pageBand({mission:mission(states),lead:LEAD,now:T0,...more}),said=b=>[b.tone,b.icon,b.big,b.det];
// What the engine says of a ticket stopped, on its request of the Inbox (simulation/CONTRAT.md § 3 ter).
const STUCK={id:'I-9',type:'stuck',state:'pending',mission:'M-1',priority:1,ticket:'PRB-149',title:'La migration 0026 ne passe pas sur la base locale',text:'La migration 0026 ne passe pas sur la base locale : deux tickets ont le même rang.',createdAt:local(10,2),
  migration:'0026',owner:'lead',forUser:false,tries:[{text:'Dev 1 a relancé la migration telle quelle',at:local(10,4),outcome:'same'},{text:'Le Lead fait dédoublonner les rangs',at:local(10,12),outcome:'running'},{text:'Sinon : régénérer le projet de test',last:true}]};

test('the pause is read only from an engine that says it has it',()=>{
  assert.equal(pauseOf(null),null);assert.equal(pauseOf({}),null);assert.equal(pauseOf({pause:true}),null);assert.equal(pauseOf({pause:{state:'later'}}),null);
  assert.deepEqual(['none','requested','paused'].map(state=>pauseOf({pause:{state}})?.state),['none','requested','paused']);
});
test('« Pause » stands on the banner of a development that runs, and only when the engine has the function',()=>{
  const without=band(AT_08),withIt=band(AT_08,{pause:{state:'none'}});
  assert.deepEqual(said(without),['run','◠','On track: PRB-146 in dev','4 of 9 accepted · nothing is waiting on you']);
  assert.equal(without.second,undefined,'the engine of today has no pause: no button');assert.equal(without.button,undefined);
  assert.deepEqual(said(withIt),said(without));assert.deepEqual(withIt.second,{key:'pause',label:'Pause'});
  assert.deepEqual(band(['accepted'],{pause:{state:'none'}}).second,{key:'pause',label:'Pause'},'between two tickets too');
  // Not while the user is waited for, nor on a ticket stopped, nor once all is accepted, nor in Prepare.
  const ask={id:'I-1',type:'decision',state:'pending',mission:'M-1',ticket:'PRB-146',title:'?'};
  assert.equal(band(AT_08,{pause:{state:'none'},items:[ask]}).second,undefined);
  assert.equal(band(AT_12,{pause:{state:'none'},items:[STUCK]}).second.key,'blocking');
  assert.equal(band(Array(9).fill('accepted'),{pause:{state:'none'}}).second,undefined);
  assert.equal(pageBand({mission:mission([],{step:'analysing'}),lead:LEAD,pause:{state:'none'},now:T0}).second,undefined);
});
test('a pause asked: the agent at work finishes its turn, in the words of the final list (N02)',()=>{
  const b=band(AT_08,{pause:{state:'requested'}});
  assert.deepEqual(said(b),['off','Ⅱ','Pausing · Dev 1 is finishing its turn','No new work will start after this turn.']);
  assert.deepEqual(b.button,{key:'resume',label:'Resume'});assert.equal(b.second,undefined);
  assert.equal(band(['accepted','review'],{pause:{state:'requested'}}).big,'Pausing · Reviewer is finishing its turn');
  assert.equal(band(AT_08,{pause:{state:'requested',agent:{role:'qa'}}}).big,'Pausing · QA agent is finishing its turn','the agent the engine names');
  assert.equal(band(AT_08,{pause:{state:'requested',agent:{role:'dev',dev:2}}}).big,'Pausing · Dev 2 is finishing its turn');
  const two=mission(AT_08,{plan:{tickets:IDS.map((id,i)=>({id,dev:i===4?2:1}))}});
  assert.equal(pageBand({mission:two,lead:LEAD,pause:{state:'requested'},now:T0}).big,'Pausing · Dev 2 is finishing its turn','the dev of the ticket in hand');
  assert.equal(band(['accepted'],{pause:{state:'requested'}}).big,'Pausing','nobody known at work: no agent is made up');
});
test('in pause the banner is the grey one of screen 11, to the letter, with « Resume »',()=>{
  const b=band(AT_08,{pause:{state:'paused'}});
  assert.deepEqual(said(b),['off','Ⅱ','Paused · PRB-146 will resume where it stopped','4 of 9 accepted · nothing is running']);
  assert.deepEqual(b.button,{key:'resume',label:'Resume'});
  assert.equal(band(['accepted'],{pause:{state:'paused'}}).big,'Paused');
  // The pause comes before what waits and what is stopped, as on the mockup.
  assert.equal(band(AT_12,{pause:{state:'paused'},items:[STUCK]}).big,'Paused · PRB-149 will resume where it stopped');
});
test('in pause the card of the ticket in hand says « Paused », keeps its colour and its time, and nobody is at work on it',()=>{
  const tickets=lineTickets(mission(AT_08)),card=(i,more={})=>lineCard(tickets[i],{stage:'develop',span:'38 min',...more});
  const run=card(4),still=card(4,{paused:true});
  assert.deepEqual([run.look,run.word,run.sub,run.avatar],['run','In dev','38 min',{text:'D1',live:true}]);
  assert.deepEqual([still.look,still.word,still.sub,still.avatar],['run','Paused','38 min',{text:'D1',live:false}]);
  // The others do not change: accepted, to do.
  assert.deepEqual(card(0,{paused:true}),card(0));assert.deepEqual(card(6,{paused:true}),card(6));
  const review=lineCard({...tickets[4],state:'review'},{stage:'develop',paused:true});
  assert.deepEqual([review.look,review.word],['run','Paused']);
  // The band under the line and the details keep the state of the ticket, as screen 11 does (« In dev · 38 min »).
  const strip=pageStrip({mission:mission(AT_08),tickets,story:{pause:{state:'paused'},timings:{'PRB-146':[{step:'dev',minutes:38}]}}});
  assert.deepEqual(strip.chips[0],{text:'In dev · 38 min',tone:'run'});
});
test('who works, in pause: the dev of the ticket in hand is said paused, not faded',()=>{
  const m=mission(AT_08),idle=[agent('t2','PRB-146 · dev','idle')];
  const rows=pageWorkers({mission:m,lead:LEAD,agents:idle,pause:{state:'paused'},took:'38 min'});
  assert.deepEqual(rows.map(w=>[w.name,w.what,w.dim,w.warn,w.address]),[['Dev 1','PRB-146 · paused',false,false,'t2']]);
  assert.equal(pageWorkers({mission:m,lead:LEAD,agents:idle}).at(0).what,'PRB-146 · not running','without a pause, as before');
  // Asked only: the dev still runs, its line does not change.
  assert.equal(pageWorkers({mission:m,lead:LEAD,agents:[agent('t2','PRB-146 · dev')],pause:{state:'requested'},took:'38 min'})[0].what,'PRB-146 · in dev for 38 min');
});
test('a ticket stopped: the banner says for how long, what fails, who is on it, and offers its details (screens 12 and 13)',()=>{
  const b=band(AT_12,{items:[STUCK],took:'22 min'});
  assert.deepEqual(said(b),['stop','!','Blocked: PRB-149 stopped for 22 min','Migration 0026 fails locally · the Lead is on it · nothing for you to do']);
  assert.deepEqual([b.second.key,b.second.label,b.second.item.id,b.button],['blocking',"See what's blocking",'I-9',undefined]);
  // The time is the one of the stop itself: since the engine says the ticket stopped, else since the request was made.
  assert.equal(band(AT_12,{items:[STUCK]}).big,'Blocked: PRB-149 stopped for 22 min');
  assert.equal(stuckSpan({...STUCK,since:local(10,14)},{now:T0}),'10 min');
  // The engine of today: the title of its request, and nothing it does not say.
  const plain=band(AT_12,{items:[{id:'I-3',type:'stuck',state:'pending',mission:'M-1',ticket:'PRB-149',title:'Migration 0026 fails'}]});
  assert.deepEqual(said(plain),['stop','!','Blocked: PRB-149 stopped','Migration 0026 fails']);
});
test('a ticket stopped counts its time from the instant it stopped, never from the start of its step (review: P2)',()=>{
  // Stopped for 10 min on a step of 38 min: the banner and the details say 10 min.
  const late={...STUCK,createdAt:local(10,14)},m=mission(AT_12),tickets=lineTickets(m);
  assert.equal(band(AT_12,{items:[late],took:'38 min'}).big,'Blocked: PRB-149 stopped for 10 min');
  assert.equal(pageSheet({mission:m,tickets,open:{t:'blocked',id:'I-9'},requests:[late],took:'38 min',now:T0}).parts[0].text,'PRB-149 has been stopped for 10 min');
  assert.equal(stuckSpan(late,{cur:{id:'PRB-149'},took:'38 min',now:T0}),'10 min');
  // The card says it too, as the banner and the details: the time of the stop, not the one of the step (review: blocked card).
  const card=lineCard(tickets[2],{stage:'develop',items:[late],span:'38 min',now:T0});
  assert.deepEqual([card.look,card.word,card.sub],['blk','Blocked','10 min']);
  assert.equal(lineCard(tickets[2],{stage:'develop',items:[{...STUCK,createdAt:undefined}],span:'38 min',now:T0}).sub,'','no instant told: no time on the card either');
  // No instant told: no time, not the one of the step.
  assert.equal(stuckSpan({...STUCK,createdAt:undefined},{cur:{id:'PRB-149'},took:'38 min',now:T0}),'');
});
test('who works on a ticket stopped: its dev waits for the Lead, the Lead looks for a fix (screen 12)',()=>{
  const m=mission(AT_12),agents=[agent('t2','PRB-149 · dev','idle')];
  const rows=pageWorkers({mission:m,lead:{...LEAD,status:'working'},agents,items:[STUCK]});
  assert.deepEqual(rows.map(w=>[w.name,w.what,w.dim,w.warn]),[['Dev 1','PRB-149 · stopped, waiting for the Lead',false,false],['Lead','looking for a fix',false,false]]);
  // The engine of today does not say who takes care of it: the lines of before.
  const before=pageWorkers({mission:m,lead:LEAD,agents,items:[{...STUCK,owner:undefined}]});
  assert.deepEqual(before.map(w=>[w.name,w.what]),[['Dev 1','PRB-149 · not running'],['Lead','waiting for your answer']]);
});
test('the details of what blocks a ticket, in the column on the right, to the letter (screen 13)',()=>{
  const m=mission(AT_12),tickets=lineTickets(m),s=pageSheet({mission:m,tickets,open:{t:'blocked',id:'I-9'},requests:[STUCK],took:'22 min',now:T0});
  assert.deepEqual([s.kicker,s.foot,s.key],['Blocked ticket','To stop or reorder, talk to Pilot.','blocked:I-9']);
  assert.deepEqual(s.parts,[
    {kind:'title',text:'PRB-149 has been stopped for 22 min'},
    {kind:'chips',chips:[{text:'Blocked in dev',tone:'bad'},{text:'since 10:02',tone:null}]},
    {kind:'label',text:'Why'},{kind:'box',text:'La migration 0026 ne passe pas sur la base locale : deux tickets ont le même rang.'},
    {kind:'label',text:'What is being tried'},
    {kind:'items',tight:true,items:[{sign:'1',tone:'bad',title:'Dev 1 a relancé la migration telle quelle',sub:'10:04 · same failure',tickets:[]},{sign:'2',tone:'run',title:'Le Lead fait dédoublonner les rangs',sub:'10:12 · running',tickets:[]},{sign:'3',tone:null,title:'Sinon : régénérer le projet de test',sub:'last try before asking you',tickets:[]}]},
    {kind:'label',text:'For you'},{kind:'box',text:'Nothing to do for now. If the third try fails, the Lead will ask you here.'},
    {kind:'label',text:'Ticket concerned'},{kind:'tickets',ids:['PRB-149']}]);
  // What the engine does not tell is not drawn: no try, no word for the user.
  const bare=pageSheet({mission:m,tickets,open:{t:'blocked',id:'I-3'},requests:[{id:'I-3',type:'stuck',state:'pending',mission:'M-1',ticket:'PRB-149',title:'Migration 0026 fails'}],now:T0});
  assert.deepEqual(bare.parts.map(p=>p.kind==='label'?p.text:p.kind),['title','chips','Why','box','Ticket concerned','tickets']);
  assert.deepEqual([bare.parts[0].text,bare.parts[1].chips],['PRB-149 has been stopped',[{text:'Blocked in dev',tone:'bad'}]]);
  // The ticket runs again: the sheet is gone.
  assert.equal(pageSheet({mission:m,tickets,open:{t:'blocked',id:'I-9'},requests:[],now:T0}),null);
  // The details of the ticket itself say « Blocked · 22 min ».
  assert.deepEqual(lineDetail({mission:m,tickets,id:'PRB-149',items:[STUCK],span:'22 min',now:T0}).chips[0],{text:'Blocked · 22 min',tone:'bad'});
});
test('in the details of a blocking the tries follow their label with no room of their own, as on the mockup (.it3; review: P3)',async()=>{
  const main=await readFile(new URL('../mods/fabrique-console-v4-ticket/main.js',import.meta.url),'utf8');
  assert.match(main,/id\('sheet-items-'\+n\)\.flex_none\(\)\.mt\(p\.tight\?0:12\)/);
  assert.match(main,/\.when\(p\.tight&&i===0,e=>e\.pt\(2\)\)/);
});
test('the page asks the engine for the pause by two commands, and opens the details of a ticket stopped from its banner',async()=>{
  const main=await readFile(new URL('../mods/fabrique-console-v4-ticket/main.js',import.meta.url),'utf8');
  assert.match(main,/pause:\(_e,cx\)=>this\.hold\(m,'mission-pause',cx\)/);assert.match(main,/resume:\(_e,cx\)=>this\.hold\(m,'mission-resume',cx\)/);
  assert.match(main,/blocking:\(_e,cx\)=>this\.show\(\{t:'blocked',id:b\.second\.item\.id,ticket:b\.second\.item\.ticket\},cx\)/);
  assert.match(main,/const pause=pauseOf\(story\)/);
});

// ---- M10: the chip of the band under the line (« Blocked · 22 min », screen 12) says the time of the stop too, and
// only it: a stop the engine gives no instant for says « Blocked » alone, never the time of the step (review of the
// Kanban screen: « Blocked · 38 min » with no date of the stop).
test('the chip of the band says the time of the stop, never the one of the step; none without its instant (M10)',()=>{
  const m=mission(AT_12),tickets=lineTickets(m),chip=items=>pageStrip({mission:m,tickets,items,span:'38 min',story:{timings:{'PRB-149':[{step:'dev',minutes:38}]}},now:T0}).chips[0].text;
  assert.equal(chip([{...STUCK,createdAt:local(10,14)}]),'Blocked · 10 min');
  assert.equal(chip([{...STUCK,since:local(10,2),createdAt:local(10,20)}]),'Blocked · 22 min','since, the instant of the stop, before the instant the request was written');
  assert.equal(chip([{...STUCK,createdAt:undefined}]),'Blocked','no instant told: no time, not the 38 min of the step');
});
// The Lead writes its tries: the stop is written again under another identifier (a request never changes). The
// details opened on it stay open, on the stop of that ticket; they go once it is lifted.
test('the details of a stop follow it when the Lead writes it again, and go when it is lifted (M10)',()=>{
  const m=mission(AT_12),tickets=lineTickets(m),again={...STUCK,id:'I-12',replaces:'I-9',since:local(10,2),createdAt:local(10,13)};
  const open={t:'blocked',id:'I-9',ticket:'PRB-149'},s=pageSheet({mission:m,tickets,open,requests:[again],now:T0});
  assert.ok(s,'still open');assert.equal(s.parts[0].text,'PRB-149 has been stopped for 22 min','from the instant of the stop, not of its new request');
  assert.equal(pageSheet({mission:m,tickets,open,requests:[{...again,ticket:'PRB-150'}],now:T0}),null,'never the stop of another ticket');
  assert.equal(pageSheet({mission:m,tickets,open,requests:[],now:T0}),null);
});
test('the page opens the details of a stop with its ticket, so that they follow it (M10)',async()=>{
  const main=await readFile(new URL('../mods/fabrique-console-v4-ticket/main.js',import.meta.url),'utf8');
  assert.match(main,/blocking:\(_e,cx\)=>this\.show\(\{t:'blocked',id:b\.second\.item\.id,ticket:b\.second\.item\.ticket\},cx\)/);
});
