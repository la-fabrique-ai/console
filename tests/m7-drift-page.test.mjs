import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { pageBlocks, pageSheet, pageReconfirm } from '../mods/fabrique-console-v4-ticket/blocks.js';
import { lineTickets, lineCard, lineLegend, lineDetail, lineDrift } from '../mods/fabrique-console-v4-ticket/line.js';

// M7: the page draws the drift the engine gives (kind, fields, when) in the block and the sheet of the mockup (screens 18
// to 21: « PRB-x changed »; 08 to 17: « No drift… »), the badge « ≠ » on the card, the legend « drift » and the chip of
// the details (screen 19). The words that say what changed and when are not in the mockup: provisional, for Codex.
const IDS=['PRB-142','PRB-147','PRB-151'];
const row=(id,n,state='todo')=>({id,n,title:'Titre '+id,level:'standard',dev:'claude',model:'claude-opus-5-5',deps:[],kind:'work',delivery:'included',state,rounds:0});
const planTicket=(id,n)=>({id,rank:n,title:'Titre '+id,result:'R',difficulty:'standard',kind:'work',delivery:'included',deps:[],texts:id==='PRB-151'?['guide /aide']:[],mockups:[]});
const mission={id:'M-1',project:'beta',step:'building',issue:{identifier:'PRB-41'},branch:'prb-41',tickets:IDS.map((id,i)=>row(id,i+1,i?'todo':'dev')),plan:{format:2,tickets:IDS.map((id,i)=>planTicket(id,i+1))}};
const at=(...parts)=>new Date(...parts).toISOString();
const approval={at:at(2026,10,12,15,2)};
const DRIFT=[{ticket:'PRB-152',kind:'added',title:'Correctif',at:at(2026,10,14,15,20)},{ticket:'PRB-147',kind:'changed',fields:['effort','model'],title:'Titre PRB-147',at:null},{ticket:'PRB-150',kind:'removed',title:'Ancien',at:at(2026,10,14,9,5)}];

test('the block: « PRB-x added / changed / removed » for each drift (decision 87), with what changed and when the engine saw it',()=>{
  const mid=pageBlocks({mission,story:{approval,drift:DRIFT}})[1];
  assert.deepEqual([mid.title,mid.count,mid.countTone],['Drift from approved plan','3','you']);
  assert.deepEqual(mid.rows.slice(0,3).map(r=>[r.sign,r.signTone,r.text,r.sub,r.right]),[
    ['≠','you','PRB-152 added','added after approval · Nov 14 at 3:20 pm','›'],
    ['≠','you','PRB-147 changed','effort, model changed','›'],
    ['≠','you','PRB-150 removed','removed from the plan · Nov 14 at 9:05 am','›']]);
  const none=pageBlocks({mission,story:{approval,drift:[]}})[1];
  assert.deepEqual([none.count,none.rows[0].text,none.rows[0].look],['','No drift from the approved plan','calm']);
});

test('the sheet: the mockup frame, each drift said, and the provisional « Approve these changes » when the engine can approve',()=>{
  const tickets=lineTickets(mission);
  const sheet=pageSheet({mission,tickets,open:{t:'list',id:'drift'},story:{approval,drift:DRIFT,driftSeen:'0123456789abcdef'}});
  assert.deepEqual([sheet.kicker,sheet.parts[0].text,sheet.parts[1].text],['Drift from approved plan','3 tickets changed since approval','Changes since your approval on Nov 12.']);
  assert.deepEqual(sheet.parts[2].items.map(i=>[i.sign,i.title,i.sub,i.tickets]),[
    ['≠','PRB-152: added after approval','Detected on Nov 14 at 3:20 pm',['PRB-152']],
    ['≠','PRB-147: effort, model changed','',['PRB-147']],
    ['≠','PRB-150: removed from the plan','Detected on Nov 14 at 9:05 am',['PRB-150']]]);
  assert.equal(sheet.parts[3].text,'A ticket added or postponed would show up here the same way, and on its card.');
  assert.deepEqual(sheet.parts[4],{kind:'action',label:'Approve these changes',act:{key:'reapprove',seen:'0123456789abcdef'}});
  // Without the version of the drift, nothing can be approved from here: no button (the simulation's states of the mockup).
  const bare=pageSheet({mission,tickets,open:{t:'list',id:'drift'},story:{approval,drift:DRIFT}});
  assert.equal(bare.parts.some(p=>p.kind==='action'),false);
  // The words of the mockup, given by the simulation, still win; never a « Reason… » line (decision 82).
  const sim=pageSheet({mission,tickets,open:{t:'list',id:'drift'},story:{approval,drift:[{ticket:'PRB-147',summary:'s',title:'PRB-147: child windows go from 100 to 50',reason:'Reason: too slow.'}]}});
  assert.deepEqual(sim.parts[2].items.map(i=>[i.title,i.sub]),[['PRB-147: child windows go from 100 to 50','']]);
});

