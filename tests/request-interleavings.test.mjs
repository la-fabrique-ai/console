import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { desk, click, holds, sentAbout } from './helpers/requests.mjs';
import { UNCERTAIN } from '../src/requests.mjs';

// What happens inside an operation, not only between two of them: an answer of the Lead that arrives while a request
// is being made or replaced, and an answer of the user carried again after a crash, after it was relayed, delivered,
// taken in. The rule (tests/helpers/requests.mjs, `holds`) is checked after each step. Test data only.
const LOCAL={mission:'M-1',question:'Q-1',type:'authorization',title:'Migration 0026',text:'Autoriser la migration 0026 sur la base locale ?',recommendation:'Autoriser',why:'Base de test',options:['Autoriser','Refuser']};
const PROD={...LOCAL,text:'Autoriser la migration 0026 sur la base de production ?',why:'Mise en service'};
const CHOICE={mission:'M-1',ticket:'XJ-3',type:'decision',title:'Repli',text:'Client ou serveur ?',recommendation:'Serveur',why:'Coût',options:['Serveur','Client']};
const crash=point=>async at=>{if(at===point)throw new Error('crash at '+point);};
const closedForLead=e=>e.code==='QUESTION_CLOSED';

// ---- lead-answer against the making of a request.

test('the Lead answered first: the request does not take its question, it waits in a question of the Lead',async t=>{
  const f=await desk(t);await f.asked();
  await f.actions.answer({question:'Q-1',text:'Garde roles.ts'});
  const {item}=await f.actions.escalate(LOCAL);
  assert.notEqual(item.question,'Q-1');assert.equal(item.source,null);assert.equal(item.recipient.from,'lead');
  const q=await f.questions.read('Q-1');assert.equal(q.state,'answered');assert.equal(q.answer.text,'Garde roles.ts');assert.equal(q.answer.by,'lead');
  await click(f,await f.one(item.id),'Autoriser');
  assert.equal((await f.questions.read('Q-1')).answer.by,'lead','the answer of the user does not land on the question the Lead answered');
  assert.equal((await f.questions.read(item.question)).answer.text,'Autoriser');
  await holds(f);
});

test('the Lead answers while the request is being made, after its question is held: refused, and the request has its question',async t=>{
  const f=await desk(t);await f.asked();
  let during=null;
  f.probe=async at=>{if(at==='ask:held')during=await f.actions.answer({question:'Q-1',text:'Garde roles.ts'}).then(()=>'answered',e=>e.code);};
  const {item}=await f.actions.escalate(LOCAL);f.probe=null;
  assert.equal(during,'QUESTION_CLOSED','no third outcome: the request exists, so the Lead is refused');
  assert.equal(item.question,'Q-1');assert.deepEqual(item.source,{id:'Q-1',question:'Quel rôle ?',options:['A','B']});assert.deepEqual(item.recipient,{question:'Q-1',from:'dev',fromTab:'XJ-2 · dev',ticket:'XJ-2',mission:'M-1'});
  const q=await f.questions.read('Q-1');assert.equal(q.state,'escalated');assert.equal(q.answer,null);
  await holds(f);
});

test('the Lead answers between the reading of the question and its hold: the request falls back on a question of the Lead',async t=>{
  let armed=false,real;
  const f=await desk(t,{wrapQuestions:q=>{real=q;return {...q,read:async id=>{const found=await q.read(id);if(armed){armed=false;await q.leadAnswer(id,'Garde roles.ts');}return found;}};}});
  await f.asked();armed=true;
  const {item}=await f.actions.escalate(LOCAL);
  assert.notEqual(item.question,'Q-1');assert.equal(item.source,null);assert.equal(item.recipient.from,'lead');
  assert.equal((await real.read('Q-1')).answer.by,'lead');assert.deepEqual(item.answers,['Autoriser','Refuser']);
  assert.equal((await f.shown()).length,1);
  await holds(f);
});

