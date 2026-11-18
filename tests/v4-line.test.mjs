import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {LINE,lineTickets,linePhases,lineFocus,lineActive,lineJump,linePan,lineLayout,lineCard,lineTrace,lineEnds,lineLegend,lineMatches,lineHead,lineDetail,lineStep} from '../mods/fabrique-console-v4-ticket/line.js';

// PRB-41 of the mockup: its nine tickets, what each waits for (source/Main.dc.html), its phases.
const DEPS={'PRB-142':[],'PRB-144':['PRB-142'],'PRB-149':['PRB-144'],'PRB-145':['PRB-149'],'PRB-146':['PRB-145'],'PRB-147':['PRB-146'],'PRB-150':['PRB-147'],'PRB-151':['PRB-147'],'PRB-148':['PRB-144','PRB-150','PRB-151']};
const PHASE={'PRB-142':'p1','PRB-144':'p2','PRB-149':'p2','PRB-145':'p3','PRB-146':'p3','PRB-147':'p3','PRB-150':'p4','PRB-151':'p4','PRB-148':'p5'};
const HEAVY=['PRB-146','PRB-147'],LIGHT=['PRB-151','PRB-148'],IDS=Object.keys(DEPS);
const PHASES=[['p1','Mesurer'],['p2','Préparer la base'],['p3','Charger par fenêtres'],['p4','Alléger, documenter'],['p5','Mesurer']].map(([id,title])=>({id,title}));
const row=(id,n,state='todo',extra={})=>({id,n,title:'Titre '+id,level:HEAVY.includes(id)?'fort':LIGHT.includes(id)?'léger':'standard',dev:'claude',model:'claude-opus-5-5',effort:'high',deps:DEPS[id]||[],kind:'work',delivery:'included',integratedBy:null,state,rounds:0,...extra});
const planTicket=(id,n)=>({id,rank:n,title:'Titre '+id,result:'Résultat '+id,difficulty:HEAVY.includes(id)?'heavy':LIGHT.includes(id)?'light':'standard',kind:'work',delivery:'included',deps:DEPS[id]||[],phase:PHASE[id]||null,texts:id==='PRB-151'?['guide /aide']:[],mockups:[]});
const jir41=(step,states={},extra={})=>({id:'M-1',project:'beta',step,issue:{identifier:'PRB-41'},branch:'prb-41',base:'origin/main',tickets:IDS.map((id,i)=>row(id,i+1,states[id]||'todo')),plan:{format:2,tickets:IDS.map((id,i)=>planTicket(id,i+1)),phases:PHASES},...extra});
// Screen 08: four accepted, PRB-146 in dev.
const AT_08={'PRB-142':'merged','PRB-144':'merged','PRB-149':'accepted','PRB-145':'accepted','PRB-146':'dev'};
const review=(ticket,n,verdict,at,extra={})=>({ticket,kind:'review-'+n,verdict,at,commit:'c1',summary:'',...extra});
const box=(x,y,w,h)=>({x,y,w,h});

test('the rules of the line are built with the other shared files of the V4 screens',async()=>{assert.match(await readFile(new URL('../scripts/build-ui.mjs',import.meta.url),'utf8'),/V4_SHARED=\[[^\]]*'line\.js'/);});

test('the line holds the tickets of the plan in the order of their ranks, then those the plan does not name',()=>{
  const m=jir41('analysing');
  m.tickets=[m.tickets[4],m.tickets[0],row('PRB-170',null,'todo',{deps:['PRB-999','PRB-142']}),...m.tickets.slice(1,4),...m.tickets.slice(5)];
  const line=lineTickets(m);
  assert.deepEqual(line.map(t=>t.id),[...IDS,'PRB-170']);
  assert.deepEqual(line.map(t=>t.order),['1','2','3','4','5','6','7','8','9','']);
  assert.deepEqual(line.at(-1).deps,['PRB-142'],'a ticket that is not on the line is not waited for on it');
  const t=line[7];
  assert.deepEqual([t.result,t.difficulty,t.phase,t.texts],['Résultat PRB-151','light','p4',['guide /aide']]);
  assert.deepEqual(lineTickets({tickets:[row('PRB-146',1)]})[0].difficulty,'heavy','without a plan, the level of the row tells the difficulty');
  assert.deepEqual(lineTickets(null),[]);
});

test('the phases of the Lead stand above the tickets they hold, one header for each run',()=>{
  const m=jir41('analysing'),runs=linePhases(m,lineTickets(m));
  assert.deepEqual(runs,[{from:0,to:0,title:'Mesurer'},{from:1,to:2,title:'Préparer la base'},{from:3,to:5,title:'Charger par fenêtres'},{from:6,to:7,title:'Alléger, documenter'},{from:8,to:8,title:'Mesurer'}]);
  const bare=jir41('analysing');bare.plan.tickets[1].phase=null;
  assert.deepEqual(linePhases(bare,lineTickets(bare)).map(r=>[r.from,r.to]),[[0,0],[2,2],[3,5],[6,7],[8,8]],'a ticket without a phase has no header');
  assert.deepEqual(linePhases({tickets:[row('PRB-142',1)]},lineTickets({tickets:[row('PRB-142',1)]})),[]);
});

test('the line is set on the ticket in hand: the one worked on, else the next one, else the last',()=>{
  assert.equal(lineFocus(lineTickets(jir41('analysing'))),0);
  assert.equal(lineFocus(lineTickets(jir41('building',AT_08))),4);
  assert.equal(lineFocus(lineTickets(jir41('building',{...AT_08,'PRB-146':'accepted'}))),5,'between two tickets, the next one');
  assert.equal(lineFocus(lineTickets(jir41('qa',Object.fromEntries(IDS.map(id=>[id,'merged']))))),8);
  assert.equal(lineFocus([]),0);
});

test('the line scrolls in its zone and says how many tickets are hidden on each side',()=>{
  // The numbers of the mockup, whose zone is 1012 wide: screens 04, 08 and 42.
  assert.deepEqual(linePan({count:9,width:1012,focus:0}),{view:844,max:676,lo:0,hi:676,pan:0,auto:0,before:0,after:4});
  assert.deepEqual(linePan({count:9,width:1012,focus:4}),{view:844,max:676,lo:0,hi:676,pan:338,auto:338,before:2,after:2});
  assert.deepEqual(linePan({count:15,width:1012,focus:4}),{view:844,max:1696,lo:0,hi:1696,pan:338,auto:338,before:2,after:8});
  assert.deepEqual(linePan({count:9,width:1012,focus:8}),{view:844,max:676,lo:0,hi:676,pan:676,auto:676,before:4,after:0});
  assert.deepEqual(linePan({count:4,width:1012,focus:3}),{view:844,max:0,lo:0,hi:0,pan:0,auto:0,before:0,after:0},'a short line does not scroll');
  // The user moved it: its place is kept, within the line.
  assert.equal(linePan({count:15,width:1012,focus:4,pan:848}).pan,848);
  assert.equal(linePan({count:15,width:1012,focus:4,pan:-30}).pan,0);
  assert.equal(linePan({count:15,width:1012,focus:4,pan:99999}).pan,1696);
  assert.equal(LINE.step,3,'a button moves the line by three tickets');
});

