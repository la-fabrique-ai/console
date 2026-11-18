// M6 (b): what the page of a mission shows of the environment check of its project (decisions 89, 93 and 95), read from
// the check accepted in part (a) (src/environment-check.mjs) and never computed anew. The page words it
// (ui/v4/words.js, `environment`); the engine only gives states, causes and numbers.
//
// The view: {state, ok, recheck, checks, cause?, detail?, pending?, missing?, at?, sha?, interrupted?}.
// - `ready` (ok true): the last check is green, with its three steps green, for the configuration and the enrollment
//   of now. Nothing else is ever green: the state comes from a check that succeeded, never from a supposition.
// - `failed` (ok false): a cause of the closed list of the check (CAUSES), or CONFIG_INVALID (the environment of the
//   project is invalid) or INCOMPLETE (not all three blocks are declared): the launch is held.
// - `unchecked` (NOT_CHECKED), `stale` (STALE: the configuration or the enrollment changed since), `unknown`
//   (UNREADABLE: the last check cannot be read, or says something the check never writes): ok false, held too.
// - `checking` (CHECKING): a check of the project runs now, started from anywhere (its kernel lock is held, marker or
//   not); `interrupted` (INTERRUPTED): a check left its marker (`.running-<id>`) without saving (the lock is free). Both ok
//   false, whatever the last check said: a green of before never survives a check in progress or interrupted (review 1,
//   point 2). The lock is tried at every reading, marker or not (review 2): the marker or the lock that cannot be read
//   is unknown, never the last result.
// - `not-configured` (ok null): the project declares no environment. Never green, and the launch is not held
//   (decision 93, point 5); nothing to run again.
// `checks`: the three steps of the check, in its order (database, migrations, accounts), each green (ok true), failed
// (ok false) or neither (ok null: not run after a failure, not declared), with its numbers. No text of a program, no
// identifier of an account: the names of the accounts declared and yes or no.
import { createHash } from 'node:crypto';
import { lstat, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { canonical, fail, readJSON } from './common.mjs';
import { validateEnvironment, environmentFingerprint } from './environment-config.mjs';
import { CAUSES, STEPS, isMarker, validEnrollment } from './environment-check.mjs';
import { operationLock } from './operation-lock.mjs';

export const UNKNOWN=Object.freeze({state:'unknown',ok:false,cause:'UNREADABLE',recheck:true,checks:Object.freeze([])});
const plain=value=>Boolean(value)&&typeof value==='object'&&!Array.isArray(value);
const count=value=>Number.isSafeInteger(value)&&value>=0?value:undefined;
const flags=value=>plain(value)&&Object.values(value).every(v=>typeof v==='boolean')?{...value}:undefined;
const DETAIL=/^[a-z][a-z-]{0,40}$/;

// A step of the check as the page reads it: only the fields the check writes, of the kinds it writes them.
function stepShown(step) {
  if(!plain(step))return null;
  const ok=step.status==='green'?true:step.status==='failed'?false:['not-run','not-declared'].includes(step.status)?null:undefined;
  if(ok===undefined)return null;
  if(ok===false&&!CAUSES.includes(step.cause))return null;
  const out={key:step.step,ok,status:step.status};
  if(ok===false)out.cause=step.cause;
  if(typeof step.detail==='string'&&DETAIL.test(step.detail))out.detail=step.detail;
  for(const name of ['journal','pending'])if(count(step[name])!==undefined)out[name]=step[name];
  if(flags(step.accounts))out.accounts=flags(step.accounts);
  return out;
}

// `marker`: what the markers and the lock of the check say (src/environment-check.mjs): null (no check under way),
// 'running', 'interrupted' or 'unreadable'.
export function environmentShown({declared,last,project=null,fingerprint=null,enrollment=null,marker=null}) {
  if(declared==='absent')return {state:'not-configured',ok:null,recheck:false,checks:[]};
  if(declared==='invalid')return {state:'failed',ok:false,cause:'CONFIG_INVALID',recheck:true,checks:[]};
  if(marker==='running')return {state:'checking',ok:false,cause:'CHECKING',recheck:false,checks:[]};
  if(marker==='interrupted')return {state:'interrupted',ok:false,cause:'INTERRUPTED',recheck:true,checks:[]};
  if(marker!==null)return {...UNKNOWN,checks:[]};
  if(last===null||last===undefined)return {state:'unchecked',ok:false,cause:'NOT_CHECKED',recheck:true,checks:[]};
  if(!plain(last)||last.version!==1||typeof last.project!=='string'||project!==null&&last.project!==project||!Array.isArray(last.steps)||typeof last.status!=='string')return {...UNKNOWN,checks:[]};
  const when=typeof last.at==='string'?{at:last.at}:{},sha=typeof last.sha==='string'&&/^[a-f0-9]{40}$/.test(last.sha)?{sha:last.sha}:{};
  const interrupted=last.previous==='interrupted'?{interrupted:true}:{};
  // Saved for another configuration or another enrollment: not the check of now.
  if(last.fingerprint!==fingerprint||last.enrollment!==enrollment)return {state:'stale',ok:false,cause:'STALE',recheck:true,...when,checks:[]};
  const checks=STEPS.map(name=>stepShown(last.steps.find(s=>s?.step===name)));
  if(checks.some(c=>!c))return {...UNKNOWN,checks:[]};
  const base={recheck:true,...when,...sha,...interrupted,checks};
  if(last.status==='green'&&last.green===true&&checks.every(c=>c.ok===true))return {state:'ready',ok:true,...base};
  if(last.status==='incomplete'&&!checks.some(c=>c.ok===false))return {state:'failed',ok:false,cause:'INCOMPLETE',...base};
  const failed=checks.find(c=>c.ok===false);
  if(last.status==='failed'&&failed&&last.cause===failed.cause) {
    const extra={};
    if(failed.detail)extra.detail=failed.detail;
    if(failed.cause==='MIGRATIONS_PENDING'&&failed.pending!==undefined)extra.pending=failed.pending;
    if(failed.cause==='ACCOUNT_MISSING'&&failed.accounts)extra.missing=Object.keys(failed.accounts).filter(name=>!failed.accounts[name]);
    return {state:'failed',ok:false,cause:failed.cause,...extra,...base};
  }
  return {...UNKNOWN,checks:[]};
}

const sha256=value=>createHash('sha256').update(value).digest('hex');

export function createEnvironmentView({root,loadConfig,check,lockf='/usr/bin/lockf'}) {
  const dirOf=key=>join(root,'environment',key);
  // What the configuration declares for the project, with the fingerprint the check binds its result to. Null: no
  // such project.
  async function declaredOf(key) {
    let config;
    try{config=await loadConfig();}catch(error){if(error?.code==='INVALID_CONFIG')return {declared:'invalid'};throw error;}
    const project=(config.projects||[]).find(p=>p.key===key);
    if(!project)return null;
    if(config.version!==2||project.environment===undefined)return {declared:'absent'};
    try{
      const environment=validateEnvironment(project.environment,{repos:project.repos.length});
      return {declared:'declared',fingerprint:environmentFingerprint({environment,repo:project.repos[0]})};
    }catch{return {declared:'invalid'};}
  }
  // The enrollment as the check takes it: its fingerprint when valid, else none.
  async function enrollmentOf(key) {
    let value;
    try{value=await readJSON(join(dirOf(key),'enrollment.json'),null);}catch{return null;}
    return value&&validEnrollment(value)?sha256(canonical(value)):null;
  }
  async function lastOf(key) {
    try{return await readJSON(join(dirOf(key),'last.json'),null);}catch{return 'unreadable';}
  }
  // A check under way? The kernel lock is always tried (review 2), markers or not, and never kept: held, a check runs
  // (running); it cannot be tried (an unreadable, invalid or inaccessible lock): unreadable; free, the markers say
  // whether a check died before saving (at least one: interrupted) or nothing runs (none: null). Each check writes its
  // own marker `.running-<id>` before it tries the lock and removes only its own (review 3), so no instant of a check
  // is unseen; an old `.running` counts as a marker. A folder of markers that cannot be listed, or a marker that is not
  // a regular file: unreadable. Nothing is reclaimed: the next check does that. No folder: no check ever started (the
  // check creates it before its marker).
  // `ours`: the lock is held by a hold of this process (below): no check can be inside it, and the markers alone are
  // read. A hold is no check and has no marker, so any marker there is another check's (dead, or one about to be
  // refused that removes its own): green only with none.
  async function markerOf(key,ours=false) {
    const dir=dirOf(key);
    try{const info=await lstat(dir);if(!info.isDirectory()||info.isSymbolicLink())return 'unreadable';}
    catch(error){return error?.code==='ENOENT'?null:'unreadable';}
    const present=async()=>{
      try {
        let found=false;
        for(const name of (await readdir(dir)).filter(isMarker)) {
          let info;
          try{info=await lstat(join(dir,name));}catch(error){if(error?.code==='ENOENT')continue;throw error;}
          if(!info.isFile()||info.isSymbolicLink())return 'unreadable';
          found=true;
        }
        return found;
      }catch{return 'unreadable';}
    };
    let inside;
    if(ours)inside=await present();
    else {
      try{await operationLock(dir,async()=>{inside=await present();},{lockf});}
      catch(error){return error?.code==='BUSY'?'running':'unreadable';}
    }
    return inside===true?'interrupted':inside===false?null:'unreadable';
  }
  // The holds of this process, by project (decision 111, M6 b engine review 1): the kernel lock of the check, taken once
  // and shared by every hold under way, dropped when the last one ends.
  const holds=new Map();
  // Whether a hold of this process has the lock of the project, waiting for one that is taking it.
  async function ours(project) {
    const entry=holds.get(project);
    if(!entry||entry.closing)return false;
    try{await entry.acquired;}catch{return false;}
    return entry.entered&&!entry.closing;
  }
  async function read({project}={}) {
    if(typeof project!=='string'||!/^[a-z0-9][a-z0-9_-]{0,47}$/.test(project))return null;
    const declared=await declaredOf(project);
    if(!declared)return null;
    if(declared.declared!=='declared')return environmentShown({declared:declared.declared,last:null});
    const marker=await markerOf(project,await ours(project));
    const last=await lastOf(project);
    return environmentShown({declared:'declared',last,project,fingerprint:declared.fingerprint,enrollment:await enrollmentOf(project),marker});
  }
  // The lock of the check of a project for a hold: the one of the holds under way, else taken now. Resolves to its
  // release; rejects as operationLock does (BUSY: a check holds it).
  async function share(project) {
    for(let entry=holds.get(project);entry?.closing;entry=holds.get(project))await entry.lock;
    let entry=holds.get(project);
    if(!entry) {
      entry={count:0,entered:false,closing:false};
      let release;const done=new Promise(r=>{release=r;});
      entry.release=release;
      entry.acquired=new Promise((ok,ko)=>{
        entry.lock=operationLock(dirOf(project),async()=>{entry.entered=true;ok();await done;},{lockf}).catch(ko).finally(()=>{if(holds.get(project)===entry)holds.delete(project);});
      });
      holds.set(project,entry);
    }
    entry.count++;
    try{await entry.acquired;}catch(error){entry.count--;throw error;}
    return async()=>{if(--entry.count>0)return;entry.closing=true;entry.release();await entry.lock;};
  }
  // Decision 111 (M6 b engine review 1): task(view) with no check of the project able to start until task returns. The
  // kernel lock of the check is taken first (shared by the holds of this process), then the view is read under it and
  // the lock kept for the whole of task. A check under way (the lock held elsewhere) or a lock that cannot be taken gives
  // task a view that is not green. A project never checked (no folder) is read without the lock: nothing is created, and
  // its view is not green. A reading that fails is unknown. What task throws is the caller's.
  async function hold({project}={},task) {
    const reading=()=>read({project}).catch(()=>({...UNKNOWN,checks:[]}));
    let release=null;
    if(typeof project==='string'&&/^[a-z0-9][a-z0-9_-]{0,47}$/.test(project)) {
      let there=false;
      try{const info=await lstat(dirOf(project));there=info.isDirectory()&&!info.isSymbolicLink();}catch{}
      if(there) {
        try{release=await share(project);}
        catch(error) {
          const view=await reading();
          if(view===null||view.state==='not-configured')return task(view);
          return task(error?.code==='BUSY'?environmentShown({declared:'declared',last:null,marker:'running'}):{...UNKNOWN,checks:[]});
        }
      }
    }
    // A green read without the lock held (review 2: no folder at the first look, then an enrollment and a green check
    // finished before the reading) is refused: nothing keeps a check from starting during task.
    try{const view=await reading();return await task(!release&&view?.ok===true?{...UNKNOWN,checks:[]}:view);}
    finally{if(release)await release();}
  }
  // The check of the project, then its view: a check that cannot run (ENVIRONMENT_BUSY…) is the caller's error.
  async function run({project}={}) {
    await check({project});
    return read({project});
  }
  // « Run the check again » on the page of a mission: the project of the mission.
  async function runMission(input,registry) {
    if(!plain(input)||Object.keys(input).some(key=>key!=='mission'))fail('INVALID_ARGUMENT','Unexpected environment argument.');
    const mission=await registry.read(input.mission);
    if(!mission.project)fail('INVALID_ARGUMENT','This mission has no project to check.');
    return {environment:await run({project:mission.project})};
  }
  return {read,run,runMission,hold};
}
