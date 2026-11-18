import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from '../../../../tests/helpers/backend-fixture.mjs';

// po-answer names the question by its id and the time it was asked, as the Inbox reads them from the snapshot.
async function answer(f,input) {
  const session=(await f.backend.dispatch('snapshot',{})).sessions.find(s=>s.id===input.sessionId);
  return f.backend.dispatch('po-answer',{askedAt:session?.question?.askedAt??'none',...input});
}

const issue={id:'issue-1',identifier:'CHAR-7',title:'Issue',url:'https://linear.app/example/issue/CHAR-7',team:{id:'characterization-team'},state:{id:'st',name:'Backlog',type:'backlog'},labels:[],comments:[]};
async function poFixture(t) {
  const f=await fixture(t);
  await f.write('config.json',{...f.config,projects:[{...f.config.projects[0],teamId:'characterization-team'}]});
  f.tracker.detail=async()=>({issue});
  const {session}=await f.backend.dispatch('po-launch',{key:'example',issueId:issue.id,confirmed:true});
  // The PO waits at its prompt: its terminal is idle.
  const own={'fabrique-console.app':'fabrique-console','fabrique-console.session':session.id,'fabrique-console.role':'po','fabrique-console.issue':issue.id};
  const terminal=(status='idle',labels=own)=>({id:'t1',labels,state:'live',reported:true,status});
  f.setTerminals([terminal()]);
  return {f,session,terminal,own};
}

test('a PO asks a question with its exact answers; the snapshot carries it; an answer goes to its terminal and only there',async t=>{
  const {f,session}=await poFixture(t);
  const asked=await f.backend.dispatch('po-ask',{sessionId:session.id,id:'q-1',question:'Quel découpage retenir ?',options:['Issue simple','Project']});
  assert.equal(asked.asked,true);assert.deepEqual(asked.question.options,['Issue simple','Project']);assert.ok(asked.question.askedAt);
  const seen=(await f.backend.dispatch('snapshot',{})).sessions.find(s=>s.id===session.id);
  assert.equal(seen.question.id,'q-1');assert.equal(seen.question.text,'Quel découpage retenir ?');
  // The answer is one hc send to the terminal that carries the label of the session.
  const sent=await answer(f,{sessionId:session.id,id:'q-1',text:'Project'});
  assert.deepEqual(sent,{sent:true,terminalId:'t1'});
  const send=f.calls.find(c=>c.args[0]==='send');assert.deepEqual(send.args,['send','--if','idle','t1','--','Project']);
  const after=(await f.backend.dispatch('snapshot',{})).sessions.find(s=>s.id===session.id);
  assert.equal(after.question,null);assert.ok(after.answeredAt);
  // The same question cannot be answered twice; a question that is not the one asked is gone.
  await assert.rejects(()=>answer(f,{sessionId:session.id,id:'q-1',text:'Project'}),e=>e.code==='QUESTION_GONE');
  await f.backend.dispatch('po-ask',{sessionId:session.id,id:'q-2',question:'Lancer cette Issue avec Claude ?',options:['Lancer']});
  await assert.rejects(()=>answer(f,{sessionId:session.id,id:'q-1',text:'Lancer'}),e=>e.code==='QUESTION_GONE');
  // A free answer is sent as written.
  await answer(f,{sessionId:session.id,id:'q-2',text:'Non : pas avant la release'});
  assert.deepEqual(f.calls.filter(c=>c.args[0]==='send').at(-1).args,['send','--if','idle','t1','--','Non : pas avant la release']);
});

