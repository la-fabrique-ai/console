import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {stageOf,pageHead,pageBand,pageCount,pageWorkers,pageTabs,pageActivity,pageRefs,spanOf,currentTicket} from '../../../../mods/fabrique-console-v4-ticket/page.js';
import * as PAGE from '../../../../mods/fabrique-console-v4-ticket/page.js';
import {W} from '../../../../mods/fabrique-console-v4-ticket/words.js';
import {SCREENS} from '../../../../mods/fabrique-console-v4-ticket/nav.js';

const T0=Date.parse('2026-11-13T10:00:00.000Z');
const ticket=(id,n,state,extra={})=>({id,n,state,title:'Titre '+id,dev:'claude',model:'claude-opus-5-5',effort:'high',deps:[],...extra});
const mission=(step,tickets=[],extra={})=>({id:'M-1',project:'beta',step,issue:{identifier:'PRB-41',title:'Durcir pour le volume',url:'https://linear.app/x/issue/PRB-41'},tickets,branch:'prb-41',base:'origin/main',lead:{sessionId:'s1'},...extra});
const LEAD={address:'t1',space:'sp',tab:'tb',tab_name:'Lead · PRB-41',status:'working'},DONE={...LEAD,status:'idle'};
const item=(id,type,extra={})=>({id,type,state:'pending',mission:'M-1',priority:2,createdAt:'2026-11-13T09:00:00.000Z',title:'Titre '+id,...extra});
const agent=(address,tab_name,status='working')=>({address,space:'sp',tab:'tab-'+address,tab_name,status});

test('the page of a ticket has its own screen',()=>{assert.equal(SCREENS.ticket,'fabrique-console-v4-ticket');});

test('the steps of the engine are read as Prepare, Develop, Validate, then Closed',()=>{
  assert.deepEqual(['requested','delegated','analysing','building','qa','validating','validated','closed'].map(step=>stageOf({step})),['prepare','prepare','prepare','develop','validate','validate','validate','closed']);
  const head=pageHead(mission('building'),{name:'Beta'});
  assert.equal(head.title,'Durcir pour le volume');assert.equal(head.sub,'Beta · PRB-41');
  assert.deepEqual(head.track.map(t=>[t.label,t.state]),[['Prepare','done'],['Develop','on'],['Validate','todo']]);
  assert.deepEqual(pageHead(mission('closed'),null).track.map(t=>t.state),['done','done','done']);
});

test('in Prepare the banner follows the Lead: working, waited for, plan ready, start asked',()=>{
  const two=[ticket('PRB-142',1,'todo'),ticket('PRB-144',2,'todo',{deps:['PRB-142']})];
  const working=pageBand({mission:mission('analysing'),lead:LEAD});
  assert.deepEqual([working.tone,working.big,working.det,working.button],['run','The Lead is breaking the issue down','nothing for you to do',undefined]);
  const asked=pageBand({mission:mission('analysing',two),lead:LEAD,items:[item('I-1','decision')]});
  assert.equal(asked.tone,'you');assert.equal(asked.big,'The Lead is waiting on you: 1 question');assert.equal(asked.button.key,'answer');assert.equal(asked.button.item.id,'I-1');
  const ready=pageBand({mission:mission('analysing',two),lead:DONE,now:T0});
  assert.deepEqual([ready.tone,ready.big,ready.det,ready.button.label],['ok','The plan is ready: 2 tickets','No open question · first ticket PRB-142 with Dev 1','Approve and start the dev']);
  const started=pageBand({mission:mission('analysing',two,{launchAskedAt:new Date(T0-30000).toISOString()}),lead:LEAD,now:T0});
  assert.deepEqual([started.tone,started.big,started.button],['run','Starting the dev…',undefined],'the start asked: the Lead works at it, and the banner says the start');
});

// Decision 49 (screen 01): the plan is said ready, and its launch offered, only once the Lead has finished. What tells it:
// the status of the terminal of the Lead, the engine marking no end of the plan.
test('in Prepare, while the Lead works, the banner offers no launch, whatever is already written',()=>{
  const six=[1,2,3,4,5,6].map(n=>ticket('PRB-14'+n,n,'todo'));
  const working=pageBand({mission:mission('analysing',six),lead:LEAD,now:T0});
  assert.deepEqual([working.tone,working.icon,working.big,working.det,working.button],['run','◠','The Lead is breaking the issue down','6 tickets written · nothing for you to do',undefined]);
  for(const status of ['idle','done']) {
    const over=pageBand({mission:mission('analysing',six),lead:{...LEAD,status},now:T0});
    assert.deepEqual([over.tone,over.big,over.button?.key],['ok','The plan is ready: 6 tickets','approve'],'the Lead '+status+': it has finished');
  }
  const waiting=pageBand({mission:mission('analysing',six),lead:{...LEAD,status:'blocked'},now:T0});
  assert.deepEqual([waiting.tone,waiting.big,waiting.det,waiting.button],['off','The Lead is waiting','6 tickets written',undefined],'a Lead held in its terminal has not finished');
  assert.equal(pageWorkers({mission:mission('analysing',six),lead:LEAD,now:T0})[0].what,'breaking the issue down');
  assert.equal(pageWorkers({mission:mission('analysing',six),lead:DONE,now:T0})[0].what,'idle, plan ready');
  assert.equal(pageWorkers({mission:mission('analysing',six),lead:{...LEAD,status:'blocked'},now:T0})[0].what,'waiting','held in its terminal, the Lead waits: it is neither idle nor said to have a plan ready');
  assert.equal(pageWorkers({mission:mission('qa',[ticket('PRB-146',1,'merged')]),lead:{...LEAD,status:'blocked'},agents:[],items:[],space:'sp'}).at(-1).what,'waiting','after Prepare too');
  assert.equal(pageWorkers({mission:mission('closed',six),lead:{...LEAD,status:'blocked'}})[0].what,'waiting');
});

test('in Prepare the banner says the Lead breaks the issue down only while a Lead works',()=>{
  const two=[ticket('PRB-142',1,'todo'),ticket('PRB-144',2,'todo',{deps:['PRB-142']})],said=b=>[b.big,b.det].join(' · ');
  const none=pageBand({mission:mission('analysing',two),lead:null});
  assert.deepEqual([none.tone,none.big,none.det,none.button],['off','The Lead is not running','2 tickets written',undefined],'no Lead alive: nothing is offered, no work is announced');
  const idle=pageBand({mission:mission('analysing'),lead:{...LEAD,status:'idle'}});
  assert.deepEqual([idle.tone,idle.big,idle.det,idle.button],['off','The Lead is idle','',undefined]);
  assert.equal(pageBand({mission:mission('analysing'),lead:{...LEAD,status:'blocked'}}).big,'The Lead is waiting');
  for(const b of [none,idle])assert.doesNotMatch(said(b),/breaking the issue down|nothing for you to do/);
  assert.equal(pageBand({mission:mission('analysing'),lead:null,items:[item('I-1','decision')]}).tone,'you','a request still waits for the user, Lead or not');
});

