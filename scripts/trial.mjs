#!/usr/bin/env node
// The single launcher of a trial (decision 62 b): node scripts/trial.mjs <folder> -- <command> [arguments…]
//
// It runs the command, a herdr-core of the trial and everything they start in one macOS sandbox
// (src/trial-sandbox.mjs), and only once the common validator (src/trial-validator.mjs) has proven the sandbox in
// three places: in the launcher itself, in a child of `hc exec` (a child of the core of the trial) and in a login shell
// of `hc run`. Any doubt is TRIAL_NOT_CONFINED and the command never runs: a missing, ambiguous or late report, a core
// already answering on the session of the trial, a core that is not the one started, a core gone or replaced during
// the command, a sandbox that cannot be applied. No variable skips any of this, and there is no unprotected path.
//
// Outside (this process, as the person runs it): the folder is checked or made, the real paths are captured before
// HOME is replaced, the code of Mission Control is copied into the folder (the real home is unreadable inside),
// listeners are opened outside the folder as witnesses that nothing reaches them, and the launcher runs itself again
// inside: env -i <environment of the trial> sandbox-exec -f <profile> node <copy>/scripts/trial.mjs --inside …
// Inside: the validator, the core of the trial (`herdr-core serve`, in the foreground, a child of this confined
// process, started the direct way, never through launchd), the two other validators, then the command; at the end
// the core is stopped. The outcome is <folder>/result.json.
//
// Signals: outside, the launcher signals only the child it started itself, and only while that child is not reaped
// (its number, and the number of the process group it leads, cannot be given to another process meanwhile): SIGTERM,
// then SIGKILL to that group. It never signals a number it checked apart, nor a number read from the folder of the
// trial. The rest of the trial is stopped from inside the sandbox, by the launcher confined in it: there the kernel
// refuses, at the moment of the signal, any signal to a process outside this very sandbox, so a number given meanwhile
// to another process cannot be reached. Outside, the launcher then only looks (sandboxIdentity): anything of the
// trial still there, or a look it cannot be sure of, is a failure (TRIAL_CLEANUP_FAILED, code 4), and the folder stays
// reserved, with the numbers left and the identity of the sandbox to recognise them.
//
// One launch at a time on a folder: the launcher reserves it (a folder of its own beside it, made at once or not at
// all, outside the reach of the trial) before it changes anything, and gives it back at the end. A folder already
// reserved is refused (TRIAL_BUSY) without a change, even when its launcher is gone: a reservation is never taken over.
import { cpSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync, chmodSync, accessSync, constants } from 'node:fs';
import { createServer } from 'node:net';
import { createSocket } from 'node:dgram';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { randomBytes } from 'node:crypto';
import { userInfo } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { trialOf, journal, resolvedPath, TRIAL_FILE } from '../src/trial.mjs';
import { validate, verdictOf } from '../src/trial-validator.mjs';
import { readExceptions, sandboxProfile, SYSTEM_EXECS, DENIED_SERVICES } from '../src/trial-sandbox.mjs';

const run=promisify(execFile);
const REPO=resolve(dirname(fileURLToPath(import.meta.url)),'..');
// What a trial needs of Mission Control: its code, never its documents or local data.
const COPIED=['package.json','src','integrations','scripts','ui','roles','tests','node_modules'];
const NOT_CONFINED='TRIAL_NOT_CONFINED',CLEANUP_FAILED='TRIAL_CLEANUP_FAILED',SOCKET_MAX=103,WAIT_CORE_MS=15000,WAIT_PROBE_MS=90000,STOP_GRACE_MS=20000,LEFT_WAIT_MS=3000;
const say=message=>{try{process.stderr.write('FABRIQUE_CONSOLE trial: '+message+'\n');}catch{}};
class Refusal extends Error{constructor(code,message){super(message);this.code=code;}}
const refuse=(code,message)=>{throw new Refusal(code,message);};

