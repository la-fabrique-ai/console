#!/usr/bin/env node
// The common validator of a trial: whether the process that runs it is really confined by the sandbox of the trial
// launcher (scripts/trial.mjs). Called by the launcher itself, by a child of `hc exec` (a child of the core of the
// trial) and by a login shell of `hc run`; the CLI and the engine run it whole before any action (checkConfined).
//
// Every refusal the launcher announces is required, whatever the spec asks: writes (outside the folder, /private/tmp,
// through a link), the real home and its keychains, the local network (TCP and UDP to listeners of the launcher, the
// socket of the DNS resolver, a socket outside the folder), a signal to a process outside the sandbox, the keychain
// services, the creation of a launchd job, the programs security, launchctl, osascript and open. A spec adds (the
// real agents the launcher found, other paths of the home), never takes away.
//
// A forbidden probe counts as refused only when the system says so: EPERM or EACCES from the call, a bootstrap
// lookup "not privileged" (1100), or the sandbox of the process saying it denies the operation (sandbox_check). Any other failure (a connection refused, a missing file, a delay, a signal) is
// ambiguous, and an ambiguous probe, a missing one or a witness refused makes the report not confined. Witnesses are
// what a trial must still be able to do (write, read and listen in its folder, start a program, reach an allowed
// service): a sandbox that refuses everything proves nothing.
//
// The probes that would start something real if the process were not confined (a connection to the remote address, a
// program of the system, an agent, a lookup of the keychain service) run last, and only when every harmless probe before them was refused: outside the
// sandbox they are skipped, never run. The others do nothing real outside it: a read, a connection to a listener of
// the launcher, a write in a folder of the launcher, removed at once, a signal 0 to a witness process of the launcher. No remote address but a documentation one
// (192.0.2.1), no name looked up.
//
// Node built-ins only: the launcher copies this file into the folder of the trial, which is all a trial can read.
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { connect, createServer } from 'node:net';
import { createSocket } from 'node:dgram';
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REFUSED=new Set(['EPERM','EACCES']),NOT_PRIVILEGED=1100,WAIT=2500;
// The minimum of every report, which no spec can lower.
export const SYSTEM_EXECS=['/usr/bin/security','/bin/launchctl','/usr/bin/osascript','/usr/bin/open'];
export const DENIED_SERVICES=['com.apple.SecurityServer','com.apple.securityd','com.apple.securityd.xpc','com.apple.security.agent','com.apple.coreservices.launchservicesd'];
export const PYTHON='/usr/bin/python3';
// The remote address of the minimum, a documentation one (RFC 5737): never a spec's.
export const REMOTE=Object.freeze({host:'192.0.2.1',port:443});
const unique=list=>[...new Set(list.filter(item=>typeof item==='string'&&item))];
const homeOf=spec=>typeof spec?.realHome==='string'&&spec.realHome.startsWith('/')&&spec.realHome.length>1?spec.realHome:null;
// The spec as the validator runs it: the minimum, then what the spec adds.
export function requiredSpec(spec) {
  const home=homeOf(spec);
  return {...(spec??{}),
    reads:unique([...(home?[home,join(home,'Library','Keychains')]:[]),...(Array.isArray(spec?.reads)?spec.reads:[])]),
    execs:unique([...SYSTEM_EXECS,...(Array.isArray(spec?.execs)?spec.execs:[])]),
    services:unique([...DENIED_SERVICES,...(Array.isArray(spec?.services)?spec.services:[])]).filter(name=>/^[A-Za-z0-9._-]+$/.test(name)),
    python:PYTHON,remote:REMOTE,canary:spec?.canary&&typeof spec.canary==='object'?spec.canary:{}};
}
// What a probe saw, as a word: refused (by the system), allowed, or ambiguous.
export function outcomeOf(seen) {
  if(!seen||typeof seen!=='object')return 'ambiguous';
  if(typeof seen.kr==='number')return seen.kr===NOT_PRIVILEGED?'refused':seen.kr===0?'allowed':'ambiguous';
  // What the sandbox of the process says of one of its operations (sandbox_check): 1 denied, 0 allowed.
  if(typeof seen.denied==='number')return seen.denied===1?'refused':seen.denied===0?'allowed':'ambiguous';
  if(typeof seen.error==='string')return REFUSED.has(seen.error)?'refused':'ambiguous';
  return seen.done===true?'allowed':'ambiguous';
}

