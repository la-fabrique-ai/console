#!/usr/bin/env node
// The native check of the traces (M12, review P1): what the tests cannot show without a real agent, shown once by the
// real `claude` and `codex`, at the first trial with real agents (docs/essais.md, « Vérifier les traces avec de vrais
// agents »). Never run by the suite, never run outside a trial on purpose:
//
//   node scripts/trial.mjs <folder> -- node mc/scripts/trace-native-check.mjs [--claude <path>] [--codex <path>] [--only claude|codex] [--timeout <seconds>]
//
// 1. Claude, inheriting CLAUDE_CODE_CHILD_SESSION (as an agent started from a Claude session does):
//    - a witness, started without the setting: it must finish with success and write no session (else the marker does
//      not turn it off here, or its silence proves nothing, and the proof is inconclusive);
//    - the agent as the tool starts it (traceArgv: --session-id <key>, CLAUDE_CODE_FORCE_SESSION_PERSISTENCE in the env
//      of its --settings): its session file must be where the tool looks for it.
// 2. Codex, as the tool starts it (traceArgv: -c shell_environment_policy.set.FABRIQUE_CONSOLE_TRACE="<key>"), asked to run one
//    command of this script (--note): that command must see FABRIQUE_CONSOLE_TRACE and CODEX_THREAD_ID and link the session, and
//    the rollout of that id must be where the tool looks for it.
//
// Only names of files are looked at (lstat, readdir), never a word of a session; nothing the agents print is shown.
// Exit 0: everything proven; 1: something not proven (the JSON on stdout says what); 2: a wrong use.
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createTraces, noteAgentSession, TRACE_MARK } from '../src/traces.mjs';

const SCRIPT=fileURLToPath(import.meta.url);
const ROLE='native-check',CHILD_MARKER='CLAUDE_CODE_CHILD_SESSION';
const THREAD=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function options(argv) {
  const out={claude:null,codex:null,only:null,timeout:240,note:false,root:null};
  for(let i=0;i<argv.length;i++){
    const a=argv[i],next=()=>{const v=argv[++i];if(v===undefined)throw new Error('missing value for '+a);return v;};
    if(a==='--claude')out.claude=next();else if(a==='--codex')out.codex=next();else if(a==='--only')out.only=next();
    else if(a==='--timeout')out.timeout=Number(next());else if(a==='--note')out.note=true;else if(a==='--root')out.root=next();
    else throw new Error('unknown argument '+a);
  }
  if(out.only&&!['claude','codex'].includes(out.only))throw new Error('--only takes claude or codex');
  if(!Number.isFinite(out.timeout)||out.timeout<=0)throw new Error('--timeout takes seconds');
  return out;
}

// The agents of the trial (trial.json of the state folder), else those given, else those of the PATH.
async function agents(given) {
  let trial=null;
  if(process.env.FABRIQUE_CONSOLE_HOME)trial=await readFile(join(process.env.FABRIQUE_CONSOLE_HOME,'trial.json'),'utf8').then(JSON.parse).catch(()=>null);
  return {claude:given.claude??trial?.agents?.claude??'claude',codex:given.codex??trial?.agents?.codex??'codex'};
}

// One agent, in its own process group, nothing it prints kept; stopped with its group at the deadline.
function runAgent(program,args,{cwd,env,timeout}) {
  return new Promise(done=>{
    let child;
    try{child=spawn(program,args,{cwd,env,stdio:'ignore',detached:true});}catch(error){done({code:null,error:error.code||'SPAWN_FAILED'});return;}
    const timer=setTimeout(()=>{if(child.exitCode===null&&child.signalCode===null)try{process.kill(-child.pid,'SIGKILL');}catch{}},timeout*1000);
    child.once('error',error=>{clearTimeout(timer);done({code:null,error:error.code||'SPAWN_FAILED'});});
    child.once('close',(code,signal)=>{clearTimeout(timer);try{process.kill(-child.pid,'SIGKILL');}catch{}done({code,signal});});
  });
}

