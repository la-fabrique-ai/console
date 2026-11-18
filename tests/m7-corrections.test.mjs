import test from 'node:test';
import assert from 'node:assert/strict';
import { planTicket, TWO, setup, leadMission, devRun, devRuns, news, FG2 } from './helpers/dev-chain-setup.mjs';
import { createMissionActions, driftOf } from '../src/mission.mjs';
import * as devChain from '../src/dev-chain.mjs';
import { createQuestionRegistry } from '../src/questions.mjs';
import { createRequestRegistry } from '../src/requests.mjs';

// The corrections of M7 after its two reviews (decisions 81 and 82): a removal approved never makes a ticket launchable;
// a ticket approved again goes only with what was approved; an open question holds the reapproval as it holds the first
// approval; the drift shows every change of the plan and the version drawn bounds the whole copy; the drift of the
// corrections is exact; the sub-tickets there before the approval never go, for good; the branch of the worktree is
// compared with the one of the copy (decision 73).
const T0=Date.parse('2026-11-14T10:00:00Z');
const screenOf=(t,{now=()=>T0,send,getTickets}={})=>{
  const questions=createQuestionRegistry({root:t.root}),registry=t.registry,inbox=createRequestRegistry({root:t.root,questions,missions:registry});
  const screen=createMissionActions({root:t.root,now,registry,questions,chain:t.chain,inbox,loadState:async()=>({sessions:[t.session]}),window:t.core.herdr.window,loadConfig:async()=>({}),send:send||(async()=>({sent:true})),...(getTickets?{getTickets}:{})});
  return {screen,inbox};
};
const ready=async(...args)=>{const t=await setup(...args);t.registry=(await leadMission(t.root)).missions;return t;};
const accept=(t,ticket,c,hour)=>t.reports.push({ticket,kind:'dev',commit:c.repeat(40),repo:'admin',summary:'fait',at:'2026-11-09T'+hour+':00:00.000Z'},{ticket,kind:'review-1',commit:c.repeat(40),verdict:'accepted',summary:'ok',at:'2026-11-09T'+hour+':30:00.000Z'});
const stopDev=(t,ticket)=>{for(const a of t.agents)if(a.tab_name.startsWith(ticket))a.status='idle';};
const reasons=out=>out.launched.map(x=>x.reason??(x.launched?'launched':null));
const ticketOf=(identifier,more={})=>({identifier,tool:'claude',model:'claude-sonnet-5-5',effort:'high',...more});
// Validation: XJ-2 the only ticket of the plan, accepted; its QA under way.
async function inValidation(t){
  await t.chain.launch({mission:'M-1',fresh:false,tickets:[FG2]});
  accept(t,'XJ-2','a','10');stopDev(t,'XJ-2');
  for(let n=0;n<3;n++)await t.chain.tick({sessionId:'s1'});
  assert.equal(news(t.calls).filter(x=>x==='QA · XJ-1').length,1,'in Validation');
}

test('1. a removal approved never makes the ticket launchable, though it stays open in the tracker',async()=>{
  const t=await ready();
  try{
    const {screen}=screenOf(t);
    assert.ok((await t.chain.launch({mission:'M-1',fresh:false,tickets:[FG2]})).launched[0].launched);
    await screen.savePlan({mission:'M-1',plan:{tickets:[TWO[0]]}});
    await t.chain.tick({sessionId:'s1'});
    const read=await screen.read({mission:'M-1'});
    assert.deepEqual(read.drift.map(x=>[x.ticket,x.kind]),[['XJ-3','removed']]);
    await screen.reapprove({mission:'M-1',seen:read.driftSeen});
    const m=await t.registry.read('M-1');
    assert.equal((m.approval.extra||[]).some(e=>e.id==='XJ-3'),false,'never approved as a correction');
    assert.ok(m.approval.outside.includes('XJ-3'),'kept out for good');
    assert.deepEqual(driftOf(m),[],'no drift left');
    assert.deepEqual(reasons(await t.chain.launch({mission:'M-1',fresh:false,tickets:[ticketOf('XJ-3')]})),['not-in-copy']);
    // The watcher neither: XJ-2 accepted, the mission goes to Validation, XJ-3 is never started.
    accept(t,'XJ-2','a','10');stopDev(t,'XJ-2');
    for(let n=0;n<4;n++)await t.chain.tick({sessionId:'s1'});
    assert.equal(devRuns(t.calls,'XJ-3'),0);
  }finally{await t.cleanup();}
});

