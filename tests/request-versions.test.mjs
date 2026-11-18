import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { desk, click, holds } from './helpers/requests.mjs';
import { createMockups } from '../src/mockups.mjs';
import { createPilot, decisionPrompt, missionPrompt, requestMessage } from '../src/pilot.mjs';
import { printOf } from '../src/requests.mjs';
import { mockupShown, mockupPick } from '../mods/fabrique-console-v4-mockup/nav.js';

import { fakeHerdr } from './helpers/fake-herdr.mjs';
// An agreement of the user holds for the request he saw, and for no other: a request never changes, other words are
// another request, and no answer is recorded without the version that was shown. The scenarios the three reviews of the
// code reproduced, each by its name. Everything here runs on test data.
const LOCAL={mission:'M-1',ticket:'XJ-2',type:'authorization',title:'Migration 0026',text:'Autoriser la migration 0026 sur la base locale ?',recommendation:'Autoriser',why:'Base de test',options:['Autoriser','Refuser']};
const PROD={...LOCAL,text:'Autoriser la migration 0026 sur la base de production ?',why:'Mise en service'};
const CHOICE={mission:'M-1',ticket:'XJ-3',type:'decision',title:'Repli',text:'Client ou serveur ?',recommendation:'Serveur',why:'Coût',options:['Serveur','Client']};
const noVersion=e=>e.code==='SEEN_REQUIRED'&&e.message==='Read this request again, then answer.',changed=e=>e.code==='REQUEST_CHANGED'&&e.message==='This request changed. Review it, then answer again.';

test('(a) review 1 and 2 — local then production, then « Autoriser » without a version: refused, and nothing is recorded',async t=>{
  const f=await desk(t);await f.actions.escalate(LOCAL);
  const [local]=await f.shown();
  const again=await f.actions.escalate(PROD),[prod,...others]=await f.shown();
  assert.deepEqual(others,[],'one request waits');
  assert.notEqual(prod.id,local.id,'the request for production is another request');assert.equal(again.item.id,prod.id);assert.equal(again.created,true);assert.equal(again.replaced,local.id);
  assert.equal(prod.text,PROD.text);assert.equal(prod.decision,null);assert.equal(prod.state,'pending');assert.equal(prod.replaces,local.id);
  const before=await f.inbox.read(local.id);
  assert.equal(before.text,LOCAL.text,'the first request keeps its words');assert.equal(before.answer,null);assert.equal(before.version,local.seen,'and nothing was written in it: it is said replaced by the one that replaces it');
  await assert.rejects(()=>f.actions.click({item:prod.id,choice:'Autoriser',text:'Autoriser'}),noVersion,'without a version');
  await assert.rejects(()=>f.actions.click({item:local.id,choice:'Autoriser',text:'Autoriser'}),noVersion,'without a version, on the request that was replaced');
  await assert.rejects(()=>f.inbox.answer({item:prod.id,choice:'Autoriser',text:'Autoriser',via:'screen'}),noVersion,'the registry itself records nothing without a version');
  await assert.rejects(()=>click(f,local,'Autoriser'),changed,'the window still on the local request');
  await assert.rejects(()=>f.actions.click({item:prod.id,choice:'Autoriser',text:'Autoriser',seen:local.seen}),changed,'the version of another request');
  assert.deepEqual(await f.inbox.decisions({}),[],'no decision');
  assert.equal((await f.questions.read(prod.question)).state,'escalated','the question still waits');
  assert.equal(f.notified.length,1,'a request replaced before any answer notifies nobody again');
  await holds(f);
});

