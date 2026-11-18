import {randomUUID,createHash} from 'node:crypto';
// How many tokens the agents consumed on this machine, read from the session files that Claude Code
// and Codex write. Only counters, dates, models and working folders are read and kept: never a
// prompt, an answer or a tool output. Result keys avoid the word the secret filter redacts.
import {createReadStream} from 'node:fs';
import * as fs from 'node:fs/promises';
import {createInterface} from 'node:readline';
import {homedir} from 'node:os';
import path from 'node:path';

const DAY=86400000,VERSION=4;
// Codex increments are kept by quarter of an hour: every local midnight falls on such a boundary.
const SLOT=900000;
// Session files older than this are not opened: the screen shows a week, the cache keeps five.
const KEEP_DAYS=35;
const int=value=>Number.isFinite(value)&&value>0?Math.floor(value):0;

// A folder that does not exist has no sessions; a folder that cannot be read is a failed reading.
async function sessionFiles(dir) {
  try {return {files:(await fs.readdir(dir,{recursive:true,withFileTypes:true})).filter(e=>e.isFile()&&e.name.endsWith('.jsonl')).map(e=>path.join(e.parentPath??e.path,e.name)).sort(),failed:false};}
  catch(error) {return {files:[],failed:error?.code!=='ENOENT'};}
}
// A mark of what was already read. Session files only grow: if the mark of the part already read
// changed, the file was rewritten and is read again from the start. Up to FULL bytes the whole part
// is hashed; beyond, its beginning, its end and sixteen blocks spread over it (a rewrite of a large
// file that keeps all of these is not seen: the price of not re-reading gigabytes at each reading).
const FULL=8*1024*1024,EDGE=65536,BLOCK=4096;
async function markOf(file,offset) {
  if(!offset) return '';
  const handle=await fs.open(file,'r');
  try {
    const hash=createHash('sha256');
    const read=async (start,length)=>{const buffer=Buffer.alloc(length),{bytesRead}=await handle.read(buffer,0,length,start);hash.update(buffer.subarray(0,bytesRead));};
    if(offset<=FULL) for(let at=0;at<offset;at+=1<<20) await read(at,Math.min(1<<20,offset-at));
    else {await read(0,EDGE);for(let i=1;i<=16;i++) await read(Math.floor(offset/17*i/BLOCK)*BLOCK,BLOCK);await read(offset-EDGE,EDGE);}
    return hash.digest('base64');
  }finally {await handle.close();}
}

// Reads the complete lines added after `offset`; an unfinished last line is left for the next reading.
async function newLines(file,offset,onLine) {
  const stream=createReadStream(file,{start:offset}),lines=createInterface({input:stream,crlfDelay:Infinity});
  let consumed=0,pending=null;
  for await(const line of lines) {
    if(pending!==null) {onLine(pending.text);consumed+=pending.bytes;}
    pending={text:line,bytes:Buffer.byteLength(line,'utf8')+1};
  }
  if(pending!==null&&consumed+pending.bytes===stream.bytesRead) {onLine(pending.text);consumed+=pending.bytes;}
  return offset+consumed;
}

function claudeLine(data,text,horizon,fallbackSession,report) {
  if(!text.includes('"usage"')) return;
  let entry;try {entry=JSON.parse(text);}catch {report.invalid+=1;return;}
  const usage=entry?.message?.usage,id=entry?.message?.id,at=Date.parse(entry?.timestamp);
  if(entry?.type!=='assistant'||!usage||typeof id!=='string'||!Number.isFinite(at)) return;
  // A session can move from one folder to another: each answer keeps the folder it was written in.
  const cwd=typeof entry.cwd==='string'?entry.cwd:data.cwd;data.cwd=cwd;
  if(typeof entry.gitBranch==='string'&&entry.gitBranch) data.branch=entry.gitBranch;
  data.session=typeof entry.sessionId==='string'?entry.sessionId:fallbackSession;
  if(at<horizon) return;
  const model=typeof entry.message.model==='string'?entry.message.model:'inconnu';
  let index=data.models.indexOf(model);if(index<0) index=data.models.push(model)-1;
  // The same answer is written several times while it streams: the last line carries its final usage.
  let folder=data.cwds.indexOf(cwd);if(folder<0) folder=data.cwds.push(cwd)-1;
  data.ids[id]=[at,index,int(usage.input_tokens),int(usage.cache_creation_input_tokens),int(usage.cache_read_input_tokens),int(usage.output_tokens),folder];
}

