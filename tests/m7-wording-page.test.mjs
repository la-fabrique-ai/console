import test from 'node:test';
import assert from 'node:assert/strict';
import { pageBlocks, pageSheet, pageReconfirm } from '../mods/fabrique-console-v4-ticket/blocks.js';
import { W } from '../mods/fabrique-console-v4-ticket/words.js';
import { lineTickets } from '../mods/fabrique-console-v4-ticket/line.js';
import { driftOf } from '../src/mission.mjs';

// Decision 87: the words the user chose (Codex's recommendations, word for word) on the block, the sheet and the box of
// the drift, and on the frozen copy.
const IDS=['PRB-142','PRB-147'];
const row=(id,n,state='todo')=>({id,n,title:'Titre '+id,level:'standard',dev:'claude',model:'claude-opus-5-5',deps:[],kind:'work',delivery:'included',state,rounds:0});
const T=(id,n,more={})=>({id,rank:n,title:'Titre '+id,result:'R',difficulty:'standard',agent:'claude',model:'claude-sonnet-5-5',effort:'high',deps:[],kind:'work',delivery:'included',...more});
const mission={id:'M-1',project:'beta',step:'building',issue:{identifier:'PRB-41'},branch:'prb-41',tickets:IDS.map((id,i)=>row(id,i+1,i?'todo':'dev')),plan:{format:2,tickets:IDS.map((id,i)=>T(id,i+1))}};
const approval={at:new Date(2026,10,12,15,2).toISOString()};
const was={tickets:[T('PRB-142',1),T('PRB-147',2),T('PRB-150',3)],phases:[{id:'p1',title:'Base'}],requests:[{text:'Exporter en CSV'},{text:'Importer'}],approach:{summary:'s',note:{text:'avant'}}};
const now={tickets:[T('PRB-142',1),T('PRB-147',2,{model:'claude-opus-5-5'}),T('PRB-152',3)],requests:[{text:'Exporter en CSV'},{text:'Importer des fichiers'}],approach:{summary:'s',note:{text:'après'}},migrations:['0025']};
const story=(running=false,more={})=>({approval,drift:driftOf({approval:{at:approval.at,plan:was},plan:now,tickets:running?[{id:'PRB-150',state:'dev',running:true}]:[]}),driftSeen:'0123456789abcdef',...more});
const drawn=s=>({mid:pageBlocks({mission,story:s})[1],sheet:pageSheet({mission,tickets:lineTickets(mission),open:{t:'list',id:'drift'},story:s}),box:pageReconfirm({story:s})});
const pairsOf=sheet=>sheet.parts.filter(p=>p.kind==='pairs').flatMap(p=>p.rows);

test('the block names a ticket or a part added, changed or removed',()=>{
  const {mid}=drawn(story());
  const texts=mid.rows.map(r=>r.text);
  for(const t of ['PRB-147 changed','PRB-150 removed','PRB-152 added','Phases removed','Migrations added',"Lead's approach changed"])assert.ok(texts.includes(t),t+'\n'+JSON.stringify(texts));
});

test('a change the engine gives without its values says « details changed », never « changed » alone',()=>{
  const s={approval,driftSeen:'0123456789abcdef',drift:[{ticket:'PRB-147',kind:'changed',at:null}]};
  const {mid,box}=drawn(s);
  assert.equal(mid.rows.find(r=>r.text==='PRB-147 changed').sub,'details changed');
  assert.equal(box.rows.find(r=>r.key==='drift-PRB-147').text,'details changed');
});

