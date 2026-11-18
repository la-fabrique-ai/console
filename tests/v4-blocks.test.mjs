import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {pageSince,pageMoment,pageCurrent,pageStrip,pageBlocks,pageSheet,coverageOf,approachLink,dayOf,dayAt,dayClock,dayHour,minutesText,tokensText,handSpan,whenOf,clipText,stripRoom} from '../mods/fabrique-console-v4-ticket/blocks.js';
import {lineTickets,lineDetail} from '../mods/fabrique-console-v4-ticket/line.js';

// PRB-41 of the mockup, as the engine of today gives it: tickets, plan (phases, results, texts), and nothing more.
const IDS=['PRB-142','PRB-144','PRB-149','PRB-145','PRB-146','PRB-147','PRB-150','PRB-151','PRB-148'],HEAVY=['PRB-146','PRB-147'];
const PHASE={'PRB-142':'p1','PRB-144':'p2','PRB-149':'p2','PRB-145':'p3','PRB-146':'p3','PRB-147':'p3','PRB-150':'p4','PRB-151':'p4','PRB-148':'p5'};
const PHASES=[['p1','Mesurer'],['p2','Préparer la base'],['p3','Charger par fenêtres'],['p4','Alléger, documenter'],['p5','Mesurer']].map(([id,title])=>({id,title}));
const row=(id,n,state='todo')=>({id,n,title:'Titre '+id,level:HEAVY.includes(id)?'fort':'standard',dev:'claude',model:'claude-opus-5-5',deps:[],kind:'work',delivery:'included',state,rounds:0});
const planTicket=(id,n)=>({id,rank:n,title:'Titre '+id,result:'Résultat '+id,difficulty:HEAVY.includes(id)?'heavy':'standard',kind:'work',delivery:'included',deps:[],phase:PHASE[id],texts:id==='PRB-151'?['guide /aide']:[],mockups:[]});
const mission=(step,states={},plan={},ids=IDS)=>({id:'M-1',project:'beta',step,issue:{identifier:'PRB-41',url:'https://tracker.invalid/PRB-41'},branch:'prb-41',tickets:ids.map((id,i)=>row(id,i+1,states[id]||'todo')),plan:{format:2,tickets:ids.map((id,i)=>planTicket(id,i+1)),phases:PHASES,...plan}});
const AT_08={'PRB-142':'accepted','PRB-144':'accepted','PRB-149':'accepted','PRB-145':'accepted','PRB-146':'dev'},ALL=Object.fromEntries(IDS.map(id=>[id,'accepted']));
const WORKING={address:'t1',status:'working'},IDLE={address:'t1',status:'idle'};
const ask=(id,more={})=>({id,type:'decision',state:'pending',mission:'M-1',ticket:null,title:'Question '+id,priority:2,createdAt:'2026-11-12T10:0'+id.slice(-1)+':00Z',...more});
const at=(...parts)=>new Date(...parts).toISOString();
// What the engine will give for these zones (simulation/CONTRAT.md).
const APPROACH={summary:'Mesurer, puis charger par fenêtres.',text:'Mesurer d\'abord sur main.',paragraphs:['Premier paragraphe.','Second paragraphe.']};
const REQUESTS=[{id:'d1',short:'Mesure rejouable',full:'La mesure est rejouable.',tickets:['PRB-142','PRB-148']},{id:'d6',short:'Guide à jour',full:'Le guide est à jour.',tickets:[]},{id:'d7',short:'Recherche par fenêtres',full:'La recherche charge par fenêtres.',tickets:[],state:'postponed',postponedAt:'2026-11-12',reason:'Reportée.'}];
const TO_PLAN={manual:{summary:'0025 then 0026 · DEV, then target',note:'Rien d\'autre.',items:[{title:'Migrations sur DEV',detail:'après la fusion',tickets:['PRB-144']},{title:'Migrations sur la cible',detail:'',tickets:[]}]},
  risks:{summary:'collations, drops',items:[{title:'Les collations changent l\'ordre',detail:'Prévu : comparer.',tickets:['PRB-149']}]},accounts:{summary:'admin, plain member',items:[{title:'Admin',detail:'pour voir'},{title:'Member',detail:''}]}};
const DECISIONS=[{id:'q1',kind:'question',short:'Recherche par fenêtres',said:'non, ticket de suite',title:'La recherche doit-elle charger par fenêtres ?',answer:'Non, ticket de suite.',at:at(2026,10,12,14,46),changed:'The request stays uncovered.',history:[]},
  {id:'r1',kind:'question',short:'Collations',said:'à part, en 0026',title:'Collations : dans 0025, ou à part ?',answer:'À part, en 0026.',at:at(2026,10,11,17,32),changed:'Ticket PRB-149 added.',history:[{at:at(2026,10,11,17,28),text:'Lead : à part.'}]}];
const ENV_OK={ok:true,checks:[{key:'server',ok:true,detail:'in 6 s'},{key:'accounts',ok:true,detail:'2 accounts'},{key:'migrations',ok:true,detail:'0025 then 0026'}]};
const ENV_KO={ok:false,failure:'the server does not start',note:'Restart it.',checks:[{key:'server',ok:false,detail:'failed: port taken'},{key:'accounts',ok:true,detail:'2 accounts'}]};
const strip=(m,more={})=>pageStrip({mission:m,tickets:lineTickets(m),...more});
const texts=block=>block.rows.map(r=>[r.sign,r.text,r.sub,r.right]);

test('the rules of the band and of the blocks are built with the other shared files of the V4 screens',async()=>{
  assert.match(await readFile(new URL('../scripts/build-ui.mjs',import.meta.url),'utf8'),/V4_SHARED=\[[^\]]*'blocks\.js'/);
  assert.equal(await readFile(new URL('../mods/fabrique-console-v4-ticket/blocks.js',import.meta.url),'utf8'),await readFile(new URL('../ui/v4/blocks.js',import.meta.url),'utf8'));
});

test('the band and the blocks are drawn in Prepare, in Develop, and while the QA starts; later moments are not theirs',()=>{
  assert.equal(pageMoment(mission('analysing')),'prepare');
  assert.equal(pageMoment(mission('building',AT_08)),'develop');
  assert.equal(pageMoment(mission('building',ALL)),'starting','all accepted: the QA is about to start');
  assert.equal(pageMoment(mission('qa',ALL),{qa:null,flows:{total:38,played:0}}),'starting','the QA has played nothing yet (screen 21)');
  assert.equal(pageMoment(mission('qa',ALL),{flows:{played:14}}),null,'the QA plays: the Validate screen takes over (screen 22)');
  assert.equal(pageMoment(mission('qa',ALL),{qa:{plan:[{id:'P1'}]}}),null);
  assert.equal(pageMoment(mission('validating',ALL)),null);assert.equal(pageMoment(mission('closed',ALL)),null);
  for(const m of [mission('validating',ALL),mission('closed',ALL)]){assert.equal(strip(m),null);assert.equal(pageBlocks({mission:m}),null);}
});

