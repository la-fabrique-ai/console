import test from 'node:test';
import assert from 'node:assert/strict';
import { planTicket, TWO, setup, leadMission, devRuns, news, FG2 } from './helpers/dev-chain-setup.mjs';
import { createMissionActions, driftOf } from '../src/mission.mjs';
import { createQuestionRegistry } from '../src/questions.mjs';
import { createRequestRegistry } from '../src/requests.mjs';

// The third round of M7 (decision 84): every change a reapproval approves is said whole (each field of a ticket named,
// a part of the plan whose summary stays says what changed in it); the sub-tickets kept out (`outside`) hold neither the
// end of the delivery nor a launch, and are never canceled in the tracker; the Lead is read under the lock of the
// reapproval.
const T0=Date.parse('2026-11-14T10:00:00Z');
const screenOf=(t,{registry=t.registry}={})=>{
  const questions=createQuestionRegistry({root:t.root}),inbox=createRequestRegistry({root:t.root,questions,missions:t.registry});
  return createMissionActions({root:t.root,now:()=>T0,registry,questions,chain:t.chain,inbox,loadState:async()=>({sessions:[t.session]}),window:t.core.herdr.window,loadConfig:async()=>({}),send:async()=>({sent:true})});
};
const ready=async(...args)=>{const t=await setup(...args);t.registry=(await leadMission(t.root)).missions;return t;};
const accept=(t,ticket,c,hour)=>t.reports.push({ticket,kind:'dev',commit:c.repeat(40),repo:'admin',summary:'fait',at:'2026-11-09T'+hour+':00:00.000Z'},{ticket,kind:'review-1',commit:c.repeat(40),verdict:'accepted',summary:'ok',at:'2026-11-09T'+hour+':30:00.000Z'});
const stopDev=(t,ticket)=>{for(const a of t.agents)if(a.tab_name.startsWith(ticket))a.status='idle';};
const A=planTicket('XJ-2',1),B=planTicket('XJ-3',2,{deps:['XJ-2']});
// The entries of a list, each given whole (decision 85), are checked in m7-review-3-drift; here, their names.
const names=changes=>changes.map(({entries:_entries,...c})=>c);
const drift=(was,now)=>driftOf({approval:{at:'2026-11-14T09:00:00.000Z',plan:{tickets:[A,B],...was}},plan:{tickets:[A,B],...now},tickets:[]});

test('a ticket that changes a value and a list names both, with what each was and is',()=>{
  const d=driftOf({approval:{at:'x',plan:{tickets:[A,B]}},plan:{tickets:[A,{...B,deps:['XJ-2','XJ-9'],model:'claude-opus-5-5'}]},tickets:[]});
  assert.deepEqual(d.map(x=>[x.ticket,x.kind,x.fields]),[['XJ-3','changed',['deps','model']]]);
  assert.deepEqual(d[0].changes,[{field:'deps',from:'XJ-2',to:'XJ-2, XJ-9'},{field:'model',from:'claude-sonnet-5-5',to:'claude-opus-5-5'}]);
  // A list emptied says it as nothing (null), never as a missing change.
  assert.deepEqual(driftOf({approval:{at:'x',plan:{tickets:[A,B]}},plan:{tickets:[A,{...B,deps:[]}]},tickets:[]})[0].changes,[{field:'deps',from:'XJ-2',to:null}]);
});

test('a part of the plan whose summary stays says what changed in it: its items, its other fields',()=>{
  const risks=items=>({toPlan:{risks:{summary:'collations',items}}});
  // An insertion or a removal also gives the whole list before and after (decision 86).
  const r=drift(risks([{title:'Collations'},{title:'Locks'}]),risks([{title:'Collations',detail:'utf8mb4 partout'},{title:'Drops'}]));
  assert.deepEqual(r.map(x=>[x.part,x.kind,names(x.changes)]),[['toPlan.risks','changed',[{field:'items',added:['Drops'],removed:['Locks'],changed:['Collations'],order:{from:['Collations','Locks'],to:['Collations','Drops']}}]]]);
  // The summary and the items together: both said.
  const both=drift(risks([{title:'Collations'}]),{toPlan:{risks:{summary:'collations, drops',items:[{title:'Collations'},{title:'Drops'}]}}});
  assert.deepEqual(names(both[0].changes),[{field:'toPlan.risks',from:'collations',to:'collations, drops'},{field:'items',added:['Drops'],removed:[],changed:[],order:{from:['Collations'],to:['Collations','Drops']}}]);
  // The steps of the user: only their note changes.
  const manual=note=>({toPlan:{manual:{summary:'0025 sur DEV',note,items:[{title:'Passer 0025'}]}}});
  assert.deepEqual(drift(manual('avant le déploiement'),manual('après le déploiement'))[0].changes,[{field:'note',from:'avant le déploiement',to:'après le déploiement'}]);
  // The approach: a paragraph changed, the summary the same; a paragraph is named by its place (and given whole in its
  // entry, decision 85).
  const long='x'.repeat(200);
  const approach=paragraphs=>({approach:{summary:'Un ticket à la fois',paragraphs}});
  assert.deepEqual(names(drift(approach(['Court.',long]),approach(['Court.',long+'!']))[0].changes),[{field:'paragraphs',added:[],removed:[],changed:['#2']}]);
  // The requests of the issue: by their few words.
  const req=requests=>({requests});
  const q=drift(req([{id:'r1',short:'Export'}]),req([{id:'r1',short:'Export CSV'},{id:'r2',short:'Filtre'}]));
  assert.deepEqual(q.map(x=>[x.part,names(x.changes)]),[['requests',[{field:'requests',added:['Filtre'],removed:[],changed:['Export CSV'],order:{from:['Export'],to:['Export CSV','Filtre']}}]]]);
});

