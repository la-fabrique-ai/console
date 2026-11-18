import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,issue} from './helpers/backend-fixture.mjs';

async function po(t) {
  const f=await fixture(t);
  await f.write('config.json',{...f.config,projects:[{...f.config.projects[0],teamId:issue.team.id}]});
  const {session}=await f.backend.dispatch('po-launch',{key:'example',issueId:issue.id,confirmed:true});
  f.setTerminals([{id:session.terminalId,state:'live',reported:true,status:'idle',labels:{'fabrique-console.app':'fabrique-console','fabrique-console.session':session.id,'fabrique-console.role':'po','fabrique-console.issue':issue.id}}]);
  const seen=async()=>(await f.backend.dispatch('snapshot',{})).sessions[0];
  const ask=async(gate,options=['Approve','Demander une modif'])=>f.backend.dispatch('po-ask',{sessionId:session.id,id:'gate-1',question:'Approve this proposal?',options,...(gate===undefined?{}:{gate})});
  const answer=async(text,extra={})=>f.backend.dispatch('po-answer',{sessionId:session.id,id:'gate-1',askedAt:(await seen()).question.askedAt,text,...extra});
  return {f,session,seen,ask,answer};
}

test('a new PO starts at plan and old PO steps read conservatively without write-on-read',async t=>{
  const p=await po(t);assert.equal(p.session.step,'plan');
  for(const [stored,want] of [[undefined,'plan'],['analysis','plan'],['issue','plan'],['plan','plan'],['dev','dev'],['close','close']]) {
    const state=await p.f.read('state.json');if(stored===undefined)delete state.sessions[0].step;else state.sessions[0].step=stored;
    await p.f.write('state.json',state);assert.equal((await p.seen()).step,want);
    assert.equal((await p.f.read('state.json')).sessions[0].step,stored);
  }
});

for(const [gate,from,to] of [['plan','plan','split'],['split','split','dev'],['launch','dev','dev'],['check','check','close']]) {
  test(`explicit first-option approval of ${gate} advances ${from} to ${to} only after send`,async t=>{
    const p=await po(t),state=await p.f.read('state.json');state.sessions[0].step=from;await p.f.write('state.json',state);
    await p.ask(gate);assert.equal((await p.seen()).question.gate,gate);
    await p.answer('Approve',{optionIndex:0});const after=await p.seen();
    assert.equal(after.step,to);assert.equal(after.question,null);assert.equal(Boolean(after.readyAt),gate==='check');
    assert.equal(p.f.calls.filter(c=>c.args[0]==='send').length,1);
  });
}

test('free text even identical to approval, and non-first option, do not advance a gate',async t=>{
  for(const [text,extra] of [['Approve',{}],['Demander une modif',{optionIndex:1}],['Some other instruction',{}]]) {
    const p=await po(t);await p.ask('plan');await p.answer(text,extra);
    assert.equal((await p.seen()).step,'plan');assert.equal((await p.seen()).question,null);
  }
});

test('unknown or optionless gates and changed gate under the same question id are refused',async t=>{
  const p=await po(t);
  for(const bad of ['ship',{},[],{toString:null}])await assert.rejects(()=>p.ask(bad),{code:'INVALID_ARGUMENT'});
  await assert.rejects(()=>p.ask('plan',[]),{code:'INVALID_ARGUMENT'});
  await p.ask('plan');const first=(await p.seen()).question;
  await p.ask('plan');assert.equal((await p.seen()).question.askedAt,first.askedAt);
  await assert.rejects(()=>p.ask('split'),{code:'QUESTION_ID_USED'});
});

test('an option index must identify the exact option, otherwise nothing is sent',async t=>{
  const p=await po(t);await p.ask('plan');
  for(const [text,optionIndex] of [['Approve',1],['Approve',-1],['Approve',4],['Approve','0']])
    await assert.rejects(()=>p.answer(text,{optionIndex}),{code:'INVALID_ARGUMENT'});
  assert.equal(p.f.calls.some(c=>c.args[0]==='send'),false);assert.equal((await p.seen()).question.id,'gate-1');
});

test('failed approval delivery preserves the question and its stage',async t=>{
  const p=await po(t);await p.ask('plan');const before=await p.f.read('state.json');p.f.failSends(true);
  await assert.rejects(()=>p.answer('Approve',{optionIndex:0}),{code:'SEND_FAILED'});
  assert.deepEqual(await p.f.read('state.json'),before);
});