test('in Prepare the band tells the approach of the Lead and its phases, each with its tickets (screens 01 and 04)',()=>{
  const plan={approach:APPROACH,migrations:['0025','0026']},ready=strip(mission('analysing',{},plan),{lead:IDLE});
  assert.deepEqual([ready.tone,ready.kicker,ready.title,ready.text],[null,"Lead's approach",APPROACH.summary,APPROACH.text]);
  assert.equal(ready.mid.title,'Phases, in order');
  assert.deepEqual(ready.mid.steps.map(s=>[s.sign,s.text,s.sub]),[['1','Mesurer','1 ticket'],['2','Préparer la base','2 tickets'],['3','Charger par fenêtres','3 tickets'],['4','Alléger, documenter','2 tickets'],['5','Mesurer','1 ticket']]);
  assert.deepEqual(ready.facts,[['Execution','one at a time'],['Heavy tickets','2'],['Migrations','0025, 0026']]);
  assert.deepEqual(ready.button,{key:'approach',label:'Read the approach ›'});
  // While the Lead works: it is said, and a phase with no ticket yet is said coming.
  const working=strip(mission('analysing',{},plan,IDS.slice(0,6)),{lead:WORKING});
  assert.equal(working.kicker,'The Lead is working');
  assert.deepEqual(working.mid.steps.map(s=>s.sub),['1 ticket','2 tickets','3 tickets','coming','coming']);
  assert.deepEqual(strip(mission('analysing',{},plan,IDS.slice(0,6)),{lead:IDLE}).mid.steps.map(s=>s.sub),['1 ticket','2 tickets','3 tickets','',''],'a Lead that does not work announces nothing');
});

test('with the engine of today the band of Prepare says only what is known: the phases, no approach, no migration',()=>{
  const bare=strip(mission('analysing'),{lead:IDLE});
  assert.deepEqual([bare.title,bare.text,bare.button],['','',null]);
  assert.deepEqual(bare.facts,[['Execution','one at a time'],['Heavy tickets','2']]);
  assert.equal(bare.mid.steps.length,5);
  assert.equal(strip(mission('analysing',{},{phases:[]}),{lead:IDLE}),null,'neither an approach nor a phase: no band');
  assert.equal(strip({id:'M-1',step:'analysing',tickets:[]},{lead:WORKING}),null);
  assert.equal(approachLink(mission('analysing')),false);assert.equal(approachLink(mission('analysing',{},{approach:APPROACH})),true);
  assert.equal(approachLink(mission('analysing',{},{approach:APPROACH,simple:true})),false,'a single ticket has no link to an approach');
});

test('in Develop the band tells the ticket in hand: title, expected result, state, steps, dev, reviewer, reviews (screen 08)',()=>{
  const m=mission('building',AT_08),s=strip(m,{span:'38 min',story:{timings:{'PRB-146':[{step:'dev',minutes:38}]},tokens:{tickets:{'PRB-146':{in:490000,out:38000}}}}});
  assert.deepEqual([s.tone,s.kicker,s.title,s.text],['run','Current ticket · PRB-146 · 5 of 9','Titre PRB-146','Expected: Résultat PRB-146']);
  assert.deepEqual(s.chips,[{text:'In dev · 38 min',tone:'run'},{text:'Heavy',tone:'heavy'}]);
  assert.equal(s.mid.title,'Steps · time per step');
  assert.deepEqual(s.mid.steps,[{sign:'●',tone:'run',text:'In dev · Dev 1',sub:'38 min'},{sign:'·',tone:null,text:'Review 1',sub:'up next'},{sign:'·',tone:null,text:'Review 2',sub:'up next'}]);
  assert.deepEqual(s.facts,[['Dev','Dev 1'],['Reviewer','Codex'],['Reviews','two'],['Tokens in','490k'],['Tokens out','38k']]);
  assert.deepEqual(s.button,{key:'ticket',label:'Open the ticket ›',id:'PRB-146'});
});

test('a time or a count of tokens the engine does not give is not drawn, never made up',()=>{
  const m=mission('building',AT_08),bare=strip(m);
  assert.deepEqual(bare.facts,[['Dev','Dev 1'],['Reviewer','Codex'],['Reviews','two']],'no tokens');
  assert.deepEqual(bare.mid.steps[0],{sign:'●',tone:'run',text:'In dev · Dev 1',sub:'running'},'no time: what the timeline says');
  assert.deepEqual(bare.chips[0],{text:'In dev',tone:'run'});
  assert.equal(strip(m,{span:'12 min'}).mid.steps[0].sub,'12 min','the time its terminal has run, for the step the dev runs');
  assert.deepEqual(strip(m,{story:{tokens:{tickets:{'PRB-146':{in:490000}}}}}).facts.slice(3),[['Tokens in','490k']]);
  // A ticket whose difficulty is not known says neither how many reviews it needs.
  const plain={...m,plan:null,tickets:m.tickets.map(t=>({...t,level:undefined}))};
  assert.deepEqual(strip(plain).facts,[['Dev','Dev 1'],['Reviewer','Codex']]);assert.equal(strip(plain).text,'');
});

test('each step takes the time the engine gives for it, on its own delivery; a ticket stopped or waited for says so (screens 12, 16, 18)',()=>{
  // The delivery each review and fix belongs to, as the engine names it (decision 90).
  const c1={commit:'c1',delivered:'2026-11-12T10:00:00Z'};
  const fixing=mission('building',{...AT_08,'PRB-146':'fix'});fixing.tickets[4].rounds=1;
  const reports=[{kind:'dev',ticket:'PRB-146',commit:'c1',at:'2026-11-12T10:00:00Z',summary:''},{kind:'review-1',ticket:'PRB-146',verdict:'changes_requested',commit:'c1',at:'2026-11-12T10:10:00Z',summary:''}];
  const s16=strip(fixing,{reports,span:'6 min',story:{timings:{'PRB-146':[{step:'dev',minutes:38},{step:'review-1',minutes:6,...c1},{step:'fix',minutes:12,...c1}]}}});
  assert.deepEqual(s16.mid.steps.map(s=>[s.sign,s.text,s.sub]),[['✓','In dev · Dev 1','38 min'],['✗','Review 1 · changes requested','6 min'],['●','Fixing · Dev 1','12 min'],['·','Review 1','up next'],['·','Review 2','up next']]);
  assert.deepEqual(s16.chips.map(c=>c.text),['Fixing · round 2','Heavy']);
  assert.equal(strip(fixing,{reports,span:'6 min'}).mid.steps[2].sub,'6 min');
  // Stopped: the band turns red, and its chip says for how long it has been stopped (since its request, made at 10:01).
  const stuck=mission('building',{'PRB-142':'accepted','PRB-144':'accepted','PRB-149':'dev'}),s12=strip(stuck,{items:[ask('i1',{type:'stuck',ticket:'PRB-149',priority:1})],story:{timings:{'PRB-149':[{step:'dev',minutes:22}]}},now:Date.parse('2026-11-12T10:23:00Z')});
  assert.deepEqual([s12.tone,s12.kicker,s12.chips],['bad','Current ticket · PRB-149 · 3 of 9',[{text:'Blocked · 22 min',tone:'bad'}]]);
  assert.deepEqual(s12.mid.steps,[{sign:'●',tone:'bad',text:'In dev · Dev 1',sub:'22 min'},{sign:'·',tone:null,text:'Review',sub:'up next'}]);
  // A review that leaves its verdict to the user.
  const call=mission('building',{...ALL,'PRB-150':'review','PRB-151':'todo','PRB-148':'todo'}),devOf=[{kind:'dev',ticket:'PRB-150',commit:'c1',at:'2026-11-12T10:00:00Z',summary:''}];
  const s18=strip(call,{reports:devOf,items:[ask('i1',{ticket:'PRB-150',kind:'verdict'})],story:{timings:{'PRB-150':[{step:'dev',minutes:29},{step:'review-1',minutes:5,...c1}]}}});
  assert.deepEqual([s18.tone,s18.chips],['you',[{text:'Waiting on you · verdict',tone:'you'}]]);
  assert.deepEqual(s18.mid.steps.map(s=>[s.sign,s.tone,s.text,s.sub]),[['✓','ok','In dev · Dev 1','29 min'],['◆','you','Review · your call','5 min']]);
  assert.deepEqual(strip(call,{reports:devOf,items:[ask('i1',{ticket:'PRB-150',from:'dev'})]}).mid.steps.map(s=>s.sign),['✓','R'],'a question of the dev, that is not a verdict, leaves the review running');
  // The details of the ticket keep the shape of their steps.
  const detail=lineDetail({mission:call,tickets:lineTickets(call),id:'PRB-150',reports:devOf,items:[ask('i1',{ticket:'PRB-150',kind:'verdict'})]});
  assert.deepEqual(detail.timeline.steps.map(s=>Object.keys(s).sort()),[['sign','sub','text','tone'],['sign','sub','text','tone']]);
  assert.equal(detail.timeline.steps[1].text,'Review · your call');
});

