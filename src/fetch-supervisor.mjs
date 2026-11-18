import { spawn } from 'node:child_process';
import { gitEnvironment } from './git-environment.mjs';

// Only this live group leader sends TERM/KILL, using its own current PID.
// The parent never signals a remembered numeric PGID after Git or this worker exits.
const [nonce]=process.argv.slice(2);
let started=false,stopping=false;
setInterval(()=>{},1000);
process.on('SIGTERM',()=>{});
process.once('disconnect',()=>{process.kill(-process.pid,'SIGKILL');});
const send=(value,done=()=>{})=>{try{if(process.connected)process.send(value,done);else done();}catch{done();}};
const invalid=()=>({code:1,signal:null,spawnError:false,overflow:false,stdout:''});
const fullSha=value=>/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value);
function run(cwd,args) {
  return new Promise(resolve=>{
    const git=spawn('git',['-C',cwd,...args],{shell:false,env:gitEnvironment(),stdio:['ignore','pipe','pipe']});
    let stdout='',overflow=false,spawnError=false;
    git.stdout.on('data',chunk=>{if(stdout.length+chunk.length<=2*1024*1024)stdout+=chunk;else overflow=true;});
    git.stderr.on('data',()=>{}); // No credential/helper diagnostics leave this pipe.
    git.once('error',()=>{spawnError=true;});
    git.once('close',(code,signal)=>resolve({code,signal,spawnError,overflow,stdout}));
  });
}
const ok=result=>result.code===0&&result.signal===null&&!result.spawnError&&!result.overflow;
async function execute(message) {
  if(!message.fetchSpec)return run(message.cwd,message.args);
  const spec=message.fetchSpec,options=[...spec.gitOptions,'-c','fetch.bundleURI=','-c','fetch.writeCommitGraph=false','-c','remote.origin.followRemoteHEAD=never','-c','promisor.acceptFromServer=none'];
  const query=await run(message.cwd,[...options,'ls-remote','--exit-code','--refs','origin',spec.sourceRef]);
  if(!ok(query)||stopping)return stopping?invalid():query;
  const rows=query.stdout.trim().split('\n'),fields=rows[0].split(/\s+/);
  if(rows.length!==1||fields.length!==2||fields[1]!==spec.sourceRef||!fullSha(fields[0]))return invalid();
  const sha=fields[0],observedAt=new Date().toISOString();
  // No destination and no publication: even references that alias each other
  // through Git symrefs or filesystem links remain untouched.
  const fetched=await run(message.cwd,[...options,'fetch','--refmap=','--no-prune','--no-prune-tags','--no-tags','--no-recurse-submodules','--no-write-fetch-head','--no-auto-maintenance','origin',sha]);
  if(!ok(fetched)||stopping)return stopping?invalid():fetched;
  return {...fetched,remoteSha:sha,observedAt};
}
process.on('message',message=>{
  if(message?.nonce!==nonce)return;
  if(message.type==='stop') {
    if(stopping)return;stopping=true;
    process.kill(-process.pid,'SIGTERM');
    setTimeout(()=>send({type:'killing',nonce},()=>process.kill(-process.pid,'SIGKILL')),500);
    return;
  }
  if(started||stopping||message.type!=='go'||!Array.isArray(message.args))return;
  started=true;
  execute(message).then(result=>send({type:'result',nonce,...result}),()=>send({type:'result',nonce,...invalid()}));
});
send({type:'ready',nonce,pid:process.pid});
