import test from 'node:test';
import { SCREEN_ONLY } from '../ui/v3/view.js';
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { desk, click, holds } from './helpers/requests.mjs';
import { createMockups } from '../src/mockups.mjs';
import { createPilot, decisionPrompt, missionPrompt, requestMessage } from '../src/pilot.mjs';
import { discussAsk } from '../src/agent-texts.mjs';
import { waitLock, withLock } from '../src/common.mjs';
import { UNCERTAIN, CLICK, printOf } from '../src/requests.mjs';
import * as mockupNav from '../mods/fabrique-console-v4-mockup/nav.js';
const { mockupsFor, mockupShown, mockupPick } = mockupNav;
import { pageAnswer } from '../mods/fabrique-console-v4-ticket/answers.js';

import { fakeHerdr } from './helpers/fake-herdr.mjs';
// The ways in are closed: one function records an answer; a permission needs the command of the screens; the screen of
// the mockups sends the request, the version and the publication it drew, together; nothing of before is copied as
// sure; and a lock that waits never runs a task twice. Test data only.
const AUTH={mission:'M-1',ticket:'XJ-2',type:'authorization',title:'Migration 0026',text:'Autoriser la migration 0026 sur la base locale ?',recommendation:'Autoriser',why:'Base de test',options:['Autoriser','Refuser']};
const CHOICE={mission:'M-1',ticket:'XJ-3',type:'decision',title:'Repli',text:'Client ou serveur ?',recommendation:'Serveur',why:'Coût',options:['Serveur','Client']};
const source=name=>readFile(new URL(name,import.meta.url),'utf8');

// ---- One way to record an answer.

test('what is kept beside a request never carries its answer nor its words, and a request resolved stays resolved',async t=>{
  const f=await desk(t),{item}=await f.actions.escalate(CHOICE),shown=await f.one(item.id);
  for(const fields of [{answer:{id:'D-9',text:'Serveur'}},{text:'Autre chose'},{options:['C']},{version:'x'},{replaces:'I-9'},{recipient:null},{question:'Q-9'},{state:'answered'},{state:'pending'},{state:'nope'}])
    await assert.rejects(()=>f.inbox.mark(item.id,fields),e=>e.code==='REQUEST_FIXED',JSON.stringify(fields));
  assert.deepEqual(await f.one(item.id),shown,'nothing was written');
  assert.equal((await f.inbox.mark(item.id,{state:'opening'},{when:['pending']})).changed,true);
  assert.equal((await f.one(item.id)).seen,shown.seen,'its state is no part of its version');
  assert.equal((await f.inbox.mark(item.id,{state:'resolved'})).changed,true);
  for(const state of ['opening','error','delivered'])assert.equal((await f.inbox.mark(item.id,{state})).changed,false,state);
  assert.equal((await f.inbox.read(item.id)).state,'resolved');
  await assert.rejects(()=>click(f,shown,'Serveur'),e=>e.code==='QUESTION_CLOSED');
  await holds(f);
});

test('a question keeps its words, its answers, the one who asked and the answer of the user, whatever passes on it',async t=>{
  const f=await desk(t);await f.asked();
  const {item}=await f.actions.escalate({...CHOICE,question:'Q-1',ticket:'XJ-2'});
  for(const change of [q=>{q.options=['A','C'];},q=>{q.options.push('C');},q=>{q.question='Autre';},q=>{q.from='lead';},q=>{q.fromTab='XJ-9 · dev';},q=>{q.ticket='XJ-9';},q=>{q.state='open';},q=>{q.answer={text:'A',by:'legacyOwner',decision:'D-9',at:'t'};q.state='answered';},q=>{q.legacyOwner={text:'A',by:'legacyOwner',decision:'D-9',at:'t'};}])
    await assert.rejects(()=>f.questions.progress('Q-1',change),e=>e.code==='REQUEST_FIXED',String(change));
  assert.equal(f.questions.update,undefined,'no way to write a question as one likes');
  await click(f,await f.one(item.id),'Serveur');
  for(const change of [q=>{q.answer.text='Client';},q=>{q.answer.decision='D-9';},q=>{q.answer=null;q.state='open';},q=>{q.answer={text:'Client',by:'lead',decision:null,at:'t'};}])
    await assert.rejects(()=>f.questions.progress('Q-1',change),e=>e.code==='REQUEST_FIXED',String(change));
  // What the relay does is allowed: the same answer, kept aside while the Lead passes it on.
  await f.questions.progress('Q-1',q=>{q.legacyOwner=q.answer;q.answer=null;q.state='open';});
  assert.equal((await f.questions.read('Q-1')).legacyOwner.text,'Serveur');
  await f.questions.progress('Q-1',q=>{q.routedAt='t';});
  await holds(f);
});