test('between two tickets the band of Develop goes back to the approach of the Lead; all accepted, it tells the QA that starts (screen 21)',()=>{
  const between=strip(mission('building',{'PRB-142':'accepted'},{approach:APPROACH}),{lead:IDLE});
  assert.equal(between.kicker,"Lead's approach");assert.equal(between.mid.steps[3].sub,'2 tickets');
  const flows={total:38,played:0,passed:34,forYou:4,videos:38,minutes:12,problems:0},s=strip(mission('qa',ALL),{story:{flows}});
  assert.deepEqual([s.tone,s.kicker,s.title,s.text,s.button],['run','QA · automatic, recorded','QA is starting','You only test what QA cannot judge: look, feel, and what it could not play. Everything else stays one click away.',null]);
  assert.deepEqual([s.mid.title,s.mid.bar.length,s.mid.steps.map(x=>[x.sign,x.text,x.sub])],['38 flows',38,[['◆','For you','4']]]);
  assert.deepEqual(s.facts,[['Your time','about 12 min'],['Problems','0']]);
  const bare=strip(mission('building',ALL));
  assert.deepEqual([bare.title,bare.mid,bare.facts],['QA is starting',null,[]],'the engine of today gives no flow: no count is drawn');
  assert.equal(strip(mission('building',ALL)).title,'QA is starting');
  assert.equal(strip(mission('qa',ALL,{simple:true}),{story:{flows}}),null,'a single ticket has no QA agent');
});

test('a single ticket has its path in Prepare, and is not said « of 1 » in Develop (screens 37 and 38)',()=>{
  const one=(step,state)=>mission(step,{'PRB-142':state},{simple:true,points:3,migrations:[],phases:[]},['PRB-142']),ready=strip(one('analysing','todo'),{lead:IDLE});
  assert.deepEqual([ready.kicker,ready.title,ready.text,ready.button],['The ticket · PRB-142','Titre PRB-142','Expected: Résultat PRB-142',null]);
  assert.deepEqual([ready.mid.title,ready.mid.steps.map(s=>[s.sign,s.text,s.sub])],['Path',[['1','Dev','Dev 1'],['2','One review','Codex'],['3','Your check','3 points'],['4','Close','']]]);
  assert.deepEqual(ready.facts,[['Migration','none'],['Copy to write','none'],['QA agent','not needed']]);
  const unknown=strip(mission('analysing',{},{simple:true,phases:[]},['PRB-142']),{lead:IDLE});
  assert.deepEqual(unknown.facts,[['Copy to write','none'],['QA agent','not needed']],'migrations the plan does not tell are not said none');
  assert.equal(unknown.mid.steps[2].sub,'');
  const dev=strip(one('building','dev'),{span:'12 min'});
  assert.deepEqual([dev.kicker,dev.chips,dev.facts.slice(0,3)],['The ticket · PRB-142',[{text:'In dev · 12 min',tone:'run'}],[['Dev','Dev 1'],['Reviewer','Codex'],['Reviews','one']]]);
});

test('« Your decisions » lists what waits only when several things wait; with one, the banner carries it',()=>{
  const m=mission('analysing'),story={decisions:DECISIONS},left=items=>pageBlocks({mission:m,lead:IDLE,items,story})[0];
  const none=left([]);
  assert.deepEqual([none.title,none.count,none.countTone,none.tone],['Your decisions','2',null,null]);
  assert.deepEqual(texts(none),[['✓','Nothing is waiting on you','',''],['✓','Recherche par fenêtres','','non, ticket de suite'],['✓','Collations','','à part, en 0026']]);
  assert.deepEqual([none.rows[0].look,none.rows[0].open,none.rows[1].open],['calm',null,{t:'decision',id:'q1'}]);
  const one=left([ask('i1',{short:'Recherche ?'})]);
  assert.deepEqual([one.title,one.count,texts(one).map(r=>r[1])],['Your decisions','2',['Recherche par fenêtres','Collations']],'one thing waits: neither listed, nor said that nothing waits');
  const two=left([ask('i1',{short:'Recherche par fenêtres ?'}),ask('i2',{short:'Fusionner PRB-151 dans PRB-147 ?',kind:'suggestion'})]);
  assert.deepEqual([two.title,two.count,two.countTone,two.tone],['Waiting on you','2','you','you']);
  assert.deepEqual(texts(two).slice(0,2),[['?','Recherche par fenêtres ?','question from the Lead','Answer'],['→','Fusionner PRB-151 dans PRB-147 ?','suggestion from the Lead','Answer']]);
  assert.deepEqual([two.rows[0].look,two.rows[0].act.key,two.rows[0].act.item.id,two.rows.length],['you','answer','i1',4]);
  // A ticket stopped is the business of the Lead: it is not counted among what waits for the user.
  const stuck=left([ask('i1',{type:'stuck',priority:1}),ask('i2')]);
  assert.deepEqual([stuck.title,texts(stuck).map(r=>r[1])],['Your decisions',['Recherche par fenêtres','Collations']]);
  assert.equal(left([ask('i1',{type:'stuck'})]).rows[0].text,'Nothing is waiting on you');
  // A request of another development, or one already answered, is not counted; a row falls back on the full question.
  assert.equal(left([ask('i1',{mission:'M-2'}),ask('i2',{state:'answered'})]).title,'Your decisions');
  const dev=left([ask('i1',{from:'dev',kind:'copy'}),ask('i2',{type:'authorization',from:'dev'})]);
  assert.deepEqual(texts(dev).slice(0,2),[['?','Question i1','copy choice from Dev 1','Answer'],['?','Question i2','permission request from Dev 1','Answer']]);
  // No decision taken: no counter.
  assert.deepEqual([pageBlocks({mission:m,lead:IDLE})[0].count,texts(pageBlocks({mission:m,lead:IDLE})[0])],['',[['✓','Nothing is waiting on you','','']]]);
});