test('the card, the legend and the details: « ≠ » « drift from the approved plan » on a ticket that drifted (screen 19)',()=>{
  const tickets=lineDrift(lineTickets(mission),{drift:DRIFT});
  assert.deepEqual(tickets.map(t=>Boolean(t.drift)),[false,true,false],'a removed or unknown ticket marks nothing');
  const card=lineCard(tickets[1],{stage:'develop'});
  assert.deepEqual(card.badges,[{text:'≠',tone:'you',tip:'drift from the approved plan'}]);
  assert.deepEqual(lineCard(tickets[2],{stage:'develop'}).badges.map(b=>b.text),['T'],'no drift, no badge');
  const both=lineCard({...tickets[2],drift:true},{stage:'develop'});
  assert.deepEqual(both.badges.map(b=>b.text),['≠','T'],'in the order of the mockup');
  const cards=tickets.map(t=>lineCard(t,{stage:'develop'}));
  const legend=lineLegend({tickets,cards,stage:'develop'});
  assert.deepEqual(legend.find(e=>e.glyph==='≠'),{kind:'badge',glyph:'≠',tone:'you',text:'drift',filter:null});
  const detail=lineDetail({mission:{...mission,tickets:tickets.map(({drift:_d,...t})=>t)},tickets,id:'PRB-147'});
  assert.ok(detail.chips.some(c=>c.text==='drift from the approved plan'&&c.tone==='you'),JSON.stringify(detail.chips));
  assert.deepEqual(lineDrift(lineTickets(mission),null).map(t=>Boolean(t.drift)),[false,false,false]);
});

test('the real page: « Approve these changes » sends the one command, with the version drawn',()=>{
  const root=fileURLToPath(new URL('..',import.meta.url));
  const child=spawnSync(process.execPath,['--experimental-vm-modules','--no-warnings',fileURLToPath(new URL('./helpers/ticket-confirm-probe.mjs',import.meta.url)),root],{encoding:'utf8',timeout:20000});
  assert.equal(child.status,0,child.stderr+child.stdout);
  assert.match(child.stdout,/reapprove: the button opens the box, cancel writes nothing, only the box sends the version the engine gave/);
});

// M7 review (decisions 81 and 82): every part of the plan and the branch of the worktree drift as a ticket does, in the
// frame of the mockup (« X changed », what it was and is, when, in the hour format of the mockup); the box of the changes
// shows the values approved; the approvals of before open from the sheet of the frozen copy.
const MORE=[{ticket:'PRB-147',kind:'changed',fields:['model'],changes:[{field:'model',from:'claude-sonnet-5-5',to:'claude-opus-5-5'}],values:{tool:'claude',model:'claude-opus-5-5',effort:'high',level:'fort'},title:'Titre PRB-147',at:at(2026,10,14,15,20)},
  {ticket:null,part:'migrations',kind:'added',changes:[{field:'migrations',from:null,to:'0025'}],at:null},
  {ticket:null,part:'toPlan.risks',kind:'changed',changes:[{field:'toPlan.risks',from:'collations',to:'collations, drops'}],at:at(2026,10,14,9,5)},
  {ticket:null,part:'branch',kind:'changed',changes:[{field:'branch',from:'prb-41',to:'prb-41-durcir'}],at:null},
  {ticket:'PRB-150',kind:'removed',title:'Ancien',at:null}];