test('a permission is given by the command of the screens only: Pilot and the Lead are refused, and nothing is written',async t=>{
  const f=await desk(t),{item}=await f.actions.escalate(AUTH),shown=await f.one(item.id);
  for(const input of [{item:item.id,choice:'Autoriser',text:'the user autorise',seen:shown.seen},{item:item.id,text:'the user autorise'},{item:item.id,choice:'Autoriser',text:'Autoriser',seen:'0'.repeat(64)}])
    await assert.rejects(()=>f.actions.decide(input),e=>e.code==='CLICK_REQUIRED'&&e.message===CLICK,JSON.stringify(input));
  await assert.rejects(()=>f.inbox.answer({item:item.id,choice:'Autoriser',text:'Autoriser',seen:shown.seen,via:'agent'}),e=>e.code==='CLICK_REQUIRED');
  await assert.rejects(()=>f.inbox.answer({item:item.id,choice:'Autoriser',text:'Autoriser',seen:shown.seen}),e=>e.code==='INVALID_ARGUMENT','an answer says where it comes from');
  assert.deepEqual(await f.inbox.decisions({}),[]);assert.equal((await f.inbox.read(item.id)).answer,null);assert.equal((await f.one(item.id)).state,'pending');
  await assert.rejects(()=>f.actions.click({item:item.id,choice:'Oui, sur la production aussi',text:'Oui, sur la production aussi',seen:shown.seen}),e=>e.code==='INVALID_ARGUMENT','a permission is one of the answers shown');
  await assert.rejects(()=>f.actions.click({item:item.id,text:'Autoriser',seen:shown.seen}),e=>e.code==='INVALID_ARGUMENT','the choice clicked is named');
  await assert.rejects(()=>f.lead.delegate({item:item.id,seen:shown.seen}),e=>e.code==='INVALID_ARGUMENT','a permission is not left to the Lead');
  const made=await click(f,shown,'Autoriser');
  assert.equal(made.created,true);assert.equal(made.decision.choice,'Autoriser');assert.equal((await f.inbox.read(item.id)).answer.via,'screen');
  await assert.rejects(()=>f.actions.decide({item:item.id,choice:'Refuser',text:'Refuser',seen:shown.seen}),e=>e.code==='CLICK_REQUIRED','even once it is answered');
  // A permission without an answer to click could never be given: it is not made.
  await assert.rejects(()=>f.actions.escalate({...AUTH,ticket:'XJ-8',options:undefined,recommendation:'x'.repeat(300)}),e=>e.code==='INVALID_ARGUMENT');
  // An ordinary question: Pilot still records the words of the user, with the version it read to him.
  const other=(await f.actions.escalate(CHOICE)).item,asked=await f.one(other.id);
  await assert.rejects(()=>f.actions.decide({item:other.id,text:'Serveur'}),e=>e.code==='SEEN_REQUIRED'&&e.message==='Read this request again, then answer.');
  const said=await f.actions.decide({item:other.id,text:'Serveur, plafond 50',seen:asked.seen});
  assert.equal(said.created,true);assert.equal((await f.inbox.read(other.id)).answer.via,'agent');
  await holds(f);
});

test('the screens answer with their own command, and no text given to an agent names it',async()=>{
  const look=await source('../ui/v4/look.js'),backend=await source('../src/backend.mjs');
  assert.match(look,/api\(mod,'inbox-answer',\{[^}]*\.\.\.asShown\(item\)\}/);assert.doesNotMatch(look,/pilot-decide/);
  assert.match(look,/api\(mod,'inbox-delegate',\{[^}]*\.\.\.asShown\(item\)\}/);assert.match(look,/api\(mod,'mockup-pick',\{[^}]*item:item\.id[^}]*\.\.\.asShown\(item\)\}/);
  assert.match(backend,/\['inbox-answer',exchanges\.click\]/);assert.match(backend,/\['pilot-decide',exchanges\.decide\]/);
  // Named only in the one sentence that forbids it (decision 70, SCREEN_ONLY): never given as a command to run.
  for(const name of ['../src/agent-texts.mjs','../src/pilot.mjs','../src/po-launch.mjs','../roles/lead.md','../roles/po.md','../ui/v3/view.js'])assert.doesNotMatch((await source(name)).replaceAll(SCREEN_ONLY,''),/inbox-answer/,name);
  // Nothing but the module of the requests writes where they are kept.
  for(const name of (await readdir(new URL('../src/',import.meta.url))).filter(name=>name.endsWith('.mjs')&&name!=='requests.mjs'))assert.doesNotMatch(await source('../src/'+name),/'state','requests'|state\/requests/,name);
  assert.match(await source('../roles/lead.md'),/mockup-publish/,'the Lead is told to publish a mockup again for the request that replaces its own');
});

