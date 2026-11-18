// M6 (b): what the engine gives the page of the environment check (src/environment-view.mjs), from the check accepted in
// part (a). Every state of the module has its view: green, each cause, not configured, never checked, unreadable,
// stale. Nothing is green without a check that succeeded, for the configuration and the enrollment of now (decisions
// 89, 93 and 95). Fakes only (tests/helpers/environment-world.mjs): never a real base, container or docker.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { environmentShown, createEnvironmentView, UNKNOWN } from '../src/environment-view.mjs';
import { createMissionActions, createMissionRegistry } from '../src/mission.mjs';
import { createBackend } from '../src/backend.mjs';
import { configV2 } from './helpers/config-v2-fixture.mjs';
import { environmentWorld, WHEN } from './helpers/environment-world.mjs';
import { sampleEnvironment } from './helpers/environment-sample.mjs';

const after=t=>fn=>t.after(fn);
const HOLD=fileURLToPath(new URL('./helpers/environment-hold-child.mjs',import.meta.url));
const until=async(condition,what,ms=20000)=>{const end=Date.now()+ms;while(!condition()){if(Date.now()>end)throw new Error('timeout: '+what);await new Promise(r=>setTimeout(r,10));}};
// A real check started elsewhere (tests/helpers/environment-hold-child.mjs), held inside its lock until killed.
async function checkElsewhere(t,dir,root) {
  const control=join(dir,'control-'+Math.random().toString(16).slice(2));mkdirSync(control);
  const child=spawn(process.execPath,[HOLD,root,control],{stdio:'ignore'});
  const done=new Promise(r=>child.once('exit',()=>r()));
  t.after(async()=>{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');await done;});
  await until(()=>existsSync(join(control,'held')),'the check elsewhere holds its lock');
  return {kill:async()=>{child.kill('SIGKILL');await done;}};
}
// The markers of the checks under way in a project folder (review 3: one `.running-<id>` per check, an old `.running`).
const markers=dir=>{try{return readdirSync(dir).filter(n=>n==='.running'||/^\.running-[a-f0-9]{24}$/.test(n)).sort();}catch{return [];}};
const F='f'.repeat(64),E='e'.repeat(64),SHA='a'.repeat(40);
const STEPS_GREEN=[{step:'database',status:'green'},{step:'migrations',status:'green',journal:3,pending:0},{step:'accounts',status:'green',accounts:{po:true,dev:true}}];
const last=(over={})=>({version:1,project:'example',at:'2026-11-16T10:00:00.000Z',sha:SHA,fingerprint:F,enrollment:E,cause:null,green:true,status:'green',steps:STEPS_GREEN,...over});
const shown=(l,o={})=>environmentShown({declared:'declared',last:l,project:'example',fingerprint:F,enrollment:E,...o});

// ---- 1. The rule, state by state.

test('green: only a check « green » for the configuration and the enrollment of now',()=>{
  const v=shown(last());
  assert.deepEqual([v.state,v.ok,v.recheck,v.at,v.sha],['ready',true,true,'2026-11-16T10:00:00.000Z',SHA]);
  assert.deepEqual(v.checks,[{key:'database',ok:true,status:'green'},{key:'migrations',ok:true,status:'green',journal:3,pending:0},{key:'accounts',ok:true,status:'green',accounts:{po:true,dev:true}}]);
  // Never green otherwise: a flag, a status or a step that is not green; another configuration or enrollment.
  for(const l of [last({green:false}),last({status:'incomplete'}),last({steps:STEPS_GREEN.slice(0,2)}),last({steps:[STEPS_GREEN[0],{step:'migrations',status:'not-run'},STEPS_GREEN[2]]})])
    assert.notEqual(shown(l).ok,true,JSON.stringify(l));
  assert.deepEqual([shown(last(),{fingerprint:'0'.repeat(64)}).state,shown(last(),{fingerprint:'0'.repeat(64)}).ok,shown(last(),{fingerprint:'0'.repeat(64)}).cause],['stale',false,'STALE']);
  assert.deepEqual([shown(last(),{enrollment:null}).state,shown(last(),{enrollment:null}).ok],['stale',false]);
});

test('a failure: its cause, the step that failed, the steps after it « not run », never green',()=>{
  const steps=[{step:'database',status:'green'},{step:'migrations',status:'failed',cause:'MIGRATIONS_PENDING',journal:3,pending:2},{step:'accounts',status:'not-run'}];
  const v=shown(last({green:false,status:'failed',cause:'MIGRATIONS_PENDING',steps}));
  assert.deepEqual([v.state,v.ok,v.cause,v.pending,v.recheck],['failed',false,'MIGRATIONS_PENDING',2,true]);
  assert.deepEqual(v.checks.map(c=>[c.key,c.ok,c.status]),[['database',true,'green'],['migrations',false,'failed'],['accounts',null,'not-run']]);
  const accounts=shown(last({green:false,status:'failed',cause:'ACCOUNT_MISSING',steps:[STEPS_GREEN[0],STEPS_GREEN[1],{step:'accounts',status:'failed',cause:'ACCOUNT_MISSING',accounts:{po:true,dev:false}}]}));
  assert.deepEqual([accounts.cause,accounts.missing],['ACCOUNT_MISSING',['dev']]);
  const db=shown(last({green:false,status:'failed',cause:'DB_UNKNOWN',enrollment:null,steps:[{step:'database',status:'failed',cause:'DB_UNKNOWN',detail:'not-enrolled'},{step:'migrations',status:'not-run'},{step:'accounts',status:'not-run'}]}),{enrollment:null});
  assert.deepEqual([db.state,db.cause,db.detail],['failed','DB_UNKNOWN','not-enrolled']);
  // A cause outside the closed list is not believed: unknown.
  assert.deepEqual([shown(last({green:false,status:'failed',cause:'WHATEVER',steps:[{step:'database',status:'failed',cause:'WHATEVER'}]})).state],['unknown']);
  // The check before it was killed: said.
  assert.equal(shown(last({previous:'interrupted'})).interrupted,true);
});

test('not configured, invalid, incomplete, never checked, unreadable: none is green; only « not configured » leaves the launch free',()=>{
  const none=environmentShown({declared:'absent',last:null});
  assert.deepEqual(none,{state:'not-configured',ok:null,recheck:false,checks:[]});
  assert.deepEqual(environmentShown({declared:'absent',last:last()}).ok,null,'a green of before does not survive a configuration removed');
  const invalid=environmentShown({declared:'invalid',last:last()});
  assert.deepEqual([invalid.state,invalid.ok,invalid.cause],['failed',false,'CONFIG_INVALID']);
  const partial=shown(last({green:false,status:'incomplete',steps:[STEPS_GREEN[0],{step:'migrations',status:'not-declared'},{step:'accounts',status:'not-declared'}]}));
  assert.deepEqual([partial.state,partial.ok,partial.cause,partial.checks.map(c=>c.ok)],['failed',false,'INCOMPLETE',[true,null,null]]);
  assert.deepEqual(shown(null),{state:'unchecked',ok:false,cause:'NOT_CHECKED',recheck:true,checks:[]});
  assert.deepEqual(shown('unreadable'),{state:'unknown',ok:false,cause:'UNREADABLE',recheck:true,checks:[]});
  for(const bad of [{},{status:'green'},last({version:2}),last({project:'other'}),last({steps:'x'}),last({status:'weird'}),[]])
    assert.deepEqual([shown(bad).state,shown(bad).ok],['unknown',false],JSON.stringify(bad));
  assert.deepEqual([UNKNOWN.state,UNKNOWN.ok],['unknown',false]);
  // A check of before saved when nothing was declared, read now that something is: stale, to run again.
  assert.equal(shown(last({status:'not-declared',green:false,fingerprint:null,steps:[]})).state,'stale');
});

// ---- 2. The view over the real check (fakes only): what the page reads after each run.

test('the view of a real check: never checked, green, then each failure, stale, unreadable, not configured',async t=>{
  const w=await environmentWorld(after(t)),view=createEnvironmentView({root:w.root,loadConfig:w.loadConfig,check:w.check.check});
  assert.equal((await view.read({project:'example'})).state,'unchecked');
  assert.equal(await view.read({project:'nope'}),null,'an unknown project has no view');
  // Not enrolled yet: the database is unknown.
  let v=await view.run({project:'example'});
  assert.deepEqual([v.state,v.cause,v.detail,v.ok],['failed','DB_UNKNOWN','not-enrolled',false]);
  await w.enroll();
  v=await view.run({project:'example'});
  assert.deepEqual([v.state,v.ok,v.checks.map(c=>c.ok)],['ready',true,[true,true,true]],JSON.stringify(v));
  assert.deepEqual(await view.read({project:'example'}),v,'what a reading gives is what the run gave');
  // Each failure the check can give, its cause in the view.
  for(const [why,cause,change] of [
    ['the engine unreachable','DB_ABSENT',()=>w.set(s=>{s.dockerDown=true;})],
    ['the socket of the container asks a password','DB_AUTH_UNSUPPORTED',()=>w.set(s=>{s.socketAuth='password';})],
    ['another engine','DB_NOT_LOCAL',()=>w.set(s=>{s.engine={...s.engine,OperatingSystem:'Ubuntu 24.04.1 LTS'};})],
    ['two migrations pending','MIGRATIONS_PENDING',()=>{w.state.rows=[WHEN[0]];}],
    ['the base ahead','DB_AHEAD',()=>{w.state.rows=[...WHEN,WHEN[2]+5000];}],
    ['an account missing','ACCOUNT_MISSING',()=>{w.state.accounts=['po@example.invalid'];}],
  ]) {
    w.reset();w.state.rows=[...WHEN];w.state.accounts=['po@example.invalid','dev@example.invalid'];change();
    v=await view.run({project:'example'});
    assert.deepEqual([v.state,v.ok,v.cause],['failed',false,cause],why+': '+JSON.stringify(v));
    if(cause==='MIGRATIONS_PENDING')assert.equal(v.pending,2);
    if(cause==='ACCOUNT_MISSING')assert.deepEqual(v.missing,['dev']);
  }
  w.reset();w.state.rows=[...WHEN];w.state.accounts=['po@example.invalid','dev@example.invalid'];
  w.commit(repo=>rmSync(join(repo,'drizzle','0001_m1.sql')));
  v=await view.run({project:'example'});
  assert.deepEqual([v.cause,v.checks.map(c=>c.status)],['MIGRATIONS_UNREADABLE',['green','failed','not-run']]);
  w.commit(repo=>writeFileSync(join(repo,'drizzle','0001_m1.sql'),'CREATE TABLE t1(id int);\n'));
  assert.equal((await view.run({project:'example'})).state,'ready');
  // The configuration changes after a green: the green is not kept.
  w.configure(p=>{p.environment.accounts.keys.qa='qa@example.invalid';});
  assert.deepEqual([(await view.read({project:'example'})).state,(await view.read({project:'example'})).ok],['stale',false]);
  // Partial, then invalid configuration.
  w.configure(p=>{delete p.environment.accounts;delete p.environment.migrations;});
  v=await view.run({project:'example'});
  assert.deepEqual([v.state,v.cause],['failed','INCOMPLETE']);
  w.configure(p=>{p.environment.server={};});
  assert.deepEqual([(await view.read({project:'example'})).cause,(await view.run({project:'example'})).cause],['CONFIG_INVALID','CONFIG_INVALID']);
  // The last check unreadable: unknown, never a supposition.
  w.configure(p=>{delete p.environment.server;});
  writeFileSync(join(w.root,'environment','example','last.json'),'{not json');
  assert.deepEqual(await view.read({project:'example'}),{state:'unknown',ok:false,cause:'UNREADABLE',recheck:true,checks:[]});
  // No environment at all: not configured, nothing to run again, never green.
  w.configure(p=>{delete p.environment;});
  assert.deepEqual(await view.read({project:'example'}),{state:'not-configured',ok:null,recheck:false,checks:[]});
  assert.equal((await view.run({project:'example'})).state,'not-configured');
});

// ---- 2 b. A check running or interrupted (review 1, point 2): the green of before is never shown meanwhile.

test('a green of before, then a real check running elsewhere, then killed before saving: checking, then interrupted, never green',async t=>{
  const w=await environmentWorld(after(t)),view=createEnvironmentView({root:w.root,loadConfig:w.loadConfig,check:w.check.check});
  const dir=join(w.root,'environment','example'),running=join(dir,'.running');
  await w.enroll();
  assert.equal((await view.run({project:'example'})).state,'ready','the green of before');
  assert.deepEqual(markers(dir),[],'a check saved removes its marker');
  const elsewhere=await checkElsewhere(t,w.dir,w.root);
  const its=markers(dir);
  assert.equal(its.length,1,'the check elsewhere has its own marker');assert.match(its[0],/^\.running-[a-f0-9]{24}$/);
  let v=await view.read({project:'example'});
  assert.deepEqual(v,{state:'checking',ok:false,cause:'CHECKING',recheck:false,checks:[]},'a check running: never the green of before');
  await assert.rejects(view.run({project:'example'}),{code:'ENVIRONMENT_BUSY'});
  assert.deepEqual(markers(dir),its,'a check refused removes its own marker, never the one of the check that runs');
  assert.equal((await view.read({project:'example'})).state,'checking','a reading does not take the lock away from the check');
  await elsewhere.kill();
  assert.deepEqual(markers(dir),its,'the killed check leaves its marker');
  v=await view.read({project:'example'});
  assert.deepEqual(v,{state:'interrupted',ok:false,cause:'INTERRUPTED',recheck:true,checks:[]},'killed before saving: to run again, never the green of before');
  assert.deepEqual(markers(dir),its,'a reading reclaims nothing');
  // Run again: the real check says the one before was interrupted, is green on its own, and removes the dead marker.
  v=await view.run({project:'example'});
  assert.deepEqual([v.state,v.ok,v.interrupted],['ready',true,true]);
  assert.deepEqual(markers(dir),[]);
  // A marker or the lock that cannot be read: unknown. An old `.running` (a version before) is still a marker.
  mkdirSync(running);
  assert.deepEqual(await view.read({project:'example'}),{state:'unknown',ok:false,cause:'UNREADABLE',recheck:true,checks:[]});
  rmdirSync(running);
  mkdirSync(join(dir,'.running-'+'0'.repeat(24)));
  assert.deepEqual(await view.read({project:'example'}),{state:'unknown',ok:false,cause:'UNREADABLE',recheck:true,checks:[]},'a marker that is not a file');
  rmdirSync(join(dir,'.running-'+'0'.repeat(24)));
  writeFileSync(running,'{}');
  assert.deepEqual(await view.read({project:'example'}),{state:'interrupted',ok:false,cause:'INTERRUPTED',recheck:true,checks:[]},'an old `.running`');
  const blind=createEnvironmentView({root:w.root,loadConfig:w.loadConfig,check:w.check.check,lockf:join(w.dir,'no-lockf')});
  assert.deepEqual(await blind.read({project:'example'}),{state:'unknown',ok:false,cause:'UNREADABLE',recheck:true,checks:[]});
  v=await view.run({project:'example'});
  assert.deepEqual([v.state,v.interrupted],['ready',true],'an old `.running` is read as a check that died, then removed');
  assert.deepEqual(markers(dir),[]);
  // Not markers: the temporary file of a marker being written, a name of another shape.
  writeFileSync(join(dir,'.running-'+'0'.repeat(24)+'.1234.tmp'),'');writeFileSync(join(dir,'.running-x'),'');
  assert.equal((await view.read({project:'example'})).state,'ready');
});

// Review 3: two checks, A and B, with controlled stops. B writes its marker and stops before trying the lock; A runs
// whole and removes only its own marker; B then takes the lock and dies at once (its lock program kills it). Before,
// A removed the one shared `.running` and the page said « ready »: a false green. Now B's marker stays: interrupted.
test('review 3: B marks, A runs whole, B takes the lock and dies: interrupted, never the green of A',async t=>{
  const w=await environmentWorld(after(t)),view=createEnvironmentView({root:w.root,loadConfig:w.loadConfig,check:w.check.check});
  const dir=join(w.root,'environment','example');
  await w.enroll();
  assert.equal((await view.run({project:'example'})).state,'ready','the green of before');
  const control=join(w.dir,'control-b');mkdirSync(control);
  const lockfB=join(w.dir,'lockf-wait-then-die');
  writeFileSync(lockfB,`#!/bin/sh\ntouch '${control}/waiting'\nwhile [ ! -f '${control}/go' ]; do sleep 0.02; done\n/usr/bin/lockf "$@" || exit $?\nkill -9 $PPID\nexit 0\n`);chmodSync(lockfB,0o755);
  const b=spawn(process.execPath,[HOLD,w.root,control,lockfB],{stdio:'ignore'});
  const bDone=new Promise(r=>b.once('exit',(code,sig)=>r(sig)));
  t.after(async()=>{if(b.exitCode===null&&b.signalCode===null)b.kill('SIGKILL');await bDone;});
  await until(()=>existsSync(join(control,'waiting')),'B has written its marker and stops before its lock');
  assert.ok(markers(dir).length>=1,'B marked');
  // A: a whole check, green, while B waits.
  const a=await view.run({project:'example'});
  assert.equal(a.state,'interrupted','A saved its green, but B is marked and the lock is free: not green');
  writeFileSync(join(control,'go'),'');
  assert.equal(await bDone,'SIGKILL','B killed once it has taken the lock');
  assert.equal(existsSync(join(control,'held')),false,'B never got inside the check');
  assert.deepEqual(await view.read({project:'example'}),{state:'interrupted',ok:false,cause:'INTERRUPTED',recheck:true,checks:[]},'B died: interrupted, never the green of A');
  // A run again: green, says the one before was interrupted, and removes the marker of the dead B.
  const again=await view.run({project:'example'});
  assert.deepEqual([again.state,again.interrupted],['ready',true]);
  assert.deepEqual(markers(dir),[]);
});

// Review 2, first case: a real check killed the very instant it has taken its lock (its lock program kills it then).
// The marker is written before the lock is tried, so it is there: interrupted, never the green of before.
test('a green of before, then a real check killed between taking its lock and anything else: interrupted, never green',async t=>{
  const w=await environmentWorld(after(t)),view=createEnvironmentView({root:w.root,loadConfig:w.loadConfig,check:w.check.check});
  const dir=join(w.root,'environment','example');
  await w.enroll();
  assert.equal((await view.run({project:'example'})).state,'ready','the green of before');
  const killer=join(w.dir,'lockf-then-die');
  writeFileSync(killer,'#!/bin/sh\n/usr/bin/lockf "$@" || exit $?\nkill -9 $PPID\nexit 0\n');chmodSync(killer,0o755);
  const control=join(w.dir,'control-killed');mkdirSync(control);
  const child=spawn(process.execPath,[HOLD,w.root,control,killer],{stdio:'ignore'});
  const signal=await new Promise(r=>child.once('exit',(code,sig)=>r(sig)));
  assert.equal(signal,'SIGKILL','killed by its lock program, once the lock was taken');
  assert.equal(existsSync(join(control,'held')),false,'it never got inside the check');
  assert.equal(markers(dir).length,1,'its marker, written before the lock, is left');
  assert.deepEqual(await view.read({project:'example'}),{state:'interrupted',ok:false,cause:'INTERRUPTED',recheck:true,checks:[]});
  const v=await view.run({project:'example'});
  assert.deepEqual([v.state,v.interrupted],['ready',true]);
});

// Review 2, second case: no marker, a green of before, and a lock that cannot be tried: unknown, never the green.
test('a green of before, no marker, the lock unreadable or inaccessible: unknown, never green',async t=>{
  const w=await environmentWorld(after(t)),view=createEnvironmentView({root:w.root,loadConfig:w.loadConfig,check:w.check.check});
  const dir=join(w.root,'environment','example'),guard=join(dir,'operation.guard');
  await w.enroll();
  assert.equal((await view.run({project:'example'})).state,'ready','the green of before');
  assert.deepEqual(markers(dir),[],'no marker');
  const UNREAD={state:'unknown',ok:false,cause:'UNREADABLE',recheck:true,checks:[]};
  const blind=createEnvironmentView({root:w.root,loadConfig:w.loadConfig,check:w.check.check,lockf:join(w.dir,'no-lockf')});
  assert.deepEqual(await blind.read({project:'example'}),UNREAD,'the lock cannot be tried');
  rmSync(guard);mkdirSync(guard);
  assert.deepEqual(await view.read({project:'example'}),UNREAD,'the lock is not a file');
  rmdirSync(guard);
  assert.equal((await view.read({project:'example'})).state,'ready','the lock readable and free again: the last result');
});

// ---- 3. The wiring: mission-read gives it, environment-check {mission} runs it; the enrollment stays the user's.

function backendFixture(t,{environment=null}={}) {
  const dir=realpathSync(mkdtempSync(join(tmpdir(),'mc-env-b-')));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const root=join(dir,'state');mkdirSync(root);
  const config=configV2();config.projects[0].repos.splice(1);config.projects[0].repos[0].path=join(dir,'repo');
  if(environment)config.projects[0].environment=environment;
  writeFileSync(join(root,'config.json'),JSON.stringify(config));
  return {dir,root};
}

test('mission-read gives the environment of the project of the mission; unreadable, it is unknown; no project, nothing',async t=>{
  const {root}=backendFixture(t),registry=createMissionRegistry({root});
  const {mission}=await registry.create({project:'example',issue:null,request:'r'});
  const {mission:alone}=await registry.create({project:null,issue:null,request:'r'});
  const chain={read:async()=>({on:false,log:[],metrics:null,reports:[]})};
  const inbox={list:async()=>[],taken:async()=>[]},questions={list:async()=>[]};
  const asked=[];
  const actions=env=>createMissionActions({registry,chain,inbox,questions,environment:env});
  const read=await actions(async input=>{asked.push(input);return {state:'ready',ok:true,recheck:true,checks:[]};}).read({mission:mission.id});
  assert.deepEqual([read.environment,asked],[{state:'ready',ok:true,recheck:true,checks:[]},[{project:'example'}]]);
  const broken=await actions(async()=>{throw new Error('disk');}).read({mission:mission.id});
  assert.deepEqual(broken.environment,UNKNOWN,'a reading that fails is unknown, and the mission is read all the same');
  assert.equal(Object.hasOwn(await actions(async()=>({ok:true})).read({mission:alone.id}),'environment'),false);
  assert.equal(Object.hasOwn(await actions(null).read({mission:mission.id}),'environment'),false);
});

test('environment-check {mission} through the backend: the check of its project, then the same view mission-read gives',async t=>{
  const {root}=backendFixture(t),backend=createBackend({root,env:{},traceAgents:false});
  const {mission}=await createMissionRegistry({root}).create({project:'example',issue:null,request:'r'});
  const out=await backend.dispatch('environment-check',{mission:mission.id});
  assert.deepEqual(out,{environment:{state:'not-configured',ok:null,recheck:false,checks:[]}});
  assert.deepEqual((await backend.dispatch('mission-read',{mission:mission.id})).environment,out.environment);
  await assert.rejects(backend.dispatch('environment-check',{mission:mission.id,project:'example'}),{code:'INVALID_ARGUMENT'});
  await assert.rejects(backend.dispatch('environment-check',{mission:'M-404'}));
  const {mission:alone}=await createMissionRegistry({root}).create({project:null,issue:null,request:'r'});
  await assert.rejects(backend.dispatch('environment-check',{mission:alone.id}),{code:'INVALID_ARGUMENT'});
  // The project form of part (a) is unchanged.
  assert.equal((await backend.dispatch('environment-check',{project:'example'})).status,'not-declared');
  // The enrollment stays refused from a session of an agent, whatever is passed.
  const agent=createBackend({root,env:{FABRIQUE_CONSOLE_AGENT:'1'},traceAgents:false});
  await assert.rejects(agent.dispatch('environment-enroll',{project:'example',container:'beta-db'}),{code:'AGENT_SESSION'});
  await assert.rejects(agent.dispatch('environment-enroll',{mission:mission.id}),{code:'AGENT_SESSION'});
});

test('environment-check {mission} with an environment declared: the real check; a check running elsewhere is said, then interrupted',async t=>{
  const {dir,root}=backendFixture(t,{environment:sampleEnvironment()}),backend=createBackend({root,env:{},traceAgents:false});
  const {mission}=await createMissionRegistry({root}).create({project:'example',issue:null,request:'r'});
  const read=async()=>(await backend.dispatch('mission-read',{mission:mission.id})).environment;
  // Never enrolled: the real check stops at the database, nothing else is touched.
  let out=await backend.dispatch('environment-check',{mission:mission.id});
  assert.deepEqual([out.environment.state,out.environment.ok,out.environment.cause,out.environment.detail,out.environment.checks.map(c=>c.status)],['failed',false,'DB_UNKNOWN','not-enrolled',['failed','not-run','not-run']]);
  assert.deepEqual(await read(),out.environment);
  const elsewhere=await checkElsewhere(t,dir,root);
  assert.deepEqual(await read(),{state:'checking',ok:false,cause:'CHECKING',recheck:false,checks:[]});
  await assert.rejects(backend.dispatch('environment-check',{mission:mission.id}),{code:'ENVIRONMENT_BUSY'});
  await elsewhere.kill();
  assert.deepEqual(await read(),{state:'interrupted',ok:false,cause:'INTERRUPTED',recheck:true,checks:[]});
  out=await backend.dispatch('environment-check',{mission:mission.id});
  assert.deepEqual([out.environment.state,out.environment.cause,out.environment.interrupted],['failed','DB_UNKNOWN',true]);
  assert.deepEqual(await read(),out.environment);
});
