import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {pageAsks,withoutSent,withKinds,askShown,askStep,canAnswer,pageAnswer,saidOf,asShown,refusalOf} from '../mods/fabrique-console-v4-ticket/answers.js';
import {pageBand,askKind} from '../mods/fabrique-console-v4-ticket/page.js';
import {pageBlocks} from '../mods/fabrique-console-v4-ticket/blocks.js';
import {lineTickets,lineCard} from '../mods/fabrique-console-v4-ticket/line.js';
import {W} from '../mods/fabrique-console-v4-ticket/words.js';

// PRB-41 of the mockup, small: four tickets, two accepted, PRB-146 in dev.
const row=(id,n,state)=>({id,n,title:'Titre '+id,level:'standard',dev:'claude',model:'claude-opus-5-5',deps:[],kind:'work',delivery:'included',state,rounds:0});
const STATES={'PRB-142':'accepted','PRB-144':'accepted','PRB-146':'dev','PRB-147':'todo'};
const mission=(step='building',more={})=>({id:'M-1',project:'beta',step,issue:{identifier:'PRB-41'},branch:'prb-41',tickets:Object.keys(STATES).map((id,i)=>row(id,i+1,step==='building'?STATES[id]:'todo')),
  plan:{format:2,tickets:Object.keys(STATES).map((id,i)=>({id,rank:i+1,title:'Titre '+id,difficulty:'standard',kind:'work',delivery:'included',deps:[],texts:[],mockups:[]}))},...more});
const ask=(id,more={})=>({id,type:'decision',state:'pending',mission:'M-1',ticket:'PRB-146',title:'Question '+id,priority:2,createdAt:new Date(2026,10,12,14,40).toISOString(),answers:[],...more});
const LEAD={address:'t1',status:'idle'};
const panel=(item,more={})=>{const m=more.mission||mission();return pageAnswer({item,mission:m,tickets:lineTickets(m),asks:[item],...more});};
const KIT={id:'MK-1',title:'Guide',ticket:'PRB-146',item:'i9',folder:'/m/guide',at:'2026-11-13T09:00:00.000Z',pub:'5f0c8a2e-publication-1',picked:null,variants:[{name:'a',file:'a.html',image:'mockups/MK-1/a.png',width:800,height:500},{name:'b',file:'b.html',image:'mockups/MK-1/b.png',width:800,height:500}]};

test('the rules of the answers are built with the other shared files of the V4 screens',async()=>{
  assert.match(await readFile(new URL('../scripts/build-ui.mjs',import.meta.url),'utf8'),/V4_SHARED=\[[^\]]*'answers\.js'/);
  assert.equal(await readFile(new URL('../mods/fabrique-console-v4-ticket/answers.js',import.meta.url),'utf8'),await readFile(new URL('../ui/v4/answers.js',import.meta.url),'utf8'));
  assert.equal(await readFile(new URL('../mods/fabrique-console-v4-inbox/look.js',import.meta.url),'utf8'),await readFile(new URL('../ui/v4/look.js',import.meta.url),'utf8'));
});

test('a request is a question, a suggestion, a verdict, a choice of copy, a permission or a choice of mockup',()=>{
  const m=mission('building',{mockups:[KIT]});
  assert.deepEqual([ask('i1'),ask('i2',{kind:'suggestion'}),ask('i3',{kind:'verdict'}),ask('i4',{kind:'copy'}),ask('i5',{type:'authorization'}),ask('i9'),ask('i6',{kind:'autre'})].map(i=>askKind(i,m)),
    ['question','suggestion','verdict','copy','permission','mockup','question']);
  assert.equal(askKind(ask('i9'),mission()),'question','without a mockup published for it, a request is a question');
  assert.deepEqual(withKinds([ask('i9'),ask('i1')],m).map(i=>i.kind),['mockup',undefined],'the line and the blocks are told a choice of mockup');
});