// The probes a spec asks for, in the order they run: the harmless ones, the witnesses, then those that would start
// something real.
export function expectedProbes(given) {
  const spec=requiredSpec(given),list=[],add=(name,kind,late=false)=>list.push({name,kind,late});
  // Without its real home a spec proves nothing of it: a probe that never runs, so never confined.
  if(!homeOf(given))add('read-home:(no real home in the spec)','forbidden');
  add('write-outside','forbidden');add('write-tmp','forbidden');add('write-link','forbidden');
  for(const path of spec.reads)add('read-home:'+path,'forbidden');
  add('tcp-loopback','forbidden');add('udp-loopback','forbidden');add('dns-socket','forbidden');add('unix-outside','forbidden');
  add('signal-outside','forbidden');
  add('write-inside','witness');add('read-inside','witness');add('unix-inside','witness');add('exec-inside','witness');
  // A packet to the remote address leaves the machine if the process is not confined: late, like a program.
  add('tcp-remote','forbidden',true);
  add('mach-witness','witness',true);
  for(const path of spec.execs)add('exec:'+path,'forbidden',true);
  for(const name of spec.services)add('mach:'+name,'forbidden',true);
  add('launchd-job','forbidden',true);
  return list;
}

// Whether a report proves the confinement asked by its spec: every probe there, forbidden ones refused, witnesses
// allowed. Anything else, a missing report included, is not confined, with the reasons.
export function verdictOf(report,spec) {
  if(!report||typeof report!=='object'||!Array.isArray(report.probes))return {confined:false,reasons:['no report']};
  const reasons=[],by=new Map(report.probes.map(p=>[p?.name,p]));
  const expected=expectedProbes(spec);
  if(!expected.length)reasons.push('no probe expected');
  for(const {name,kind} of expected) {
    const probe=by.get(name);
    if(!probe)reasons.push(name+': missing');
    else if(kind==='forbidden'&&probe.outcome!=='refused')reasons.push(`${name}: ${probe.outcome}${probe.why?' ('+probe.why+')':''}`);
    else if(kind==='witness'&&probe.outcome!=='allowed')reasons.push(`${name}: ${probe.outcome}${probe.why?' ('+probe.why+')':''}, a witness must be allowed`);
  }
  return {confined:reasons.length===0,reasons};
}

// What a probe saw, in a word, for the reasons of a report.
const detailOf=seen=>seen?.error??(seen?.timeout?'TIMEOUT':seen?.kr!==undefined?'kr '+seen.kr:seen?.denied!==undefined?'sandbox_check '+seen.denied:seen?.exit!==undefined||seen?.signal?'exit '+(seen.exit??seen.signal):null);
const token=()=>process.pid+'-'+randomBytes(6).toString('hex');
const attempt=fn=>{try{fn();return {done:true};}catch(error){return {error:String(error?.code??'UNKNOWN')};}};
const waitFor=(start,ms=WAIT,onTimeout=()=>{})=>new Promise(resolve=>{let settled=false;const done=value=>{if(!settled){settled=true;clearTimeout(timer);resolve(value);}};const timer=setTimeout(()=>{onTimeout();done({timeout:true});},ms);start(done);});
// A connection that does not answer in time is dropped at once: nothing of it keeps the validator alive.
const stream=target=>{let socket=null;return waitFor(done=>{socket=connect(target);socket.once('connect',()=>{socket.destroy();done({done:true});});socket.once('error',error=>done({error:String(error.code??'UNKNOWN')}));},WAIT,()=>{try{socket?.destroy();}catch{}});};
const datagram=(port,host)=>waitFor(done=>{let socket;try{socket=createSocket('udp4');}catch(error){done({error:String(error.code??'UNKNOWN')});return;}socket.once('error',error=>{try{socket.close();}catch{}done({error:String(error.code??'UNKNOWN')});});socket.send('fabrique-console-trial-probe',port,host,error=>{try{socket.close();}catch{}done(error?{error:String(error.code??'UNKNOWN')}:{done:true});});});
// A program started and waited for: refused when the system refuses to start it.
const started=(file,args)=>waitFor(done=>{let child;try{child=spawn(file,args,{stdio:'ignore'});}catch(error){done({error:String(error.code??'UNKNOWN')});return;}child.once('error',error=>done({error:String(error.code??'UNKNOWN')}));child.once('exit',(code,signal)=>done(code===0?{done:true}:{exit:code,signal}));},5000);
// Arguments that do nothing on their own, should a program start after all.
const HARMLESS={security:['help'],launchctl:['version'],osascript:['-e','return'],open:['-R','/nonexistent-fabrique-console-trial-probe']};
// The bootstrap lookups of services, through Python and ctypes: each name and the kernel return of its lookup.
const LOOKUP=`import ctypes,sys
lib=ctypes.CDLL('/usr/lib/libSystem.B.dylib')
port=ctypes.c_uint.in_dll(lib,'bootstrap_port')
look=lib.bootstrap_look_up;look.argtypes=[ctypes.c_uint,ctypes.c_char_p,ctypes.POINTER(ctypes.c_uint)];look.restype=ctypes.c_int
for name in sys.argv[1:]:
  out=ctypes.c_uint(0);print(name,look(port.value,name.encode(),ctypes.byref(out)))
# Whether the sandbox of this process (the one of its parent) denies the creation of a launchd job: a question asked
# of the kernel, which creates nothing.
import os
check=lib.sandbox_check;check.restype=ctypes.c_int;check.argtypes=[ctypes.c_int,ctypes.c_char_p,ctypes.c_int]
print('@job-creation',check(os.getpid(),b'job-creation',0))`;
function lookups(python,names) {
  return waitFor(done=>{
    let child,out='';try{child=spawn(python,['-I','-c',LOOKUP,...names],{stdio:['ignore','pipe','ignore']});}catch(error){done({error:String(error.code??'UNKNOWN')});return;}
    child.stdout.on('data',d=>{out+=d;});child.once('error',error=>done({error:String(error.code??'UNKNOWN')}));
    child.once('exit',()=>{const seen={};for(const line of out.split('\n')){const [name,kr]=line.trim().split(' ');if(name&&/^-?\d+$/.test(kr??''))seen[name]=Number(kr);}done({seen});});
  },8000);
}

