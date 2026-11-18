import test from 'node:test';
import assert from 'node:assert/strict';
import { closeState } from '../mods/fabrique-console-v4-bar/nav.js';

// The Close of a Validation: once every test is marked and every ticket of the split accepted, while the Lead lives.
test('Close is offered once every test is marked, a problem included, and every ticket of the split is accepted', ()=>{
  const lead={address:'w1:p1'},now=Date.parse('2026-11-11T15:00:00Z');
  const qa={plan:[{id:'1'},{id:'2'},{id:'3'}],marks:{'1':{result:'ok'},'2':{result:'ko'},'3':{result:'ok'}}};
  const tickets=[{id:'ABC-2',n:1,state:'merged'},{id:'ABC-3',n:2,state:'accepted'},{id:'ABC-4',n:3,state:'todo',tracker:'canceled'},{id:'ABC-1',n:null,state:'todo',tracker:'backlog'}];
  const m={id:'M-1',step:'validating',tickets};
  assert.equal(closeState(m,qa,lead,now),'offer','a test marked as a problem does not hide it: the user decides');
  assert.equal(closeState(m,{...qa,marks:{'1':{result:'ok'},'2':{result:'ko'}}},lead,now),null,'a test not marked yet');
  assert.equal(closeState(m,{plan:[],marks:{}},lead,now),null,'no QA plan');
  assert.equal(closeState(m,null,lead,now),null,'no QA yet');
  assert.equal(closeState({...m,tickets:[...tickets.slice(0,3),{id:'ABC-5',n:4,state:'review'}]},qa,lead,now),null,'a ticket of the split still in review');
  assert.equal(closeState({...m,tickets:[]},qa,lead,now),null,'no ticket');
  assert.equal(closeState({...m,tickets:[{id:'ABC-7',n:null,state:'merged'},{id:'ABC-8',n:null,state:'todo',tracker:'completed'}]},qa,lead,now),'offer','no split table: every sub-issue');
  assert.equal(closeState(m,qa,null,now),null,'no Lead to ask');
  assert.equal(closeState({...m,closeAskedAt:'2026-11-11T14:59:00Z'},qa,lead,now),'asked');
  assert.equal(closeState({...m,closeAskedAt:'2026-11-11T14:50:00Z'},qa,lead,now),'offer','asked long ago: offered again');
  for(const step of ['validated','closed'])assert.equal(closeState({...m,step},qa,lead,now),null,step);
});

// A ticket the plan does not develop in this delivery stays open in the tracker: it never hides the Close.
test('Close is offered with a ticket delivered and a ticket of design, deferred, associated or integrated still open', ()=>{
  const lead={address:'w1:p1'},now=Date.parse('2026-11-11T15:00:00Z'),qa={plan:[{id:'1'}],marks:{'1':{result:'ok'}}};
  const done={id:'ABC-2',n:1,state:'merged',kind:'work',delivery:'included',integratedBy:null},open=(more,n=2)=>({id:'ABC-'+(n+1),n,state:'todo',tracker:'started',kind:'work',delivery:'included',integratedBy:null,...more});
  const out=[{kind:'design'},{delivery:'deferred'},{delivery:'associated'},{delivery:'integrated',integratedBy:'ABC-2'}];
  for(const more of out)assert.equal(closeState({id:'M-1',step:'validating',tickets:[done,open(more)]},qa,lead,now),'offer',JSON.stringify(more));
  assert.equal(closeState({id:'M-1',step:'validating',tickets:[done,...out.map((more,i)=>open(more,i+2))]},qa,lead,now),'offer','the four at once, as in M-4');
  assert.equal(closeState({id:'M-1',step:'validating',tickets:[done,open({}),open({kind:'design'},3)]},qa,lead,now),null,'a ticket developed here and still open holds it');
  assert.equal(closeState({id:'M-1',step:'validating',tickets:out.map((more,i)=>open(more,i+1))},qa,lead,now),null,'nothing developed here: nothing to close');
});