test('the requests shown are those that wait on this development, a blocked ticket apart, the most urgent first',()=>{
  const items=[ask('i2',{createdAt:'2026-11-12T10:02:00Z'}),ask('i1',{createdAt:'2026-11-12T10:01:00Z'}),ask('i3',{type:'stuck',priority:1}),ask('i4',{mission:'M-2'}),ask('i5',{state:'answered'})];
  assert.deepEqual(pageAsks(items,mission()).map(i=>i.id),['i1','i2']);
  assert.deepEqual(pageAsks(null,mission()),[]);
});

test('an answer sent here takes its request off the page at once; the one being sent stays until it is recorded',()=>{
  const items=[ask('i1'),ask('i2')];
  assert.deepEqual(withoutSent(items,{i1:'Oui'},null).map(i=>i.id),['i2']);
  assert.deepEqual(withoutSent(items,{i1:'Oui'},'i1').map(i=>i.id),['i1','i2'],'while it is sent, the request stays open');
  assert.deepEqual(withoutSent(items,{},null).map(i=>i.id),['i1','i2']);assert.deepEqual(withoutSent(null,{},null),[]);
});

test('the column on the right shows the request opened, and only while it waits; the arrows go from one to the other',()=>{
  const asks=[ask('i1'),ask('i2'),ask('i3')];
  assert.equal(askShown(asks,{t:'ask',id:'i2'}).id,'i2');
  assert.equal(askShown(asks,{t:'ask',id:'gone'}),null,'a request answered elsewhere leaves the column');
  assert.equal(askShown(asks,{t:'decision',id:'i2'}),null);assert.equal(askShown(asks,null),null);
  assert.deepEqual([askStep(asks,'i1',1),askStep(asks,'i3',1),askStep(asks,'i1',-1),askStep(asks,'gone',1),askStep([],'i1',1)],['i2','i1','i3',null,null]);
  assert.equal(panel(asks[1],{asks}).nav,true);assert.equal(panel(asks[0]).nav,false,'one request: no arrow');
});

test('a question shows what is asked, its choices, the one the Lead recommends first, and what each one brings',()=>{
  const item=ask('i1',{title:'Fenêtres : 50 au lieu de 100 ?',text:'La première revue mesure un dépliage trop lent.',answers:['Non, garder 100','Oui, passer à 50'],recommendation:'Oui, passer à 50',
    details:{'Oui, passer à 50':'Avis du Lead : le dépliage repasse sous 500 ms.','Non, garder 100':'Un tour de plus sur ce ticket.'}});
  const a=panel(item,{mission:mission()});
  assert.deepEqual([a.kind,a.kicker,a.title,a.texts,a.when,a.layout],['question','Question from the Lead · yours to answer','Fenêtres : 50 au lieu de 100 ?',['La première revue mesure un dépliage trop lent.'],'','rows']);
  assert.deepEqual(a.options.map(o=>[o.label,o.recommended,o.detail,o.button]),[['Oui, passer à 50',true,'Avis du Lead : le dépliage repasse sous 500 ms.','Choose'],['Non, garder 100',false,'Un tour de plus sur ce ticket.','Choose']]);
  assert.deepEqual(a.options.map(o=>o.send),[{command:'inbox-answer',text:'Oui, passer à 50'},{command:'inbox-answer',text:'Non, garder 100'}],'an answer goes by the action of the Inbox');
  assert.deepEqual([a.field,a.ticketsLabel,a.tickets,a.foot],['Answer differently…','Ticket concerned',['PRB-146'],'']);
  // With the engine of today: no text under a choice but the reason of the Lead, under the one it recommends.
  const today=panel({...item,details:undefined,why:'Le critère est tenu.'});
  assert.deepEqual(today.options.map(o=>o.detail),['Le critère est tenu.','']);
  assert.equal(panel({...item,text:'Fenêtres : 50 au lieu de 100 ?'}).texts.length,0,'a text that repeats the question is said once');
  assert.deepEqual(panel({...item,text:'',summary:'En bref.'}).texts,['En bref.']);
  assert.deepEqual(panel(ask('i2',{ticket:null})).tickets,[]);assert.deepEqual(panel(ask('i2',{ticket:'PRB-999'})).tickets,[],'a ticket that is not of the plan is not offered');
});