test('2. a ticket approved again goes only with the tool, model, effort and level approved; two launches at once, one dev',async()=>{
  const t=await ready({},{role:'lead'},{plan:[planTicket('XJ-2',1)]});
  try{
    const {screen}=screenOf(t);t.issue.children=[t.kid('XJ-2','u2')];
    await inValidation(t);
    t.issue.children.push(t.kid('XJ-9','u9'));t.chain.forget();
    await t.chain.tick({sessionId:'s1'});
    const read=await screen.read({mission:'M-1'});
    assert.deepEqual(read.drift.map(x=>[x.ticket,x.kind]),[['XJ-9','added']]);
    assert.deepEqual(read.drift[0].values,{tool:'claude',model:'claude-sonnet-5-5',effort:'high',level:'standard'},'what will be approved');
    await screen.reapprove({mission:'M-1',seen:read.driftSeen});
    assert.equal((await t.registry.read('M-1')).approval.extra[0].ticket.level,'standard');
    // dev-launch cannot replace what was approved.
    assert.deepEqual(reasons(await t.chain.launch({mission:'M-1',fresh:false,tickets:[ticketOf('XJ-9',{tool:'codex',model:'gpt-5.5-codex'})]})),['not-as-approved']);
    assert.deepEqual(reasons(await t.chain.launch({mission:'M-1',fresh:false,tickets:[ticketOf('XJ-9',{effort:'low'})]})),['not-as-approved']);
    assert.equal(devRuns(t.calls,'XJ-9'),0);
    // Two launches asked at the same moment, as approved: one dev.
    const both=await Promise.allSettled([t.chain.launch({mission:'M-1',fresh:false,tickets:[ticketOf('XJ-9')]}),t.chain.launch({mission:'M-1',fresh:false,tickets:[ticketOf('XJ-9')]})]);
    assert.equal(devRuns(t.calls,'XJ-9'),1,'one dev: '+JSON.stringify(both.map(x=>x.value?reasons(x.value):x.reason?.code)));
  }finally{await t.cleanup();}
});

test('2b. a correction whose level changes in the tracker after its approval is drift, and does not go',async()=>{
  const t=await ready({},{role:'lead'},{plan:[planTicket('XJ-2',1)]});
  try{
    const {screen}=screenOf(t);t.issue.children=[t.kid('XJ-2','u2')];
    await inValidation(t);
    t.issue.children.push(t.kid('XJ-9','u9'));t.chain.forget();
    await t.chain.tick({sessionId:'s1'});
    await screen.reapprove({mission:'M-1',seen:(await screen.read({mission:'M-1'})).driftSeen});
    const kid=t.issue.children.find(k=>k.identifier==='XJ-9');kid.labels=[{name:'agent:claude'},{name:'niveau:fort'}];t.chain.forget();
    assert.deepEqual(reasons(await t.chain.launch({mission:'M-1',fresh:false,tickets:[ticketOf('XJ-9')]})),['copy-changed']);
    await t.chain.tick({sessionId:'s1'});
    assert.deepEqual(driftOf(await t.registry.read('M-1')).map(x=>[x.ticket,x.kind,x.fields]),[['XJ-9','changed',['level']]]);
    assert.equal(devRuns(t.calls,'XJ-9'),0);
  }finally{await t.cleanup();}
});