test('« Issue coverage » counts the requests covered and says why each other one is not (screens 01, 02, 04)',()=>{
  const m=mission('analysing',{},{requests:REQUESTS}),story={issue:{goal:'Le but.'}},mid=pageBlocks({mission:m,lead:IDLE,story})[1];
  assert.deepEqual([mid.title,mid.count,mid.countTone,mid.link.label,mid.link.open],['Issue coverage','1 of 3','you','Read the issue ›',{t:'issue',id:null}]);
  assert.deepEqual(texts(mid),[['◆','Guide à jour','','not covered'],['◆','Recherche par fenêtres','postponed by you on Nov 12 · follow-up ticket','not covered'],['✓','Mesure rejouable','','142 · 148']]);
  assert.deepEqual([mid.rows[0].look,mid.rows[2].small,mid.rows[2].rightMono,mid.rows[2].open],['you',true,true,{t:'request',id:'d1'}]);
  // While the Lead works, a request with no ticket yet is waited for, not refused; asked to the user, it says so.
  const working=pageBlocks({mission:m,lead:WORKING,story})[1];
  assert.deepEqual(texts(working)[0],['…','Guide à jour','','no ticket yet']);assert.equal(working.rows[0].signTone,'wait');
  const asked=pageBlocks({mission:mission('analysing',{},{requests:[{...REQUESTS[2],state:'asked'}]}),lead:IDLE})[1];
  assert.deepEqual([texts(asked)[0],asked.link],[['◆','Recherche par fenêtres','the Lead asks you the question','not covered'],null],'the issue is not given: no link to read it');
  const full=pageBlocks({mission:mission('analysing',{},{requests:[REQUESTS[0]],simple:true}),lead:IDLE,story})[1];
  assert.deepEqual([full.count,full.countTone,full.link],['1 of 1',null,null],'a single ticket has no link to its issue (screen 37)');
  const bare=pageBlocks({mission:mission('analysing'),lead:IDLE})[1];
  assert.deepEqual([bare.title,bare.count,bare.rows],['Issue coverage','',[]],'the engine of today names no request: the block says nothing');
  assert.deepEqual(coverageOf(m,IDLE).list.map(r=>r.state),['open','postponed','covered']);
});

test('« Drift from approved plan » says a drift, or its absence, only when the engine tells it (screens 08 and 18)',()=>{
  const m=mission('building',AT_08,{requests:REQUESTS}),approval={at:at(2026,10,12,15,2)},mid=story=>pageBlocks({mission:m,story})[1];
  const none=mid({drift:[],approval});
  assert.deepEqual([none.title,none.count],['Drift from approved plan','']);
  assert.deepEqual(texts(none),[['✓','No drift from the approved plan','',''],['❏','Frozen copy','plan approved on Nov 12 at 3:02 pm','›'],['◆','Issue coverage','1 of 3 requests · 1 postponed','›']]);
  assert.deepEqual([none.rows[0].look,none.rows[1].open,none.rows[2].open],['calm',{t:'frozen',id:null},{t:'list',id:'coverage'}]);
  const one=mid({drift:[{ticket:'PRB-147',summary:'child windows: 100 → 50 · accepted by you'}],approval});
  assert.deepEqual([one.count,one.countTone,texts(one)[0],one.rows[0].open],['1','you',['≠','PRB-147 changed','child windows: 100 → 50 · accepted by you','›'],{t:'list',id:'drift'}]);
  assert.deepEqual(mid(null).rows.map(r=>r.text),['Issue coverage'],'no drift told, no approval told: neither is said');
  assert.deepEqual(pageBlocks({mission:mission('building',AT_08)})[1].rows,[]);
  const covered=pageBlocks({mission:mission('building',AT_08,{requests:[REQUESTS[0]]})})[1].rows[0];
  assert.deepEqual([covered.sign,covered.signTone,covered.sub],['✓','ok','1 of 1 request']);
});

test('« To plan for » draws a row for what is known, and fades a list known to be empty (screens 04, 07, 37)',()=>{
  const m=mission('analysing',{},{toPlan:TO_PLAN}),right=pageBlocks({mission:m,lead:IDLE,story:{environment:ENV_OK}})[2];
  assert.equal(right.title,'To plan for');
  assert.deepEqual(texts(right),[['✓','Environment','server, accounts, migrations: ready','›'],['2','Your manual steps','0025 then 0026 · DEV, then target','›'],['1','Risks','collations, drops','›'],['1','Copy to write','guide /aide · PRB-151','›'],['0','Mockups','none for this issue','›'],['2','Test accounts','admin, plain member','›']]);
  assert.deepEqual(right.rows.map(r=>[r.look,r.open.id]),[['','env'],['','manual'],['','risks'],['','copy'],['zero','mockups'],['','accounts']]);
  const failed=pageBlocks({mission:m,lead:IDLE,story:{environment:ENV_KO}})[2].rows[0];
  assert.deepEqual([failed.sign,failed.signTone,failed.look,failed.sub],['!','bad','bad','the server does not start · start held']);
  // The engine of today: the copy to write and the mockups of the plan, nothing else.
  assert.deepEqual(texts(pageBlocks({mission:mission('analysing'),lead:IDLE})[2]),[['1','Copy to write','guide /aide · PRB-151','›'],['0','Mockups','none for this issue','›']]);
  assert.deepEqual(pageBlocks({mission:{id:'M-1',step:'analysing',tickets:[]},lead:IDLE})[2].rows,[]);
  const empty=pageBlocks({mission:mission('analysing',{},{toPlan:{manual:{items:[]},risks:{items:[]}}},['PRB-142']),lead:IDLE})[2];
  assert.deepEqual(texts(empty).slice(0,3),[['0','Your manual steps','no migration','›'],['0','Risks','none flagged','›'],['0','Copy to write','none','›']]);
  assert.deepEqual(empty.rows.map(r=>r.look),['zero','zero','zero','zero']);
  // A variant of copy chosen by the user is said on its row (screen 21), and a mockup of the plan is counted.
  const chosen=pageBlocks({mission:mission('building',AT_08),story:{decisions:[{id:'tx',kind:'copy',short:'Texte du guide',said:'variant B',ticket:'PRB-151',variant:'B'}]}})[2];
  assert.equal(chosen.rows[0].sub,'guide /aide · variant B chosen');
  const shots=mission('analysing');shots.plan.tickets[0].mockups=[{title:'Écran de mesure'}];
  assert.deepEqual(texts(pageBlocks({mission:shots,lead:IDLE})[2])[1],['1','Mockups','','›']);
});

test('the row whose sheet is open is marked, and the blocks of Develop stay while the QA starts',()=>{
  const m=mission('analysing',{},{requests:REQUESTS,toPlan:TO_PLAN}),story={decisions:DECISIONS},marked=open=>pageBlocks({mission:m,lead:IDLE,story,open}).flatMap(b=>b.rows).filter(r=>r.selected).map(r=>r.key);
  assert.deepEqual(marked(null),[]);assert.deepEqual(marked({t:'decision',id:'r1'}),['decision:r1']);assert.deepEqual(marked({t:'request',id:'d7'}),['request:d7']);assert.deepEqual(marked({t:'list',id:'risks'}),['risks']);
  assert.deepEqual(pageBlocks({mission:mission('qa',ALL),story:{drift:[],flows:{total:38,played:0}}}).map(b=>b.title),['Your decisions','Drift from approved plan','To plan for']);
});

