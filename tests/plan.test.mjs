import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { againstTracker, planOf, planRows, samePlan, PLAN_FORMAT } from '../src/plan.mjs';
import { createMissionActions, createMissionRegistry } from '../src/mission.mjs';
import { createDevChain } from '../src/dev-chain.mjs';
import { fakeHerdr } from './helpers/fake-herdr.mjs';
import { approvePlan } from './helpers/dev-chain-setup.mjs';
import { leadPrompt } from '../src/po-launch.mjs';
import { launchBanner, readyTickets, ticketDetail, missionProgress } from '../mods/fabrique-console-v4-devs/nav.js';

// The plan of a Lead, as it records it: three tickets of one issue, the third waiting for the two others.
const ticket=(id,rank,more={})=>({id,rank,title:'Ticket '+id,result:'Ce que '+id+' doit donner',difficulty:'standard',agent:'claude',model:'claude-sonnet-5-5',effort:'high',...more});
const plan=(more={})=>({
  tickets:[ticket('XJ-2',1,{phase:'base',covers:['R1'],texts:['Titre de la page'],mockups:['K-1']}),ticket('XJ-3',2,{difficulty:'heavy',agent:'codex',model:'gpt-6.1-sol',covers:['R2']}),ticket('XJ-4',3,{deps:['XJ-2','XJ-3'],difficulty:'light'})],
  phases:[{id:'base',title:'Le socle'}],requests:[{id:'R1',short:'Payer',full:'Payer en ligne'},{id:'R2',short:'Reçu',full:'Recevoir un reçu'}],toPlan:{risks:{summary:'paiement',items:[{title:'Le prestataire de paiement change son API'}]},manual:{summary:'migration',items:[{title:'Lancer la migration en production'}]}},...more});
const refused=(raw,code,words)=>assert.throws(()=>planOf(raw),e=>{assert.equal(e.code,code,e.message);if(words)assert.match(e.message,words);return true;});

test('a plan is read whole: its tickets by their tracker identifier, their rank apart, and what the issue asks',()=>{
  const got=planOf(plan());
  assert.equal(got.format,PLAN_FORMAT);
  assert.deepEqual(got.tickets.map(t=>[t.id,t.rank,t.difficulty,t.agent,t.deps]),[['XJ-2',1,'standard','claude',[]],['XJ-3',2,'heavy','codex',[]],['XJ-4',3,'light','claude',['XJ-2','XJ-3']]]);
  assert.deepEqual(got.tickets[0],{id:'XJ-2',rank:1,title:'Ticket XJ-2',result:'Ce que XJ-2 doit donner',difficulty:'standard',kind:'work',delivery:'included',integratedBy:null,agent:'claude',model:'claude-sonnet-5-5',effort:'high',modelReason:null,deps:[],phase:'base',covers:['R1'],texts:['Titre de la page'],mockups:['K-1']});
  assert.deepEqual(got.phases,[{id:'base',title:'Le socle'}]);assert.deepEqual(got.requests.map(r=>r.id),['R1','R2']);
  assert.deepEqual(got.toPlan.risks.items.map(i=>i.title),['Le prestataire de paiement change son API']);assert.deepEqual(got.toPlan.manual.items.map(i=>i.title),['Lancer la migration en production']);
  // The rank orders what is shown; it is not the identity: the same tickets written in another order are the same plan.
  const shuffled=plan();shuffled.tickets.reverse();
  assert.ok(samePlan(planOf(shuffled),got));assert.deepEqual(planOf(shuffled).tickets.map(t=>t.id),['XJ-2','XJ-3','XJ-4']);
  assert.ok(!samePlan(planOf(plan({toPlan:{}})),got));
  // What a plan does not say stays empty, never invented.
  const bare=planOf({tickets:[ticket('XJ-2',1)]});
  assert.deepEqual([bare.phases,bare.requests,bare.toPlan,bare.tickets[0].phase,bare.tickets[0].covers],[[],[],undefined,null,[]]);
});

test('a rank « 2b » is refused, like every rank that is not a whole number of its own',()=>{
  for(const rank of ['2b','2',2.5,0,-1,null,undefined,10000,[2]])refused(plan({tickets:[ticket('XJ-2',1),ticket('XJ-3',rank)]}),'PLAN_RANK_INVALID',/XJ-3/);
  refused(plan({tickets:[ticket('XJ-2',1),ticket('XJ-3',1)]}),'PLAN_RANK_INVALID',/XJ-2.*XJ-3|XJ-3.*XJ-2/);
});

test('a ticket is named by its tracker identifier: « 2b », a number or a name twice are refused',()=>{
  for(const id of ['2b','2',2,'xj-2','XJ-2b','XJ-','',null,'../XJ-2','__proto__'])refused(plan({tickets:[ticket(id,1)]}),'PLAN_TICKET_INVALID');
  refused(plan({tickets:[ticket('XJ-2',1),ticket('XJ-2',2)]}),'PLAN_TICKET_DUPLICATE',/XJ-2/);
  refused(plan({tickets:[]}),'PLAN_INVALID');refused(plan({tickets:'XJ-2'}),'PLAN_INVALID');refused(null,'PLAN_INVALID');refused([],'PLAN_INVALID');
});

test('a dependency names a ticket of the plan by its identifier: an unknown one, a rank or « 2b » are refused',()=>{
  for(const dep of ['XJ-9','2b','1',1,'',null])refused(plan({tickets:[ticket('XJ-2',1),ticket('XJ-3',2,{deps:[dep]})]}),'PLAN_DEPENDENCY_UNKNOWN',/XJ-3/);
  refused(plan({tickets:[ticket('XJ-2',1,{deps:'XJ-3'}),ticket('XJ-3',2)]}),'PLAN_INVALID');
  assert.deepEqual(planOf(plan({tickets:[ticket('XJ-2',1),ticket('XJ-3',2,{deps:['XJ-2','XJ-2']})]})).tickets[1].deps,['XJ-2'],'a dependency said twice is one');
});