test('who asks and when is said as the mockup says it: the Lead or a dev, the hour in Prepare only',()=>{
  const prepare=mission('analysing'),q=ask('i1',{ticket:'PRB-146'});
  assert.deepEqual([panel(q,{mission:prepare}).when,panel(q,{mission:prepare}).foot],['Asked at 2:40 pm.','Your answer is saved on the ticket; the Lead updates the plan.']);
  const s=panel(ask('i2',{kind:'suggestion',tickets:['PRB-147'],answers:['Accept','Decline'],createdAt:new Date(2026,10,12,14,41).toISOString()}),{mission:prepare});
  assert.deepEqual([s.kicker,s.when,s.layout,s.field,s.ticketsLabel,s.tickets,s.foot],['Suggestion from the Lead · yours to answer','Made at 2:41 pm.','buttons',null,'Tickets concerned',['PRB-146','PRB-147'],'Your answer is saved on the ticket; the Lead updates the plan.']);
  assert.deepEqual(s.options.map(o=>[o.label,o.primary]),[['Accept',true],['Decline',false]]);
  const dev=panel(ask('i3',{from:'dev'}));
  assert.deepEqual([dev.kicker,dev.when,dev.foot],['Question from Dev 1 · yours to answer','','The ticket waits for your answer; the dev resumes right after.']);
  assert.equal(panel(ask('i4',{drift:true})).foot,'The ticket waits for your answer. A yes is recorded as drift from the approved plan.');
  assert.equal(panel(ask('i5',{createdAt:null}),{mission:prepare}).when,'','no instant: no hour, never one made up');
});

test('a verdict to decide shows the two choices and no free answer; the rest of the plan waits',()=>{
  const v=panel(ask('i1',{kind:'verdict',text:'Le relecteur ne peut pas juger.',answers:['Accept as is','Have it fixed'],recommendation:'Accept as is',why:'120 ms reste sous le seuil.'}));
  assert.deepEqual([v.kicker,v.field,v.foot,v.layout],['Review verdict · your call',null,'The rest of the plan waits for your answer: the next ticket only starts after.','rows']);
  assert.deepEqual(v.options.map(o=>[o.label,o.recommended,o.detail]),[['Accept as is',true,'120 ms reste sous le seuil.'],['Have it fixed',false,'']]);
});

test('the variants of a copy are stacked as the mockup draws them, named by their letter, in their order',()=>{
  const c=panel(ask('i1',{kind:'copy',from:'dev',title:'Quel texte ?',answers:['Texte un.','Texte deux.','Texte trois.'],recommendation:'Texte deux.'}));
  assert.deepEqual([c.kicker,c.texts,c.field,c.foot,c.pilotFoot],['Copy to choose · yours to answer',['Three variants proposed during PRB-146. The ticket waits for your choice.'],null,'For another wording, talk to Pilot.',true]);
  assert.deepEqual(c.options.map(o=>[o.label,o.detail,o.recommended,o.said,o.send.text]),[['Variant A','Texte un.',false,'variant A','Texte un.'],['Variant B','Texte deux.',true,'variant B','Texte deux.'],['Variant C','Texte trois.',false,'variant C','Texte trois.']]);
  assert.deepEqual(panel(ask('i2',{kind:'copy',ticket:null,answers:['a','b'],text:'Pour la page d\'aide.'})).texts,['Two variants proposed.','Pour la page d\'aide.']);
});

test('a permission asked by an agent is drawn as a question, with what it asks to run and the answers of the request',()=>{
  const p=panel(ask('i1',{type:'authorization',from:'dev',title:'Lancer la migration ?',command:'pnpm db:migrate',answers:['Autoriser','Refuser']}),{canDelegate:true});
  assert.deepEqual([p.kind,p.kicker,p.command,p.field,p.foot],['permission','Permission request from Dev 1 · yours to answer',{label:'Asks to run:',text:'pnpm db:migrate'},null,'The ticket waits for your answer; the dev resumes right after.']);
  assert.deepEqual(p.options.map(o=>o.label),['Autoriser','Refuser'],'a permission is never handed to the Lead: no other choice is added');
  assert.equal(panel(ask('i2',{type:'authorization'})).kicker,'Permission request from the Lead · yours to answer');
  assert.equal(panel(ask('i2',{type:'authorization'})).command,null);
});

