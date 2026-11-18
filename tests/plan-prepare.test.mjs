import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { planOf, samePlan } from '../src/plan.mjs';
import { createMissionActions, createMissionRegistry } from '../src/mission.mjs';

// Ticket M3: what the Lead records beside its tickets for Prepare (simulation/CONTRAT.md § 1): its approach, the phases
// it announces, the migrations, how each request of the issue is covered, what to plan for, and the case of one ticket.
const ticket=(id,rank,more={})=>({id,rank,title:'Ticket '+id,result:'Ce que '+id+' doit donner',difficulty:'standard',agent:'codex',model:'gpt-5.5',effort:'medium',...more});
const full=(more={})=>({
  tickets:[ticket('DEMO-2',1,{phase:'core',covers:['r1']}),ticket('DEMO-3',2,{phase:'ui',deps:['DEMO-2'],covers:['r1','r2'],texts:['Export button label']}),ticket('DEMO-4',3,{phase:'ui',delivery:'deferred',covers:['r3']})],
  phases:[{id:'core',title:'Writer'},{id:'ui',title:'Button'},{id:'check',title:'Measure'}],
  approach:{summary:'Write the CSV first, then the button.',text:'A writer turns the rows into CSV; the button calls it.',paragraphs:['First the writer, tested alone.','Then the button on the list.']},
  migrations:['0025','0026'],
  requests:[{id:'r1',short:'Export as CSV',full:'Every row of the list can be exported as CSV.'},{id:'r2',short:'A button',full:'An Export button on the list.'},
    {id:'r3',short:'Excel export',full:'The list can be exported for Excel.',state:'postponed',postponedAt:'2026-11-12',reason:'Postponed by you: a follow-up issue.'},
    {id:'r4',short:'Help page',full:'The help page says how to export.',state:'asked',reason:'The Lead asks whether the guide changes.'}],
  toPlan:{
    manual:{summary:'0025 then 0026 · DEV',note:'Nothing else to plan for.',items:[{title:'Run 0025 then 0026 on DEV',detail:'after the merge',tickets:['DEMO-2']},{title:'Run them on the target',detail:'once DEV is checked'}]},
    risks:{summary:'large lists',items:[{title:'Large lists may be slow to export',detail:'Planned: measure on 10 000 rows.',tickets:['DEMO-2']}]},
    copy:[{title:'Export button label',section:'list toolbar',detail:'one or two words',ticket:'DEMO-3'}],
    accounts:{summary:'admin',items:[{title:'Admin of the test project',detail:'to see every row'}]}},
  ...more});
const one=(more={})=>({tickets:[ticket('DEMO-2',1,{difficulty:'light',covers:['r1']})],simple:true,points:3,migrations:[],requests:[{id:'r1',short:'Export as CSV',full:'Every row can be exported.'}],
  toPlan:{accounts:{summary:'member',items:[{title:'Member of the test project',detail:'to export'}]}},...more});
const refused=(raw,words)=>assert.throws(()=>planOf(raw),e=>{assert.equal(e.code,'PLAN_INVALID',e.message);assert.match(e.message,words);return true;});