// The decision of the launcher, from what the three validators and the core said.
export function confinementOf({reports,corePid,statusPid,spec,verdict=verdictOf}) {
  for(const place of ['launcher','exec','run']) {
    const seen=verdict(reports?.[place],spec);
    if(!seen.confined)return {confined:false,reason:`the validator of ${place}: ${seen.reasons?.join('; ')||'no report'}`};
  }
  if(!Number.isInteger(corePid))return {confined:false,reason:'no core of the trial'};
  if(statusPid!==corePid)return {confined:false,reason:`the core that answers (${statusPid??'none'}) is not the core started (${corePid})`};
  if(reports.exec.ppid!==corePid)return {confined:false,reason:`the child of hc exec (parent ${reports.exec.ppid}) is not a child of the core of the trial (${corePid})`};
  return {confined:true,reason:null};
}

// ---- Outside.

// Which processes run in the sandbox of this launch, asked of the kernel (sandbox_check), never of the trial: the
// profile denies the read of one file of the launcher (mine) and not of another (control), both outside the folder of
// the trial, both existing. A process of this sandbox is denied the first and allowed the second; a process outside
// any sandbox is allowed both, one of another sandbox is denied both or allowed both. A missing file reads as denied
// for everyone, so both must exist and a process outside any sandbox must be allowed both, or the look fails.
// It only looks: it signals nothing. Outside (mode outside) the helper itself is that unconfined process; inside
// (mode inside) the helper must be of this sandbox, and the reference is the launcher outside (a pid given).
const IDENTITY=`import ctypes,json,os,platform,struct,sys
lib=ctypes.CDLL('/usr/lib/libSystem.B.dylib');check=lib.sandbox_check;check.restype=ctypes.c_int
# sandbox_check is variadic: on arm64 the path goes on the stack, after the eight registers.
pad=5 if platform.machine()=='arm64' else 0
check.argtypes=[ctypes.c_int,ctypes.c_char_p,ctypes.c_int]+[ctypes.c_long]*pad+[ctypes.c_char_p]
denied=lambda pid,path:check(pid,b'file-read-data',1,*([0]*pad),path.encode())
mine,control,mode=sys.argv[1],sys.argv[2],sys.argv[3]
me=os.getpid()
def fail(why):print(json.dumps({'error':why}));sys.exit(2)
if mode=='outside':
  if not(os.path.isfile(mine) and os.path.isfile(control)):fail('the files of the identity are gone')
  if denied(me,mine)!=0 or denied(me,control)!=0:fail('the identity check does not answer for an unconfined process')
else:
  ref=int(sys.argv[4])
  if denied(me,mine)!=1 or denied(me,control)!=0:fail('this process is not in the sandbox of this launch')
  if denied(ref,mine)!=0 or denied(ref,control)!=0:fail('the identity check does not answer for the launcher outside')
# The processes of the account (proc_listallpids, proc_pidinfo), without a program: ps cannot start in the sandbox.
count=lib.proc_listallpids(None,0)
if count<=0:fail('the processes cannot be listed')
pids=(ctypes.c_int*(count+256))();got=lib.proc_listallpids(pids,ctypes.sizeof(pids))
if got<=0:fail('the processes cannot be listed')
info=ctypes.create_string_buffer(256)
def uid(pid):return struct.unpack_from('I',info.raw,20)[0] if lib.proc_pidinfo(pid,3,ctypes.c_uint64(0),info,136)==136 else None
found=sorted(pid for pid in pids[:got] if pid>1 and pid!=me and uid(pid)==os.getuid() and denied(pid,mine)==1 and denied(pid,control)==0)
print(json.dumps({'pids':found}))`;
async function sandboxIdentity(identity,mode,reference=null) {
  try{const out=JSON.parse((await run('/usr/bin/python3',['-I','-c',IDENTITY,identity.mine,identity.control,mode,...(reference?[String(reference)]:[])],{encoding:'utf8',timeout:30000})).stdout);return out.error||!Array.isArray(out.pids)?{error:out.error??'the identity check gave no list',pids:null}:{pids:out.pids};}
  catch(error){let said=null;try{said=JSON.parse(error.stdout).error;}catch{}return {error:said??'the identity check failed',pids:null};}
}

