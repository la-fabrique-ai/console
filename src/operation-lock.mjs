import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { open, lstat, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fail, privateDir, readJSON } from './common.mjs';

async function legacyLock(root) {
  const path=join(root,'operation.lock');
  try {
    const info=await lstat(path);
    if(!info.isDirectory()||info.isSymbolicLink())fail('UNSAFE_STORAGE','The legacy lock must be a real directory.');
    const owner=await readJSON(join(path,'owner.json'),null);
    if(Number.isInteger(owner?.pid)&&owner.pid>0) {
      try {process.kill(owner.pid,0);fail('BUSY','Another local operation is in progress.');}
      catch(error) {if(error.code!=='ESRCH')throw error;}
    }
    // Recovery is serialized by the kernel lock, including ownerless directories.
    await rm(path,{recursive:true,force:true});
  }catch(error){if(error.code!=='ENOENT')throw error;}
}

function boundedExit(exited,timeoutMs) {
  return new Promise(resolve=>{
    const timer=setTimeout(()=>resolve(null),timeoutMs);
    exited.then(result=>{clearTimeout(timer);resolve(result);});
  });
}

async function acquire(descriptor,{lockf,acquireTimeoutMs}) {
  // Descriptor-only mode: flock is retained by the parent's open description.
  // No -k and no command: command mode explicitly unlocks when its child exits.
  const child=spawn(lockf,['-t','0','3'],{shell:false,stdio:['ignore','ignore','ignore',descriptor.fd]});
  const exited=new Promise(resolve=>{
    child.once('error',error=>resolve({error}));
    child.once('exit',(code,signal)=>resolve({code,signal}));
  });
  const result=await boundedExit(exited,acquireTimeoutMs);
  if(!result) {
    child.kill('SIGKILL');
    if(!await boundedExit(exited,1000))fail('STORAGE_ERROR','Cannot confirm termination of the kernel lock acquisition.');
    fail('STORAGE_ERROR','The kernel lock acquisition timed out.');
  }
  if(result.error||result.signal!==null||result.code!==0) {
    if(!result.error&&result.signal===null&&result.code===75)fail('BUSY','Another local operation is in progress.');
    fail('STORAGE_ERROR','The kernel lock acquisition failed.');
  }
}

export async function operationLock(root,task,{lockf='/usr/bin/lockf',acquireTimeoutMs=3000}={}) {
  await privateDir(root);
  const path=join(root,'operation.guard');
  let descriptor;
  try {descriptor=await open(path,constants.O_CREAT|constants.O_RDWR|constants.O_NOFOLLOW,0o600);}
  catch{fail('STORAGE_ERROR','Cannot open the local kernel lock.');}
  try {
    if(!(await descriptor.stat()).isFile())fail('UNSAFE_STORAGE','The kernel lock must be a regular file.');
    await descriptor.chmod(0o600);
    await acquire(descriptor,{lockf,acquireTimeoutMs});
    await legacyLock(root);
    return await task();
  }finally {
    await descriptor.close();
  }
}