test('a choice of mockup is drawn as a choice of copy: one row per variant, its picture, and the action of the mockups',()=>{
  const m=mission('building',{mockups:[KIT]}),k=panel(ask('i9',{title:'Quelle mise en page ?',text:'Deux pistes.'}),{mission:m,canDelegate:false});
  assert.deepEqual([k.kind,k.kicker,k.texts,k.foot,k.pilotFoot,k.field],['mockup','Mockup to choose · yours to answer',['Deux pistes.'],'For another mockup, talk to Pilot.',true,null]);
  assert.deepEqual(k.options.map(o=>[o.label,o.button,o.image.path,o.said]),[['Variant A','Choose this mockup','mockups/MK-1/a.png','variant A'],['Variant B','Choose this mockup','mockups/MK-1/b.png','variant B']]);
  // The publication is named by its own identifier (pub), never by its instant (at), which two publications can share.
  assert.deepEqual(k.options[1].send,{command:'mockup-pick',mockup:'MK-1',variant:'b',published:'5f0c8a2e-publication-1'});
  assert.deepEqual(k.view,{label:'View mockup',mockup:'MK-1'},'the viewer of the mockups stays one click away');
  assert.deepEqual(panel(ask('i9'),{mission:m,canDelegate:true}).options.map(o=>o.label),['Variant A','Variant B'],'a choice of mockup is not handed to the Lead');
});

test('« Let the Lead decide » stays a possible answer to a question, and to a question only (decision 44), after the choices, when a Lead is there',()=>{
  const item=ask('i1',{answers:['Oui','Non'],recommendation:'Oui'});
  const a=panel(item,{canDelegate:true});
  assert.deepEqual(a.options.map(o=>[o.label,o.send.command,o.recommended]),[['Oui','inbox-answer',true],['Non','inbox-answer',false],['Let the Lead decide','inbox-delegate',false]]);
  assert.equal(a.options[2].said,'The Lead will decide');
  assert.equal(panel(item,{canDelegate:false}).options.length,2,'no Lead: nobody to hand it to');
  assert.deepEqual(panel(ask('i3',{from:'dev',answers:['A','B']}),{canDelegate:true}).options.map(o=>o.label),['A','B','Let the Lead decide'],'the question of a dev too');
  // A suggestion, a verdict, a choice of copy, a choice of mockup and a permission keep the choices drawn, and no other.
  const labels=(item,m=mission())=>panel(item,{mission:m,canDelegate:true}).options.map(o=>[o.label,o.send.command]);
  assert.deepEqual(labels(ask('i2',{kind:'suggestion',answers:['Accept','Decline']})),[['Accept','inbox-answer'],['Decline','inbox-answer']]);
  assert.deepEqual(labels(ask('i4',{kind:'verdict',answers:['Accept as is','Have it fixed'],recommendation:'Accept as is'})),[['Accept as is','inbox-answer'],['Have it fixed','inbox-answer']]);
  assert.deepEqual(labels(ask('i5',{kind:'copy',answers:['Un','Deux','Trois']})),[['Variant A','inbox-answer'],['Variant B','inbox-answer'],['Variant C','inbox-answer']]);
  assert.deepEqual(labels(ask('i9'),mission('building',{mockups:[KIT]})),[['Variant A','mockup-pick'],['Variant B','mockup-pick']]);
  assert.deepEqual(labels(ask('i6',{type:'authorization',answers:['Autoriser','Refuser']})),[['Autoriser','inbox-answer'],['Refuser','inbox-answer']]);
});

