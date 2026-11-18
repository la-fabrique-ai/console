import test from 'node:test';
import assert from 'node:assert/strict';
import { planTicket } from './helpers/dev-chain-setup.mjs';
import { driftOf } from '../src/mission.mjs';

// The fourth round of M7 (decision 85, rule 2): the drift gives the before and the after of every change, whole:
// entries changed, long texts, lists of numbers, entries without a title, and their order (M7 review 3).
const A=planTicket('XJ-2',1),B=planTicket('XJ-3',2,{deps:['XJ-2']});
const drift=(was,now)=>driftOf({approval:{at:'2026-11-14T09:00:00.000Z',plan:{tickets:[A,B],...was}},plan:{tickets:[A,B],...now},tickets:[]});
const risks=items=>({toPlan:{risks:{summary:'collations',items}}});

test('an entry changed gives what it was and what it is, whole',()=>{
  const r=drift(risks([{title:'Collations',detail:'latin1'}]),risks([{title:'Collations',detail:'utf8mb4 partout, puis DROP de la table users'}]));
  const c=r[0].changes[0];
  assert.deepEqual([c.field,c.changed],['items',['Collations']]);
  assert.deepEqual(c.entries,[{name:'Collations',kind:'changed',from:'title: Collations; detail: latin1',to:'title: Collations; detail: utf8mb4 partout, puis DROP de la table users'}]);
  // An entry added or removed gives its whole content too.
  const ar=drift(risks([{title:'Locks',detail:'verrou long'}]),risks([{title:'Drops',detail:'DROP users'}]))[0].changes[0];
  assert.deepEqual(ar.entries,[{name:'Drops',kind:'added',from:null,to:'title: Drops; detail: DROP users'},{name:'Locks',kind:'removed',from:'title: Locks; detail: verrou long',to:null}]);
  // A test account whose id changes.
  const acc=items=>({toPlan:{accounts:{summary:'2 comptes',items}}});
  const a=drift(acc([{title:'Admin',detail:'admin@old.fr'}]),acc([{title:'Admin',detail:'admin@new.fr'}]))[0].changes[0];
  assert.deepEqual(a.entries.map(e=>[e.name,e.from,e.to]),[['Admin','title: Admin; detail: admin@old.fr','title: Admin; detail: admin@new.fr']]);
});

test('a long text is given whole, never only named',()=>{
  const long='x'.repeat(200);
  const t=driftOf({approval:{at:'x',plan:{tickets:[A,B]}},plan:{tickets:[A,{...B,result:long}]},tickets:[]})[0];
  assert.deepEqual(t.changes,[{field:'result',from:'Ce que XJ-3 doit donner',to:long}]);
  const approach=paragraphs=>({approach:{summary:'Un ticket à la fois',paragraphs}});
  const p=drift(approach(['Court.',long]),approach(['Court.',long+'!']))[0].changes[0];
  assert.deepEqual(p.entries,[{name:'#2',kind:'changed',from:long,to:long+'!'}]);
  // An approach added, long: given whole.
  const added=drift({},{approach:{summary:long,paragraphs:['Un.']}})[0];
  assert.deepEqual(added.changes[0],{field:'approach',from:null,to:long});
});

test('a list of numbers says its values; a request without a title is named by its place and given whole',()=>{
  assert.deepEqual(drift({points:[1,2]},{points:[1,3]})[0].changes,[{field:'points',from:'1, 2',to:'1, 3'}]);
  const q=drift({requests:[{text:'Exporter en CSV'}]},{requests:[{text:'Exporter en CSV et en PDF'}]})[0].changes[0];
  assert.deepEqual(q.entries,[{name:'#1',kind:'changed',from:'text: Exporter en CSV',to:'text: Exporter en CSV et en PDF'}]);
});

test('the order counts: risks or phases reordered give their order before and after',()=>{
  const r=drift(risks([{title:'Collations'},{title:'Locks'}]),risks([{title:'Locks'},{title:'Collations'}]));
  assert.equal(r.length,1);
  assert.deepEqual(r[0].changes,[{field:'items',added:[],removed:[],changed:[],entries:[],order:{from:['Collations','Locks'],to:['Locks','Collations']}}]);
  const ph=drift({phases:[{id:'p1',title:'Base'},{id:'p2',title:'Page'}]},{phases:[{id:'p2',title:'Page'},{id:'p1',title:'Base'}]});
  assert.deepEqual(ph[0].changes,[{field:'phases',added:[],removed:[],changed:[],entries:[],order:{from:['Base','Page'],to:['Page','Base']}}]);
});

test('a ticket removed gives what it was; one added what it is',()=>{
  const gone=driftOf({approval:{at:'x',plan:{tickets:[A,B]}},plan:{tickets:[A]},tickets:[]})[0];
  assert.equal(gone.kind,'removed');
  assert.ok(gone.changes.some(c=>c.field==='title'&&c.from==='Lot XJ-3'&&c.to===null),JSON.stringify(gone.changes));
  const added=driftOf({approval:{at:'x',plan:{tickets:[A]}},plan:{tickets:[A,B]},tickets:[]})[0];
  assert.ok(added.changes.some(c=>c.field==='model'&&c.from===null&&c.to==='claude-sonnet-5-5'),JSON.stringify(added.changes));
});