// Runs every probe of the spec. `place` names who runs it (launcher, exec, run, …).
export async function validate(given,place) {
  const spec=requiredSpec(given),probes=[],note=(name,kind,seen)=>probes.push({name,kind,outcome:outcomeOf(seen),...(detailOf(seen)?{why:detailOf(seen)}:{})});
  const folder=spec.folder,canary=spec.canary??{},mine=join(folder,'probes',place+'-'+token());
  mkdirSync(mine,{recursive:true});
  // Writes: in a folder of the launcher outside the trial, in /private/tmp, through a link of the trial leading out.
  const outside=join(canary.outside??'/nonexistent-fabrique-console-trial',`${place}-${token()}`);
  note('write-outside','forbidden',attempt(()=>{writeFileSync(outside,'',{flag:'wx'});unlinkSync(outside);}));
  const tmp=`/private/tmp/fabrique-console-trial-probe-${token()}`;
  note('write-tmp','forbidden',attempt(()=>{writeFileSync(tmp,'',{flag:'wx'});unlinkSync(tmp);}));
  const link=join(mine,'out');
  note('write-link','forbidden',attempt(()=>{symlinkSync(canary.outside??'/nonexistent-fabrique-console-trial',link);const through=join(link,`${place}-link-${token()}`);writeFileSync(through,'',{flag:'wx'});unlinkSync(through);}));
  // Reads of the real home, by paths captured before HOME was replaced.
  for(const path of spec.reads)note('read-home:'+path,'forbidden',attempt(()=>{const info=statSync(path);if(info.isDirectory())readdirSync(path);else readFileSync(path).subarray(0,1);}));
  // The network: loopback (TCP and UDP to listeners of the launcher), the socket of the DNS resolver, a socket of the
  // launcher outside the folder; the remote address comes last, with the probes that would do something real.
  note('tcp-loopback','forbidden',canary.tcp?await stream({host:'127.0.0.1',port:canary.tcp.port}):{error:'NO_CANARY'});
  note('udp-loopback','forbidden',canary.udp?await datagram(canary.udp.port,'127.0.0.1'):{error:'NO_CANARY'});
  note('dns-socket','forbidden',await stream('/var/run/mDNSResponder'));
  note('unix-outside','forbidden',canary.unix?await stream(canary.unix):{error:'NO_CANARY'});
  // A signal to a witness process of the launcher, outside the sandbox: signal 0, which changes nothing even when
  // allowed. Refused only by EPERM; a process gone (ESRCH) is ambiguous.
  note('signal-outside','forbidden',Number.isInteger(canary.signal)&&canary.signal>1?attempt(()=>process.kill(canary.signal,0)):{error:'NO_CANARY'});
  // Witnesses: what the trial must still do.
  const file=join(mine,'witness');
  note('write-inside','witness',attempt(()=>writeFileSync(file,place)));
  note('read-inside','witness',attempt(()=>{if(readFileSync(file,'utf8')!==place)throw Object.assign(new Error('read back'),{code:'MISMATCH'});}));
  const sock=join(mine,'w.sock'),server=createServer(s=>s.destroy());
  note('unix-inside','witness',await waitFor(done=>{server.once('error',error=>done({error:String(error.code??'UNKNOWN')}));server.listen(sock,()=>stream(sock).then(done));}));
  try{server.close();}catch{}
  note('exec-inside','witness',await started('/usr/bin/true',[]));
  // Last, and only once every harmless probe proved the sandbox: what would start something real without it.
  const proven=probes.every(p=>p.kind==='witness'?p.outcome==='allowed':p.outcome==='refused');
  const late=expectedProbes(spec).filter(p=>p.late);
  if(!proven)for(const p of late)probes.push({name:p.name,kind:p.kind,outcome:'skipped'});
  else {
    note('tcp-remote','forbidden',await stream({host:REMOTE.host,port:REMOTE.port}));
    const services=[spec.witnessService??'com.apple.system.notification_center',...spec.services];
    const looked=await lookups(spec.python,services);
    const kr=name=>looked?.seen&&name in looked.seen?{kr:looked.seen[name]}:looked?.error?{error:looked.error}:{};
    note('mach-witness','witness',kr(services[0]));
    for(const path of spec.execs)note('exec:'+path,'forbidden',await started(path,HARMLESS[path.split('/').pop()]??['--version']));
    for(const name of spec.services)note('mach:'+name,'forbidden',kr(name));
    note('launchd-job','forbidden',looked?.seen&&'@job-creation' in looked.seen?{denied:looked.seen['@job-creation']}:looked?.error?{error:looked.error}:{});
  }
  try{rmSync(mine,{recursive:true,force:true});}catch{}
  const {confined,reasons}=verdictOf({probes},given);
  return {version:1,place,pid:process.pid,ppid:process.ppid,at:new Date().toISOString(),probes,confined,reasons};
}