function codexLine(data,text,horizon,report) {
  if(!text.includes('"token_count"')&&!text.includes('"turn_context"')&&!text.includes('"session_meta"')) return;
  let entry;try {entry=JSON.parse(text);}catch {report.invalid+=1;return;}
  const payload=entry?.payload;if(!payload||typeof payload!=='object') return;
  if(entry.type==='session_meta'||entry.type==='turn_context') {
    if(typeof payload.cwd==='string') data.cwd=payload.cwd;
    if(typeof payload.model==='string') data.model=payload.model;
    return;
  }
  if(entry.type!=='event_msg'||payload.type!=='token_count') return;
  const at=Date.parse(entry.timestamp);if(!Number.isFinite(at)) return;
  const limits=payload.rate_limits;
  if(limits&&typeof limits==='object'&&(!data.limits||at>=data.limits.at)) data.limits={at,primary:limits.primary??null,secondary:limits.secondary??null};
  const total=payload.info?.total_token_usage;if(!total||typeof total!=='object') return;
  data.counted=true;
  const now=[int(total.input_tokens),int(total.cached_input_tokens),int(total.output_tokens)],before=data.cum;
  // The counter is cumulative, sometimes repeated, sometimes restarted: only what was added is counted.
  const restarted=!before||now[0]+now[2]<before[0]+before[2];
  const added=restarted?now:now.map((value,i)=>Math.max(0,value-before[i]));
  data.cum=now;
  const last=payload.info.last_token_usage;
  if(last&&typeof last==='object') data.context={at,input:int(last.input_tokens),window:int(payload.info.model_context_window)||null};
  if(at<horizon||added[0]+added[2]===0) return;
  // Each increment keeps the quarter of an hour, the model and the folder it happened in.
  let folder=data.cwds.indexOf(data.cwd);if(folder<0) folder=data.cwds.push(data.cwd)-1;
  const key=Math.floor(at/SLOT)+'|'+folder+'|'+(data.model||'inconnu');
  const bucket=data.days[key]||(data.days[key]=[0,0,0,0]);
  bucket[0]+=added[0];bucket[1]+=added[1];bucket[2]+=added[2];bucket[3]+=1;
}

const fresh=kind=>kind==='claude'?{cwd:null,branch:null,session:null,models:[],cwds:[],ids:{}}:{cwd:null,model:null,cum:null,cwds:[],days:{},limits:null,context:null,counted:false};

async function scan(kind,dir,cache,horizon,report) {
  const seen=new Set(),listing=await sessionFiles(dir);
  if(listing.failed) {report.complete=false;return;}
  for(const file of listing.files) {
    // A file that cannot be examined this time keeps what was known of it.
    let stat;try {stat=await fs.stat(file);}catch {report.complete=false;if(cache.files[file]?.kind===kind) seen.add(file);continue;}
    if(stat.mtimeMs<horizon) {report.skipped+=1;continue;}
    seen.add(file);report.files+=1;
    let state=cache.files[file];
    // A file that shrank or was replaced is read again from the start.
    let rewritten=!state||state.kind!==kind||state.ino!==stat.ino||stat.size<state.offset;
    // One that changed without growing was rewritten; one that grew must still begin with what was read.
    if(!rewritten&&state.offset>0&&stat.mtimeMs!==state.mtimeMs) {
      if(stat.size===state.offset) rewritten=true;
      else try {rewritten=await markOf(file,state.offset)!==state.mark;}catch {report.complete=false;continue;}
    }
    if(rewritten) state=cache.files[file]={kind,ino:stat.ino,offset:0,invalid:0,data:fresh(kind)};
    state.mtimeMs=stat.mtimeMs;
    if(stat.size===state.offset) continue;
    const session=path.basename(file,'.jsonl').startsWith('agent-')?path.basename(path.dirname(path.dirname(file))):path.basename(file,'.jsonl');
    // Unreadable lines are remembered with the file: the reading stays partial until it is rewritten.
    const lines={invalid:0};
    try {state.offset=await newLines(file,state.offset,text=>kind==='claude'?claudeLine(state.data,text,horizon,session,lines):codexLine(state.data,text,horizon,lines));state.mark=await markOf(file,state.offset);}
    catch {report.complete=false;}
    state.invalid=(state.invalid||0)+lines.invalid;
  }
  for(const [file,state] of Object.entries(cache.files)) if(state.kind===kind) {if(!seen.has(file)) delete cache.files[file];else {report.invalid+=state.invalid||0;if(state.offset>FULL) report.sampled+=1;}}
}