test('an answer is sent once: not while one is being sent, not when this request has been answered here',()=>{
  const item=ask('i1');
  assert.equal(canAnswer({answering:null,sent:{}},item),true);
  assert.equal(canAnswer({answering:'i1',sent:{}},item),false,'a second click while the first is sent');
  assert.equal(canAnswer({answering:'i2',sent:{}},item),false,'one answer at a time');
  assert.equal(canAnswer({answering:null,sent:{i1:'Oui'}},item),false,'already answered here');
  assert.equal(canAnswer({},item),true);assert.equal(canAnswer({},null),false);
  // What the column says meanwhile: the choice clicked is being sent, nothing else can be clicked.
  const sending=panel(ask('i1',{answers:['Oui','Non']}),{view:{answering:'i1',sent:{i1:'Non'},chosen:{id:'i1',key:'a1'}}});
  assert.deepEqual([sending.busy,sending.options.map(o=>o.button),sending.error],[true,['Choose','Sending…'],'']);
  assert.equal(panel(ask('i1',{answers:['Oui']})).busy,false);
});

test('an answer that fails is said in the column, and its request stays open',()=>{
  const view={answering:null,sent:{},failed:{id:'i1',message:'The Lead could not be reached.'},chosen:{id:'i1',key:'a0'}},item=ask('i1',{answers:['Oui','Non']});
  const a=panel(item,{view});
  assert.deepEqual([a.error,a.busy,a.options.map(o=>o.button)],['The Lead could not be reached.',false,['Choose','Choose']]);
  assert.equal(canAnswer(view,item),true,'it can be sent again');
  assert.deepEqual(withoutSent([item],view.sent,null).map(i=>i.id),['i1']);
  assert.equal(panel(ask('i2',{answers:['Oui']}),{view}).error,'','the failure of another request is not said here');
});

test('an answer given here is added to « Your decisions » at once, until the engine lists it',()=>{
  const m=mission(),item=ask('i1',{short:'Fenêtres de l\'Arbre',answers:['Oui, passer à 50']}),a=panel(item);
  assert.deepEqual(saidOf(item,a.options[0]),{id:'i1',short:'Fenêtres de l\'Arbre',said:'Oui, passer à 50'});
  assert.deepEqual(saidOf(ask('i2',{title:'Titre long'}),{said:'Non'},{created:false,decision:{text:'Oui'}}),{id:'i2',short:'Titre long',said:'Oui'},'answered first in another window: the decision kept is the one said');
  const left=more=>pageBlocks({mission:m,lead:LEAD,items:[],story:{decisions:[{id:'d1',short:'Collations',said:'à part'}]},...more})[0];
  assert.deepEqual(left({sent:[{id:'i1',short:'Fenêtres de l\'Arbre',said:'Oui, passer à 50'}]}).rows.map(r=>[r.sign,r.text,r.right,Boolean(r.open)]),[['✓','Nothing is waiting on you','',false],['✓','Fenêtres de l\'Arbre','Oui, passer à 50',false],['✓','Collations','à part',true]]);
  assert.equal(left({sent:[{id:'i1',short:'x',said:'y'}]}).count,'2');
  const listed=left({sent:[{id:'i1',short:'x',said:'y'}],story:{decisions:[{id:'d2',item:'i1',short:'Fenêtres',said:'passer à 50'}]}});
  assert.deepEqual(listed.rows.map(r=>r.text),['Nothing is waiting on you','Fenêtres'],'once the engine lists the decision, it is said once');
});

test('a row of « Waiting on you » opens its request in the column, and is marked while it is open',()=>{
  const m=mission(),items=[ask('i1',{short:'Un ?'}),ask('i2',{short:'Deux ?',kind:'mockup'}),ask('i3',{type:'authorization',from:'dev'})];
  const rows=pageBlocks({mission:m,lead:LEAD,items,story:{},open:{t:'ask',id:'i2'}})[0].rows;
  assert.deepEqual(rows.map(r=>[r.text,r.sub,r.right,r.act?.key,r.act?.item.id,r.selected]),[['Un ?','question from the Lead','Answer','answer','i1',false],['Deux ?','mockup choice from the Lead','Answer','answer','i2',true],['Question i3','permission request from Dev 1','Answer','answer','i3',false]]);
});

