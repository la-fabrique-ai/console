import { join } from 'node:path';
import { mkdir, link, readFile, readdir, writeFile, rename, rm, stat } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { fail } from './common.mjs';

// The watcher: one resident process that reads what the screens show (the sessions and teams of herdr-core, the
// issues of every team, My issues) and writes each answer, dated, as a file under <root>/state/. The screens watch
// that folder and redraw when a file changes; they never read herdr-core or Tracker on a timer themselves.
//
// Files: watcher.json {pid,startedAt,at} (the heartbeat, and the lock: the process it names owns the folder),
// snapshot.json, my-issues.json, issues-<key>.json, missions.json, each {at,data}; lease (the time the window last asked for the
// watcher), poke (a request to read Tracker again now), stop (a request to exit). Every write is atomic (a
// temporary file, then a rename).
//
// Ownership: every step that reads the lock and then writes (taking it, the heartbeat, a publication, the removal
// at the end) runs under one mutex, the folder watcher.lock (mkdir is atomic; a mutex whose holder is gone is
// moved aside by one process only, then removed). So a process that read an old heartbeat can neither take a
// lock another one has just taken, nor publish over its owner.
export const STATE_DIR='state';
export const CHAIN_EVERY=3,HEARTBEAT_MS=2000,TICKET_MS=60000,LEASE_MS=10*60000,STALE_MS=15000,READ_TIMEOUT_MS=120000;
const MUTEX_WAIT_MS=10,MUTEX_TRIES=500;

export const stateDir=root=>join(root,STATE_DIR);
export const issuesFile=key=>`issues-${key}.json`;

// null when the file is absent; `unreadable` when it is there but not JSON (a write cut short).
async function readJSON(path) {
  let raw;
  try {raw=await readFile(path,'utf8');}
  catch(error){if(error.code==='ENOENT')return null;throw error;}
  try {return JSON.parse(raw);}catch{return {unreadable:true};}
}
async function writeAtomic(path,text) {
  const tmp=path+'.tmp-'+process.pid;
  await writeFile(tmp,text);
  await rename(tmp,path);
}
const alive=pid=>{try{process.kill(pid,0);return true;}catch(error){return error.code==='EPERM';}};
const heartbeatText=(pid,startedAt,at)=>JSON.stringify({pid,startedAt,at:new Date(at).toISOString()})+'\n';
const pause=ms=>new Promise(r=>setTimeout(r,ms));
// A read that never answers is published as an error, so a stop or a lapsed lease never waits for it.
function bounded(promise,ms) {
  let timer;
  const timeout=new Promise((_r,reject)=>{timer=setTimeout(()=>{const e=new Error('The read did not answer in time.');e.code='TIMEOUT';reject(e);},ms);timer.unref?.();});
  return Promise.race([promise,timeout]).finally(()=>clearTimeout(timer));
}