test('a loop of dependencies is refused, whatever its length, and the tickets of the loop are named',()=>{
  refused(plan({tickets:[ticket('XJ-2',1,{deps:['XJ-2']})]}),'PLAN_CYCLE',/XJ-2/);
  refused(plan({tickets:[ticket('XJ-2',1,{deps:['XJ-3']}),ticket('XJ-3',2,{deps:['XJ-2']})]}),'PLAN_CYCLE',/XJ-2.*XJ-3|XJ-3.*XJ-2/);
  refused(plan({tickets:[ticket('XJ-2',1,{deps:['XJ-4']}),ticket('XJ-3',2,{deps:['XJ-2']}),ticket('XJ-4',3,{deps:['XJ-3']}),ticket('XJ-5',4)]}),'PLAN_CYCLE',/XJ-2/);
  // A diamond is not a loop.
  assert.equal(planOf(plan({tickets:[ticket('XJ-2',1),ticket('XJ-3',2,{deps:['XJ-2']}),ticket('XJ-4',3,{deps:['XJ-2']}),ticket('XJ-5',4,{deps:['XJ-3','XJ-4']})]})).tickets.length,4);
  // A long chain is walked without recursion.
  const long=Array.from({length:200},(_x,n)=>ticket('XJ-'+(n+2),n+1,n?{deps:['XJ-'+(n+1)]}:{}));
  assert.equal(planOf({tickets:long}).tickets.length,200);
});

test('the delivery of a ticket is said: in this delivery, deferred, associated, integrated by another, or design',()=>{
  const got=planOf(plan({tickets:[ticket('XJ-2',1),{id:'XJ-3',rank:2,title:'Maquette',result:'La direction visuelle',difficulty:'light',kind:'design'},{id:'XJ-4',rank:3,title:'Plus tard',result:'r',difficulty:'standard',delivery:'deferred'},{id:'XJ-5',rank:4,title:'Repris',result:'r',difficulty:'standard',delivery:'integrated',integratedBy:'XJ-2'},{id:'XJ-6',rank:5,title:'Voisin',result:'r',difficulty:'standard',delivery:'associated'}]}));
  assert.deepEqual(got.tickets.map(t=>[t.kind,t.delivery,t.integratedBy,t.agent,t.model,t.effort]),[['work','included',null,'claude','claude-sonnet-5-5','high'],['design','included',null,null,null,null],['work','deferred',null,null,null,null],['work','integrated','XJ-2',null,null,null],['work','associated',null,null,null,null]]);
  // A ticket to develop in this delivery says who develops it and with what.
  for(const key of ['agent','model','effort']){const t=ticket('XJ-2',1);delete t[key];refused(plan({tickets:[t]}),'PLAN_TICKET_INVALID',/XJ-2/);}
  refused(plan({tickets:[ticket('XJ-2',1,{agent:'gemini'})]}),'PLAN_TICKET_INVALID');refused(plan({tickets:[ticket('XJ-2',1,{effort:'max'})]}),'PLAN_TICKET_INVALID');
  refused(plan({tickets:[ticket('XJ-2',1,{difficulty:'fort'})]}),'PLAN_TICKET_INVALID');refused(plan({tickets:[ticket('XJ-2',1,{delivery:'later'})]}),'PLAN_TICKET_INVALID');refused(plan({tickets:[ticket('XJ-2',1,{kind:'spike'})]}),'PLAN_TICKET_INVALID');
  // Integrated by another: the other is named, is a ticket of the plan, and is not itself.
  refused(plan({tickets:[ticket('XJ-2',1,{delivery:'integrated'})]}),'PLAN_TICKET_INVALID',/XJ-2/);
  refused(plan({tickets:[ticket('XJ-2',1,{delivery:'integrated',integratedBy:'XJ-9'})]}),'PLAN_DEPENDENCY_UNKNOWN');
  refused(plan({tickets:[ticket('XJ-2',1,{delivery:'integrated',integratedBy:'XJ-2'})]}),'PLAN_CYCLE');
  refused(plan({tickets:[ticket('XJ-2',1,{delivery:'integrated',integratedBy:'XJ-3'}),ticket('XJ-3',2,{delivery:'integrated',integratedBy:'XJ-2'})]}),'PLAN_CYCLE');
  refused(plan({tickets:[ticket('XJ-2',1,{integratedBy:'XJ-3'}),ticket('XJ-3',2)]}),'PLAN_TICKET_INVALID');
});

test('a loop made of the two relations is refused with its tickets: a ticket that waits for one it integrates would never start',()=>{
  // XJ-2 waits for XJ-3, and XJ-3 is over only when XJ-2, which integrates it, is.
  refused(plan({tickets:[ticket('XJ-2',1,{deps:['XJ-3']}),ticket('XJ-3',2,{delivery:'integrated',integratedBy:'XJ-2'})]}),'PLAN_CYCLE',/XJ-2 → XJ-3 → XJ-2|XJ-3 → XJ-2 → XJ-3/);
  // Through a third one: XJ-2 waits for XJ-3, integrated by XJ-4, which waits for XJ-2.
  refused(plan({tickets:[ticket('XJ-2',1,{deps:['XJ-3']}),ticket('XJ-3',2,{delivery:'integrated',integratedBy:'XJ-4'}),ticket('XJ-4',3,{deps:['XJ-2']}),ticket('XJ-5',4)]}),'PLAN_CYCLE',/XJ-2.*XJ-3.*XJ-4|XJ-3.*XJ-4.*XJ-2|XJ-4.*XJ-2.*XJ-3/);
  // No loop: waiting for a ticket that another one integrates is a plan like any other.
  assert.equal(planOf(plan({tickets:[ticket('XJ-2',1),ticket('XJ-3',2,{deps:['XJ-4']}),ticket('XJ-4',3,{delivery:'integrated',integratedBy:'XJ-2'})]})).tickets.length,3);
});