test('in Develop the banner names the ticket in hand and counts the accepted ones',()=>{
  const list=[ticket('PRB-142',1,'merged'),ticket('PRB-144',2,'accepted'),ticket('PRB-146',3,'dev'),ticket('PRB-147',4,'todo')];
  const b=pageBand({mission:mission('building',list),lead:LEAD});
  assert.deepEqual([b.tone,b.big,b.det,b.button],['run','On track: PRB-146 in dev','2 of 4 accepted · nothing is waiting on you',undefined]);
  const fix=l=>pageBand({mission:mission('building',l),lead:LEAD}).big;
  assert.equal(fix([ticket('PRB-146',1,'fix',{rounds:1})]),'On track: PRB-146 is being fixed after the first review');
  assert.equal(fix([ticket('PRB-146',1,'review')]),'On track: PRB-146 in review');
  const q=pageBand({mission:mission('building',list),lead:LEAD,items:[item('I-2','decision',{ticket:'PRB-146'})]});
  assert.deepEqual([q.tone,q.big,q.det,q.button.label],['you','Waiting on you: a question from the Lead on PRB-146','PRB-146 waits for your answer · 2 of 4 accepted','Answer']);
  assert.equal(pageBand({mission:mission('building',list),lead:LEAD,items:[item('I-4','decision',{ticket:'PRB-146',from:'dev'})]}).big,'Waiting on you: a question from Dev 1 on PRB-146');
  const stuck=pageBand({mission:mission('building',list),lead:LEAD,items:[item('I-3','stuck',{ticket:'PRB-146',title:'Migration 0026 fails'}),item('I-2','decision')],now:T0});
  assert.deepEqual([stuck.tone,stuck.big,stuck.det],['stop','Blocked: PRB-146 stopped for 1 h 00','Migration 0026 fails'],'stopped since its request was made, an hour ago');
  const done=pageBand({mission:mission('building',[ticket('PRB-142',1,'merged'),ticket('PRB-144',2,'accepted'),ticket('PRB-9',null,'todo',{kind:'design'})].map(t=>t.n==null?{...t,n:3}:t)),lead:LEAD});
  assert.equal(done.big,'All 2 tickets are accepted · QA is starting');
  assert.equal(pageBand({mission:mission('building',[ticket('PRB-142',1,'merged'),ticket('PRB-144',2,'todo')]),lead:LEAD}).big,'Between tickets','between two tickets nothing is named, no start is announced');
  const single=[ticket('PRB-160',1,'accepted')];
  assert.equal(pageBand({mission:mission('building',single),lead:LEAD}).big,'The ticket is accepted · QA is next','one ticket alone does not say the QA is not needed, nor that it has started');
  assert.equal(pageBand({mission:mission('building',single),lead:LEAD,qaNeeded:false}).big,'QA not needed · single-ticket plan','said only when the QA is known not to be needed');
  assert.equal(pageBand({mission:mission('building',list.map(t=>({...t,state:'merged'}))),lead:LEAD,qaNeeded:false}).big,'QA not needed · single-ticket plan');
});

test('a ticket of design, deferred, or canceled is not counted among those to accept',()=>{
  assert.deepEqual(pageCount(mission('building',[ticket('A-1',1,'merged'),ticket('A-2',2,'todo',{kind:'design'}),ticket('A-3',3,'todo',{delivery:'deferred'}),ticket('A-4',4,'canceled'),ticket('A-5',5,'dev')])),{total:2,accepted:1});
  assert.equal(currentTicket(mission('building',[ticket('A-1',1,'merged'),ticket('A-5',5,'review')])).id,'A-5');
});

test('in Validate the banner says the QA runs, then how many points are left to the user',()=>{
  const m=mission('validating',[ticket('PRB-142',1,'merged')]),plan=[{id:'t1'},{id:'t2'},{id:'t3'}];
  assert.deepEqual([pageBand({mission:mission('qa'),lead:LEAD}).tone,pageBand({mission:mission('qa'),lead:LEAD}).big],['run','QA is running']);
  const first=pageBand({mission:m,lead:LEAD,qa:{plan,marks:{}}});
  assert.deepEqual([first.tone,first.big,first.det,first.button.label],['you','Your turn: 3 points to test','0 of 3 checked','Start testing']);
  const going=pageBand({mission:m,lead:LEAD,qa:{plan,marks:{t1:{result:'ok'},t2:{result:'ko'}}}});
  assert.deepEqual([going.big,going.button.label],['Your turn: 1 point to test','Continue testing']);
  const over=pageBand({mission:m,lead:LEAD,qa:{plan,marks:{t1:{result:'ok'},t2:{result:'ko'},t3:{result:'ok'}}}});
  assert.deepEqual([over.tone,over.big,over.det,over.button],['ok','All points checked','3 of 3 checked',{key:'close',label:'Close mission'}]);
  const asks=n=>pageBand({mission:m,lead:LEAD,qa:{plan,marks:{}},items:Array.from({length:n},(_,k)=>item('I-'+k,'decision'))}).big;
  assert.deepEqual([asks(1),asks(2)],['Decisions waiting on you: 1','Decisions waiting on you: 2']);
  assert.deepEqual([pageBand({mission:mission('closed')}).tone,pageBand({mission:mission('closed')}).big],['ok','Closed']);
});

test('who works: the Lead in Prepare, then Dev 1 on its ticket with its tool, the reviewer while it reads',()=>{
  const prep=pageWorkers({mission:mission('analysing'),lead:LEAD});
  assert.deepEqual(prep.map(w=>[w.name,w.what,w.address,w.dim]),[['Lead','breaking the issue down','t1',false]]);
  assert.equal(pageWorkers({mission:mission('analysing'),lead:{...LEAD,status:'idle'},items:[item('I-1','decision')]})[0].what,'waiting for your answer');
  assert.equal(pageWorkers({mission:mission('analysing'),lead:null})[0].what,'not running');
  // In Prepare the mockup never fades the line of the Lead (screens 01 to 07): only a Lead that does not run is.
  assert.deepEqual(['idle','done','blocked'].map(status=>pageWorkers({mission:mission('analysing',[ticket('PRB-142',1,'todo')]),lead:{...LEAD,status},now:T0})[0].dim),[false,false,false]);
  assert.equal(pageWorkers({mission:mission('analysing'),lead:null})[0].dim,true);
  const list=[ticket('PRB-142',1,'merged'),ticket('PRB-146',2,'dev'),ticket('PRB-147',3,'todo')],m=mission('building',list);
  const dev=pageWorkers({mission:m,lead:{...LEAD,status:'idle'},agents:[LEAD,agent('d1','PRB-146 · dev'),agent('x9','PRB-146 · dev'),agent('o1','XJ-1 · dev')].map((a,n)=>n===2?{...a,space:'other'}:a),started:{d1:new Date(T0-38*60000).toISOString()},space:'sp',now:T0});
  assert.deepEqual(dev.map(w=>[w.badge,w.name,w.tool,w.what,w.address,w.dim]),[['D1','Dev 1','Claude Code · opus 5.5','PRB-146 · in dev for 38 min','d1',false]]);
  const review=pageWorkers({mission:mission('building',[ticket('PRB-146',1,'review'),ticket('PRB-147',2,'todo')]),lead:LEAD,agents:[agent('d1','PRB-146 · dev','idle'),agent('r1','PRB-146 · revue 1')],space:'sp'});
  assert.deepEqual(review.map(w=>[w.name,w.what,w.dim]),[['Dev 1','PRB-146 is in review',true],['Reviewer','PRB-146 is in review · review 1',false]]);
  const idle=pageWorkers({mission:mission('building',[ticket('PRB-146',1,'merged'),ticket('PRB-147',2,'todo')]),lead:LEAD,agents:[],space:'sp'});
  assert.deepEqual(idle.map(w=>[w.name,w.what,w.address]),[['Dev 1','next ticket: PRB-147',null]]);
  assert.equal(pageWorkers({mission:m,lead:LEAD,agents:[],space:'sp'})[0].what,'PRB-146 · not running','its tab gone, the dev of the ticket in hand is not said at work');
  const asking=pageWorkers({mission:m,lead:LEAD,agents:[agent('d1','PRB-146 · dev','blocked')],items:[item('I-1','decision',{ticket:'PRB-146'})],space:'sp'});
  assert.deepEqual(asking.map(w=>[w.name,w.what,w.warn]),[['Dev 1','PRB-146 · asks you a question',true],['Lead','waiting for your answer',true]]);
  assert.deepEqual(pageTabs(asking,LEAD).map(t=>[t.label,t.address]),[["Lead's tab",'t1'],["Dev 1's tab",'d1']]);
  assert.deepEqual(pageTabs(dev,LEAD).map(t=>[t.key,t.label,t.address,t.kind]),[['lead',"Lead's tab",'t1','lead'],['dev',"Dev 1's tab",'d1','dev']],'in Develop with nothing waiting the tab of the Lead is in the menu, as on the screen 43');
  assert.deepEqual(pageTabs(idle,LEAD).map(t=>t.label),["Lead's tab"]);
  assert.deepEqual(pageTabs(dev,null).map(t=>t.label),["Dev 1's tab"],'no terminal of the Lead: no tab to open');
  const qa=pageWorkers({mission:mission('qa',list),lead:LEAD,agents:[agent('q1','QA · PRB-41')],space:'sp'});
  assert.deepEqual(qa.map(w=>[w.name,w.what]),[['QA agent','playing flows'],['Lead','working']]);
});

