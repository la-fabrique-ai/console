import test from 'node:test';
import assert from 'node:assert/strict';
import { planTicket } from './helpers/dev-chain-setup.mjs';
import { driftOf } from '../src/mission.mjs';
import { pageSheet, pageReconfirm } from '../mods/fabrique-console-v4-ticket/blocks.js';
import { lineTickets } from '../mods/fabrique-console-v4-ticket/line.js';

// The fifth round of M7 (decision 86, rules 2 and 3): a ticket added, of the plan or of the tracker (a new sub-ticket),
// gives each of its fields in the sheet, one line per field, its level written as the box writes it; a ticket removed
// too. As soon as a list changes (order, insertion, removal), the sheet gives the whole list before and after, never a
// difference computed. Provisional words, for Codex.
const A=planTicket('XJ-2',1),B=planTicket('XJ-3',2,{deps:['XJ-2']});
const AT='2026-11-14T09:00:00.000Z';
const SUB={id:'XJ-9',title:'Export des notes',level:'fort',dev:'codex',model:'gpt-5.5',effort:'medium',deps:['XJ-2','XJ-3'],state:'todo'};
const mission=(approved,now,tickets=[])=>({id:'M-1',project:'alpha',step:'building',issue:{identifier:'XJ-1'},branch:'xj-1',tickets,plan:now,approval:{at:AT,plan:approved}});
const story=m=>({approval:m.approval,drift:driftOf(m),driftSeen:'0123456789abcdef'});
const pairsOf=(m,name)=>{
  const sheet=pageSheet({mission:m,tickets:lineTickets(m),open:{t:'list',id:'drift'},story:story(m)});
  const parts=sheet.parts,at=parts.findIndex(p=>p.kind==='label'&&p.text===name);
  assert.ok(at>=0,'the sheet names '+name+'\n'+JSON.stringify(parts.filter(p=>p.kind==='label')));
  assert.equal(parts[at+1].kind,'pairs');
  return parts[at+1].rows;
};

test('a new sub-ticket of the tracker gives each of its fields whole in the drift',()=>{
  const d=driftOf(mission({tickets:[A,B]},{tickets:[A,B]},[SUB])).find(x=>x.ticket==='XJ-9');
  assert.equal(d.kind,'added');
  const by=Object.fromEntries(d.changes.map(c=>[c.field,c.to]));
  assert.deepEqual(by,{deps:'XJ-2, XJ-3',dev:'codex',effort:'medium',level:'fort',model:'gpt-5.5',title:'Export des notes'});
  assert.ok(d.changes.every(c=>c.from===null),'nothing before');
});

test('the sheet gives a sub-ticket of the tracker added, one line per field, its level as the box writes it',()=>{
  const m=mission({tickets:[A,B]},{tickets:[A,B]},[SUB]);
  const rows=pairsOf(m,'XJ-9');
  assert.deepEqual(rows,[['Dependencies','XJ-2, XJ-3'],['Tool','Codex'],['Effort','medium'],['Level','Heavy'],['Model','gpt-5.5'],['Title','Export des notes']]);
  assert.ok(rows.every(([l,v])=>!/· (before|after)$/.test(l)&&v!=='—'),'one line per field, never « before = — »');
  // The box says the same level.
  assert.ok(pageReconfirm({story:story(m)}).rows.find(r=>r.key==='drift-XJ-9').text.endsWith('Heavy'));
});

test('a ticket of the plan added or removed: one line per field, « Tool = Claude Code », the level as the box',()=>{
  const C=planTicket('XJ-4',3,{difficulty:'heavy',deps:['XJ-3']});
  const added=pairsOf(mission({tickets:[A,B]},{tickets:[A,B,C]}),'XJ-4');
  const has=(rows,l,v)=>assert.ok(rows.some(r=>r[0]===l&&r[1]===v),l+' = '+v+'\n'+JSON.stringify(rows));
  has(added,'Tool','Claude Code');has(added,'Level','Heavy');has(added,'Title','Lot XJ-4');has(added,'Dependencies','XJ-3');has(added,'Result','Ce que XJ-4 doit donner');
  assert.ok(added.every(([l])=>!/· (before|after)$/.test(l)));
  const removed=pairsOf(mission({tickets:[A,B]},{tickets:[A]}),'XJ-3');
  has(removed,'Tool','Claude Code');has(removed,'Level','Standard');has(removed,'Title','Lot XJ-3');has(removed,'Dependencies','XJ-2');
  assert.ok(removed.every(([l])=>!/· (before|after)$/.test(l)));
});