test('(b) review 2 — agreement on the local request, then production: a new request without an answer, and « Refuser » is a refusal',async t=>{
  const f=await desk(t);await f.actions.escalate(LOCAL);
  const [local]=await f.shown();
  const yes=await click(f,local,'Autoriser');
  assert.equal(yes.created,true);assert.equal(yes.decision.seen,local.seen,'the agreement names the version it was given on');
  const again=await f.actions.escalate(PROD),prod=await f.one(again.item.id);
  assert.notEqual(prod.id,local.id);assert.equal(again.created,true);assert.equal(again.replaced,undefined,'a request answered is not replaced');
  assert.equal(prod.text,PROD.text);assert.equal(prod.decision,null,'the agreement does not follow');assert.equal(prod.state,'pending');assert.equal(prod.answered,null,'no answer is shown on it');
  assert.notEqual(prod.question,local.question,'it waits in a question of its own');assert.equal((await f.questions.read(prod.question)).state,'escalated');
  const kept=await f.inbox.read(local.id);
  assert.equal(kept.text,LOCAL.text);assert.equal(kept.answer.id,yes.decision.id,'the agreement stays on the request it was given on');assert.equal(kept.state,'answered');
  assert.equal(f.notified.length,2,'a new request after an agreement is said');
  const no=await click(f,prod,'Refuser');
  assert.equal(no.created,true);assert.equal(no.decision.text,'Refuser');assert.equal(no.decision.choice,'Refuser');assert.notEqual(no.decision.id,yes.decision.id);
  assert.equal(no.decision.item,prod.id);assert.equal(no.decision.seen,prod.seen);
  assert.deepEqual((await f.inbox.decisions({})).map(d=>[d.item,d.text]),[[local.id,'Autoriser'],[prod.id,'Refuser']]);
  assert.deepEqual((await f.questions.read(prod.question)).answer.text,'Refuser','the refusal is what goes back');
  assert.equal((await f.questions.read(local.question)).answer.text,'Autoriser');
  assert.equal((await click(f,local,'Refuser')).decision.id,yes.decision.id,'another answer on the local request is its first decision');
  assert.equal((await f.inbox.read(local.id)).answer.text,'Autoriser','never written again');
  await holds(f);
});

test('(c) reviews 1 to 3 — two answers at once: one wins, tied to the version it was given on',async t=>{
  const f=await desk(t);await f.actions.escalate(LOCAL);
  const [local]=await f.shown();
  const both=await Promise.all(['Autoriser','Refuser','Autoriser','Refuser'].map(text=>click(f,local,text)));
  assert.equal(both.filter(made=>made.created).length,1);assert.equal(new Set(both.map(made=>made.decision.id)).size,1);assert.equal(new Set(both.map(made=>made.decision.text)).size,1);
  assert.equal((await f.inbox.decisions({})).length,1);assert.equal(both[0].decision.seen,local.seen);
  await holds(f);
  // Replaced and answered at once, many times: whatever the order, the request for production has no answer, and an
  // answer recorded names the local request and its version.
  for(let round=0;round<8;round++) {
    const g=await desk(t);await g.actions.escalate(LOCAL);
    const [first]=await g.shown();
    const [raised,answer]=await Promise.allSettled([g.actions.escalate(PROD),click(g,first,'Autoriser')]);
    assert.equal(raised.status,'fulfilled');
    const prod=await g.inbox.read(raised.value.item.id),decisions=await g.inbox.decisions({});
    assert.notEqual(prod.id,first.id);assert.equal(prod.text,PROD.text);assert.equal(prod.answer,null,'round '+round);
    if(answer.status==='rejected'){assert.equal(answer.reason.code,'REQUEST_CHANGED');assert.deepEqual(decisions,[]);}
    else {assert.deepEqual(decisions.map(d=>[d.item,d.seen]),[[first.id,first.seen]]);assert.equal((await g.inbox.read(first.id)).text,LOCAL.text);}
    const no=await click(g,await g.one(prod.id),'Refuser');
    assert.equal(no.created,true);assert.equal(no.decision.text,'Refuser');
    await holds(g,'round '+round);
  }
});

test('(d) review 2 — the page and the Inbox: an answer, a choice left to the Lead, never without the version shown',async t=>{
  const f=await desk(t);await f.actions.escalate(CHOICE);
  const [item]=await f.shown();
  await assert.rejects(()=>f.actions.click({item:item.id,choice:'Serveur',text:'Serveur'}),noVersion,'a decision too');
  await assert.rejects(()=>f.actions.decide({item:item.id,choice:'Serveur',text:'Serveur'}),noVersion,'by Pilot too');
  await assert.rejects(()=>f.lead.delegate({item:item.id}),noVersion);
  assert.deepEqual(f.sent,[]);assert.deepEqual(await f.inbox.decisions({}),[]);assert.equal((await f.inbox.read(item.id)).state,'pending');
  const next=await f.actions.escalate({...CHOICE,text:'Client, serveur ou les deux ?'});
  await assert.rejects(()=>f.lead.delegate({item:item.id,seen:item.seen}),changed,'left to the Lead from a window on the words of before');
  assert.deepEqual(f.sent,[]);
  const now=await f.one(next.item.id);
  assert.deepEqual(await f.lead.delegate({item:now.id,seen:now.seen}),{item:now.id,delegated:true});assert.equal(f.sent.length,1);
  // What both screens send (ui/v4/look.js): the version of the request they showed, with each of the three answers.
  const look=await readFile(new URL('../ui/v4/look.js',import.meta.url),'utf8');
  for(const command of ['inbox-answer','inbox-delegate','mockup-pick'])assert.match(look,new RegExp("api\\(mod,'"+command+"',\\{[^}]*\\.\\.\\.asShown\\(item\\)\\}"),command);
  await holds(f);
});