test('a span is said in minutes, then in hours',()=>{
  assert.equal(spanOf(new Date(T0-38*60000).toISOString(),T0),'38 min');assert.equal(spanOf(new Date(T0-125*60000).toISOString(),T0),'2 h 05');assert.equal(spanOf(null,T0),'');
});

test('the recent activity is the journal of the watcher, the newest first; the reports when it wrote nothing',()=>{
  const journal=[{at:'10:00',text:'a',tone:'ok'},{at:'10:05',text:'b'},{at:'10:09',text:'c'}];
  assert.deepEqual(pageActivity(journal,[],2).map(l=>l.at+' '+l.text),['10:09 c','10:05 b']);
  assert.deepEqual(pageActivity([],[{at:new Date(2026,10,13,9,7).toISOString(),text:'Delivered',tone:'ok'}]).map(l=>l.at+' '+l.text),['09:07 Delivered']);
  assert.deepEqual(pageActivity(null,null),[]);
});

test('the references keep the issue, the branch, the repositories and the state of the code',()=>{
  const refs=pageRefs(mission('building'),[{repo:'beta',branch:'prb-41',pushed:true,pr:{number:12,url:'https://github.com/x/y/pull/12'}}],{name:'Beta'});
  assert.deepEqual(refs.issue,{label:'PRB-41 in tracker ›',url:'https://linear.app/x/issue/PRB-41'});
  assert.deepEqual(refs.branch,{name:'prb-41',from:'from main'});assert.equal(refs.repo,'beta');
  assert.deepEqual([refs.code.state,refs.code.prs.length,refs.code.noPr],['Pushed',1,'']);
  const bare=pageRefs({id:'M-2',issue:{identifier:'PRB-9',url:'javascript:alert(1)'}},null,null);
  assert.deepEqual([bare.issue.url,bare.branch,bare.repo,bare.code],[null,null,null,null]);
});