test('the sheet: its introduction, the date of detection, entries without a name, paths and the dev of a ticket removed',()=>{
  const s=story(true);s.drift=s.drift.map(d=>({...d,at:new Date(2026,10,14,15,20).toISOString()}));
  const {sheet}=drawn(s);
  assert.equal(sheet.parts[1].text,'Changes since your approval on Nov 12.');
  const items=sheet.parts.filter(p=>p.kind==='items').flatMap(p=>p.items);
  assert.ok(items.every(i=>i.sub==='Detected on Nov 14 at 3:20 pm'),JSON.stringify(items));
  const pairs=pairsOf(sheet),has=(label,value)=>assert.ok(pairs.some(([l,v])=>l===label&&v===value),label+' = '+value+'\n'+JSON.stringify(pairs,null,1));
  has('Item 2 · before','text: Importer');has('Item 2 · after','text: Importer des fichiers');
  has('Note · Text · before','avant');has('Note · Text · after','après');
  has('Dev','Still running. Will stop after this turn. Its work will stay on its branch, without review or merge.');
  assert.ok(!pairs.some(([l])=>/^#\d|· #\d/.test(l)),JSON.stringify(pairs));
  assert.ok(items.some(i=>i.title==='Issue coverage: Item 2 changed'),JSON.stringify(items.map(i=>i.title)));
  assert.ok(!pairs.some(([l])=>l==='Its dev'),'the label is « Dev »');
});

test('the title of the sheet: « 1 change » in the singular',()=>{
  const s={approval,driftSeen:'0123456789abcdef',drift:driftOf({approval:{at:approval.at,plan:{tickets:[T('PRB-142',1)]}},plan:{tickets:[T('PRB-142',1)],migrations:['0025']},tickets:[]})};
  assert.equal(drawn(s).sheet.parts[0].text,'1 change since approval');
});

test('the box: development settings, a ticket removed, the pointer to the details and its frozen copy line',()=>{
  const text=(s,key)=>drawn(s).box.rows.find(r=>r.key===key)?.text;
  assert.equal(text(story(),'drift-PRB-147'),'model: sonnet 5.5 → opus 5.5 · development settings: Claude Code · opus 5.5 · high effort · Standard');
  assert.equal(text(story(),'drift-PRB-150'),'removed from the plan · no further development, review or merge');
  assert.equal(text(story(true),'drift-PRB-150'),'removed from the plan · Its dev will stop after this turn. Its work will stay on its branch, without review or merge.');
  const {box}=drawn(story());
  assert.deepEqual(box.rows.at(-2),{key:'details',label:'Details',text:'Choose Cancel to review the full before and after.'});
  assert.deepEqual(box.rows.at(-1),{key:'frozen',label:'Frozen copy',text:'the updated plan and these changes, dated today'});
  assert.equal(box.title,'Approve these changes?');assert.equal(box.go,'Approve these changes');
});

test('the first approval keeps its own frozen copy line',()=>{
  assert.equal(W.page.confirm.frozenText,'the preparation as you see it, dated today');
});

test('the frozen copy: what it shows, the approved changes, an approval replaced',()=>{
  const at=d=>new Date(2026,10,d,15,2).toISOString();
  const s={approval:{at:at(14),tickets:3,kind:'reapproval',approves:[{ticket:'PRB-152',kind:'added'},{part:'toPlan.risks',kind:'changed'}],history:[{at:at(12),tickets:2}]},drift:[]};
  const sheet=open=>pageSheet({mission,tickets:lineTickets(mission),open,story:s});
  const current=sheet({t:'frozen'});
  assert.ok(current.parts.some(p=>p.text==='Your approval is saved. This view shows its summary. Later changes are listed under “Drift from approved plan”.'),JSON.stringify(current.parts));
  assert.ok(pairsOf(current).some(([l,v])=>l==='Approved changes'&&v==='PRB-152, Risks'),JSON.stringify(pairsOf(current)));
  const earlier=sheet({t:'frozen',id:'0'});
  assert.ok(earlier.parts.some(p=>p.text==='Replaced by the approval on Nov 14 at 3:02 pm.'),JSON.stringify(earlier.parts));
});

test('the texts Codex found false or misleading are drawn nowhere any more',()=>{
  const all=JSON.stringify([drawn(story()),drawn(story(true))]);
  for(const old of ['stays readable in the frozen copy','The copy stays readable','never starts','starts with','still running: stopped','never reviewed or merged','are in the sheet','seen on','Changes approved'])assert.ok(!all.includes(old),old);
});