const counts=()=>({input:0,output:0,cacheRead:0,cacheWrite:0,all:0});
function add(target,[input,cacheWrite,cacheRead,output]) {target.input+=input;target.output+=output;target.cacheRead+=cacheRead;target.cacheWrite+=cacheWrite;target.all+=input+output+cacheRead+cacheWrite;}

function owner(cwd,projects,sessions) {
  if(!cwd) return {project:null,ticket:null};
  const inside=root=>root&&(cwd===root||cwd.startsWith(root+path.sep));
  const session=sessions.find(s=>inside(s.worktree));
  if(session) return {project:session.projectKey??null,ticket:session};
  const project=projects.find(p=>inside(p.repo));
  if(project) return {project:project.key,ticket:null};
  // Worktrees live under <root>/worktrees/<project>/: the folder name tells the project.
  const folder=cwd.match(/[\\/]worktrees[\\/]([^\\/]+)[\\/]/)?.[1];
  const named=folder&&projects.find(p=>p.key===folder||path.basename(p.repo||'')===folder);
  return {project:named?named.key:null,ticket:null};
}

const ranked=map=>[...map.entries()].map(([key,all])=>({key,all})).sort((a,b)=>b.all-a.all);
const limit=value=>value&&typeof value==='object'&&Number.isFinite(value.used_percent)?{usedPercent:value.used_percent,windowMinutes:Number.isFinite(value.window_minutes)?value.window_minutes:null,resetsAt:Number.isFinite(value.resets_at)?value.resets_at*1000:null}:null;

function summarize(cache,{now,days,projects,sessions}) {
  // The period starts on a quarter of an hour, so that both tools are cut at exactly the same instant.
  const from=Math.floor((now-days*DAY)/SLOT)*SLOT,midnight=new Date(now);midnight.setHours(0,0,0,0);
  const total=counts(),today=counts(),byProject=new Map(),byModel=new Map(),byTicket=new Map(),tools={claude:{...counts(),sessions:new Set()},codex:{...counts(),sessions:new Set()}},rows=new Map();
  const row=(key,seed)=>rows.get(key)||(rows.set(key,{...seed,...counts(),messages:0}),rows.get(key));
  const record=(tool,sessionKey,cwd,at,values,model,seed)=>{
    const sum=values[0]+values[1]+values[2]+values[3];
    add(total,values);if(at>=midnight.getTime()) add(today,values);
    const {project,ticket}=owner(cwd,projects,sessions);
    byProject.set(project,(byProject.get(project)||0)+sum);byModel.set(model,(byModel.get(model)||0)+sum);
    if(ticket?.identifier) {const t=byTicket.get(ticket.identifier)||{identifier:ticket.identifier,project,tool:ticket.tool??tool,all:0};t.all+=sum;byTicket.set(ticket.identifier,t);}
    add(tools[tool],values);tools[tool].sessions.add(sessionKey);
    // A session that worked in several projects gives one row per project.
    const entry=row(tool+':'+sessionKey+':'+(project??''),{id:path.basename(String(sessionKey),'.jsonl'),tool,cwd,project,...seed});add(entry,values);
    return entry;
  };
  // An answer copied into another session file (a resumed session) is still one answer.
  const answers=new Map();
  for(const [file,state] of Object.entries(cache.files)) if(state.kind==='claude') for(const [id,value] of Object.entries(state.data.ids)) {
    const known=answers.get(id),size=value[2]+value[3]+value[4]+value[5];
    if(!known||size>known.size) answers.set(id,{size,value,data:state.data,file});
  }
  for(const {value:[at,index,input,cacheWrite,cacheRead,output,folder],data,file} of answers.values()) {
    if(at<from||at>now) continue;
    const entry=record('claude',data.session||file,data.cwds[folder]??data.cwd,at,[input,cacheWrite,cacheRead,output],data.models[index]||'inconnu',{branch:data.branch});
    entry.messages+=1;
  }
  let limits=null,unmeasured=0;
  for(const [file,state] of Object.entries(cache.files)) if(state.kind==='codex') {
    const data=state.data;
    if(data.limits&&(!limits||data.limits.at>limits.at)) limits=data.limits;
    if(!data.counted) {unmeasured+=1;continue;}
    for(const [key,[input,cached,output,events]] of Object.entries(data.days)) {
      const [slot,folder,...model]=key.split('|'),at=Number(slot)*SLOT;
      if(at<from||at>now) continue;
      const entry=record('codex',file,data.cwds[Number(folder)]??data.cwd,at,[Math.max(0,input-cached),0,cached,output],model.join('|'),{});
      entry.messages+=events;
    }
  }
  // What a session re-reads per message is an average over the period: a measure, not an estimate.
  const shown=[...rows.values()].filter(r=>r.all>0).map(r=>({...r,reread:r.messages?Math.round(r.cacheRead/r.messages):0}));
  return {
    days,from:new Date(from).toISOString(),to:new Date(now).toISOString(),
    total,today:{all:today.all},cacheShare:total.all?Math.round(100*total.cacheRead/total.all):0,
    byTool:Object.entries(tools).filter(([,t])=>t.sessions.size>0).map(([tool,t])=>({tool,all:t.all,sessions:t.sessions.size,input:t.input,output:t.output,cacheRead:t.cacheRead,cacheWrite:t.cacheWrite})),
    byProject:ranked(byProject),byModel:ranked(byModel).map(({key,all})=>({model:key,all})),
    byTicket:[...byTicket.values()].sort((a,b)=>b.all-a.all),
    sessions:shown.sort((a,b)=>b.reread-a.reread||b.all-a.all).slice(0,8),
    limits:{codex:limits?{observedAt:new Date(limits.at).toISOString(),primary:limit(limits.primary),secondary:limit(limits.secondary)}:null,claude:null},
    unmeasured,
  };
}

