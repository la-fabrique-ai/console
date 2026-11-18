import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { planTicket, setup, leadMission, FG2 } from './helpers/dev-chain-setup.mjs';
import { createMissionRegistry, createMissionActions, driftOf, frozenCopyOf } from '../src/mission.mjs';
import { createQuestionRegistry } from '../src/questions.mjs';
import { createRequestRegistry } from '../src/requests.mjs';

// M7: « Drift from approved plan ». What the plan of today, and the tracker, hold that the frozen copy the user approved
// does not: a ticket added, removed or changed after the approval, with when. Nothing otherwise: a plan recorded again
// as it was approved (a new revision, the identity read in the tracker since) is no drift.
const mission=(copy,today,more={})=>({approval:{at:'2026-11-14T10:00:00.000Z',plan:{tickets:copy}},plan:{tickets:today},tickets:[],...more});
const A=planTicket('XJ-2',1),B=planTicket('XJ-3',2,{deps:['XJ-2']});

test('the rule: added, removed, changed (with what changed); nothing when the plan is the one approved',()=>{
  assert.equal(driftOf({plan:{tickets:[A]}}),null,'not approved: nothing is said');
  assert.deepEqual(driftOf(mission([A,B],[{...A,uid:'u2'},{...B,uid:'u3'}])),[],'its identity read since is no change');
  const d=driftOf(mission([A,B],[A,{...B,model:'claude-opus-5-5',effort:'max'},planTicket('XJ-4',3)]));
  assert.deepEqual(d.map(x=>[x.ticket,x.kind,x.fields||null]),[['XJ-3','changed',['effort','model']],['XJ-4','added',null]]);
  assert.deepEqual(driftOf(mission([A,B],[A])).map(x=>[x.ticket,x.kind]),[['XJ-3','removed']]);
  assert.equal(d[1].title,'Lot XJ-4','its title, as the plan of today gives it');
  assert.equal(driftOf(mission([A,B],[A])).at(0).title,'Lot XJ-3','a removed ticket by its approved title');
  for(const x of d)assert.equal(x.at,null,'when it changed is never made up');
});

test('a sub-ticket the plan does not name: added once the chain knows it, unless it was there at the approval; done or canceled, none',()=>{
  const kid=(id,more={})=>({id,uid:'u'+id,title:'Lot — '+id,dev:'claude',model:'claude-sonnet-5-5',effort:'high',deps:[],state:'todo',tracker:'unstarted',...more});
  const m=mission([A],[A],{tickets:[{...kid('XJ-2')},kid('XJ-9'),kid('XJ-7',{tracker:'canceled'}),kid('XJ-6',{tracker:'completed'})]});
  assert.deepEqual(driftOf(m).map(x=>[x.ticket,x.kind]),[['XJ-9','added']]);
  // At the approval, what the chain already knew outside the plan is noted apart: neither approved nor drift.
  const before={plan:{tickets:[A],revision:1},tickets:[kid('XJ-2'),kid('XJ-8')],issue:{identifier:'XJ-1'}},copy=frozenCopyOf(before,{at:'x'});
  assert.deepEqual(copy.outside,['XJ-8']);
  assert.deepEqual(driftOf({...before,approval:copy}),[]);
});

// The engine: the plan recorded by the Lead after the approval, at given instants.
async function planned(){
  const root=await mkdtemp(join(tmpdir(),'fabrique-console-drift-'));let now=Date.parse('2026-11-14T10:00:00Z');
  const registry=createMissionRegistry({root,now:()=>now});
  await registry.create({project:'alpha',issue:{id:'i1',identifier:'XJ-1',title:'Paiement',url:'u'},request:'Payer'});
  const actions=createMissionActions({root,now:()=>now,registry,loadConfig:async()=>({}),loadState:async()=>({sessions:[]})});
  const save=async tickets=>actions.savePlan({mission:'M-1',plan:{tickets}});
  await save([A,B]);
  await registry.update('M-1',m=>{m.approval=frozenCopyOf(m,{at:new Date(now).toISOString()});});
  return {root,registry,save,at:t=>{now=Date.parse(t);},cleanup:()=>rm(root,{recursive:true,force:true})};
}