test('a full plan keeps what Prepare reads, in the shape of the contract: approach, phases, migrations, requests and what covers them, what to plan for',()=>{
  const got=planOf(full());
  assert.deepEqual(got.approach,full().approach);
  assert.deepEqual(got.migrations,['0025','0026']);
  assert.deepEqual(got.phases.map(p=>p.id),['core','ui','check'],'a phase the approach announces is kept without a ticket');
  // What covers a request is what the Lead says on its tickets (covers), in the order of their ranks; a ticket deferred
  // to a later delivery covers nothing in this one.
  assert.deepEqual(got.requests,[
    {id:'r1',short:'Export as CSV',full:'Every row of the list can be exported as CSV.',tickets:['DEMO-2','DEMO-3']},
    {id:'r2',short:'A button',full:'An Export button on the list.',tickets:['DEMO-3']},
    {id:'r3',short:'Excel export',full:'The list can be exported for Excel.',tickets:[],state:'postponed',postponedAt:'2026-11-12',reason:'Postponed by you: a follow-up issue.'},
    {id:'r4',short:'Help page',full:'The help page says how to export.',tickets:[],state:'asked',reason:'The Lead asks whether the guide changes.'}]);
  assert.deepEqual(got.toPlan,{
    manual:{summary:'0025 then 0026 · DEV',note:'Nothing else to plan for.',items:[{title:'Run 0025 then 0026 on DEV',detail:'after the merge',tickets:['DEMO-2']},{title:'Run them on the target',detail:'once DEV is checked',tickets:[]}]},
    risks:{summary:'large lists',items:[{title:'Large lists may be slow to export',detail:'Planned: measure on 10 000 rows.',tickets:['DEMO-2']}]},
    copy:[{title:'Export button label',section:'list toolbar',detail:'one or two words',ticket:'DEMO-3'}],
    accounts:{summary:'admin',items:[{title:'Admin of the test project',detail:'to see every row',tickets:[]}]}});
  assert.equal(got.simple,undefined);assert.equal(got.points,undefined);
  // The same plan written in another order is the same plan; a change of any of these fields is a new one.
  const shuffled=full();shuffled.tickets.reverse();assert.ok(samePlan(planOf(shuffled),got));
  for(const change of [{migrations:['0025']},{approach:{summary:'Another approach.'}},{toPlan:{}},{requests:full().requests.slice(0,3)}])assert.ok(!samePlan(planOf(full(change)),got),JSON.stringify(change));
});

test('a plan of one ticket says it, with the points of the check',()=>{
  const got=planOf(one());
  assert.deepEqual([got.simple,got.points,got.migrations,got.approach,got.requests[0].tickets],[true,3,[],undefined,['DEMO-2']]);
  assert.deepEqual(planOf(one({simple:false,points:undefined})).simple,undefined,'simple false is said by leaving it out');
});

test('a plan without these fields is accepted as before: nothing of them is invented',()=>{
  const got=planOf({tickets:[ticket('DEMO-2',1)]});
  for(const key of ['approach','migrations','simple','points','toPlan'])assert.ok(!Object.hasOwn(got,key),key);
  assert.deepEqual([got.phases,got.requests],[[],[]]);
  assert.deepEqual(planOf({tickets:[ticket('DEMO-2',1)],toPlan:{risks:{items:[]}}}).toPlan,{risks:{summary:'',items:[]}},'a list said empty is kept empty: « none flagged »');
});