test('new manual steps include split/check and leaving ready reopens the work',async t=>{
  const p=await po(t);
  for(const step of ['plan','split','dev','check','close'])assert.equal((await p.f.backend.dispatch('po-step',{sessionId:p.session.id,step})).step,step);
  await p.f.backend.dispatch('po-ready',{sessionId:p.session.id});
  await p.f.backend.dispatch('po-step',{sessionId:p.session.id,step:'check'});
  assert.equal((await p.seen()).readyAt,null);assert.equal((await p.seen()).step,'check');
});

for(const [gate,current] of [['plan','dev'],['plan','check'],['plan','close'],['split','dev'],['split','check'],['split','close'],['launch','check'],['launch','close'],['check','plan'],['check','dev'],['check','close']]) {
  test(`approval of a stale ${gate} gate at ${current} sends its answer without changing phase or readiness`,async t=>{
    const p=await po(t);await p.ask(gate);
    await p.f.backend.dispatch('po-step',{sessionId:p.session.id,step:current});
    if(current==='close'){const state=await p.f.read('state.json');state.sessions[0].readyAt='2026-11-01T12:00:00Z';await p.f.write('state.json',state);}
    const before=await p.seen();await p.answer('Approve',{optionIndex:0});const after=await p.seen();
    assert.equal(after.step,before.step);assert.equal(after.stepAt,before.stepAt);assert.equal(after.readyAt,before.readyAt);
    assert.equal(after.question,null);assert.equal(p.f.calls.filter(c=>c.args[0]==='send').length,1);
  });
}

for(const current of ['plan','split'])test(`a launch approval from ${current} enters development`,async t=>{
  const p=await po(t);await p.f.backend.dispatch('po-step',{sessionId:p.session.id,step:current});await p.ask('launch');
  await p.answer('Approve',{optionIndex:0});assert.equal((await p.seen()).step,'dev');
});

test('approving the split from plan also approves the plan and enters development',async t=>{
  const p=await po(t);assert.equal((await p.seen()).step,'plan');await p.ask('split');
  await p.answer('Approve',{optionIndex:0});const after=await p.seen();
  assert.equal(after.step,'dev');assert.equal(after.readyAt,null);assert.equal(after.question,null);
  assert.equal(p.f.calls.filter(c=>c.args[0]==='send').length,1);
});

for(const status of ['working','busy','unknown'])test(`a gated answer to a ${status} terminal is refused without send or state change`,async t=>{
  const p=await po(t);await p.ask('check');
  const state=await p.f.read('state.json');state.sessions[0].step='check';state.sessions[0].readyAt='2026-11-01T12:00:00Z';await p.f.write('state.json',state);
  p.f.setTerminals([{id:p.session.terminalId,state:'live',reported:true,status,labels:{'fabrique-console.app':'fabrique-console','fabrique-console.session':p.session.id,'fabrique-console.role':'po','fabrique-console.issue':issue.id}}]);
  const before=await p.f.read('state.json');await assert.rejects(()=>p.answer('Approve',{optionIndex:0}),{code:'QUESTION_STALE'});
  assert.deepEqual(await p.f.read('state.json'),before);assert.equal(p.f.calls.some(c=>c.args[0]==='send'),false);
});

for(const finalStatus of ['done','idle'])test(`a done PO is reread before approval and sent only while still ${finalStatus}`,async t=>{
  const p=await po(t),asked=await p.ask('split');let reads=0;
  p.f.setTerminals([{id:p.session.terminalId,state:'live',reported:true,get status(){return ++reads===1?'done':finalStatus;},labels:{'fabrique-console.app':'fabrique-console','fabrique-console.session':p.session.id,'fabrique-console.role':'po','fabrique-console.issue':issue.id}}]);
  const beforeGets=p.f.calls.filter(c=>c.args[0]==='get').length;
  await p.f.backend.dispatch('po-answer',{sessionId:p.session.id,id:'gate-1',askedAt:asked.question.askedAt,text:'Approve',optionIndex:0});
  assert.equal(p.f.calls.filter(c=>c.args[0]==='get').length-beforeGets,2);
  assert.deepEqual(p.f.calls.filter(c=>c.args[0]==='send').map(c=>c.args),[finalStatus==='idle'?['send','--if','idle',p.session.terminalId,'--','Approve']:['send',p.session.terminalId,'--','Approve']]);
  const after=(await p.f.read('state.json')).sessions[0];assert.equal(after.step,'dev');assert.equal(after.question,null);assert.equal(after.readyAt,null);
});