test('a part added or removed gives its value: a migration added says which',()=>{
  assert.deepEqual(drift({},{migrations:['0025']}).map(x=>[x.part,x.kind,x.changes]),[['migrations','added',[{field:'migrations',from:null,to:'0025'}]]]);
  assert.deepEqual(drift({migrations:['0025','0026']},{}).map(x=>[x.part,x.kind,x.changes]),[['migrations','removed',[{field:'migrations',from:'0025, 0026',to:null}]]]);
  const added=drift({},{toPlan:{manual:{summary:'0025 sur DEV',items:[{title:'Passer 0025 sur DEV'}]}}});
  assert.deepEqual(names(added[0].changes),[{field:'toPlan.manual',from:null,to:'0025 sur DEV'},{field:'items',added:['Passer 0025 sur DEV'],removed:[],changed:[]}]);
});

test('decision 84: a sub-ticket kept out holds neither the end of the delivery nor a launch; the mission goes to Validation, the tracker untouched',async()=>{
  const t=await ready();
  try{
    const screen=screenOf(t);
    assert.ok((await t.chain.launch({mission:'M-1',fresh:false,tickets:[FG2]})).launched[0].launched);
    await screen.savePlan({mission:'M-1',plan:{tickets:[TWO[0]]}});
    await t.chain.tick({sessionId:'s1'});
    await screen.reapprove({mission:'M-1',seen:(await screen.read({mission:'M-1'})).driftSeen});
    assert.ok((await t.registry.read('M-1')).approval.outside.includes('XJ-3'));
    accept(t,'XJ-2','a','10');stopDev(t,'XJ-2');
    for(let n=0;n<4;n++)await t.chain.tick({sessionId:'s1'});
    assert.equal(devRuns(t.calls,'XJ-3'),0,'never launched');
    assert.equal(news(t.calls).filter(x=>x==='QA · XJ-1').length,1,'the QA starts on XJ-2 alone');
    assert.equal((await t.registry.read('M-1')).step,'validating','the mission goes to Validation');
    assert.equal(t.issue.children.find(k=>k.identifier==='XJ-3').state.type,'unstarted','XJ-3 is not canceled in the tracker');
  }finally{await t.cleanup();}
});

test('the Lead is read under the lock of the reapproval: one started between the click and the lock holds it',async()=>{
  const t=await ready();
  try{
    await t.chain.launch({mission:'M-1',fresh:false,tickets:[FG2]});
    await screenOf(t).savePlan({mission:'M-1',plan:{tickets:[TWO[0],{...TWO[1],effort:'low'}]}});
    const seen=(await screenOf(t).read({mission:'M-1'})).driftSeen;
    // No Lead when the click is read; the Lead starts, and works, just before the lock is taken.
    await t.registry.update('M-1',m=>{delete m.lead;});
    t.agents.find(a=>a.address==='t1').status='working';
    let first=true;
    const registry={...t.registry,update:async(id,fn)=>{if(first){first=false;await t.registry.update(id,m=>{m.lead={sessionId:'s1',lastSeen:null};});}return t.registry.update(id,fn);}};
    await assert.rejects(()=>screenOf(t,{registry}).reapprove({mission:'M-1',seen}),e=>e.code==='LEAD_WORKING');
    assert.equal((await t.registry.read('M-1')).approval.kind,undefined,'nothing approved');
  }finally{await t.cleanup();}
});