test('a field badly formed is refused whole, with the field at fault named',()=>{
  refused(full({approach:'Write the CSV'}),/approach/);
  refused(full({approach:{text:'no summary'}}),/approach\.summary/);
  refused(full({approach:{summary:'ok',paragraphs:'one'}}),/approach\.paragraphs/);
  refused(full({approach:{summary:'ok',more:1}}),/approach.*more/);
  refused(full({migrations:'0025'}),/migrations/);refused(full({migrations:['']}),/migrations/);
  refused(full({requests:[{id:'r1',short:'Export'}]}),/requests\[r1\]\.full/);
  refused(full({requests:[{id:'r1',full:'Export every row'}]}),/requests\[r1\]\.short/);
  refused(full({requests:[{id:'r1',text:'Export every row'}]}),/requests\[r1\].*short.*full/,'the request of the old format says what replaces it');
  refused(full({requests:[...full().requests.slice(0,3),{id:'r4',short:'x',full:'y',state:'later'}]}),/requests\[r4\]\.state/);
  refused(full({requests:[{id:'r1',short:'x',full:'y',state:'asked'},...full().requests.slice(1)]}),/requests\[r1\]\.state.*DEMO-2/,'a request a ticket covers has no state');
  refused(full({requests:[...full().requests.slice(0,3),{id:'r4',short:'x',full:'y',state:'asked',postponedAt:'2026-11-12'}]}),/requests\[r4\]\.postponedAt/);
  refused(full({requests:[...full().requests.slice(0,2),{...full().requests[2],postponedAt:'yesterday'}]}),/requests\[r3\]\.postponedAt/);
  // A day that is not on the calendar is refused, never read as another one (« 2026-02-30 » would be March 2: review M3, P3).
  for(const day of ['2026-02-30','2026-13-01','2026-04-31','2026-02-30T10:00:00Z','2026-11-12T24:30:00Z','2026-11-12T10:60Z'])refused(full({requests:[...full().requests.slice(0,2),{...full().requests[2],postponedAt:day}]}),/requests\[r3\]\.postponedAt/);
  assert.equal(planOf(full({requests:[...full().requests.slice(0,2),{...full().requests[2],postponedAt:'2028-02-29'}]})).requests[2].postponedAt,'2028-02-29','a leap day stands');
  refused(full({toPlan:[]}),/toPlan/);refused(full({toPlan:{notes:{}}}),/toPlan.*notes/);
  refused(full({toPlan:{risks:['slow']}}),/toPlan\.risks/);
  refused(full({toPlan:{risks:{summary:'x',items:[{detail:'no title'}]}}}),/toPlan\.risks\.items\[1\]\.title/);
  refused(full({toPlan:{manual:{items:[{title:'Run 0025'}]}}}),/toPlan\.manual\.summary/,'a list with items says its line');
  refused(full({toPlan:{manual:{summary:'x',items:[{title:'Run 0025',tickets:['DEMO-9']}]}}}),/toPlan\.manual\.items\[1\]\.tickets.*DEMO-9/);
  refused(full({toPlan:{copy:[{title:'Label',ticket:'DEMO-9'}]}}),/toPlan\.copy\[1\]\.ticket.*DEMO-9/);
  refused(full({toPlan:{accounts:{summary:'x',items:[{title:'Admin',password:'p'}]}}}),/toPlan\.accounts\.items\[1\].*password/);
  refused(one({simple:'yes'}),/simple/);
  refused(full({simple:true}),/simple.*one ticket/);
  refused(one({points:2.5}),/points/);refused(one({points:0}),/points/);
  refused(full({points:3}),/points.*simple/);
  // The two lists of the old format say where they went.
  refused(full({risks:['Large lists']}),/risks.*toPlan\.risks/);refused(full({manual:['Run 0025']}),/manual.*toPlan\.manual/);
});

test('lead-plan records these fields in the mission, where the page reads them',async t=>{
  const root=await mkdtemp(join(tmpdir(),'fabrique-console-plan-m3-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const kids=['DEMO-2','DEMO-3','DEMO-4'].map((identifier,n)=>({id:'u'+n,identifier,title:'Lot '+identifier,state:{name:'Backlog',type:'backlog'},labels:[]}));
  const getTickets=async()=>({detail:async()=>({issue:{id:'i1',identifier:'DEMO-1',children:kids}})});
  const registry=createMissionRegistry({root,now:()=>Date.parse('2026-11-13T09:00:00.000Z')});
  const actions=createMissionActions({registry,loadState:async()=>({sessions:[]}),loadConfig:async()=>{throw new Error('no configuration');},getTickets});
  await registry.create({project:'demo',issue:{id:'i1',identifier:'DEMO-1'},request:'Export'});
  const got=await actions.savePlan({mission:'M-1',plan:full()});
  assert.equal(got.saved,true);
  const plan=(await registry.read('M-1')).plan;
  assert.deepEqual([plan.approach,plan.migrations,plan.requests,plan.toPlan],[planOf(full()).approach,['0025','0026'],planOf(full()).requests,planOf(full()).toPlan]);
  assert.equal((await actions.savePlan({mission:'M-1',plan:full()})).unchanged,true,'the same plan again changes nothing');
  await assert.rejects(()=>actions.savePlan({mission:'M-1',plan:full({migrations:[1]})}),e=>e.code==='PLAN_INVALID'&&/migrations/.test(e.message));
  assert.deepEqual((await registry.read('M-1')).plan.migrations,['0025','0026'],'a plan refused leaves the one recorded');
});