test('(d) review 1 and 2 — the screen of the mockups: a choice for a request goes with its version, a mockup of no request has none',async t=>{
  const f=await desk(t),allowed=join(f.root,'mockups'),folder=join(allowed,'xj','lots'),appHome=join(f.root,'app');
  await mkdir(folder,{recursive:true});await mkdir(appHome);
  for(const name of ['a.html','b.html'])await writeFile(join(folder,name),'<p>x');
  const mockups=createMockups({root:f.root,registry:f.missions,inbox:f.inbox,allowed,appHome,decide:f.actions.choose,loadState:async()=>({sessions:f.sessions}),send:async message=>{f.sent.push(message);return {sent:true};},capture:async(_file,out)=>{await writeFile(out,'png');return {width:1440,height:2880};}});
  await f.actions.escalate(CHOICE);
  const [item]=await f.shown(),{mockup}=await mockups.publish({mission:'M-1',title:'Lots',folder,item:item.id}),drawn=mockupPick(mockupShown(null,mockup,[item]),'M-1','a','');
  await assert.rejects(()=>mockups.pick({...drawn,seen:undefined}),noVersion);
  assert.deepEqual(await f.inbox.decisions({}),[]);assert.equal((await f.missions.read('M-1')).mockups[0].picked,null);assert.deepEqual(f.sent,[]);
  assert.deepEqual(await mockups.pick(drawn),{mockup:mockup.id,variant:'a'});
  const [decision]=await f.inbox.decisions({});assert.equal(decision.item,item.id);assert.equal(decision.seen,item.seen);
  // After the request was closed or left to the Lead, two windows left open make no message to the Lead (review 1).
  const other=(await f.actions.escalate({...CHOICE,ticket:'XJ-5'})).item,second=join(allowed,'xj','second');await mkdir(second);await writeFile(join(second,'a.html'),'<p>x');
  const kit=(await mockups.publish({mission:'M-1',title:'Second',folder:second,item:other.id})).mockup,late=mockupPick(mockupShown(null,kit,await f.shown()),'M-1','a','');
  await f.lead.delegate({item:other.id,seen:other.version});
  const told=f.sent.length;
  for(const window of [1,2])await assert.rejects(()=>mockups.pick(late),e=>e.code==='QUESTION_CLOSED','window '+window);
  assert.equal(f.sent.length,told,'nothing more is told to the Lead');
  // Tied to no request, a mockup records no agreement: its choice is a message to the Lead, tied to its publication.
  const third=join(allowed,'xj','autre');await mkdir(third);await writeFile(join(third,'a.html'),'<p>x');
  const free=(await mockups.publish({mission:'M-1',title:'Autre',folder:third})).mockup;
  assert.deepEqual(await mockups.pick({mission:'M-1',mockup:free.id,variant:'a',published:free.pub}),{mockup:free.id,variant:'a'});assert.equal(f.sent.length,told+1);
  await holds(f);
});

