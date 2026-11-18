import { spawn } from 'node:child_process';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readJSON, writeJSON, clean, fail } from './common.mjs';
import { captureCode } from './proof-code.mjs';
import { finishProof,readProofIntent } from './proof-store.mjs';

export async function executeQA(run,{root}={}) {
  const before=root&&await readProofIntent(root,run.id)?await captureCode(run.cwd):null;
  return new Promise((resolveRun,rejectRun)=>{
    const result={...run};let child,timedOut=false,finished=false,total=0;const max=512*1024;
    const finish=async(status,exitCode,signal=null)=>{
      if(finished)return;finished=true;clearTimeout(timer);result.status=status;result.exitCode=exitCode;result.signal=signal;result.finishedAt=new Date().toISOString();
      try{if(before)await finishProof(root,result,before,await captureCode(run.cwd));resolveRun(clean(result));}catch(error){rejectRun(error);}
    };
    const append=(key,chunk)=>{const buffer=Buffer.from(chunk);const remaining=max-total;if(remaining>0){result[key]+=buffer.subarray(0,remaining).toString('utf8');total+=Math.min(buffer.length,remaining);}if(buffer.length>remaining)result.outputTruncated=true;};
    let timer;
    result.startedAt=new Date().toISOString();
    try {child=spawn(run.argv[0],run.argv.slice(1),{cwd:run.cwd,shell:false,detached:process.platform!=='win32',stdio:['ignore','pipe','pipe'],env:process.env});}
    catch {result.stderr='QA executable could not be started.';finish('error',null);return;}
    child.stdout.on('data',chunk=>{append('stdout',chunk);if(process.env.FABRIQUE_CONSOLE_QA_TERMINAL==='1')process.stdout.write(chunk);});
    child.stderr.on('data',chunk=>{append('stderr',chunk);if(process.env.FABRIQUE_CONSOLE_QA_TERMINAL==='1')process.stderr.write(chunk);});
    child.on('error',()=>{result.stderr+='QA executable could not be started.';finish('error',null);});
    child.on('close',(code,signal)=>finish(timedOut?'timed-out':signal?'interrupted':code===0?'passed':'failed',code,signal));
    timer=setTimeout(()=>{timedOut=true;try{if(process.platform!=='win32')process.kill(-child.pid,'SIGKILL');else child.kill('SIGKILL');}catch{}},run.timeoutMs);
  });
}

export async function runWorker(root,id) {
  if(!/^[0-9a-f-]{36}$/.test(id))fail('INVALID_ARGUMENT','Invalid QA run ID.');
  const path=join(resolve(root),'qa',`${id}.json`),run=await readJSON(path,null);
  if(!run||run.id!==id||run.status!=='running'||!Array.isArray(run.argv))fail('INVALID_DATA','QA job is missing or invalid.');
  const result=await executeQA(run,{root});await writeJSON(path,result);return result;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  process.env.FABRIQUE_CONSOLE_QA_TERMINAL='1';
  try {const result=await runWorker(process.argv[2],process.argv[3]);process.exitCode=result.status==='passed'?0:1;}
  catch {process.stderr.write('Local QA worker failed.\n');process.exitCode=1;}
}
