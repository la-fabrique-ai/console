import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture,issue } from '../../../../tests/helpers/backend-fixture.mjs';
import { assertInterfaceShape } from '../../../../tests/helpers/interface-shape.mjs';

test('the nine legacy actions have executed strict response contracts with injected Tracker writes only',async t=>{
  const f=await fixture(t);
  for(const [action,input,type] of [
    ['ticket-list',{},'LegacyIssueList'],['ticket-detail',{id:issue.id},'LegacyIssueDetail'],
    ['ticket-meta',{},'LegacyTrackerMeta'],['project-summary',{key:'example'},'ProjectSummary'],
  ])assertInterfaceShape(type,await f.backend.dispatch(action,input));
  const {session}=await f.backend.dispatch('launch',{issueId:issue.id,tool:'codex'});
  assertInterfaceShape('LegacyGit',await f.backend.dispatch('git',{sessionId:session.id}));
  const qa=await f.backend.dispatch('qa',{sessionId:session.id,profile:'unit'});assertInterfaceShape('LegacyQA',qa);assert.equal(qa.run.status,'passed');
  assertInterfaceShape('LegacyProposal',await f.backend.dispatch('propose',{sessionId:session.id}));
  const stop=await f.backend.dispatch('stop',{sessionId:session.id,confirmed:true});assertInterfaceShape('LegacyStop',stop);assert.equal(stop.session.status,'historical');
  const payload={issueId:issue.id,comment:'Simulated contract write'};
  assertInterfaceShape('LegacyMutation',await f.backend.dispatch('ticket-mutate',{payload,confirmedPayload:payload,confirmed:true}));
  assert.equal(f.trackerCalls.filter(call=>call[0]==='mutate').length,1);
  assert.throws(()=>assertInterfaceShape('LegacyStop',{...stop,extra:true}));
});

test('a missing fetch intention is a guarded data refusal while stop confirmation is an exception',async t=>{
  const f=await fixture(t);
  const result=await f.backend.dispatch('fetch-abandon',{fetchId:'absent',confirmed:true,expectedHash:'0'.repeat(64)});
  assertInterfaceShape('Refusal',result);assert.equal(result.code,'FETCH_INTENT_NOT_FOUND');
  await assert.rejects(f.backend.dispatch('stop',{}),{code:'CONFIRMATION_REQUIRED'});
});

test('the V1 QA contract includes the real output truncation flag',async t=>{
  const f=await fixture(t);f.config.projects[0].tests.unit.argv=[process.execPath,'-e','process.stdout.write("x".repeat(524289))'];await f.write('config.json',f.config);
  const {session}=await f.backend.dispatch('launch',{issueId:issue.id,tool:'codex'});
  const result=await f.backend.dispatch('qa',{sessionId:session.id,profile:'unit'});
  assert.equal(result.run.outputTruncated,true);assertInterfaceShape('LegacyQA',result);
});

test('the V1 stop contract retains an unknown first-message delivery result',async t=>{
  const f=await fixture(t),{session}=await f.backend.dispatch('launch',{issueId:issue.id,tool:'codex'});
  const state=await f.read('state.json');state.sessions[0].firstMessageSent=null;await f.write('state.json',state);
  const result=await f.backend.dispatch('stop',{sessionId:session.id,confirmed:true});
  assert.equal(result.session.firstMessageSent,null);assertInterfaceShape('LegacyStop',result);
});
