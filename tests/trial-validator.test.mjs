// The common validator of a trial (src/trial-validator.mjs) and the sandbox it checks (src/trial-sandbox.mjs).
// A probe is refused only when the system says so (EPERM, EACCES, a bootstrap lookup not privileged): a failure of
// another kind, a delay or a missing probe is ambiguous, and an ambiguous report is never confined. The controls run
// outside any sandbox and do nothing real: a connection to a listener of the test, a write in a folder of the test.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync, copyFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { createSocket } from 'node:dgram';
import { spawn, spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { userInfo } from 'node:os';
import { fileURLToPath } from 'node:url';
import { outcomeOf, verdictOf, expectedProbes, validate, requiredSpec, checkConfined } from '../src/trial-validator.mjs';
import { readExceptions, sandboxProfile, SYSTEM_EXECS, DENIED_SERVICES } from '../src/trial-sandbox.mjs';

const realHome=userInfo().homedir;
const VALIDATOR=fileURLToPath(new URL('../src/trial-validator.mjs',import.meta.url));
// A folder short enough for Unix sockets, outside the home: what a trial folder is.
const shortFolder=prefix=>realpathSync(mkdtempSync('/private/tmp/'+prefix));

// Listeners that count what reaches them: the proof that a probe refused never arrived.
async function canaries(t) {
  const outer=shortFolder('dvc-');
  t.after(()=>rmSync(outer,{recursive:true,force:true}));
  const hits={tcp:0,udp:0,unix:0};
  const tcp=createServer(s=>{hits.tcp++;s.destroy();});await new Promise(r=>tcp.listen(0,'127.0.0.1',r));
  const unixPath=join(outer,'c.sock'),unix=createServer(s=>{hits.unix++;s.destroy();});await new Promise(r=>unix.listen(unixPath,r));
  const udp=createSocket('udp4');udp.on('message',()=>{hits.udp++;});await new Promise(r=>udp.bind(0,'127.0.0.1',r));
  const outside=join(outer,'w');mkdirSync(outside);
  // A witness process of the test, outside any sandbox: the target of the signal probe (a signal 0 changes nothing).
  const witness=spawn('/bin/sleep',['300'],{stdio:'ignore'});await new Promise(r=>witness.once('spawn',r));
  t.after(()=>{tcp.close();unix.close();udp.close();try{witness.kill('SIGKILL');}catch{}});
  return {hits,outside,witness,canary:{tcp:{port:tcp.address().port},udp:{port:udp.address().port},unix:unixPath,outside,signal:witness.pid}};
}

test('a probe is refused only when the system says so; anything else is ambiguous',()=>{
  assert.equal(outcomeOf({error:'EPERM'}),'refused');
  assert.equal(outcomeOf({error:'EACCES'}),'refused');
  assert.equal(outcomeOf({kr:1100}),'refused','a bootstrap lookup not privileged');
  assert.equal(outcomeOf({done:true}),'allowed');
  assert.equal(outcomeOf({kr:0}),'allowed');
  assert.equal(outcomeOf({denied:1}),'refused','the sandbox of the process denies the operation');
  assert.equal(outcomeOf({denied:0}),'allowed');
  assert.equal(outcomeOf({denied:-1}),'ambiguous');
  for(const seen of [{error:'ECONNREFUSED'},{error:'ENOENT'},{error:'ETIMEDOUT'},{timeout:true},{kr:1102},{},null,undefined,{signal:'SIGKILL'}])
    assert.equal(outcomeOf(seen),'ambiguous',JSON.stringify(seen));
});

test('a report is confined only when every expected probe is there, forbidden ones refused and witnesses allowed',()=>{
  const spec={folder:'/private/tmp/x',realHome:'/Users/a',reads:['/Users/a','/Users/a/.ssh'],execs:['/usr/bin/security'],canary:{tcp:{port:1},udp:{port:2},unix:'/private/tmp/c.sock',outside:'/private/tmp/w'},remote:null,python:'/usr/bin/python3',services:['com.apple.SecurityServer']};
  const names=expectedProbes(spec);
  for(const name of ['write-outside','write-tmp','write-link','read-home:/Users/a','read-home:/Users/a/.ssh','tcp-loopback','udp-loopback','dns-socket','unix-outside','exec:/usr/bin/security','mach:com.apple.SecurityServer','write-inside','read-inside','unix-inside','exec-inside','mach-witness'])
    assert.ok(names.some(n=>n.name===name),name);
  const good=names.map(n=>({name:n.name,kind:n.kind,outcome:n.kind==='forbidden'?'refused':'allowed'}));
  assert.equal(verdictOf({probes:good},spec).confined,true);
  // One forbidden probe allowed, one ambiguous, a witness refused, one missing, no report at all: never confined.
  const change=(name,outcome)=>good.map(p=>p.name===name?{...p,outcome}:p);
  assert.equal(verdictOf({probes:change('tcp-loopback','allowed')},spec).confined,false);
  assert.equal(verdictOf({probes:change('read-home:/Users/a','ambiguous')},spec).confined,false);
  assert.equal(verdictOf({probes:change('write-inside','refused')},spec).confined,false,'a sandbox that refuses everything proves nothing');
  assert.equal(verdictOf({probes:change('exec:/usr/bin/security','skipped')},spec).confined,false);
  assert.equal(verdictOf({probes:good.filter(p=>p.name!=='dns-socket')},spec).confined,false);
  assert.match(verdictOf({probes:good.filter(p=>p.name!=='dns-socket')},spec).reasons.join(' '),/dns-socket/);
  for(const report of [null,undefined,{},{probes:'x'},{probes:[]}])assert.equal(verdictOf(report,spec).confined,false);
});

test('the read exceptions of decision 63 are the programs a trial needs, each justified, nothing else of the home',()=>{
  const node=realpathSync(process.execPath),list=readExceptions({realHome,node,hc:join(realHome,'.local','share','herdr-core','active','Herdr Core.app','Contents','MacOS','herdr-core')});
  for(const entry of list){assert.ok(entry.path.startsWith(realHome+'/'),entry.path);assert.ok(['literal','subpath'].includes(entry.scope));assert.ok(entry.why.length>20,entry.path);}
  // Node: its binary only, not its folder; Herdr Core: its application bundle (the binary, its signature, its resources).
  if(node.startsWith(realHome+'/'))assert.deepEqual(list.find(e=>e.what==='node'),{what:'node',path:node,scope:'literal',why:list.find(e=>e.what==='node').why});
  assert.equal(list.find(e=>e.what==='hc').scope,'subpath');assert.match(list.find(e=>e.what==='hc').path,/Herdr Core\.app$/);
  // A program outside the home needs no exception (Git is /usr/bin/git).
  assert.equal(readExceptions({realHome,node:'/usr/local/bin/node',hc:'/opt/hc/herdr-core'}).length,0);
  // An exception is never the home, a folder of secrets, or a folder above a program.
  assert.throws(()=>readExceptions({realHome,node:realHome,hc:'/opt/hc'}),/home/);
});

test('the profile refuses the network, writes out of the folder, the real home, the keychain and the system programs that escape',()=>{
  const folder='/private/tmp/dvt-x',node=join(realHome,'.n','bin','node');
  const profile=sandboxProfile({folder,realHome,exceptions:[{what:'node',path:node,scope:'literal',why:'x'}],execs:[...SYSTEM_EXECS,join(realHome,'.local','bin','codex')]});
  assert.match(profile,/^\(version 1\)/);
  assert.match(profile,/\(deny network\*\)/);
  assert.match(profile,new RegExp(`\\(allow network\\* \\(local unix-socket \\(subpath "${folder}"\\)\\) \\(remote unix-socket \\(subpath "${folder}"\\)\\)\\)`));
  assert.match(profile,/\(deny file-write\*\)/);
  assert.match(profile,new RegExp(`\\(deny file-read\\* \\(subpath "${realHome}"\\)\\)`));
  assert.ok(profile.indexOf(`(literal "${node}")`)>profile.indexOf(`(deny file-read* (subpath "${realHome}"))`),'an exception comes after the refusal of the home');
  for(const path of ['/usr/bin/security','/bin/launchctl','/usr/bin/osascript','/usr/bin/open',join(realHome,'.local','bin','codex')])assert.ok(profile.includes(`(literal "${path}")`),path);
  for(const name of DENIED_SERVICES)assert.ok(profile.includes(name),name);
  assert.match(profile,/\(deny appleevent-send\)/);assert.match(profile,/\(deny lsopen\)/);
  // A path the profile cannot quote is refused.
  assert.throws(()=>sandboxProfile({folder:'/private/tmp/a"b',realHome,exceptions:[],execs:[]}),/quote/);
});

test('the control: outside a sandbox, the validator sees the probes go through, and says not confined',async t=>{
  const {hits,outside,canary}=await canaries(t),folder=shortFolder('dvt-');
  t.after(()=>rmSync(folder,{recursive:true,force:true}));
  // Nothing real: a read of the home, connections to the listeners of the test, a write in its folder. No program of
  // the system, no remote address, no lookup.
  const spec={version:1,folder,realHome,reads:[realHome],execs:[],canary,remote:null,python:null,services:[]};
  const report=await validate(spec,'control');
  const by=name=>report.probes.find(p=>p.name===name)?.outcome;
  assert.equal(report.confined,false);
  assert.equal(by('read-home:'+realHome),'allowed');assert.equal(by('write-outside'),'allowed');assert.equal(by('tcp-loopback'),'allowed');assert.equal(by('unix-outside'),'allowed');
  assert.equal(by('write-inside'),'allowed');assert.equal(by('unix-inside'),'allowed');
  assert.ok(hits.tcp>=1&&hits.unix>=1,'the probes did reach the listeners');
  assert.equal(readdirSync(outside).length,0,'the probe removes what it wrote');
  // The remote probe is required even with remote:null, and never sent from outside a sandbox (nothing leaves).
  assert.equal(by('tcp-remote'),'skipped');
});

test('in the sandbox of a trial, the validator sees every forbidden probe refused and every witness allowed',async t=>{
  const {hits,outside,canary}=await canaries(t),folder=shortFolder('dvt-');
  t.after(()=>rmSync(folder,{recursive:true,force:true}));
  const node=realpathSync(process.execPath),hc=join(realHome,'.local','share','herdr-core','active','Herdr Core.app','Contents','MacOS','herdr-core');
  const exceptions=readExceptions({realHome,node,hc}),agents=['claude','codex'].map(n=>join(realHome,'.local','bin',n));
  writeFileSync(join(folder,'profile.sb'),sandboxProfile({folder,realHome,exceptions,execs:[...SYSTEM_EXECS,...agents]}));
  copyFileSync(VALIDATOR,join(folder,'validator.mjs'));
  const reads=[realHome,join(realHome,'Library','Keychains'),join(realHome,'.config'),join(realHome,'.local','bin','codex')];
  const spec={version:1,folder,realHome,reads,execs:[...SYSTEM_EXECS,...agents],canary,remote:{host:'192.0.2.1',port:443},python:'/usr/bin/python3',services:DENIED_SERVICES};
  writeFileSync(join(folder,'spec.json'),JSON.stringify(spec));
  const child=spawn('/usr/bin/env',['-i','PATH=/usr/bin:/bin',`HOME=${folder}`,`TMPDIR=${folder}`,'/usr/bin/sandbox-exec','-f',join(folder,'profile.sb'),node,join(folder,'validator.mjs'),join(folder,'spec.json'),join(folder,'report.json'),'sandbox'],{stdio:'ignore'});
  assert.equal(await new Promise(r=>child.on('exit',r)),0);
  const report=JSON.parse(readFileSync(join(folder,'report.json'),'utf8'));
  assert.deepEqual(report.probes.filter(p=>p.kind==='forbidden'&&p.outcome!=='refused'),[]);
  assert.deepEqual(report.probes.filter(p=>p.kind==='witness'&&p.outcome!=='allowed'),[]);
  assert.equal(report.confined,true,JSON.stringify(report.reasons));
  assert.equal(verdictOf(report,spec).confined,true);
  assert.deepEqual(hits,{tcp:0,udp:0,unix:0},'nothing reached the listeners');
  assert.equal(readdirSync(outside).length,0,'nothing was written outside the folder');
  for(const name of ['signal-outside','launchd-job'])assert.equal(report.probes.find(p=>p.name===name)?.outcome,'refused',name);
});

// ---- Every refusal announced, at every level: a spec cannot ask for less, a profile cannot give less.

test('the minimum: whatever the spec asks, every announced refusal is expected, and three refusals are never enough',()=>{
  const realHome='/Users/a',names=expectedProbes({realHome}).map(p=>p.name);
  for(const name of ['write-outside','write-tmp','write-link','read-home:/Users/a','read-home:/Users/a/Library/Keychains','tcp-loopback','dns-socket','signal-outside','launchd-job',
    'exec:/usr/bin/security','exec:/bin/launchctl','exec:/usr/bin/osascript','exec:/usr/bin/open','mach:com.apple.SecurityServer','mach:com.apple.securityd','mach:com.apple.coreservices.launchservicesd','mach-witness'])
    assert.ok(names.includes(name),name);
  // The real agents the launcher found are added, never in place of the minimum.
  assert.ok(expectedProbes({realHome,execs:['/opt/x/codex']}).some(p=>p.name==='exec:/opt/x/codex'));
  // A spec without its real home cannot pass, even with a report where everything was refused.
  assert.equal(verdictOf({probes:expectedProbes({realHome}).map(p=>({name:p.name,kind:p.kind,outcome:p.kind==='forbidden'?'refused':'allowed'}))},{}).confined,false);
  // The simulation of the review: /private/tmp, the home and the DNS socket refused, nothing else.
  const three=[{name:'write-tmp',kind:'forbidden',outcome:'refused'},{name:'read-home:/Users/a',kind:'forbidden',outcome:'refused'},{name:'dns-socket',kind:'forbidden',outcome:'refused'}];
  const seen=verdictOf({probes:three},{realHome,reads:[],execs:[],services:[]});
  assert.equal(seen.confined,false);
  for(const name of ['tcp-loopback','signal-outside','launchd-job','exec:/bin/launchctl','mach:com.apple.SecurityServer','exec:/usr/bin/osascript'])assert.match(seen.reasons.join(' '),new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
});

// The profile of a trial with one kind of refusal taken out, in a real sandbox: the validator must say not confined.
// The real agents are left out of these specs: a profile that lets programs start must never start one.
test('a profile missing any announced refusal is not confined: writes, home, network, signals, launchd, keychain, programs',async t=>{
  const {canary}=await canaries(t),node=realpathSync(process.execPath);
  const hc=join(realHome,'.local','share','herdr-core','active','Herdr Core.app','Contents','MacOS','herdr-core');
  const missing={
    write:{line:/^\(deny file-write\*\)$/,reason:/write-tmp|write-outside/},
    home:{line:/^\(deny file-read\* \(subpath /,reason:/read-home/},
    network:{line:/^\(deny network\*\)$/,reason:/tcp-loopback/},
    signal:{line:/^\(deny signal\)$/,reason:/signal-outside/},
    // A sandbox denies job creation unless told otherwise: the profile that gives launchd up is the one that allows it.
    launchd:{line:/^\(deny job-creation\)$/,replace:'(allow job-creation)',reason:/launchd-job/},
    keychain:{line:/^\(deny mach-lookup /,reason:/mach:com\.apple\.SecurityServer/},
    programs:{line:/^\(deny process-exec /,reason:/exec:\/usr\/bin\/(security|osascript|open)|exec:\/bin\/launchctl/},
  };
  for(const [kind,{line,reason,replace=null}] of Object.entries(missing)) {
    const folder=shortFolder('dvt-');t.after(()=>rmSync(folder,{recursive:true,force:true}));
    const full=sandboxProfile({folder,realHome,exceptions:readExceptions({realHome,node,hc}),execs:SYSTEM_EXECS}).split('\n');
    assert.equal(full.filter(l=>line.test(l)).length,1,kind+': the line to take out is in the full profile');
    const kept=full.flatMap(l=>line.test(l)?(replace?[replace]:[]):[l]);
    writeFileSync(join(folder,'profile.sb'),kept.join('\n'));
    copyFileSync(VALIDATOR,join(folder,'validator.mjs'));
    const spec={version:1,folder,realHome,reads:[realHome],execs:SYSTEM_EXECS,canary,remote:null,services:DENIED_SERVICES};
    writeFileSync(join(folder,'spec.json'),JSON.stringify(spec));
    const child=spawn('/usr/bin/env',['-i','PATH=/usr/bin:/bin',`HOME=${folder}`,`TMPDIR=${folder}`,'/usr/bin/sandbox-exec','-f',join(folder,'profile.sb'),node,join(folder,'validator.mjs'),join(folder,'spec.json'),join(folder,'report.json'),kind],{stdio:'ignore'});
    await new Promise(r=>child.on('exit',r));
    const report=JSON.parse(readFileSync(join(folder,'report.json'),'utf8')),verdict=verdictOf(report,spec);
    assert.equal(verdict.confined,false,kind);assert.equal(report.confined,false,kind);
    assert.match(verdict.reasons.join(' '),reason,kind+': '+verdict.reasons.join('; '));
  }
});

// launchd: a job submitted straight through liblaunch and libxpc (not launchctl, which the profile forbids) from the
// sandbox of a trial is refused by launchd itself, and no job exists afterwards. The job would only run /usr/bin/true.
const SUBMIT=`import ctypes,sys
L=ctypes.CDLL('/usr/lib/libSystem.B.dylib');P=ctypes.c_void_p
for n,a,r in [('launch_data_alloc',[ctypes.c_int],P),('launch_data_new_string',[ctypes.c_char_p],P),('launch_data_dict_insert',[P,P,ctypes.c_char_p],ctypes.c_bool),('launch_data_array_set_index',[P,P,ctypes.c_size_t],ctypes.c_bool),('launch_msg',[P],P),('launch_data_get_type',[P],ctypes.c_int),('launch_data_get_errno',[P],ctypes.c_int)]:
  f=getattr(L,n);f.argtypes=a;f.restype=r
job=L.launch_data_alloc(1);L.launch_data_dict_insert(job,L.launch_data_new_string(sys.argv[1].encode()),b"Label")
args=L.launch_data_alloc(2);L.launch_data_array_set_index(args,L.launch_data_new_string(b"/usr/bin/true"),0);L.launch_data_dict_insert(job,args,b"ProgramArguments")
msg=L.launch_data_alloc(1);L.launch_data_dict_insert(msg,job,b"SubmitJob")
r=L.launch_msg(msg)
print('null' if not r else ('errno %d'%L.launch_data_get_errno(r) if L.launch_data_get_type(r)==9 else 'type %d'%L.launch_data_get_type(r)))`;
test('launchd: a direct submission from the sandbox of a trial is refused, no job is left',async t=>{
  const folder=shortFolder('dvt-');t.after(()=>rmSync(folder,{recursive:true,force:true}));
  const node=realpathSync(process.execPath),hc=join(realHome,'.local','share','herdr-core','active','Herdr Core.app','Contents','MacOS','herdr-core');
  writeFileSync(join(folder,'profile.sb'),sandboxProfile({folder,realHome,exceptions:readExceptions({realHome,node,hc}),execs:SYSTEM_EXECS}));
  writeFileSync(join(folder,'submit.py'),SUBMIT);
  const label='fabrique-console.trial.probe.'+process.pid+'.'+Date.now();
  t.after(()=>spawnSync('/bin/launchctl',['remove',label],{stdio:'ignore'}));
  const run=spawnSync('/usr/bin/sandbox-exec',['-f',join(folder,'profile.sb'),'/usr/bin/python3','-I',join(folder,'submit.py'),label],{encoding:'utf8'});
  assert.equal(run.stdout.trim(),'errno 1',run.stderr);
  assert.notEqual(spawnSync('/bin/launchctl',['print',`gui/${process.getuid()}/${label}`],{stdio:'ignore'}).status,0,'a job was created');
  // The profile also says it: the operation of launchd that creates a job is denied (what the validator reads).
  assert.match(readFileSync(join(folder,'profile.sb'),'utf8'),/^\(deny job-creation\)$/m);
});

// ---- Review 2, point 4: the refusal of the remote network, and all the minimum, whatever the spec; no variable picks
// the spec.

test('the minimum: the remote refusal is required whatever the spec says of it, to the address of the minimum',()=>{
  const realHome='/Users/a';
  for(const remote of [null,undefined,false,{},{host:'127.0.0.1',port:1}]) {
    const spec={realHome,remote};
    assert.ok(expectedProbes(spec).some(p=>p.name==='tcp-remote'),JSON.stringify(remote));
    assert.deepEqual(requiredSpec(spec).remote,{host:'192.0.2.1',port:443},JSON.stringify(remote));
    // A report where every other probe is right but the remote one is missing: never confined.
    const report={probes:expectedProbes(spec).filter(p=>p.name!=='tcp-remote').map(p=>({name:p.name,kind:p.kind,outcome:p.kind==='forbidden'?'refused':'allowed'}))};
    const seen=verdictOf(report,spec);
    assert.equal(seen.confined,false,JSON.stringify(remote));assert.match(seen.reasons.join(' '),/tcp-remote: missing/);
  }
});

test('no variable picks the spec of the whole validator: FABRIQUE_CONSOLE_MC_TRIAL_SPEC is ignored',async t=>{
  const folder=shortFolder('dvt-');t.after(()=>rmSync(folder,{recursive:true,force:true}));
  // A spec that asks for little, and a "node" that would write a report where everything it asks is right.
  writeFileSync(join(folder,'light.json'),JSON.stringify({version:1,folder,realHome,remote:null,canary:{}}));
  const used=join(folder,'used.txt'),fake=join(folder,'node');
  writeFileSync(fake,`#!/bin/sh\necho "$1" >> ${JSON.stringify(used)}\n`,{mode:0o755});
  const saved=process.env.FABRIQUE_CONSOLE_MC_TRIAL_SPEC;process.env.FABRIQUE_CONSOLE_MC_TRIAL_SPEC=join(folder,'light.json');
  t.after(()=>{if(saved===undefined)delete process.env.FABRIQUE_CONSOLE_MC_TRIAL_SPEC;else process.env.FABRIQUE_CONSOLE_MC_TRIAL_SPEC=saved;});
  const seen=checkConfined({folder,realHome,place:'review',node:fake});
  assert.equal(seen.confined,false);
  assert.match(seen.reasons.join(' '),/no spec of the launcher/);
  assert.equal(existsSync(used),false,'the validator ran on the spec named by the variable');
  assert.ok(!readFileSync(VALIDATOR,'utf8').includes('process.env'),'the validator reads a variable');
});
