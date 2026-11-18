import { join, basename } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { readdir, lstat, realpath, readFile, writeFile } from 'node:fs/promises';
import { fail, readJSON, writeJSON, privateDir } from './common.mjs';

// The traces of the agents (M12, decision 68; rule 7 of the inventory of usage): every agent the tool starts (Lead,
// dev, reviewer, QA, assistant; Claude Code as Codex) writes the file of its session, and the tool keeps the link to
// it, by the mission, the ticket, the role and the turn of its launch. Only the link: the tool never opens a session,
// never copies a word of it, never keeps a prompt. Counting the tokens (M13) reads from these links.
//
// What it stands on, read in the installed programs (2026-11-14, their help and their binary, no session started):
// - Claude Code 2.1.325 keeps no transcript when it inherits CLAUDE_CODE_CHILD_SESSION (« Transcript saving is off —
//   inherited CLAUDE_CODE_CHILD_SESSION marker »), unless CLAUDE_CODE_FORCE_SESSION_PERSISTENCE is set, which it takes
//   from the settings of its launch as from its environment (keepTranscript). It takes `--session-id <uuid>` (not with --resume) and writes its
//   session at <CLAUDE_CONFIG_DIR or ~/.claude>/projects/<the folder, every character not a-z A-Z 0-9 a dash, cut at
//   200 and followed by a hash when longer>/<id>.jsonl.
// - Codex 0.167.2 has no option for the id of its session. It gives it to every command it runs as CODEX_THREAD_ID,
//   and writes its session at <CODEX_HOME or ~/.codex>/sessions/YYYY/MM/DD/rollout-<time>-<id>.jsonl. So a Codex agent
//   carries the key of its trace (FABRIQUE_CONSOLE_TRACE, set for its commands as its mark is) and the first command of the tool
//   it runs (its report, its question, a command of the Lead) links its session to the trace.
export const TRACE_MARK='FABRIQUE_CONSOLE_TRACE';
const AGENT_MARK_CODEX='shell_environment_policy.set.FABRIQUE_CONSOLE_AGENT="1"';
const KEY=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SESSION=/^[0-9a-zA-Z][0-9a-zA-Z_-]{0,99}$/,THREAD=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ROLE=/^[a-z][a-z0-9-]{0,31}$/,NAME=/^[\w.-]{1,200}$/;
const CLAUDE_LIMIT=200;

// The folder Claude Code keeps the sessions of a working folder in, as it names it.
export const claudeProjectFolder=cwd=>String(cwd).replace(/[^a-zA-Z0-9]/g,'-');

// The argv of a Claude agent that keeps its transcript whatever it inherits: CLAUDE_CODE_FORCE_SESSION_PERSISTENCE in the
// settings of its launch (beside its mark, ui/v3/view.js), or in settings of their own when it carries none.
export const PERSIST={CLAUDE_CODE_FORCE_SESSION_PERSISTENCE:'1'};
export function keepTranscript(argv) {
  if(!Array.isArray(argv)||argv[0]!=='claude')return argv;
  const at=argv.indexOf('--settings');
  if(at>0&&typeof argv[at+1]==='string'){
    let settings;try{settings=JSON.parse(argv[at+1]);}catch{settings=null;}
    if(settings&&typeof settings==='object'&&!Array.isArray(settings)){
      const out=[...argv];out[at+1]=JSON.stringify({...settings,env:{...(settings.env&&typeof settings.env==='object'?settings.env:{}),...PERSIST}});return out;
    }
  }
  return ['claude','--settings',JSON.stringify({env:PERSIST}),...argv.slice(1)];
}

// The argv of an agent, traced under `key`: argv[0] stays the agent (decision 70). A Claude agent keeps its transcript;
// a new Claude session takes the key as its id, a resumed one keeps its own. Codex carries the key for its commands, right after its mark; the session of
// a resumed Codex is the one it resumes. Anything that is not an agent is not traced (null).
export function traceArgv(argv,key) {
  if(!Array.isArray(argv)||!['claude','codex'].includes(argv[0]))return null;
  if(argv[0]==='claude'){
    const at=argv.findIndex(a=>a==='--resume'||a==='-r');
    if(at>=0)return {argv:keepTranscript(argv),tool:'claude',session:typeof argv[at+1]==='string'?argv[at+1]:null};
    if(argv.includes('--continue')||argv.includes('-c'))return {argv:keepTranscript(argv),tool:'claude',session:null};
    return {argv:keepTranscript(['claude','--session-id',key,...argv.slice(1)]),tool:'claude',session:key};
  }
  const resumed=argv[1]==='resume'?argv.slice(2).find(a=>!a.startsWith('-'))??null:null;
  const mark=argv.indexOf(AGENT_MARK_CODEX),at=mark>0?mark+1:argv[1]==='resume'?2:1;
  return {argv:[...argv.slice(0,at),'-c',`shell_environment_policy.set.${TRACE_MARK}="${key}"`,...argv.slice(at)],tool:'codex',session:resumed};
}

