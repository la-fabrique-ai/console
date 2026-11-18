import test from 'node:test';
import assert from 'node:assert/strict';
import { pageBlocks, pageSheet, pageReconfirm } from '../mods/fabrique-console-v4-ticket/blocks.js';
import { lineTickets } from '../mods/fabrique-console-v4-ticket/line.js';
import { driftOf } from '../src/mission.mjs';

// The fourth round of M7 (decision 85), on the page: the sheet of the drift shows the before and the after of every
// change, whole, order included; the block and the box keep a summary, the box with a pointer to the sheet; never an
// empty line, never a field name with nothing after it; a ticket removed whose dev runs never « never starts » (words of decision 87).
const IDS=['PRB-142','PRB-147'];
const row=(id,n,state='todo')=>({id,n,title:'Titre '+id,level:'standard',dev:'claude',model:'claude-opus-5-5',deps:[],kind:'work',delivery:'included',state,rounds:0});
const T=(id,n,more={})=>({id,rank:n,title:'Titre '+id,result:'R',difficulty:'standard',agent:'claude',model:'claude-sonnet-5-5',effort:'high',deps:[],kind:'work',delivery:'included',...more});
const mission={id:'M-1',project:'beta',step:'building',issue:{identifier:'PRB-41'},branch:'prb-41',tickets:IDS.map((id,i)=>row(id,i+1,i?'todo':'dev')),plan:{format:2,tickets:IDS.map((id,i)=>T(id,i+1))}};
const approval={at:new Date(2026,10,12,15,2).toISOString()};
const long='Le résultat attendu, écrit longuement : '+'chaque export garde ses colonnes, '.repeat(6)+'fin.';
const risks=items=>({toPlan:{risks:{summary:'collations',items}}});
const was={tickets:[T('PRB-142',1),T('PRB-147',2),T('PRB-150',3)],phases:[{id:'p1',title:'Base'},{id:'p2',title:'Page'}],points:[1,2],requests:[{text:'Exporter en CSV'}],...risks([{title:'Collations',detail:'latin1'},{title:'Locks'}])};
const now={tickets:[T('PRB-142',1),T('PRB-147',2,{result:long})],phases:[{id:'p2',title:'Page'},{id:'p1',title:'Base'}],points:[1,3],requests:[{text:'Exporter en CSV et en PDF'}],...risks([{title:'Locks'},{title:'Collations',detail:'utf8mb4 partout, puis DROP de la table users'}])};
const story=(running=false)=>({approval,drift:driftOf({approval:{at:approval.at,plan:was},plan:now,tickets:running?[{id:'PRB-150',state:'dev',running:true}]:[]}),driftSeen:'0123456789abcdef'});
// Every line drawn: never empty, never starting with a space, never a field name with nothing after it.
const lines=({mid,sheet,box})=>[
  ...mid.rows.flatMap(r=>[r.text,r.sub].filter(x=>x!=='')),
  ...sheet.parts.flatMap(p=>p.kind==='items'?p.items.map(i=>i.title):p.kind==='pairs'?p.rows.flat():p.kind==='label'||p.kind==='title'||p.kind==='text'?[p.text]:[]),
  ...box.rows.flatMap(r=>[r.label,r.text])];
const drawn=s=>({mid:pageBlocks({mission,story:s})[1],sheet:pageSheet({mission,tickets:lineTickets(mission),open:{t:'list',id:'drift'},story:s}),box:pageReconfirm({story:s})});

test('the sheet gives the before and the after of every change, whole, order included',()=>{
  const {sheet}=drawn(story());
  const pairs=sheet.parts.filter(p=>p.kind==='pairs').flatMap(p=>p.rows);
  const has=(label,value)=>assert.ok(pairs.some(([l,v])=>l===label&&v===value),label+' = '+value+'\n'+JSON.stringify(pairs,null,1));
  // A long text, whole.
  has('Result · before','R');has('Result · after',long);
  // An entry changed, whole; the order of the risks, before and after.
  has('Items · Collations · before','title: Collations; detail: latin1');
  has('Items · Collations · after','title: Collations; detail: utf8mb4 partout, puis DROP de la table users');
  has('Items · order before','Collations, Locks');has('Items · order after','Locks, Collations');
  // The phases reordered: the order of execution.
  has('Order before','Base, Page');has('Order after','Page, Base');
  // A list of numbers by its values; a request without a title by its place, whole.
  has('Before','1, 2');has('After','1, 3');
  has('Item 1 · before','text: Exporter en CSV');has('Item 1 · after','text: Exporter en CSV et en PDF');
  // A ticket removed: what it was, one line per field (decision 86).
  has('Title','Titre PRB-150');
});