test('a crash after the question is held and before the request is written: the same escalation again makes the one request',async t=>{
  const f=await desk(t);await f.asked();
  f.probe=crash('ask:held');
  await assert.rejects(()=>f.actions.escalate(LOCAL),/crash/);f.probe=null;
  assert.deepEqual(await f.requests(),[],'nothing was written');
  assert.equal((await f.questions.read('Q-1')).state,'escalated');
  await assert.rejects(()=>f.actions.answer({question:'Q-1',text:'x'}),closedForLead,'the Lead cannot answer a question that is held');
  const {item,created}=await f.actions.escalate(LOCAL);
  assert.equal(created,true);assert.equal(item.question,'Q-1');assert.equal((await f.shown()).length,1);assert.equal(f.notified.length,1);
  await holds(f);
});

test('a crash after the request is written: the same escalation again finds it, and nobody is notified twice',async t=>{
  const f=await desk(t);await f.asked();
  f.probe=crash('ask:written');
  await assert.rejects(()=>f.actions.escalate(LOCAL),/crash/);f.probe=null;
  const again=await f.actions.escalate(LOCAL);
  assert.equal(again.created,false);assert.equal((await f.requests()).length,1);assert.equal((await f.shown()).length,1);
  await holds(f);
});

// ---- lead-answer against the replacement of a request.

test('the Lead answers while a request is being replaced: refused; the old request takes no answer, the new one does',async t=>{
  const f=await desk(t);await f.asked();
  await f.actions.escalate(LOCAL);
  const [local]=await f.shown();
  let during=null;
  f.probe=async at=>{if(at==='ask:held'||at==='ask:asked')during=await f.actions.answer({question:'Q-1',text:'Oui'}).then(()=>'answered',e=>e.code);};
  const next=await f.actions.escalate(PROD);f.probe=null;
  assert.equal(during,'QUESTION_CLOSED');assert.equal(next.replaced,local.id);assert.equal(next.item.replaces,local.id);assert.equal(next.item.question,'Q-1');
  assert.deepEqual((await f.shown()).map(item=>item.id),[next.item.id],'one request waits');
  const kept=(await f.requests()).find(item=>item.id===local.id);assert.equal(kept.text,LOCAL.text,'the request replaced keeps its words');assert.equal(kept.answer,null);
  await assert.rejects(()=>click(f,local,'Autoriser'),e=>e.code==='REQUEST_CHANGED'&&e.message==='This request changed. Review it, then answer again.');
  await assert.rejects(()=>f.actions.click({item:next.item.id,choice:'Autoriser',text:'Autoriser',seen:local.seen}),e=>e.code==='REQUEST_CHANGED','the print of another request');
  await holds(f);
  const prod=await f.one(next.item.id);
  await click(f,prod,'Refuser');
  assert.equal((await f.questions.read('Q-1')).answer.text,'Refuser');
  await holds(f);
});

test('an agreement written and not yet carried, then production cites the same question: the new request never shows the old agreement',async t=>{
  const f=await desk(t);await f.asked();
  await f.actions.escalate(LOCAL);
  const [local]=await f.shown();
  // The answer is written, and the engine stops before anything of it is carried.
  f.probe=crash('answer:written');
  await assert.rejects(()=>click(f,local,'Autoriser'),/crash/);f.probe=null;
  assert.equal((await f.questions.read('Q-1')).answer,null,'not carried yet');
  const next=await f.actions.escalate(PROD),prod=await f.one(next.item.id);
  assert.notEqual(prod.question,'Q-1','the question that carries an answer is not taken');assert.equal(prod.replaces,undefined,'a request answered is not replaced');assert.equal(prod.answered,null);assert.equal(prod.decision,null);
  await holds(f,'before the pass');
  await f.pass();
  const q=await f.questions.read('Q-1'),said=q.answer??q.legacyOwner;assert.equal(said.text,'Autoriser');assert.equal(said.decision,'D-1');
  const after=await f.one(prod.id);assert.equal(after.answered,null,'production still has no answer');assert.equal(after.decision,null);assert.equal(after.state,'pending');
  const no=await click(f,after,'Refuser');
  assert.equal(no.created,true);assert.equal(no.decision.text,'Refuser');assert.equal((await f.questions.read(prod.question)).answer.text,'Refuser');
  assert.deepEqual((await f.inbox.decisions({})).map(d=>[d.item,d.text]),[[local.id,'Autoriser'],[prod.id,'Refuser']]);
  await holds(f,'at the end');
});