test('a question is refused when malformed; an answer is refused when the terminal is gone, claimed twice, or the send fails; a stopped session asks nothing',async t=>{
  const {f,session}=await poFixture(t);
  for(const bad of [{id:'Q 1',question:'x'},{id:'q-1',question:''},{id:'q-1',question:'x',options:['a','a']},{id:'q-1',question:'x',options:['a','b','c','d','e']},{id:'q-1',question:'x',options:['with\nnewline']},{id:'q-1',question:'x'.repeat(501)}])
    await assert.rejects(()=>f.backend.dispatch('po-ask',{sessionId:session.id,...bad}),e=>e.code==='INVALID_ARGUMENT',JSON.stringify(bad).slice(0,40));
  await f.backend.dispatch('po-ask',{sessionId:session.id,id:'q-1',question:'Quel découpage retenir ?',options:['Issue simple','Project']});
  f.failSends(true);
  await assert.rejects(()=>answer(f,{sessionId:session.id,id:'q-1',text:'Project'}),e=>e.code==='SEND_FAILED');
  f.failSends(false);
  const snapshot=(await f.backend.dispatch('snapshot',{})).sessions.find(s=>s.id===session.id);
  assert.equal(snapshot.question.id,'q-1','a failed send keeps the question');
  const terminals=(await f.backend.dispatch('snapshot',{})).sessions;void terminals;
  f.setTerminals([]);
  await assert.rejects(()=>answer(f,{sessionId:session.id,id:'q-1',text:'Project'}),e=>e.code==='TERMINAL_GONE');
  const labels={'fabrique-console.app':'fabrique-console','fabrique-console.session':session.id,'fabrique-console.role':'po'};
  f.setTerminals([{id:'t1',labels,state:'live',reported:true,status:'working'},{id:'t2',labels,state:'live',reported:true,status:'working'}]);
  await assert.rejects(()=>answer(f,{sessionId:session.id,id:'q-1',text:'Project'}),e=>e.code==='TERMINAL_OWNERSHIP');
  f.setTerminals([{id:'t1',labels,state:'live',reported:true,status:'working'}]);
  await f.backend.dispatch('stop',{sessionId:session.id,confirmed:true});
  await assert.rejects(()=>f.backend.dispatch('po-ask',{sessionId:session.id,id:'q-3',question:'x'}),e=>e.code==='SESSION_STOPPED');
  await assert.rejects(()=>answer(f,{sessionId:session.id,id:'q-1',text:'Project'}),e=>e.code==='SESSION_STOPPED');
});

test('po-ready marks the session as waiting for its closure, and drops a pending question',async t=>{
  const {f,session}=await poFixture(t);
  await f.backend.dispatch('po-ask',{sessionId:session.id,id:'q-1',question:'x'});
  const ready=await f.backend.dispatch('po-ready',{sessionId:session.id});
  assert.equal(ready.ready,true);assert.ok(ready.readyAt);
  const seen=(await f.backend.dispatch('snapshot',{})).sessions.find(s=>s.id===session.id);
  assert.equal(seen.readyAt,ready.readyAt);assert.equal(seen.question,null);
  // A new question after that means the PO is not done: readiness is withdrawn.
  await f.backend.dispatch('po-ask',{sessionId:session.id,id:'q-2',question:'y'});
  assert.equal((await f.backend.dispatch('snapshot',{})).sessions.find(s=>s.id===session.id).readyAt,null);
});

test('po-step records the step the PO enters; po-ready means the closure step',async t=>{
  const {f,session}=await poFixture(t);
  const seen=async()=>(await f.backend.dispatch('snapshot',{})).sessions.find(s=>s.id===session.id);
  assert.equal((await seen()).step,'plan');
  const first=await f.backend.dispatch('po-step',{sessionId:session.id,step:'plan'});
  assert.equal(first.step,'plan');assert.ok(first.stepAt);
  // The same step said again changes nothing, not even its time.
  assert.equal((await f.backend.dispatch('po-step',{sessionId:session.id,step:'plan'})).stepAt,first.stepAt);
  await f.backend.dispatch('po-step',{sessionId:session.id,step:'split'});assert.equal((await seen()).step,'split');
  for(const bad of ['issue','PLAN','',null,'dev;rm'])
    await assert.rejects(()=>f.backend.dispatch('po-step',{sessionId:session.id,step:bad}),e=>e.code==='INVALID_ARGUMENT');
  await f.backend.dispatch('po-ready',{sessionId:session.id});assert.equal((await seen()).step,'close');
  // Back to the plan after ready: the PO resumed, the session is no longer to close.
  await f.backend.dispatch('po-step',{sessionId:session.id,step:'plan'});
  assert.deepEqual([(await seen()).step,(await seen()).readyAt],['plan',null]);
  await f.backend.dispatch('stop',{sessionId:session.id,confirmed:true});
  await assert.rejects(()=>f.backend.dispatch('po-step',{sessionId:session.id,step:'dev'}),e=>e.code==='SESSION_STOPPED');
});