// The reservation of a folder: <parent>/.<name>.fabrique-console-trial-lock, made by mkdir, which only one launcher can win.
export const reservationOf=folder=>join(dirname(folder),'.'+basename(folder)+'.fabrique-console-trial-lock');
function reserve(folder) {
  const path=reservationOf(folder);
  try{mkdirSync(path,{mode:0o700});}
  catch(error) {
    if(error.code!=='EEXIST')refuse('TRIAL_INVALID',`The folder of the trial cannot be reserved (${error.code}).`);
    let owner=null,left=null;try{owner=JSON.parse(readFileSync(join(path,'owner.json'),'utf8'));}catch{}try{left=JSON.parse(readFileSync(join(path,'left.json'),'utf8'));}catch{}
    if(left)refuse('TRIAL_BUSY',`The folder of the trial stays reserved: its last trial left ${Array.isArray(left.pids)?'processes '+left.pids.join(', '):'processes the launcher could not count'} (${left.reason}), nothing was changed. Stop them, then remove ${path}.`);
    refuse('TRIAL_BUSY',`The folder of the trial is reserved by another launch${Number.isInteger(owner?.pid)?` (launcher ${owner.pid}, since ${owner.at})`:''}: one trial at a time on a folder, nothing was changed. If no launcher runs on it any more, remove ${path}.`);
  }
  writeFileSync(join(path,'owner.json'),JSON.stringify({pid:process.pid,at:new Date().toISOString(),folder})+'\n');
  // Kept, with what was left, when the end of a trial is not sure: what it holds is how to recognise those processes.
  const hold={keep:false};
  return {path,hold,release(){if(!hold.keep)rmSync(path,{recursive:true,force:true});}};
}
const holderSocket=(folder,session)=>`${folder}/s/herdr-core/${session}/${session}.holder.00000000.sock`;
const executable=path=>{try{accessSync(path,constants.X_OK);return statSync(path).isFile();}catch{return false;}};
const script=(path,body)=>{writeFileSync(path,'#!/bin/sh\n'+body+'\n');chmodSync(path,0o755);};
// A new folder of a trial: fake agents, a fake herdr-app (no window), a state folder with its trial.json and tracker.
function makeFolder(folder,{hc}) {
  mkdirSync(folder,{mode:0o700});
  for(const dir of ['agents','state','worktrees','app'])mkdirSync(join(folder,dir),{recursive:true});
  for(const name of ['claude','codex'])script(join(folder,'agents',name),`echo "fabrique-console trial: fake ${name} $*"\nsleep "\${FABRIQUE_CONSOLE_TRIAL_AGENT_SECONDS:-1}"`);
  script(join(folder,'agents','herdr-app'),`printf '%s\\n' "$*" >> "$FABRIQUE_CONSOLE_HOME/herdr-app.log"\necho '{}'`);
  const trial={version:1,folder,agents:{claude:join(folder,'agents','claude'),codex:join(folder,'agents','codex')},worktreesRoot:join(folder,'worktrees'),hcSession:'tr'+randomBytes(3).toString('hex'),herdrAppHome:join(folder,'app'),hc,herdrApp:join(folder,'agents','herdr-app')};
  writeFileSync(join(folder,'state',TRIAL_FILE),JSON.stringify(trial,null,2)+'\n');
  writeFileSync(join(folder,'state','tracker.json'),JSON.stringify({viewer:{id:'u-trial',name:'Trial'},teams:[{id:'team-demo',key:'DEMO',name:'Demo'}],projects:[],states:[{id:'st-backlog',name:'Backlog',type:'backlog',team:{id:'team-demo'}},{id:'st-progress',name:'In Progress',type:'started',team:{id:'team-demo'}}],issues:[{id:'iss-demo-1',identifier:'DEMO-1',title:'Trial issue',description:'Nothing real.',url:'https://example.invalid/DEMO-1',branchName:'demo-1',team:{id:'team-demo'},project:null,state:{id:'st-progress',name:'In Progress',type:'started'},assignee:{id:'u-trial'},labels:[],comments:[],createdAt:'2026-11-14T08:00:00.000Z',updatedAt:'2026-11-14T08:00:00.000Z'}]},null,2)+'\n');
  writeFileSync(join(folder,'state','config.json'),JSON.stringify({version:1,tracker:{transport:'graphql'},projects:[]},null,2)+'\n');
}
// Listeners outside the folder: a trial must never reach them.
async function openCanaries(parent) {
  const dir=mkdtempSync(join(parent,'.fabrique-console-canary-')),hits={tcp:0,udp:0,unix:0};
  const outside=join(dir,'w');mkdirSync(outside);
  const tcp=createServer(s=>{hits.tcp++;s.destroy();});await new Promise(r=>tcp.listen(0,'127.0.0.1',r));
  const unix=createServer(s=>{hits.unix++;s.destroy();});await new Promise(r=>unix.listen(join(dir,'c.sock'),r));
  const udp=createSocket('udp4');udp.on('message',()=>{hits.udp++;});await new Promise(r=>udp.bind(0,'127.0.0.1',r));
  // A witness process, a child of this launcher outside the sandbox: the trial must never be able to signal it.
  const witness=spawn('/bin/sleep',['86400'],{stdio:'ignore'});let closing=false;
  await new Promise((resolve,reject)=>{witness.once('spawn',resolve);witness.once('error',reject);});
  witness.once('exit',()=>{if(!closing)hits.signal=(hits.signal??0)+1;});
  return {dir,hits,outside,spec:{tcp:{port:tcp.address().port},udp:{port:udp.address().port},unix:join(dir,'c.sock'),outside,signal:witness.pid},
    close(){closing=true;try{witness.kill('SIGKILL');}catch{}try{tcp.close();unix.close();udp.close();}catch{}rmSync(dir,{recursive:true,force:true});}};
}
// The environment of everything a trial runs: nothing of the caller's but the locale and the terminal.
function trialEnvironment(folder,trial,node) {
  const home=join(folder,'home');
  for(const dir of [home,join(home,'tmp'),join(folder,'s')])mkdirSync(dir,{recursive:true,mode:0o700});
  const agentDirs=[...new Set(Object.values(trial.agents).map(dirname))];
  return {PATH:[...agentDirs,dirname(node),'/usr/bin','/bin','/usr/sbin','/sbin'].join(':'),HOME:home,TMPDIR:join(home,'tmp'),SHELL:'/bin/zsh',
    USER:userInfo().username,LOGNAME:userInfo().username,LANG:process.env.LANG||'en_US.UTF-8',TERM:process.env.TERM||'xterm-256color',
    XDG_CONFIG_HOME:join(home,'.config'),XDG_CACHE_HOME:join(home,'.cache'),XDG_DATA_HOME:join(home,'.local','share'),XDG_STATE_HOME:join(folder,'s'),XDG_RUNTIME_DIR:join(folder,'s'),
    HC_SESSION:trial.hcSession,FABRIQUE_CONSOLE_MC_TRIAL:'1',FABRIQUE_CONSOLE_HOME:join(folder,'state'),HERDR_APP_HOME:trial.herdrAppHome,
    GIT_CONFIG_NOSYSTEM:'1',GIT_TERMINAL_PROMPT:'0',GIT_AUTHOR_NAME:'FABRIQUE_CONSOLE trial',GIT_AUTHOR_EMAIL:'trial@example.invalid',GIT_COMMITTER_NAME:'FABRIQUE_CONSOLE trial',GIT_COMMITTER_EMAIL:'trial@example.invalid'};
}
// The paths of the real home a trial must not read, captured before HOME is replaced: those that exist.
const SENSITIVE=['Library/Keychains','.ssh','.config','.local','.aws','.netrc','.npmrc','.git-credentials','.codex','.claude','.config/gh','.config/herdr-app','.config/fabrique-console','Developer/worktrees'];
const realReads=realHome=>[realHome,...SENSITIVE.map(p=>join(realHome,p)).filter(p=>existsSync(p))];