test('the box keeps a summary and points to the sheet; a long text or a moved order is named, never pasted',()=>{
  const {box,mid}=drawn(story());
  const text=key=>box.rows.find(r=>r.key===key)?.text;
  assert.equal(text('drift-PRB-147'),'result changed · development settings: Claude Code · sonnet 5.5 · high effort · Standard');
  assert.equal(text('drift-phases'),'order changed');
  assert.equal(text('drift-toPlan.risks'),'items: Collations changed; order changed');
  assert.equal(text('drift-points'),'1, 2 → 1, 3');
  assert.equal(text('drift-requests'),'Item 1 changed');
  assert.deepEqual(box.rows.at(-2),{key:'details',label:'Details',text:'Choose Cancel to review the full before and after.'});
  assert.equal(box.rows.at(-1).key,'frozen');
  assert.equal(mid.rows.find(r=>r.text==='Phases changed').sub,'order changed');
});

test('a ticket removed: « no further development, review or merge » only when its dev does not run',()=>{
  assert.equal(drawn(story()).box.rows.find(r=>r.key==='drift-PRB-150').text,'removed from the plan · no further development, review or merge');
  const running=drawn(story(true));
  const t=running.box.rows.find(r=>r.key==='drift-PRB-150').text;
  assert.equal(t,'removed from the plan · Its dev will stop after this turn. Its work will stay on its branch, without review or merge.');
  assert.ok(!JSON.stringify(running).includes('no further development'));
  assert.ok(running.sheet.parts.filter(p=>p.kind==='pairs').flatMap(p=>p.rows).some(([l,v])=>l==='Dev'&&v==='Still running. Will stop after this turn. Its work will stay on its branch, without review or merge.'));
});

test('never an empty line, in the block, the sheet and the box; never a field name with nothing after it',()=>{
  // The cases of the review: a reordering alone, a long approach added, entries without a title, a field given alone.
  const cases=[story(),story(true),
    {approval,driftSeen:'0123456789abcdef',drift:driftOf({approval:{at:approval.at,plan:{tickets:[T('PRB-142',1)],...risks([{title:'A'},{title:'B'}])}},plan:{tickets:[T('PRB-142',1)],...risks([{title:'B'},{title:'A'}])},tickets:[]})},
    {approval,driftSeen:'0123456789abcdef',drift:driftOf({approval:{at:approval.at,plan:{tickets:[T('PRB-142',1)]}},plan:{tickets:[T('PRB-142',1)],approach:{summary:long,paragraphs:[long]}},tickets:[]})},
    {approval,driftSeen:'0123456789abcdef',drift:[{ticket:'PRB-147',kind:'changed',fields:['deps'],at:null},{ticket:null,part:'toPlan.risks',kind:'changed',changes:[{field:'items',added:[],removed:[],changed:[]}],at:null},{ticket:null,part:'approach',kind:'changed',changes:[{field:'text'}],at:null}]}];
  for(const s of cases){
    for(const line of lines(drawn(s))){
      assert.equal(typeof line,'string',JSON.stringify(line));
      assert.ok(line.trim()!==''&&!/^\s/.test(line),'empty line: '+JSON.stringify(line));
      assert.ok(!/:\s*($|;|·)/.test(line),'a field with nothing after it: '+JSON.stringify(line));
      assert.ok(!/(^|; )[a-z.]+:\s*$/i.test(line),'a field name alone: '+JSON.stringify(line));
    }
  }
  // A long approach added says it was added, never « added after approval: Lead's approach changed ».
  const added=drawn(cases[3]);
  assert.equal(added.box.rows.find(r=>r.key==='drift-approach').text,'added after approval');
});