test('an id names one question for good; an answer goes only to a PO that waits, through a terminal of that work, as data',async t=>{
  const {f,session,terminal,own}=await poFixture(t);
  const ask=(id,question,options)=>f.backend.dispatch('po-ask',{sessionId:session.id,id,question,options});
  const first=await ask('q-1','Lancer la version A ?',['Lancer']);
  // The same question asked again is the same one; another question under the same id is refused, even once answered.
  assert.equal((await ask('q-1','Lancer la version A ?',['Lancer'])).question.askedAt,first.question.askedAt);
  await assert.rejects(()=>ask('q-1','Supprimer A et lancer B ?',['Lancer']),e=>e.code==='QUESTION_ID_USED');
  await answer(f,{sessionId:session.id,id:'q-1',text:'Lancer'});
  await assert.rejects(()=>ask('q-1','Supprimer A et lancer B ?',['Lancer']),e=>e.code==='QUESTION_ID_USED');
  await ask('q-2','Supprimer A et lancer B ?',['Lancer']);
  // A PO that went on working, or a terminal stopped on a dialog or unread, takes no answer: nothing is sent.
  const sends=()=>f.calls.filter(c=>c.args[0]==='send').length,before=sends();
  for(const status of ['working','blocked','error']) {
    f.setTerminals([terminal(status)]);
    await assert.rejects(()=>answer(f,{sessionId:session.id,id:'q-2',text:'Lancer'}),e=>e.code==='QUESTION_STALE',status);
  }
  f.setTerminals([{...terminal(),reported:false}]);
  await assert.rejects(()=>answer(f,{sessionId:session.id,id:'q-2',text:'Lancer'}),e=>e.code==='QUESTION_STALE');
  // Labels of another work on the terminal of the session: refused as po-launch refuses them.
  for(const labels of [{...own,'fabrique-console.role':'dev'},{...own,'fabrique-console.issue':'other-issue'}]) {
    f.setTerminals([terminal('idle',labels)]);
    await assert.rejects(()=>answer(f,{sessionId:session.id,id:'q-2',text:'Lancer'}),e=>e.code==='TERMINAL_OWNERSHIP');
  }
  assert.equal(sends(),before,'nothing was sent');
  // A text that starts with a dash is the answer, never an option of hc.
  f.setTerminals([terminal()]);
  await answer(f,{sessionId:session.id,id:'q-2',text:'--help'});
  assert.deepEqual(f.calls.filter(c=>c.args[0]==='send').at(-1).args,['send','--if','idle','t1','--','--help']);
  // A PO whose turn ended takes its answer after a second observation; hc has no --if done condition.
  await f.backend.dispatch('po-ask',{sessionId:session.id,id:'q-3',question:'Encore ?',options:['Oui']});
  f.setTerminals([terminal('done')]);const sent=sends();
  await answer(f,{sessionId:session.id,id:'q-3',text:'Oui'});
  assert.equal(sends(),sent+1);assert.deepEqual(f.calls.filter(c=>c.args[0]==='send').at(-1).args,['send','t1','--','Oui']);
});

test('an answer names its question by id and time: an old answer never applies to a later question under the same id',async t=>{
  const {f,session}=await poFixture(t);
  const first=await f.backend.dispatch('po-ask',{sessionId:session.id,id:'h-0',question:'Lancer A ?',options:['Lancer']});
  await assert.rejects(()=>f.backend.dispatch('po-answer',{sessionId:session.id,id:'h-0',askedAt:'2020-01-01T00:00:00.000Z',text:'Lancer'}),e=>e.code==='QUESTION_GONE');
  await assert.rejects(()=>f.backend.dispatch('po-answer',{sessionId:session.id,id:'h-0',text:'Lancer'}),e=>e.code==='INVALID_ARGUMENT');
  // Once the id is out of the bounded history (500 later questions, simulated), it may be asked again: the old
  // answer is still refused.
  const state=await f.read('state.json'),own=state.sessions.find(s=>s.id===session.id);
  own.askedIds=Array.from({length:500},(_,n)=>'h-'+(n+1));own.question={id:'h-500',text:'Q 500',options:[],askedAt:new Date().toISOString()};
  await f.write('state.json',state);
  await new Promise(r=>setTimeout(r,2));
  await f.backend.dispatch('po-ask',{sessionId:session.id,id:'h-0',question:'Lancer B ?',options:['Lancer']});
  await assert.rejects(()=>f.backend.dispatch('po-answer',{sessionId:session.id,id:'h-0',askedAt:first.question.askedAt,text:'Lancer'}),e=>e.code==='QUESTION_GONE');
});
