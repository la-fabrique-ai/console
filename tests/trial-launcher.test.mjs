// The single launcher of a trial (scripts/trial.mjs): the CLI, a herdr-core of its own and everything they start run in
// one macOS sandbox, checked by the common validator in the launcher, in a child of `hc exec` and in a login shell of
// `hc run`, before any command runs. Any doubt (no report, an ambiguous one, a core already there or replaced, a
// sandbox that cannot be applied) is TRIAL_NOT_CONFINED: the command never runs. These tests start real trials: their
// folders are short folders of /private/tmp, removed afterwards; they never reach the core or the Herdr in service.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { spawn, spawnSync } from 'node:child_process';
import { basename, dirname, join } from 'node:path';
import { userInfo } from 'node:os';
import { fileURLToPath } from 'node:url';
import { confinementOf, reservationOf } from '../scripts/trial.mjs';
import { createBackend } from '../src/backend.mjs';

const LAUNCHER=fileURLToPath(new URL('../scripts/trial.mjs',import.meta.url)),CLI=fileURLToPath(new URL('../src/cli.mjs',import.meta.url));
const realHome=userInfo().homedir;
const newFolder=t=>{const parent=realpathSync(mkdtempSync('/private/tmp/dvt-'));t.after(()=>rmSync(parent,{recursive:true,force:true}));return join(parent,'e');};
// The launcher, as a person runs it; its environment is the caller's (the launcher clears it for the trial).
function launch(folder,command,{wrap=[],env=process.env}={}) {
  return new Promise(resolve=>{
    const child=spawn(wrap[0]??process.execPath,[...wrap.slice(1),...(wrap.length?[process.execPath]:[]),LAUNCHER,folder,'--',...command],{env,stdio:['ignore','pipe','pipe']});
    let out='',err='';child.stdout.on('data',d=>{out+=d;});child.stderr.on('data',d=>{err+=d;});
    child.on('exit',code=>{let result=null;try{result=JSON.parse(readFileSync(join(folder,'result.json'),'utf8'));}catch{}resolve({code,out,err,result});});
  });
}
const holders=folder=>spawnSync('/bin/ps',['-axo','command'],{encoding:'utf8'}).stdout.split('\n').filter(line=>line.includes('--socket '+folder));
// The command of a trial that leaves a mark in its folder: it ran, and with which environment.
const marker=folder=>[process.execPath,'-e',`require('fs').writeFileSync(${JSON.stringify(join(folder,'ran.json'))},JSON.stringify({home:process.env.HOME,env:Object.keys(process.env)}))`];

test('a whole trial: confined by the validator in three places, the command run, the core stopped, nothing outside',async t=>{
  const folder=newFolder(t);
  const {code,err,result}=await launch(folder,marker(folder));
  assert.equal(code,0,err);
  assert.equal(result.confined,true,err);
  for(const place of ['launcher','exec','run']){const report=result.reports[place];assert.equal(report.confined,true,place+': '+JSON.stringify(report.reasons));}
  // The child of hc exec is a child of the core of the trial: the core runs in the sandbox, not beside it.
  assert.equal(result.reports.exec.ppid,result.corePid);
  assert.equal(result.statusPid,result.corePid);
  assert.deepEqual(result.canary,{tcp:0,udp:0,unix:0,outside:[]});
  const ran=JSON.parse(readFileSync(join(folder,'ran.json'),'utf8'));
  assert.equal(ran.home,join(folder,'home'));
  // No guard of M17 is left: no preload, no marker that a variable could set.
  assert.ok(!ran.env.includes('NODE_OPTIONS')&&!ran.env.includes('FABRIQUE_CONSOLE_MC_SANDBOXED'),ran.env.join(' '));
  assert.ok(!existsSync(join(folder,'s','herdr-core',result.session+'.sock')),'the socket of the core is gone');
  assert.deepEqual(holders(folder),[],'no holder of the core is left');
  const journal=readFileSync(join(folder,'state','trial-journal.jsonl'),'utf8').split('\n').filter(Boolean).map(l=>JSON.parse(l));
  assert.ok(journal.some(e=>e.kind==='confined'&&e.corePid===result.corePid));
});