test('replaced and answered at once, many times: production never has the answer given on local',async t=>{
  for(let round=0;round<6;round++) {
    const f=await desk(t);await f.asked();await f.actions.escalate(LOCAL);
    const [local]=await f.shown();
    const [raised,given]=await Promise.allSettled([f.actions.escalate(PROD),click(f,local,'Autoriser')]);
    assert.equal(raised.status,'fulfilled','round '+round);
    const prod=(await f.requests()).find(item=>item.id===raised.value.item.id);
    assert.equal(prod.answer,null);assert.equal(prod.text,PROD.text);
    if(given.status==='rejected')assert.equal(given.reason.code,'REQUEST_CHANGED');
    else assert.deepEqual((await f.inbox.decisions({})).map(d=>[d.item,d.seen]),[[local.id,local.seen]]);
    await f.pass();
    await holds(f,'round '+round);
  }
});

// ---- An answer carried again: after a crash, after the relay, after the delivery, after it is taken in.

test('a crash between the decision and the question: carried again, the decision is not written twice and the question gets it once',async t=>{
  const f=await desk(t);await f.asked();await f.actions.escalate(LOCAL);
  const [local]=await f.shown();
  f.probe=crash('settle:decided');
  await assert.rejects(()=>click(f,local,'Autoriser'),/crash/);f.probe=null;
  const path=join(f.root,'state','decisions','D-1.json'),before=await readFile(path,'utf8');
  assert.equal((await f.questions.read('Q-1')).answer,null);
  assert.equal((await f.inbox.settle(local.id)).settled,'inscribed');
  assert.equal(await readFile(path,'utf8'),before,'the decision is the one written first');
  const q=await f.questions.read('Q-1');assert.deepEqual({state:q.state,text:q.answer.text,by:q.answer.by,decision:q.answer.decision},{state:'answered',text:'Autoriser',by:'owner',decision:'D-1'});
  assert.equal((await f.inbox.settle(local.id)).settled,'already');
  const again=await click(f,local,'Refuser');assert.equal(again.created,false);assert.equal(again.decision.text,'Autoriser','a second window gets the first answer');
  await holds(f);
});

test('carried again after the relay, after the delivery and after it is taken in: nothing is opened again, nothing is written again, nothing is sent again',async t=>{
  const f=await desk(t);await f.asked();
  await f.pass();
  assert.equal(sentAbout(f,/Question du dev sur XJ-2 \(Q-1\)/).length,1,'the Lead is given the question');
  await f.actions.escalate(LOCAL);
  const [local]=await f.shown();
  await click(f,local,'Autoriser');
  const file=join(f.root,'state','questions','Q-1.json'),settleKeeps=async label=>{
    const before=await readFile(file,'utf8'),out=await f.inbox.settle(local.id);
    assert.equal(out.settled,'already',label);assert.equal(await readFile(file,'utf8'),before,label+': the question is not written');
    assert.notEqual((await f.inbox.read(local.id)).state,'error',label);
    await holds(f,label);
  };
  // Relayed: the question is open again for the Lead, and the answer of the user is kept aside (legacyOwner).
  await f.pass();
  let q=await f.questions.read('Q-1');assert.equal(q.state,'open');assert.equal(q.legacyOwner.decision,'D-1');assert.equal(q.answer,null);
  assert.equal(sentAbout(f,/legacyOwner-decision/).length,1);
  assert.match(sentAbout(f,/legacyOwner-decision/)[0].text,/"choix":"Autoriser"/,'the message says the exact choice');assert.match(sentAbout(f,/legacyOwner-decision/)[0].text,/"demande":"Migration 0026"/,'and the request');
  await settleKeeps('after the relay');
  await f.pass(2);assert.equal(sentAbout(f,/legacyOwner-decision/).length,1,'relayed once');
  // The Lead passes it on; it is delivered to the agent.
  await f.actions.answer({question:'Q-1',text:'the user autorise la migration locale.'});
  await f.pass();
  q=await f.questions.read('Q-1');assert.equal(q.state,'delivered');assert.equal(q.legacyOwner.decision,'D-1');
  assert.equal(f.sent.filter(message=>message.terminal==='t9').length,1);assert.equal((await f.inbox.read(local.id)).state,'delivered');
  await settleKeeps('after the delivery');
  const late=await click(f,local,'Refuser');assert.equal(late.created,false);assert.equal(late.decision.text,'Autoriser','a late answer changes nothing');
  // Taken in: the agent works again.
  f.tabs['XJ-2 · dev'].status='working';
  await f.pass();
  q=await f.questions.read('Q-1');assert.equal(q.state,'resolved');assert.equal((await f.inbox.read(local.id)).state,'resolved');
  await settleKeeps('after it is taken in');
  const total=f.sent.length;
  await f.pass(4,5);
  assert.equal(f.sent.length,total,'later passes send nothing');
  // The same question asked again after all this is another request, without an answer.
  const next=await f.actions.escalate(PROD),prod=await f.one(next.item.id);
  assert.notEqual(prod.id,local.id);assert.equal(prod.answered,null);assert.notEqual(prod.question,'Q-1');
  await holds(f,'at the end');
});