test('a row or a link opens its sheet in the column on the right: the approach, the frozen copy, the issue (decision 40)',()=>{
  const m=mission('analysing',{},{approach:APPROACH,migrations:['0025','0026'],toPlan:TO_PLAN}),tickets=lineTickets(m),sheet=(open,more={})=>pageSheet({mission:m,tickets,lead:IDLE,open,...more});
  assert.equal(sheet(null),null);
  const approach=sheet({t:'approach'});
  assert.equal(approach.kicker,"Lead's approach");
  assert.deepEqual(approach.parts,[{kind:'text',text:'Premier paragraphe.',dim:false,small:false},{kind:'text',text:'Second paragraphe.',dim:false,small:false},{kind:'label',text:'Execution mode'},{kind:'box',text:'One ticket at a time on branch prb-41. Nothing runs in parallel.'},
    {kind:'pairs',rows:[['Tickets','9 tickets'],['Devs','Dev 1 (Claude Code · opus 5.5)'],['Heavy tickets','2, tests first and two reviews'],['Migrations','0025, then 0026']]}]);
  assert.equal(pageSheet({mission:m,tickets,lead:WORKING,open:{t:'approach'}}).parts.at(-1).rows[0][1],'9 tickets written');
  assert.equal(pageSheet({mission:mission('analysing'),tickets,open:{t:'approach'}}),null,'no approach to read');
  const frozen=sheet({t:'frozen'},{story:{approval:{at:at(2026,10,12,15,2),tickets:9,branch:'prb-41',openQuestions:0,manual:{summary:'0025 then 0026 · DEV, then target',count:2}}}});
  assert.equal(frozen.kicker,'Frozen copy');
  assert.deepEqual(frozen.parts.map(p=>p.kind),['title','text','label','pairs']);
  assert.equal(frozen.parts[0].text,'Plan approved on Nov 12 at 3:02 pm');
  assert.deepEqual(frozen.parts[3].rows,[['Tickets','9 tickets, one at a time on prb-41'],['Questions','all settled'],['Your steps','0025 then 0026 · DEV, then target']]);
  assert.equal(sheet({t:'frozen'}),null,'not approved yet');
  const issue=sheet({t:'issue'},{story:{issue:{goal:'Le but.',audience:'Pour qui.',inScope:['Dedans'],outOfScope:['Dehors'],criteria:['Critère 1','Critère 2'],decisions:[{at:'2026-11-10',text:'Décidé.'}]}}});
  assert.equal(issue.kicker,'The issue · PRB-41');
  assert.deepEqual(issue.parts.map(p=>p.kind),['link','label','text','label','text','label','bullets','label','bullets','label','bullets','label','rows']);
  assert.deepEqual([issue.parts[0],issue.parts[10],issue.parts[12]],[{kind:'link',label:'Open the issue in tracker ›',act:{key:'url',url:'https://tracker.invalid/PRB-41'}},{kind:'bullets',items:['Critère 1','Critère 2'],ordered:true},{kind:'rows',rows:[{at:'Nov 10',text:'Décidé.'}]}]);
  assert.equal(sheet({t:'issue'}),null);
});

test('a decision taken, a request of the issue and each list to plan for open as the mockup words them',()=>{
  const m=mission('building',AT_08,{requests:REQUESTS,toPlan:TO_PLAN}),tickets=lineTickets(m),approval={at:at(2026,10,12,15,2)};
  const sheet=(open,story={})=>pageSheet({mission:m,tickets,open,story}),kinds=s=>s.parts.map(p=>p.kind);
  const taken=sheet({t:'decision',id:'r1'},{decisions:DECISIONS});
  assert.equal(taken.kicker,'Question · settled');
  assert.deepEqual(taken.parts,[{kind:'title',text:'Collations : dans 0025, ou à part ?'},{kind:'label',text:'Your answer · Nov 11, 5:32 pm'},{kind:'box',text:'À part, en 0026.'},{kind:'label',text:'What it changed'},{kind:'text',text:'Ticket PRB-149 added.',dim:false,small:false},
    {kind:'label',text:'History'},{kind:'rows',rows:[{at:'Nov 11 17:28',text:'Lead : à part.'}],wide:true}]);
  assert.equal(sheet({t:'decision',id:'zz'},{decisions:DECISIONS}),null);
  assert.equal(sheet({t:'decision',id:'q1'},{decisions:[{...DECISIONS[0],at:undefined,kind:'verdict'}]}).parts[1].text,'Your answer','a date that is not known is not said');
  assert.equal(sheet({t:'decision',id:'q1'},{decisions:[{...DECISIONS[0],kind:'verdict'}]}).kicker,'Verdict · settled');
  const covered=sheet({t:'request',id:'d1'});
  assert.deepEqual([covered.kicker,covered.foot,covered.covers],['Request from the issue','The tickets that cover it are outlined in the plan.',['PRB-142','PRB-148']]);
  assert.deepEqual(covered.parts,[{kind:'title',text:'La mesure est rejouable.'},{kind:'chips',chips:[{text:'covered by 2 tickets',tone:null}]},{kind:'label',text:'Tickets that cover it'},{kind:'tickets',ids:['PRB-142','PRB-148']}]);
  const postponed=sheet({t:'request',id:'d7'});
  assert.deepEqual([postponed.parts[1].chips,postponed.parts[2].text,postponed.parts[3],postponed.foot,postponed.covers],[[{text:'not covered, postponed',tone:'you'}],'No ticket',{kind:'text',text:'Reportée.',dim:true,small:true},'',[]]);
  const env=sheet({t:'list',id:'env'},{environment:{...ENV_KO,recheck:true}});
  assert.deepEqual([env.kicker,kinds(env),env.parts[0].text,env.parts[1].text],['Environment check',['title','text','items','action','text'],'The server does not start','Starting is held until this is cleared.']);
  assert.deepEqual([env.parts[2].items.map(i=>[i.sign,i.tone,i.title,i.sub]),env.parts[3]],[[['!','bad','The server starts','failed: port taken'],['✓','ok','The test accounts exist','2 accounts']],{kind:'action',label:'Run the check again',act:{key:'env-check'}}]);
  const ready=sheet({t:'list',id:'env'},{environment:ENV_OK});
  assert.deepEqual([kinds(ready),ready.parts[0].text],[['title','text','items'],'Everything is ready to start']);
  const manual=sheet({t:'list',id:'manual'});
  assert.deepEqual([manual.kicker,manual.parts[0].text,manual.parts[1].text,manual.parts[2].items.map(i=>[i.sign,i.title,i.sub,i.tickets]),manual.parts[3].text],
    ['To plan for','Your manual steps, outside the app','In this order, once the tickets are merged.',[['1','Migrations sur DEV','après la fusion',['PRB-144']],['2','Migrations sur la cible','',[]]],'Rien d\'autre.']);
  assert.deepEqual(sheet({t:'list',id:'risks'}).parts[2].items.map(i=>[i.sign,i.title]),[['▲','Les collations changent l\'ordre']]);
  const copy=sheet({t:'list',id:'copy'});
  assert.deepEqual([copy.parts[1].text,copy.parts[2].items],['The dev will propose variants during the ticket; you choose from the banner.',[{sign:'T',tone:null,title:'guide /aide',sub:'',tickets:['PRB-151']}]]);
  assert.deepEqual(sheet({t:'list',id:'copy'},{decisions:[{id:'tx',kind:'copy',short:'Texte',ticket:'PRB-151',variant:'B'}]}).parts[2].items[0],{sign:'T',tone:'ok',title:'guide /aide',sub:'chosen: variant B',tickets:['PRB-151']});
  assert.deepEqual(sheet({t:'list',id:'mockups'}).parts.map(p=>p.text),['Mockups','No mockup for this issue: it creates no new screen.']);
  const accounts=sheet({t:'list',id:'accounts'});
  assert.deepEqual([accounts.parts[0].text,accounts.parts[1].text,accounts.parts[2].items.length,accounts.parts[3].text],['Test accounts for your sign-off test','Checked by the environment check.',2,'No password here: the QA assistant opens the app with the right account.']);
  const coverage=sheet({t:'list',id:'coverage'},{approval:{...approval,coverage:[{id:'d1',state:'covered',tickets:['PRB-142','PRB-148']},{id:'d6',state:'open',tickets:[]},{id:'d7',state:'postponed',tickets:[]}]}});
  assert.deepEqual([coverage.kicker,coverage.parts[0].text,coverage.parts[1].text,coverage.parts[2].items.map(i=>[i.sign,i.title,i.sub])],['Issue coverage','1 of 3 requests covered','Unchanged since approval.',[['◆','Guide à jour','not covered'],['◆','Recherche par fenêtres','not covered, postponed'],['✓','Mesure rejouable','']]]);
  const drift=sheet({t:'list',id:'drift'},{approval,drift:[{ticket:'PRB-147',summary:'child windows: 100 → 50',title:'PRB-147: child windows go from 100 to 50',reason:'Reason: too slow.'}]});
  assert.deepEqual([drift.kicker,drift.parts[0].text,drift.parts[1].text,drift.parts[2].items,drift.parts[3].text],['Drift from approved plan','1 ticket changed since approval','Changes since your approval on Nov 12.',
    // No « Reason… » line, even given (decision 82: the engine does not know the reason; nothing is made up).
    [{sign:'≠',tone:'you',title:'PRB-147: child windows go from 100 to 50',sub:'',tickets:['PRB-147']}],'A ticket added or postponed would show up here the same way, and on its card.']);
  // A sheet whose data is gone closes instead of showing an empty frame.
  for(const id of ['env','drift','zz'])assert.equal(sheet({t:'list',id}),null,id);
  assert.equal(pageSheet({mission:mission('building',AT_08),tickets,open:{t:'list',id:'manual'}}),null);
});