test('what a ticket points at exists: its phase, the requests it covers; nothing unknown is kept',()=>{
  refused(plan({tickets:[ticket('XJ-2',1,{phase:'later'})]}),'PLAN_INVALID',/XJ-2/);
  refused(plan({tickets:[ticket('XJ-2',1,{covers:['R9']})]}),'PLAN_INVALID',/XJ-2/);
  refused(plan({phases:[{id:'base',title:'a'},{id:'base',title:'b'}]}),'PLAN_INVALID');refused(plan({requests:[{id:'R1',short:'a',full:'a'},{id:'R1',short:'b',full:'b'}]}),'PLAN_INVALID');
  refused(plan({phases:[{id:'__proto__',title:'a'}]}),'PLAN_INVALID');
  for(const more of [{surprise:1},{risks:'none'},{toPlan:{risks:[1]}},{toPlan:{manual:{items:[{title:''}]}}},{phases:[{id:'base'}]},{requests:[{id:'R1',short:'x',full:'x',extra:1}]}])refused(plan(more),'PLAN_INVALID');
  refused(plan({tickets:[ticket('XJ-2',1,{surprise:1})]}),'PLAN_TICKET_INVALID');refused(plan({tickets:[ticket('XJ-2',1,{title:''})]}),'PLAN_TICKET_INVALID');refused(plan({tickets:[ticket('XJ-2',1,{result:'x'.repeat(5000)})]}),'PLAN_TICKET_INVALID');
  refused(plan({tickets:[ticket('XJ-2',1,{texts:['a'],mockups:[3]})]}),'PLAN_TICKET_INVALID');
  refused({tickets:Array.from({length:201},(_x,n)=>ticket('XJ-'+(n+2),n+1))},'PLAN_INVALID');
});