test('the plan rewritten after the approval: the drift says when; recorded again the same, the instant stays; back as approved, no drift',async()=>{
  const t=await planned();
  try{
    const drift=async()=>driftOf(await t.registry.read('M-1'));
    assert.deepEqual(await drift(),[]);
    t.at('2026-11-14T11:00:00Z');await t.save([A,{...B,model:'claude-opus-5-5'}]);
    assert.deepEqual((await drift()).map(x=>[x.ticket,x.kind,x.at]),[['XJ-3','changed','2026-11-14T11:00:00.000Z']]);
    t.at('2026-11-14T11:30:00Z');await t.save([A,{...B,model:'claude-opus-5-5'}]);
    assert.equal((await drift())[0].at,'2026-11-14T11:00:00.000Z','the same plan again changes nothing');
    t.at('2026-11-14T12:00:00Z');await t.save([A,{...B,model:'claude-opus-5-5'},planTicket('XJ-4',3)]);
    assert.deepEqual((await drift()).map(x=>[x.ticket,x.at]),[['XJ-3','2026-11-14T11:00:00.000Z'],['XJ-4','2026-11-14T12:00:00.000Z']]);
    t.at('2026-11-14T13:00:00Z');await t.save([A,B]);
    const m=await t.registry.read('M-1');
    assert.ok(m.plan.revision>m.approval.revision,'a new revision');
    assert.deepEqual(driftOf(m),[],'the plan back as approved: no drift');
  }finally{await t.cleanup();}
});

test('mission-read gives the drift and the version of it the screen draws, once approved; none before',async()=>{
  const t=await setup();
  try{
    const {missions}=await leadMission(t.root),questions=createQuestionRegistry({root:t.root});
    const actions=createMissionActions({root:t.root,registry:missions,questions,chain:t.chain,inbox:createRequestRegistry({root:t.root,questions,missions}),loadState:async()=>({sessions:[t.session]}),window:t.core.herdr.window,loadConfig:async()=>({})});
    let read=await actions.read({mission:'M-1'});
    assert.deepEqual(read.drift,[]);assert.equal(read.driftSeen,null);
    await actions.savePlan({mission:'M-1',plan:{tickets:[A,{...B,effort:'low'}]}});
    read=await actions.read({mission:'M-1'});
    assert.deepEqual(read.drift.map(x=>[x.ticket,x.kind,x.fields]),[['XJ-3','changed',['effort']]]);
    assert.match(read.driftSeen,/^[0-9a-f]{16}$/);
    assert.ok(!('driftAt' in read.mission)||typeof read.mission.driftAt==='object');
    await missions.update('M-1',m=>{delete m.approval;});
    read=await actions.read({mission:'M-1'});
    assert.equal('drift' in read,false,'not approved: nothing is said');
  }finally{await t.cleanup();}
});

test('a correction added in the tracker during the development shows up as added, with when the chain first saw it',async()=>{
  const t=await setup({},{},{plan:[A]});
  try{
    const {missions}=await leadMission(t.root);
    t.issue.children=[t.kid('XJ-2','u2')];
    assert.ok((await t.chain.launch({mission:'M-1',fresh:false,tickets:[FG2]})).launched[0].launched);
    await t.chain.tick({sessionId:'s1'});
    assert.deepEqual(driftOf(await missions.read('M-1')),[]);
    t.issue.children.push(t.kid('XJ-9','u9'));t.chain.forget();
    await t.chain.tick({sessionId:'s1'});
    const d=driftOf(await missions.read('M-1'));
    assert.deepEqual(d.map(x=>[x.ticket,x.kind]),[['XJ-9','added']]);
    assert.match(String(d[0].at),/^\d{4}-\d\d-\d\dT/);
  }finally{await t.cleanup();}
});