test('dates, times and tokens read as on the mockup, at the hour of the reader',()=>{
  const moment=at(2026,10,12,15,2);
  assert.deepEqual([dayOf(moment),dayAt(moment),dayClock(at(2026,10,12,14,46)),dayHour(at(2026,10,11,17,28)),dayOf('2026-11-10')],['Nov 12','Nov 12 at 3:02 pm','Nov 12, 2:46 pm','Nov 11 17:28','Nov 10']);
  assert.deepEqual([dayAt(at(2026,0,5,0,7)),dayAt(at(2026,0,5,12,0))],['Jan 5 at 12:07 am','Jan 5 at 12:00 pm']);
  assert.deepEqual([dayOf(null),dayAt('hier'),dayClock(undefined),dayHour('')],['','','','']);
  assert.deepEqual([38,6,124,60,-1,NaN].map(minutesText),['38 min','6 min','2 h 04','1 h 00','','']);
  assert.deepEqual([490000,38000,2100000,1000000,9000,NaN].map(tokensText),['490k','38k','2.1M','1M','9k','']);
});

test('the page draws the band under the line, the three blocks and the sheet, and opens them one in place of the other',async()=>{
  const main=await readFile(new URL('../mods/fabrique-console-v4-ticket/main.js',import.meta.url),'utf8');
  assert.match(main,/left\(0\)\.right\(0\)\.top\(LINE\.band\)\.h\(LINE\.host-LINE\.band\)/,'the band takes the room kept under the row of the tickets');
  assert.match(main,/const BLOCKS=\[322,388,310\]|BLOCKS=\[322,388,310\]/,'the three blocks keep the widths of the mockup');
  assert.match(main,/pick\(id,cx\) \{\n\s+this\.sel=id;this\.open=null;/,'a ticket chosen closes the sheet');
  assert.match(main,/show\(open,cx\) \{\n\s+this\.open=open;this\.sel=null;/,'a sheet opened closes the details of a ticket');
  assert.match(main,/detail\?this\.detail\(m,tickets,detail\):answer\?this\.request\(m,asks,answer\):sheet\?this\.sheet\(m,sheet\):summary\?this\.summary\(m,summary\):this\.side\(/,'« Right now » comes back when the details, a request and a sheet are closed');
  assert.match(main,/if\(a\.key==='answer'\)return this\.show\(\{t:'ask',id:a\.item\.id\},cx\);/,'a row that waits for an answer opens the request in the column, as the banner does');
});

// ---- After the review of this screen (workflow-v2-ecran-blocs-revue.md).
const COVERED=[{id:'d1',state:'covered',tickets:['PRB-142','PRB-148']},{id:'d6',state:'open',tickets:[]},{id:'d7',state:'postponed',tickets:[]}];
const APPROVAL={at:at(2026,10,12,15,2),tickets:9,branch:'prb-41',openQuestions:0,manual:{summary:'0025 then 0026 · DEV, then target',count:2},coverage:COVERED};
test('the frozen copy is what was approved: the plan of today never changes it',()=>{
  const want=[['Tickets','9 tickets, one at a time on prb-41'],['Questions','all settled'],['Your steps','0025 then 0026 · DEV, then target']];
  const rows=(m,approval=APPROVAL)=>pageSheet({mission:m,tickets:lineTickets(m),open:{t:'frozen'},story:{approval}}).parts.find(p=>p.kind==='pairs').rows;
  const m=mission('building',AT_08,{requests:REQUESTS,toPlan:TO_PLAN});
  assert.deepEqual(rows(m),want);
  // The plan moves after the approval: another branch, other manual steps, a ticket less. The copy says what it said.
  const moved=mission('building',AT_08,{requests:REQUESTS,toPlan:{...TO_PLAN,manual:{summary:'0027 only',items:[{title:'Autre',detail:'',tickets:[]}]}}},IDS.slice(0,8));moved.branch='prb-41-bis';
  assert.deepEqual(rows(moved),want);
  assert.deepEqual(rows(mission('building',AT_08)),want,'a plan that names no manual step any more');
  // What the approval does not carry is not said: neither read in the plan of today, nor affirmed.
  assert.deepEqual(rows(m,{at:APPROVAL.at}),[]);
  assert.deepEqual(rows(m,{...APPROVAL,openQuestions:undefined}).map(r=>r[0]),['Tickets','Your steps'],'« all settled » is a fact of the approval, not a constant');
  assert.deepEqual(rows(m,{...APPROVAL,openQuestions:1}).map(r=>r[0]),['Tickets','Your steps']);
  assert.deepEqual(rows(m,{...APPROVAL,manual:{summary:'',count:0}})[2],['Your steps','no migration']);
  assert.deepEqual(rows(m,{...APPROVAL,tickets:1,simple:true,branch:''})[0],['Tickets','a single ticket, one at a time']);
});
test('« Unchanged since approval » is said only when the coverage approved and the coverage of today were compared and are the same',()=>{
  const m=mission('building',AT_08,{requests:REQUESTS}),said=(mm,approval)=>pageSheet({mission:mm,tickets:lineTickets(mm),open:{t:'list',id:'coverage'},story:{approval}}).parts.map(p=>p.text||'').includes('Unchanged since approval.');
  assert.equal(said(m,APPROVAL),true);
  assert.equal(said(m,{at:APPROVAL.at}),false,'no coverage in the approval: nothing to compare, nothing affirmed');
  const more=mission('building',AT_08,{requests:REQUESTS.map(r=>r.id==='d6'?{...r,tickets:['PRB-151']}:r)});
  assert.equal(said(more,APPROVAL),false,'a request covered since');
  const less=mission('building',AT_08,{requests:REQUESTS.map(r=>r.id==='d1'?{...r,tickets:['PRB-142']}:r)});
  assert.equal(said(less,APPROVAL),false,'a ticket less on a request');
  assert.equal(said(mission('building',AT_08,{requests:REQUESTS.slice(0,2)}),APPROVAL),false,'a request gone');
  assert.equal(said(m,{...APPROVAL,coverage:[...COVERED].reverse()}),true,'the order does not count');
});
test('the copy chosen last is the one said: an older choice never overwrites a newer one',()=>{
  const m=mission('building',AT_08),choice=(id,variant,when)=>({id,kind:'copy',short:'Texte du guide',said:'variant '+variant,ticket:'PRB-151',variant,...(when?{at:when}:{})});
  const sub=decisions=>pageBlocks({mission:m,story:{decisions}})[2].rows[0].sub,chosen=decisions=>pageSheet({mission:m,tickets:lineTickets(m),open:{t:'list',id:'copy'},story:{decisions}}).parts[2].items[0].sub;
  // The engine gives the newest first.
  assert.equal(sub([choice('t2','C'),choice('t1','A')]),'guide /aide · variant C chosen');
  assert.equal(chosen([choice('t2','C'),choice('t1','A')]),'chosen: variant C');
  // Their instants say it whatever the order.
  assert.equal(sub([choice('t1','A',at(2026,10,12,9,0)),choice('t2','C',at(2026,10,12,11,0))]),'guide /aide · variant C chosen');
  assert.equal(sub([choice('t2','C',at(2026,10,12,11,0)),choice('t1','A',at(2026,10,12,9,0))]),'guide /aide · variant C chosen');
});
test('the chip of the band and its step tell one time: the one the engine gives for the step, else the one of the terminal',()=>{
  const m=mission('building',AT_08),times=story=>{const s=strip(m,{span:'38 min',story});return [s.chips[0].text,s.mid.steps[0].sub];};
  assert.deepEqual(times({timings:{'PRB-146':[{step:'dev',minutes:12}]}}),['In dev · 12 min','12 min'],'screen 38: the terminal of a state before said 38 min');
  assert.deepEqual(times({}),['In dev · 38 min','38 min']);
  assert.deepEqual([handSpan({ticket:m.tickets[4],story:{timings:{'PRB-146':[{step:'dev',minutes:12}]}},span:'38 min'}),handSpan({ticket:m.tickets[4],story:{},span:'38 min'}),handSpan({ticket:null,story:{},span:'38 min'})],['12 min','38 min','38 min']);
  const fixing={...m.tickets[4],state:'fix'};
  assert.equal(handSpan({ticket:fixing,story:{timings:{'PRB-146':[{step:'dev',minutes:12}]}},span:'6 min'}),'6 min','the time of the dev step is not the time of the fix');
});
test('a date is said as the mockup says it when its instant is given: « just now », « this morning », else the day and the hour',()=>{
  const now=new Date(2026,10,13,16,30).getTime(),d=(when)=>({...DECISIONS[0],at:when}),label=(when,kind='question')=>pageSheet({mission:mission('building',AT_08),tickets:[],open:{t:'decision',id:'q1'},story:{decisions:[{...d(when),kind}]},now}).parts[1].text;
  assert.equal(label(new Date(2026,10,13,16,28).toISOString()),'Your answer · just now');
  assert.equal(label(new Date(2026,10,13,6,52).toISOString()),'Your answer · this morning');
  assert.equal(label(new Date(2026,10,13,13,5).toISOString()),'Your answer · Nov 13, 1:05 pm','no word of the mockup for the afternoon: the day and the hour');
  assert.equal(label(new Date(2026,10,12,9,0).toISOString()),'Your answer · Nov 12, 9:00 am','the morning of another day');
  assert.equal(label(new Date(2026,10,13,16,40).toISOString()),'Your answer · Nov 13, 4:40 pm','an instant to come is not « just now »');
  assert.equal(label(undefined),'Your answer','no instant: no date, never an hour made up');
  assert.deepEqual([whenOf(null,now),whenOf('hier',now)],['','']);
});
test('« Run the check again » is offered only when the engine says the check can be run again',()=>{
  const m=mission('analysing'),kinds=environment=>pageSheet({mission:m,tickets:[],open:{t:'list',id:'env'},story:{environment}}).parts.map(p=>p.kind);
  assert.deepEqual(kinds({...ENV_KO,recheck:true}),['title','text','items','action','text']);
  assert.deepEqual(kinds(ENV_KO),['title','text','items','text'],'a check received does not prove it can be run again');
  assert.deepEqual(kinds({...ENV_OK,recheck:true}),['title','text','items'],'nothing to run again when all is ready');
});
test('« QA is starting » is never a lasting state: it is said while the tickets are all accepted, then only while the engine says the QA has played nothing',()=>{
  assert.equal(pageMoment(mission('qa',ALL),{flows:{total:38,played:0}}),'starting');
  assert.equal(pageMoment(mission('qa',ALL),{}),null,'the QA runs and the engine tells nothing of its flows: not said starting');
  assert.equal(pageMoment(mission('qa',ALL),null),null);
  assert.equal(strip(mission('qa',ALL)),null);assert.equal(pageBlocks({mission:mission('qa',ALL)}),null);
  assert.equal(pageMoment(mission('building',ALL)),'starting','all accepted, the step has not moved yet');
});
test('what the QA has not played yet is not counted as passed, nor as videos (screen 21, gap with the mockup to be validated by the user)',()=>{
  const flows={total:38,played:0,passed:34,forYou:4,videos:38,minutes:12,problems:0},s=strip(mission('qa',ALL),{story:{flows}});
  assert.deepEqual([s.mid.title,s.mid.bar.length,s.mid.steps.map(x=>[x.sign,x.text,x.sub])],['38 flows',38,[['◆','For you','4']]]);
  assert.deepEqual(s.facts,[['Your time','about 12 min'],['Problems','0']]);
});
test('the band never says Dev 1 for the work of Dev 2: the plan says which dev has a ticket',()=>{
  const m=mission('building',AT_08);m.tickets=m.tickets.map((t,i)=>i<3||i>5?{...t,dev:'codex',model:'gpt-6.1-sol'}:t);
  // Two tools without a word of the plan on its devs are one dev still: the band stays.
  assert.deepEqual(strip(m,{span:'38 min'}).facts[0],['Dev','Dev 1']);
  m.plan.tickets=m.plan.tickets.map((t,i)=>i<3||i>5?t:{...t,dev:2});
  // Two devs in the plan are two lanes (screens 40 and 41): no band is drawn, and the steps of the ticket in hand, told
  // in the column on the right, name the dev that has it.
  const steps=x=>pageCurrent({mission:x,tickets:lineTickets(x),spans:{}})[0].steps[0].text;
  assert.equal(strip(m,{span:'38 min'}),null);
  assert.equal(steps(m),'In dev · Dev 2');
  const first=mission('building',{'PRB-142':'dev'});first.tickets=m.tickets.map((t,i)=>({...t,state:i?'todo':'dev'}));first.plan=m.plan;
  assert.deepEqual([strip(first),steps(first)],[null,'In dev · Dev 1']);
  assert.deepEqual(strip(mission('building',AT_08)).facts[0],['Dev','Dev 1'],'one dev');
});
test('a question of the Lead during a review is said on its step, as on the mockup (screen 17)',()=>{
  const m=mission('building',{...AT_08,'PRB-146':'accepted','PRB-147':'review'}),devOf=[{kind:'dev',ticket:'PRB-147',commit:'c1',at:'2026-11-12T10:00:00Z',summary:''}];
  const steps=items=>strip(m,{reports:devOf,items,story:{timings:{'PRB-147':[{step:'dev',minutes:41}]}}}).mid.steps.map(s=>[s.sign,s.tone,s.text,s.sub]);
  assert.deepEqual(steps([ask('i1',{ticket:'PRB-147'})]),[['✓','ok','In dev · Dev 1','41 min'],['?','you','Review 1 · the Lead asks you a question','waiting for your answer'],['·',null,'Review 2','up next']]);
  assert.deepEqual(steps([ask('i1',{ticket:'PRB-147',from:'dev'})]).map(s=>s[0]),['✓','R','·'],'a question of the dev leaves the review running');
  assert.deepEqual(steps([ask('i1',{ticket:'PRB-146'})]).map(s=>s[0]),['✓','R','·'],'a question about another ticket');
});
test('the three composed texts are those the review recommends, to the letter; no note of the mockup is drawn',async()=>{
  const dev=pageBlocks({mission:mission('analysing'),lead:IDLE,items:[ask('i1',{from:'dev'}),ask('i2',{from:'dev',kind:'copy'}),ask('i3',{type:'authorization',from:'dev'})]})[0].rows.slice(0,3).map(r=>r.sub);
  assert.deepEqual(dev,['question from Dev 1','copy choice from Dev 1','permission request from Dev 1']);
  const undated=pageBlocks({mission:mission('analysing',{},{requests:[{...REQUESTS[2],postponedAt:undefined}]}),lead:IDLE})[1].rows[0].sub;
  assert.equal(undated,'postponed by you · follow-up ticket');
  const m=mission('analysing',{},{approach:APPROACH});m.branch=null;
  assert.equal(pageSheet({mission:m,tickets:lineTickets(m),open:{t:'approach'}}).parts.find(p=>p.kind==='box').text,'One ticket at a time. Nothing runs in parallel.');
  const words=await readFile(new URL('../mods/fabrique-console-v4-ticket/words.js',import.meta.url),'utf8'),main=await readFile(new URL('../mods/fabrique-console-v4-ticket/main.js',import.meta.url),'utf8');
  for(const note of [/placeholder/i,/still to be designed/i,/will mirror the Tracker issue/i])assert.doesNotMatch(words.slice(words.indexOf('toolNames'))+main,note);
});
test('a text too long for its lines is cut on a word and ends with the points of suspension, as on the mockup',()=>{
  assert.equal(clipText('Texte du guide',40),'Texte du guide','a text that fits is left as it is');
  assert.equal(clipText('Backlog : section sans sprint par fenêtres, dépôt placé par le serveur',40),'Backlog : section sans sprint par…');
  assert.equal(clipText('Un mot, puis la suite du texte',7),'Un mot…','no comma nor space before the points');
  assert.equal(clipText('Anticonstitutionnellement long',10),'Anticonsti…','a single word is cut where it must');
  assert.deepEqual([clipText('',10),clipText(null,10),clipText('abc',0)],['','','abc']);
  // The room of the band: its middle keeps the width of the mockup, the left part gives what the menu takes.
  assert.deepEqual([stripRoom(1012),stripRoom(966),stripRoom(700)],[{left:300,title:68,text:139},{left:254,title:56,text:116},{left:220,title:48,text:100}]);
});
test('the band draws its title and its text cut with the points of suspension, and its middle at the width of the mockup',async()=>{
  const main=await readFile(new URL('../mods/fabrique-console-v4-ticket/main.js',import.meta.url),'utf8');
  assert.match(main,/const room=stripRoom\(width\)/);
  assert.match(main,/\.w\(room\.left\)/);
  assert.match(main,/clipText\(s\.title,room\.title\)/);assert.match(main,/clipText\(s\.text,room\.text\)/);
});

// ---- Screen 18: what happened since the last visit, in « Right now » (review of the screen of the answers).
test('« Right now » lists what happened since the last visit, as the mockup writes it, and nothing when the engine gives nothing',async()=>{
  const m=mission('building',{...AT_08,'PRB-146':'accepted','PRB-147':'accepted','PRB-150':'review'}),tickets=lineTickets(m),now=new Date(2026,10,13,8,5).getTime();
  const verdict=ask('i1',{ticket:'PRB-150',kind:'verdict'});
  const overnight={accepted:3,since:at(2026,10,12,19,10),events:[{kind:'verdict',ticket:'PRB-150',at:at(2026,10,13,6,40),note:'the reviewer leaves it to you',item:'i1'},{kind:'accepted',ticket:'PRB-147',at:at(2026,10,13,4,50),note:'two reviews · one drift from the plan'},
    {kind:'accepted',ticket:'PRB-146',at:at(2026,10,13,1,32),note:'one fixing round, two reviews'},{kind:'accepted',ticket:'PRB-145',at:at(2026,10,12,21,14),note:'one review'}]};
  const s=pageSince({overnight,asks:[verdict],tickets,now});
  assert.equal(s.title,'Since yesterday, 7:10 pm');
  assert.deepEqual(s.rows.map(r=>[r.sign,r.tone,r.text,r.sub]),[['◆','you','PRB-150 · verdict to decide','6:40 am · the reviewer leaves it to you'],['✓','','PRB-147 accepted','4:50 am · two reviews · one drift from the plan'],
    ['✓','','PRB-146 accepted','1:32 am · one fixing round, two reviews'],['✓','','PRB-145 accepted','9:14 pm · one review']]);
  // A row is a button: the verdict opens its request where it is answered, an accepted ticket opens its details.
  assert.deepEqual(s.rows.map(r=>[r.act.key,r.act.item?.id||r.act.id]),[['answer','i1'],['ticket','PRB-147'],['ticket','PRB-146'],['ticket','PRB-145']]);
  assert.deepEqual(s.rows.map(r=>r.key),['since-0','since-1','since-2','since-3']);
  // Nothing made up: no list without events, a verdict already given is no longer « to decide », an unknown kind or
  // ticket is not drawn, a line without a note or an hour says what it has.
  for(const none of [null,{},{accepted:3},{accepted:3,since:overnight.since},{since:overnight.since,events:[]},{events:'x'}])assert.equal(pageSince({overnight:none,asks:[verdict],tickets,now}),null,JSON.stringify(none));
  assert.deepEqual(pageSince({overnight,asks:[],tickets,now}).rows.map(r=>r.text),['PRB-147 accepted','PRB-146 accepted','PRB-145 accepted']);
  assert.equal(pageSince({overnight:{events:[{kind:'verdict',ticket:'PRB-150',item:'i1'},{kind:'merged',ticket:'PRB-145'},{kind:'accepted',ticket:'PRB-999'},null]},asks:[],tickets,now}),null);
  const bare=pageSince({overnight:{events:[{kind:'accepted',ticket:'PRB-145'},{kind:'accepted',ticket:'PRB-146',note:'one review'},{kind:'accepted',ticket:'PRB-147',at:at(2026,10,13,4,50)}]},asks:[],tickets,now});
  assert.deepEqual([bare.title,bare.rows.map(r=>r.sub)],['Since your last visit',['','one review','4:50 am']],'the title of the mockup for a visit that was not yesterday, or not dated');
  assert.equal(pageSince({overnight:{...overnight,since:at(2026,10,10,19,10)},asks:[],tickets,now}).title,'Since your last visit');
  assert.equal(pageSince({overnight:{...overnight,since:at(2026,10,13,7,0)},asks:[],tickets,now}).title,'Since your last visit');
  // Drawn in « Right now » between who works and the recent activity, with the colours of the mockup.
  const main=await readFile(new URL('../mods/fabrique-console-v4-ticket/main.js',import.meta.url),'utf8');
  assert.match(main,/label\(P\.side\.who,true\)\)[\s\S]*?label\(since\.title\)[\s\S]*?label\(P\.side\.activity\)/);
  // Ticket M14: from the recap the page keeps for its showing (pageRecap), not from the last reading alone.
  assert.match(main,/pageSince\(\{overnight:recapShown\(this\.recap\?\.mission===m\.id\?this\.recap:null\),asks,tickets\}\)/);
  for(const colour of ['#6B5218','#221D12','#F6E2B0','#D9C48F'])assert.ok(main.includes(colour),colour);
});