test('2c. a ticket of the plan approved again: dev-launch with another model is refused, the approved one goes',async()=>{
  const t=await ready();
  try{
    const {screen}=screenOf(t);
    await t.chain.launch({mission:'M-1',fresh:false,tickets:[FG2]});
    await screen.savePlan({mission:'M-1',plan:{tickets:[TWO[0],{...TWO[1],model:'claude-opus-5-5'}]}});
    const read=await screen.read({mission:'M-1'});
    assert.deepEqual(read.drift[0].values,{tool:'claude',model:'claude-opus-5-5',effort:'high',level:'standard'});
    assert.deepEqual(read.drift[0].changes,[{field:'model',from:'claude-sonnet-5-5',to:'claude-opus-5-5'}]);
    await screen.reapprove({mission:'M-1',seen:read.driftSeen});
    accept(t,'XJ-2','a','10');stopDev(t,'XJ-2');await t.chain.tick({sessionId:'s1'}).catch(()=>{});
    assert.deepEqual(reasons(await t.chain.launch({mission:'M-1',fresh:false,tickets:[ticketOf('XJ-3')]})),['plan-differs'],'the plan, now the copy, says opus');
    assert.equal(devRuns(t.calls,'XJ-3'),1,'one dev, the one the watcher started');
    assert.ok(devRun(t.calls,'XJ-3').argv.includes('claude-opus-5-5'),'with the model approved: '+JSON.stringify(devRun(t.calls,'XJ-3').argv));
  }finally{await t.cleanup();}
});

test('3. an open question or request holds the reapproval as it holds the first approval; the Lead at work too',async()=>{
  const t=await ready();
  try{
    const {screen,inbox}=screenOf(t);
    await t.chain.launch({mission:'M-1',fresh:false,tickets:[FG2]});
    await screen.savePlan({mission:'M-1',plan:{tickets:[TWO[0],{...TWO[1],effort:'low'}]}});
    const {driftSeen}=await screen.read({mission:'M-1'}),before=JSON.stringify((await t.registry.read('M-1')).approval);
    await inbox.ask({mission:'M-1',type:'decision',title:'Carte seulement ?',text:'Le virement est-il dans cette issue ?',recommendation:'Carte seulement',why:'Plus court.',options:['Carte seulement','Carte et virement']});
    await assert.rejects(()=>screen.reapprove({mission:'M-1',seen:driftSeen}),e=>e.code==='QUESTIONS_OPEN'&&e.message==='Answer the pending question or request before approving.');
    assert.equal(JSON.stringify((await t.registry.read('M-1')).approval),before,'nothing written');
    // busy(): the Lead rewriting its plan holds the click, as for the first approval.
    const t2=await ready();
    try{
      const s2=screenOf(t2).screen;
      await t2.chain.launch({mission:'M-1',fresh:false,tickets:[FG2]});
      await s2.savePlan({mission:'M-1',plan:{tickets:[TWO[0],{...TWO[1],effort:'low'}]}});
      t2.agents.find(a=>a.address==='t1').status='working';
      await assert.rejects(async()=>s2.reapprove({mission:'M-1',seen:(await s2.read({mission:'M-1'})).driftSeen}),e=>e.code==='LEAD_WORKING'&&e.message==='The Lead is still preparing. Wait until it finishes, then approve.');
      // Decision 87: the Lead waiting in its terminal is said waiting, never preparing.
      t2.agents.find(a=>a.address==='t1').status='blocked';
      await assert.rejects(async()=>s2.reapprove({mission:'M-1',seen:(await s2.read({mission:'M-1'})).driftSeen}),e=>e.code==='LEAD_WORKING'&&e.message==='The Lead is waiting. Check its terminal before approving.');
      assert.equal((await t2.registry.read('M-1')).approval.kind,undefined);
    }finally{await t2.cleanup();}
  }finally{await t.cleanup();}
});

