import test from 'node:test';
import assert from 'node:assert/strict';
import { enrichedFixture,connection,ticket,reference } from './helpers/enriched-fixture.mjs';
import { assertInterfaceShape } from './helpers/interface-shape.mjs';

const actions=[['ticket-projects',{},'EnrichedProjects'],['ticket-issues-enriched',{},'EnrichedIssues'],['ticket-issue-enriched',{issueId:'one'},'EnrichedIssue'],['ticket-document',{projectId:'epic',documentId:'d1'},'EnrichedDocument']];
test('each enriched action executes its strict complete and unavailable response contract',async t=>{
  const f=await enrichedFixture(t);
  for(const [action,input,type] of actions){
    const value=await f.read(action,input);assertInterfaceShape(type,value);assert.equal(value.status,'complete');
    assert.throws(()=>assertInterfaceShape(type,{...value,undocumented:true}));
    assert.throws(()=>assertInterfaceShape(type,{...value,usage:{...value.usage,requests:'unknown'}}));
    if(value.data.issues){const changed=structuredClone(value);changed.data.issues.items[0].estimate='2';assert.throws(()=>assertInterfaceShape(type,changed));}
    if(value.data.projects){const changed=structuredClone(value);changed.data.projects.items[0].progress='0.5';assert.throws(()=>assertInterfaceShape(type,changed));}
  }
  f.setToken(null);
  for(const [action,input,type] of actions){const value=await f.read(action,input);assertInterfaceShape(type,value);assert.equal(value.status,'unavailable');}
});

test('every enriched action contracts a partial graph rather than a fabricated complete empty response',async t=>{
  const f=await enrichedFixture(t,{handler:()=>new Response(JSON.stringify({errors:[{extensions:{code:'RATELIMITED'}}]}),{status:400,headers:{'retry-after':'120'}})});
  for(const [action,input,type] of actions){const value=await f.read(action,input);assertInterfaceShape(type,value);assert.equal(value.status,'partial');assert.equal(value.complete,false);}
});

test('nested partiality and foreign link projections are covered by the issued response shape',async t=>{
  const f=await enrichedFixture(t,{options:{limits:{maxPages:1}},handler:op=>op==='Issues'?{issues:connection([ticket('one',{parent:reference('foreign','another-team'),labels:connection([],true,'next')})])}:undefined});
  const result=await f.read();assertInterfaceShape('EnrichedIssues',result);assert.equal(result.data.issues.items[0].complete,false);
  const malformed=structuredClone(result);malformed.data.issues.items[0].parent.title='private title';
  assert.throws(()=>assertInterfaceShape('EnrichedIssues',malformed));
});