for(const finalStatus of ['working','blocked','error','unknown'])test(`a done PO that becomes ${finalStatus} before sending gets no answer or phase change`,async t=>{
  const p=await po(t),asked=await p.ask('split');let reads=0;
  p.f.setTerminals([{id:p.session.terminalId,state:'live',reported:true,get status(){return ++reads===1?'done':finalStatus;},labels:{'fabrique-console.app':'fabrique-console','fabrique-console.session':p.session.id,'fabrique-console.role':'po','fabrique-console.issue':issue.id}}]);
  const before=await p.f.read('state.json');
  await assert.rejects(()=>p.f.backend.dispatch('po-answer',{sessionId:p.session.id,id:'gate-1',askedAt:asked.question.askedAt,text:'Approve',optionIndex:0}),{code:'QUESTION_STALE'});
  assert.equal(reads,2);assert.deepEqual(await p.f.read('state.json'),before);assert.equal(p.f.calls.some(c=>c.args[0]==='send'),false);
});

for(const change of ['ownership','gone'])test(`a done PO whose terminal changes ${change} at the second observation gets no answer`,async t=>{
  const p=await po(t),asked=await p.ask('split');
  const own={'fabrique-console.app':'fabrique-console','fabrique-console.session':p.session.id,'fabrique-console.role':'po','fabrique-console.issue':issue.id};
  const terminal={id:p.session.terminalId,state:'live',reported:true,labels:own};
  const replacement=change==='gone'?[]:[{...terminal,status:'done',labels:{...own,'fabrique-console.issue':'another-work'}}];
  // The first hc get serializes a valid done observation; its next ls/get sees the changed world.
  p.f.setTerminals([{...terminal,get status(){p.f.setTerminals(replacement);return 'done';}}]);
  const before=await p.f.read('state.json');
  await assert.rejects(()=>p.f.backend.dispatch('po-answer',{sessionId:p.session.id,id:'gate-1',askedAt:asked.question.askedAt,text:'Approve',optionIndex:0}),{code:change==='gone'?'TERMINAL_GONE':'TERMINAL_OWNERSHIP'});
  assert.deepEqual(await p.f.read('state.json'),before);assert.equal(p.f.calls.some(c=>c.args[0]==='send'),false);
});

for(const mode of ['replaced','different-time'])test(`a gated answer for a ${mode} question changes no phase or readiness`,async t=>{
  const p=await po(t);await p.ask('check');const first=(await p.seen()).question;
  if(mode==='replaced')await p.f.backend.dispatch('po-ask',{sessionId:p.session.id,id:'gate-2',question:'Another proposal?',gate:'plan',options:['Approve']});
  const state=await p.f.read('state.json');state.sessions[0].readyAt='2026-11-01T12:00:00Z';await p.f.write('state.json',state);
  const before=await p.f.read('state.json');
  await assert.rejects(()=>p.answer('Approve',{optionIndex:0,askedAt:mode==='replaced'?first.askedAt:'2000-01-01T00:00:00Z'}),{code:'QUESTION_GONE'});
  assert.deepEqual(await p.f.read('state.json'),before);assert.equal(p.f.calls.some(c=>c.args[0]==='send'),false);
});

test('invalid gated option indexes preserve phase, readiness and question without sending',async t=>{
  const p=await po(t);await p.ask('check');
  const state=await p.f.read('state.json');state.sessions[0].readyAt='2026-11-01T12:00:00Z';await p.f.write('state.json',state);
  const before=await p.f.read('state.json');
  for(const optionIndex of [null,-1,0.5,'0']){
    await assert.rejects(()=>p.answer('Approve',{optionIndex}),{code:'INVALID_ARGUMENT'});
    assert.deepEqual(await p.f.read('state.json'),before);assert.equal(p.f.calls.some(c=>c.args[0]==='send'),false);
  }
});
