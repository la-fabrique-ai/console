// M6 (b), the engine (decision 111, review of M6 b point 1): a launch is refused while the project declares an environment
// and its view is not green at the moment of the launch, whatever the state that is not green (to fix, running,
// interrupted, unknown, not enrolled, never checked, stale). Refused, nothing is written. A project with no environment
// declared stays launchable. Read under the lock that already serializes the launches, the view read again right before;
// the check itself is never run from here. Fakes only: never a real base, container, Herdr or agent.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMissionActions, createMissionRegistry, APPROVAL } from '../src/mission.mjs';
import { createQuestionActions, createQuestionRegistry } from '../src/questions.mjs';
import { createRequestRegistry } from '../src/requests.mjs';
import { createEnvironmentView } from '../src/environment-view.mjs';
import { planOf } from '../src/plan.mjs';
import { ENVIRONMENT_HELD } from '../src/dev-chain.mjs';
import { fakeHerdr } from './helpers/fake-herdr.mjs';
import { planTicket, setup, leadMission, devRuns, FG2 } from './helpers/dev-chain-setup.mjs';
import { configV2 } from './helpers/config-v2-fixture.mjs';
import { environmentWorld } from './helpers/environment-world.mjs';
import { sampleEnvironment } from './helpers/environment-sample.mjs';

const after=t=>fn=>t.after(fn);
// Every record under a folder, with its bytes: what a refusal must leave as it was. The empty files of the kernel locks
// (operation.guard) and the one-time switch of the requests (legacy-archive.json, src/legacy-archive.mjs) are not
// records: taking a lock, or the first reading of the requests, makes them whatever follows.
const NOT_RECORDS=/(^|\/)(operation\.guard|legacy-archive\.json)$/;
function snapshot(dir) {
  const out={};
  const walk=d=>{for(const name of readdirSync(d)){const p=join(d,name);if(statSync(p).isDirectory())walk(p);else if(!NOT_RECORDS.test(p))out[p.slice(dir.length)]=readFileSync(p,'utf8');}};
  try{walk(dir);}catch(error){if(error.code!=='ENOENT')throw error;}
  return out;
}
const STEPS=[{key:'database',ok:true,status:'green'},{key:'migrations',ok:true,status:'green',journal:3,pending:0},{key:'accounts',ok:true,status:'green',accounts:{po:true,dev:true}}];
const READY={state:'ready',ok:true,recheck:true,at:'2026-11-16T10:00:00.000Z',checks:STEPS};
const NOT_CONFIGURED={state:'not-configured',ok:null,recheck:false,checks:[]};
// Every view that is not green, as src/environment-view.mjs gives it.
const NOT_GREEN={
  'to fix (migrations pending)':{state:'failed',ok:false,cause:'MIGRATIONS_PENDING',pending:2,recheck:true,checks:[STEPS[0],{key:'migrations',ok:false,status:'failed',cause:'MIGRATIONS_PENDING',pending:2},{key:'accounts',ok:null,status:'not-run'}]},
  'to fix (an account missing)':{state:'failed',ok:false,cause:'ACCOUNT_MISSING',missing:['dev'],recheck:true,checks:[STEPS[0],STEPS[1],{key:'accounts',ok:false,status:'failed',cause:'ACCOUNT_MISSING',accounts:{po:true,dev:false}}]},
  'not enrolled':{state:'failed',ok:false,cause:'DB_UNKNOWN',detail:'not-enrolled',recheck:true,checks:[{key:'database',ok:false,status:'failed',cause:'DB_UNKNOWN',detail:'not-enrolled'},{key:'migrations',ok:null,status:'not-run'},{key:'accounts',ok:null,status:'not-run'}]},
  'configuration invalid':{state:'failed',ok:false,cause:'CONFIG_INVALID',recheck:true,checks:[]},
  'incomplete':{state:'failed',ok:false,cause:'INCOMPLETE',recheck:true,checks:[]},
  'running':{state:'checking',ok:false,cause:'CHECKING',recheck:false,checks:[]},
  'interrupted':{state:'interrupted',ok:false,cause:'INTERRUPTED',recheck:true,checks:[]},
  'unknown':{state:'unknown',ok:false,cause:'UNREADABLE',recheck:true,checks:[]},
  'never checked':{state:'unchecked',ok:false,cause:'NOT_CHECKED',recheck:true,checks:[]},
  'stale':{state:'stale',ok:false,cause:'STALE',recheck:true,checks:[]},
  // Anything else the reader may give is not green either.
  'a view of another form':{state:'ready',ok:'yes',checks:[]},
};