test('a core already there on the session of the trial: refused, nothing run',async t=>{
  const folder=newFolder(t);
  // A first run prepares the folder; then something answers where the core of the trial would.
  assert.equal((await launch(folder,['/usr/bin/true'])).code,0);
  const session=JSON.parse(readFileSync(join(folder,'state','trial.json'),'utf8')).hcSession;
  mkdirSync(join(folder,'s','herdr-core'),{recursive:true});
  const squatter=createServer(s=>s.destroy());await new Promise(r=>squatter.listen(join(folder,'s','herdr-core',session+'.sock'),r));
  t.after(()=>squatter.close());
  const {code,result}=await launch(folder,marker(folder));
  assert.notEqual(code,0);
  assert.equal(result.code,'TRIAL_NOT_CONFINED');assert.match(result.reason,/core/);
  assert.equal(existsSync(join(folder,'ran.json')),false,'the command never ran');
});

test('a sandbox that cannot be applied (the launcher already in one): refused, nothing run, no unprotected fallback',async t=>{
  const folder=newFolder(t);
  const {code,result,err}=await launch(folder,marker(folder),{wrap:['/usr/bin/sandbox-exec','-p','(version 1)(allow default)']});
  assert.notEqual(code,0);
  assert.equal(result?.code,'TRIAL_NOT_CONFINED',err);
  assert.equal(existsSync(join(folder,'ran.json')),false);
});

test('no variable lets a trial skip the check: the old marker, a trial variable, set by the caller, change nothing',async t=>{
  const folder=newFolder(t);
  const env={...process.env,FABRIQUE_CONSOLE_MC_SANDBOXED:'1',FABRIQUE_CONSOLE_MC_TRIAL:'1',FABRIQUE_CONSOLE_MC_TRIAL_CONFINED:'1',FABRIQUE_CONSOLE_HOME:join(folder,'state')};
  const {code,result}=await launch(folder,marker(folder),{wrap:['/usr/bin/sandbox-exec','-p','(version 1)(allow default)'],env});
  assert.notEqual(code,0);assert.equal(result?.code,'TRIAL_NOT_CONFINED');
});

test('the CLI and the engine in trial mode, out of the launcher, refuse before any action: TRIAL_NOT_CONFINED',async t=>{
  const folder=newFolder(t);
  assert.equal((await launch(folder,['/usr/bin/true'])).code,0,'a folder prepared by the launcher');
  const root=join(folder,'state'),journal=join(root,'trial-journal.jsonl'),before=readFileSync(journal,'utf8');
  for(const extra of [{},{FABRIQUE_CONSOLE_MC_SANDBOXED:'1'}]) {
    const run=spawnSync(process.execPath,[CLI,'ticket-detail',JSON.stringify({id:'DEMO-1'})],{encoding:'utf8',env:{...process.env,...extra,FABRIQUE_CONSOLE_MC_TRIAL:'1',FABRIQUE_CONSOLE_HOME:root}});
    const envelope=JSON.parse(run.stdout.trim().split('\n').pop());
    assert.equal(run.status,1);assert.equal(envelope.error.code,'TRIAL_NOT_CONFINED',run.stdout);
  }
  assert.throws(()=>createBackend({root,env:{FABRIQUE_CONSOLE_MC_TRIAL:'1'}}),{code:'TRIAL_NOT_CONFINED'});
  // The tracker was never read: the journal says the refusal, nothing else.
  const added=readFileSync(journal,'utf8').slice(before.length).split('\n').filter(Boolean).map(l=>JSON.parse(l));
  assert.ok(added.length>0&&added.every(e=>e.kind==='not-confined'),JSON.stringify(added));
});

test('a folder the launcher cannot protect is refused before anything: in the home, too long for the sockets',async t=>{
  for(const folder of [join(realHome,'fabrique-console-trial-never'),'/private/tmp/'+'x'.repeat(80)]) {
    const {code,err}=await launch(folder,['/usr/bin/true']);
    assert.notEqual(code,0);assert.match(err,/TRIAL_INVALID/);
    assert.equal(existsSync(folder),false,folder);
  }
});