test('the banner announces the request in the words of its kind, and its button opens it',()=>{
  const m=mission(),band=(item,more={})=>{const b=pageBand({mission:more.mission||m,lead:LEAD,items:[item],...more});return [b.tone,b.big,b.det,b.button.label,b.button.key,b.button.item.id];};
  assert.deepEqual(band(ask('i1',{from:'dev'})),['you','Waiting on you: a question from Dev 1 on PRB-146','PRB-146 waits for your answer · 2 of 4 accepted','Answer','answer','i1']);
  assert.deepEqual(band(ask('i1',{kind:'verdict'})),['you','Waiting on you: a review verdict to decide','PRB-146 waits for your answer · 2 of 4 accepted','Decide','answer','i1']);
  assert.deepEqual(band(ask('i1',{kind:'verdict'}),{overnight:{accepted:3,since:new Date(Date.now()-2*86400000).toISOString()}}),['you','Overnight: 3 tickets accepted · 1 decision is waiting on you','PRB-146 waits for your verdict · 2 of 4 accepted','Decide','answer','i1']);
  assert.deepEqual(band(ask('i1',{kind:'copy',from:'dev',about:'the /aide guide'})),['you','Waiting on you: choose the copy for the /aide guide','PRB-146 waits for your choice · 2 of 4 accepted','Choose','answer','i1']);
  assert.equal(band(ask('i1',{kind:'copy'}))[1],'Waiting on you: choose the copy for PRB-146');
  assert.deepEqual(band(ask('i1',{type:'authorization',from:'dev'})),['you','Waiting on you: a permission request from Dev 1 on PRB-146','PRB-146 waits for your answer · 2 of 4 accepted','Answer','answer','i1']);
  assert.deepEqual(band(ask('i9'),{mission:mission('building',{mockups:[KIT]})}),['you','Waiting on you: choose a mockup for PRB-146','PRB-146 waits for your choice · 2 of 4 accepted','Choose','answer','i9']);
  assert.equal(band(ask('i1',{kind:'suggestion'}))[1],'Waiting on you: a suggestion from the Lead on PRB-146');
  // In Prepare the Lead waits: its questions and its suggestions are counted (screens 02 and 03).
  const prepare=mission('analysing'),b=pageBand({mission:prepare,lead:LEAD,items:[ask('i1',{createdAt:'2026-11-12T10:01:00Z'}),ask('i2',{kind:'suggestion',createdAt:'2026-11-12T10:02:00Z'})]});
  assert.deepEqual([b.big,b.det,b.button.label,b.button.item.id],['The Lead is waiting on you: 1 question and 1 suggestion','You can approve the plan right after.','Answer','i1']);
  assert.equal(pageBand({mission:prepare,lead:LEAD,items:[ask('i2',{kind:'suggestion'})]}).big,'The Lead is waiting on you: 1 suggestion');
  assert.equal(pageBand({mission:mission('analysing',{mockups:[KIT]}),lead:LEAD,items:[ask('i9')]}).big,'Waiting on you: choose a mockup for PRB-146','a choice of mockup has its banner in the stage it comes in');
});

test('the card of a ticket says what kind of answer it waits for',()=>{
  const m=mission(),t=lineTickets(m).find(x=>x.id==='PRB-146'),card=item=>{const c=lineCard(t,{stage:'develop',items:[item]});return [c.word,c.sub];};
  assert.deepEqual([card(ask('i1')),card(ask('i1',{kind:'verdict'})),card(ask('i1',{kind:'copy'})),card(ask('i1',{kind:'mockup'})),card(ask('i1',{type:'authorization'}))],
    [['Waiting on you','question'],['Waiting on you','verdict'],['Waiting on you','copy choice'],['Waiting on you','mockup choice'],['Waiting on you','']]);
  assert.equal(lineCard(t,{stage:'develop',items:[]}).word,'In dev','once answered, the card says again what the ticket does');
});

