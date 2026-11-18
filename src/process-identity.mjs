import { exec } from './common.mjs';
import { groupAlive } from './git-process-group.mjs';
import { readFile } from 'node:fs/promises';

let bootIdentity;
export function systemBootId() {
  return bootIdentity??=(async()=>{
    try {
      const value=process.platform==='darwin'?(await exec('/usr/sbin/sysctl',['-n','kern.bootsessionuuid'],{encoding:'utf8',timeout:1000,maxBuffer:1024,shell:false})).stdout:await readFile('/proc/sys/kernel/random/boot_id','utf8');
      const id=value.trim().toLowerCase();return /^[a-f0-9-]{36}$/.test(id)?id:null;
    }catch{return null;}
  })();
}

// Read only the start date, never process arguments (which may contain secrets).
// Missing permissions or an absent leader are inconclusive: surviving Git children
// can still own the old group after their worker has exited.
export async function processBirth(pid) {
  if(!Number.isSafeInteger(pid)||pid<=1)return null;
  try {
    const {stdout}=await exec('/bin/ps',['-p',String(pid),'-o','lstart='],{encoding:'utf8',timeout:1000,maxBuffer:1024,shell:false,env:{...process.env,LC_ALL:'C',TZ:'UTC'}});
    return stdout.trim()||null;
  }catch{return null;}
}
export const workerGroupAlive=worker=>!worker?.retiredAsReusedAt&&groupAlive(worker?.pgid);
// An existing numeric group alone is inconclusive. A matching leader birth
// proves the recorded worker is still running; unavailable identity does not.
export async function identifiedWorkerAlive(worker,{alive=groupAlive,birth=processBirth}={}) {
  if(worker?.retiredAsReusedAt||!Number.isSafeInteger(worker?.pid)||worker.pid<=1||worker.pid!==worker.pgid||!worker.birth)return false;
  try{return Boolean(alive(worker.pgid)&&await birth(worker.pid)===worker.birth);}catch{return false;}
}
export async function inspectWorkerGroup(worker) {
  if(!workerGroupAlive(worker))return {state:'absent'};
  const birth=worker.birth&&worker.pid===worker.pgid?await processBirth(worker.pid):null;
  if(birth&&birth!==worker.birth)return {state:'reused',birth};
  return {state:'alive'};
}