test('what the Lead and Pilot are told: a command with the version for a question, no command at all for a permission',async t=>{
  const f=await desk(t),auth=(await f.actions.escalate(AUTH)).item,choice=(await f.actions.escalate(CHOICE)).item;
  const talk=discussAsk(choice);
  assert.match(talk,/pilot-decide/);assert.ok(talk.includes('"seen":"'+choice.version+'"'),'the command names the version of the request');
  const permission=discussAsk(auth);
  assert.doesNotMatch(permission,/pilot-decide|inbox-answer|"seen"/);assert.match(permission,/clic/);
  const dossier=item=>({request:{id:item.id,seen:item.version,type:item.type},mission:{id:'M-1'}});
  for(const text of [decisionPrompt({role:'ROLE',item:auth,dossier:dossier(auth),folder:'/f',cli:'/c.mjs',node:'/n'}),requestMessage({item:auth,dossier:dossier(auth),cli:'/c.mjs',node:'/n'})]){assert.doesNotMatch(text.replaceAll(SCREEN_ONLY,''),/pilot-decide '|inbox-answer/);assert.match(text,/clic|cliqu/);}
  for(const text of [decisionPrompt({role:'ROLE',item:choice,dossier:dossier(choice),folder:'/f',cli:'/c.mjs',node:'/n'}),requestMessage({item:choice,dossier:dossier(choice),cli:'/c.mjs',node:'/n'})])assert.ok(text.includes('"seen":"'+choice.version+'"'));
  const whole=missionPrompt({role:'ROLE',mission:{id:'M-1'},dossier:{waiting:[{id:auth.id,seen:auth.version,type:'authorization'}]},folder:'/f',cli:'/c.mjs',node:'/n'});
  assert.match(whole,/autorisation/i);assert.match(whole,/clic/);assert.match(whole,/CLICK_REQUIRED/);
  // What Pilot is really launched with on a permission.
  const calls=[],pilot=createPilot({root:f.root,herdr:fakeHerdr({on:async(_hc,args)=>{calls.push(args);return {stdout:args[0]==='run'?'{"id":"t21"}':'{}'};}}).herdr,readTerminals:async()=>[],missions:f.missions,questions:f.questions,inbox:f.inbox,loadConfig:async()=>({projects:[]}),readRole:async()=>'ROLE',wait:async()=>{},agentFolder:f.root});
  const {item:own}=await f.inbox.ask({type:'authorization',mission:'M-1',project:null,ticket:'XJ-7',title:'Pousser',text:'Pousser la branche ?',options:['Autoriser','Refuser']});
  await pilot.open({item:own.id});
  const launched=calls.find(args=>args[0]==='run')?.at(-1)||'';
  assert.ok(launched.includes(own.id));assert.doesNotMatch(launched,/pilot-decide '/);assert.match(launched,/clic|cliqu/);
  assert.equal((await f.inbox.read(own.id)).state,'opening');assert.equal((await f.one(own.id)).seen,own.version,'opened with Pilot, it is the same request');
});

// ---- The screen of the mockups (condition 3 of the review of the approach).

async function mockupDesk(t) {
  const f=await desk(t),allowed=join(f.root,'mockups'),appHome=join(f.root,'app');
  await mkdir(appHome);
  f.folder=async name=>{const folder=join(allowed,'xj',name);await mkdir(folder,{recursive:true});for(const file of ['a.html','b.html'])await writeFile(join(folder,file),'<p>x');return folder;};
  f.mockups=createMockups({root:f.root,registry:f.missions,inbox:f.inbox,allowed,appHome,decide:f.actions.choose,loadState:async()=>({sessions:f.sessions}),send:async message=>{f.sent.push(message);return {sent:true};},capture:async(_file,out)=>{await writeFile(out,'png');return {width:1440,height:2880};}});
  f.kit=async id=>(await f.missions.read('M-1')).mockups.find(k=>k.id===id);
  return f;
}

test('a mockup chosen from the page of a ticket is taken: the page sends the publication it drew, by its identifier',async t=>{
  const f=await mockupDesk(t),one=(await f.actions.escalate(CHOICE)).item;
  const {mockup}=await f.mockups.publish({mission:'M-1',title:'Lots',folder:await f.folder('lots'),item:one.id});
  const item=await f.one(one.id),column=pageAnswer({item,mission:await f.missions.read('M-1')}),send=column.options[1].send;
  assert.equal(send.published,mockup.pub);
  // What look.js sends for that choice (api(mod,'mockup-pick', …)).
  const made=await f.mockups.pick({mission:'M-1',mockup:send.mockup,variant:send.variant,published:send.published,item:item.id,seen:item.seen});
  assert.deepEqual(made,{mockup:mockup.id,variant:'b'});
  assert.deepEqual((await f.inbox.decisions({})).map(d=>d.item),[one.id]);
  await holds(f);
});

test('the screen of a mockup sends, together, the request, the version and the publication it drew, and never a version read later',async t=>{
  const f=await mockupDesk(t),one=(await f.actions.escalate(CHOICE)).item,two=(await f.actions.escalate({...CHOICE,ticket:'XJ-4'})).item;
  const {mockup}=await f.mockups.publish({mission:'M-1',title:'Lots',folder:await f.folder('lots'),item:one.id});
  assert.match(mockup.pub,/^[0-9a-f-]{36}$/,'each publication has an identifier of its own');
  const items=await f.shown(),shown=mockupShown(null,mockup,items);
  assert.deepEqual(shown,{mockup:mockup.id,published:mockup.pub,item:one.id,seen:one.version});
  // The list read again with another version for the same request: what was drawn is kept.
  assert.equal(mockupShown(shown,mockup,items.map(item=>({...item,seen:'f'.repeat(64)}))),shown);
  // Not yet known when it was first drawn, the version is filled in, once.
  const blank=mockupShown(null,mockup,[]);assert.equal(blank.seen,null);assert.equal(mockupShown(blank,mockup,items).seen,one.version);
  assert.deepEqual(mockupPick(shown,'M-1','b','Plus court'),{mission:'M-1',mockup:mockup.id,variant:'b',published:mockup.pub,note:'Plus court',item:one.id,seen:one.version});
  assert.deepEqual(mockupPick(mockupShown(null,{id:'MK-9',pub:'p',item:null},items),'M-1','a',''),{mission:'M-1',mockup:'MK-9',variant:'a',published:'p'},'a mockup of no request sends no request');
  // The screen itself: what it sends is what it drew, and the click reads nothing again.
  const screen=await source('../mods/fabrique-console-v4-mockup/main.js'),choose=screen.slice(screen.indexOf(' choose('),screen.indexOf(' render('));
  assert.match(choose,/api\(MOD,'mockup-pick',mockupPick\(shown,/);assert.doesNotMatch(choose,/shared\(/,'the click reads no shared state');
  assert.match(screen,/this\.shown=mockupShown\(this\.shown,mockup,/);
  // Published again for another request while the screen still shows the first publication.
  const again=(await f.mockups.publish({mission:'M-1',title:'Lots',folder:await f.folder('lots'),item:two.id})).mockup;
  assert.equal(again.id,mockup.id);assert.notEqual(again.pub,mockup.pub);
  await assert.rejects(()=>f.mockups.pick(mockupPick(shown,'M-1','a','')),e=>e.code==='MOCKUP_STALE','the publication drawn is no longer the one published');
  await assert.rejects(()=>f.mockups.pick({...mockupPick(shown,'M-1','a',''),published:again.pub}),e=>e.code==='MOCKUP_STALE','the new publication with the request of before');
  await assert.rejects(()=>f.mockups.pick({...mockupPick(shown,'M-1','a',''),published:again.pub,item:two.id}),e=>e.code==='REQUEST_CHANGED','the new request with the version of before');
  await assert.rejects(()=>f.mockups.pick({mission:'M-1',mockup:again.id,variant:'a',published:again.pub,seen:two.version}),e=>e.code==='MOCKUP_STALE','without the request it drew');
  await assert.rejects(()=>f.mockups.pick({mission:'M-1',mockup:again.id,variant:'a',published:again.pub,item:two.id}),e=>e.code==='SEEN_REQUIRED');
  assert.deepEqual(await f.inbox.decisions({}),[]);assert.equal((await f.kit(mockup.id)).picked,null);
  const fresh=mockupShown(shown,again,await f.shown());
  assert.deepEqual(fresh,{mockup:again.id,published:again.pub,item:two.id,seen:two.version},'drawn again, it is another publication');
  assert.deepEqual(await f.mockups.pick(mockupPick(fresh,'M-1','b','')),{mockup:again.id,variant:'b'});
  const kept=await f.inbox.read(two.id);assert.equal(kept.answer.choice,'b');assert.equal(kept.answer.published,again.pub);assert.equal(kept.answer.via,'screen');assert.equal((await f.inbox.read(one.id)).answer,null);
  await holds(f);
});

test('a mockup is published for a request still open, one mockup per request; a request replaced asks for a new publication',async t=>{
  const f=await mockupDesk(t),one=(await f.actions.escalate(CHOICE)).item;
  const {mockup}=await f.mockups.publish({mission:'M-1',title:'Lots',folder:await f.folder('lots'),item:one.id});
  await assert.rejects(async()=>f.mockups.publish({mission:'M-1',title:'Autre',folder:await f.folder('autre'),item:one.id}),e=>e.code==='INVALID_ARGUMENT','a second mockup for the same request');
  // Other words: another request. The mockup stays with the one it was published for, and chooses nothing.
  const next=(await f.actions.escalate({...CHOICE,text:'Client, serveur ou les deux ?'})).item,shown=mockupShown(null,await f.kit(mockup.id),[{id:one.id,seen:one.version}]);
  await assert.rejects(()=>f.mockups.pick(mockupPick(shown,'M-1','a','')),e=>e.code==='REQUEST_CHANGED');
  await assert.rejects(async()=>f.mockups.publish({mission:'M-1',title:'Lots',folder:await f.folder('lots'),item:one.id}),e=>e.code==='REQUEST_CHANGED','not for a request replaced');
  // The Lead publishes it again for the request of now (roles/lead.md).
  const again=(await f.mockups.publish({mission:'M-1',title:'Lots',folder:await f.folder('lots'),item:next.id})).mockup;
  assert.deepEqual(await f.mockups.pick(mockupPick(mockupShown(null,again,await f.shown()),'M-1','a','')),{mockup:again.id,variant:'a'});
  await assert.rejects(async()=>f.mockups.publish({mission:'M-1',title:'Lots',folder:await f.folder('lots'),item:next.id}),e=>e.code==='QUESTION_CLOSED','not for a request answered');
  assert.equal((await f.kit(again.id)).picked.variant,'a','what was chosen is kept');
  await holds(f);
});

test('a card of a request shows the mockup published for that request, never the one of another request of its ticket',async t=>{
  const f=await mockupDesk(t),one=(await f.actions.escalate(CHOICE)).item,two=(await f.actions.escalate({...CHOICE,type:'authorization',options:['Autoriser','Refuser']})).item;
  assert.equal(one.ticket,two.ticket);
  const {mockup}=await f.mockups.publish({mission:'M-1',title:'Lots',folder:await f.folder('lots'),ticket:'XJ-3',item:one.id}),mission=await f.missions.read('M-1');
  assert.deepEqual(mockupsFor(mission,{item:one.id}).map(k=>k.id),[mockup.id]);
  assert.deepEqual(mockupsFor(mission,{item:two.id}),[]);assert.deepEqual(mockupsFor(mission,{item:two.id,ticket:'XJ-3'}),[],'the ticket ties nothing');
  assert.deepEqual(mockupsFor(mission,{}),[]);assert.deepEqual(mockupsFor(mission,{ticket:'XJ-3'}),[]);
  assert.doesNotMatch(await source('../mods/fabrique-console-v4-inbox/main.js'),/mockupsFor\([^)]*ticket/);
});

test('a card of a request still opens, to look at, a mockup published for its ticket and for no request: it is tied to no request',async t=>{
  const f=await mockupDesk(t),one=(await f.actions.escalate(CHOICE)).item,two=(await f.actions.escalate({...CHOICE,type:'authorization',options:['Autoriser','Refuser']})).item;
  const free=(await f.mockups.publish({mission:'M-1',title:'Écran',folder:await f.folder('ecran'),ticket:'XJ-3'})).mockup;
  const own=(await f.mockups.publish({mission:'M-1',title:'Lots',folder:await f.folder('lots'),ticket:'XJ-3',item:one.id})).mockup,mission=await f.missions.read('M-1');
  assert.equal(free.item,null);
  const {mockupsToSee}=mockupNav;assert.equal(typeof mockupsToSee,'function','the card has the mockups to look at');
  assert.deepEqual(mockupsToSee(mission,{item:one.id,ticket:'XJ-3'}).map(k=>k.id).sort(),[free.id,own.id].sort(),'its own, and the one of its ticket');
  assert.deepEqual(mockupsToSee(mission,{item:two.id,ticket:'XJ-3'}).map(k=>k.id),[free.id],'never the one of another request');
  assert.deepEqual(mockupsToSee(mission,{item:two.id,ticket:'XJ-9'}),[]);
  // To look at only: the request does not become a choice of mockup, and its answers stay its own.
  assert.deepEqual(mockupsFor(mission,{item:two.id}),[]);
  const card=await source('../mods/fabrique-console-v4-inbox/main.js');
  assert.match(card,/kits=mission\?mockupsToSee\(mission,\{item:item\.id,ticket:item\.ticket\}\)/);
  assert.match(card,/kits\.map\(k=>btn\('mockup-'\+item\.id\+'-'\+k\.id,W\.mockup\.open,\(\)=>openMockup\(mission,k\)/,'opened as it is, by its own identifier');
  await holds(f);
});

// ---- The switch-over: nothing of before is copied as sure; the old stock is archived once (tests/legacy-archive).
const archiveFolder=async root=>join(root,JSON.parse(await readFile(join(root,'state','legacy-archive.json'),'utf8')).folder);

test('requests of before are read from their archive, shown uncertain unless their answer is certain, never answered, never carried',async t=>{
  const f=await desk(t),old=join(f.root,'state','inbox'),decisions=join(f.root,'state','decisions'),questions=join(f.root,'state','questions');
  await mkdir(old,{recursive:true});await mkdir(decisions,{recursive:true});await mkdir(questions,{recursive:true});
  const item=(n,more={})=>({id:'I-'+n,type:'authorization',mission:'M-1',project:'alpha',issue:'XJ-1',ticket:'XJ-2',question:'Q-'+n,title:'Migration '+n,summary:null,text:'Autoriser ?',recommendation:'Autoriser',options:['Autoriser','Refuser'],why:'',consequences:'',blocked:[],proofs:[],to:'legacyOwner',priority:2,state:'pending',draft:'',decision:null,createdAt:'2026-11-01T09:00:00.000Z',updatedAt:'2026-11-01T09:00:00.000Z',error:null,...more});
  const question=(n,more={})=>({id:'Q-'+n,mission:'M-1',ticket:'XJ-2',from:'lead',fromTab:null,question:'x',options:[],askedAt:'t',state:'escalated',answer:null,delivery:null,item:'I-'+n,source:null,routedAt:null,...more});
  const oldPrint=async value=>{const {createHash}=await import('node:crypto');const beside=['state','draft','decision','updatedAt','error','priority','delegatingAt','delegatedAt','discussedAt','closedBy','replacedBy'];return createHash('sha256').update(JSON.stringify([Object.keys(value).filter(key=>!beside.includes(key)).sort().map(key=>[key,value[key]]),['Autoriser','Refuser']])).digest('hex');};
  const put=async(folder,value)=>writeFile(join(folder,value.id+'.json'),JSON.stringify(value,null,2)+'\n');
  // 1: open, never answered. 2: a decision reserved and never written. 3: a decision given on another print.
  // 4: a question that points elsewhere. 5: certain. 6: resolved.
  const five=item(5,{state:'answered',decision:'D-5'});
  for(const value of [item(1),item(2,{decision:'D-2'}),item(3,{state:'answered',decision:'D-3'}),item(4,{state:'answered',decision:'D-4'}),five,item(6,{state:'resolved'})])await put(old,value);
  for(const n of [1,2,3,5,6])await put(questions,question(n));
  await put(questions,question(4,{item:'I-1'}));
  await put(decisions,{id:'D-3',item:'I-3',mission:'M-1',question:'Q-3',choice:'Autoriser',text:'Autoriser',seen:'a'.repeat(64),by:'legacyOwner',at:'2026-11-01T10:00:00.000Z'});
  await put(decisions,{id:'D-4',item:'I-4',mission:'M-1',question:'Q-4',choice:'Autoriser',text:'Autoriser',seen:await oldPrint(item(4,{state:'answered',decision:'D-4'})),by:'legacyOwner',at:'2026-11-01T10:00:00.000Z'});
  await put(decisions,{id:'D-5',item:'I-5',mission:'M-1',question:'Q-5',choice:'Refuser',text:'Refuser',seen:await oldPrint(five),by:'legacyOwner',at:'2026-11-01T10:00:00.000Z'});
  await writeFile(join(f.root,'state','ids.json'),JSON.stringify({M:1,Q:6,I:6,D:5}));
  const before=Object.fromEntries(await Promise.all((await readdir(old)).map(async name=>[name,await readFile(join(old,name),'utf8')])));
  const shown=await f.shown(),by=id=>shown.find(i=>i.id===id);
  assert.deepEqual(shown.map(i=>i.id).sort(),['I-1','I-2','I-3','I-4','I-5']);
  for(const id of ['I-1','I-2','I-3','I-4'])assert.deepEqual({legacy:by(id).legacy,state:by(id).state,error:by(id).error,answered:by(id).answered,decision:by(id).decision,answers:by(id).answers,seen:by(id).seen},{legacy:true,state:'error',error:UNCERTAIN,answered:null,decision:null,answers:[],seen:null},id);
  assert.deepEqual({legacy:by('I-5').legacy,state:by('I-5').state,answered:by('I-5').answered,decision:by('I-5').decision,seen:by('I-5').seen},{legacy:true,state:'answered',answered:'Refuser',decision:'D-5',seen:null},'the one certain answer is shown as it was given');
  // None of them takes an answer, by any way in.
  for(const id of ['I-1','I-2','I-3','I-4','I-5']) {
    for(const seen of [await oldPrint(item(Number(id.slice(2)))),'a'.repeat(64)])await assert.rejects(()=>f.actions.click({item:id,choice:'Autoriser',text:'Autoriser',seen}),e=>e.code==='QUESTION_CLOSED',id);
    await assert.rejects(()=>f.actions.decide({item:id,choice:'Autoriser',text:'Autoriser',seen:'a'.repeat(64)}),e=>e.code==='CLICK_REQUIRED',id);
    assert.equal((await f.inbox.mark(id,{state:'resolved'})).changed,false);assert.equal((await f.inbox.settle(id)).settled,'none');
  }
  await f.pass(3,2);
  assert.deepEqual(f.sent,[],'nothing of before is carried');
  const kept=join(await archiveFolder(f.root),'state','inbox');
  assert.deepEqual(Object.fromEntries(await Promise.all((await readdir(kept)).filter(name=>name.endsWith('.json')).map(async name=>[name,await readFile(join(kept,name),'utf8')]))),before,'the files of before are in the archive, as they were');
  assert.deepEqual(await readdir(old).catch(()=>[]),[],'and no longer where the code reads');
  assert.deepEqual(await f.requests(),[],'and nothing was copied');
  // What still matters is asked again: a new request, a new identifier, a new print, no answer.
  const {item:fresh,created}=await f.actions.escalate({mission:'M-1',ticket:'XJ-2',type:'authorization',title:'Migration 2',text:'Autoriser ?',recommendation:'Autoriser',why:'x',options:['Autoriser','Refuser']});
  assert.equal(created,true);assert.equal(fresh.id,'I-7','the numbers go on');assert.equal(fresh.answer,null);assert.equal(fresh.version,printOf(fresh));
  assert.deepEqual((await f.inbox.decisions({})).map(d=>d.id),[],'the decisions of before are no longer read');
  assert.deepEqual((await readdir(join(await archiveFolder(f.root),'state','decisions'))).sort(),['D-3.json','D-4.json','D-5.json'],'they are kept in the archive');
  await holds(f);
});

test('a question of before carrying an answer of the user never delivers nor relays it: it is archived as it was, never sent to the Lead',async t=>{
  const f=await desk(t),old=join(f.root,'state','inbox'),questions=join(f.root,'state','questions');
  await mkdir(old,{recursive:true});await mkdir(questions,{recursive:true});
  const put=async(folder,value)=>writeFile(join(folder,value.id+'.json'),JSON.stringify(value,null,2)+'\n');
  const said=n=>({text:'Autoriser',by:'legacyOwner',decision:'D-'+n,at:'2026-11-01T10:00:00.000Z'});
  const question=(n,more={})=>({id:'Q-'+n,mission:'M-1',ticket:'XJ-2',from:'dev',fromTab:'XJ-2 · dev',question:'Migrer la base ?',options:['Autoriser','Refuser'],askedAt:'2026-11-01T09:00:00.000Z',state:'answered',answer:null,delivery:null,item:'I-'+n,source:'XJ-2.ask-'+n+'.json',routedAt:'2026-11-01T09:01:00.000Z',...more});
  // 1: an agreement of before, in its place, waiting to be delivered. 2: one kept aside while the Lead was to pass it on.
  // 3: one given on a question of the Lead.
  await put(questions,question(1,{answer:said(1)}));
  await put(questions,question(2,{state:'open',legacyOwner:said(2)}));
  await put(questions,question(3,{from:'lead',fromTab:null,ticket:null,source:null,answer:said(3)}));
  for(const n of [1,2,3])await put(old,{id:'I-'+n,type:'authorization',mission:'M-1',ticket:n===3?null:'XJ-2',question:'Q-'+n,title:'Migration '+n,text:'Autoriser ?',options:['Autoriser','Refuser'],state:'answered',decision:'D-'+n,createdAt:'2026-11-01T09:00:00.000Z'});
  await writeFile(join(f.root,'state','ids.json'),JSON.stringify({M:1,Q:3,I:3,D:3}));
  const before=Object.fromEntries(await Promise.all([1,2,3].map(async n=>['Q-'+n,await readFile(join(questions,'Q-'+n+'.json'),'utf8')])));
  await f.pass(3,2);
  assert.deepEqual(f.sent,[],'nothing is relayed to the Lead, nothing is delivered');
  f.leadGone=true;await f.pass(3,2);
  assert.deepEqual(f.sent,[],'nor once the Lead is gone');
  const kept=join(await archiveFolder(f.root),'state','questions');
  for(const n of [1,2,3]) {
    await assert.rejects(()=>f.questions.read('Q-'+n),e=>e.code==='NOT_FOUND','Q-'+n+' is no longer where the code reads');
    assert.equal(await readFile(join(kept,'Q-'+n+'.json'),'utf8'),before['Q-'+n],'Q-'+n+' is in the archive, as it was');
  }
  assert.equal((await f.shown()).filter(item=>item.legacy&&item.authorizes===false).length,3,'the requests of before are still shown, as of no value as a permission');
});

test('an answer of the user in a question goes on only as the requests recorded it, word for word, on the version of its request',async t=>{
  const edit=async(f,folder,id,change)=>{const path=join(f.root,'state',folder,id+'.json'),value=JSON.parse(await readFile(path,'utf8'));change(value);await writeFile(path,JSON.stringify(value,null,2)+'\n');};
  for(const [label,tamper] of [
    ['other words in the question',f=>edit(f,'questions','Q-1',q=>{q.answer.text='Client';})],
    ['another choice in the question',f=>edit(f,'questions','Q-1',q=>{q.answer.choice='Client';})],
    ['a request whose words changed after its answer',f=>edit(f,'requests','I-1',item=>{item.text='Autre chose ?';})],
  ]) {
    const f=await desk(t);await f.asked();
    const {item}=await f.actions.escalate({...CHOICE,question:'Q-1',ticket:'XJ-2'});
    await click(f,await f.one(item.id),'Serveur');
    assert.equal((await f.questions.read('Q-1')).answer.decision,'D-1',label+': the answer is in its question');
    await tamper(f);
    await f.pass(3,2);
    assert.deepEqual(f.sent,[],label+': nothing is relayed nor delivered');
    f.leadGone=true;await f.pass(3,2);
    assert.deepEqual(f.sent,[],label+': nor once the Lead is gone');
    assert.equal((await f.questions.read('Q-1')).unsure,true,label+': the question is said uncertain');
  }
});

// ---- The lock that waits.

test('a lock that waits tries the lock again, never the task: once entered, a task runs once whatever comes out of it',async t=>{
  const root=await realpath(await mkdtemp(join(tmpdir(),'fabrique-console-waitlock-')));t.after(()=>rm(root,{recursive:true,force:true}));
  const outer=join(root,'outer'),inner=join(root,'inner');let runs=0;
  // The inner lock is held by someone else: the task that meets it fails, and is not played again.
  await withLock(inner,async()=>{
    await assert.rejects(()=>waitLock(outer,async()=>{runs++;await withLock(inner,async()=>{});},{tries:20}),e=>e.code==='BUSY');
  });
  assert.equal(runs,1);
  await assert.rejects(()=>waitLock(outer,async()=>{runs++;throw Object.assign(new Error('x'),{code:'BUSY'});},{tries:20}),e=>e.code==='BUSY');
  assert.equal(runs,2,'a task that says BUSY by itself is not run again either');
  // Held when it is asked for, the lock itself is waited for.
  let entered=0;
  const first=waitLock(outer,async()=>{entered++;await new Promise(done=>setTimeout(done,60));return 'a';}),second=new Promise(done=>setTimeout(done,10)).then(()=>waitLock(outer,async()=>{entered++;return 'b';}));
  assert.deepEqual(await Promise.all([first,second]),['a','b']);assert.equal(entered,2);
});

test('the lock of a process that died is free at once for the next one',async t=>{
  const root=await realpath(await mkdtemp(join(tmpdir(),'fabrique-console-waitlock-')));t.after(()=>rm(root,{recursive:true,force:true}));
  const child=fork(new URL('./helpers/lock-lifetime-process.mjs',import.meta.url),[root],{silent:true});
  t.after(()=>{try{child.kill('SIGKILL');}catch{}});
  await new Promise((done,refuse)=>{child.once('message',message=>message.entered?done():refuse(new Error('not entered')));child.once('error',refuse);});
  await assert.rejects(()=>waitLock(root,async()=>'in',{tries:3}),e=>e.code==='BUSY','held by a process that lives');
  child.kill('SIGKILL');await new Promise(done=>child.once('exit',done));
  assert.equal(await waitLock(root,async()=>'in',{tries:200}),'in');
});