const exists=async path=>{try{return (await lstat(path)).isFile();}catch{return false;}};
const names=async dir=>{try{return await readdir(dir);}catch{return [];}};

export function createTraces({root,env=process.env,home=homedir(),claudeHome=env.CLAUDE_CONFIG_DIR||join(home,'.claude'),codexHome=env.CODEX_HOME||join(home,'.codex'),uuid=randomUUID,now=()=>new Date()}) {
  const dir=join(root,'state','traces'),fileOf=key=>join(dir,key+'.json'),claimsOf=key=>join(dir,key+'.claims');
  const field=(value,pattern,name)=>{if(value===null||value===undefined)return null;if(typeof value!=='string'||!pattern.test(value))fail('INVALID_ARGUMENT',`Invalid ${name} of a trace.`);return value;};

  // A launch is traced before it is asked of Herdr: a launch that fails leaves a trace with no session, unknown.
  // Its context: the mission, the ticket and the role of a lane; the issue (and the ticket, when known) of a PO or of a
  // dev of before (src/launch.mjs), whose turns are counted for their issue alone.
  async function open({mission=null,issue=null,ticket=null,role=null,cwd=null,argv}) {
    const context={mission:field(mission,NAME,'mission'),issue:field(issue,NAME,'issue'),ticket:field(ticket,NAME,'ticket'),role:field(role,ROLE,'role')};
    const key=uuid();if(!KEY.test(key))fail('INVALID_ARGUMENT','Invalid key of a trace.');
    const traced=traceArgv(argv,key);if(!traced)return {argv,trace:null};
    const trace={version:1,key,...context,tool:traced.tool,cwd:typeof cwd==='string'&&cwd?cwd:null,session:traced.session&&SESSION.test(traced.session)?traced.session:null,at:now().toISOString(),linkedAt:null};
    await writeJSON(fileOf(key),trace);
    return {argv:traced.argv,trace};
  }
  // The session a Codex agent says is a claim, never a rewrite of its trace: each claim its own file, made at once or
  // not at all, so links at the same moment lose none. A Codex started by the agent (a `codex exec` of its commands)
  // inherits the key with the rest of its environment and claims it too, with its own id, and nothing it says, nor the
  // start of its rollout, tells it from the agent (M12 review 3, decision 85). So the rule never guesses: one Codex
  // claiming the trace is its agent; more than one (parent, children, resumed sessions, whatever their hours) and the
  // trace is unknown. Only the claims of this trace count: a claim made under another key takes nothing from it.
  async function owner(trace) {
    const claims=[];
    for(const name of (await names(claimsOf(trace.key))).sort()){
      const session=name.slice(0,-5);if(!name.endsWith('.json')||!THREAD.test(session))continue;
      claims.push({session,path:join(claimsOf(trace.key),name)});
      if(claims.length>1)return null;
    }
    if(claims.length!==1)return null;
    const [{session,path}]=claims;
    let at=null;try{at=JSON.parse(await readFile(path,'utf8')).at;}catch{}
    if(typeof at!=='string')at=await lstat(path).then(i=>i.mtime.toISOString()).catch(()=>null);
    return {session,at:at??''};
  }
  const read=async key=>{
    if(!KEY.test(String(key)))return null;
    const stored=await readJSON(fileOf(key),null).catch(()=>null);
    const terminal=await readJSON(join(dir,key+'.terminal'),null).catch(()=>null);
    const trace=stored?{...stored,...(terminal?{terminal}:{})}:null;
    if(!trace||trace.tool!=='codex'||trace.session)return trace;
    const first=await owner(trace).catch(()=>null);
    return first?{...trace,session:first.session,linkedAt:first.at||null}:trace;
  };
  async function link({key,session}) {
    if(typeof session!=='string'||!THREAD.test(session))return null;
    const trace=await read(key);
    if(!trace||trace.tool!=='codex')return null;
    // A resumed Codex is the session it resumes: nothing to claim.
    const kept=await readJSON(fileOf(trace.key),null).catch(()=>null);
    if(kept?.session)return trace;
    await privateDir(claimsOf(trace.key));
    try{await writeFile(join(claimsOf(trace.key),session+'.json'),JSON.stringify({session,at:now().toISOString()})+'\n',{mode:0o600,flag:'wx'});}
    catch(error){if(error.code!=='EEXIST')throw error;}
    return read(trace.key);
  }
  // The traces of a mission, a ticket and a role, in the order of their launch, each with its turn (1, 2…).
  async function list({mission=null,issue=null,ticket=null,role=null}={}) {
    const all=[];
    for(const name of await names(dir)){
      if(!name.endsWith('.json'))continue;
      const trace=await read(name.slice(0,-5));
      if(trace?.version===1&&trace.mission===mission&&(trace.issue??null)===issue&&trace.ticket===ticket&&trace.role===role)all.push(trace);
    }
    all.sort((a,b)=>String(a.at).localeCompare(String(b.at))||a.key.localeCompare(b.key));
    return all.map((trace,i)=>({...trace,turn:i+1}));
  }
  // The file of a session, found by its name only (never opened), or null while the agent has not written it.
  async function sessionFile(trace) {
    if(!trace?.session||!SESSION.test(trace.session))return null;
    if(trace.tool==='claude'){
      const file=trace.session+'.jsonl',folders=new Set();
      for(const cwd of [trace.cwd,await realpath(trace.cwd||'').catch(()=>null)])if(cwd)folders.add(claudeProjectFolder(cwd));
      for(const folder of folders){
        if(folder.length<=CLAUDE_LIMIT){const path=join(claudeHome,'projects',folder,file);if(await exists(path))return path;continue;}
        for(const name of await names(join(claudeHome,'projects')))if(name.startsWith(folder.slice(0,CLAUDE_LIMIT)+'-')){const path=join(claudeHome,'projects',name,file);if(await exists(path))return path;}
      }
      return null;
    }
    // Codex files its session under the day it started: that of the launch, or the day after (a launch at midnight).
    const days=[0,1,-1].map(d=>new Date(Date.parse(trace.at)+d*864e5)).filter(d=>!Number.isNaN(d.getTime()));
    const tail='-'+trace.session+'.jsonl';
    for(const day of days){
      for(const parts of [[day.getFullYear(),day.getMonth()+1,day.getDate()],[day.getUTCFullYear(),day.getUTCMonth()+1,day.getUTCDate()]]){
        const folder=join(codexHome,'sessions',String(parts[0]),String(parts[1]).padStart(2,'0'),String(parts[2]).padStart(2,'0'));
        const name=(await names(folder)).find(n=>n.startsWith('rollout-')&&n.endsWith(tail));
        if(name)return join(folder,basename(name));
      }
    }
    return null;
  }
  // One trace by its mission, ticket, role and turn, with the file of its session (null while unknown).
  async function find({mission=null,issue=null,ticket=null,role=null,turn}) {
    const trace=(await list({mission,issue,ticket,role})).find(t=>t.turn===turn);
    return trace?{...trace,file:await sessionFile(trace)}:null;
  }
  // Every trace of a mission (M13, for its tokens), in the order of their launch, each with its turn among those of its
  // issue, ticket and role, as list() counts them.
  async function ofMission(mission) {
    if(typeof mission!=='string'||!NAME.test(mission))return [];
    const all=[];
    for(const name of await names(dir)){
      if(!name.endsWith('.json'))continue;
      const trace=await read(name.slice(0,-5));
      if(trace?.version===1&&trace.mission===mission)all.push(trace);
    }
    all.sort((a,b)=>String(a.at).localeCompare(String(b.at))||a.key.localeCompare(b.key));
    const turns=new Map();
    return all.map(trace=>{const k=JSON.stringify([trace.issue??null,trace.ticket,trace.role]),turn=(turns.get(k)||0)+1;turns.set(k,turn);return {...trace,turn};});
  }
  // An immutable binding to the address returned by the launch and its ownership labels. A lost launch reply or a
  // missing record leaves the mapping unknown; neither a tab name nor a session filename is used to guess it.
  async function bind(key,terminal){
    if(!KEY.test(String(key))||!/^t[0-9a-z]+$/.test(terminal?.address)||!terminal.labels)return;
    const labels=Object.fromEntries(Object.entries(terminal.labels).filter(([k,v])=>(k.startsWith('fabrique-console.')||k==='herdr.space'||k==='herdr.tab')&&typeof v==='string'));
    if(!Object.keys(labels).length)return;
    const file=join(dir,key+'.terminal');
    await writeFile(file,JSON.stringify({address:terminal.address,labels})+'\n',{mode:0o600,flag:'wx'}).catch(e=>{if(e.code!=='EEXIST')throw e;});
  }
  return {open,link,list,find,sessionFile,ofMission,bind};
}

