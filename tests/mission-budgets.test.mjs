import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createMissionBudgets, budgetsFor, checkBudgets } from '../src/mission-budgets.mjs';
import { validateConfig } from '../src/config.mjs';
import { configV2 } from './helpers/config-v2-fixture.mjs';
import { createRequestRegistry } from '../src/requests.mjs';
import { createTraces, tracedHerdr, claudeProjectFolder } from '../src/traces.mjs';
import { createTicketTokens } from '../src/ticket-tokens.mjs';
import { createMissionRegistry } from '../src/mission.mjs';
import { setup, FG2, news } from './helpers/dev-chain-setup.mjs';
import { clean } from '../src/common.mjs';
import { desk } from './helpers/requests.mjs';
import { createMissionActions } from '../src/mission.mjs';

test('a valid budget exclusion survives a failed chain-register write',async()=>{
  const result={hold:false,blocked:[{role:'dev',ticket:'XJ-2',terminals:['t9']}]},journal=[];
  const actual=await checkBudgets(async()=>result,{
    mission:{id:'M-1'},load:async()=>({}),
    updateBudgetCheck:async()=>{throw Error('chain register locked');},
    claimSay:async(...args)=>{journal.push(args);},
  });
  assert.deepEqual(actual,{hold:false,blocked:[{role:'dev',ticket:'XJ-2',terminals:['t9']}]});
  assert.equal(journal.length,0,'a persistence failure must not be reported as a failed budget control');
});

test('budgets default, inherit global and project overrides, and validate both config versions',()=>{
  const base=configV2();
  assert.deepEqual(budgetsFor(validateConfig(base),'example'),{lead:800000,dev:750000,reviewer:400000,qa:1000000});
  base.budgets={lead:12,dev:20};base.projects[0].budgets={dev:40};
  assert.deepEqual(budgetsFor(validateConfig(base),'example'),{lead:12,dev:40,reviewer:400000,qa:1000000});
  const v1={version:1,budgets:{qa:90},projects:[]};assert.equal(validateConfig(v1).budgets.qa,90);
  for(const bad of [null,[],{dev:0},{qa:-1},{lead:1.1},{reviewer:'300'},{lead:Infinity},{qa:2**53},{typo:3}]){
    assert.throws(()=>validateConfig({...base,budgets:bad}),{code:'INVALID_CONFIG'});
    const project=configV2();project.projects[0].budgets=bad;assert.throws(()=>validateConfig(project),{code:'INVALID_CONFIG'});
  }
});