test('every part of the plan and the branch: « X added / changed / removed », what it was and what it is, when',()=>{
  const mid=pageBlocks({mission,story:{approval,drift:MORE}})[1];
  assert.equal(mid.count,'5');
  assert.deepEqual(mid.rows.slice(0,5).map(r=>[r.text,r.sub]),[
    ['PRB-147 changed','model: sonnet 5.5 → opus 5.5 · Nov 14 at 3:20 pm'],
    ['Migrations added','added after approval: 0025'],
    ['Risks changed','collations → collations, drops · Nov 14 at 9:05 am'],
    ['Branch changed','prb-41 → prb-41-durcir'],
    ['PRB-150 removed','removed from the plan']]);
  const sheet=pageSheet({mission,tickets:lineTickets(mission),open:{t:'list',id:'drift'},story:{approval,drift:MORE,driftSeen:'0123456789abcdef'}});
  assert.equal(sheet.parts[0].text,'5 changes since approval');
  assert.deepEqual(sheet.parts[2].items.map(i=>[i.title,i.sub,i.tickets]),[
    ['PRB-147: model: sonnet 5.5 → opus 5.5','Detected on Nov 14 at 3:20 pm',['PRB-147']],
    ['Migrations: added after approval: 0025','',[]],
    ['Risks: collations → collations, drops','Detected on Nov 14 at 9:05 am',[]],
    ['Branch: prb-41 → prb-41-durcir','',[]],
    ['PRB-150: removed from the plan','',['PRB-150']]]);
  assert.equal(JSON.stringify(sheet).includes('Reason'),false,'no « Reason… » line');
  assert.deepEqual(lineDrift(lineTickets(mission),{drift:MORE}).filter(t=>t.drift).map(t=>t.id),['PRB-147'],'a part of the plan marks no card');
});

test('decision 81: the box of the changes says what is approved, and carries the version drawn',()=>{
  assert.equal(pageReconfirm({story:{approval,drift:MORE}}),null,'no version: no box');
  const box=pageReconfirm({story:{approval,drift:MORE,driftSeen:'0123456789abcdef'}});
  assert.deepEqual([box.title,box.cancel,box.go,box.seen],['Approve these changes?','Cancel','Approve these changes','0123456789abcdef']);
  assert.deepEqual(box.rows.map(r=>[r.key,r.label,r.text]),[
    ['drift-PRB-147','PRB-147','model: sonnet 5.5 → opus 5.5 · development settings: Claude Code · opus 5.5 · high effort · Heavy'],
    ['drift-migrations','Migrations','added after approval: 0025'],
    ['drift-toPlan.risks','Risks','collations → collations, drops'],
    ['drift-branch','Branch','prb-41 → prb-41-durcir'],
    ['drift-PRB-150','PRB-150','removed from the plan · no further development, review or merge'],
    // Decision 85: the box keeps a summary and points to the details (words of decision 87).
    ['details','Details','Choose Cancel to review the full before and after.'],
    ['frozen','Frozen copy','the updated plan and these changes, dated today']]);
});

test('decision 82: the approval of before opens from the sheet of the frozen copy',()=>{
  const now={at:at(2026,10,14,17,55),tickets:9,branch:'prb-41',openQuestions:0,kind:'reapproval',approves:[{ticket:'PRB-147',kind:'changed'},{part:'migrations',kind:'added'}],
    history:[{at:at(2026,10,12,15,2),revision:3,tickets:9,branch:'prb-41',openQuestions:0,manual:{summary:'0025 then 0026',count:2}}]};
  const sheet=pageSheet({mission,tickets:[],open:{t:'frozen'},story:{approval:now}});
  assert.equal(sheet.parts[0].text,'Plan approved on Nov 14 at 5:55 pm');
  assert.deepEqual(sheet.parts.find(p=>p.kind==='pairs').rows.at(-1),['Approved changes','PRB-147, Migrations']);
  const links=sheet.parts.filter(p=>p.kind==='link');
  assert.deepEqual(links.map(l=>[l.label,l.act]),[['Plan approved on Nov 12 at 3:02 pm ›',{key:'frozen',id:'0'}]]);
  const old=pageSheet({mission,tickets:[],open:{t:'frozen',id:'0'},story:{approval:now}});
  assert.deepEqual([old.key,old.parts[0].text,old.parts[1].text],['frozen:0','Plan approved on Nov 12 at 3:02 pm','Replaced by the approval on Nov 14 at 5:55 pm.']);
  assert.deepEqual(old.parts.find(p=>p.kind==='pairs').rows,[['Tickets','9 tickets, one at a time on prb-41'],['Questions','all settled'],['Your steps','0025 then 0026']]);
  assert.equal(old.parts.some(p=>p.kind==='link'),false);
  assert.equal(pageSheet({mission,tickets:[],open:{t:'frozen',id:'4'},story:{approval:now}}),null,'an approval that is not there');
});