// Herdr as the engine uses it, each agent it starts traced: the hc runs (the Lead, the PO, the assistants, the devs of
// before), the dev of a lane, the tabs of the window (reviewers, QA), each with the context its launch gives — the
// labels of the core, or the `trace` a tab is asked with, which never reaches the window. A trace that cannot be
// written does not stop the launch: the agent starts as it would have, untraced, its transcript kept all the same.
export function tracedHerdr(herdr,traces) {
  const agent=async(argv,cwd,context)=>{
    if(traces)try{return await traces.open({...context,cwd,argv});}catch{}
    return {argv:keepTranscript(argv),trace:null};
  };
  const bound=async(opened,answer)=>{
    const out=typeof answer?.stdout==='string'?(()=>{try{return JSON.parse(answer.stdout);}catch{return null;}})():answer;
    const address=out?.address??out?.terminal?.address??out?.terminal?.id??(typeof out?.terminal==='string'?out.terminal:null);
    if(opened.trace&&address&&herdr.record&&traces?.bind)try{const t=await herdr.record(address);if(t)await traces.bind(opened.trace.key,{...t,address});}catch{}
    return answer;
  };
  const labelsOf=args=>{const out={};for(let i=0;i<args.length-1;i++)if(args[i]==='--label'){const [k,...v]=String(args[i+1]).split('=');out[k]=v.join('=');}return out;};
  // A label that is no name leaves its field unknown: the agent stays traced. A launch with an issue and a session but
  // no mission and no role is a dev of before (src/launch.mjs); the PO carry their role.
  const name=value=>typeof value==='string'&&NAME.test(value)?value:null,role=value=>typeof value==='string'&&ROLE.test(value)?value:null;
  const of=labels=>({mission:name(labels['fabrique-console.mission']),issue:name(labels['fabrique-console.issue']),ticket:name(labels['fabrique-console.ticket']),
    role:role(labels['fabrique-console.role'])??(labels['fabrique-console.role']===undefined&&labels['fabrique-console.mission']===undefined&&name(labels['fabrique-console.issue'])&&labels['fabrique-console.session']?'dev':null)});
  async function run(args) {
    const at=Array.isArray(args)?args.indexOf('--'):-1;
    if(at<0)return herdr.run(args);
    const head=args.slice(0,at),cwd=head[head.indexOf('--cwd')+1]??null;
    const opened=await agent(args.slice(at+1),head.includes('--cwd')?cwd:null,of(labelsOf(head)));
    return bound(opened,await herdr.run([...head,'--',...opened.argv]));
  }
  const kernel={...herdr.kernel,run:async input=>{
    const opened=await agent(input?.argv,input?.cwd??null,{...of(input?.labels||{}),role:'dev'});
    return bound(opened,await herdr.kernel.run({...input,argv:opened.argv}));
  }};
  const window={...herdr.window,run:async(command,args)=>{
    if(command!=='tab.new'||!args||typeof args!=='object')return herdr.window.run(command,args);
    const {trace=null,...rest}=args;
    if(!Array.isArray(rest.argv))return herdr.window.run(command,rest);
    const opened=await agent(rest.argv,rest.folder??null,{mission:trace?.mission??null,issue:trace?.issue??null,ticket:trace?.ticket??null,role:trace?.role??null});
    return bound(opened,await herdr.window.run(command,{...rest,argv:opened.argv}));
  }};
  return {...herdr,run,kernel,window};
}

// A command of the tool run by an agent it started (its report, its question, a command of its Lead) links the session
// of a Codex agent to its trace: the key its launch gave it, the id Codex gives its commands. It never fails the
// command it runs in: nothing to link, or a link that cannot be written, is nothing.
export async function noteAgentSession({env=process.env,root}) {
  try{
    if(!KEY.test(String(env[TRACE_MARK]??''))||!env.CODEX_THREAD_ID||!root)return null;
    return await createTraces({root,env}).link({key:env[TRACE_MARK],session:String(env.CODEX_THREAD_ID)});
  }catch{return null;}
}