test('the decision of the launcher: every report confined, the exec child a child of the core, the core the one started',()=>{
  const ok={confined:true,probes:[{name:'write-outside',kind:'forbidden',outcome:'refused'}],ppid:40};
  const spec={probes:null};
  const good={reports:{launcher:ok,exec:{...ok,ppid:40},run:ok},corePid:40,statusPid:40,spec,verdict:r=>({confined:r?.confined===true,reasons:[]})};
  assert.equal(confinementOf(good).confined,true);
  for(const [why,change] of [
    ['no report of exec',{reports:{...good.reports,exec:null}}],
    ['no report of run',{reports:{...good.reports,run:undefined}}],
    ['an ambiguous report',{reports:{...good.reports,launcher:{...ok,confined:false}}}],
    ['the exec child is not a child of the core',{reports:{...good.reports,exec:{...ok,ppid:41}}}],
    ['the core that answers is another one',{statusPid:41}],
    ['no core',{corePid:null}],
  ]){const verdict=confinementOf({...good,...change});assert.equal(verdict.confined,false,why);assert.ok(verdict.reason,why);}
});

test('the guards of M17 are gone: no module patching the process, no preload',()=>{
  for(const file of ['../src/trial-guard.mjs','../src/trial-preload.mjs'])assert.equal(existsSync(fileURLToPath(new URL(file,import.meta.url))),false,file);
  const trial=readFileSync(fileURLToPath(new URL('../src/trial.mjs',import.meta.url)),'utf8');
  for(const word of ['trialLaunch','sandbox-exec','NODE_OPTIONS','FABRIQUE_CONSOLE_MC_SANDBOXED','trialSandbox'])assert.ok(!trial.includes(word),word);
});

// ---- The processes a trial may touch: its own only.

const J=JSON.stringify;
// Whether a process is alive, from this test (outside any sandbox): a signal 0 changes nothing.
const alive=pid=>{try{process.kill(pid,0);return true;}catch(error){return error.code==='EPERM';}};
const gone=async(pid,ms=3000)=>{for(const at=Date.now();Date.now()-at<ms;){if(!alive(pid))return true;await new Promise(r=>setTimeout(r,50));}return !alive(pid);};
// A witness of the test, started outside any trial: never 33191, 96862 or a Herdr in service.
async function witness(t,{sandboxed=false}={}) {
  const child=sandboxed?spawn('/usr/bin/sandbox-exec',['-p','(version 1)(allow default)','/bin/sleep','300'],{stdio:'ignore'}):spawn('/bin/sleep',['300'],{stdio:'ignore'});
  await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});
  t.after(()=>{try{child.kill('SIGKILL');}catch{}});
  return child;
}

test('the launcher signals only what it started or proved its own: core.pid rewritten by the trial is never trusted',async t=>{
  // Two witnesses: a process outside any sandbox, and one in a sandbox of its own (not the trial's).
  const folder=newFolder(t),outside=await witness(t),foreign=await witness(t,{sandboxed:true});
  // The command names the witness in core.pid and leaves a detached process of its own, inside the sandbox.
  const script=`const fs=require('fs'),{spawn}=require('child_process');fs.writeFileSync(${J(join(folder,'core.pid'))},'${outside.pid}');`+
    `const o=spawn('/bin/sleep',['300'],{detached:true,stdio:'ignore'});o.unref();fs.writeFileSync(${J(join(folder,'orphan.pid'))},String(o.pid));`;
  const {code,err,result}=await launch(folder,[process.execPath,'-e',script]);
  assert.equal(code,0,err);assert.equal(result.confined,true,err);
  assert.ok(alive(outside.pid)&&outside.exitCode===null&&outside.signalCode===null,'the witness outside the trial was signalled');
  assert.ok(alive(foreign.pid)&&foreign.exitCode===null&&foreign.signalCode===null,'the witness in another sandbox was signalled');
  const orphan=Number(readFileSync(join(folder,'orphan.pid'),'utf8'));
  assert.ok(await gone(orphan),'a process the trial left behind is stopped');
  // Stopped from inside the sandbox, by the launcher confined in it, and the launcher outside saw nothing left.
  assert.ok(result.sweep?.killed?.includes(orphan),JSON.stringify(result.sweep));
  assert.deepEqual(result.cleanup,{left:[]},JSON.stringify(result.cleanup));
});