// Decision 84: everything a reapproval approves is shown whole, in the block, the sheet and the box, from what the real
// engine gives: a ticket that changes a value and a list names both; a part whose summary stays says what changed in it;
// a part added gives its value. Provisional words, for Codex.
test('decision 84: a value and a list of a ticket, the entries of a part, the value of a part added: all shown',async()=>{
  const {driftOf}=await import('../src/mission.mjs');
  const A={id:'PRB-142',rank:1,title:'Titre PRB-142',result:'R',difficulty:'standard',agent:'claude',model:'claude-sonnet-5-5',effort:'high',deps:[],kind:'work',delivery:'included'};
  const B={...A,id:'PRB-147',rank:2,title:'Titre PRB-147',deps:['PRB-142']};
  const was={tickets:[A,B],toPlan:{risks:{summary:'collations',items:[{title:'Collations'},{title:'Locks'}]}}};
  const now={tickets:[A,{...B,model:'claude-opus-5-5',deps:['PRB-142','PRB-151']}],migrations:['0025'],requests:[{id:'r1',short:'Export'}],toPlan:{risks:{summary:'collations',items:[{title:'Collations',detail:'utf8mb4'},{title:'Drops'}]}}};
  const drift=driftOf({approval:{at:at(2026,10,12,15,2),plan:was},plan:now,tickets:[]});
  const story={approval,drift,driftSeen:'0123456789abcdef'};
  const mid=pageBlocks({mission,story})[1];
  assert.deepEqual(mid.rows.slice(0,drift.length).map(r=>[r.text,r.sub]),[
    ['PRB-147 changed','dependencies: PRB-142 → PRB-142, PRB-151; model: sonnet 5.5 → opus 5.5'],
    ['Migrations added','added after approval: 0025'],
    ['Issue coverage added','added after approval: Export'],
    ['Risks changed','items: Drops added; Locks removed; Collations changed']]);
  const sheet=pageSheet({mission,tickets:lineTickets(mission),open:{t:'list',id:'drift'},story});
  assert.deepEqual(sheet.parts[2].items.map(i=>i.title),[
    'PRB-147: dependencies: PRB-142 → PRB-142, PRB-151; model: sonnet 5.5 → opus 5.5',
    'Migrations: added after approval: 0025',
    'Issue coverage: added after approval: Export',
    'Risks: items: Drops added; Locks removed; Collations changed']);
  const box=pageReconfirm({story});
  assert.deepEqual(box.rows.map(r=>r.text).slice(0,4),[
    'dependencies: PRB-142 → PRB-142, PRB-151; model: sonnet 5.5 → opus 5.5 · development settings: Claude Code · opus 5.5 · high effort · Standard',
    'added after approval: 0025',
    'added after approval: Export',
    'items: Drops added; Locks removed; Collations changed']);
  // Never an empty line: whatever the engine gives, something is said, in the block (its text and its line under) and
  // in the box (its label and its text); never a field name with nothing after it (M7 review 3: the box was not read).
  const said=[...mid.rows.flatMap(r=>[r.text,r.sub].filter(x=>x!=='')),...box.rows.flatMap(r=>[r.label,r.text])];
  assert.ok(said.length>=mid.rows.length+box.rows.length*2);
  for(const line of said){
    assert.ok(typeof line==='string'&&line.trim()!==''&&!/^\s/.test(line),'empty line: '+JSON.stringify(line));
    assert.ok(!/:\s*($|;|·)/.test(line),'a field with nothing after it: '+JSON.stringify(line));
  }
  // A part removed says what it held; a field given without its values is still named.
  const gone=pageBlocks({mission,story:{approval,drift:[{ticket:null,part:'migrations',kind:'removed',changes:[{field:'migrations',from:'0025, 0026',to:null}],at:null},{ticket:'PRB-147',kind:'changed',fields:['deps','model'],changes:[{field:'model',from:'claude-sonnet-5-5',to:'claude-opus-5-5'}],at:null},{ticket:null,part:'approach',kind:'changed',changes:[{field:'text'}],at:null}]}})[1];
  assert.deepEqual(gone.rows.slice(0,3).map(r=>r.sub),['removed from the plan: 0025, 0026','model: sonnet 5.5 → opus 5.5; dependencies changed','text changed']);
});