test('the question is no longer the one the request named: nothing is written in it, and the request is said uncertain',async t=>{
  const f=await desk(t);
  const {item}=await f.actions.escalate(CHOICE),shown=await f.one(item.id);
  // The answer is written; before it is carried, its question is closed by something else.
  f.probe=crash('answer:written');
  await assert.rejects(()=>click(f,shown,'Serveur'),/crash/);f.probe=null;
  assert.equal(await f.questions.close(item.question),true);
  const before=await readFile(join(f.root,'state','questions',item.question+'.json'),'utf8');
  assert.equal((await f.inbox.settle(item.id)).settled,'uncertain');
  assert.equal(await readFile(join(f.root,'state','questions',item.question+'.json'),'utf8'),before);
  const after=await f.one(item.id);assert.equal(after.state,'error');assert.equal(after.error,UNCERTAIN);assert.equal(after.answered,'Serveur','what he answered is still shown');
  await f.pass(3,2);assert.deepEqual(f.sent,[],'and nothing of it is sent');
  await holds(f);
});

// ---- Two questions of one ticket: two requests, open together, answered apart.

test('two questions of the same ticket and type are two requests; opposite answers each go back to their own question',async t=>{
  const f=await desk(t);await f.asked();await f.asked({question:'Et en production ?',options:['Oui','Non'],source:'XJ-2.ask-2.json'});
  const local=(await f.actions.escalate(LOCAL)).item,prod=(await f.actions.escalate({...PROD,question:'Q-2'})).item;
  assert.notEqual(local.id,prod.id);assert.equal(prod.replaces,undefined,'neither replaces the other');
  const shown=await f.shown();assert.deepEqual(shown.map(item=>item.id).sort(),[local.id,prod.id].sort());
  assert.notEqual(shown[0].seen,shown[1].seen);
  await click(f,shown.find(item=>item.id===local.id),'Autoriser');await click(f,shown.find(item=>item.id===prod.id),'Refuser');
  assert.equal((await f.questions.read('Q-1')).answer.text,'Autoriser');assert.equal((await f.questions.read('Q-2')).answer.text,'Refuser');
  await assert.rejects(()=>f.actions.click({item:prod.id,choice:'Autoriser',text:'Autoriser',seen:shown.find(item=>item.id===local.id).seen}),e=>e.code==='REQUEST_CHANGED','the agreement on local says nothing of production');
  await holds(f);
});

test('the same words under two identifiers are two versions: what was seen on one records nothing on the other',async t=>{
  const f=await desk(t);
  const one=(await f.actions.escalate(CHOICE)).item,first=await f.one(one.id);
  await f.inbox.mark(one.id,{state:'resolved'});
  const two=(await f.actions.escalate(CHOICE)).item,second=await f.one(two.id);
  assert.notEqual(two.id,one.id);assert.equal(second.text,first.text);assert.notEqual(second.seen,first.seen);
  await assert.rejects(()=>f.actions.click({item:two.id,choice:'Serveur',text:'Serveur',seen:first.seen}),e=>e.code==='REQUEST_CHANGED');
  await assert.rejects(()=>click(f,first,'Serveur'),e=>e.code==='QUESTION_CLOSED');
  await holds(f);
});

// ---- Left to the Lead: an answer, written once; its message goes once.