// The screen of a mission whose plan is recorded, its Lead alive and idle: « Approve and start the dev » on it.
async function screen(t,{root=null,project='alpha',environment}) {
  const dir=root??realpathSync(mkdtempSync(join(tmpdir(),'mc-env-launch-')));
  if(!root)t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const at=Date.parse('2026-11-16T09:00:00Z'),now=()=>at;
  const missions=createMissionRegistry({root:dir,now}),questions=createQuestionRegistry({root:dir,now});
  const inbox=createRequestRegistry({root:dir,now,questions,missions,notify:async()=>{}});
  const {window}=fakeHerdr({agents:[{address:'t7',space:'sp1',tab:'x7',tab_name:'XJ-1 · Lead',status:'idle'}]}).herdr;
  const sent=[],asked=[];
  const reader=async input=>{asked.push(input);return typeof environment==='function'?environment(input):environment;};
  const actions=createMissionActions({root:dir,now,registry:missions,inbox,questions,loadState:async()=>({sessions:[{id:'s1',terminalId:'t7'}]}),window,send:async x=>{sent.push(x);return {sent:true};},environment:reader});
  const {mission}=await missions.create({project,issue:{id:'i1',identifier:'XJ-1',title:'Paiement',url:'u'},request:'Payer',lead:{sessionId:'s1',lastSeen:null}});
  let seen;
  await missions.update(mission.id,m=>{m.plan={...planOf({tickets:[planTicket('XJ-2',1)]}),revision:1,savedAt:'2026-11-16T08:00:00.000Z',tracker:{verified:true}};seen=m.plan.revision;});
  return {dir,missions,actions,sent,asked,id:mission.id,approve:()=>actions.launch({mission:mission.id,seen}),state:()=>snapshot(join(dir,'state'))};
}

test('an environment declared: green, the launch goes; every state that is not green is refused, and nothing is written',async t=>{
  for(const [name,view] of Object.entries(NOT_GREEN)) {
    const s=await screen(t,{environment:view}),before=s.state();
    await assert.rejects(s.approve(),e=>e.code==='ENVIRONMENT_NOT_READY'&&e.message===APPROVAL.environment,name);
    assert.deepEqual(s.state(),before,name+': nothing written');
    assert.deepEqual(s.sent,[],name+': nothing sent to the Lead');
    assert.deepEqual(s.asked,[{project:'alpha'}],name+': the view of the project of the mission, read once');
  }
  // A reading that fails is unknown: refused too.
  const broken=await screen(t,{environment:()=>{throw new Error('disk');}}),before=broken.state();
  await assert.rejects(broken.approve(),{code:'ENVIRONMENT_NOT_READY'});
  assert.deepEqual(broken.state(),before);
  // Green: approved, and the launch asked of the Lead, once.
  const green=await screen(t,{environment:READY});
  const out=await green.approve();
  assert.deepEqual([out.approved,out.launch],[true,'asked']);
  assert.equal(green.sent.length,1);
  assert.ok((await green.missions.read(green.id)).approval?.at,'the copy is written');
});

test('the words of the refusal say what to do: run the check again on the Prepare screen',()=>{
  assert.match(APPROVAL.environment,/check/i);assert.match(APPROVAL.environment,/Prepare/);
  assert.match(ENVIRONMENT_HELD,/contrôle/);assert.match(ENVIRONMENT_HELD,/Prepare/);
});

test('a project with no environment declared stays launchable, as today',async t=>{
  const s=await screen(t,{environment:NOT_CONFIGURED});
  assert.deepEqual([(await s.approve()).approved,s.sent.length],[true,1]);
  assert.deepEqual(s.asked,[{project:'alpha'}],'the view is read at the launch, and holds nothing');
  // A project the configuration does not know (the view gives nothing): no environment declared either.
  const unknown=await screen(t,{environment:null});
  assert.equal((await unknown.approve()).approved,true);
});

test('the real view: never checked, refused; enrolled and checked green, the launch goes; no environment, it goes',async t=>{
  const w=await environmentWorld(after(t)),view=createEnvironmentView({root:w.root,loadConfig:w.loadConfig,check:w.check.check});
  const s=await screen(t,{root:w.dir,project:'example',environment:view.read}),before=s.state();
  await assert.rejects(s.approve(),e=>e.code==='ENVIRONMENT_NOT_READY'&&e.message===APPROVAL.environment);
  assert.deepEqual(s.state(),before,'never checked: nothing written');
  await w.enroll();
  await assert.rejects(s.approve(),{code:'ENVIRONMENT_NOT_READY'},'enrolled, never checked since: still refused');
  assert.equal((await view.run({project:'example'})).state,'ready');
  assert.equal((await s.approve()).approved,true,'green: approved');
  assert.equal(s.sent.length,1);
  // The same project, its environment removed from the configuration: not configured, launchable.
  const dir=realpathSync(mkdtempSync(join(tmpdir(),'mc-env-none-')));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const root=join(dir,'state');mkdirSync(root);
  const config=configV2();config.projects[0].repos.splice(1);config.projects[0].repos[0].path=join(dir,'repo');
  writeFileSync(join(root,'config.json'),JSON.stringify(config));
  const plain=createEnvironmentView({root,loadConfig:async()=>JSON.parse(readFileSync(join(root,'config.json'),'utf8')),check:async()=>{throw new Error('never run');}});
  const none=await screen(t,{project:'example',environment:plain.read});
  assert.equal((await none.approve()).approved,true);
});