test('the line is drawn where the mockup draws it: cards, phases, order and dependencies (screen 08)',()=>{
  const m=jir41('building',AT_08),tickets=lineTickets(m),d=lineLayout({tickets,phases:linePhases(m,tickets),width:1012,pan:338});
  assert.deepEqual(d.cards.map(c=>c.x),[-334,-164,6,176,346,516,686,856,1026]);
  assert.deepEqual(d.cards[0],{id:'PRB-142',x:-334,y:40,w:160,h:196,ring:null,sel:false});
  assert.deepEqual(d.ends,[{key:'qa',...box(862,40,150,94)},{key:'signoff',...box(862,142,150,94)}]);
  assert.deepEqual(d.phases,[{x:-334,w:160,text:'Mesurer',dashed:false,pin:false},{x:-164,w:330,text:'Préparer la base',dashed:false,pin:false},{x:176,w:500,text:'Charger par fenêtres',dashed:false,pin:false},
    {x:686,w:330,text:'Alléger, documenter',dashed:false,pin:false},{x:1026,w:160,text:'Mesurer',dashed:false,pin:false},{x:862,w:150,text:'Validate',dashed:true,pin:true}]);
  // Between two tickets: an arrow when the next one waits for the one before, a dot when it does not.
  assert.deepEqual(d.glyphs.map(g=>[g.x,g.y,g.text]),[[-174,130,'›'],[-4,130,'›'],[166,130,'›'],[336,130,'›'],[506,130,'›'],[676,130,'›'],[846,130,'·'],[1016,130,'›']]);
  // A dependency that jumps over a ticket takes a rail: one above, two below; QA leads to Sign-off.
  assert.deepEqual(d.segs.map(s=>[s.x,s.y,s.w,s.h]),[[936,134,2,3],
    [595,31,2,9],[595,30,342,2],[935,31,2,4],
    [765,236,2,12],[765,247,302,2],[1065,241,2,7],
    [-85,236,2,26],[-85,261,1222,2],[1135,241,2,21]]);
  assert.deepEqual(d.heads.map(h=>[h.x,h.y,h.dir]),[[932,135,'down'],[931,33,'down'],[1061,237,'up'],[1131,237,'up']]);
  assert.deepEqual([d.segs[0].pin,d.heads[0].pin,d.segs[1].pin],[true,true,false]);
  assert.deepEqual(d.masks,{solid:box(850,0,162,272),left:box(0,0,40,272),right:box(810,0,40,272)});
  assert.deepEqual(d.pans,{before:{x:4,y:244,count:2},after:{x:766,y:244,count:2}});
});

test('in Prepare the line starts at the first ticket: nothing before, a fade and a count after (screen 04)',()=>{
  const m=jir41('analysing'),tickets=lineTickets(m),d=lineLayout({tickets,phases:linePhases(m,tickets),width:1012,pan:0});
  assert.deepEqual(d.cards.map(c=>c.x),[4,174,344,514,684,854,1024,1194,1364]);
  assert.deepEqual(d.masks,{solid:box(850,0,162,272),left:null,right:box(810,0,40,272)});
  assert.deepEqual(d.pans,{before:null,after:{x:766,y:244,count:4}});
  assert.deepEqual(d.segs.slice(1,4).map(s=>[s.x,s.y,s.w,s.h]),[[933,31,2,9],[933,30,342,2],[1273,31,2,4]]);
});

test('a ticket chosen is outlined, what it waits for is circled in blue, what it unblocks in green (screen 05)',()=>{
  const m=jir41('analysing'),tickets=lineTickets(m),d=lineLayout({tickets,phases:[],width:1012,pan:0,sel:'PRB-146'});
  assert.deepEqual(d.cards.map(c=>[c.sel,c.ring]),[[false,null],[false,null],[false,null],[false,'waits'],[true,null],[false,'unblocks'],[false,null],[false,null],[false,null]]);
  assert.deepEqual(d.glyphs.map(g=>g.tone),[null,null,null,'waits','unblocks',null,null,null]);
  // A rail takes the colour too: PRB-147 chosen, PRB-151 waits for it over PRB-150.
  const over=lineLayout({tickets,phases:[],width:1012,pan:0,sel:'PRB-147'});
  assert.deepEqual(over.segs.slice(1,4).map(s=>s.tone),['unblocks','unblocks','unblocks']);
  assert.deepEqual(over.heads.map(h=>h.tone),[null,'unblocks',null,null]);
  assert.deepEqual(lineLayout({tickets,phases:[],width:1012,pan:0,sel:'PRB-148'}).heads.map(h=>h.tone),[null,null,'waits','waits']);
});

test('any plan is drawn by the same rule: rails that cross take another lane, arrows into one card stand apart',()=>{
  const ids=['A-1','A-2','A-3','A-4','A-5','A-6'],deps={'A-3':['A-1'],'A-4':['A-2'],'A-5':['A-1','A-3'],'A-6':['A-1']};
  const tickets=lineTickets({tickets:ids.map((id,i)=>({id,n:i+1,title:id,state:'todo',deps:deps[id]||[]}))}),d=lineLayout({tickets,phases:[],width:2000,pan:0});
  const rails=d.segs.filter(s=>s.h===2&&!s.pin).map(s=>s.y+1);
  assert.equal(rails.length,5,'one rail for each dependency that jumps over a ticket');
  assert.equal(new Set(rails).size,5,'five rails that overlap run on five lanes');
  assert.ok(rails.every(y=>y<40||y>236),'a rail runs above the cards or below them, never across');
  assert.deepEqual(d.glyphs.map(g=>g.text),['·','·','·','·','·']);
  const into=d.heads.filter(h=>!h.pin&&h.x>4+4*170&&h.x<4+4*170+160).map(h=>h.x+h.dir);
  assert.equal(new Set(into).size,2,'the two arrows into A-5 do not land on each other');
  const six=d.heads.filter(h=>!h.pin&&h.x>4+5*170).length;
  assert.equal(six,1);
  // A ticket that waits for one placed after it is drawn too, never dropped.
  const back=lineLayout({tickets:lineTickets({tickets:[{id:'B-1',n:1,deps:['B-3']},{id:'B-2',n:2,deps:[]},{id:'B-3',n:3,deps:[]}]}),phases:[],width:2000,pan:0});
  assert.equal(back.heads.filter(h=>!h.pin).length,1);
});

test('the card of a ticket says its state as the mockup does, in the colour of that state',()=>{
  const m=jir41('building',AT_08),tickets=lineTickets(m),by=id=>tickets.find(t=>t.id===id);
  const card=(id,more={})=>lineCard(by(id),{stage:'develop',...more});
  assert.deepEqual(card('PRB-146',{span:'38 min'}),{id:'PRB-146',order:'5',title:'Titre PRB-146',badges:[],tag:{text:'Heavy',heavy:true},trace:[],look:'run',word:'In dev',sub:'38 min',avatar:{text:'D1',live:true}});
  assert.deepEqual(card('PRB-147'),{id:'PRB-147',order:'6',title:'Titre PRB-147',badges:[],tag:{text:'Heavy',heavy:true},trace:[],look:'heavy',word:'',sub:'',avatar:null},'a Heavy ticket to do is violet');
  assert.deepEqual([card('PRB-150').look,card('PRB-150').tag],['plain',null],'a Standard ticket has no tag');
  assert.deepEqual(card('PRB-151').tag,{text:'Light',heavy:false});
  assert.deepEqual(card('PRB-151').badges,[{text:'T',tone:null,tip:'copy to write'}]);
  const done=card('PRB-145',{reports:[review('PRB-145',1,'accepted','2026-11-13T10:00:00Z')]});
  assert.deepEqual([done.look,done.word,done.sub,done.trace,done.avatar],['ok','Accepted','',[{text:'review ✓',tight:'review ✓',tone:'ok'}],null],'the time a ticket took is not known yet: it is not said');
  const fix=lineCard({...by('PRB-146'),state:'fix',rounds:1},{stage:'develop'});
  assert.deepEqual([fix.look,fix.word,fix.sub,fix.avatar],['run','Fixing','round 2',{text:'D1',live:true}]);
  const rev=lineCard({...by('PRB-146'),state:'review'},{stage:'develop',reports:[{ticket:'PRB-146',kind:'dev',commit:'c2',at:'2026-11-13T10:00:00Z'},review('PRB-146',1,'accepted','2026-11-13T10:05:00Z',{commit:'c2'})]});
  assert.deepEqual([rev.look,rev.word,rev.sub,rev.avatar],['run','In review','2 of 2',null],'a Heavy ticket says which of its two reviews runs');
  assert.deepEqual([lineCard({...by('PRB-145'),state:'review'},{stage:'develop'}).sub],['']);
  // What waits for the user on a ticket: stopped, or asked.
  const stuck=card('PRB-146',{items:[{type:'stuck',state:'pending',ticket:'PRB-146'}]});
  assert.deepEqual([stuck.look,stuck.word,stuck.sub,stuck.avatar],['blk','Blocked','',{text:'D1',live:false}]);
  // A question of the Lead: the dev is not the one waiting, its badge is not drawn (screen 17); a question of the dev keeps it (screen 14).
  const asked=card('PRB-146',{items:[{type:'decision',state:'pending',ticket:'PRB-146'}]});
  assert.deepEqual([asked.look,asked.word,asked.sub,asked.avatar],['you','Waiting on you','question',null]);
  assert.deepEqual(card('PRB-146',{items:[{type:'decision',state:'pending',ticket:'PRB-146',from:'dev'}]}).avatar,{text:'D1',live:true});
  assert.deepEqual(card('PRB-146',{items:[{type:'authorization',state:'pending',ticket:'PRB-146'}]}).sub,'','what is asked is said only when it is a question');
  assert.equal(card('PRB-146',{items:[{type:'decision',state:'answered',ticket:'PRB-146'}]}).look,'run');
  // In Prepare nothing runs: a question on a ticket is a badge, and no state is said.
  const prep=lineCard(by('PRB-146'),{stage:'prepare',items:[{type:'decision',state:'pending',ticket:'PRB-146'}]});
  assert.deepEqual([prep.look,prep.word,prep.badges],['heavy','',[{text:'?',tone:'you',tip:'open question'}]]);
  // A ticket integrated by another one, and a ticket canceled in the tracker, stay on the line, dashed and faded.
  const fused=lineCard({...by('PRB-151'),delivery:'integrated',integratedBy:'PRB-147'},{stage:'develop'});
  assert.deepEqual([fused.look,fused.word,fused.sub],['fused','Merged','into PRB-147']);
  assert.deepEqual(lineCard({...by('PRB-151'),delivery:'integrated',integratedBy:'PRB-147'},{stage:'prepare'}).word,'');
  assert.deepEqual([lineCard({...by('PRB-150'),state:'canceled'},{stage:'develop'}).look,lineCard({...by('PRB-150'),state:'canceled'},{stage:'develop'}).word],['fused','Canceled']);
});