test('the activity of the reports names the dev, never its tool',async()=>{
  const reports=[{kind:'dev',ticket:'PRB-1',at:'2026-11-13T09:00:00.000Z'},{kind:'dev',ticket:'PRB-2',at:'2026-11-13T09:10:00.000Z'},{kind:'review-1',ticket:'PRB-1',verdict:'accepted',at:'2026-11-13T09:20:00.000Z'}];
  const lines=PAGE.pageStory([ticket('PRB-1',1,'accepted'),ticket('PRB-2',2,'dev',{dev:'codex'})],reports,null).map(l=>l.text);
  assert.deepEqual(lines,['PRB-1 accepted','PRB-2 delivered by Dev 1','PRB-1 delivered by Dev 1']);
  for(const text of lines)assert.doesNotMatch(text,/Claude|Codex/);
  const main=await readFile(new URL('../../../../mods/fabrique-console-v4-ticket/main.js',import.meta.url),'utf8');
  assert.doesNotMatch(main,/storyLines/,'the page reads its activity through pageStory');
  assert.match(main,/pageStory\(/);
});

test('the activity says a review by its number, and a ticket accepted only once every review it needs is passed',()=>{
  const at=n=>'2026-11-13T09:'+String(n).padStart(2,'0')+':00.000Z',texts=(tickets,reports,qa=null)=>PAGE.pageStory(tickets,reports,qa).map(l=>l.text);
  const fixed=[{kind:'dev',ticket:'PRB-1',at:at(0)},{kind:'review-1',ticket:'PRB-1',verdict:'changes_requested',at:at(5)},{kind:'dev',ticket:'PRB-1',at:at(10)},{kind:'review-1',ticket:'PRB-1',verdict:'accepted',at:at(15)}];
  assert.deepEqual(texts([ticket('PRB-1',1,'accepted')],fixed),['PRB-1 accepted','PRB-1 delivered by Dev 1','Review 1 of PRB-1: changes requested','PRB-1 delivered by Dev 1']);
  const strong=[{kind:'dev',ticket:'PRB-3',at:at(0)},{kind:'review-1',ticket:'PRB-3',verdict:'accepted',at:at(5)}];
  assert.deepEqual(texts([ticket('PRB-3',1,'review')],strong),['Review 1 of PRB-3: passed','PRB-3 delivered by Dev 1'],'a second review is still to come: the ticket is not said accepted');
  assert.deepEqual(texts([ticket('PRB-3',1,'merged')],[...strong,{kind:'review-2',ticket:'PRB-3',verdict:'accepted',at:at(9)}]),['PRB-3 accepted','Review 1 of PRB-3: passed','PRB-3 delivered by Dev 1'],'accepted is said once, at the review that completed it');
  assert.deepEqual(texts([ticket('PRB-3',1,'fix')],[...strong,{kind:'review-2',ticket:'PRB-3',verdict:'changes_requested',at:at(9)}]).slice(0,2),['Review 2 of PRB-3: changes requested','Review 1 of PRB-3: passed']);
  assert.deepEqual(texts([],[{kind:'dev',ticket:'PRB-9',unreadable:true,at:at(1)}],{at:at(30),verdict:'ok'}),['QA passed']);
  assert.deepEqual(texts([],[],{at:at(30),verdict:'problèmes'}),['QA found problems']);
  assert.deepEqual(texts(null,null,null),[]);
});

// Every label of the page, to the letter. A string as it is; a label that takes a number or an identifier, by samples
// [arguments, text]. Where each one comes from: the mockup and the final list of ticket 29 (workflow-v2-29-libelles-finaux),
// the tables of tickets 30 and 31 worded by Codex in its reviews. None is provisional, save the six named as such below.
const LABELS={
  'stages.prepare':'Prepare','stages.develop':'Develop','stages.validate':'Validate','flag':'⚑','back':'‹','more':'⋯','pilot':'Talk to Pilot','pilotStarting':'Opening Pilot…',
  'menu.tracker':'Open issue in tracker','menu.out':'↗','menu.tabOf':[[['Lead'],"Lead's tab"],[['Dev 1'],"Dev 1's tab"]],'menu.previous':'Previous screen',
  'menu.status.working':'working','menu.status.blocked':'waiting','menu.status.idle':'idle','menu.status.done':'idle',
  'confirm.title':'Approve the plan and start the devs?','confirm.starts':'What starts','confirm.frozen':'Frozen copy','confirm.frozenText':'the preparation as you see it, dated today','confirm.cancel':'Cancel','confirm.go':'Approve and start','confirm.many':[[[9,'prb-41','PRB-142',1,'Claude Code · opus 5.5'],'9 tickets, one at a time on prb-41 · first ticket PRB-142 with Dev 1 · Claude Code · opus 5.5']],'confirm.one':[[['prb-160',1,'Claude Code · opus 5.5'],'1 ticket on prb-160, with Dev 1 · Claude Code · opus 5.5']],'band.breaking':'The Lead is breaking the issue down','band.checkingLaunch':'Checking the launch…','band.launchNotConfirmed':'The launch is not confirmed. Nothing for you to do.','band.written':[[[1],'1 ticket written'],[[6],'6 tickets written']],'band.nothingToDo':'nothing for you to do',
  'band.leadIs.none':'The Lead is not running','band.leadIs.idle':'The Lead is idle','band.leadIs.blocked':'The Lead is waiting',
  'band.leadWaits':[[[1],'The Lead is waiting on you: 1 question'],[[2],'The Lead is waiting on you: 2 questions'],[[1,1],'The Lead is waiting on you: 1 question and 1 suggestion'],[[0,2],'The Lead is waiting on you: 2 suggestions']],'band.decide':'Decide','band.choose':'Choose',
  'band.waitsVerdict':[[['PRB-150'],'PRB-150 waits for your verdict']],'band.waitsChoice':[[['PRB-151'],'PRB-151 waits for your choice']],'band.verdict':'Waiting on you: a review verdict to decide',
  'band.overnight':[[[3,1],'Overnight: 3 tickets accepted · 1 decision is waiting on you'],[[1,2],'Overnight: 1 ticket accepted · 2 decisions are waiting on you']],
  'band.sinceVisit':[[[3,1],'Since your last visit: 3 tickets accepted · 1 decision is waiting on you']],
  'band.firstVisit':[[[3,1],'So far: 3 tickets accepted · 1 decision is waiting on you'],[[1,2],'So far: 1 ticket accepted · 2 decisions are waiting on you']],
  'band.copy':[[['the /aide guide'],'Waiting on you: choose the copy for the /aide guide'],[[''],'Waiting on you: choose the copy']],'band.mockup':[[['PRB-151'],'Waiting on you: choose a mockup for PRB-151'],[[''],'Waiting on you: choose a mockup']],
  'band.permission':[[['PRB-146','Dev 1'],'Waiting on you: a permission request from Dev 1 on PRB-146']],'band.suggestion':[[['PRB-147','the Lead'],'Waiting on you: a suggestion from the Lead on PRB-147']],
  // The request answered in place (screens 03, 15, 17, 19, 20, source of the mockup for the suggestion; N07 and N08 of the final list).
  'answer.question':[[['the Lead'],'Question from the Lead · yours to answer'],[['Dev 1'],'Question from Dev 1 · yours to answer']],'answer.suggestion':[[['the Lead'],'Suggestion from the Lead · yours to answer']],'answer.verdict':'Review verdict · your call','answer.copy':'Copy to choose · yours to answer',
  'answer.permission':[[['Dev 1'],'Permission request from Dev 1 · yours to answer']],'answer.mockup':'Mockup to choose · yours to answer','answer.askedAt':[[['2:40 pm'],'Asked at 2:40 pm.']],'answer.madeAt':[[['2:41 pm'],'Made at 2:41 pm.']],
  'answer.recommended':'recommended','answer.choose':'Choose','answer.differently':'Answer differently…','answer.ticket':'Ticket concerned','answer.tickets':'Tickets concerned','answer.variant':[[['A'],'Variant A']],'answer.saidVariant':[[['B'],'variant B']],
  'answer.variants':[[[3,'PRB-151'],'Three variants proposed during PRB-151. The ticket waits for your choice.'],[[2,''],'Two variants proposed.']],
  'answer.foot.prepare':'Your answer is saved on the ticket; the Lead updates the plan.','answer.foot.dev':'The ticket waits for your answer; the dev resumes right after.','answer.foot.drift':'The ticket waits for your answer. A yes is recorded as drift from the approved plan.',
  'answer.foot.verdict':'The rest of the plan waits for your answer: the next ticket only starts after.','answer.foot.copy':'For another wording, talk to Pilot.','answer.foot.mockup':'For another mockup, talk to Pilot.',
  // Provisional, to be worded by Codex: the names of the two arrows for a reader of the screen, who asks when it is neither the Lead nor a dev, and « mockup choice ».
  'answer.previous':'Previous request','answer.next':'Next request','answer.theReviewer':'the reviewer','answer.theQa':'the QA agent','card.mockupChoice':'mockup choice','blocks.asked.mockup':'mockup choice','band.approveAfter':'You can approve the plan right after.','band.answer':'Answer',
  'band.planReady':[[[9],'The plan is ready: 9 tickets'],[[1],'The plan is ready: 1 ticket']],'band.noQuestion':'No open question',
  'band.firstTicket':[[['PRB-142',9],'first ticket PRB-142 with Dev 1'],[['PRB-160',1],'PRB-160 with Dev 1'],[['PRB-145',9,2],'first ticket PRB-145 with Dev 2']],'band.approve':'Approve and start the dev','band.approving':'Starting…','band.envFailed':'The plan is ready, but the test server does not start','band.envHeld':'Starting is held until the environment is ready','band.seeCheck':'See the check','band.approveDevs':'Approve and start the devs',
  'band.starting':'Starting the dev…','band.devStarting':[[[],'Dev 1 is starting'],[[2],'Dev 2 is starting']],
  // Two devs (screens 40 and 41): the strings of the mockup and of its source (Main.dc.html).
  'band.startingDevs':'Starting the devs…','side.current':[[['PRB-146'],'Current ticket · PRB-146 · time per step']],'side.tokens':'Token usage · this issue','side.tokensIn':'in','side.tokensOut':'out','side.tokensNote':'since Prepare started · updates live','side.reviewers':'Reviewers','side.devsOf':[[['Codex'],'Devs · Codex']],
  'band.onTrack':[[['PRB-146','dev',0],'On track: PRB-146 in dev'],[['PRB-146','review',0],'On track: PRB-146 in review'],[['PRB-145','fix',1],'On track: PRB-145 is being fixed after the first review'],[['PRB-145','fix',2],'On track: PRB-145 is being fixed after review 2']],
  'band.onTrackIdle':'Between tickets','band.accepted':[[[4,9],'4 of 9 accepted']],'band.nothingWaiting':'nothing is waiting on you',
  'band.blocked':[[['PRB-146'],'Blocked: PRB-146 stopped'],[['PRB-149','22 min'],'Blocked: PRB-149 stopped for 22 min'],[[''],'Blocked']],
  // The pause (08, 11; N02 of the final list), a ticket stopped and its details (12, 13), the Kanban (09, 31).
  'band.pause':'Pause','band.resume':'Resume','band.paused':[[['PRB-146'],'Paused · PRB-146 will resume where it stopped'],[[''],'Paused']],'band.nothingRunning':'nothing is running',
  'band.pausing':[[['Dev 1'],'Pausing · Dev 1 is finishing its turn'],[['QA agent'],'Pausing · QA agent is finishing its turn'],[[''],'Pausing']],'band.noNewWork':'No new work will start after this turn.',
  // What « Pausing » waits for, and its alert (M11 review 1): the texts of Codex (decision 110).
  'band.pauseWaits':[[[['the reviewer for XJ-2 (launch not confirmed)']],'Waiting for the reviewer for XJ-2 (launch not confirmed)']],'band.pauseLong':'Pause unconfirmed for 5 min. Check the agents.',
  'band.pauseWho.dev':[[['XJ-2'],'the dev for XJ-2'],[[''],'the dev']],'band.pauseWho.reviewer':[[['XJ-2'],'the reviewer for XJ-2'],[[''],'the reviewer']],'band.pauseWho.qa':[[[],'the QA agent']],'band.pauseWho.agents':[[[],'the agents']],
  'band.pauseWhy.unknown':'status unknown','band.pauseWhy.not-seen':'launch not confirmed','band.pauseWhy.foreign':'unexpected terminal','band.pauseWhy.unreadable':'status unavailable',
  'band.migrationFails':[[['0026'],'Migration 0026 fails locally']],'band.leadOnIt':'the Lead is on it','band.seeBlocking':"See what's blocking",
  'plan.kanban':'Kanban','board.todo':'To do','board.dev':'In dev','board.review':'In review','board.accepted':'Accepted','board.next':'Validate','board.noReview':'No review running. The reviewer steps in when the dev hands over.','board.devWaits':'The dev waits for the review.','board.allDone':'All done.',
  'card.paused':'Paused','who.paused':'paused','who.stopped':'stopped, waiting for the Lead','who.lookingForFix':'looking for a fix',
  'sheet.blocked':'Blocked ticket','sheet.stoppedFor':[[['PRB-149','22 min'],'PRB-149 has been stopped for 22 min'],[['PRB-149'],'PRB-149 has been stopped']],'sheet.blockedInDev':'Blocked in dev','sheet.since':[[['10:02'],'since 10:02']],'sheet.why':'Why','sheet.tried':'What is being tried',
  'sheet.sameFailure':[[['10:04'],'10:04 · same failure'],[[''],'same failure']],'sheet.tryRunning':[[['10:12'],'10:12 · running'],[[''],'running']],'sheet.lastTry':'last try before asking you','sheet.forYou':'For you',
  'sheet.nothingForNow':[[['third'],'Nothing to do for now. If the third try fails, the Lead will ask you here.'],[[''],'Nothing to do for now.']],'sheet.nth.0':'first','sheet.nth.1':'second','sheet.nth.2':'third','sheet.nth.3':'fourth','sheet.nth.4':'fifth','sheet.toPilot':'To stop or reorder, talk to Pilot.',
  'band.question':[[['PRB-145','Dev 1'],'Waiting on you: a question from Dev 1 on PRB-145'],[['PRB-147','the Lead'],'Waiting on you: a question from the Lead on PRB-147'],[['','the Lead'],'Waiting on you: a question from the Lead']],
  'band.waitsAnswer':[[['PRB-145'],'PRB-145 waits for your answer']],
  'band.allAccepted':[[[9],'All 9 tickets are accepted · QA is starting'],[[1],'The ticket is accepted · QA is next']],'band.qaNotNeeded':'QA not needed · single-ticket plan',
  'band.toValidate':'moving to Validate, with no way back to Develop',
  'band.waiting':[[[1],'Decisions waiting on you: 1'],[[3],'Decisions waiting on you: 3']],'band.qaRunning':'QA is running','band.nothingYet':'nothing for you to do yet',
  'band.yourTurn':[[[4],'Your turn: 4 points to test'],[[1],'Your turn: 1 point to test']],'band.pointsDone':[[[2,4],'2 of 4 checked']],'band.startTesting':'Start testing','band.continueTesting':'Continue testing',
  'band.allJudged':'All points checked','band.closed':'Closed','band.close':'Close mission','end.summaryHead':'Summary · what was done','end.closedHead':'Closed · what was done','end.noSummary':'No summary from the Lead yet.',
  'end.checkedTitle':'How it was checked','end.ticketsTitle':'Ticket by ticket','end.qa':'QA','end.qaSub':[[[6,7],'6 of 7 points passed']],'end.signoff':'Your sign-off',
  'end.signoffSub':[[[1,1,0],'1/1 checked'],[[4,4,1],'4/4 checked · 1 problem']],'end.reviews':'Reviews',
  'end.reviewsSub':[[[3,1],'3 reviews · 1 requested changes'],[[1,0],'1 review']],'end.problems':'Problems','end.problemsSub':[[[1],'1 reported']],
  'end.decisions':'Your decisions','end.decisionsSub':[[[1],'1 answer'],[[8],'8 answers']],'end.started':[[['16 Nov','16:12'],'Started 16 Nov at 16:12']],
  'end.tickets':[[[2],'2 tickets']],'end.beforeClosing':'Before closing','end.leftForYou':'Left for you','end.ofChecks':[[[3,3],'3 of 3']],
  'end.qaFinished':'QA finished','end.passed':[[[6],'6 passed']],'end.everyJudged':'Every point checked','end.byQaAndYou':'by QA and you','end.problemsHandled':'Problems reported',
  'end.handled':[[[0],'0 reported']],'end.nothingLeft':'No manual steps listed','end.tokenUsage':'Token usage','end.soFar':'since Prepare started','end.final':'since Prepare started',
  'end.tokensIn':'tokens in','end.tokensOut':'tokens out','end.perTicket':'average input per ticket','end.byAgent':'By role','end.byTicket':'By ticket',
  'end.role':[[['lead'],'Lead'],[['qa'],'QA agent']],'band.closeAsked':'Closure requested · the Lead will check, then close',
  'band.mergedInto':[[['release'],'Closed · merged into release']],'band.closedDet':'Ticket closed in the tracker','band.reopen':'Reopen…','band.openPr':'Open PR','band.openPrs':'Open PRs',
  'closeBox.title':[[['PRB-41'],'Close PRB-41?']],'closeBox.checkTitle':'Before closing','closeBox.checking':'Checking…','closeBox.unknown':"Couldn't load the checklist. Open this dialog again to retry.",
  'closeBox.rows.qa':[[[],'QA finished']],'closeBox.rows.judgments':[[[],'Every point checked']],'closeBox.rows.problems':[[[],'Problems and tickets resolved']],'closeBox.rows.branch':[[['main'],'Mission branch']],'closeBox.rows.checks':[[[],'PR checks']],'closeBox.rows.repositories':[[[],'Repositories']],'closeBox.rows.step':[[[],'In Validate']],'closeBox.rows.push':[[[],'Push']],'closeBox.rows.pr':[[[],'Pull request']],'closeBox.rows.merge':[[[],'Merge']],
  'closeBox.triggers':'Your approval allows','closeBox.triggersText':[[['main'],'Push the branch, create a PR if needed, then merge it into main with a merge commit. The Lead then closes the ticket and the mission. If GitHub checks are not registered yet or the target branch changes, review the checklist and approve again before merging.']],'closeBox.cancel':'Cancel','closeBox.go':'Approve and close',
  'reopenBox.title':[[['PRB-41'],'Reopen PRB-41?']],'reopenBox.text':'The mission returns to Validate, never to Develop. Give a reason. Reopening does not undo the merge.','reopenBox.hint':'Why reopen it?','reopenBox.cancel':'Cancel','reopenBox.go':'Reopen in Validate',
  'plan.title':'Plan','plan.tickets':[[[9],'9 tickets'],[[1],'1 ticket']],
  'card.verdict':'verdict','card.copyChoice':'copy choice',
  // The band under the line (screens 01 to 21, 37, 38): the strings of the mockup.
  'strip.leadWorking':'The Lead is working','strip.approach':"Lead's approach",'strip.approachLink':"Lead's approach ›",'strip.phases':'Phases, in order','strip.coming':'coming','strip.execution':'Execution','strip.oneAtATime':'one at a time','strip.heavyTickets':'Heavy tickets','strip.migrations':'Migrations','strip.readApproach':'Read the approach ›',
  'strip.current':[[['PRB-146',5,9],'Current ticket · PRB-146 · 5 of 9']],'strip.theTicket':[[['PRB-160'],'The ticket · PRB-160']],'strip.expected':[[['Le résultat.'],'Expected: Le résultat.']],'strip.steps':'Steps · time per step','strip.reviews':'Reviews','strip.one':'one','strip.two':'two','strip.tokensIn':'Tokens in','strip.tokensOut':'Tokens out','strip.open':'Open the ticket ›',
  'strip.yourCall':[[[0],'Review · your call'],[[1],'Review 1 · your call']],'strip.leadAsks':[[[0],'Review · the Lead asks you a question'],[[1],'Review 1 · the Lead asks you a question']],'strip.path':'Path','strip.oneReview':'One review','strip.yourCheck':'Your check','strip.points':[[[3],'3 points'],[[1],'1 point']],'strip.close':'Close','strip.migration':'Migration','strip.copy':'Copy to write','strip.none':'none','strip.qaAgent':'QA agent','strip.notNeeded':'not needed',
  'strip.qa':'QA · automatic, recorded','strip.qaStarting':'QA is starting','strip.qaText':'You only test what QA cannot judge: look, feel, and what it could not play. Everything else stays one click away.','strip.flows':[[[38],'38 flows']],'strip.passed':'Passed','strip.forYou':'For you','strip.videos':'Videos','strip.yourTime':'Your time','strip.about':[[[12],'about 12 min']],'strip.problems':'Problems',
  // The three blocks at the bottom, Prepare and Develop.
  'blocks.decisions':'Your decisions','blocks.waiting':'Waiting on you','blocks.nothing':'Nothing is waiting on you','blocks.answer':'Answer','blocks.asked.question':'question','blocks.asked.suggestion':'suggestion','blocks.asked.verdict':'verdict','blocks.asked.copy':'copy choice','blocks.asked.permission':'permission request',
  'blocks.askedBy':[[['question','the Lead'],'question from the Lead'],[['suggestion','the Lead'],'suggestion from the Lead']],'blocks.coverage':'Issue coverage','blocks.covered':[[[5,6],'5 of 6']],'blocks.readIssue':'Read the issue ›','blocks.noTicketYet':'no ticket yet','blocks.notCovered':'not covered','blocks.leadAsks':'the Lead asks you the question',
  'blocks.postponed':[[['Nov 12'],'postponed by you on Nov 12 · follow-up ticket'],[[''],'postponed by you · follow-up ticket']],'blocks.drift':'Drift from approved plan',
  // M7, not in the mockup: worded by Codex, chosen by the user (decision 87).
  'blocks.driftAdded':'added after approval','blocks.driftRemoved':'removed from the plan','blocks.driftHolds':[[['added after approval','0025'],'added after approval: 0025'],[['removed from the plan',''],'removed from the plan']],'blocks.change':[[['model','sonnet 5.5','opus 5.5'],'model: sonnet 5.5 → opus 5.5'],[['','a','b'],'a → b']],'blocks.entries':[[['items',['Drops'],['Locks'],['Collations']],'items: Drops added; Locks removed; Collations changed'],[['',['Export'],[],[]],'Export added'],[['items',[],[],['Collations'],true],'items: Collations changed; order changed'],[['',[],[],[],true],'order changed'],[['items',[],[],[]],'']],'blocks.fieldsChanged':[[[['model','dependencies']],'model, dependencies changed']],'blocks.somethingChanged':'details changed','blocks.summaryChanged':'summary changed','blocks.joinChanges':[[[['a','b']],'a; b']],'blocks.driftWhen':[[['added after approval','Nov 14 at 3:20 pm'],'added after approval · Nov 14 at 3:20 pm'],[['x',''],'x']],'blocks.noDrift':'No drift from the approved plan','blocks.changed':[[['PRB-147'],'PRB-147 changed']],'blocks.added':[[['PRB-152'],'PRB-152 added']],'blocks.removed':[[['Risks'],'Risks removed']],'blocks.frozen':'Frozen copy',
  // M7 review, provisional (not in the mockup): a change with what it was and is, a part of the plan by its name on the page.
  'blocks.fieldNames.agent':'tool','blocks.fieldNames.deps':'dependencies','blocks.fieldNames.dev':'tool','blocks.fieldNames.difficulty':'level','blocks.fieldNames.rank':'position','blocks.partChanged':[[['Migrations'],'Migrations changed']],'blocks.itemAt':[[[2],'Item 2']],
  'blocks.parts.approach':"Lead's approach",'blocks.parts.phases':'Phases','blocks.parts.migrations':'Migrations','blocks.parts.requests':'Issue coverage','blocks.parts.simple':'Execution','blocks.parts.points':'Sign-off points','blocks.parts.toPlan.manual':'Your manual steps','blocks.parts.toPlan.risks':'Risks','blocks.parts.toPlan.copy':'Copy to write','blocks.parts.toPlan.accounts':'Test accounts','blocks.parts.branch':'Branch',
  'reconfirm.title':'Approve these changes?','reconfirm.go':'Approve these changes','reconfirm.never':'no further development, review or merge','reconfirm.stopsAfter':'Its dev will stop after this turn. Its work will stay on its branch, without review or merge.','reconfirm.detailsLabel':'Details','reconfirm.details':'Choose Cancel to review the full before and after.','reconfirm.settings':[[['Claude Code · opus 5.5'],'development settings: Claude Code · opus 5.5']],'reconfirm.frozenText':'the updated plan and these changes, dated today','reconfirm.effort':[[['high'],'high effort']],'reconfirm.levels.léger':'Light','reconfirm.levels.light':'Light','reconfirm.levels.standard':'Standard','reconfirm.levels.fort':'Heavy','reconfirm.levels.heavy':'Heavy','blocks.approvedOn':[[['Nov 12 at 3:02 pm'],'plan approved on Nov 12 at 3:02 pm']],
  'blocks.requests':[[[6,7,1],'6 of 7 requests · 1 postponed'],[[1,1,0],'1 of 1 request']],'blocks.toPlan':'To plan for','blocks.environment':'Environment','blocks.envReady':'server, accounts, migrations: ready','blocks.startHeld':[[['the server does not start'],'the server does not start · start held']],'blocks.manual':'Your manual steps','blocks.noMigration':'no migration',
  'blocks.risks':'Risks','blocks.noneFlagged':'none flagged','blocks.copy':'Copy to write','blocks.none':'none','blocks.copyOf':[[['guide /aide','PRB-151'],'guide /aide · PRB-151']],'blocks.copyChosen':[[['guide /aide','B'],'guide /aide · variant B chosen']],'blocks.mockups':'Mockups','blocks.noMockup':'none for this issue','blocks.accounts':'Test accounts','blocks.go':'›',
  // What a row or a link opens in the column on the right: the strings of the source of the mockup (Main.dc.html).
  'sheet.close':'Close','sheet.shut':'✕','sheet.settled':[[['Question'],'Question · settled']],'sheet.kinds.question':'Question','sheet.kinds.suggestion':'Suggestion','sheet.kinds.copy':'Copy','sheet.kinds.dev':'Question from the dev','sheet.kinds.lead':'Question from the Lead','sheet.kinds.verdict':'Verdict',
  'sheet.yourAnswer':[[['Nov 12, 2:46 pm'],'Your answer · Nov 12, 2:46 pm'],[[''],'Your answer']],'sheet.whatChanged':'What it changed','sheet.history':'History','sheet.request':'Request from the issue','sheet.coveredBy':[[[2],'covered by 2 tickets'],[[1],'covered by 1 ticket']],'sheet.openQuestion':'open question','sheet.postponed':'not covered, postponed',
  'sheet.cover':'Tickets that cover it','sheet.noTicket':'No ticket','sheet.outlined':'The tickets that cover it are outlined in the plan.','sheet.mode':'Execution mode','sheet.oneBranch':[[['prb-41'],'One ticket at a time on branch prb-41. Nothing runs in parallel.'],[[''],'One ticket at a time. Nothing runs in parallel.']],'sheet.tickets':'Tickets','sheet.single':'a single ticket','sheet.devs':'Devs',
  'sheet.devWith':[[['Dev 1','Claude Code · opus 5.5'],'Dev 1 (Claude Code · opus 5.5)'],[['Dev 1',''],'Dev 1']],'sheet.heavyOf':[[[2],'2, tests first and two reviews']],'sheet.thenList':[[[['0025','0026']],'0025, then 0026']],'sheet.frozenTitle':[[['Nov 12 at 3:02 pm'],'Plan approved on Nov 12 at 3:02 pm']],
  'sheet.frozenText':'Your approval is saved. This view shows its summary. Later changes are listed under “Drift from approved plan”.','sheet.inCopy':'In the copy','sheet.ticketsOn':[[['9 tickets','prb-41'],'9 tickets, one at a time on prb-41']],'sheet.questions':'Questions','sheet.allSettled':'all settled','sheet.yourSteps':'Your steps',
  'sheet.issue':[[['PRB-41'],'The issue · PRB-41']],'sheet.openTracker':'Open the issue in tracker ›','sheet.goal':'Goal','sheet.forWhom':'For whom','sheet.inScope':'In scope','sheet.outScope':'Out of scope','sheet.criteria':'Acceptance criteria','sheet.withPilot':'Decisions taken with Pilot',
  'sheet.manualTitle':'Your manual steps, outside the app','sheet.manualIntro':'In this order, once the tickets are merged.','sheet.manualNone':'No migration: only the deploy will be yours, after closing.','sheet.risksIntro':'What can go wrong, and what is planned for it.','sheet.risksNone':'No risk flagged for this ticket.',
  'sheet.copyIntro':'The dev will propose variants during the ticket; you choose from the banner.','sheet.copyChosen':'The copy has been chosen.','sheet.copyNone':'No copy to write.','sheet.chosen':[[['B'],'chosen: variant B']],'sheet.mockupsNone':'No mockup for this issue: it creates no new screen.',
  'sheet.accountsTitle':'Test accounts for your sign-off test','sheet.accountsIntro':'Checked by the environment check.','sheet.accountsNote':'No password here: the QA assistant opens the app with the right account.','sheet.envCheck':'Environment check','sheet.envReady':'Everything is ready to start','sheet.envIntro':'Checked by the tool.',
  'sheet.envHeld':'Starting is held until this is cleared.','sheet.envAgain':'Run the check again','sheet.checks.server':'The server starts','sheet.checks.accounts':'The test accounts exist','sheet.checks.migrations':'The migrations pass locally',
  'sheet.coveredTitle':[[[6,7],'6 of 7 requests covered'],[[1,1],'1 of 1 request covered']],'sheet.unchanged':'Unchanged since approval.',
  // M7, not in the mockup: worded by Codex, chosen by the user (decision 87).
  'sheet.driftItem':[[['PRB-152','added after approval'],'PRB-152: added after approval']],'sheet.driftSeenOn':[[['Nov 14 at 3:20 pm'],'Detected on Nov 14 at 3:20 pm'],[[''],'']],'sheet.reapprove':'Approve these changes','sheet.driftTitle':[[[1],'1 ticket changed since approval']],'sheet.driftIntro':[[['Nov 12'],'Changes since your approval on Nov 12.'],[[''],'Changes since your approval.']],'sheet.driftNote':'A ticket added or postponed would show up here the same way, and on its card.',
  // M7 review, provisional (not in the mockup): changes beside the tickets, and the approvals of before (decision 82).
  'sheet.changesTitle':[[[3],'3 changes since approval'],[[1],'1 change since approval']],'sheet.beforeAfter':'Before and after','sheet.before':'before','sheet.after':'after','sheet.added':'added','sheet.removed':'removed','sheet.orderBefore':'order before','sheet.orderAfter':'order after','sheet.nothing':'—','sheet.itsDev':'Dev','sheet.devRunning':'Still running. Will stop after this turn. Its work will stay on its branch, without review or merge.','sheet.approvedChanges':'Approved changes','sheet.earlier':'Earlier approvals','sheet.earlierRow':[[['Nov 12 at 3:02 pm',undefined],'Plan approved on Nov 12 at 3:02 pm ›'],[['Nov 14 at 5:55 pm','reapproval'],'Changes approved on Nov 14 at 5:55 pm ›']],'sheet.replaced':[[['Nov 14 at 5:55 pm'],'Replaced by the approval on Nov 14 at 5:55 pm.']],
  'sheet.justNow':'just now','sheet.thisMorning':'this morning','sheet.monthDay':[[['Nov',12],'Nov 12']],'sheet.dayAt':[[['Nov 12','3:02 pm'],'Nov 12 at 3:02 pm']],'sheet.dayClock':[[['Nov 12','2:46 pm'],'Nov 12, 2:46 pm']],
  // Screen 18, the two titles and the two lines the mockup writes for what happened since the last visit.
  'side.since.yesterday':[[['7:10 pm'],'Since yesterday, 7:10 pm']],'side.since.lastVisit':'Since your last visit','side.since.firstVisit':'So far','side.since.verdict':[[['PRB-150'],'PRB-150 · verdict to decide']],'side.since.accepted':[[['PRB-147'],'PRB-147 accepted']],
  // Ticket M14, the notes the engine gives under each line, the words of the mockup; « two fixing rounds » and « 3 fixing rounds » beyond are the texts of Codex (decision 110).
  'side.since.reviews':[[[1],'one review'],[[2],'two reviews']],'side.since.fixes':[[[1],'one fixing round'],[[2],'two fixing rounds'],[[3],'3 fixing rounds']],'side.since.leftToYou':'the reviewer leaves it to you',
  // Ticket M14, the recap the engine cannot read: the text of Codex (decision 110).
  'side.since.unavailable':"Couldn't refresh this recap. Nothing new is marked as seen.",
  'side.title':'Right now','side.who':"Who's working",'side.activity':'Recent activity','side.noActivity':'No activity yet.','side.refs':'References','side.foot':'Click a ticket or a row: its details open here.','side.openTab':'Open tab ›',
  'who.lead':'Lead','who.theLead':'the Lead','who.dev':[[[1],'Dev 1'],[[2],'Dev 2']],'who.reviewer':'Reviewer','who.qa':'QA agent','who.noLead':'not running','who.breaking':'breaking the issue down',
  'who.waitingAnswer':'waiting for your answer','who.planReady':'idle, plan ready','who.idle':'idle','who.waiting':'waiting','who.working':'working','who.inDev':'in dev','who.inDevFor':[[['38 min'],'in dev for 38 min']],
  'who.fixing':[[[2],'fixing, round 2']],'who.asks':'asks you a question','who.inReview':[[['PRB-146'],'PRB-146 is in review']],'who.next':[[['PRB-147'],'next ticket: PRB-147']],'who.doneAll':'done with its tickets',
  'who.reviewN':[[[1],'review 1']],'who.qaPlaying':'playing flows','who.qaDone':'done',
  'story.delivered':[[['PRB-146','Dev 1'],'PRB-146 delivered by Dev 1']],'story.accepted':[[['PRB-146'],'PRB-146 accepted']],'story.changes':[[[1,'PRB-145'],'Review 1 of PRB-145: changes requested']],'story.passed':[[[1,'PRB-146'],'Review 1 of PRB-146: passed']],'story.qaPassed':'QA passed','story.qaProblems':'QA found problems',
  'plan.oneAtATime':'one at a time on','plan.before':[[[2],'‹ 2 before']],'plan.after':[[[8],'8 after ›']],'plan.hint':'Click a ticket for its details','plan.waitsFor':'waits for','plan.unblocks':'unblocks',
  'card.heavy':'Heavy','card.light':'Light','card.qa':'QA','card.qaSub':'one video per flow','card.signoff':'Sign-off','card.signoffSub':'what QA cannot judge','card.reviewEnd':'Review','card.reviewEndSub':'one review, no QA agent on a single ticket','card.running':'Running','card.upcoming':'Upcoming','card.starting':'Starting',
  'card.inDev':'In dev','card.fixing':'Fixing','card.round':[[[2],'round 2']],'card.inReview':'In review','card.reviewer':[[['Codex'],'Reviewer · Codex'],[[''],'Reviewer']],'card.ofTwo':[[[1],'1 of 2']],'card.accepted':'Accepted','card.blocked':'Blocked','card.waiting':'Waiting on you','card.question':'question',
  'card.merged':'Merged','card.into':[[['PRB-147'],'into PRB-147']],'card.canceled':'Canceled','card.review':[[[0,'✓',1],'review ✓'],[[1,'✗',1],'review 1 ✗'],[[1,'✗ ✓',2],'review 1 ✗ ✓ · 2 rounds'],[[2,'✓',1],'review 2 ✓']],
  'card.passedOf':[[[34,38],'34 / 38 passed'],[[0,3],'0 / 3 passed']],'card.checkedOf':[[[2,4],'2 / 4 checked'],[[0,3],'0 / 3 checked']],'card.yourTurnWord':'Your turn',
  'card.done':[[[34],'Done · 34 passed']],'card.yourTurn':[[[4],'Your turn · 4 left']],'card.doneAll':'Done','card.closed':'Closed','card.tip.copy':'copy to write','card.tip.question':'open question','card.tip.drift':'drift from the approved plan',
  'legend.heavyPrepare':'tests first, two reviews','legend.heavyDevelop':'2 reviews','legend.standard':'no tag: Standard','legend.copyPrepare':'copy to write','legend.copyDevelop':'copy','legend.question':'open question','legend.yourCall':'your call','legend.reviewing':'reviewing now','legend.drift':'drift','legend.accepted':'accepted','legend.changes':'changes requested',
  'detail.position':[[[5,9],'Ticket 5 of 9']],'detail.previous':'Previous ticket','detail.next':'Next ticket','detail.close':'Close','detail.before':'‹','detail.after':'›','detail.shut':'✕','detail.summary':'Summary','detail.timeline':'Timeline','detail.technical':'Technical','detail.criteria':'Tests & criteria',
  'detail.technicalDetails':'Technical details','detail.testsPlanned':'Tests planned by the dev','detail.acceptance':'Acceptance criteria of the ticket','detail.testsRun':'Tests run',
  'detail.what':'What the ticket does','detail.expected':'Expected result','detail.dev':'Dev','detail.reviewer':'Reviewer','detail.waits':'Waits for','detail.unblocks':'Unblocks','detail.delivery':'Delivery','detail.mergedInto':[[['PRB-147'],'merged into PRB-147']],
  'detail.first':'nothing, first ticket','detail.last':'nothing, last ticket','detail.none':'nothing','detail.toBeSet':'to be set','detail.heavy':'Heavy · tests first, two reviews','detail.standard':'Standard','detail.todo':'To do','detail.effort':[[['high'],'high effort']],
  'detail.reviews':[[[2],'two reviews'],[[1],'one review']],'detail.steps':'Steps','detail.stepsRunning':'Steps · in progress','detail.inDev':[[['Dev 1'],'In dev · Dev 1']],'detail.running':'running','detail.fixing':[[['Dev 1'],'Fixing · Dev 1']],
  'detail.round':[[[2],'round 2']],'detail.roundRunning':[[[2],'round 2, running']],'detail.review':[[[0],'Review'],[[1],'Review 1']],'detail.reviewAccepted':[[[0],'Review · accepted'],[[2],'Review 2 · accepted']],
  'detail.reviewChanges':[[[1],'Review 1 · changes requested']],'detail.reviewRunning':[[[1,true],'Review 1 of 2 · running'],[[1,false],'Review · running']],'detail.reading':'the reviewer is reading','detail.remarkCount':[[[2],'2 remarks'],[[1],'1 remark']],'detail.upNext':'up next','detail.accepted':'Accepted','detail.totalTime':'total time','detail.stepsTotal':[[['58 min'],'Steps · 58 min in total']],'detail.decided':[[['accept as is'],'you decided: accept as is']],
  'detail.remarks':'Remarks from the "changes requested" review','detail.commits':'Commits','detail.notStarted':'Not started yet. This ticket is waiting for its turn.','detail.fullOpen':'▸','detail.fullShut':'▾',
  // M6 (b), provisional, to be worded by Codex: the environment check as the engine runs it; « environment ready » is the word of screen 04.
  'environment.bandReady':'environment ready','environment.ready':[[[['database','migrations','accounts']],'database, migrations, accounts: ready']],
  'environment.names.server':'server','environment.names.database':'database','environment.names.migrations':'migrations','environment.names.accounts':'accounts',
  'environment.notConfigured':'not checked · no environment declared','environment.notConfiguredTitle':'No environment declared','environment.notConfiguredIntro':'This project declares no environment, so nothing is checked. Starting is not held.',
  'environment.checks.database':'The local database is recognised','environment.checks.migrations':'No migration is pending','environment.checks.accounts':'The test accounts exist',
  'environment.causes.DB_ABSENT':'the local database is not running','environment.causes.DB_NOT_LOCAL':'the database is not proven local','environment.causes.DB_UNKNOWN':'the database is not the one enrolled','environment.causes.DB_AUTH_UNSUPPORTED':'the database asks for a password',
  'environment.causes.MIGRATIONS_UNREADABLE':'the migrations cannot be read','environment.causes.DB_AHEAD':'the database is ahead of the migrations','environment.causes.CONFIG_INVALID':'the environment settings are invalid','environment.causes.INCOMPLETE':'not every check is declared',
  'environment.causes.CHECKING':'checking…','environment.causes.INTERRUPTED':'the last check was interrupted: run it again','environment.causes.NOT_CHECKED':'not checked yet','environment.causes.STALE':'the settings changed since the last check','environment.causes.UNREADABLE':'the last check cannot be read',
  'environment.notEnrolled':'the database is not enrolled yet','environment.enrollAgain':'the database must be enrolled again','environment.pending':[[[1],'1 migration to apply by hand'],[[2],'2 migrations to apply by hand']],
  'environment.missing':[[[['dev']],'test account missing: dev'],[[['po','dev']],'test account missing: po, dev']],'environment.failed':'the check failed','environment.applied':[[[3],'3 applied, none pending']],'environment.found':[[[['po','dev']],'po, dev']],
  'environment.notRun':'not run: an earlier check failed','environment.notDeclared':'not declared','environment.lastAt':[[['Nov 16 at 10:02 am'],'Last checked Nov 16 at 10:02 am.']],'environment.interrupted':'The check before it was interrupted.','environment.checking':'Checking…','environment.checkingTitle':'A check is running','environment.checkingIntro':'Starting is held until it ends. The result of before is not shown.',
  // Ticket M13, the tokens (decision 106): provisional (« ≈ », « Unknown »: recommendations of Codex); screen 10 for the rest.
  'tokens.about':[[['120k'],'≈ 120k']],'tokens.unknown':'Unknown','tokens.ticket':'Token usage · this ticket','tokens.total':[[['≈ 520k','≈ 41k'],'≈ 520k in · ≈ 41k out']],'tokens.dev':[[['≈ 374k'],'dev ≈ 374k in']],'tokens.review':[[['≈ 146k'],'review ≈ 146k in']],
  'refs.issue':'Issue','refs.inTracker':[[['PRB-41'],'PRB-41 in tracker ›']],'refs.branch':'Branch','refs.from':[[['main'],'from main']],'refs.repo':'Repo','refs.code':'Code',
};
// The labels the page takes from the screens of before, kept as they are there (the state of the code, the checks, a
// merge refused: the mockup has no word for it).
const BORROWED={'ticket.mergeRefused':'Merge refused','toolNames.claude':'Claude Code','toolNames.codex':'Codex','check.pushed':'Pushed','check.somePushed':'Partly pushed','check.notPushed':'Not pushed','check.noPr':'No pull request','check.prUnknown':'Pull request unknown',
  'check.pr':[[[12],'PR #12']],'detail.done':'What was done','detail.reviews':'Reviews','detail.full':'Full report','detail.hide':'Hide report','errors.failed':'This action couldn’t be completed.'};
const flat=(o,at='')=>Object.entries(o).flatMap(([k,v])=>v&&typeof v==='object'?flat(v,at+k+'.'):[[at+k,v]]);
const said=(label,want,name)=>{
  if(typeof want==='string')return assert.equal(label,want,name);
  assert.equal(typeof label,'function',name+' takes its data');
  for(const [args,text] of want)assert.equal(label(...args),text,name+'('+args.join(', ')+')');
};

test('every label of the page is the one of the final list, to the letter: none is left out',async()=>{
  const labels=flat(W.page);
  assert.deepEqual(labels.map(([k])=>k).sort(),Object.keys(LABELS).sort(),'a label added to the page, or taken off it, is said here');
  for(const [key,label] of labels)said(label,LABELS[key],key);
  for(const [key,want] of Object.entries(BORROWED))said(key.split('.').reduce((o,k)=>o[k],W),want,key);
  // The page draws no label of its own, and takes from the other screens only those listed above.
  const borrowed=new Set();
  for(const file of ['main.js','page.js','line.js','board.js','card.js','blocks.js']) {
    const text=await readFile(new URL('../../../../mods/fabrique-console-v4-ticket/'+file,import.meta.url),'utf8');
    for(const m of text.matchAll(/\bW\.([a-zA-Z]+)(?:\.([a-zA-Z]+))?/g))if(m[1]!=='page')borrowed.add(m[1]+(m[2]?'.'+m[2]:''));
    const code=text.split('\n').filter(line=>!/^\s*\/\//.test(line)).join('\n');
    assert.deepEqual([...code.matchAll(/\.child\((['"`])([^'"`]*[A-Za-z]{2}[^'"`]*)\1\)/g)].map(m=>m[2]),[],file+' writes no word of its own');
  }
  assert.deepEqual([...borrowed].sort(),[...new Set(Object.keys(BORROWED).map(k=>k.startsWith('toolNames.')?'toolNames':k))].sort());
  assert.doesNotMatch(JSON.stringify(labels.map(([,v])=>typeof v==='string'?v:'')),/Tracker|Claude|Codex|’/,'no tracker by its name, no tool as a name, straight apostrophes');
});

test('the labels composed on the page read as on the screens of the mockup',()=>{
  const one=pageBand({mission:mission('analysing',[ticket('PRB-160',1,'todo')]),lead:DONE,now:T0});
  assert.deepEqual([one.big,one.det],['The plan is ready: 1 ticket','No open question · PRB-160 with Dev 1'],'a single ticket is not said the first one (screen 37)');
});

// What moves on the page is drawn by the window itself, which stops it when the page is not shown: never a timer that
// redraws the page (the guide of the mods: a redraw of a mod redraws the whole window).
test('what moves on the page costs nothing when the page is not shown: no timer redraws it faster than its data',async()=>{
  const main=await readFile(new URL('../../../../mods/fabrique-console-v4-ticket/main.js',import.meta.url),'utf8');
  assert.doesNotMatch(main,/setTimeout|setInterval/);
  for(const m of main.matchAll(/cx\.timer\.every\((\d+)/g))assert.ok(Number(m[1])>=2000,'a timer of '+m[1]+' ms');
  assert.match(main,/\.spin\(TURN\)/,'the arc of the banner turns natively');
  assert.match(main,/\.loop\('opacity'/,'the dot of a tab at work pulses natively');
  assert.equal(await readFile(new URL('../../../../mods/fabrique-console-v4-ticket/icons/arc.svg',import.meta.url),'utf8'),await readFile(new URL('../../../../ui/v4/icons/arc.svg',import.meta.url),'utf8'));
});
