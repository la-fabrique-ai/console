import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createConversation } from '../src/conversation.mjs';
import { createDevFlow } from '../src/dev-flow.mjs';
import { createQuestionActions, createQuestionRegistry } from '../src/questions.mjs';
import { createMissionRegistry } from '../src/mission.mjs';
import { desk,click } from './helpers/requests.mjs';

import { fakeHerdr } from './helpers/fake-herdr.mjs';
// A message that went and whose return was lost (the send is done, then the call fails: a delay passed, a process
// killed) is not known to have failed. Its reservation is kept: what is not sure is said, and nothing is sent again
// by itself. Everything here runs on test data, with sends that are only recorded.
const lost=()=>Object.assign(new Error('Command failed: hc send'),{killed:true,signal:'SIGTERM'});
// The claims of a mission, as the chain keeps them, in memory.
function claims(clock) {
  const done=new Map();
  return {done,claim:async(_id,key)=>{if(done.has(key))return false;done.set(key,clock());return true;},unclaim:async(_id,key)=>{done.delete(key);},claimedAt:async(_id,key)=>done.get(key)??null};
}
// An Inbox that only records what it is told: these scenarios are about the messages. The one answer of the user put
// in a question here (D-1 in Q-1) stands for one its request put there.
const recorder=calls=>new Proxy({},{get:(_target,name)=>name==='then'?undefined:['list','toSettle'].includes(name)?async()=>[]:name==='vouches'?async()=>q=>q.id==='Q-1'&&(q.answer?.decision??q.legacyOwner?.decision)==='D-1':name==='waitingIn'?async()=>null:async(...args)=>{calls.push([name,...args]);return {item:{id:'I-9'},created:true};}});
async function setup(t,{send}) {
  const root=await realpath(await mkdtemp(join(tmpdir(),'fabrique-console-once-')));t.after(()=>rm(root,{recursive:true,force:true}));
  let at=Date.parse('2026-11-13T09:00:00Z');
  const now=()=>at,sent=[],said=[],questions=createQuestionRegistry({root,now}),missions=createMissionRegistry({root,now}),kept=claims(now);
  const inbox=recorder(said),talk=createConversation({questions,inbox,now,send:async message=>{sent.push(message);return send(message,sent.length);}});
  const actions=createQuestionActions({questions,inbox,missions,launch:async()=>({})}),tabs={'XJ-2 · dev':{address:'t9',status:'idle'}};
  const context={id:'M-1',mission:{id:'M-1',project:'p',issue:{identifier:'XJ-1'},tickets:[]},session:{id:'s1',terminalId:'t7',identifier:'XJ-1'},reports:[],lead:{address:'t7',status:'idle'},tab:name=>tabs[name]||null,log:async()=>{},tell:async()=>{},...kept};
  const pass=async(times=1,minutes=0)=>{for(let n=0;n<times;n++){at+=minutes*60000;await talk.step(context);}};
  const ask=()=>questions.ensure({mission:'M-1',ticket:'XJ-2',from:'dev',fromTab:'XJ-2 · dev',question:'Quel rôle ?',options:['A','B'],source:'XJ-2.ask-1.json'});
  return {root,questions,actions,sent,said,kept,pass,ask,context};
}
const stuckUnsure=f=>f.said.filter(([name,fields])=>['ask','upsert'].includes(name)&&fields?.type==='stuck'&&fields?.cause==='unsure');

test('a question sent to the Lead whose return was lost is never sent again: its reservation stays, and the doubt is said',async t=>{
  const f=await setup(t,{send:async()=>{throw lost();}});await f.ask();
  await f.pass(2);
  assert.equal(f.sent.length,1,'the second pass sends nothing');
  await f.pass(6,2);
  assert.equal(f.sent.length,1,'nor any later one');
  assert.ok(f.kept.done.has('route|Q-1'),'the reservation is kept');assert.equal(f.kept.done.has('route|Q-1|sent'),false,'and nothing says it was received');
  assert.equal((await f.questions.read('Q-1')).unsure,true,'the question is said not sure');assert.equal(stuckUnsure(f).length,1,'in the Inbox, once');
});

test('a send that says it did not go (SEND_FAILED) frees its reservation and is tried again',async t=>{
  const f=await setup(t,{send:async(_message,nth)=>{if(nth===1)throw Object.assign(new Error('The message could not be sent to the agent.'),{code:'SEND_FAILED'});return {sent:true};}});await f.ask();
  await f.pass(2);
  assert.equal(f.sent.length,2);assert.ok(f.kept.done.has('route|Q-1|sent'));assert.equal((await f.questions.read('Q-1')).unsure,undefined);assert.equal(stuckUnsure(f).length,0);
});