async function outside(folderArg,command) {
  const realHome=userInfo().homedir;
  if(!folderArg||!isAbsolute(folderArg))refuse('TRIAL_INVALID','The folder of the trial must be an absolute path.');
  if(!command.length)refuse('TRIAL_INVALID','Usage: node scripts/trial.mjs <folder> -- <command> [arguments…]');
  const folder=resolvedPath(folderArg);
  for(const home of new Set([realHome,process.env.HOME].filter(Boolean).map(resolvedPath)))
    if(folder===home||folder.startsWith(home+'/')||home.startsWith(folder+'/'))refuse('TRIAL_INVALID','The folder of a trial is never in a home (the trial cannot read the home), nor above one.');
  if(holderSocket(folder,'x'.repeat(8)).length>SOCKET_MAX)refuse('TRIAL_INVALID',`The folder of the trial is too long for the sockets of its core (${SOCKET_MAX} characters): take a short folder, such as /private/tmp/essai-1.`);
  if(!existsSync(dirname(folder)))refuse('TRIAL_INVALID','The parent of the folder of the trial does not exist.');
  const node=realpathSync(process.execPath);
  // Nothing of the folder changes before it is reserved for this launch alone.
  const reservation=reserve(folder);
  // The identity of the sandbox of this launch: two files in the reservation, outside the folder, which the trial can
  // neither change nor remove, apart from the witnesses (removing these does not stop the cleanup).
  const nonce=randomBytes(12).toString('hex'),identity={mine:join(reservation.path,'id-'+nonce),control:join(reservation.path,'control-'+nonce)};
  writeFileSync(identity.mine,'');writeFileSync(identity.control,'');
  try{return await reserved(folder,command,{realHome,node,identity,reservation});}
  finally{reservation.release();}
}
async function reserved(folder,command,{realHome,node,identity,reservation}) {
  if(!existsSync(folder))makeFolder(folder,{hc:realpathSync(join(realHome,'.local','bin','hc'))});
  else if(!existsSync(join(folder,'state',TRIAL_FILE)))refuse('TRIAL_INVALID',`An existing folder of a trial holds state/${TRIAL_FILE}; this one does not.`);
  // The trial as Mission Control reads it (its cross refusals), from outside, with the PATH of the caller: the real
  // agents are found where they are.
  let trial;try{trial=trialOf({root:join(folder,'state'),env:{FABRIQUE_CONSOLE_MC_TRIAL:'1',PATH:process.env.PATH??''},home:realHome});}catch(error){refuse(error.code??'TRIAL_INVALID',error.message);}
  if(resolvedPath(trial.folder)!==folder)refuse('TRIAL_INVALID',`${TRIAL_FILE}: folder must be the folder given to the launcher.`);
  if(holderSocket(folder,trial.hcSession).length>SOCKET_MAX)refuse('TRIAL_INVALID',`The session of the core (${trial.hcSession}) is too long for this folder.`);
  if(realpathSync(trial.hc)!==trial.hc)refuse('TRIAL_INVALID',`${TRIAL_FILE}: hc must name the binary of Herdr Core by its real path (${realpathSync(trial.hc)}), never by a link of the home.`);
  if(!executable('/usr/bin/python3'))refuse(NOT_CONFINED,'Without /usr/bin/python3 the refusal of the keychain services cannot be established.');
  // A core that answers already on the session of the trial (left by an earlier launch): refused before any change.
  if(existsSync(join(folder,'s','herdr-core',trial.hcSession+'.sock'))) {
    const reason='a core already answers on the session of the trial: never use it';
    writeFileSync(join(folder,'result.json'),JSON.stringify({version:1,session:trial.hcSession,confined:false,code:NOT_CONFINED,reason},null,1)+'\n');
    say(`refused (${NOT_CONFINED}). ${reason}`);return 3;
  }
  // The code of Mission Control, copied: the copy is what runs inside.
  const mc=join(folder,'mc');rmSync(mc,{recursive:true,force:true});mkdirSync(mc);
  for(const entry of COPIED)if(existsSync(join(REPO,entry)))cpSync(join(REPO,entry),join(mc,entry),{recursive:true,verbatimSymlinks:true,mode:constants.COPYFILE_FICLONE});
  for(const stale of ['result.json','reports','probes','core.log'])rmSync(join(folder,stale),{recursive:true,force:true});
  const canaries=await openCanaries(dirname(folder));
  try {
    const execs=[...new Set([...SYSTEM_EXECS,...trial.realAgents])];
    const spec={version:1,folder,realHome,reads:realReads(realHome),execs,canary:canaries.spec,remote:{host:'192.0.2.1',port:443},python:'/usr/bin/python3',services:DENIED_SERVICES,node,validator:join(mc,'src','trial-validator.mjs'),hc:trial.hc,session:trial.hcSession,identity};
    writeFileSync(join(folder,'spec.json'),JSON.stringify(spec,null,1)+'\n');
    writeFileSync(join(folder,'profile.sb'),sandboxProfile({folder,realHome,exceptions:readExceptions({realHome,node,hc:trial.hc}),execs,identity:identity.mine,protect:[join(folder,'spec.json'),join(folder,'profile.sb')]}));
    const env=trialEnvironment(folder,trial,node);
    // From here the end is sure only once nothing of the trial is left: until then the reservation is kept.
    reservation.hold.keep=true;
    // env execs sandbox-exec, which execs node: one process, the leader of a process group of its own (detached).
    const child=spawn('/usr/bin/env',['-i',...Object.entries(env).map(([k,v])=>k+'='+v),'/usr/bin/sandbox-exec','-f',join(folder,'profile.sb'),node,join(mc,'scripts','trial.mjs'),'--inside',folder,'--',...command],{stdio:'inherit',detached:true});
    // Only the child this launcher started, and only while it is not reaped: Node reaps it and sets exitCode or
    // signalCode in one step of this thread, so while both are null its number, and the group it leads, are still its.
    // SIGTERM first, so that it stops its command, its core and the rest of the sandbox itself; SIGKILL to its group if
    // it is still there after a while.
    // The witnesses gone (their folder removed) count as reached: never a reason for the launcher to stop half-way.
    let breach=null,ending=null;
    const unreaped=()=>child.exitCode===null&&child.signalCode===null;
    const end=()=>{if(ending)return;if(unreaped())try{child.kill('SIGTERM');}catch{}ending=setTimeout(()=>{if(unreaped())try{process.kill(-child.pid,'SIGKILL');}catch{}},STOP_GRACE_MS);};
    const written=()=>{try{return readdirSync(canaries.outside);}catch{return null;}};
    const watch=setInterval(()=>{const left=written();if(canaries.hits.tcp||canaries.hits.udp||canaries.hits.unix||canaries.hits.signal||!left||left.length){breach??=left?'a listener or the witness process outside the folder was reached':'the witnesses of the launcher outside the folder are gone';end();}},200);
    process.on('SIGINT',end);process.on('SIGTERM',end);
    const code=await new Promise(r=>{child.once('error',()=>r(null));child.once('exit',c=>r(c));});
    clearInterval(watch);clearTimeout(ending);
    // What the trial left running was stopped inside; outside, the launcher only looks, before the result is read.
    const cleanup=await leftovers(identity);
    let result=null;try{result=JSON.parse(readFileSync(join(folder,'result.json'),'utf8'));}catch{}
    const outsideLeft=written(),{signal:signalled=0,...hits}=canaries.hits,canary={...hits,outside:outsideLeft??'gone'};
    if(signalled)canary.signal=signalled;
    if(!outsideLeft)breach??='the witnesses of the launcher outside the folder are gone';
    if(breach||canary.tcp||canary.udp||canary.unix||signalled||outsideLeft.length)result={...(result??{}),confined:false,code:NOT_CONFINED,reason:breach??'a listener or the witness process outside the folder was reached'};
    if(!result)result={version:1,confined:false,code:NOT_CONFINED,reason:`the sandbox of the trial gave no result (exit ${code}): it could not be applied, or stopped early`};
    result={...result,canary,cleanup};
    // Anything of the trial still running, or a look the launcher cannot be sure of: a failure, whatever the trial
    // said, and the folder stays reserved with what is left.
    if(cleanup.error||cleanup.left.length) {
      const reason=cleanup.error?`the end of the trial is not sure: ${cleanup.error}`:`processes of the trial are still running: ${cleanup.left.join(', ')}`;
      result={...result,confined:false,code:CLEANUP_FAILED,reason};
      writeFileSync(join(folder,'result.json'),JSON.stringify(result,null,1)+'\n');
      writeFileSync(join(reservation.path,'left.json'),JSON.stringify({pids:cleanup.left??null,reason,at:new Date().toISOString(),identity},null,1)+'\n');
      say(`failed (${CLEANUP_FAILED}). ${reason}. The folder stays reserved (${reservation.path}): stop what is left, then remove it.`);
      return 4;
    }
    reservation.hold.keep=false;
    writeFileSync(join(folder,'result.json'),JSON.stringify(result,null,1)+'\n');
    if(!result.confined){say(`refused (${NOT_CONFINED}). ${result.reason}`);return 3;}
    return result.exitCode??1;
  }finally{canaries.close();}
}
// What is left of the trial once its launcher inside is gone, looked at, never signalled: a process being stopped
// may take a moment to go, so the look is repeated for a while before anything counts as left.
async function leftovers(identity) {
  let seen=null;
  for(let at=Date.now();;) {
    seen=await sandboxIdentity(identity,'outside');
    if(seen.error)return {left:null,error:seen.error};
    if(!seen.pids.length||Date.now()-at>LEFT_WAIT_MS)return {left:seen.pids};
    await new Promise(r=>setTimeout(r,200));
  }
}