test('a ticket in review carries the dashed « Reviewer » tag of the mockup, not the badge of the dev (review: P2)',()=>{
  const m=jir41('building',AT_08),tickets=lineTickets(m),by=id=>tickets.find(t=>t.id===id);
  // The dev is Claude Code: its reviewer is Codex, as « Reviewer · Codex » on the mockup; the tag pulses while it reads.
  const rev=lineCard({...by('PRB-145'),state:'review'},{stage:'develop'});
  assert.deepEqual([rev.look,rev.word,rev.avatar,rev.reviewer],['run','In review',null,{text:'Reviewer · Codex',live:true}]);
  assert.deepEqual(lineCard({...by('PRB-145'),state:'review',dev:'codex'},{stage:'develop'}).reviewer,{text:'Reviewer · Claude Code',live:true});
  // In pause it says « Paused » and stops pulsing; a dev whose tool is not known gives the tag alone, no tool made up.
  const still=lineCard({...by('PRB-145'),state:'review'},{stage:'develop',paused:true});
  assert.deepEqual([still.word,still.reviewer],['Paused',{text:'Reviewer · Codex',live:false}]);
  assert.deepEqual(lineCard({...by('PRB-145'),state:'review',dev:undefined},{stage:'develop'}).reviewer,{text:'Reviewer',live:true});
  // A verdict to decide on a ticket in review: neither the tag nor the badge of the dev (screens 18 and 19).
  const verdict=lineCard({...by('PRB-150'),state:'review'},{stage:'develop',items:[{type:'decision',kind:'verdict',state:'pending',ticket:'PRB-150'}]});
  assert.deepEqual([verdict.look,verdict.word,verdict.sub,verdict.avatar,'reviewer' in verdict],['you','Waiting on you','verdict',null,false]);
  // A copy to choose keeps the badge of the dev (screen 20); a ticket in dev has no tag.
  assert.deepEqual(lineCard(by('PRB-146'),{stage:'develop',items:[{type:'decision',kind:'copy',state:'pending',ticket:'PRB-146'}]}).avatar,{text:'D1',live:true});
  assert.equal('reviewer' in lineCard(by('PRB-146'),{stage:'develop'}),false);
});
test('the card draws the « Reviewer » tag dashed, above its foot, and pulses it natively while the review runs',async()=>{
  const card=await readFile(new URL('../mods/fabrique-console-v4-ticket/card.js',import.meta.url),'utf8');
  assert.match(card,/export const reviewerTag=tag=>/);
  assert.match(card,/h\(18\)\.px\(7\)\.rounded\(9\)\.border\(1\.5\)\.border_dashed\(\)\.border_color\('#C9CFDB'\)\.bg\('#1B1F2B'\)\.text_color\('#E6E9F0'\)\.text_size\(10\.5\)\.font_weight\(600\)/);
  assert.match(card,/\.when\(tag\.live,e=>e\.child\([^\n]*\.loop\('opacity'/);
  assert.match(card,/if\(card\.reviewer\)el=el\.child\(reviewerTag\(card\.reviewer\)\);/);
});
test('the trace of the reviews: an entry for each review, a sign for each round',()=>{
  const t={id:'PRB-147',difficulty:'heavy',state:'accepted'},at=n=>'2026-11-13T10:0'+n+':00Z';
  assert.deepEqual(lineTrace(t,[review('PRB-147',1,'changes_requested',at(1)),review('PRB-147',1,'accepted',at(2)),review('PRB-147',2,'accepted',at(3))]),[{text:'review 1 ✗ ✓ · 2 rounds',tight:'review 1 ✗ ✓',tone:'ok'},{text:'review 2 ✓',tight:'review 2 ✓',tone:'ok'}]);
  assert.deepEqual(lineTrace({...t,state:'fix'},[review('PRB-147',1,'changes_requested',at(1))]),[{text:'review 1 ✗',tight:'review 1 ✗',tone:'fix'}],'a review that asked for changes stays open');
  assert.deepEqual(lineTrace({id:'PRB-145',difficulty:'standard',state:'accepted'},[review('PRB-145',1,'accepted',at(1)),review('PRB-146',1,'accepted',at(2)),{ticket:'PRB-145',kind:'dev',at:at(0)},{ticket:'PRB-145',kind:'review-1',verdict:'accepted',at:at(3),unreadable:true}]),[{text:'review ✓',tight:'review ✓',tone:'ok'}],'a single review is not numbered');
  assert.deepEqual(lineTrace({id:'PRB-145',difficulty:'standard',state:'accepted'},[review('PRB-145',1,'changes_requested',at(1)),review('PRB-145',1,'accepted',at(2))],{wide:false}),[{text:'review ✗ ✓',tight:'review ✗ ✓',tone:'ok'}],'the rounds are counted only where there is room');
  assert.deepEqual(lineTrace({id:'PRB-150',difficulty:'standard',state:'todo'},[]),[]);
});

test('a review counts for the last report of the dev only: same commit and written after it, as the engine reads it',()=>{
  const m=jir41('building',{...AT_08,'PRB-146':'review'}),tickets=lineTickets(m),t=tickets.find(x=>x.id==='PRB-146'),at=n=>'2026-11-13T10:0'+n+':00Z';
  const dev=(commit,n)=>({ticket:'PRB-146',kind:'dev',commit,at:at(n),summary:'Fait.'}),steps=reports=>lineDetail({mission:m,tickets,id:'PRB-146',reports}).timeline.steps.map(s=>s.sign+' '+s.text);
  // The dev wrote its report again on the same commit after review 1 passed: review 1 is to be done again.
  const again=[dev('c1',0),review('PRB-146',1,'accepted',at(1)),dev('c1',2)];
  assert.equal(lineCard(t,{stage:'develop',reports:again}).sub,'1 of 2','a review written before the last report of the dev does not count');
  assert.deepEqual(steps(again).slice(-2),['R Review 1 of 2 · running','· Review 2']);
  assert.deepEqual(lineDetail({mission:m,tickets,id:'PRB-146',reports:again}).timeline.reviews,[],'no review of the last delivery yet');
  // Another commit delivered after the two reviews: neither counts.
  const next=[dev('c1',0),review('PRB-146',1,'accepted',at(1)),review('PRB-146',2,'changes_requested',at(2)),dev('c2',3)];
  assert.equal(lineCard(t,{stage:'develop',reports:next}).sub,'1 of 2');
  // Written after the last report, on its commit: it counts.
  const passed=[dev('c2',3),review('PRB-146',1,'accepted',at(4),{commit:'c2'})];
  assert.equal(lineCard(t,{stage:'develop',reports:passed}).sub,'2 of 2');
  assert.deepEqual(steps(passed),['✓ In dev · Dev 1','✓ Review 1 · accepted','R Review 2 of 2 · running']);
  // The engine keeps one report per kind (each one replaces the one before): after a fix delivered, the review of the
  // round before is still there, older than the delivery. It is shown as it was, and is to be done again.
  const real=[dev('c2',3),review('PRB-146',1,'changes_requested',at(1))];
  assert.deepEqual([lineCard(t,{stage:'develop',reports:real}).trace,lineCard(t,{stage:'develop',reports:real}).sub],[[{text:'review 1 ✗',tight:'review 1 ✗',tone:'fix'}],'1 of 2']);
  assert.deepEqual(lineCard(t,{stage:'develop',reports:passed}).trace,[{text:'review 1 ✓',tight:'review 1 ✓',tone:'ok'}],'the round before is no longer known once its report is replaced: no round is made up');
});

test('a review whose verdict is not known stays unknown: never a cross, never « changes requested »',()=>{
  const m=jir41('building',{...AT_08,'PRB-146':'review'}),tickets=lineTickets(m),t=tickets.find(x=>x.id==='PRB-146'),at=n=>'2026-11-13T10:0'+n+':00Z';
  const reports=[{ticket:'PRB-146',kind:'dev',commit:'c1',at:at(0),summary:'Fait.'},review('PRB-146',1,null,at(1),{summary:'Verdict illisible.'})];
  assert.deepEqual(lineTrace(t,reports),[]);
  const card=lineCard(t,{stage:'develop',reports}),d=lineDetail({mission:m,tickets,id:'PRB-146',reports});
  assert.deepEqual([card.trace,card.word,card.sub],[[],'In review','1 of 2'],'the engine waits for a verdict: the review is still the one that runs');
  assert.deepEqual(d.timeline.steps.map(s=>s.sign+' '+s.text),['✓ In dev · Dev 1','R Review 1 of 2 · running','· Review 2']);
  assert.deepEqual(d.timeline.remarks,[]);
  assert.deepEqual(d.timeline.reviews,[{title:'Review 1',by:'Codex · gpt-6.1-sol',text:'Verdict illisible.'}],'what it wrote is kept, under no verdict');
  assert.deepEqual(d.timeline.full.map(f=>f.title),['Dev 1','Review 1']);
  assert.doesNotMatch(JSON.stringify([card,d,lineLegend({tickets,cards:[card],stage:'develop'})]),/✗|changes requested/);
});

test('a ticket canceled, integrated elsewhere or whose merge was refused is never said what it is not',()=>{
  const at=n=>'2026-11-13T10:0'+n+':00Z',states={...AT_08,'PRB-146':'canceled'},m=jir41('building',states),tickets=lineTickets(m);
  const told=(mission,id,reports=[])=>lineDetail({mission,tickets:lineTickets(mission),id,reports});
  // Canceled in the tracker (decision 46): it stays on the line, said canceled, and nothing is said to run on it.
  const gone=told(m,'PRB-146');
  assert.deepEqual([lineCard(tickets[4],{stage:'develop'}).look,lineCard(tickets[4],{stage:'develop'}).word,lineCard(tickets[4],{stage:'develop'}).avatar],['fused','Canceled',null]);
  assert.deepEqual(gone.chips[0],{text:'Canceled',tone:null});
  assert.deepEqual([gone.tabs,gone.timeline.title,gone.timeline.steps],[['summary','timeline'],'Steps',[{sign:'–',tone:null,text:'Canceled',sub:''}]]);
  const delivered=told(m,'PRB-146',[{ticket:'PRB-146',kind:'dev',commit:'c1',at:at(0),summary:'Fait.'},review('PRB-146',1,'accepted',at(1))]);
  assert.deepEqual(delivered.timeline.steps.map(s=>s.sign+' '+s.text),['✓ In dev · Dev 1','✓ Review 1 · accepted','– Canceled'],'what was done before is kept');
  assert.doesNotMatch(JSON.stringify([gone,delivered]),/running|up next|in progress/);
  // Integrated by another ticket: the look « fused » of the mockup, on the card and in the details, never « To do ».
  const fused=jir41('building',AT_08);fused.tickets=fused.tickets.map(t=>t.id==='PRB-151'?{...t,delivery:'integrated',integratedBy:'PRB-147'}:t);
  const merged=told(fused,'PRB-151');
  assert.deepEqual([merged.chips[0],merged.tabs,merged.timeline,merged.delivery],[{text:'Merged · into PRB-147',tone:null},['summary'],undefined,'merged into PRB-147'],'it never ran: it has no timeline, and is not said waiting for its turn');
  assert.doesNotMatch(JSON.stringify(merged),/To do|Not started/);
  // A merge refused: the ticket is accepted by its reviews, but its card is not the green « Accepted ».
  const refused=jir41('building',AT_08);refused.tickets=refused.tickets.map(t=>t.id==='PRB-145'?{...t,mergeRefused:true}:t);
  const reports=[{ticket:'PRB-145',kind:'dev',commit:'c1',at:at(0),summary:'Fait.'},review('PRB-145',1,'accepted',at(1))],card=lineCard(lineTickets(refused)[3],{stage:'develop',reports});
  assert.deepEqual([card.look,card.word,card.sub,card.trace,card.avatar],['blk','Merge refused','',[{text:'review ✓',tight:'review ✓',tone:'ok'}],null]);
  const d=told(refused,'PRB-145',reports);
  assert.deepEqual(d.chips[0],{text:'Merge refused',tone:'bad'});
  assert.deepEqual(d.timeline.steps.map(s=>[s.sign,s.tone,s.text]),[['✓','ok','In dev · Dev 1'],['✓','ok','Review · accepted'],['!','bad','Merge refused']]);
  assert.equal(lineHead({mission:refused}).progress.segs[3],'blk');
  // Once merged, a refusal of before is over.
  const done=jir41('building',{...AT_08,'PRB-145':'merged'});done.tickets=done.tickets.map(t=>t.id==='PRB-145'?{...t,mergeRefused:true}:t);
  assert.deepEqual([lineCard(lineTickets(done)[3],{stage:'develop'}).look,lineCard(lineTickets(done)[3],{stage:'develop'}).word,lineHead({mission:done}).progress.segs[3]],['ok','Accepted','ok']);
});

// ---- Decision 53: the active ticket is always at the centre of the line.
// Where each card stands in a zone of a width, for a place of the line: entire and clear of the faded edges, or cut.
const placed=(tickets,width,pan)=>{const max=linePan({count:tickets.length,width}).max,end=width-LINE.pin-12,lo=pan>0?LINE.fade:0,hi=pan<max?end-LINE.fade:end;
  return tickets.map((t,i)=>{const x=LINE.left+i*LINE.pitch-pan,r=x+LINE.card;return {id:t.id,heavy:t.difficulty==='heavy',seen:r>lo&&x<hi,entire:x>=lo&&r<=hi,centre:x+LINE.card/2-(LINE.left+linePan({count:tickets.length,width}).view/2)};});};
test('the active ticket is the one in hand, whatever its state; in Prepare, and between two tickets, none is',()=>{
  for(const state of ['dev','review','fix'])assert.equal(lineActive(lineTickets(jir41('building',{...AT_08,'PRB-146':state}))),4,state);
  assert.equal(lineActive(lineTickets(jir41('analysing'))),-1);
  assert.equal(lineActive(lineTickets(jir41('building',{...AT_08,'PRB-146':'accepted'}))),-1);
  assert.equal(lineActive([]),-1);
  // Blocked or waited for: the ticket keeps its state in hand, it is the same active ticket.
  assert.equal(lineActive(lineTickets(jir41('building',{'PRB-142':'merged','PRB-144':'merged','PRB-149':'dev'}))),2);
});
test('the active ticket is at the centre of the line, to the point, in each state of Develop and at each width: the two ends of the line and a single ticket included (decision 53)',()=>{
  const many=()=>{const m=jir41('building',AT_08),more=Array.from({length:6},(_,i)=>'PRB-'+(152+i));m.tickets=[...m.tickets,...more.map((id,i)=>row(id,10+i))];m.plan.tickets=[...m.plan.tickets,...more.map((id,i)=>planTicket(id,10+i))];return m;};
  const one=jir41('building',{'PRB-142':'dev'});one.tickets=one.tickets.slice(0,1);one.plan.tickets=one.plan.tickets.slice(0,1);
  const merged=n=>Object.fromEntries(IDS.slice(0,n).map(id=>[id,'merged']));
  const cases=[['08',jir41('building',AT_08),4],['12',jir41('building',{...merged(2),'PRB-149':'dev'}),2],['14',jir41('building',{...merged(3),'PRB-145':'dev'}),3],
    ['16',jir41('building',{...AT_08,'PRB-146':'fix'}),4],['19',jir41('building',{...merged(6),'PRB-150':'review'}),6],['20',jir41('building',{...merged(7),'PRB-151':'dev'}),7],['42',many(),4],
    ['first',jir41('building',{'PRB-142':'dev'}),0],['second',jir41('building',{...merged(1),'PRB-144':'review'}),1],['last',jir41('building',{...merged(8),'PRB-148':'fix'}),8],['single',one,0]];
  for(const [name,m,want] of cases)for(const width of [966,1012,1180,1500]) {
    const tickets=lineTickets(m),active=lineActive(tickets),at=linePan({count:tickets.length,width,focus:lineFocus(tickets),active}),where=name+' at '+width;
    assert.equal(active,want,where);assert.equal(at.pan,at.auto,where);
    const centre=LINE.left+active*LINE.pitch-at.pan+LINE.card/2-(LINE.left+at.view/2);
    assert.ok(Math.abs(centre)<=0.5,where+': '+centre+' away from the centre');
    assert.ok(at.lo<=at.pan&&at.pan<=at.hi,where);
  }
  // Room is added before the first ticket and after the last one rather than holding the centring back.
  const first=lineTickets(cases[7][1]),last=lineTickets(cases[9][1]);
  assert.deepEqual(linePan({count:9,width:966,focus:0,active:0}),{view:798,max:722,lo:-319,hi:722,pan:-319,auto:-319,before:0,after:7});
  assert.deepEqual(linePan({count:9,width:966,focus:8,active:8}),{view:798,max:722,lo:0,hi:1041,pan:1041,auto:1041,before:7,after:0});
  assert.deepEqual(linePan({count:1,width:966,focus:0,active:0}),{view:798,max:0,lo:-319,hi:0,pan:-319,auto:-319,before:0,after:0},'a single ticket: nothing is hidden on either side');
  assert.equal(first.length+last.length,18);
  // No move to spare a Heavy card: in 12 at the width of the application, PRB-146 stays cut at the right edge.
  const t12=lineTickets(cases[1][1]),at12=linePan({count:9,width:966,focus:2,active:2});
  assert.equal(at12.pan,21);assert.equal(placed(t12,966,at12.pan)[4].entire,false);assert.equal(placed(t12,966,at12.pan)[4].seen,true);
  assert.equal(LINE.nudge,undefined,'the exception of half a card is gone');
  assert.equal(linePan({count:9,width:1012,focus:4,active:4}).pan,338,'screen 08 stays where the mockup puts it');
});
test('the line drawn with room before its first ticket or after its last one: the cards keep their order, nothing is said hidden that is not',()=>{
  const m=jir41('building',{'PRB-142':'dev'}),tickets=lineTickets(m),d=lineLayout({tickets,phases:linePhases(m,tickets),width:966,pan:-319});
  assert.equal(d.cards[0].x,323);assert.equal(d.cards[0].x+LINE.card/2,LINE.left+798/2,'the first card at the centre of the zone');
  assert.deepEqual([d.masks.left,d.pans.before,d.pans.after.count],[null,null,7]);
  const end=lineLayout({tickets,phases:[],width:966,pan:1041});
  assert.deepEqual([end.masks.right,end.pans.after,end.pans.before.count],[null,null,7]);
  const one=lineLayout({tickets:tickets.slice(0,1),phases:[],width:966,pan:-319});
  assert.deepEqual([one.masks.left,one.masks.right,one.pans.before,one.pans.after],[null,null,null,null]);
});
test('in Prepare, and when nothing is active, the line starts at the first ticket, as before',()=>{
  const tickets=lineTickets(jir41('analysing'));
  assert.deepEqual(linePan({count:9,width:966,focus:lineFocus(tickets),active:lineActive(tickets)}),{view:798,max:722,lo:0,hi:722,pan:0,auto:0,before:0,after:5});
  const single=lineTickets(jir41('analysing')).slice(0,1);
  assert.equal(linePan({count:1,width:966,focus:0,active:lineActive(single)}).pan,0,'a single ticket in Prepare is not moved (screen 37)');
  assert.equal(linePan({count:9,width:966,focus:5,active:-1}).pan,linePan({count:9,width:966,focus:5}).pan);
  // A place the user chose is held between the two ends of what the line can show.
  assert.equal(linePan({count:9,width:966,focus:4,active:4,pan:-50}).pan,0);assert.equal(linePan({count:9,width:966,focus:4,active:4,pan:9999}).pan,722);
  assert.equal(linePan({count:9,width:966,focus:0,active:0,pan:-100}).pan,-100,'between the active ticket at the centre and the first ticket at the edge');
});
test('after the user moved the line, its two buttons bring it back on the active ticket: a step never jumps over it',()=>{
  const step=LINE.step*LINE.pitch;
  assert.equal(lineJump({pan:1696,auto:338,max:1696,by:-step}),1186,'far from it: a step of three tickets');
  assert.equal(lineJump({pan:700,auto:338,max:1696,by:-step}),338,'a step that would pass it stops on it');
  assert.equal(lineJump({pan:0,auto:338,max:1696,by:step}),338);
  assert.equal(lineJump({pan:338,auto:338,max:1696,by:step}),848,'from the active ticket, a button moves the line as before');
  assert.equal(lineJump({pan:338,auto:338,max:1696,by:-step}),0);
  assert.equal(lineJump({pan:848,auto:338,max:1696,by:step}),1358,'away from it: a plain step');
  assert.equal(lineJump({pan:1500,auto:338,max:1696,by:step}),1696);
  // The active ticket at an end of the line: a step that reaches that end goes on to it, never stops short of it.
  assert.equal(lineJump({pan:400,auto:-319,max:722,by:-step}),-319);assert.equal(lineJump({pan:700,auto:-319,max:722,by:-step}),190);
  assert.equal(lineJump({pan:300,auto:1041,max:722,by:step}),1041);assert.equal(lineJump({pan:100,auto:1041,max:722,by:step}),610);
  assert.equal(lineJump({pan:-319,auto:-319,max:722,by:step}),191,'from the first ticket at the centre, three tickets further');
  assert.equal(lineJump({pan:1041,auto:1041,max:722,by:-step}),531);
});
test('the line sets itself again when the active ticket changes, and follows it again once the user is back on it',async()=>{
  const main=await readFile(new URL('../mods/fabrique-console-v4-ticket/main.js',import.meta.url),'utf8');
  // With one dev the key is the development and its ticket in focus, as before the lanes; with two, the active ticket of each lane too.
  assert.match(main,/const key=m\.id\+'\|'\+\(tickets\[focus\]\?\.id\|\|''\)\+\(devs\?'\|'\+lanesPan\(\{tickets,width,focus\}\)\.active\.map\(i=>tickets\[i\]\?\.id\|\|''\)\.join\('\|'\):''\);\n\s+if\(this\.panOf!==key\)\{this\.panOf=key;this\.pan=null;\}/,'another active ticket: the place the user chose is forgotten');
  assert.match(main,/devs\?lanesPan\(\{tickets,width,focus,pan:this\.pan\}\):linePan\(\{count:tickets\.length,width,focus,pan:this\.pan,active\}\)/);
  assert.match(main,/Math\.min\(at\.hi,Math\.max\(at\.lo,at\.pan\+by\)\)/,'the wheel reaches the active ticket at an end of the line');
  assert.match(main,/moveLine\(to,auto,cx\) \{this\.pan=to===auto\?null:to;cx\.notify\(\);\}/,'back on the active ticket, the line follows it by itself again');
  assert.match(main,/this\.moveLine\(lineJump\(\{pan:at\.pan,auto:at\.auto,max:at\.max,by\}\),at\.auto,cx\)/,'the two buttons stop on the active ticket');
});

test('the foot of a card cuts nothing: what is said beside the state goes under it when the row is too short, the badge of the dev stays',async()=>{
  const card=await readFile(new URL('../mods/fabrique-console-v4-ticket/card.js',import.meta.url),'utf8'),foot=/const foot=[\s\S]*?:null;/.exec(card)?.[0]||'';
  assert.match(foot,/h_flex\(\)\.flex_1\(\)\.min_w\(0\)\.flex_wrap\(\)/,'the state and its detail wrap');
  assert.match(foot,/\.when\(Boolean\(card\.avatar\),e=>e\.child\(devBadge\(card\.avatar\)\)\):null;$/,'the badge is outside what wraps');
});
test('choosing a ticket never moves the line, as on the mockup: only its buttons and the wheel do',async()=>{
  const main=await readFile(new URL('../mods/fabrique-console-v4-ticket/main.js',import.meta.url),'utf8'),line=await readFile(new URL('../mods/fabrique-console-v4-ticket/line.js',import.meta.url),'utf8');
  const pick=/\n pick\(id,cx\) \{[\s\S]*?\n \}/.exec(main)?.[0]||'';
  assert.ok(pick,'the page chooses a ticket in pick()');
  assert.doesNotMatch(pick,/this\.pan|moveLine|linePan/,'a ticket chosen, even hidden, leaves the line where it is');
  assert.doesNotMatch(main+line,/lineReveal/);
  assert.match(main,/\.on_scroll_wheel\(/,'the wheel is kept, beside the two buttons');
  assert.match(main,/line-before[\s\S]*line-after/);
});

test('while the Lead breaks the issue down, QA and Sign-off are not drawn at the end of the line (screen 01)',()=>{
  const m=jir41('analysing');m.tickets=m.tickets.slice(0,6);
  assert.deepEqual(lineEnds({mission:m,lead:{status:'working'}}),[]);
  assert.equal(lineEnds({mission:m,lead:{status:'idle'}}).length,2,'the plan ready, they are back (screen 04)');
  assert.equal(lineEnds({mission:jir41('building',AT_08),lead:{status:'working'}}).length,2,'after Prepare they are always there');
  const tickets=lineTickets(m),bare=lineLayout({tickets,phases:linePhases(m,tickets),width:1012,pan:0,ends:false}),full=lineLayout({tickets,phases:linePhases(m,tickets),width:1012,pan:0});
  assert.deepEqual([bare.ends,bare.phases.filter(p=>p.pin),bare.segs.filter(s=>s.pin),bare.heads.filter(h=>h.pin)],[[],[],[],[]],'neither the cards, nor « Validate » above them, nor the arrow between them');
  assert.deepEqual([bare.cards,bare.glyphs,bare.masks,bare.pans],[full.cards,full.glyphs,full.masks,full.pans],'the line itself keeps its place');
  assert.equal(full.ends.length,2);
});

test('the details show a tab only for what the plan gives: Technical, Tests & criteria',()=>{
  const m=jir41('analysing');
  m.plan.tickets[4]={...m.plan.tickets[4],technical:['Code touché : la route de dépôt.'],tests:['Ciblés : deux dépôts concurrents.'],criteria:['La section charge 100 tickets.','Le serveur décide de la position.']};
  m.plan.tickets[5]={...m.plan.tickets[5],criteria:['L\'Arbre s\'ouvre en moins de 500 ms.']};
  const tickets=lineTickets(m),d=lineDetail({mission:m,tickets,id:'PRB-146'});
  assert.deepEqual([d.tabs,d.technical,d.tests,d.criteria],[['summary','technical','criteria'],['Code touché : la route de dépôt.'],['Ciblés : deux dépôts concurrents.'],['La section charge 100 tickets.','Le serveur décide de la position.']]);
  const half=lineDetail({mission:m,tickets,id:'PRB-147'});
  assert.deepEqual([half.tabs,half.technical,half.tests,half.criteria],[['summary','criteria'],[],[],['L\'Arbre s\'ouvre en moins de 500 ms.']]);
  const none=lineDetail({mission:m,tickets,id:'PRB-145'});
  assert.deepEqual([none.tabs,none.technical,none.tests,none.criteria],[['summary'],[],[],[]],'what the plan does not give has no tab');
  const dev={...m,step:'building',tickets:m.tickets.map(t=>t.id==='PRB-146'?{...t,state:'dev'}:t)};
  assert.deepEqual(lineDetail({mission:dev,tickets:lineTickets(dev),id:'PRB-146'}).tabs,['summary','timeline','technical','criteria'],'in the order of the mockup');
});

test('the timeline puts nothing in the place of what it does not know: the message of a commit, the tests run',()=>{
  const m=jir41('building',AT_08),tickets=lineTickets(m),at=n=>'2026-11-13T10:0'+n+':00Z';
  const dev={ticket:'PRB-145',kind:'dev',commit:'aa252b3f00',repo:'beta',at:at(0),summary:'Fait.'},ok=review('PRB-145',1,'accepted',at(1),{commit:'aa252b3f00'});
  const bare=lineDetail({mission:m,tickets,id:'PRB-145',reports:[dev,ok]}).timeline;
  assert.deepEqual([bare.commits,bare.tests],[[{hash:'aa252b3',text:''}],null],'a commit without a message is its hash alone, never the name of its repository');
  // The report of a dev that names its commits and the tests it ran: they are shown as the mockup shows them.
  const told=lineDetail({mission:m,tickets,id:'PRB-145',reports:[{...dev,commits:[{commit:'aaab99a41c',message:'liste : requête par fenêtres de 100'},{commit:'aa252b3f00',message:'liste : défilement sans saut'},{message:'sans identifiant'}],tests:'Targeted tests: all passed.'},ok]}).timeline;
  assert.deepEqual([told.commits,told.tests],[[{hash:'aaab99a',text:'liste : requête par fenêtres de 100'},{hash:'aa252b3',text:'liste : défilement sans saut'}],'Targeted tests: all passed.']);
  assert.deepEqual(told.steps[1],{sign:'✓',tone:'ok',text:'Review · accepted',sub:'Codex · gpt-6.1-sol'},'the reviewer is said with its model, as in the summary');
});

// A plan of one ticket (screens 37, 38, 39; review M3, P2): no QA agent, one review. The card is wide, with its expected
// result, then « Review » and « Sign-off » side by side, each as tall as the card (html/37-single-ticket-ready.html).
const one=(step,state='todo')=>({id:'M-2',project:'beta',step,issue:{identifier:'PRB-160'},branch:'prb-160',tickets:[{id:'PRB-160',n:1,title:'Backlog : un ticket restauré',level:'léger',dev:'claude',model:'claude-opus-5-5',deps:[],state,rounds:0}],
  plan:{format:2,simple:true,points:3,tickets:[{id:'PRB-160',rank:1,title:'Backlog : un ticket restauré',result:'Il revient à sa place.',difficulty:'light',deps:[]}],phases:[]}});
test('a single ticket: a wide card with its expected result, then Review and Sign-off, as on screen 37',()=>{
  const m=one('analysing'),tickets=lineTickets(m),d=lineLayout({tickets,phases:[],width:1012,pan:120,simple:true});
  assert.deepEqual(d.cards.map(c=>[c.id,c.x,c.y,c.w,c.h,c.view,c.result]),[['PRB-160',4,40,560,196,'wide','Il revient à sa place.']],'the card of the mockup, never moved by a pan');
  assert.deepEqual(d.ends.map(e=>[e.key,e.x,e.y,e.w,e.h]),[['review',576,40,212,196],['signoff',796,40,212,196]]);
  assert.deepEqual(d.glyphs.map(g=>[g.x,g.y,g.w,g.text]),[[564,130,12,'›'],[786,130,12,'›']]);
  assert.deepEqual([d.segs,d.heads,d.phases,d.pans.before,d.pans.after,d.masks.left,d.masks.right],[[],[],[],null,null,null,null],'no arrow from QA, no « Validate » header, nothing hidden');
  assert.equal(d.masks.solid.w,0,'nothing to mask: the line holds in its zone');
  // Without the ends (the Lead still breaks the issue down) the card keeps its place.
  assert.deepEqual(lineLayout({tickets,phases:[],width:1012,simple:true,ends:false}).cards[0].w,560);
  const words=ends=>ends.map(e=>[e.key,e.title,e.sub,e.look,e.word,e.count]);
  assert.deepEqual(words(lineEnds({mission:m})),[['review','Review','one review, no QA agent on a single ticket','next','',''],['signoff','Sign-off','what QA cannot judge','next','','']]);
  assert.deepEqual(words(lineEnds({mission:one('building','dev')})).map(e=>e.slice(3)),[['next','Upcoming',''],['next','Upcoming','']],'screen 38');
  assert.deepEqual(words(lineEnds({mission:one('building','review')})).map(e=>e.slice(3)),[['run','Running',''],['next','Upcoming','']]);
  assert.deepEqual(words(lineEnds({mission:one('building','accepted')})).map(e=>e.slice(3)),[['ok','Accepted',''],['next','Upcoming','']]);
  const plan=[{id:'p1'},{id:'p2'},{id:'p3'}];
  assert.deepEqual(words(lineEnds({mission:one('validating','merged'),qa:{plan,marks:{}}})).map(e=>e.slice(3)),[['ok','Accepted',''],['you','Your turn','0 / 3 checked']],'screen 39');
  assert.deepEqual(words(lineEnds({mission:one('closed','merged'),qa:{plan,marks:{p1:{result:'ok'},p2:{result:'ok'},p3:{result:'ok'}}}})).map(e=>e.slice(3)),[['ok','Accepted',''],['ok','Closed','3 / 3 checked']]);
});

test('at the end of the line, QA then Sign-off say where they stand',()=>{
  const words=ends=>ends.map(e=>[e.title,e.sub,e.look,e.word,e.count]);
  assert.deepEqual(words(lineEnds({mission:jir41('analysing')})),[['QA','one video per flow','next','',''],['Sign-off','what QA cannot judge','next','','']]);
  assert.deepEqual(words(lineEnds({mission:jir41('building',AT_08)})).map(e=>e.slice(2)),[['next','Upcoming',''],['next','Upcoming','']]);
  assert.deepEqual(words(lineEnds({mission:jir41('building',Object.fromEntries(IDS.map(id=>[id,'merged'])))})).map(e=>e.slice(2)),[['start','Starting',''],['next','Upcoming','']]);
  const all=Object.fromEntries(IDS.map(id=>[id,'merged'])),plan=[{id:'t1',auto:'ok'},{id:'t2',auto:'ok'},{id:'t3',auto:'ko'}];
  assert.deepEqual(words(lineEnds({mission:jir41('qa',all),qa:null})).map(e=>e.slice(2)),[['start','',''],['next','Upcoming','']],'how many flows the QA played is not known while it runs: no count is said');
  assert.deepEqual(words(lineEnds({mission:jir41('validating',all),qa:{plan,marks:{t1:{result:'ok'}}}})).map(e=>e.slice(2)),[['ok','Done','2 / 3 passed'],['you','Your turn','0 / 1 checked']]);
  assert.deepEqual(words(lineEnds({mission:jir41('validating',all),qa:{plan,marks:{t1:{result:'ok'},t2:{result:'ok'},t3:{result:'ko'}}}})).map(e=>e.slice(2)),[['ok','Done','2 / 3 passed'],['ok','Done','1 / 1 checked']]);
  assert.deepEqual(words(lineEnds({mission:jir41('closed',all),qa:null})).map(e=>e.slice(2)),[['ok','',''],['ok','Closed','']]);
});

test('the head of the plan counts the tickets, then the accepted ones, one segment for each ticket',()=>{
  const working=lineHead({mission:jir41('analysing'),lead:{status:'working'}});
  assert.deepEqual(working,{count:'9 tickets written',facts:{line:'one at a time on',branch:'prb-41',dev:{badge:'D1',name:'Dev 1',tool:'Claude Code · opus 5.5'},devs:[{badge:'D1',name:'Dev 1',tool:'Claude Code · opus 5.5'}]},progress:null});
  assert.equal(lineHead({mission:jir41('analysing'),lead:{status:'idle'}}).count,'9 tickets');
  // Two tools in a plan that does not say its devs are not said as one: Dev 1, without a tool. A plan that gives a
  // ticket to Dev 2 has two devs, each with its own tool (screen 40).
  const mixed=jir41('analysing');mixed.tickets[0].dev='codex';
  assert.deepEqual(lineHead({mission:mixed,lead:null}).facts.devs.map(d=>[d.name,d.tool]),[['Dev 1','']]);
  mixed.plan.tickets[0].dev=2;
  assert.deepEqual(lineHead({mission:mixed,lead:null}).facts.devs.map(d=>[d.name,d.tool]),[['Dev 1','Claude Code · opus 5.5'],['Dev 2','Codex · opus 5.5']],'the plan says the devs');
  const dev=lineHead({mission:jir41('building',AT_08),lead:null,items:[]});
  assert.deepEqual(dev,{count:'9 tickets',facts:null,progress:{text:'4 of 9 accepted',segs:['ok','ok','ok','ok','run','','','','']}});
  assert.deepEqual(lineHead({mission:jir41('building',AT_08),items:[{type:'stuck',state:'pending',mission:'M-1',ticket:'PRB-146'}]}).progress.segs[4],'blk');
  assert.deepEqual(lineHead({mission:jir41('building',AT_08),items:[{type:'decision',state:'pending',mission:'M-1',ticket:'PRB-146'}]}).progress.segs[4],'you');
  assert.deepEqual(lineHead({mission:{step:'analysing',tickets:[]}}),{count:'',facts:null,progress:null});
});

test('the legend names only what is on the line',()=>{
  const m=jir41('analysing'),tickets=lineTickets(m),cards=tickets.map(t=>lineCard(t,{stage:'prepare'}));
  assert.deepEqual(lineLegend({tickets,cards,stage:'prepare'}),[{kind:'tag',glyph:'Heavy',heavy:true,text:'tests first, two reviews',filter:'heavy'},{kind:'tag',glyph:'Light',heavy:false,text:'',filter:'light'},{kind:'text',glyph:'',text:'no tag: Standard',filter:null},{kind:'badge',glyph:'T',tone:null,text:'copy to write',filter:'copy'}]);
  const d=jir41('building',AT_08),dt=lineTickets(d),dc=dt.map(t=>lineCard(t,{stage:'develop',reports:[review('PRB-145',1,'accepted','2026-11-13T10:00:00Z'),review('PRB-149',1,'changes_requested','2026-11-13T09:00:00Z')]}));
  assert.deepEqual(lineLegend({tickets:dt,cards:dc,stage:'develop'}).map(l=>[l.glyph,l.text,l.filter]),[['Heavy','2 reviews',null],['Light','',null],['T','copy',null],['✓','accepted',null],['✗','changes requested',null]]);
  const q=lineLegend({tickets,cards:tickets.map(t=>lineCard(t,{stage:'prepare',items:[{type:'decision',state:'pending',ticket:'PRB-145'}]})),stage:'prepare'});
  assert.deepEqual(q.at(-1),{kind:'badge',glyph:'?',tone:'you',text:'open question',filter:'question'});
  assert.deepEqual(lineLegend({tickets:[],cards:[],stage:'prepare'}),[]);
  // In Prepare an entry of the legend filters the line.
  const by=id=>tickets.find(t=>t.id===id);
  assert.deepEqual([lineMatches(by('PRB-146'),'heavy'),lineMatches(by('PRB-145'),'heavy'),lineMatches(by('PRB-151'),'light'),lineMatches(by('PRB-151'),'copy'),lineMatches(by('PRB-150'),'copy'),lineMatches(by('PRB-150'),null)],[true,false,true,true,false,true]);
  assert.equal(lineMatches(by('PRB-145'),'question',[{type:'decision',state:'pending',ticket:'PRB-145'}]),true);
});

test('the details of a ticket: what it does, its expected result, who develops and reviews it, what it waits for and unblocks',()=>{
  const m=jir41('analysing',{},{tldrs:{'PRB-146':'La section sans sprint charge par blocs de 100.'}}),tickets=lineTickets(m);
  const d=lineDetail({mission:m,tickets,id:'PRB-146'});
  assert.deepEqual({position:d.position,id:d.id,title:d.title,chips:d.chips,tabs:d.tabs,what:d.what,expected:d.expected,dev:d.dev,reviewer:d.reviewer,waits:d.waits,unblocks:d.unblocks,delivery:d.delivery},
    {position:'Ticket 5 of 9',id:'PRB-146',title:'Titre PRB-146',chips:[{text:'Heavy · tests first, two reviews',tone:'heavy'}],tabs:['summary'],what:'La section sans sprint charge par blocs de 100.',expected:'Résultat PRB-146',
      dev:'Dev 1 · Claude Code · opus 5.5 · high effort',reviewer:'two reviews · Codex · gpt-6.1-sol',waits:{ids:['PRB-145'],none:''},unblocks:{ids:['PRB-147'],none:''},delivery:''});
  const first=lineDetail({mission:m,tickets,id:'PRB-142'});
  assert.deepEqual([first.chips,first.what,first.reviewer,first.waits,first.unblocks],[[{text:'Standard',tone:null}],null,'one review · Codex · gpt-6.1-sol',{ids:[],none:'nothing, first ticket'},{ids:['PRB-144'],none:''}]);
  const orphan=jir41('analysing');orphan.tickets[4].deps=[];orphan.tickets[5].deps=[];
  assert.deepEqual([lineDetail({mission:orphan,tickets:lineTickets(orphan),id:'PRB-146'}).waits,lineDetail({mission:orphan,tickets:lineTickets(orphan),id:'PRB-146'}).unblocks],[{ids:[],none:'nothing'},{ids:[],none:'nothing'}],'a ticket in the middle that waits for nothing is said so, never the first nor the last');
  assert.deepEqual(lineDetail({mission:m,tickets,id:'PRB-148'}).unblocks,{ids:[],none:'nothing, last ticket'});
  assert.deepEqual(lineDetail({mission:m,tickets,id:'PRB-148',lead:{status:'working'}}).unblocks,{ids:[],none:'to be set'},'while the Lead writes the plan, what the last ticket unblocks is not settled');
  assert.deepEqual(lineDetail({mission:m,tickets,id:'PRB-151',items:[{type:'decision',state:'pending',ticket:'PRB-151'}]}).chips,[{text:'Light',tone:null},{text:'copy to write',tone:null},{text:'open question',tone:'you'}]);
  assert.equal(lineDetail({mission:m,tickets,id:'PRB-999'}),null);
  const bare=lineDetail({mission:{step:'analysing',tickets:[{id:'X-1',n:1,title:'Seul',state:'todo',deps:[]}]},tickets:lineTickets({tickets:[{id:'X-1',n:1,title:'Seul',state:'todo',deps:[]}]}),id:'X-1'});
  assert.deepEqual([bare.chips,bare.expected,bare.dev,bare.reviewer],[[],null,'',''],'what the plan does not say is left out');
  const fused={...m,tickets:m.tickets.map(t=>t.id==='PRB-151'?{...t,delivery:'integrated',integratedBy:'PRB-147'}:t)};
  assert.equal(lineDetail({mission:fused,tickets:lineTickets(fused),id:'PRB-151'}).delivery,'merged into PRB-147');
});

test('in Develop the details say the state of the ticket and keep what the agents wrote: summary, reviews, full reports',()=>{
  const m=jir41('building',AT_08),tickets=lineTickets(m),at=n=>'2026-11-13T10:0'+n+':00Z';
  const reports=[{ticket:'PRB-145',kind:'dev',commit:'aaab99a0c1',repo:'beta',at:at(0),summary:'Liste par fenêtres de 100. Tests ciblés verts.'},
    review('PRB-145',1,'changes_requested',at(1),{commit:'aaab99a0c1',summary:'Deux points. (1) Un dépôt hors fenêtre disparaît ; (2) aucun test du retour arrière.'}),
    {ticket:'PRB-145',kind:'dev',commit:'aa252b3f00',repo:'beta',at:at(2),summary:'Corrigé. Les deux remarques sont traitées.'},
    review('PRB-145',1,'accepted',at(3),{commit:'aa252b3f00',summary:'Conforme.'})];
  const d=lineDetail({mission:m,tickets,id:'PRB-145',reports});
  assert.deepEqual(d.chips,[{text:'Accepted',tone:'ok'},{text:'Standard',tone:null}]);
  assert.deepEqual(d.tabs,['summary','timeline']);
  assert.deepEqual(d.timeline.title,'Steps');
  assert.deepEqual(d.timeline.steps,[{sign:'✓',tone:'ok',text:'In dev · Dev 1',sub:''},{sign:'✗',tone:'fix',text:'Review · changes requested',sub:'Codex · gpt-6.1-sol · 2 remarks'},{sign:'✓',tone:'ok',text:'Fixing · Dev 1',sub:'round 2'},{sign:'✓',tone:'ok',text:'Review · accepted',sub:'Codex · gpt-6.1-sol'},{sign:'✓',tone:'ok',text:'Accepted',sub:''}]);
  assert.deepEqual(d.timeline.remarks,['Un dépôt hors fenêtre disparaît','aucun test du retour arrière']);
  assert.deepEqual(d.timeline.commits,[{hash:'aaab99a',text:''},{hash:'aa252b3',text:''}]);
  assert.deepEqual(d.timeline.done,'Corrigé.');
  assert.deepEqual(d.timeline.reviews,[{title:'Review · accepted',by:'Codex · gpt-6.1-sol',text:'Conforme.'}],'the reviews of the commit delivered last');
  assert.deepEqual(d.timeline.full.map(f=>[f.title,f.facts,f.text]),[['Dev 1',['Claude Code','beta','aa252b3f'],'Corrigé. Les deux remarques sont traitées.'],['Review · accepted',['Codex · gpt-6.1-sol'],'Conforme.']]);
  const running=lineDetail({mission:m,tickets,id:'PRB-146',reports,span:'38 min'});
  assert.deepEqual(running.chips,[{text:'In dev · 38 min',tone:'run'},{text:'Heavy · tests first, two reviews',tone:'heavy'}]);
  assert.deepEqual([running.timeline.title,running.timeline.steps],['Steps · in progress',[{sign:'●',tone:'run',text:'In dev · Dev 1',sub:'running'},{sign:'·',tone:null,text:'Review 1',sub:'up next'},{sign:'·',tone:null,text:'Review 2',sub:'up next'}]]);
  assert.deepEqual([running.timeline.done,running.timeline.reviews,running.timeline.full,running.timeline.commits],[null,[],[],[]]);
  const todo=lineDetail({mission:m,tickets,id:'PRB-150',reports});
  assert.deepEqual([todo.chips[0],todo.timeline],[{text:'To do',tone:null},{empty:'Not started yet. This ticket is waiting for its turn.'}]);
  const inReview={...m,tickets:m.tickets.map(t=>t.id==='PRB-146'?{...t,state:'review'}:t)};
  assert.deepEqual(lineDetail({mission:inReview,tickets:lineTickets(inReview),id:'PRB-146',reports:[{ticket:'PRB-146',kind:'dev',commit:'c9',at:at(4),summary:'Fait.'}]}).timeline.steps,
    [{sign:'✓',tone:'ok',text:'In dev · Dev 1',sub:''},{sign:'R',tone:'run',text:'Review 1 of 2 · running',sub:'Codex · gpt-6.1-sol · the reviewer is reading'},{sign:'·',tone:null,text:'Review 2',sub:'up next'}]);
});

test('from the details, the next ticket and the one before open in turn, round the line',()=>{
  const tickets=lineTickets(jir41('analysing'));
  assert.equal(lineStep(tickets,'PRB-146',1),'PRB-147');assert.equal(lineStep(tickets,'PRB-146',-1),'PRB-145');
  assert.equal(lineStep(tickets,'PRB-148',1),'PRB-142');assert.equal(lineStep(tickets,'PRB-142',-1),'PRB-148');
  assert.equal(lineStep(tickets,'PRB-999',1),null);
});

test('the card and the line write no word of their own',async()=>{
  for(const file of ['line.js','card.js','main.js','blocks.js']) {
    const text=await readFile(new URL('../mods/fabrique-console-v4-ticket/'+file,import.meta.url),'utf8'),code=text.split('\n').filter(line=>!/^\s*\/\//.test(line)).join('\n');
    assert.deepEqual([...code.matchAll(/\.child\((['"`])([^'"`]*[A-Za-z]{2}[^'"`]*)\1\)/g)].map(m=>m[2]),[],file+' writes no word of its own');
  }
  assert.equal(await readFile(new URL('../mods/fabrique-console-v4-ticket/line.js',import.meta.url),'utf8'),await readFile(new URL('../ui/v4/line.js',import.meta.url),'utf8'));
});