test('4. the drift shows every change of the plan, not only its tickets; the version drawn bounds the whole copy',async()=>{
  const t=await ready();
  try{
    const {screen}=screenOf(t);
    await t.chain.launch({mission:'M-1',fresh:false,tickets:[FG2]});
    await screen.savePlan({mission:'M-1',plan:{tickets:[TWO[0],{...TWO[1],effort:'low'}]}});
    const drawn=(await screen.read({mission:'M-1'})).driftSeen;
    // Only the migrations and the steps of the user change, after the screen drew the ticket.
    const more={migrations:['0025'],toPlan:{manual:{summary:'0025 sur DEV',items:[{title:'Passer 0025 sur DEV',tickets:['XJ-2']}]}}};
    await screen.savePlan({mission:'M-1',plan:{tickets:[TWO[0],{...TWO[1],effort:'low'}],...more}});
    const read=await screen.read({mission:'M-1'});
    assert.deepEqual(read.drift.map(x=>[x.ticket??null,x.part??null,x.kind]),[['XJ-3',null,'changed'],[null,'migrations','added'],[null,'toPlan.manual','added']]);
    // Decision 84: the part added says its summary and its entries; decision 85: each entry whole.
    assert.deepEqual(read.drift[2].changes,[{field:'toPlan.manual',from:null,to:'0025 sur DEV'},{field:'items',added:['Passer 0025 sur DEV'],removed:[],changed:[],entries:[{name:'Passer 0025 sur DEV',kind:'added',from:null,to:'title: Passer 0025 sur DEV; tickets: XJ-2'}]}]);
    await assert.rejects(()=>screen.reapprove({mission:'M-1',seen:drawn}),e=>e.code==='DRIFT_CHANGED','the old click never approves what it did not draw');
    await screen.reapprove({mission:'M-1',seen:read.driftSeen});
    let m=await t.registry.read('M-1');
    assert.deepEqual(m.approval.plan.migrations,['0025']);
    assert.deepEqual(m.approval.approves.map(x=>x.part||x.ticket),['XJ-3','migrations','toPlan.manual']);
    // A risk changed alone: a drift of its own, with what it was and what it is.
    await screen.savePlan({mission:'M-1',plan:{tickets:[TWO[0],{...TWO[1],effort:'low'}],...more,toPlan:{...more.toPlan,risks:{summary:'collations',items:[{title:'Collations'}]}}}});
    m=await t.registry.read('M-1');
    assert.deepEqual(driftOf(m).map(x=>[x.part,x.kind]),[['toPlan.risks','added']]);
  }finally{await t.cleanup();}
});

test('5. the drift of a correction is exact: its level changed is drift; approved then done, it is never « removed »',()=>{
  const kid=(id,more={})=>({id,uid:'u'+id,title:'Lot — '+id,level:'standard',dev:'claude',model:'claude-sonnet-5-5',effort:'high',deps:[],state:'todo',tracker:'unstarted',...more});
  const A=planTicket('XJ-2',1),approval={at:'2026-11-14T10:00:00.000Z',plan:{tickets:[A]},extra:[{id:'XJ-9',ticket:{title:'Lot — XJ-9',level:'standard',dev:'claude',model:'claude-sonnet-5-5',effort:'high',deps:[]}}]};
  const m=tickets=>({approval,plan:{tickets:[A]},tickets:[kid('XJ-2'),...tickets]});
  assert.deepEqual(driftOf(m([kid('XJ-9')])),[]);
  assert.deepEqual(driftOf(m([kid('XJ-9',{level:'heavy'})])).map(x=>[x.ticket,x.kind,x.fields]),[['XJ-9','changed',['level']]]);
  assert.deepEqual(driftOf(m([kid('XJ-9',{state:'merged',tracker:'completed'})])),[],'done: no drift');
  assert.deepEqual(driftOf(m([])),[],'gone from the tracker: nothing to approve, nothing launched');
});