const phases=list=>list.map(t=>({id:'p-'+t,title:t}));
test('an insertion gives the whole list before and after: [Base, Page] → [Base, Migration, Page]',()=>{
  const m=mission({tickets:[A,B],phases:phases(['Base','Page'])},{tickets:[A,B],phases:phases(['Base','Migration','Page'])});
  const c=driftOf(m).find(d=>d.part==='phases').changes[0];
  assert.deepEqual(c.order,{from:['Base','Page'],to:['Base','Migration','Page']});
  const rows=pairsOf(m,'Phases');
  assert.ok(rows.some(r=>r[0]==='Order before'&&r[1]==='Base, Page'),JSON.stringify(rows));
  assert.ok(rows.some(r=>r[0]==='Order after'&&r[1]==='Base, Migration, Page'),JSON.stringify(rows));
  // The box keeps its summary as it was: no order moved among the phases both lists hold.
  assert.equal(pageReconfirm({story:story(m)}).rows.find(r=>r.key==='drift-phases').text,'Migration added');
});

test('a removal, and a change of the entries of a part, give the whole list before and after too',()=>{
  const m=mission({tickets:[A,B],phases:phases(['Base','Migration','Page'])},{tickets:[A,B],phases:phases(['Base','Page'])});
  assert.deepEqual(driftOf(m).find(d=>d.part==='phases').changes[0].order,{from:['Base','Migration','Page'],to:['Base','Page']});
  const risks=items=>({toPlan:{risks:{summary:'collations',items}}});
  const r=driftOf(mission({tickets:[A,B],...risks([{title:'Locks'}])},{tickets:[A,B],...risks([{title:'Locks'},{title:'Drops'}])})).find(d=>d.part==='toPlan.risks');
  assert.deepEqual(r.changes[0].order,{from:['Locks'],to:['Locks','Drops']});
  // A reordering alone still says its order moved in the box.
  const moved=mission({tickets:[A,B],phases:phases(['Base','Page'])},{tickets:[A,B],phases:phases(['Page','Base'])});
  assert.equal(pageReconfirm({story:story(moved)}).rows.find(r=>r.key==='drift-phases').text,'order changed');
});

test('the place of a ticket (rank) is its « Position » in the drift, « Order before / after » stays for a list (decision 91)',()=>{
  const has=(rows,l,v)=>assert.ok(rows.some(r=>r[0]===l&&r[1]===v),l+' = '+v+'\n'+JSON.stringify(rows));
  const added=pairsOf(mission({tickets:[A,B]},{tickets:[A,B,planTicket('XJ-4',3)]}),'XJ-4');
  has(added,'Position','3');
  assert.ok(added.every(([l])=>!/^Order/.test(l)),JSON.stringify(added));
  // A ticket moved: its position before and after, and the line says « position: 2 → 3 ».
  const m=mission({tickets:[A,B]},{tickets:[A,{...B,rank:3}]}),moved=pairsOf(m,'XJ-3');
  has(moved,'Position · before','2');has(moved,'Position · after','3');
  assert.match(pageReconfirm({story:story(m)}).rows.find(r=>r.key==='drift-XJ-3').text,/^position: 2 → 3/);
  // A list keeps its whole order before and after.
  const rows=pairsOf(mission({tickets:[A,B],phases:phases(['Base','Page'])},{tickets:[A,B],phases:phases(['Page','Base'])}),'Phases');
  has(rows,'Order before','Base, Page');has(rows,'Order after','Page, Base');
});