// ---- Inside the sandbox.

async function inside(folder,command) {
  const spec=JSON.parse(readFileSync(join(folder,'spec.json'),'utf8'));
  const trial=trialOf({root:join(folder,'state')}),reports={},result={version:1,session:trial.hcSession,confined:false,code:NOT_CONFINED,reason:null,exitCode:null,corePid:null,statusPid:null,reports};
  const write=()=>writeFileSync(join(folder,'result.json'),JSON.stringify(result,null,1)+'\n');
  const hc=(args,options={})=>run(spec.hc,args,{encoding:'utf8',timeout:WAIT_PROBE_MS,maxBuffer:4*1024*1024,...options});
  const readReport=place=>{try{return JSON.parse(readFileSync(join(folder,'reports',place+'.json'),'utf8'));}catch{return null;}};
  let core=null,coreGone=false,stopped=null,running=null;
  // Asked to stop (by the launcher outside, or Ctrl-C): the command is stopped, then, as at any end, the core.
  const stopAsked=signal=>{stopped??=`the trial was stopped (${signal})`;if(running)try{process.kill(-running.pid,'SIGKILL');}catch{}};
  process.on('SIGTERM',()=>stopAsked('SIGTERM'));process.on('SIGINT',()=>stopAsked('SIGINT'));
  // The rest of the sandbox, stopped from inside it: every process the identity shows in this sandbox is sent SIGKILL.
  // The kernel refuses, at the moment of the signal, a signal to a process outside this sandbox, so a number given
  // meanwhile to another process is never reached; the look only spares useless attempts. Only once the validator
  // of this very process proved the sandbox, and a signal 0 to the launcher outside is refused here.
  const sweep=async()=>{
    if(!reports.launcher||!verdictOf(reports.launcher,spec).confined)return {killed:[],error:'the sandbox of the launcher was not proved: nothing signalled'};
    try{process.kill(process.ppid,0);return {killed:[],error:'a signal out of the sandbox is not refused: nothing signalled'};}
    catch(error){if(error.code!=='EPERM')return {killed:[],error:`a signal out of the sandbox is not refused (${error.code}): nothing signalled`};}
    const killed=[];
    for(let turn=0;turn<20;turn++) {
      const {pids,error}=await sandboxIdentity(spec.identity,'inside',process.ppid);
      if(error)return {killed,error};
      let hit=0;
      for(const pid of pids){if(pid===process.pid)continue;try{process.kill(pid,'SIGKILL');hit++;if(!killed.includes(pid))killed.push(pid);}catch{}}
      if(!hit)break;
      await new Promise(r=>setTimeout(r,100));
    }
    return {killed};
  };
  const stopCore=async()=>{
    if(!core||coreGone)return;
    try{await hc(['server','stop','--json'],{timeout:15000});}catch{}
    for(let i=0;i<100&&!coreGone;i++)await new Promise(r=>setTimeout(r,100));
    if(!coreGone)try{core.kill('SIGKILL');}catch{}
  };
  try {
    mkdirSync(join(folder,'reports'),{recursive:true});
    // 1. The launcher itself.
    reports.launcher=await validate(spec,'launcher');
    writeFileSync(join(folder,'reports','launcher.json'),JSON.stringify(reports.launcher,null,1)+'\n');
    if(!verdictOf(reports.launcher,spec).confined)refuse(NOT_CONFINED,'the validator of the launcher: '+verdictOf(reports.launcher,spec).reasons.join('; '));
    // 2. The core of the trial: none may answer yet on its session; then its own, a child of this process.
    const socket=join(folder,'s','herdr-core',trial.hcSession+'.sock');
    if(existsSync(socket))refuse(NOT_CONFINED,'a core already answers on the session of the trial: never use it');
    const log=openSync(join(folder,'core.log'),'a');
    // The direct start of herdr-core (the one it takes for an SSH start), never a launchd job.
    core=spawn(spec.hc,['serve'],{env:{...process.env,SSH_CONNECTION:'fabrique-console-trial 0 fabrique-console-trial 0'},stdio:['ignore',log,log]});
    core.once('exit',()=>{coreGone=true;});
    result.corePid=core.pid??null;
    for(let at=Date.now();!existsSync(socket);){if(coreGone)refuse(NOT_CONFINED,'the core of the trial stopped at start');if(Date.now()-at>WAIT_CORE_MS)refuse(NOT_CONFINED,'the core of the trial did not answer in time');await new Promise(r=>setTimeout(r,100));}
    const statusOf=async()=>{try{return JSON.parse((await hc(['server','status','--json'],{timeout:15000})).stdout).pid??null;}catch{return null;}};
    result.statusPid=await statusOf();
    if(result.statusPid!==result.corePid)refuse(NOT_CONFINED,`the core that answers (${result.statusPid??'none'}) is not the core started (${result.corePid})`);
    // 3. A child of the core, by hc exec; 4. a login shell of a terminal of the core, by hc run.
    try{await hc(['exec','--timeout','60','--cwd',folder,'--',spec.node,spec.validator,join(folder,'spec.json'),join(folder,'reports','exec.json'),'exec']);}catch{}
    reports.exec=readReport('exec');
    try{await hc(['run','--name','fabrique-console-trial-probe','--cwd',folder,'--','/bin/zsh','-l','-c','exec "$@"','zsh',spec.node,spec.validator,join(folder,'spec.json'),join(folder,'reports','run.json'),'run']);}catch{}
    reports.run=readReport('run');
    const decision=confinementOf({reports,corePid:result.corePid,statusPid:result.statusPid,spec});
    if(!decision.confined)refuse(NOT_CONFINED,decision.reason);
    if(coreGone)refuse(NOT_CONFINED,'the core of the trial stopped during the checks');
    if(stopped)refuse(NOT_CONFINED,stopped);
    journal(trial,{kind:'confined',corePid:result.corePid,session:trial.hcSession,places:['launcher','exec','run']});
    // 5. The command, in the same sandbox; the core watched while it runs.
    const child=running=spawn(command[0],command.slice(1),{stdio:'inherit',cwd:folder,env:process.env,detached:true});
    let lost=null;
    core.once('exit',()=>{lost='the core of the trial stopped during the command';try{process.kill(-child.pid,'SIGKILL');}catch{}});
    result.exitCode=await new Promise(r=>{child.once('error',()=>r(127));child.once('exit',(code,signal)=>r(code??(signal?128:1)));});
    if(lost)refuse(NOT_CONFINED,lost);
    if(stopped)refuse(NOT_CONFINED,stopped);
    const after=await statusOf();
    if(after!==result.corePid)refuse(NOT_CONFINED,`the core changed during the command (${after??'none'} instead of ${result.corePid})`);
    result.confined=true;result.code=null;
    journal(trial,{kind:'trial-end',exitCode:result.exitCode,corePid:result.corePid});
  }catch(error) {
    result.confined=false;result.code=NOT_CONFINED;result.reason=error instanceof Refusal?error.message:'the launcher failed inside the sandbox: '+String(error?.message??error);
    journal(trial,{kind:'not-confined',reason:result.reason});
  }finally {
    await stopCore();
    try{result.sweep=await sweep();}catch(error){result.sweep={killed:[],error:String(error?.message??error)};}
    write();
  }
  return result.confined?result.exitCode:3;
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const args=process.argv.slice(2),at=args.indexOf('--'),command=at>=0?args.slice(at+1):[];
  const before=at>=0?args.slice(0,at):args;
  try {
    process.exitCode=before[0]==='--inside'?await inside(before[1],command):await outside(before[0],command);
  }catch(error) {
    say(`refused (${error.code??'TRIAL_INVALID'}). ${error.message}`);
    process.exitCode=error.code===NOT_CONFINED?3:2;
  }
}