test('6. the sub-tickets there before the approval never go: read in the tracker with the plan, kept through a cancellation and a reopening',async()=>{
  const t=await ready({},{role:'lead'},{approved:false});
  try{
    t.issue.children.push(t.kid('XJ-8','u8'));
    const {screen}=screenOf(t,{getTickets:async()=>({detail:async()=>({issue:t.issue})})});
    await screen.savePlan({mission:'M-1',plan:{tickets:TWO}});
    assert.deepEqual((await t.registry.read('M-1')).tickets,[],'the cache of the chain knows nothing yet');
    await screen.launch({mission:'M-1',seen:(await t.registry.read('M-1')).plan.revision});
    assert.deepEqual((await t.registry.read('M-1')).approval.outside,['XJ-8'],'from the tracker read with the plan, not the cache');
    await t.chain.launch({mission:'M-1',fresh:false,tickets:[FG2]});
    accept(t,'XJ-2','a','10');stopDev(t,'XJ-2');
    for(let n=0;n<3;n++)await t.chain.tick({sessionId:'s1'});
    assert.equal(devRuns(t.calls,'XJ-3'),1,'the plan goes on');
    assert.deepEqual(driftOf(await t.registry.read('M-1')),[]);
    // XJ-8 canceled; a correction approved meanwhile; XJ-8 opened again: still out.
    t.issue.children.find(k=>k.identifier==='XJ-8').state={type:'canceled'};t.issue.children.push(t.kid('XJ-9','u9'));t.chain.forget();
    await t.chain.tick({sessionId:'s1'});
    const read=await screen.read({mission:'M-1'});
    assert.deepEqual(read.drift.map(x=>[x.ticket,x.kind]),[['XJ-9','added']]);
    await screen.reapprove({mission:'M-1',seen:read.driftSeen});
    assert.ok((await t.registry.read('M-1')).approval.outside.includes('XJ-8'),'not lost while canceled');
    t.issue.children.find(k=>k.identifier==='XJ-8').state={type:'unstarted'};t.chain.forget();
    for(let n=0;n<3;n++)await t.chain.tick({sessionId:'s1'});
    assert.equal(driftOf(await t.registry.read('M-1')).some(x=>x.ticket==='XJ-8'),false);
    assert.equal(devRuns(t.calls,'XJ-8'),0);
    assert.deepEqual(reasons(await t.chain.launch({mission:'M-1',fresh:false,tickets:[ticketOf('XJ-8')]})).at(-1),'not-in-copy');
  }finally{await t.cleanup();}
});

test('7. decision 73: the worktree made, its real branch is compared with the one of the copy; a difference is drift',async()=>{
  const t=await ready({},{},{approved:false});
  try{
    const {screen}=screenOf(t);
    await screen.launch({mission:'M-1',seen:(await t.registry.read('M-1')).plan.revision});
    assert.equal((await t.registry.read('M-1')).approval.branch,'xj-1');
    await t.chain.launch({mission:'M-1',fresh:false,tickets:[FG2]});
    assert.deepEqual(driftOf(await t.registry.read('M-1')),[],'the same name: nothing');
    await t.make({ensureWorktree:async()=>({path:'/wt',branch:'xj-1-paiement',base:'release/x',created:[],rebased:[],command:"'node' '/r.mjs'"})}).launch({mission:'M-1',fresh:false,tickets:[FG2]});
    const d=driftOf(await t.registry.read('M-1'));
    assert.deepEqual(d.map(x=>[x.part,x.kind,x.changes]),[['branch','changed',[{field:'branch',from:'xj-1',to:'xj-1-paiement'}]]]);
  }finally{await t.cleanup();}
});

test('10. the key of a refusal said once is stable: unknown mission, nothing said now (the next pass says it)',()=>{
  const e={code:'NOT_IN_COPY'},{gateKey}=devChain;
  assert.equal(typeof gateKey,'function');
  assert.equal(gateKey(e,'XJ-2',null),null);
  assert.equal(gateKey(e,'XJ-2',{approval:{at:'2026-11-14T10:00:00.000Z'}}),'refused|NOT_IN_COPY|XJ-2|2026-11-14T10:00:00.000Z');
  assert.equal(gateKey({code:'NOT_APPROVED'},'XJ-2',{}),'refused|NOT_APPROVED|XJ-2|');
});