async function checkClaude({program,traces,cwd,timeout}) {
  const prompt='Réponds seulement OK.',env={...process.env,[CHILD_MARKER]:'1'};
  // The witness: the marker alone, no setting.
  const witness=randomUUID();
  const off=await runAgent(program,['--session-id',witness,'-p',prompt],{cwd,env,timeout});
  const witnessFile=await traces.sessionFile({tool:'claude',session:witness,cwd});
  // The agent as the tool starts it.
  const {argv,trace}=await traces.open({role:ROLE,ticket:'claude',cwd,argv:['claude','-p',prompt]});
  const on=await runAgent(program,argv.slice(1),{cwd,env,timeout});
  const found=await traces.find({role:ROLE,ticket:'claude',turn:1});
  // The silence of the witness proves something only if it ran to its end: a witness that failed, was stopped or never
  // started may have written nothing for that alone (M12 review 2).
  const witnessDone=off.code===0&&!off.signal&&!off.error;
  const proven=witnessDone&&Boolean(found?.file)&&!witnessFile&&found.session===trace?.session;
  return {proven,witness:{exit:off.code??off.error??off.signal,sessionWritten:Boolean(witnessFile)},agent:{exit:on.code??on.error??on.signal,settings:argv.includes('--settings'),sessionId:trace?.session??null,sessionFound:Boolean(found?.file)},
    ...(witnessFile?{why:'the witness wrote its session: the marker does not turn the transcript off here, the setting is not shown to matter'}
      :!witnessDone?{why:'the witness did not finish with success: its silence proves nothing, the setting is not shown to matter (inconclusive)'}
      :found?.file?{}:{why:'no session file where the tool looks for it'})};
}

async function checkCodex({program,traces,cwd,root,timeout}) {
  const command=`node '${SCRIPT}' --note --root '${root}'`;
  const prompt=`Lance exactement cette commande shell, une seule fois, puis arrête-toi sans rien faire d'autre : ${command}`;
  const {argv,trace}=await traces.open({role:ROLE,ticket:'codex',cwd,argv:['codex','exec','--skip-git-repo-check','-s','danger-full-access',prompt]});
  const run=await runAgent(program,argv.slice(1),{cwd,env:{...process.env},timeout});
  const found=await traces.find({role:ROLE,ticket:'codex',turn:1});
  const linked=typeof found?.session==='string'&&THREAD.test(found.session);
  const proven=linked&&Boolean(found.file)&&found.key===trace?.key;
  return {proven,exit:run.code??run.error??run.signal,traceKey:argv.some(a=>a===`shell_environment_policy.set.${TRACE_MARK}="${trace?.key}"`),linked,sessionFound:Boolean(found?.file),
    ...(proven?{}:{why:linked?'linked, but no rollout of that id where the tool looks for it':'the command never linked a session: FABRIQUE_CONSOLE_TRACE or CODEX_THREAD_ID did not reach it, or Codex did not run it'})};
}

async function main() {
  let given;
  try{given=options(process.argv.slice(2));}catch(error){process.stderr.write('trace-native-check: '+error.message+'\n');return 2;}
  // The command Codex runs: link its session, say only whether it did.
  if(given.note){
    if(!given.root)return 2;
    const linked=await noteAgentSession({env:process.env,root:resolve(given.root)});
    process.stdout.write(linked?'linked\n':'not linked\n');return 0;
  }
  const {claude,codex}=await agents(given);
  const scratch=await mkdtemp(join(tmpdir(),'fabrique-console-trace-check-')),root=join(scratch,'mc'),cwd=join(scratch,'work');
  try{
    await mkdir(cwd,{recursive:true});
    const traces=createTraces({root}),result={};
    if(given.only!=='codex')result.claude=await checkClaude({program:claude,traces,cwd,timeout:given.timeout});
    if(given.only!=='claude')result.codex=await checkCodex({program:codex,traces,cwd,root,timeout:given.timeout});
    const proven=Object.values(result).every(r=>r.proven);
    process.stdout.write(JSON.stringify({proven,...result},null,2)+'\n');
    return proven?0:1;
  }finally{await rm(scratch,{recursive:true,force:true}).catch(()=>{});}
}

process.exitCode=await main();