// The cases below were written with the budgets of the first version of lot 1D: they keep them, set as a configuration.
const OLD_DEFAULTS={lead:600000,dev:600000,reviewer:300000,qa:1000000};
async function world(t,{role='dev',partial=false,unknown=false,amount=601000}={}){
  const root=await mkdtemp(join(tmpdir(),'mc-budget-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const mission={id:'M-1',project:'example',issue:{identifier:'EX-1'},createdAt:'2026-11-18T09:00:00.000Z'};
  let row={trace:{key:'launch-1',role,ticket:role==='lead'?null:'EX-2',terminal:{address:'t9',labels:{'fabrique-console.mission':'M-1','fabrique-console.launch':'1'}}},
    row:{role,tool:'claude',turn:1,state:unknown?'unknown':'counted',partial,in:unknown?null:amount-10,out:unknown?null:10,input:unknown?null:100,cacheRead:unknown?null:amount-110,cacheWrite:unknown?null:0}};
  let paused=false,status='working',labels=row.trace.terminal.labels,kills=0,crash=false,config={budgets:OLD_DEFAULTS,projects:[]};
  const inbox=createRequestRegistry({root,notify:async()=>{}}),journal=new Map();
  const usage={inspect:async()=>({tokens:{estimate:true,tickets:{},agents:[]},launches:[row]})};
  const make=()=>createMissionBudgets({root,loadConfig:async()=>config,missions:{read:async()=>mission},usage,herdr:{kernel:{
    get:async()=>({state:kills?'finished':'live',address:'t9',labels,status}),kill:async()=>{kills++;return {state:'finished'};}
  }},inbox});
  const load=async()=>({pause:paused?{state:'requested'}:null});
  const claimSay=async(id,key,text)=>{journal.set(key,text);if(crash){crash=false;throw Error('crash after journal');}};
  const tick=()=>make().tick({mission,load,claimSay});
  return {root,inbox,journal,make,tick,usage,config:c=>{config=c;},setAmount:n=>{row.row.in=n-10;},setPartial:p=>{row.row.partial=p;},pause:p=>{paused=p;},status:s=>{status=s;},labels:l=>{labels=l;},crash:()=>{crash=true;},kills:()=>kills,replace:r=>{row=r;}};
}

test('one alert and one journal line survive new watcher instances and a crash between writes',async t=>{
  const w=await world(t);w.crash();await assert.rejects(w.tick());await w.tick();w.setAmount(800000);await w.tick();
  assert.equal((await w.inbox.list({mission:'M-1'})).length,1);assert.equal(w.journal.size,1);assert.equal(w.kills(),0);
  const requests=await w.inbox.list({mission:'M-1'});await w.inbox.mark(requests[0].id,{state:'resolved'});
  await w.tick();assert.equal((await w.inbox.list({mission:'M-1'})).length,0);
});

test('all roles expose consumed / budget / state, measurement preserves unknown and cache semantics',async t=>{
  const w=await world(t,{role:'lead',amount:600000});const shown=await w.make().read({mission:'M-1'});
  assert.equal(shown.budgets.length,4);assert.deepEqual(shown.budgets[0],{role:'lead',consumed:600000,budget:600000,state:'ok',partial:false});
  assert.equal(shown.budgets[1].state,'unknown');
  assert.equal(shown.budgets[1].budget,600000);
  assert.deepEqual(clean({tokens:shown}).tokens,shown);
  assert.equal(clean({tokens:{...shown,secret:'oops'}}).tokens,'[redacted]');
  const report=await w.make().measure({mission:'M-1'});assert.equal(report.total.total,600000);assert.equal(report.roles[0].cacheRead,599890);
});

test('dev sessions share one ticket allowance; reviews each receive one allowance; other tickets stay separate',async t=>{
  const w=await world(t);const original=(await w.usage.inspect()).launches[0];
  const launch=(key,role,ticket,amount)=>({trace:{key,role,ticket},row:{...original.row,role,in:amount-10}});
  w.usage.inspect=async()=>({tokens:{estimate:true,tickets:{},agents:[]},launches:[
    launch('a','dev','EX-2',400000),launch('b','dev','EX-2',400000),launch('c','dev','EX-3',400000),
    launch('d','review-1','EX-2',200000),launch('e','review-1','EX-2',200000)]});
  await w.tick();assert.equal((await w.inbox.list({mission:'M-1'})).length,1);
  const budgets=(await w.make().read({mission:'M-1'})).budgets;
  assert.equal(budgets[1].consumed,1200000);assert.equal(budgets[1].budget,1200000);assert.equal(budgets[1].state,'exceeded');
  assert.equal(budgets[2].budget,600000);assert.equal(budgets[2].state,'ok');
});

test('a resolved Inbox event is not recreated after a crash before its budget mark',async t=>{
  const w=await world(t);w.crash();await assert.rejects(w.tick());
  const [alert]=await w.inbox.list({mission:'M-1'});await w.inbox.mark(alert.id,{state:'resolved'});
  await w.tick();assert.equal((await w.inbox.list({mission:'M-1'})).length,0);
});

test('counter inspection includes every launch and its terminal binding without altering legacy read shape',async t=>{
  const root=await mkdtemp(join(tmpdir(),'mc-budget-trace-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const traces=createTraces({root,home:root,env:{}});
  const plain={run:async()=>({stdout:JSON.stringify({address:'t8'})}),record:async()=>({address:'t8',labels:{'fabrique-console.mission':'M-1'}})};
  await tracedHerdr(plain,traces).run(['run','--cwd','/wt','--label','fabrique-console.mission=M-1','--label','fabrique-console.role=lead','--','claude','go']);
  const counted=createTicketTokens({traces,reuseFor:0});const result=await counted.inspect({mission:'M-1'});
  assert.equal(result.launches[0].trace.terminal.address,'t8');assert.deepEqual(await counted.read({mission:'M-1'}),result.tokens);
});

test('watcher calls budget check before further chain actions, including Lead before Develop',async t=>{
  let checks=0;const w=await setup({budgetCheck:async()=>{checks++;return {hold:true};}});t.after(w.cleanup);
  await w.chain.tick({mission:'M-1'});assert.equal(checks,1);assert.equal(w.sent.length,0);assert.equal(w.calls.length,0);
});

test('CLI mission-measure returns one envelope with role and ticket counters from real trace fixtures',async t=>{
  const root=await mkdtemp(join(tmpdir(),'mc-budget-cli-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const registry=createMissionRegistry({root});await registry.create({project:'example',issue:{id:'i',identifier:'EX-1',title:'x'},request:'x',lead:{sessionId:'s'}});
  const traces=createTraces({root,env:{}});const {trace}=await traces.open({mission:'M-1',ticket:'EX-2',role:'dev',cwd:root,argv:['claude','go']});
  // Inject only the session-file location; the CLI uses the normal Claude trace resolver.
  const {mkdir}=await import('node:fs/promises');const folder=join(root,'claude','projects',claudeProjectFolder(root));await mkdir(folder,{recursive:true});
  await writeFile(join(folder,trace.session+'.jsonl'),JSON.stringify({type:'assistant',timestamp:new Date(Date.now()+1000).toISOString(),message:{id:'a',usage:{input_tokens:20,cache_read_input_tokens:30,cache_creation_input_tokens:40,output_tokens:10}}})+'\n');
  const r=spawnSync(process.execPath,['src/cli.mjs','mission-measure','{"mission":"M-1"}'],{encoding:'utf8',env:{...process.env,FABRIQUE_CONSOLE_HOME:root,CLAUDE_CONFIG_DIR:join(root,'claude'),FABRIQUE_CONSOLE_TRACE:''}});
  assert.equal(r.stderr,'');assert.equal(r.status,0,r.stdout);assert.equal(r.stdout.trim().split('\n').length,1);
  const body=JSON.parse(r.stdout);assert.equal(body.data.total.total,100);assert.equal(body.data.tickets['EX-2'].cacheWrite,40);
});

test('mission page receives all four budget states in its existing tokens envelope',async t=>{
  const d=await desk(t),w=await world(t,{role:'qa',amount:1000001});
  const actions=createMissionActions({root:d.root,now:d.now,registry:d.missions,inbox:d.inbox,questions:d.questions,loadState:async()=>({sessions:d.sessions}),chain:{read:async()=>({on:false,log:[],metrics:{},reports:[]})},tokens:w.make().read});
  const result=clean(await actions.read({mission:'M-1'}));
  assert.equal(result.tokens.budgets.length,4);assert.equal(result.tokens.budgets[3].state,'exceeded');
});

test('measurement tickets exclude Lead and QA just as ticket-tokens does',async t=>{
  const w=await world(t);const first=(await w.usage.inspect()).launches[0];
  w.usage.inspect=async()=>({launches:['dev','review-1','lead','qa'].map(role=>({trace:{...first.trace,role},row:{...first.row,role}}))});
  const m=await w.make().measure({mission:'M-1'});
  assert.equal(m.tickets['EX-2'].total,2*601000);assert.equal(m.total.total,4*601000);
});

async function acceptedMission(t,budgetCheck){
  const w=await setup({budgetCheck});t.after(w.cleanup);
  await w.chain.launch({mission:'M-1',tickets:[FG2]});
  for(const ticket of ['XJ-2','XJ-3'])w.reports.push(
    {ticket,kind:'dev',commit:'a'.repeat(40),repo:'admin',summary:'done',at:'2026-11-09T10:00:00.000Z'},
    {ticket,kind:'review-1',commit:'a'.repeat(40),verdict:'accepted',summary:'ok',at:'2026-11-09T10:05:00.000Z'});
  return w;
}

// Exercise the production trace reader, budget tick, durable chain and Herdr adapter together.
// Only the CLI transport and the agent-written counter files are fixtures.
async function budgetChain(t){
  let time=Date.now();
  const w=await setup({now:()=>time});t.after(w.cleanup);
  const traces=createTraces({root:w.root,home:w.root,env:{}}),usage=createTicketTokens({traces,reuseFor:0});
  // Window-created terminals are not registered in the base fake's kernel. Supply their core records here
  // at the transport boundary, with the ownership labels that the real window gives its tabs.
  const transport=w.core.through(async(program,args,options)=>{
    const result=await w.core.invoke(program,args,options);
    if(program==='herdr-app'&&args[0]==='do'&&args[1]==='tab.new'){
      const input=JSON.parse(args[2]),address=JSON.parse(result.stdout).terminal,term=w.agents.find(a=>a.address===address);
      Object.assign(term,{state:'live',shown:true,name:null,argv:input.argv,cwd:input.folder,labels:{'herdr.space':term.space,'herdr.tab':term.tab}});
      w.core.terminals.push(term);
    }
    return result;
  });
  const herdr=tracedHerdr(transport,traces),missions=createMissionRegistry({root:w.root});
  const budgets=createMissionBudgets({root:w.root,loadConfig:async()=>({budgets:OLD_DEFAULTS,projects:[]}),missions,usage,herdr,inbox:createRequestRegistry({root:w.root,notify:async()=>{}})});
  const make=()=>w.make({herdr,budgetCheck:budgets.tick});
  async function count(role,ticket,amount){
    const launch=(await traces.ofMission('M-1')).find(l=>l.role===role&&l.ticket===ticket);assert.ok(launch?.terminal);
    let path,event;
    if(launch.tool==='claude'){
      path=join(w.root,'.claude','projects',claudeProjectFolder(launch.cwd),launch.session+'.jsonl');
      event={type:'assistant',message:{id:'a',usage:{input_tokens:100,cache_read_input_tokens:amount-110,cache_creation_input_tokens:0,output_tokens:10}}};
    }else{
      await traces.link({key:launch.key,session:launch.key});
      const day=new Date(launch.at);
      path=join(w.root,'.codex','sessions',String(day.getFullYear()),String(day.getMonth()+1).padStart(2,'0'),String(day.getDate()).padStart(2,'0'),'rollout-fixture-'+launch.key+'.jsonl');
      event={type:'event_msg',payload:{type:'token_count',info:{total_token_usage:{input_tokens:amount-10,cached_input_tokens:0,output_tokens:10,total_tokens:amount}}}};
    }
    await mkdir(join(path,'..'),{recursive:true});
    await writeFile(path,JSON.stringify({...event,timestamp:new Date(Date.parse(launch.at)+1000).toISOString()})+'\n');
    return w.core.terminals.find(x=>x.address===launch.terminal.address);
  }
  return {...w,usage,make,chain:make(),count,advance:()=>{time+=61000;}};
}

const devReport=ticket=>({ticket,kind:'dev',commit:'a'.repeat(40),repo:'admin',summary:'done',at:'2026-11-09T10:00:00.000Z'});
const reviewReport=ticket=>({ticket,kind:'review-1',commit:'a'.repeat(40),verdict:'accepted',summary:'ok',at:'2026-11-09T10:05:00.000Z'});

test('a thrown budget check never prevents due QA or Validation, and is logged once after restart',async t=>{
  const budgetCheck=async()=>{throw Error('private transport output');};
  const w=await acceptedMission(t,budgetCheck);
  await w.chain.tick({mission:'M-1'});await w.make().tick({mission:'M-1'});
  assert.ok(news(w.calls).includes('QA · XJ-1'));assert.equal(w.steps.length,1);
  const log=(await w.chain.read({mission:'M-1'})).log;
  assert.equal(log.filter(l=>/Token budget check unavailable/.test(l.text)).length,1);
  assert.ok(!JSON.stringify(log).includes('private transport output'));
});

test('stopped reviewer is not retried, a new review still starts, and raising its budget permits retry',async t=>{
  let time=Date.now(),blocked=[];
  const w=await setup({now:()=>time,budgetCheck:async()=>({blocked})});t.after(w.cleanup);
  await w.chain.launch({mission:'M-1',tickets:[FG2]});
  w.reports.push({ticket:'XJ-2',kind:'dev',commit:'a'.repeat(40),repo:'admin',summary:'done',at:'2026-11-09T10:00:00.000Z'});
  await w.chain.tick({mission:'M-1'});const reviewer=w.tab('XJ-2 · revue');
  blocked=[{role:'reviewer',ticket:'XJ-2',terminals:[reviewer.address]}];await w.chain.tick({mission:'M-1'});
  await w.core.herdr.window.run('tab.close',{id:reviewer.tab,confirmed:true});time+=61000;
  await w.chain.tick({mission:'M-1'});assert.equal(news(w.calls).filter(n=>n==='XJ-2 · revue').length,1);
  w.reports.push({ticket:'XJ-2',kind:'dev',commit:'b'.repeat(40),repo:'admin',summary:'new work',at:'2026-11-09T11:00:00.000Z'});
  await w.chain.tick({mission:'M-1'});assert.equal(news(w.calls).filter(n=>n==='XJ-2 · revue').length,2);
  const newReviewer=w.tab('XJ-2 · revue');await w.chain.tick({mission:'M-1'});await w.core.herdr.window.run('tab.close',{id:newReviewer.tab,confirmed:true});
  blocked.push({role:'reviewer',ticket:'XJ-2',terminals:[newReviewer.address]});time+=61000;
  await w.chain.tick({mission:'M-1'});assert.equal(news(w.calls).filter(n=>n==='XJ-2 · revue').length,2);
  blocked=[];await w.chain.tick({mission:'M-1'});assert.equal(news(w.calls).filter(n=>n==='XJ-2 · revue').length,3);
});

test('a QA budget stop defers only QA and still requests Validation',async t=>{
  let blocked=[{role:'qa',ticket:'XJ-1',terminals:['t9']}];
  const w=await acceptedMission(t,async()=>({blocked}));
  await w.chain.tick({mission:'M-1'});assert.ok(!news(w.calls).includes('QA · XJ-1'));assert.equal(w.steps.length,1);
  blocked=[];await w.chain.tick({mission:'M-1'});assert.ok(news(w.calls).includes('QA · XJ-1'));
});

test('a dev budget stop waits for that ticket while unrelated reviews still start',async t=>{
  const w=await setup({budgetCheck:async()=>({blocked:[{role:'dev',ticket:'XJ-2',terminals:['t9']}]})});t.after(w.cleanup);
  await w.chain.launch({mission:'M-1',tickets:[FG2]});
  w.reports.push({ticket:'XJ-3',kind:'dev',commit:'a'.repeat(40),repo:'admin',summary:'done',at:'2026-11-09T10:00:00.000Z'});
  await w.chain.tick({mission:'M-1'});assert.ok(news(w.calls).includes('XJ-3 · revue'));
  const before=news(w.calls).filter(n=>n==='XJ-2 · dev').length;
  await w.core.herdr.window.run('tab.close',{id:w.tab('XJ-2 · dev').tab,confirmed:true});
  await w.chain.tick({mission:'M-1'});assert.equal(news(w.calls).filter(n=>n==='XJ-2 · dev').length,before);
});

test('a Lead budget stop preserves its question until the budget is raised',async t=>{
  let blocked=[{role:'lead',ticket:null,terminals:['t1']}],launches=0;
  const w=await setup({budgetCheck:async()=>({blocked}),leadLaunch:async()=>{launches++;return {session:{id:'s1',terminalId:'t9'}};}});t.after(w.cleanup);
  await w.chain.launch({mission:'M-1',tickets:[FG2]});w.agents.splice(w.agents.findIndex(a=>a.address==='t1'),1);
  w.reports.push({name:'XJ-2.ask-1794000000000.json',ticket:'XJ-2',kind:'ask',at:'2026-11-10T10:00:00.000Z',question:'Which role?',options:['Keep','Merge'],from:'dev'});
  await w.chain.tick({mission:'M-1'});await w.chain.tick({mission:'M-1'});assert.equal(launches,0);
  blocked=[];await w.chain.tick({mission:'M-1'});assert.equal(launches,1);
});

// Simple first (decision of the user, 2026-11-17): budgets alert and never stop; a mission created before they came is
// not counted at all.
test('a budget crossing alerts once and stops nothing; a mission created before budgets is not counted',async t=>{
  const w=await world(t,{amount:1900000});w.status('idle');
  await w.tick();await w.tick();
  assert.equal((await w.inbox.list({mission:'M-1'})).length,1);assert.equal(w.journal.size,1);assert.equal(w.kills(),0);
  const old=await world(t,{amount:1900000});
  const result=await old.make().tick({mission:{id:'M-1',project:'example',issue:{identifier:'EX-1'},createdAt:'2026-11-16T15:12:05.127Z'},load:async()=>({pause:null}),claimSay:async()=>{}});
  assert.deepEqual(result,{hold:false,blocked:[]});
  assert.equal((await old.inbox.list({mission:'M-1'})).length,0);
});

test('the budgets of a mission created before budgets are shown untracked, never exceeded',async t=>{
  const root=await mkdtemp(join(tmpdir(),'mc-budget-old-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const row={trace:{key:'l1',role:'dev',ticket:'EX-2'},row:{role:'dev',tool:'claude',turn:1,state:'counted',partial:false,in:5000000,out:10,input:0,cacheRead:0,cacheWrite:0}};
  const budgets=createMissionBudgets({root,loadConfig:async()=>({projects:[]}),missions:{read:async()=>({id:'M-1',project:'example',createdAt:'2026-11-16T15:12:05.127Z'})},usage:{inspect:async()=>({launches:[row]})},herdr:{},inbox:{}});
  const out=await budgets.read({mission:'M-1'});
  assert.equal(out.budgets.find(b=>b.role==='dev').state,'untracked');
  assert.equal(out.budgets.find(b=>b.role==='dev').consumed,5000010);
});

test('the tokens of a mission created before budgets go through the CLI cleaning untouched',async t=>{
  const root=await mkdtemp(join(tmpdir(),'mc-budget-clean-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const row={trace:{key:'l1',role:'dev',ticket:'EX-2'},row:{role:'dev',tool:'claude',turn:1,state:'counted',partial:false,in:5000,out:10,input:0,cacheRead:0,cacheWrite:0}};
  const budgets=createMissionBudgets({root,loadConfig:async()=>({projects:[]}),missions:{read:async()=>({id:'M-1',project:'example',createdAt:'2026-11-16T15:12:05.127Z'})},usage:{inspect:async()=>({tokens:{estimate:true,tickets:{},agents:[]},launches:[row]})},herdr:{},inbox:{}});
  const tokens=await budgets.read({mission:'M-1'});
  assert.deepEqual(clean({tokens}).tokens,tokens);
});