test('(d) review 2 and 3 — Pilot: it records with the version of the request it read, and reads again when it is refused',async t=>{
  const f=await desk(t);await f.actions.escalate(CHOICE);
  const [asked]=await f.shown(),calls=[];
  const pilot=createPilot({root:f.root,herdr:fakeHerdr({on:async(_hc,args)=>{calls.push(args);return {stdout:args[0]==='run'?'{"id":"t21"}':'{}'};}}).herdr,readTerminals:async()=>[],missions:f.missions,questions:f.questions,inbox:f.inbox,loadConfig:async()=>({projects:[]}),readRole:async()=>'ROLE',wait:async()=>{},agentFolder:f.root});
  // The prompt of a request: the command Pilot runs names the version of what it was given to read.
  const text=decisionPrompt({role:'ROLE',item:await f.inbox.read(asked.id),dossier:{request:{id:asked.id,seen:asked.seen},mission:{id:'M-1'}},folder:f.root,cli:'/c.mjs',node:'/n'});
  assert.ok(text.includes('"seen":"'+asked.seen+'"'),'in the command');assert.match(text,/REQUEST_CHANGED/);assert.match(text,/SEEN_REQUIRED/);assert.match(text,/inbox-list/);
  const told=requestMessage({item:await f.inbox.read(asked.id),dossier:{request:{id:asked.id,seen:asked.seen}},cli:'/c.mjs',node:'/n'});
  assert.ok(told.includes('"seen":"'+asked.seen+'"'));assert.match(told,/REQUEST_CHANGED/);
  const whole=missionPrompt({role:'ROLE',mission:{id:'M-1'},dossier:{waiting:[{id:asked.id,seen:asked.seen}]},folder:f.root,cli:'/c.mjs',node:'/n'});
  assert.match(whole,/"seen":"/);assert.match(whole,/REQUEST_CHANGED/);assert.ok(whole.includes(asked.seen),'each request that waits is given with its version');
  // What Pilot is really given, on a request then on a development.
  const {item:own}=await f.inbox.ask({type:'decision',mission:'M-1',project:null,ticket:'XJ-7',title:'Pousser',text:'Pousser la branche ?',options:['Oui','Non']});
  await pilot.open({item:own.id});
  const launched=calls.find(args=>args[0]==='run')?.at(-1)||'';
  assert.ok(launched.includes('"item":"'+own.id+'","seen":"'+own.version+'"'),'the command it is launched with names the version');assert.ok(launched.includes('"seen": "'+own.version+'"'),'and so does the file of the request');
  // Its command without a version, as an older conversation would send it, is refused; so is the version of before.
  await assert.rejects(()=>f.actions.decide({item:asked.id,choice:'Serveur',text:'the user choisit le serveur'}),noVersion);
  const again=await f.actions.escalate({...CHOICE,text:'Client, serveur ou les deux ?'});
  await assert.rejects(()=>f.actions.decide({item:again.item.id,choice:'Serveur',text:'the user choisit le serveur',seen:asked.seen}),changed,'it must read again and ask again');
  assert.deepEqual(await f.inbox.decisions({}),[]);
  const now=await f.one(again.item.id),made=await f.actions.decide({item:now.id,text:'the user choisit le serveur',seen:now.seen});
  assert.equal(made.created,true);assert.equal(made.decision.via,'agent');
  await holds(f);
});

test('(e) the ordinary Inbox: the same request again is the same request, and an answer given on what is shown is recorded',async t=>{
  const f=await desk(t);
  const first=await f.actions.escalate(CHOICE),[item]=await f.shown();
  assert.equal(first.created,true);assert.equal(first.replaced,undefined);assert.equal(item.replaces,undefined);assert.deepEqual(item.answers,['Serveur','Client']);
  const same=await f.actions.escalate(CHOICE);
  assert.equal(same.created,false);assert.equal(same.item.id,item.id);assert.equal(same.replaced,undefined);
  const [again,...others]=await f.shown();
  assert.deepEqual(others,[]);assert.deepEqual(again,item,'nothing of it moved, its version neither');assert.equal(f.notified.length,1);
  const made=await click(f,item,'Serveur');
  assert.equal(made.created,true);assert.equal(made.item.state,'answered');assert.equal((await f.questions.read(item.question)).answer.text,'Serveur');
  assert.equal((await f.actions.escalate(CHOICE)).item.id,item.id,'the same words again after the answer make no new request');
  assert.equal((await f.shown()).length,1);assert.equal(f.notified.length,1);
  assert.equal((await f.one(item.id)).answered,'Serveur');assert.equal((await f.one(item.id)).decision,made.decision.id);
  // An alert said again at each pass of the watcher stays one alert, answered or not.
  const stuck={type:'stuck',cause:'merge',mission:'M-1',ticket:'XJ-4',question:null,title:'Bloqué',text:'t',blocked:['XJ-4'],proofs:[]};
  const alert=(await f.inbox.ask(stuck)).item;
  await f.inbox.mark(alert.id,{state:'error',error:'e'});
  assert.equal((await f.inbox.ask(stuck)).item.id,alert.id);
  await f.inbox.answer({item:alert.id,text:'Vu',seen:alert.version,via:'screen'});
  assert.equal((await f.inbox.ask(stuck)).item.id,alert.id);assert.equal((await f.inbox.ask(stuck)).created,false);
  await holds(f);
});

test('review 2 and 3 — the answers a request offers are worked out once: those of its question are copied, and are part of its version',async t=>{
  const f=await desk(t);
  const {question}=await f.asked({ticket:'XJ-5',fromTab:'XJ-5 · dev',source:'XJ-5.ask-1.json'});
  await f.actions.escalate({mission:'M-1',question:question.id,type:'decision',title:'Rôle',text:'Lequel ?',recommendation:'A',why:'x'});
  const [item]=await f.shown();
  assert.deepEqual(item.answers,['A','B']);assert.deepEqual(item.source,{id:question.id,question:'Quel rôle ?',options:['A','B']});
  // The print covers the answers, the question it comes from, the one its answer goes to, and its own identifier.
  for(const change of [{answers:['A','C']},{source:{...item.source,options:['A','C']}},{source:{...item.source,id:'Q-9'}},{recipient:{...item.recipient,fromTab:'XJ-9 · dev'}},{question:'Q-9'},{id:'I-9'},{replaces:'I-9'},{text:'Lequel, au juste ?'},{type:'authorization'},{scope:'production'}])
    assert.notEqual(printOf({...await f.inbox.read(item.id),...change}),item.seen,JSON.stringify(change));
  assert.equal(printOf({...await f.inbox.read(item.id),state:'opening',discussedAt:'2026-01-01T00:00:00.000Z',error:'e'}),item.seen,'what is kept beside the request is no part of it');
  // A file of a request changed by hand no longer is the request that was shown: nothing is recorded on it.
  const path=join(f.root,'state','requests',item.id+'.json'),kept=JSON.parse(await readFile(path,'utf8'));
  await writeFile(path,JSON.stringify({...kept,text:'Lequel, en production ?'}));
  await assert.rejects(()=>click(f,item,'A'),changed);
  await writeFile(path,JSON.stringify({...kept,text:'Lequel, en production ?',version:printOf({...kept,text:'Lequel, en production ?'})}));
  await assert.rejects(()=>click(f,item,'A'),changed,'even with a print made again: it is not the version that was shown');
  await writeFile(path,JSON.stringify(kept));
  // Same words of the Lead, another question with other answers (review 3): another request, another version.
  const other=(await f.asked({ticket:'XJ-5',fromTab:'XJ-5 · dev',question:'Et en production ?',options:['Oui','Non'],source:'XJ-5.ask-2.json'})).question;
  const next=await f.actions.escalate({mission:'M-1',question:other.id,type:'decision',title:'Rôle',text:'Lequel ?',recommendation:'A',why:'x'}),second=await f.one(next.item.id);
  assert.notEqual(second.id,item.id);assert.notEqual(second.seen,item.seen);assert.deepEqual(second.answers,['Oui','Non']);assert.equal((await f.shown()).length,2,'both wait');
  await assert.rejects(()=>f.actions.click({item:second.id,choice:'A',text:'A',seen:item.seen}),changed,'what was seen of the first answers nothing on the second');
  await click(f,item,'A');
  assert.equal((await f.questions.read(question.id)).answer.text,'A');assert.equal((await f.questions.read(other.id)).answer,null);assert.equal((await f.one(second.id)).answered,null);
  // Other words for the same question: the new request waits in that question, and the old one takes no answer.
  const third=await f.actions.escalate({mission:'M-1',question:other.id,type:'decision',title:'Rôle',text:'Lequel, au juste ?',recommendation:'A',why:'x'});
  assert.equal(third.replaced,second.id);assert.equal(third.item.question,other.id);
  await assert.rejects(()=>click(f,second,'Oui'),changed);
  await click(f,await f.one(third.item.id),'Non');
  assert.equal((await f.questions.read(other.id)).answer.text,'Non');
  await holds(f);
});