test('left to the Lead from two windows, and a pass of the watcher: one message',async t=>{
  const f=await desk(t);await f.asked();
  const {item}=await f.actions.escalate({...CHOICE,question:'Q-1',ticket:'XJ-2'}),shown=await f.one(item.id);
  const both=await Promise.all([f.lead.delegate({item:item.id,seen:shown.seen}),f.lead.delegate({item:item.id,seen:shown.seen})]);
  assert.deepEqual(both,[{item:item.id,delegated:true},{item:item.id,delegated:true}]);
  await f.pass(3,2);
  assert.equal(sentAbout(f,/le propriétaire te confie/).length,1);
  const kept=await f.inbox.read(item.id);assert.equal(kept.answer.left,true);assert.equal(kept.answer.id,null);assert.equal(kept.state,'resolved');
  assert.deepEqual(await f.shown(),[]);assert.deepEqual(await f.inbox.decisions({}),[],'no decision is made up');
  assert.equal((await f.questions.read('Q-1')).state,'open','the Lead answers the agent that waits');
  await assert.rejects(()=>click(f,shown,'Serveur'),e=>e.code==='QUESTION_CLOSED','a window still open on it answers nothing');
  await holds(f);
});

test('left to the Lead, the message goes and its return is lost: it is never sent again, and the doubt is said',async t=>{
  const f=await desk(t,{send:async()=>{throw Object.assign(new Error('Command failed: hc send'),{killed:true,signal:'SIGTERM'});}});await f.asked();
  const {item}=await f.actions.escalate({...CHOICE,question:'Q-1',ticket:'XJ-2'}),shown=await f.one(item.id);
  await f.lead.delegate({item:item.id,seen:shown.seen}).catch(()=>{});
  await f.lead.delegate({item:item.id,seen:shown.seen}).catch(()=>{});
  await f.pass(6,2);
  assert.equal(sentAbout(f,/le propriétaire te confie/).length,1,'one message, whatever is clicked or passed after it');
  assert.ok(await f.claimed('delegate|'+item.id),'the reservation is kept');assert.equal(await f.claimed('delegate|'+item.id+'|sent'),null);
  const unsure=(await f.shown()).filter(i=>i.type==='stuck'&&i.cause==='unsure');
  assert.equal(unsure.length,1,'said in the Inbox, once');assert.equal(unsure[0].title,'Message not confirmed · XJ-2');
  assert.equal((await f.questions.read('Q-1')).state,'open','given back to the Lead before the message left');
  await holds(f);
});

test('left to the Lead, the message says it did not go: the watcher sends it, once',async t=>{
  const f=await desk(t,{send:async(_message,nth)=>{if(nth===1)throw Object.assign(new Error('The message could not be sent to the agent.'),{code:'SEND_FAILED'});}});
  const {item}=await f.actions.escalate(CHOICE),shown=await f.one(item.id);
  await f.lead.delegate({item:item.id,seen:shown.seen}).catch(()=>{});
  assert.deepEqual(await f.shown(),[],'the choice is made: the request left the Inbox');
  await f.pass(4,1);
  assert.equal(sentAbout(f,/le propriétaire te confie/).length,2,'the try that failed, then the one that went');
  assert.equal((await f.inbox.read(item.id)).state,'resolved');assert.equal((await f.questions.read(item.question)).state,'resolved');
  await holds(f);
});

test('an alert that is answered goes to nobody: its decision is kept once, and the watcher has nothing left to carry',async t=>{
  const f=await desk(t),{item}=await f.inbox.ask({type:'stuck',cause:'merge',mission:'M-1',ticket:'XJ-4',question:null,title:'Bloqué',text:'t',blocked:['XJ-4'],proofs:[]});
  f.probe=crash('answer:written');
  await assert.rejects(()=>f.actions.click({item:item.id,text:'Vu',seen:item.version}),/crash/);f.probe=null;
  assert.deepEqual((await f.inbox.toSettle({mission:'M-1'})).map(i=>i.id),[item.id],'written, not yet kept as a decision');
  await f.pass();
  assert.deepEqual((await f.inbox.decisions({})).map(d=>[d.item,d.text]),[[item.id,'Vu']]);
  assert.deepEqual(await f.inbox.toSettle({mission:'M-1'}),[]);assert.deepEqual(f.sent,[]);
  await holds(f);
});