// The mutex of the lock: the folder watcher.lock, holding the pid of its holder. It is created by renaming a
// prepared folder (pid inside) onto that name: a rename onto an existing, non-empty folder fails, so one process
// at a time holds it, and the folder never exists without its pid; an instance is released by moving it aside,
// then deleting it. A holder that is gone (its process does not answer) is removed by one cleaner only: the right
// to clean one dead instance is a file linked exclusively inside that instance (a hard link is created only when
// the name is free, and carries its content at once), named after the dead pid (tomb-<pid>.<k>) and holding the
// identity of the cleaning operation (pid.op: two operations of one process are two cleaners). So a cleaner that
// read an old instance can neither remove the one another process holds since, nor clean the same dead one as
// an earlier cleaner still alive; a cleaner that dies while cleaning is succeeded by the next one (k+1).
// Contention beyond `tries` is MUTEX_BUSY, which is not a proof that another watcher runs.
async function holderOf(mutex) {
  try{const n=Number.parseInt(await readFile(join(mutex,'pid'),'utf8'),10);return Number.isInteger(n)?n:null;}catch{return null;}
}
let prepared=0,operations=0;
async function withMutex(dir,pid,fn,{tries=MUTEX_TRIES}={}) {
  const mutex=join(dir,'watcher.lock'),operation=pid+'.'+(++operations);
  for(let attempt=0;attempt<tries;attempt++) {
    const tmp=mutex+'.new-'+pid+'-'+(++prepared);
    await mkdir(tmp);await writeFile(join(tmp,'pid'),String(pid));
    try {await rename(tmp,mutex);}
    catch(error) {
      await rm(tmp,{recursive:true,force:true});
      if(!['EEXIST','ENOTEMPTY','EISDIR'].includes(error.code))throw error;
      if(await cleanDead(mutex,pid,operation))continue;
      await pause(MUTEX_WAIT_MS);
      continue;
    }
    try{return await fn();}
    finally{await discard(mutex,pid);}
  }
  await dropOwnTombs(mutex,operation);
  fail('MUTEX_BUSY','The lock of the watcher is busy.');
}
// Removes an instance of the mutex: moved aside first (a rename is atomic), then deleted. A recursive delete in
// place would leave the folder empty for an instant, when a rename of a prepared folder could replace it. An
// instance already gone is nothing to do; any other failure is said, so the resident ends and its process no
// longer passes for a live holder.
async function discard(mutex,pid) {
  const aside=mutex+'.gone-'+pid+'-'+(++prepared);
  try{await rename(mutex,aside);}catch(error){if(error.code==='ENOENT')return;throw error;}
  await rm(aside,{recursive:true,force:true,maxRetries:3});
}
// Writes a file exclusively, with its content at once: prepared aside, then hard-linked onto its name (EEXIST
// when the name is taken). True when the name was free.
async function linkExclusive(path,text) {
  const tmp=path+'.tmp-'+process.pid+'-'+(++prepared);
  await writeFile(tmp,text);
  try{await link(tmp,path);return true;}
  catch(error){if(error.code==='EEXIST')return false;if(error.code==='ENOENT')return false;throw error;}
  finally{await rm(tmp,{force:true});}
}
// The cleaner named by a tomb: alive when its process answers. A tomb that is gone (ENOENT) was dropped by its
// cleaner. One whose text names no process is taken as a cleaner at work while it is recent. One that cannot be
// read or dated for any other reason (its rights, an I/O error) is taken as alive: no proof, no cleaning.
async function cleanerAlive(path) {
  let text;
  try{text=await readFile(path,'utf8');}
  catch(error){return error.code!=='ENOENT';}
  const cleaner=Number.parseInt(text,10);
  if(Number.isInteger(cleaner))return alive(cleaner);
  try{return Date.now()-(await stat(path)).mtimeMs<STALE_MS;}
  catch(error){return error.code!=='ENOENT';}
}
// Removes the mutex when its holder is gone, as the one cleaner of that instance. True when removed.
async function cleanDead(mutex,pid,operation) {
  const holder=await holderOf(mutex);
  let dead;
  if(holder!==null)dead=holder!==pid&&!alive(holder);
  else {try{dead=Date.now()-(await stat(mutex)).mtimeMs>STALE_MS;}catch{return false;}}
  if(!dead)return false;
  const prefix='tomb-'+(holder??'none')+'.';
  let names;try{names=await readdir(mutex);}catch{return false;}
  const tombs=names.filter(n=>n.startsWith(prefix)&&!n.includes('.tmp-')).map(n=>Number.parseInt(n.slice(prefix.length),10)).filter(Number.isInteger).sort((a,b)=>a-b);
  // This operation's own tomb, from an earlier try, is kept; otherwise one more is linked after the last.
  const texts=new Map();
  for(const j of tombs){try{texts.set(j,(await readFile(join(mutex,prefix+j),'utf8')).trim());}catch{texts.set(j,null);}}
  let k=tombs.find(j=>texts.get(j)===operation);
  if(k===undefined){k=(tombs.length?tombs[tombs.length-1]:0)+1;if(!(await linkExclusive(join(mutex,prefix+k),operation)))return false;}
  // An earlier cleaner still alive cleans it (another operation of this very process included); a dead one is
  // succeeded. The instance must still be the dead one.
  for(const j of tombs)if(j<k&&(await cleanerAlive(join(mutex,prefix+j))))return false;
  if((await holderOf(mutex))!==holder)return false;
  await discard(mutex,pid);
  return true;
}
// An operation that gives up (MUTEX_BUSY) leaves no tomb of its own behind: it would pass for a live cleaner.
async function dropOwnTombs(mutex,operation) {
  let names;try{names=await readdir(mutex);}catch{return;}
  for(const name of names.filter(n=>n.startsWith('tomb-')&&!n.includes('.tmp-'))) {
    const path=join(mutex,name);
    try{if((await readFile(path,'utf8')).trim()===operation)await rm(path,{force:true});}catch{}
  }
}