// The whole validator, for the CLI and the engine, before any action: run in a child process (the same sandbox, if
// any) with the real home of the account, whatever the spec or HOME say. The verdict is computed here, never taken from
// the report. Outside the sandbox the harmless probes go through and the others never run: not confined.
// The spec is the one the launcher wrote beside the copy of Mission Control this file is part of
// (<folder>/mc/src/trial-validator.mjs, so <folder>/spec.json), which the trial cannot change, and which names that
// folder and this very file. No variable, no argument chooses another one; whatever it says, the minimum stays
// required: a spec can only add probes.
export const launcherSpecPath=()=>join(dirname(dirname(dirname(fileURLToPath(import.meta.url)))),'spec.json');
export function checkConfined({realHome,place='check',node=process.execPath}) {
  const path=launcherSpecPath(),folder=dirname(path),self=fileURLToPath(import.meta.url);
  let spec;
  try{spec=JSON.parse(readFileSync(path,'utf8'));}catch{return {confined:false,reasons:['no spec of the launcher beside this copy of Mission Control']};}
  if(!spec||typeof spec!=='object'||Array.isArray(spec))return {confined:false,reasons:['the spec of the launcher is not an object']};
  if(spec.folder!==folder||spec.validator!==self)return {confined:false,reasons:['the spec beside this copy of Mission Control names another folder or another validator']};
  spec={...spec,realHome};
  const dir=join(folder,'reports'),id=`${place}-${token()}`,specPath=join(dir,id+'.spec.json'),out=join(dir,id+'.json');
  try{mkdirSync(dir,{recursive:true});writeFileSync(specPath,JSON.stringify(spec));}catch(error){return {confined:false,reasons:['the folder of the trial cannot be written: '+String(error?.code??error)]};}
  spawnSync(node,[self,specPath,out,place],{stdio:'ignore',timeout:180000});
  let report=null;try{report=JSON.parse(readFileSync(out,'utf8'));}catch{}
  for(const file of [specPath,out])try{rmSync(file,{force:true});}catch{}
  return verdictOf(report,spec);
}

// node trial-validator.mjs <spec.json> <report.json> <place>: the report is written in the folder of the trial.
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]) {
  const [specPath,out,place='child']=process.argv.slice(2);
  let report;
  try{report=await validate(JSON.parse(readFileSync(specPath,'utf8')),place);}
  catch(error){report={version:1,place,pid:process.pid,ppid:process.ppid,probes:[],confined:false,reasons:['the validator failed: '+String(error?.code??error?.message??error)]};}
  try{writeFileSync(out,JSON.stringify(report,null,1)+'\n');}catch{process.exitCode=2;}
  if(!process.exitCode)process.exitCode=report.confined?0:1;
  // Done once the report is written: no probe left pending may keep this process alive.
  process.exit();
}