test('green at the approval, not green at the launch of the first dev: the Lead, its request and dev-launch are refused, nothing written',async t=>{
  let current=READY;
  const c=await setup({environment:async()=>current},{},{approved:false});t.after(c.cleanup);
  const {missions}=await leadMission(c.root),questions=createQuestionRegistry({root:c.root}),told=[];
  const screenOf=createMissionActions({root:c.root,now:()=>Date.parse('2026-11-16T09:00:00Z'),registry:missions,questions,inbox:createRequestRegistry({root:c.root,questions,missions}),
    loadState:async()=>({sessions:[c.session]}),window:c.core.herdr.window,send:async x=>{told.push(x);return {sent:true};},environment:async()=>current});
  assert.equal((await screenOf.launch({mission:'M-1',seen:(await missions.read('M-1')).plan.revision})).approved,true,'green: approved');
  assert.equal(told.length,1);
  // Meanwhile the environment is no longer green: each state refuses the first dev, before anything is written or run.
  const lead=createQuestionActions({questions:null,inbox:null,missions,launch:c.chain.launch});
  for(const [name,view] of Object.entries(NOT_GREEN)) {
    current=view;
    const before=snapshot(c.root);
    await assert.rejects(()=>c.chain.launch({mission:'M-1',tickets:[FG2]}),e=>e.code==='ENVIRONMENT_NOT_READY'&&e.message===ENVIRONMENT_HELD,name);
    await assert.rejects(()=>lead.request({mission:'M-1',kind:'launch',tickets:[FG2]}),{code:'ENVIRONMENT_NOT_READY'},name);
    assert.deepEqual(snapshot(c.root),before,name+': nothing written');
    // The watcher on its own starts no dev either.
    await c.make().tick({sessionId:'s1'});
    assert.equal(devRuns(c.calls,'XJ-2'),0,name+': no dev');
    assert.equal(c.calls.filter(([x])=>x==='hc.run').length,0,name+': nothing asked of the core');
  }
  // Green again: the first dev starts.
  current=READY;
  const out=await c.chain.launch({mission:'M-1',tickets:[FG2]});
  assert.ok(out.launched.some(x=>x.launched));assert.equal(devRuns(c.calls,'XJ-2'),1);
});

test('the real view goes from green to not green between the approval and the launch: refused',async t=>{
  const w=await environmentWorld(after(t)),view=createEnvironmentView({root:w.root,loadConfig:w.loadConfig,check:w.check.check});
  await w.enroll();
  assert.equal((await view.run({project:'example'})).state,'ready');
  const environment=()=>view.read({project:'example'});
  const c=await setup({environment},{},{approved:false});t.after(c.cleanup);
  const {missions}=await leadMission(c.root),questions=createQuestionRegistry({root:c.root});
  const screenOf=createMissionActions({root:c.root,now:()=>Date.parse('2026-11-16T09:00:00Z'),registry:missions,questions,inbox:createRequestRegistry({root:c.root,questions,missions}),
    loadState:async()=>({sessions:[c.session]}),window:c.core.herdr.window,send:async()=>({sent:true}),environment});
  assert.equal((await screenOf.launch({mission:'M-1',seen:(await missions.read('M-1')).plan.revision})).approved,true);
  // The configuration of the environment changed since the check: its green is no longer the check of now.
  w.configure(p=>{p.environment.accounts.keys.dev='other@example.invalid';});
  assert.equal((await view.read({project:'example'})).state,'stale');
  await assert.rejects(()=>c.chain.launch({mission:'M-1',tickets:[FG2]}),{code:'ENVIRONMENT_NOT_READY'});
  assert.equal(devRuns(c.calls,'XJ-2'),0);
});

test('the page of the ticket shows the refusal of « Approve and start the dev », in the words of the engine',async t=>{
  const root=fileURLToPath(new URL('..',import.meta.url));
  const child=spawnSync(process.execPath,['--experimental-vm-modules','--no-warnings',fileURLToPath(new URL('./helpers/launch-refusal-probe.mjs',import.meta.url)),root],{encoding:'utf8',timeout:20000});
  assert.equal(child.status,0,child.stdout+child.stderr);
  assert.match(child.stdout,/refused on the page/);
});