// Readings that share a cache run one after the other: the second starts from what the first stored.
const queue=new Map();
export async function readUsage(options={}) {
  const key=options.cachePath||'',next=(queue.get(key)||Promise.resolve()).catch(()=>{}).then(()=>reading(options));
  queue.set(key,next);
  try {return await next;}finally {if(queue.get(key)===next) queue.delete(key);}
}
async function reading({claudeDir=path.join(homedir(),'.claude','projects'),codexDir=path.join(homedir(),'.codex','sessions'),cachePath,now=Date.now(),days=7,projects=[],sessions=[]}={}) {
  let cache={version:VERSION,files:{}};
  try {const stored=JSON.parse(await fs.readFile(cachePath,'utf8'));if(stored?.version===VERSION&&stored.files&&typeof stored.files==='object') cache=stored;}catch {}
  // sampled counts the files too large for their whole content to be checked against a rewrite.
  const report={files:0,skipped:0,invalid:0,sampled:0,complete:true},horizon=now-KEEP_DAYS*DAY;
  await scan('claude',claudeDir,cache,horizon,report);
  await scan('codex',codexDir,cache,horizon,report);
  // Counters older than the horizon are dropped so the cache does not grow for ever.
  for(const state of Object.values(cache.files)) {
    if(state.kind==='claude') for(const [id,value] of Object.entries(state.data.ids)) if(value[0]<horizon) delete state.data.ids[id];
    if(state.kind==='codex') for(const key of Object.keys(state.data.days)) if(Number(key.split('|')[0])*SLOT<horizon) delete state.data.days[key];
  }
  if(cachePath) try {
    await fs.mkdir(path.dirname(cachePath),{recursive:true,mode:0o700});
    // Another process may write the same cache: each writer has its own temporary file.
    const temporary=cachePath+'.'+process.pid+'.'+randomUUID()+'.tmp';
    try {await fs.writeFile(temporary,JSON.stringify(cache),{mode:0o600});await fs.rename(temporary,cachePath);}
    catch(error) {await fs.rm(temporary,{force:true}).catch(()=>{});throw error;}
  }catch {report.complete=false;}
  // An unreadable line or folder makes the totals partial: the reading says so instead of looking complete.
  if(report.invalid>0) report.complete=false;
  return {updatedAt:new Date(now).toISOString(),scanned:report,...summarize(cache,{now,days,projects,sessions})};
}