test('the question a request named is gone: the answer is said uncertain, and the engine goes on',async t=>{
  const f=await desk(t),{item}=await f.actions.escalate(CHOICE),shown=await f.one(item.id);
  await rm(join(f.root,'state','questions',item.question+'.json'));
  const made=await click(f,shown,'Serveur');
  assert.equal(made.created,true);assert.equal(made.item.state,'error');assert.equal(made.item.error,UNCERTAIN);
  await f.pass(2,2);assert.deepEqual(f.sent,[]);
});

test('left to the Lead while it was said in error: still handed over by the watcher after a crash',async t=>{
  const f=await desk(t),{item}=await f.actions.escalate(CHOICE);
  await f.inbox.mark(item.id,{state:'error',error:'e'});
  await f.inbox.answer({item:item.id,seen:item.version,via:'screen',left:true});
  assert.deepEqual(await f.shown(),[],'it left the Inbox');
  await f.pass(2,1);
  assert.equal(sentAbout(f,/le propriétaire te confie/).length,1);assert.equal((await f.inbox.read(item.id)).state,'resolved');
  await holds(f);
});

test('a request said in error by a doubt of the route, answered, and the tool stops just after the write: the watcher carries the answer',async t=>{
  // The question is typed to the Lead, the Lead escalates it at once, then hc returns without saying it went: the doubt
  // marks the request that now waits in that question as an error.
  const lost=()=>Object.assign(new Error('Command failed: hc send'),{killed:true,signal:'SIGTERM'});
  const f=await desk(t,{send:async message=>{if(message.text.includes('Q-1')&&!(await f.inbox.waitingIn('Q-1'))){await f.actions.escalate({...CHOICE,question:'Q-1',ticket:'XJ-2'});throw lost();}}});
  await f.asked();await f.pass();
  const item=await f.inbox.waitingIn('Q-1');
  assert.equal(item.state,'error','said in error by the doubt');assert.equal((await f.questions.read('Q-1')).unsure,true);
  f.probe=crash('answer:written');
  const shown=await f.one(item.id);
  await assert.rejects(()=>click(f,shown,'Serveur'),/crash/);f.probe=null;
  assert.equal((await f.inbox.read(item.id)).answer.text,'Serveur','the answer is written');
  assert.deepEqual((await f.inbox.toSettle({mission:'M-1'})).map(i=>i.id),[item.id],'and found again to be carried');
  await f.pass();
  assert.deepEqual((await f.inbox.decisions({})).map(d=>[d.item,d.text]),[[item.id,'Serveur']],'its decision is kept');
  const q=await f.questions.read('Q-1');assert.equal(q.answer.by,'owner');assert.equal(q.answer.text,'Serveur','and put in its question');
  assert.equal((await f.inbox.read(item.id)).error,item.error,'the doubt is still said');
  await holds(f);
});

test('left to the Lead, its return lost, and the tool stops before the doubt is said: the next passes say it, once',async t=>{
  // Only the message of the delegation loses its return; the others go.
  const f=await desk(t,{send:async message=>{if(/le propriétaire te confie/.test(message.text))throw Object.assign(new Error('Command failed: hc send'),{killed:true,signal:'SIGTERM'});}});await f.asked();
  const {item}=await f.actions.escalate({...CHOICE,question:'Q-1',ticket:'XJ-2'}),shown=await f.one(item.id);
  // The stop: the alert of the doubt is never written by this click.
  const ask=f.inbox.ask;let stopped=0;
  f.inbox.ask=fields=>{if(fields.type==='stuck'&&fields.cause==='unsure'&&!stopped++)throw new Error('stopped before the alert');return ask(fields);};
  await f.lead.delegate({item:item.id,seen:shown.seen}).catch(()=>{});
  assert.equal(stopped,1);assert.deepEqual(await f.shown(),[],'the request left the Inbox, and nothing says the doubt yet');
  await f.pass(4,2);
  assert.equal(sentAbout(f,/le propriétaire te confie/).length,1,'never sent again');
  const unsure=(await f.shown()).filter(i=>i.type==='stuck'&&i.cause==='unsure');
  assert.equal(unsure.length,1,'the doubt is said in the Inbox, once');assert.equal(unsure[0].title,'Message not confirmed · XJ-2');assert.equal(unsure[0].text,item.title,'the doubt of the delegation');
  await holds(f);
});