// ---- Review 2, point 1: no signal to a process number checked apart. Point 2: a cleanup missed or unsure fails.

const SOURCE=readFileSync(LAUNCHER,'utf8');
test('outside, the launcher signals only its own direct child, never a process number it checked apart',()=>{
  const outsidePart=SOURCE.slice(SOURCE.indexOf('// ---- Outside.'),SOURCE.indexOf('// ---- Inside the sandbox.'));
  assert.ok(outsidePart.length>1000,'the outside part of the launcher is found');
  // The identity check only lists: it signals nothing.
  const identity=/const IDENTITY=`([\s\S]*?)`;/.exec(SOURCE)?.[1]??'';
  assert.ok(identity.length>100,'the identity check is found');
  assert.ok(!/kill|signal/.test(identity),'the identity check signals processes');
  // process.kill only to the group led by the child it started; ChildProcess.kill only on what it spawned.
  for(const [,target] of outsidePart.matchAll(/process\.kill\(([^,)]+)/g))assert.equal(target.trim(),'-child.pid','process.kill('+target+')');
  for(const [,owner] of outsidePart.matchAll(/(\w+)\.kill\(/g))assert.ok(['child','witness','process'].includes(owner),owner+'.kill');
});

// A process left by the test inside a trial, stopped by the test at the end (and only if it is that very sleep).
const LEFT_SECONDS='2741';
const stopLeftSleep=pid=>{
  if(!Number.isInteger(pid)||pid<=1)return;
  const command=spawnSync('/bin/ps',['-p',String(pid),'-o','command='],{encoding:'utf8'}).stdout.trim();
  if(command==='/bin/sleep '+LEFT_SECONDS)try{process.kill(pid,'SIGKILL');}catch{}
};

test('a process of the trial the launcher could not stop: a failure, the folder stays reserved, the process is tracked, never signalled from outside',async t=>{
  const folder=newFolder(t),orphanFile=join(folder,'orphan.pid');
  // The command freezes the launcher confined with it, stops its core properly, leaves a process in a session of its own,
  // then kills that launcher: nothing in the sandbox is left to stop what remains.
  const script=['import json,os,signal,subprocess,time',
    `spec=json.load(open(${J(join(folder,'spec.json'))}))`,
    'inside=os.getppid();os.kill(inside,signal.SIGSTOP)',
    "subprocess.run([spec['hc'],'server','stop','--json'],capture_output=True,timeout=30)",
    "sock=os.path.join(spec['folder'],'s','herdr-core',spec['session']+'.sock')",
    'for i in range(150):',
    '  if not os.path.exists(sock):break',
    '  time.sleep(0.1)',
    'time.sleep(1)',
    'pid=os.fork()',
    'if pid==0:',
    `  os.setsid();os.execv('/bin/sleep',['/bin/sleep','${LEFT_SECONDS}'])`,
    `open(${J(orphanFile)},'w').write(str(pid))`,
    'os.kill(inside,signal.SIGKILL)'].join('\n');
  let orphan=null;t.after(()=>stopLeftSleep(orphan));
  const {code,err,result}=await launch(folder,['/usr/bin/python3','-I','-c',script]);
  orphan=Number(readFileSync(orphanFile,'utf8'));
  assert.ok(alive(orphan),'the process left by the trial is never signalled by the launcher outside');
  assert.equal(code,4,err);
  assert.equal(result?.confined,false,JSON.stringify(result));
  assert.equal(result?.code,'TRIAL_CLEANUP_FAILED',JSON.stringify(result));
  assert.deepEqual(result.cleanup?.left,[orphan],JSON.stringify(result.cleanup));
  assert.match(err,/TRIAL_CLEANUP_FAILED/);assert.match(err,new RegExp(String(orphan)));
  // The reservation is kept, with what is left and the identity of the sandbox to recognise it.
  const lock=reservationOf(folder),left=JSON.parse(readFileSync(join(lock,'left.json'),'utf8'));
  assert.deepEqual(left.pids,[orphan]);
  assert.ok(readdirSync(lock).some(name=>name.startsWith('id-'))&&readdirSync(lock).some(name=>name.startsWith('control-')),'the identity of the sandbox is kept');
  const again=await launch(folder,['/usr/bin/true']);
  assert.equal(again.code,2);assert.match(again.err,/TRIAL_BUSY/);assert.match(again.err,new RegExp(String(orphan)));
  assert.deepEqual(holders(folder),[],'a holder of the core was left running');
});

test('a cleanup the launcher cannot be sure of (identity of the sandbox lost): a failure, the folder stays reserved',async t=>{
  const folder=newFolder(t),started=join(folder,'started'),go=join(folder,'go');
  const script=`const fs=require('fs');fs.writeFileSync(${J(started)},'1');const at=Date.now();const t=setInterval(()=>{if(fs.existsSync(${J(go)})||Date.now()-at>60000)clearInterval(t);},50);`;
  const first=launch(folder,[process.execPath,'-e',script]);
  for(const at=Date.now();!existsSync(started);){assert.ok(Date.now()-at<60000,'the trial did not start');await new Promise(r=>setTimeout(r,100));}
  const lock=reservationOf(folder);
  for(const name of readdirSync(lock))if(name.startsWith('id-'))rmSync(join(lock,name));
  writeFileSync(go,'1');
  const {code,err,result}=await first;
  assert.equal(code,4,err);
  assert.equal(result?.confined,false,JSON.stringify(result));
  assert.equal(result?.code,'TRIAL_CLEANUP_FAILED',JSON.stringify(result));
  assert.ok(result.cleanup?.error,JSON.stringify(result.cleanup));
  assert.ok(existsSync(join(lock,'left.json')),'the folder is no longer reserved');
  assert.deepEqual(holders(folder),[],'a holder of the core was left running');
  assert.ok(await gone(result.corePid),'the core of the trial was left running');
});

test('the descendants of a trial cannot signal a process outside it; they still signal their own',async t=>{
  const folder=newFolder(t),outside=await witness(t),out=join(folder,'signals.txt');
  const script=`/bin/sleep 30 & S=$!; kill -0 $S; echo "own0 $?" > ${out}; kill -TERM $S; echo "own $?" >> ${out}; `+
    `kill -0 ${outside.pid}; echo "out0 $?" >> ${out}; kill -TERM ${outside.pid}; echo "outTERM $?" >> ${out}; kill -KILL ${outside.pid}; echo "outKILL $?" >> ${out}`;
  const {code,err,result}=await launch(folder,['/bin/sh','-c',script]);
  assert.equal(code,0,err);assert.equal(result.confined,true,err);
  assert.deepEqual(readFileSync(out,'utf8').trim().split('\n'),['own0 0','own 0','out0 1','outTERM 1','outKILL 1']);
  assert.ok(alive(outside.pid)&&outside.exitCode===null&&outside.signalCode===null,'the witness was reached');
  for(const place of ['launcher','exec','run'])assert.equal(result.reports[place].probes.find(p=>p.name==='signal-outside')?.outcome,'refused',place);
});

test('a second launch on a folder in use is refused before any change, and the first goes on untouched',async t=>{
  const folder=newFolder(t),started=join(folder,'started'),go=join(folder,'go');
  const script=`const fs=require('fs');fs.writeFileSync(${J(started)},'1');const at=Date.now();const t=setInterval(()=>{if(fs.existsSync(${J(go)})||Date.now()-at>60000){clearInterval(t);fs.writeFileSync(${J(join(folder,'first.txt'))},'done');}},50);`;
  const first=launch(folder,[process.execPath,'-e',script]);
  for(const at=Date.now();!existsSync(started);){assert.ok(Date.now()-at<60000,'the first trial did not start');await new Promise(r=>setTimeout(r,100));}
  const look=()=>({spec:readFileSync(join(folder,'spec.json'),'utf8'),profile:readFileSync(join(folder,'profile.sb'),'utf8'),mc:statSync(join(folder,'mc')).ino,reports:readdirSync(join(folder,'reports')).sort(),result:existsSync(join(folder,'result.json'))});
  const before=look();
  const second=await launch(folder,['/usr/bin/true']);
  assert.equal(second.code,2,second.err);assert.match(second.err,/TRIAL_BUSY/);
  assert.deepEqual(look(),before,'the second launch changed the folder of the first');
  writeFileSync(go,'1');
  const {code,err,result}=await first;
  assert.equal(code,0,err);assert.equal(result.confined,true,err);
  assert.equal(readFileSync(join(folder,'first.txt'),'utf8'),'done');
  // Once the first is over, the folder is free again.
  assert.equal((await launch(folder,['/usr/bin/true'])).code,0);
});

test('a reservation left by a launcher that stopped is never taken over silently: refused, folder untouched',async t=>{
  const folder=newFolder(t);
  assert.equal((await launch(folder,['/usr/bin/true'])).code,0);
  const lock=join(dirname(folder),'.'+basename(folder)+'.fabrique-console-trial-lock');
  mkdirSync(lock);writeFileSync(join(lock,'owner.json'),J({pid:999999,at:'2026-11-14T00:00:00.000Z'}));
  const spec=readFileSync(join(folder,'spec.json'),'utf8');
  const {code,err}=await launch(folder,['/usr/bin/true']);
  assert.equal(code,2);assert.match(err,/TRIAL_BUSY/);assert.match(err,new RegExp(lock.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
  assert.equal(readFileSync(join(folder,'spec.json'),'utf8'),spec);
});

test('the CLI in a sandbox that refuses only /private/tmp, the home and the DNS socket is TRIAL_NOT_CONFINED',async t=>{
  const folder=newFolder(t);
  assert.equal((await launch(folder,['/usr/bin/true'])).code,0,'a folder prepared by the launcher');
  const root=join(folder,'state');
  const partial=`(version 1)(allow default)(deny file-write* (subpath "/private/tmp"))(allow file-write* (subpath ${J(folder)}))(deny file-read* (subpath ${J(realHome)}))`+
    `(allow file-read* (literal ${J(realpathSync(process.execPath))}))(allow file-read* (subpath ${J(folder)}))(deny network* (remote unix-socket (path-literal "/private/var/run/mDNSResponder")))`;
  const run=spawnSync('/usr/bin/sandbox-exec',['-p',partial,realpathSync(process.execPath),join(folder,'mc','src','cli.mjs'),'ticket-detail',J({id:'DEMO-1'})],{encoding:'utf8',env:{PATH:'/usr/bin:/bin',HOME:join(folder,'home'),FABRIQUE_CONSOLE_MC_TRIAL:'1',FABRIQUE_CONSOLE_HOME:root}});
  const envelope=JSON.parse(run.stdout.trim().split('\n').pop()||'{}');
  assert.equal(envelope.error?.code,'TRIAL_NOT_CONFINED',run.stdout+run.stderr);
});

test('the witnesses of the launcher removed during a trial: refused, and the launcher still stops its own and frees the folder',async t=>{
  const folder=newFolder(t),started=join(folder,'started'),go=join(folder,'go');
  const script=`const fs=require('fs');fs.writeFileSync(${J(started)},'1');const at=Date.now();const t=setInterval(()=>{if(fs.existsSync(${J(go)})||Date.now()-at>60000)clearInterval(t);},50);`;
  const first=launch(folder,[process.execPath,'-e',script]);
  for(const at=Date.now();!existsSync(started);){assert.ok(Date.now()-at<60000,'the trial did not start');await new Promise(r=>setTimeout(r,100));}
  const spec=JSON.parse(readFileSync(join(folder,'spec.json'),'utf8'));
  rmSync(dirname(spec.canary.outside),{recursive:true,force:true});
  writeFileSync(go,'1');
  const {code,err,result}=await first;
  assert.equal(code,3,err);assert.equal(result?.code,'TRIAL_NOT_CONFINED',err);
  assert.ok(await gone(spec.canary.signal),'the witness process of the launcher was left running');
  // The launcher inside stopped its core, and what remained was proved and stopped: nothing of the trial is left.
  assert.ok(Number.isInteger(result.corePid),JSON.stringify(result));
  assert.ok(await gone(result.corePid),'the core of the trial was left running');
  assert.deepEqual(holders(folder),[],'a holder of the core was left running');
  assert.equal(result.cleanup?.error,undefined,JSON.stringify(result.cleanup));
  assert.equal(existsSync(reservationOf(folder)),false,'the folder is still reserved');
});
