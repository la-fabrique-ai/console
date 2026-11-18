import test from 'node:test';
import assert from 'node:assert/strict';
import { fork, execFile, spawn } from 'node:child_process';
import { once } from 'node:events';
import { promisify } from 'node:util';
import { writeFile, readFile, access, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { fixture } from './helpers/backend-fixture.mjs';
import { withLock } from '../src/common.mjs';
const command=promisify(execFile);
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));

async function descendants(pid) {
  let children;
  try{children=(await command('/usr/bin/pgrep',['-P',String(pid)])).stdout.trim().split(/\s+/).filter(Boolean).map(Number);}
  catch(error){if(error.code===1)return [];throw error;}
  return [...children,...(await Promise.all(children.map(descendants))).flat()];
}
function kill(pid,signal='SIGKILL'){try{process.kill(pid,signal);}catch(error){if(error.code!=='ESRCH')throw error;}}
async function owner(t,root) {
  const child=fork(new URL('./helpers/lock-lifetime-process.mjs',import.meta.url),[root],{silent:true});
  const messages=[];child.on('message',message=>messages.push(message));
  const auxiliaries=[];
  t.after(()=>{auxiliaries.forEach(pid=>kill(pid));if(child.exitCode===null)kill(child.pid);});
  const until=async(key,timeout=3000)=>{
    const end=Date.now()+timeout;
    while(!messages.some(message=>message[key])&&Date.now()<end)await pause(5);
    return messages.find(message=>message[key]);
  };
  assert.ok(await until('entered'),'Owner did not enter');
  auxiliaries.push(...await descendants(child.pid));
  return {child,auxiliaries,until};
}

test('owner stays exclusive until its task returns',async t=>{
  const f=await fixture(t),a=await owner(t,f.home);
  // Old implementation has a lock-holder here; descriptor ownership needs no child.
  const last=a.auxiliaries.at(-1);if(last){kill(last);await pause(100);}
  let competitorEntered=false;
  try{await withLock(f.home,async()=>{competitorEntered=true;await writeFile(join(f.home,'competitor-write'),'fixture');});}
  catch(error){assert.equal(error.code,'BUSY');}
  a.child.send('continue');const result=await a.until('done');
  assert.equal(competitorEntered,false,JSON.stringify({auxiliaries:a.auxiliaries.length,competitorEntered,ownerResult:result}));
  assert.deepEqual(result,{done:true});assert.equal(await readFile(join(f.home,'owner-write'),'utf8'),'fixture');
});

test('task completion releases the lock and returns within the bound',async t=>{
  const f=await fixture(t),a=await owner(t,f.home);
  const last=a.auxiliaries.at(-1);if(last)kill(last,'SIGSTOP');
  const start=performance.now();a.child.send('continue');
  const result=await a.until('done',2200);
  const survivors=a.auxiliaries.filter(pid=>{try{process.kill(pid,0);return true;}catch{return false;}});
  assert.ok(result,JSON.stringify({returned:false,elapsedMs:performance.now()-start,survivors}));
  for(const pid of a.auxiliaries)assert.throws(()=>process.kill(pid,0),{code:'ESRCH'});
  await withLock(f.home,async()=>{});
});

test('suspended acquisition is bounded and its process is killed before returning an error',async t=>{
  const f=await fixture(t),binary=join(f.root,'stopped-acquisition.mjs'),pidFile=join(f.root,'acquisition-pid');
  await writeFile(binary,'#!'+process.execPath+'\n'+`import {writeFileSync} from 'node:fs';writeFileSync(${JSON.stringify(pidFile)},String(process.pid));process.kill(process.pid,'SIGSTOP');setInterval(()=>{},1000);\n`);
  await chmod(binary,0o700);
  t.after(async()=>{try{kill(Number(await readFile(pidFile,'utf8')));}catch{}});
  const start=performance.now();
  // Use the production acquisition deadline: under a busy native run, Node itself
  // may need more than 300 ms to start the fault fixture and publish its PID.
  await assert.rejects(withLock(f.home,async()=>assert.fail('Unacquired task ran'),{lockf:binary,acquireTimeoutMs:3000}),{code:'STORAGE_ERROR'});
  assert.ok(performance.now()-start<5000,'Acquisition cleanup exceeded its bound');
  const pid=Number(await readFile(pidFile,'utf8'));assert.throws(()=>process.kill(pid,0),{code:'ESRCH'});
  await withLock(f.home,async()=>{});
});

test('a detached child launched during a task cannot inherit and prolong the lock',async t=>{
  const f=await fixture(t);let child;
  t.after(async()=>{if(child&&child.exitCode===null&&child.signalCode===null){const exited=once(child,'exit');kill(child.pid);await exited;}});
  await withLock(f.home,async()=>{
    child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{detached:true,stdio:'ignore',shell:false});
    await once(child,'spawn');assert.doesNotThrow(()=>process.kill(child.pid,0));
  });
  // The child is still alive; only a leaked descriptor could keep the flock busy.
  assert.doesNotThrow(()=>process.kill(child.pid,0));
  await withLock(f.home,async()=>{assert.doesNotThrow(()=>process.kill(child.pid,0));});
});