// ---- The plan recorded in its mission, by the command of the Lead.
const kid=(identifier,id,more={})=>({id,identifier,title:'Lot — '+identifier,state:{name:'Backlog',type:'backlog'},labels:[],...more});
async function recorded(t,{children=[kid('XJ-2','u2'),kid('XJ-3','u3'),kid('XJ-4','u4')],issue={id:'i1',identifier:'XJ-1'},config=null}={}) {
  const root=await mkdtemp(join(tmpdir(),'fabrique-console-plan2-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const f={root,children,down:false,reads:0,writes:[],config};
  // A tracker that only reads: any write would throw.
  const getTickets=async()=>({detail:async(id,opts)=>{f.reads++;if(f.down)throw new Error('down');assert.equal(id,'i1');assert.equal(opts.refresh,true,'read again, never from the cache');return {issue:{id:'i1',identifier:'XJ-1',children:f.children,...(f.partial?{childrenComplete:false}:{})}};},
    create:async()=>{f.writes.push('create');throw new Error('no write');},mutate:async()=>{f.writes.push('mutate');throw new Error('no write');}});
  let at=Date.parse('2026-11-13T09:00:00.000Z');
  f.registry=createMissionRegistry({root,now:()=>at});f.tick=()=>{at+=60000;};
  f.actions=createMissionActions({registry:f.registry,loadState:async()=>({sessions:[]}),loadConfig:async()=>{if(!f.config)throw new Error('no configuration');return f.config;},getTickets});
  await f.registry.create({project:'alpha',issue,request:'Payer'});
  f.file=async()=>readFile(join(root,'state','missions','M-1.json'),'utf8');
  return f;
}

test('the Lead records its plan in its mission: each ticket takes the identity of its sub-ticket of the tracker',async t=>{
  const f=await recorded(t),got=await f.actions.savePlan({mission:'M-1',plan:plan()});
  assert.deepEqual({saved:got.saved,revision:got.revision,tickets:got.tickets,verified:got.tracker.verified},{saved:true,revision:1,tickets:3,verified:true});
  const mission=await f.registry.read('M-1');
  assert.equal(mission.plan.format,PLAN_FORMAT);assert.equal(mission.plan.revision,1);assert.equal(mission.plan.savedAt,'2026-11-13T09:00:00.000Z');
  assert.deepEqual(mission.plan.tickets.map(x=>[x.id,x.uid,x.rank]),[['XJ-2','u2',1],['XJ-3','u3',2],['XJ-4','u4',3]]);
  assert.deepEqual(mission.plan.tickets[2].deps,['XJ-2','XJ-3']);assert.deepEqual(mission.plan.toPlan,planOf(plan()).toPlan);
  assert.deepEqual(f.writes,[],'nothing is written to the tracker');
  // The mission is read back with its plan: a Lead that comes back finds its tickets, and makes none again.
  assert.deepEqual((await f.registry.read('M-1')).plan.tickets.map(x=>x.id),['XJ-2','XJ-3','XJ-4']);
});

test('the same plan recorded twice changes nothing: no ticket twice, no new revision, the file as it was',async t=>{
  const f=await recorded(t);
  await f.actions.savePlan({mission:'M-1',plan:plan()});const before=await f.file();
  f.tick();
  const shuffled=plan();shuffled.tickets.reverse();
  for(const again of [plan(),shuffled]){
    const got=await f.actions.savePlan({mission:'M-1',plan:again});
    assert.deepEqual({saved:got.saved,unchanged:got.unchanged,revision:got.revision,tickets:got.tickets},{saved:false,unchanged:true,revision:1,tickets:3});
  }
  assert.equal(await f.file(),before,'not a byte of the mission moved');assert.deepEqual(f.writes,[]);
  // A plan that changed is a new revision of the same tickets: XJ-2 is still one ticket, with its identity.
  const changed=plan();changed.tickets[0].title='Autre titre';
  const next=await f.actions.savePlan({mission:'M-1',plan:changed}),mission=await f.registry.read('M-1');
  assert.deepEqual({saved:next.saved,revision:next.revision},{saved:true,revision:2});
  assert.deepEqual(mission.plan.tickets.map(x=>x.id),['XJ-2','XJ-3','XJ-4']);assert.equal(mission.plan.tickets[0].uid,'u2');assert.equal(mission.plan.savedAt,'2026-11-13T09:01:00.000Z');
});

test('a sub-ticket made twice in the tracker is refused: the plan keeps one ticket for one piece of work',async t=>{
  // XJ-7 was made again for the work of XJ-2 (a Lead that came back and split again): the plan cannot be recorded
  // while both are open, whichever of the two it names.
  const f=await recorded(t,{children:[kid('XJ-2','u2',{title:'Ticket XJ-2'}),kid('XJ-3','u3'),kid('XJ-4','u4'),kid('XJ-7','u7',{title:'  ticket xj-2 '})]});
  await assert.rejects(()=>f.actions.savePlan({mission:'M-1',plan:plan()}),e=>e.code==='PLAN_TICKET_DUPLICATE'&&/XJ-2/.test(e.message)&&/XJ-7/.test(e.message));
  assert.equal((await f.registry.read('M-1')).plan,undefined,'nothing recorded');
  // The second one canceled in the tracker, the plan is recorded.
  f.children[3].state={name:'Canceled',type:'canceled'};
  assert.equal((await f.actions.savePlan({mission:'M-1',plan:plan()})).saved,true);
  // Two tickets of one plan with the same title are the same work written twice.
  const twice=plan();twice.tickets[1].title=' ticket XJ-2';
  await assert.rejects(()=>f.actions.savePlan({mission:'M-1',plan:twice}),e=>e.code==='PLAN_TICKET_DUPLICATE');
});

test('a ticket that is not a sub-ticket of the issue is refused; a tracker out of reach is said, never guessed',async t=>{
  const f=await recorded(t,{children:[kid('XJ-2','u2'),kid('XJ-3','u3')]});
  await assert.rejects(()=>f.actions.savePlan({mission:'M-1',plan:plan()}),e=>e.code==='PLAN_TICKET_UNKNOWN'&&/XJ-4/.test(e.message));
  assert.equal((await f.registry.read('M-1')).plan,undefined);
  // The tracker does not answer: the plan is kept, its tickets not vouched for, and said so.
  f.down=true;
  const blind=await f.actions.savePlan({mission:'M-1',plan:plan()});
  assert.deepEqual({saved:blind.saved,verified:blind.tracker.verified},{saved:true,verified:false});
  assert.deepEqual((await f.registry.read('M-1')).plan.tickets.map(x=>x.uid),[null,null,null]);
  // Back in reach, the same plan is checked again: it is refused while XJ-4 is not a sub-ticket, and what was kept stays.
  f.down=false;
  await assert.rejects(()=>f.actions.savePlan({mission:'M-1',plan:plan()}),e=>e.code==='PLAN_TICKET_UNKNOWN');
  assert.equal((await f.registry.read('M-1')).plan.tracker.verified,false);
  f.children.push(kid('XJ-4','u4'));
  const seen=await f.actions.savePlan({mission:'M-1',plan:plan()});
  assert.deepEqual({saved:seen.saved,revision:seen.revision,verified:seen.tracker.verified},{saved:true,revision:1,verified:true},'the same plan, now vouched for: no new revision');
  assert.deepEqual((await f.registry.read('M-1')).plan.tickets.map(x=>x.uid),['u2','u3','u4']);
  // A list of sub-tickets read in part vouches for nothing: a ticket it does not show is not refused.
  f.partial=true;f.children.pop();
  const part=await f.actions.savePlan({mission:'M-1',plan:plan({toPlan:{}})});
  assert.deepEqual({saved:part.saved,revision:part.revision,verified:part.tracker.verified},{saved:true,revision:2,verified:false});
  assert.deepEqual((await f.registry.read('M-1')).plan.tickets.map(x=>x.uid),['u2','u3','u4'],'an identity once known is kept');
});

test('two sub-tickets under one identifier name no ticket: no identity is picked, and one already known is kept',async t=>{
  // The tracker shows XJ-2 twice, with two identities: which one is the ticket of the plan is unknown.
  const twice=[kid('XJ-2','uid-A'),kid('XJ-3','u3'),kid('XJ-4','u4'),kid('XJ-2','uid-B')];
  const read=againstTracker(planOf(plan()),twice,true);
  assert.deepEqual([...read.uids],[['XJ-3','u3'],['XJ-4','u4']],'neither the first nor the last one read');
  assert.equal(read.whole,false,'such a list does not say which tickets it holds');
  // The same sub-ticket listed twice is one sub-ticket.
  const echoed=againstTracker(planOf(plan()),[kid('XJ-2','u2'),kid('XJ-2','u2'),kid('XJ-3','u3'),kid('XJ-4','u4')],true);
  assert.deepEqual([[...echoed.uids].length,echoed.uids.get('XJ-2'),echoed.whole],[3,'u2',true]);
  // Recorded blind: the ticket is kept without an identity, and nothing is vouched for.
  const f=await recorded(t,{children:twice}),blind=await f.actions.savePlan({mission:'M-1',plan:plan()});
  assert.deepEqual({saved:blind.saved,verified:blind.tracker.verified},{saved:true,verified:false});
  assert.deepEqual((await f.registry.read('M-1')).plan.tickets.map(x=>x.uid),[null,'u3','u4']);
  // An identity read before the tracker showed two is kept, never replaced by one of the two.
  const g=await recorded(t);
  await g.actions.savePlan({mission:'M-1',plan:plan()});
  g.children.push(kid('XJ-2','uid-B'));
  for(const again of [plan(),plan({toPlan:{}})]){
    const got=await g.actions.savePlan({mission:'M-1',plan:again});
    assert.equal(got.tracker.verified,false);
    assert.deepEqual((await g.registry.read('M-1')).plan.tickets.map(x=>x.uid),['u2','u3','u4']);
  }
  // The rows keep the identity of the plan too, and the state of that ticket in the tracker stays unknown.
  const saved={...planOf(plan()),tickets:planOf(plan()).tickets.map(x=>({...x,uid:'u'+x.id.slice(3)}))};
  const rows=planRows(saved,[kid('XJ-2','uid-A',{state:{name:'Done',type:'completed'}}),kid('XJ-3','u3'),kid('XJ-2','uid-B')],null);
  assert.deepEqual(rows.map(r=>[r.id,r.uid,r.state?.type??null]),[['XJ-2','u2',null],['XJ-3','u3','backlog'],['XJ-4','u4',null]]);
});

test('a plan once vouched for, sent again while the tracker is out of reach: the identities are kept, the last check says no',async t=>{
  const f=await recorded(t),first=await f.actions.savePlan({mission:'M-1',plan:plan()});
  assert.deepEqual(first.tracker,{verified:true,verifiedAt:'2026-11-13T09:00:00.000Z'});
  f.down=true;f.tick();
  const blind=await f.actions.savePlan({mission:'M-1',plan:plan()});
  assert.deepEqual({revision:blind.revision,tracker:blind.tracker},{revision:1,tracker:{verified:false,verifiedAt:'2026-11-13T09:00:00.000Z'}},'what was vouched for is a memory, with its date; this reading vouched for nothing');
  const kept=(await f.registry.read('M-1')).plan;
  assert.deepEqual(kept.tickets.map(x=>x.uid),['u2','u3','u4']);assert.equal(kept.savedAt,'2026-11-13T09:00:00.000Z');assert.deepEqual(kept.tracker,blind.tracker);
  // Sent again in the same state, nothing moves.
  const before=await f.file();f.tick();
  const again=await f.actions.savePlan({mission:'M-1',plan:plan()});
  assert.deepEqual({saved:again.saved,unchanged:again.unchanged,tracker:again.tracker},{saved:false,unchanged:true,tracker:blind.tracker});assert.equal(await f.file(),before);
  // A plan that changed while the tracker is out of reach was never vouched for: its tickets keep their identity.
  const changed=await f.actions.savePlan({mission:'M-1',plan:plan({toPlan:{}})});
  assert.deepEqual({revision:changed.revision,tracker:changed.tracker},{revision:2,tracker:{verified:false,verifiedAt:null}});
  assert.deepEqual((await f.registry.read('M-1')).plan.tickets.map(x=>x.uid),['u2','u3','u4']);
  // Back in reach, it is vouched for, at the time of that reading.
  f.down=false;f.tick();
  const seen=await f.actions.savePlan({mission:'M-1',plan:plan({toPlan:{}})});
  assert.deepEqual({revision:seen.revision,tracker:seen.tracker},{revision:2,tracker:{verified:true,verifiedAt:'2026-11-13T09:03:00.000Z'}});
});

test('a plan badly formed is refused whole, and the mission is left as it was',async t=>{
  const f=await recorded(t);
  await f.actions.savePlan({mission:'M-1',plan:plan()});const before=await f.file(),reads=f.reads;
  const bad=[plan({tickets:[ticket('XJ-2',1),ticket('XJ-3','2b')]}),plan({tickets:[ticket('XJ-2',1,{deps:['XJ-9']})]}),plan({tickets:[ticket('XJ-2',1,{deps:['XJ-3']}),ticket('XJ-3',2,{deps:['XJ-2']})]})];
  for(const raw of bad)await assert.rejects(()=>f.actions.savePlan({mission:'M-1',plan:raw}),e=>/^PLAN_/.test(e.code));
  assert.equal(await f.file(),before);assert.equal(f.reads,reads,'refused before the tracker is asked anything');
  for(const input of [{},{mission:'M-1'},{mission:'M-1',plan:plan(),extra:1},{mission:'M-9',plan:plan()},{mission:'../x',plan:plan()}])await assert.rejects(()=>f.actions.savePlan(input),e=>['INVALID_ARGUMENT','NOT_FOUND','PLAN_INVALID'].includes(e.code),JSON.stringify(Object.keys(input)));
  // A mission that is over keeps the plan it ended with.
  await f.registry.setStep('M-1','closed');
  await assert.rejects(()=>f.actions.savePlan({mission:'M-1',plan:plan({toPlan:{}})}),e=>e.code==='MISSION_OVER');
});

test('two plans recorded at once leave one whole plan, never a mix',async t=>{
  const f=await recorded(t),other=plan({toPlan:{risks:{summary:'autre',items:[{title:'Autre risque'}]}}});
  const got=await Promise.all([f.actions.savePlan({mission:'M-1',plan:plan()}),f.actions.savePlan({mission:'M-1',plan:other}),f.actions.savePlan({mission:'M-1',plan:plan()})]);
  const mission=await f.registry.read('M-1');
  assert.equal(mission.plan.revision,got.filter(x=>x.saved).length);assert.ok(mission.plan.revision>=1);
  assert.deepEqual(mission.plan.tickets.map(x=>x.id),['XJ-2','XJ-3','XJ-4']);
  assert.ok([plan(),other].some(p=>JSON.stringify(planOf(p).toPlan)===JSON.stringify(mission.plan.toPlan)));
});

// ---- The rows the chain and the screens work on, drawn from the plan.
test('the rows of a development come from its plan: rank, level, agent, model and waits by identifier; the tracker gives the state',()=>{
  const saved={...planOf(plan()),tickets:planOf(plan()).tickets.map(x=>({...x,uid:'u'+x.id.slice(3)}))};
  // The tracker says other things of the same tickets (labels, model, links): the plan is what counts.
  const children=[kid('XJ-3','u3',{state:{name:'Done',type:'completed'},labels:[{name:'agent:claude'},{name:'niveau:léger'}],model:'other',effort:'low',blockedBy:['u2']}),kid('XJ-2','u2'),kid('XJ-9','u9',{title:'Lot — Correction',labels:[{name:'agent:codex'}],blockedBy:['u2']})];
  const rows=planRows(saved,children,[{identifier:'XJ-2',stage:'dev',agent:'claude',model:'claude-opus-5-5',effort:'medium'}]);
  assert.deepEqual(rows.map(r=>[r.n,r.id,r.uid,r.content,r.level,r.agent,r.model,r.effort,r.waits,r.state?.type??null]),[
    [1,'XJ-2','u2','Ticket XJ-2','standard','claude','claude-opus-5-5',2,[],'backlog'],
    [2,'XJ-3','u3','Ticket XJ-3','fort','codex','gpt-6.1-sol',3,[],'completed'],
    [3,'XJ-4','u4','Ticket XJ-4','léger','claude','claude-sonnet-5-5',3,['XJ-2','XJ-3'],null],
    [null,'XJ-9','u9','Correction','','codex','',0,[],'backlog']]);
  assert.deepEqual(rows.map(r=>[r.planned,r.here]),[[true,true],[true,true],[true,true],[false,true]],'a sub-ticket the plan does not name stays a row, and what blocks it in the tracker is not read');
  assert.equal(rows[0].run.stage,'dev','a ticket launched shows what it was launched with');assert.equal(rows[2].run,null);
  // A ticket that is not to be developed has no agent: nothing can launch it.
  const design=planOf({tickets:[ticket('XJ-2',1),{id:'XJ-3',rank:2,title:'Maquette',result:'r',difficulty:'light',kind:'design'}]});
  assert.deepEqual(planRows(design,[],null).map(r=>[r.id,r.agent,r.model,r.effort]),[['XJ-2','claude','claude-sonnet-5-5',3],['XJ-3','','',0]]);
  assert.deepEqual(planRows(saved,null,null).map(r=>r.id),['XJ-2','XJ-3','XJ-4'],'no tracker, the plan alone');
});

async function chained(t,description='') {
  const f=await recorded(t);
  f.session={id:'s1',role:'lead',issueId:'i1',identifier:'XJ-1',terminalId:'t1',worktree:null};
  await f.registry.update('M-1',m=>{m.lead={sessionId:'s1',lastSeen:null};m.step='analysing';});
  f.issue={id:'i1',description,children:f.children};f.tabs=[];f.trackerDown=false;
  const agents=[{address:'t1',space:'sp',tab:'lead',tab_name:'Lead · XJ-1',status:'idle'}];
  // The one fake Herdr: a dev is a terminal of its core, every tab a tab of its window, each noted by the name it is given.
  const core=fakeHerdr({agents,spaces:[{id:'sp',name:'sp'}],onRun:term=>f.tabs.push(term.labels['fabrique-console.ticket']+' · dev'),onDo:(command,args)=>{if(command==='tab.new')f.tabs.push(args.name);}});
  f.chain=createDevChain({root:f.root,invoke:core.invoke,herdr:core.herdr,loadState:async()=>({sessions:[f.session]}),detail:async()=>{if(f.trackerDown)throw new Error('down');return {issue:f.issue};},reports:async()=>({reports:[],command:"'node' '/r.mjs'"}),send:async()=>({sent:true}),
    ensureWorktree:async()=>{f.session.worktree='/wt';return {path:'/wt',branch:'xj-1',base:'main',created:[],rebased:[],command:"'node' '/r.mjs'"};},setStep:async()=>{},missions:f.registry,notify:async()=>{}});
  return f;
}

test('the development screen shows a mission of the new format as before: its tickets, their order, what waits and what can start',async t=>{
  const f=await chained(t);
  await f.actions.savePlan({mission:'M-1',plan:plan()});
  assert.deepEqual(await f.chain.tick({sessionId:'s1'}),{ran:false},'nothing is launched by a plan');
  const mission=await f.registry.read('M-1');
  assert.deepEqual(mission.tickets.map(x=>({id:x.id,uid:x.uid,n:x.n,title:x.title,level:x.level,dev:x.dev,model:x.model,effort:x.effort,deps:x.deps,state:x.state,tracker:x.tracker})),[
    {id:'XJ-2',uid:'u2',n:1,title:'Ticket XJ-2',level:'standard',dev:'claude',model:'claude-sonnet-5-5',effort:'high',deps:[],state:'todo',tracker:'backlog'},
    {id:'XJ-3',uid:'u3',n:2,title:'Ticket XJ-3',level:'fort',dev:'codex',model:'gpt-6.1-sol',effort:'high',deps:[],state:'todo',tracker:'backlog'},
    {id:'XJ-4',uid:'u4',n:3,title:'Ticket XJ-4',level:'léger',dev:'claude',model:'claude-sonnet-5-5',effort:'high',deps:['XJ-2','XJ-3'],state:'todo',tracker:'backlog'}]);
  // What the screen draws from it, with the functions it already has.
  const lead={address:'t1'};
  assert.deepEqual(launchBanner(mission,lead),{kind:'ready',state:'offer',total:3,first:2});
  assert.deepEqual(readyTickets(mission.tickets).map(x=>x.id),['XJ-2','XJ-3']);
  assert.deepEqual(missionProgress(mission),{done:0,total:3,ratio:0});
  assert.match(ticketDetail(mission.tickets[2]),/2, 3/);
  assert.equal(mission.plan.revision,1,'the plan itself is not touched by the chain');
});

test('the table of the description is no longer read: before a plan the sub-tickets show as the tracker has them, then the plan alone speaks',async t=>{
  const table='## Découpage\n| Ticket | Contenu | Niveau | Agent | Modèle | Effort | Attend |\n|---|---|---|---|---|---|---|\n| 1 · XJ-2 | Ancien | léger | codex | gpt-6.1-sol | low | — |\n| 2 · XJ-3 | Ancien 2 | léger | codex | gpt-6.1-sol | low | 1 |\n';
  const f=await chained(t,table);
  f.children[1].blockedBy=['u2'];
  await f.chain.tick({sessionId:'s1'});
  assert.deepEqual((await f.registry.read('M-1')).tickets.map(x=>[x.id,x.n,x.dev,x.level,x.deps]),[['XJ-2',null,null,null,[]],['XJ-3',null,null,null,[]],['XJ-4',null,null,null,[]]],'neither a number, an agent nor a wait comes from the table or from the links of the tracker');
  await f.actions.savePlan({mission:'M-1',plan:plan()});
  await f.chain.tick({sessionId:'s1'});
  assert.deepEqual((await f.registry.read('M-1')).tickets.map(x=>[x.id,x.n,x.dev,x.level,x.deps]),[['XJ-2',1,'claude','standard',[]],['XJ-3',2,'codex','fort',[]],['XJ-4',3,'claude','léger',['XJ-2','XJ-3']]]);
});

test('a plan recorded shows its tickets even when the tracker does not answer: only their state there is unknown',async t=>{
  const f=await chained(t);
  await f.actions.savePlan({mission:'M-1',plan:plan()});
  f.trackerDown=true;
  await f.chain.tick({sessionId:'s1'});
  assert.deepEqual((await f.registry.read('M-1')).tickets.map(x=>[x.id,x.uid,x.n,x.state,x.tracker]),[['XJ-2','u2',1,'todo',null],['XJ-3','u3',2,'todo',null],['XJ-4','u4',3,'todo',null]]);
});

test('the chain runs a mission from its plan: one ticket is launched, the next one waits its turn, the one that waits for them too',async t=>{
  const f=await chained(t);
  await f.actions.savePlan({mission:'M-1',plan:plan()});
  const tool=x=>({identifier:x.id,tool:x.agent,model:x.model,effort:x.effort}),tickets=(await f.registry.read('M-1')).plan.tickets;
  // Not approved by the user (ticket M5): nothing starts.
  await assert.rejects(()=>f.chain.launch({mission:'M-1',fresh:false,tickets:tickets.map(tool)}),e=>e.code==='NOT_APPROVED');assert.deepEqual(f.tabs,[]);
  await approvePlan(f.registry,'M-1');
  const got=await f.chain.launch({mission:'M-1',fresh:false,tickets:tickets.map(tool)});
  assert.deepEqual(got.launched.map(x=>[x.identifier,x.launched,x.reason]),[['XJ-2',true,undefined],['XJ-3',false,'serial'],['XJ-4',false,'waits']],'one dev at a time; XJ-4 waits for XJ-2 and XJ-3');
  assert.deepEqual(f.tabs,['XJ-2 · dev']);
  await f.chain.tick({sessionId:'s1'});
  assert.deepEqual((await f.registry.read('M-1')).tickets.map(x=>[x.id,x.n,x.state,x.deps]),[['XJ-2',1,'dev',[]],['XJ-3',2,'todo',[]],['XJ-4',3,'todo',['XJ-2','XJ-3']]]);
  assert.deepEqual(f.tabs,['XJ-2 · dev'],'nothing else started');
});

// ---- The model of a ticket follows its difficulty (the profiles of the configuration are the rule).
const PROFILES={version:'t',dev:{claude:{'léger':{model:'claude-haiku-5-5',effort:'medium'},standard:{model:'claude-sonnet-5-5',effort:'high'},fort:{model:'claude-opus-5-5',effort:'high'}},codex:{standard:{model:'gpt-6.1-sol',effort:'high'}}},review:{claude:{},codex:{}}};
const unsaid=(id,rank,more={})=>{const {model:_m,effort:_e,...rest}=ticket(id,rank,more);return rest;};
const ruled=raw=>planOf({tickets:[raw]},{profiles:PROFILES}).tickets[0];
const ruleRefused=(raw,code,words)=>assert.throws(()=>ruled(raw),e=>{assert.equal(e.code,code,e.message);if(words)assert.match(e.message,words);return true;});

test('the model of a ticket follows its difficulty: left unsaid, it is the one the rule gives',()=>{
  assert.deepEqual(['light','standard','heavy'].map(difficulty=>{const got=ruled(unsaid('XJ-2',1,{difficulty}));return [got.model,got.effort,got.modelReason];}),
    [['claude-haiku-5-5','medium',null],['claude-sonnet-5-5','high',null],['claude-opus-5-5','high',null]]);
  // Said as the rule gives it: the same ticket, and the same plan.
  assert.ok(samePlan(planOf({tickets:[unsaid('XJ-2',1)]},{profiles:PROFILES}),planOf({tickets:[ticket('XJ-2',1)]},{profiles:PROFILES})));
  // One of the two left unsaid is the rule's.
  assert.deepEqual([ruled({...unsaid('XJ-2',1),model:'claude-sonnet-5-5'}).effort,ruled({...unsaid('XJ-2',1),effort:'high'}).model],['high','claude-sonnet-5-5']);
});

test('a Lead takes another model than the rule only by saying why',()=>{
  ruleRefused(ticket('XJ-2',1,{model:'claude-opus-5-5'}),'PLAN_MODEL_RULE',/XJ-2.*claude-sonnet-5-5.*high.*modelReason/);
  ruleRefused(ticket('XJ-2',1,{effort:'low'}),'PLAN_MODEL_RULE',/XJ-2/);
  ruleRefused(ticket('XJ-2',1,{model:'claude-opus-5-5',modelReason:'  '}),'PLAN_MODEL_RULE');
  const got=ruled(ticket('XJ-2',1,{model:'claude-opus-5-5',modelReason:' Le calcul des droits est subtil. '}));
  assert.deepEqual([got.model,got.effort,got.modelReason],['claude-opus-5-5','high','Le calcul des droits est subtil.']);
  // The reason is part of what the Lead said: a plan with another reason is another plan.
  assert.ok(!samePlan(planOf({tickets:[ticket('XJ-2',1,{model:'claude-opus-5-5',modelReason:'a'})]},{profiles:PROFILES}),planOf({tickets:[ticket('XJ-2',1,{model:'claude-opus-5-5',modelReason:'b'})]},{profiles:PROFILES})));
  // A reason is the reason of a departure: with the model of the rule, it is refused rather than kept for nothing.
  ruleRefused(ticket('XJ-2',1,{modelReason:'pour voir'}),'PLAN_TICKET_INVALID',/modelReason/);
});

test('where no rule is configured, the Lead says the model, and nothing is called a rule',()=>{
  // codex has a rule for a standard ticket only.
  ruleRefused(unsaid('XJ-2',1,{agent:'codex',difficulty:'heavy'}),'PLAN_TICKET_INVALID',/XJ-2.*model/);
  const got=ruled(ticket('XJ-2',1,{agent:'codex',difficulty:'heavy',model:'gpt-6-astra'}));
  assert.deepEqual([got.model,got.effort,got.modelReason],['gpt-6-astra','high',null]);
  // No profiles at all: as a plan was read before.
  assert.equal(planOf({tickets:[ticket('XJ-2',1,{model:'claude-opus-5-5'})]}).tickets[0].model,'claude-opus-5-5');
  refused({tickets:[unsaid('XJ-2',1)]},'PLAN_TICKET_INVALID',/XJ-2/);
  // A ticket that is not developed in this delivery follows no rule.
  assert.deepEqual(ruled({id:'XJ-2',rank:1,title:'Maquette',result:'r',difficulty:'heavy',kind:'design'}).model,null);
});

test('the plan recorded in the mission carries the model of the rule; a departure without its reason is refused whole',async t=>{
  const f=await recorded(t,{config:{profiles:PROFILES}});
  const raw=plan({tickets:[unsaid('XJ-2',1),ticket('XJ-3',2,{agent:'codex',model:'gpt-6.1-sol'}),unsaid('XJ-4',3,{difficulty:'heavy',deps:['XJ-2']})]});
  assert.equal((await f.actions.savePlan({mission:'M-1',plan:raw})).saved,true);
  assert.deepEqual((await f.registry.read('M-1')).plan.tickets.map(x=>[x.id,x.model,x.effort]),[['XJ-2','claude-sonnet-5-5','high'],['XJ-3','gpt-6.1-sol','high'],['XJ-4','claude-opus-5-5','high']]);
  assert.equal((await f.actions.savePlan({mission:'M-1',plan:raw})).unchanged,true,'the same plan sent again is the same plan');
  const before=await f.file();
  await assert.rejects(()=>f.actions.savePlan({mission:'M-1',plan:plan({tickets:[ticket('XJ-2',1,{model:'claude-haiku-5-5'})]})}),e=>e.code==='PLAN_MODEL_RULE');
  assert.equal(await f.file(),before);
  // A configuration that cannot be read gives no rule: the Lead says the model, as before.
  f.config=null;
  await assert.rejects(()=>f.actions.savePlan({mission:'M-1',plan:plan({tickets:[unsaid('XJ-2',1)]})}),e=>e.code==='PLAN_TICKET_INVALID');
});

test('the Lead is given the command that records its plan, with an example it can run',()=>{
  const prompt=leadPrompt({role:'ROLE',issue:{id:'i1',identifier:'XJ-1',title:'Paiement'},project:{key:'alpha',name:'Alpha'},folder:'/wt',resumed:false,mission:{id:'M-1',request:'Payer'},cli:'/cli.mjs',node:'/node'});
  const line=prompt.split('\n').find(l=>l.includes(' lead-plan '));
  assert.ok(line,'the command is listed');
  const example=JSON.parse(/lead-plan '(\{.*?\})' —/.exec(line)[1]);
  assert.equal(example.mission,'M-1');assert.equal(planOf(example.plan).tickets.length,example.plan.tickets.length,'the example is a plan the tool accepts');
  for(const word of ['rank','deps','sous-issue','2b','modelReason'])assert.ok(line.includes(word),word);
  // What Prepare shows beside the tickets (ticket M3): the example carries every field, and the tool keeps it.
  for(const word of ['approach','paragraphs','migrations','short','full','postponed','toPlan','manual','risks','copy','accounts','simple','points'])assert.ok(line.includes(word),word);
  const kept=planOf(example.plan);
  assert.ok(kept.approach&&kept.migrations&&kept.toPlan.manual&&kept.toPlan.risks&&kept.toPlan.copy&&kept.toPlan.accounts&&kept.requests.every(r=>r.short&&r.full),'the example fills every zone of Prepare');
  assert.match(prompt.split('\n').find(l=>l.includes(' lead-request ')),/Un seul dev travaille à la fois.*plan-differs/,'the Lead knows the series and why a ticket is not launched');
});

// ---- Which dev develops a ticket (review of the screen with two devs): the plan says it, the tool does not.
test('a plan may say which dev develops each ticket: Dev 1 or Dev 2, two devs at most, one tool for each; a plan that does not say it is unchanged',()=>{
  // Without the field, the plan is the one of before, to the letter: one dev, even with two tools.
  assert.ok(planOf(plan()).tickets.every(t=>!('dev' in t)));
  // Two devs that use the same tool.
  const same=planOf(plan({tickets:[ticket('XJ-2',1),ticket('XJ-3',2,{dev:2}),ticket('XJ-4',3,{dev:1,deps:['XJ-2','XJ-3']})]}));
  assert.deepEqual(same.tickets.map(t=>[t.id,t.agent,t.dev]),[['XJ-2','claude',undefined],['XJ-3','claude',2],['XJ-4','claude',1]]);
  assert.ok(samePlan(same,planOf(plan({tickets:[ticket('XJ-2',1),ticket('XJ-3',2,{dev:2}),ticket('XJ-4',3,{dev:1,deps:['XJ-2','XJ-3']})]}))));
  // Two devs, each with its tool; the model of a dev may change from a ticket to another.
  const two=planOf(plan({tickets:[ticket('XJ-2',1),ticket('XJ-3',2,{dev:2,agent:'codex',model:'gpt-6.1-sol'}),ticket('XJ-4',3,{model:'claude-opus-5-5'})]}));
  assert.deepEqual(two.tickets.map(t=>[t.dev,t.agent,t.model]),[[undefined,'claude','claude-sonnet-5-5'],[2,'codex','gpt-6.1-sol'],[undefined,'claude','claude-opus-5-5']]);
  // Dev 1 or Dev 2, and nothing else.
  for(const dev of [0,3,'2','Dev 2',1.5])refused(plan({tickets:[ticket('XJ-2',1),ticket('XJ-3',2,{dev})]}),'PLAN_TICKET_INVALID',/dev is 1 or 2/);
  // A dev has one tool (decision 53): two tools under one dev are refused once the plan says its devs.
  refused(plan({tickets:[ticket('XJ-2',1),ticket('XJ-3',2,{dev:2}),ticket('XJ-4',3,{dev:2,agent:'codex',model:'gpt-6.1-sol'})]}),'PLAN_INVALID',/Dev 2 has two tools/);
  refused(plan({tickets:[ticket('XJ-2',1),ticket('XJ-3',2,{agent:'codex',model:'gpt-6.1-sol'}),ticket('XJ-4',3,{dev:2})]}),'PLAN_INVALID',/Dev 1 has two tools/);
  // Dev 2 comes with a Dev 1.
  refused(plan({tickets:[ticket('XJ-2',1,{dev:2}),ticket('XJ-3',2,{dev:2})]}),'PLAN_INVALID',/no ticket for Dev 1/);
});
