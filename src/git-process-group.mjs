import { fork } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { gitEnvironment } from './git-environment.mjs';

export function groupAlive(pgid) {
  if(!Number.isSafeInteger(pgid)||pgid<=1)return false;
  try{process.kill(-pgid,0);return true;}catch(error){return error.code!=='ESRCH';}
}
async function boundedExit(exited,timeoutMs) {
  let timer;
  try{return await Promise.race([exited,new Promise(resolve=>{timer=setTimeout(()=>resolve(false),timeoutMs);})]);}
  finally{clearTimeout(timer);}
}

// Fetch only: its whole process group is bounded. Checkout jobs use their worker
// group without a creation timeout, so a long smudge/LFS process is never killed here.
export async function runGitGroup(cwd,args,{timeoutMs=30000,beforeGo=async()=>{},fetchSpec}={}) {
  const nonce=randomUUID(),child=fork(fileURLToPath(new URL('./fetch-supervisor.mjs',import.meta.url)),[nonce],{detached:true,stdio:['ignore','ignore','ignore','ipc'],env:{...gitEnvironment(),LC_ALL:'C'}});
  let finish,announced=false,stopping=false,timedOut=false,timer,failure;
  const completed=new Promise(resolve=>finish=resolve);
  const exited=new Promise(resolve=>{
    child.once('exit',()=>{finish(null);resolve(true);});
    child.once('error',()=>{finish(null);resolve(false);});
  });
  child.on('message',message=>{
    if(message?.nonce!==nonce)return;
    if(!stopping&&!announced&&message.type==='ready'&&message.pid===child.pid) {
      announced=true;
      Promise.resolve(beforeGo({pid:child.pid,pgid:child.pid,nonce})).then(()=>{if(!stopping&&child.connected)child.send({type:'go',nonce,cwd,args,fetchSpec},error=>{if(error)finish(null);});}).catch(error=>{failure=error;finish(null);});
    }
    if(message.type==='result')finish(message);
  });
  const result=await Promise.race([completed,new Promise(resolve=>{timer=setTimeout(()=>{timedOut=true;resolve(null);},timeoutMs);})]);
  clearTimeout(timer);
  stopping=true;
  try{if(child.connected)child.send({type:'stop',nonce},()=>{});}catch{}
  // An unresponsive/externally stopped supervisor is unconfirmed, never grounds
  // for a parent-side numeric signal. Disconnect lets a responsive owner self-stop.
  const end=Date.now()+1500,observed=await boundedExit(exited,1500);
  while(child.pid&&groupAlive(child.pid)&&Date.now()<end)await new Promise(resolve=>setTimeout(resolve,10));
  const terminated=Boolean(observed&&(!child.pid||!groupAlive(child.pid)));
  try{if(child.connected)child.disconnect();}catch{}
  child.unref();
  if(failure)throw failure;
  return {ok:!!result&&result.code===0&&result.signal===null&&!result.spawnError&&!result.overflow&&terminated,code:result?.code??null,signal:result?.signal??null,timedOut,terminated,pgid:child.pid??null,stdout:result?.stdout??'',remoteSha:result?.remoteSha??null,observedAt:result?.observedAt??null};
}