test('an answer delivered whose return was lost is not delivered twice',async t=>{
  const f=await setup(t,{send:async message=>{if(message.terminal==='t9')throw lost();return {sent:true};}});await f.ask();
  await f.pass();
  await f.actions.answer({question:'Q-1',text:'Garde roles.ts'});
  await f.pass(8,2);
  assert.equal(f.sent.filter(message=>message.terminal==='t9').length,1,'one delivery');
  const q=await f.questions.read('Q-1');assert.equal(q.state,'answered','not said delivered: nothing proves it');assert.equal(q.unsure,true);
  assert.equal(q.delivery,null,'and not counted as a try that failed');assert.equal(stuckUnsure(f).length,1);
});

test('a decision relayed to the Lead whose return was lost is not relayed twice, and stays in the hands of the Lead',async t=>{
  let relays=0;
  const f=await desk(t,{send:async message=>{if(message.text.includes('legacyOwner-decision')){relays++;throw lost();}return {sent:true};}});await f.asked();
  await f.pass();
  const {item}=await f.actions.escalate({mission:'M-1',question:'Q-1',type:'decision',title:'Rôle',text:'Quel rôle ?',recommendation:'A',why:'Coût'});
  await click(f,{...item,seen:item.version},'A');
  await f.pass(8,2);
  assert.equal(relays,1);
  const q=await f.questions.read('Q-1');assert.equal(q.state,'open','the Lead may have it: it can answer');assert.equal(q.legacyOwner.decision,'D-1','the decision is not lost');assert.equal(q.unsure,true);assert.equal((await f.inbox.list({mission:'M-1'})).filter(item=>item.type==='stuck'&&item.cause==='unsure').length,1);
});

test('hc send: a delay passed, a process killed or an exit with an error is not a failure that is known (SEND_UNSURE); only hc that never ran is (SEND_FAILED)',async()=>{
  const flow=invoke=>createDevFlow({herdr:fakeHerdr({on:invoke}).herdr,loadState:async()=>({sessions:[{id:'s1',role:'lead',terminalId:'t7'}]})});
  const send=invoke=>flow(invoke).send({sessionId:'s1',terminal:'t7',text:'x'}).then(()=>null,error=>error.code);
  assert.equal(await send(async()=>{throw lost();}),'SEND_UNSURE','killed after its delay');
  assert.equal(await send(async()=>{throw Object.assign(new Error('timeout'),{code:'ETIMEDOUT'});}),'SEND_UNSURE');
  assert.equal(await send(async()=>{throw new Error('?');}),'SEND_UNSURE','what says nothing proves nothing');
  // hc warns that a send that failed may have arrived: an exit with an error proves nothing either.
  assert.equal(await send(async()=>{throw Object.assign(new Error('exit 1'),{code:1});}),'SEND_UNSURE','an exit with an error after the send');
  assert.equal(await send(async()=>{throw Object.assign(new Error('exit 2'),{code:2});}),'SEND_UNSURE');
  // Only what proves that nothing went frees the reservation: hc that never ran, an argument refused before the send.
  assert.equal(await send(async()=>{throw Object.assign(new Error('spawn hc ENOENT'),{code:'ENOENT'});}),'SEND_FAILED','hc never ran');
  assert.equal(await flow(async()=>{throw new Error('never called');}).send({sessionId:'s1',terminal:'not a terminal',text:'x'}).then(()=>null,error=>error.code),'INVALID_ARGUMENT','refused before the send');
  assert.equal(await send(async()=>({stdout:''})),null);
});

test('hc send typed the message, then exited with an error: the watcher sends it once, keeps its reservation and says the doubt',async t=>{
  // The real send of the engine (dev-flow), with an hc that types the message, then answers with exit 1.
  const typed=[];
  const flow=createDevFlow({loadState:async()=>({sessions:[{id:'s1',role:'lead',terminalId:'t7'}]}),herdr:fakeHerdr({on:async(_hc,args)=>{typed.push(args);throw Object.assign(new Error('Command failed: hc send'),{code:1});}}).herdr});
  const f=await setup(t,{send:message=>flow.send(message)});await f.ask();
  await f.pass(2);await f.pass(6,2);
  assert.equal(typed.length,1,'one try, never a second');
  assert.ok(f.kept.done.has('route|Q-1'),'the reservation is kept');assert.equal(f.kept.done.has('route|Q-1|sent'),false);
  assert.equal((await f.questions.read('Q-1')).unsure,true,'the question is said not sure');assert.equal(stuckUnsure(f).length,1,'in the Inbox, once');
});