test('the page answers by the actions of the Inbox, and opens Pilot on the question for another answer',async()=>{
  const main=await readFile(new URL('../mods/fabrique-console-v4-ticket/main.js',import.meta.url),'utf8'),look=await readFile(new URL('../ui/v4/look.js',import.meta.url),'utf8');
  assert.match(main,/answerRequest\(this,MOD,/);assert.match(main,/delegateRequest\(this,MOD,/);assert.match(main,/pickMockup\(this,MOD,/);
  assert.match(main,/openRequest\(this,MOD,/,'« Answer differently… » opens Pilot with the question (decision 35)');
  assert.doesNotMatch(main,/api\(MOD,'(pilot-decide|inbox-answer|inbox-delegate|mockup-pick)'/,'no second way to send an answer');
  // Each send says which version of the request was shown (seen): the engine refuses an answer to words replaced since.
  assert.match(look,/api\(mod,'inbox-answer',\{item:item\.id,choice:text\.slice\(0,200\),text,\.\.\.asShown\(item\)\}\)/,'the command of the screens, the only one that records a permission');assert.doesNotMatch(look,/pilot-decide/);assert.match(look,/api\(mod,'inbox-delegate',\{item:item\.id,\.\.\.asShown\(item\)\}\)/);
  assert.match(look,/api\(mod,'mockup-pick',\{mission:mission\.id,mockup:send\.mockup,variant:send\.variant,published:send\.published,item:item\.id,\.\.\.asShown\(item\)\}\)/);
  assert.equal((look.match(/api\(mod,'(inbox-answer|inbox-delegate|mockup-pick)'/g)||[]).length,3,'and there is no other send');
  assert.equal((look.match(/if\(!canAnswer\(view,item\)\)return;/g)||[]).length,3,'each of the three sends goes through the same gate');
  assert.equal((look.match(/catch\(e\)\{await notSent\(view,mod,item,e\);\}/g)||[]).length,3,'and says its failure the same way');
  assert.match(look,/view\.failed=refusalOf\(item,e\)/);
  assert.match(look,/if\(view\.failed\.changed\)try\{const fresh=await api\(mod,'inbox-list',\{\}\);if\(Array\.isArray\(fresh\?\.items\)\)setShared\(KEYS\.inbox,fresh\.items\);\}catch\{\}/,'a request that changed is read again at once, for every screen');
});

test('an answer carries the version of the request that was shown, and a request that changed is said so and stays open',()=>{
  assert.deepEqual(asShown(ask('i1',{seen:'a'.repeat(64)})),{seen:'a'.repeat(64)});
  assert.deepEqual(asShown(ask('i1')),{},'a feed from before the versions sends none');assert.deepEqual(asShown(null),{});
  const changed=Object.assign(new Error('This request changed. Read it again, then answer.'),{code:'REQUEST_CHANGED'}),item=ask('i1',{answers:['Autoriser','Refuser'],type:'authorization'});
  assert.deepEqual(refusalOf(item,changed),{id:'i1',message:'This request changed. Read it again, then answer.',changed:true});
  assert.deepEqual(refusalOf(item,Object.assign(new Error('The Lead could not be reached.'),{code:'SEND_FAILED'})),{id:'i1',message:'The Lead could not be reached.',changed:false});
  assert.deepEqual(refusalOf(item,'x'),{id:'i1',message:'x',changed:false});
  // The column shows the request as it is now, says why nothing was recorded, and every choice can be clicked again.
  const view={answering:null,sent:{},failed:refusalOf(item,changed),chosen:{id:'i1',key:'a0'}},now=ask('i1',{type:'authorization',title:'Migration de production ?',answers:['Autoriser','Refuser'],seen:'b'.repeat(64)}),a=panel(now,{view});
  assert.deepEqual([a.title,a.error,a.busy,a.chosen,a.options.map(o=>o.button)],['Migration de production ?','This request changed. Read it again, then answer.',false,null,['Choose','Choose']]);
  assert.equal(canAnswer(view,now),true);assert.deepEqual(asShown(a.item),{seen:'b'.repeat(64)},'the next answer is given on what is shown now');
});

test('the strings of the answers are those of the mockup and of the final list, to the letter',()=>{
  const A=W.page.answer;
  assert.deepEqual([A.question('the Lead'),A.suggestion('the Lead'),A.verdict,A.copy,A.permission('Dev 1'),A.mockup],['Question from the Lead · yours to answer','Suggestion from the Lead · yours to answer','Review verdict · your call','Copy to choose · yours to answer','Permission request from Dev 1 · yours to answer','Mockup to choose · yours to answer']);
  assert.deepEqual([A.askedAt('2:40 pm'),A.madeAt('2:41 pm'),A.recommended,A.choose,A.differently,A.ticket,A.tickets,A.variant('B')],['Asked at 2:40 pm.','Made at 2:41 pm.','recommended','Choose','Answer differently…','Ticket concerned','Tickets concerned','Variant B']);
  assert.equal(A.variants(3,'PRB-151'),'Three variants proposed during PRB-151. The ticket waits for your choice.');
});

test('the strings the mockup does not write are those the review of the screen kept, to the letter',()=>{
  const P=W.page,A=P.answer;
  assert.equal(P.card.mockupChoice,'mockup choice');
  assert.equal(P.band.suggestion('PRB-147','the Lead'),'Waiting on you: a suggestion from the Lead on PRB-147');
  assert.deepEqual([A.theReviewer,A.theQa],['the reviewer','the QA agent']);
  assert.deepEqual([A.previous,A.next],['Previous request','Next request']);
  assert.deepEqual([A.variants(2,'PRB-151'),A.variants(4,'PRB-151'),A.variants(2,'')],['Two variants proposed during PRB-151. The ticket waits for your choice.','Four variants proposed during PRB-151. The ticket waits for your choice.','Two variants proposed.']);
  assert.equal(P.band.overnight(3,2),'Overnight: 3 tickets accepted · 2 decisions are waiting on you');
  assert.equal(P.band.leadWaits(0,2),'The Lead is waiting on you: 2 suggestions');
  // Where they are said: who asks, the row of a choice of mockup, the two arrows.
  assert.equal(panel(ask('i1',{from:'reviewer'})).kicker,'Question from the reviewer · yours to answer');assert.equal(panel(ask('i1',{from:'qa'})).kicker,'Question from the QA agent · yours to answer');
  assert.equal(panel(ask('i4',{kind:'copy',ticket:null,answers:['Un','Deux']})).texts[0],'Two variants proposed.');
});

// ---- M9 review 3 (decision 98): who asks is read where the engine writes it, the recipient of the request
// (src/requests.mjs: `recipient.from` is dev, review-1, review-2, qa or lead), never a field the engine does not give.
test('who asks is read in the recipient of the request, as the engine writes it (M9 review 3)',()=>{
  const m=mission(),of=from=>({recipient:{question:'Q-1',from,fromTab:null,ticket:'PRB-146',mission:'M-1'}});
  const band=item=>pageBand({mission:m,lead:LEAD,items:[item]}).big;
  assert.equal(band(ask('i1',of('dev'))),'Waiting on you: a question from Dev 1 on PRB-146');
  assert.equal(band(ask('i1',{type:'authorization',...of('dev')})),'Waiting on you: a permission request from Dev 1 on PRB-146');
  assert.equal(band(ask('i1',of('lead'))),'Waiting on you: a question from the Lead on PRB-146');
  assert.equal(panel(ask('i1',of('dev'))).kicker,panel(ask('i1',{from:'dev'})).kicker,'the column says the dev, as the simulation did');
  assert.equal(panel(ask('i1',of('review-2'))).kicker,'Question from the reviewer · yours to answer');
  assert.equal(panel(ask('i1',of('qa'))).kicker,'Question from the QA agent · yours to answer');
  // A dev that asks is on its card: its badge, not the Lead's question (line.js reads the same rule).
  const card=lineCard({id:'PRB-146',state:'dev',title:'x'},{stage:'develop',items:[ask('i1',of('dev'))]});
  assert.equal(card.avatar?.text,'D1');
});