// The watcher as the screens see it: running when its heartbeat is recent and its process answers. A lock that
// cannot be read (a write cut short) is no watcher.
export async function watcherStatus(root,now=Date.now()) {
  const info=await readJSON(join(stateDir(root),'watcher.json'));
  if(!info||info.unreadable)return {running:false,pid:null,at:null};
  const at=Date.parse(info.at||'');
  const running=Number.isFinite(at)&&Math.abs(now-at)<STALE_MS&&Number.isInteger(info.pid)&&alive(info.pid);
  return {running,pid:info.pid??null,at:info.at??null};
}

export function createWatcher({root,dispatch,loadConfig,sleep=ms=>new Promise(r=>setTimeout(r,ms)),now=Date.now,pid=process.pid,log=()=>{}}) {
  const dir=stateDir(root);
  const file=name=>join(dir,name);
  const last=new Map();
  // Once the loop ends (a stop, a lapsed lease, the lock lost), nothing is published any more and no read starts.
  let ending=false;
  const mutex=fn=>withMutex(dir,pid,fn);
  async function owned() {const info=await readJSON(file('watcher.json'));return info?.pid===pid;}
  // A failure of the storage itself (a write, the release of the mutex) is not a failure of a read: it is kept
  // for the loop, which ends on it so the resident exits and its process no longer passes for a live holder.
  let fatal=null;
  const storageFailed=error=>{if(!fatal)fatal=error;ending=true;};
  // Writes an answer only when it differs from the last one written, and only while this process owns the lock:
  // a late answer of a watcher that lost it never covers the owner's. Returns whether it was written.
  async function publish(name,data) {
    const body=JSON.stringify(data);
    if(ending||last.get(name)===body)return false;
    return busyIsFalse(mutex(async()=>{
      if(ending||!(await owned())){ending=true;return false;}
      await writeAtomic(file(name),JSON.stringify({at:new Date(now()).toISOString(),data})+'\n');
      last.set(name,body);
      return true;
    }));
  }
  // The mutex busy for too long (MUTEX_BUSY) is not a lost lock: the step is skipped and tried again next time.
  const busyIsFalse=promise=>promise.catch(error=>{if(error.code!=='MUTEX_BUSY')throw error;log('mutex',error);return null;});
  async function exists(name) {try{await stat(file(name));return true;}catch{return false;}}
  async function leaseAge() {
    try{return now()-Date.parse((await readFile(file('lease'),'utf8')).trim());}catch{return Infinity;}
  }
  // Takes the lock under the mutex: refused while another process beats; a stale, absent or unreadable lock is
  // replaced by ours in one atomic write, so the lock is never empty on disk.
  async function acquire(startedAt) {
    await mutex(async()=>{
      const other=await watcherStatus(root,now());
      if(other.running&&other.pid!==pid)fail('WATCHER_RUNNING','A watcher already runs.');
      await writeAtomic(file('watcher.json'),heartbeatText(pid,startedAt,now()));
    });
  }
  // The heartbeat, by the owner only; false when the lock names another process now.
  const heartbeat=startedAt=>busyIsFalse(mutex(async()=>{if(!(await owned()))return false;await writeAtomic(file('watcher.json'),heartbeatText(pid,startedAt,now()));return true;}));
  // One read, bounded: its answer, or its error as data (never an empty answer). Only the read is caught here;
  // the publication that follows fails for the storage, and the loop.
  async function answer(action,input) {
    try{return await bounded(dispatch(action,input),READ_TIMEOUT_MS);}
    catch(error){return {error:{code:error.code||'INTERNAL_ERROR',message:error.message}};}
  }
  // Reads the state of herdr-core.
  async function readSnapshot() {
    try{await publish('snapshot.json',await answer('snapshot',{}));}catch(error){storageFailed(error);}
  }
  // Reads Tracker for every screen: every issue of each team with a Tracker team, then My issues. One failure does
  // not stop the others; each answer keeps the error of its read. The series stops where the loop ended.
  async function readTracker(refresh) {
    let config;try{config=await loadConfig();}catch(error){log('config',error);return;}
    try {
      for(const project of (config.projects||[]).filter(p=>p.teamId)) {
        if(ending)return;
        await publish(issuesFile(project.key),await answer('ticket-backlog',{key:project.key,all:true,refresh}));
      }
      if(ending)return;
      await publish('my-issues.json',await answer('ticket-my-issues',{refresh}));
    } catch(error){storageFailed(error);}
  }
  // The missions under way, for the screens: after each step of the chain, which is what moves them.
  async function readMissions() {
    try{const list=await answer('mission-list',{active:true,journal:true});await publish('missions.json',list?.missions??list);await publish('inbox.json',await answer('inbox-list',{}));}catch(error){storageFailed(error);}
  }
  // The reads in flight: the loop never waits for them, so the heartbeat, the snapshot and the stop and lease
  // checks keep their pace while Tracker is slow. A read is not started again while the previous one answers.
  let snapshotRead=null,trackerRead=null,chainRun=null;
  const settle=()=>Promise.all([snapshotRead,trackerRead,chainRun]);
  // The chain of the devs (dev-chain.mjs), every three cycles: reviews, fixes, tickets unblocked, QA, Validation,
  // whether a page is open or not. A step still running is not started again; its failure is only logged.
  const runChain=()=>bounded(dispatch('dev-chain-tick-all',{}),READ_TIMEOUT_MS).catch(error=>log('chain',error)).then(readMissions);
  // The loop: a heartbeat and the snapshot every two seconds, Tracker every minute or on a poke, until the window
  // has not renewed its lease for ten minutes, a stop is asked, or another watcher owns the lock. It ends within
  // one cycle of any of these, plus the waits for the mutex when it is busy (bounded in tries, nominally about
  // five seconds for the heartbeat and half a second for the removal of the lock, not a wall-clock deadline): the
  // reads still in flight are left to answer into the void, and a lock not removed in time is stale 15 s later.
  async function run({cycles=Infinity}={}) {
    await mkdir(dir,{recursive:true});
    // The reads of a previous run of this object answer first, into the void: they never publish in this one.
    await settle();
    const startedAt=new Date(now()).toISOString();
    ending=false;
    await acquire(startedAt);
    let trackerAt=-Infinity,count=0,ours=true;
    while(count<cycles) {
      count++;
      if(fatal)break;
      const beat=await heartbeat(startedAt);
      if(beat===false){ours=false;ending=true;break;}
      if(await exists('stop')){await rm(file('stop'),{force:true});ending=true;break;}
      if((await leaseAge())>LEASE_MS){ending=true;break;}
      if(!snapshotRead)snapshotRead=readSnapshot().finally(()=>{snapshotRead=null;});
      if(!chainRun&&count%CHAIN_EVERY===0)chainRun=runChain().finally(()=>{chainRun=null;});
      const poked=await exists('poke');
      if(!trackerRead&&(poked||now()-trackerAt>=TICKET_MS)){
        if(poked)await rm(file('poke'),{force:true});
        trackerAt=now();
        trackerRead=readTracker(poked).finally(()=>{trackerRead=null;});
      }
      if(count<cycles)await sleep(HEARTBEAT_MS);
    }
    if(!ending)await settle();
    // The lock is removed by its owner only, under the mutex: a process that took it over keeps it.
    if(ours&&!fatal)await busyIsFalse(withMutex(dir,pid,async()=>{if(await owned())await rm(file('watcher.json'),{force:true});},{tries:MUTEX_TRIES/10}));
    if(fatal)throw fatal;
    return {cycles:count,owned:ours};
  }
  return {run,settle,publish,readSnapshot,readTracker};
}

// Starts the watcher as a process of its own, detached from the caller, unless one already runs. Two callers
// reading the same old state may both start one: the second exits at once, refused by the lock.
export function createWatchActions({root,spawnProcess=spawn,runner=fileURLToPath(new URL('./watch-run.mjs',import.meta.url)),env=process.env,now=Date.now}) {
  async function start() {
    await mkdir(stateDir(root),{recursive:true});
    const status=await watcherStatus(root,now());
    if(status.running)return {started:false,pid:status.pid};
    await writeAtomic(join(stateDir(root),'lease'),new Date(now()).toISOString()+'\n');
    const child=spawnProcess(process.execPath,[runner],{detached:true,stdio:'ignore',env:{...env,FABRIQUE_CONSOLE_HOME:root}});
    child.unref?.();
    return {started:true,pid:child.pid??null};
  }
  async function status() {return watcherStatus(root,now());}
  // Asks the running watcher to read Tracker again now (the Actualiser buttons).
  async function poke() {await mkdir(stateDir(root),{recursive:true});await writeAtomic(join(stateDir(root),'poke'),new Date().toISOString()+'\n');return {poked:true};}
  return {start,status,poke};
}
