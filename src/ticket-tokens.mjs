import * as fs from 'node:fs/promises';
import path from 'node:path';

// The tokens of each ticket of a mission, agent by agent (M13, decisions 68, 99 and 101; rule 7 of the inventory of
// usage): read from the sessions the traces of M12 link to the mission, the ticket, the role and the turn of each launch.
// Only counters are taken from a session, in memory: a line is opened only when it may carry a counter, and of it only
// the numbers, the time and the id of the answer are kept; nothing else is copied, kept or written anywhere.
//
// What it stands on (the installed programs, 2026-11-15: their binary, no session read):
// - Claude Code 2.1.325 writes an `assistant` line per answer, again while it streams, the last with its final
//   message.usage {input_tokens, cache_creation_input_tokens, cache_read_input_tokens, output_tokens}, and keeps its
//   sub-agents beside the session, at <session>/subagents/…/agent-<id>.jsonl. An answer is one message.id: the same
//   answer found twice in the files of a launch (streamed, copied into a sub-agent) is counted once.
// - Codex 0.167.2 writes `event_msg` lines of type `token_count` whose info.total_token_usage is the running total of
//   its session, input_tokens including cached_input_tokens; only what was added is counted, each total once. Its
//   cache_write_input_tokens has no told relation to input_tokens: the cache written by Codex stays unknown.
//
// The rules of a number (decisions 101 and 106): a number is an estimate of the consumption (`estimate: true` on the
// result, from which the page may show an estimate), never a guarantee; it is unknown only when nothing of it can be read.
// - Every reading reads every session in full, with no memory of an earlier one. Only a whole result may be given again
//   as it is, for at most a minute (`reuseFor`), never completed or mixed with another.
// - A launch counts what its own session (and its sub-agents) did from its start; before it (a Lead resuming an older
//   session) is not counted.
// - A session held by several launches of the mission (a resume), or an answer found in the files of several launches,
//   is unknown for each of them (shared): it is never shared out, nor given to one of them.
// - A session that changes while it is read (another size or time at the end: an agent at work) gives what was read,
//   marked `partial: true` on its launch.
// - A Claude launch whose reading fails still names the answers it had read: a launch that also holds one of them is
//   unknown (shared), so an answer of two launches is never given to one of them alone.
// - A trace whose session nobody knows (decision 85), a session not found, a counter that cannot be read, a limit gone
//   beyond: that launch is unknown (null, with its reason), and so is every total it is part of; nothing of it goes to
//   another launch.
// Limits, written (decision 106): a session also written by another mission is not seen as shared; a rewrite during
// the reading that puts back the same size and time is not seen (the number may mix both versions).
//
// A counter is a whole number, zero or more; anything else (absent, negative, a fraction, a text) cannot be read.
const counter=value=>Number.isSafeInteger(value)&&value>=0?value:null;
const wholeNumbers=values=>{const read=values.map(counter);return read.includes(null)?null:read;};
const GROUPS=['lead','dev','reviewer','qa'];
const groupOf=role=>role==='dev'?'dev':/^review-\d+$/.test(String(role))?'reviewer':role==='lead'||role==='qa'?role:null;
export const ofTicket=role=>role==='dev'||/^review-\d+$/.test(String(role));
const UNKNOWN={in:null,out:null,input:null,cacheRead:null,cacheWrite:null};
// A line, a file, the unique entries of a reading, the sub-agents of a session, the launches of a mission.
export const TOKEN_LIMITS=Object.freeze({line:4*2**20,file:128*2**20,entries:200000,subagents:256,agents:1000});
const MARKER={claude:'"usage"',codex:'"token_count"'};
const CHUNK=64*1024;
const sumOf4=v=>v[1]+v[2]+v[3]+v[4];

class Unknown extends Error {constructor(reason){super(reason);this.reason=reason;}}

// One answer of Claude by message.id, the most complete of its copies (the last written while it streams).
function claudeLine(found,text) {
  let entry;try{entry=JSON.parse(text);}catch{throw new Unknown('unreadable');}
  const usage=entry?.message?.usage,id=entry?.message?.id,at=Date.parse(entry?.timestamp);
  if(entry?.type!=='assistant'||usage===undefined||typeof id!=='string'||!Number.isFinite(at))return;
  const read=usage&&typeof usage==='object'?wholeNumbers([usage.input_tokens,usage.cache_creation_input_tokens,usage.cache_read_input_tokens,usage.output_tokens]):null;
  if(!read)throw new Unknown('unreadable');
  const value=[at,...read],known=found.get(id);
  if(!known||sumOf4(value)>sumOf4(known))found.set(id,value);
}
// One running total of Codex, each once however often it is written.
function codexLine(found,text) {
  let entry;try{entry=JSON.parse(text);}catch{throw new Unknown('unreadable');}
  if(entry?.type!=='event_msg'||entry.payload?.type!=='token_count')return;
  // No info at all: Codex writes it before any usage of its process, rate limits only. Any other info carries a running
  // total (TokenUsageInfo.total_token_usage, never optional): one null, absent or not an object cannot be read.
  const info=entry.payload.info,at=Date.parse(entry.timestamp);
  if(info===undefined||info===null||!Number.isFinite(at))return;
  const total=info&&typeof info==='object'?info.total_token_usage:null;
  const read=total&&typeof total==='object'?wholeNumbers([total.input_tokens,total.cached_input_tokens,total.output_tokens]):null;
  if(!read)throw new Unknown('unreadable');
  found.set([at,...read].join('|'),[at,...read]);
}

// The whole lines of a file up to a size, a line opened only when it holds the marker. At most `limit` bytes of a line
// are held: a longer line is passed over, unless it holds the marker (it may be a counter): then it is too large. A last
// line not yet ended is still being written: it is not read.
async function scan(handle,{size,marker,limit,onLine}) {
  const mark=Buffer.from(marker),buffer=Buffer.allocUnsafe(CHUNK);
  let at=0,parts=[],held=0,over=false,hit=false,tail=Buffer.alloc(0);
  while(at<size){
    const {bytesRead}=await handle.read(buffer,0,Math.min(CHUNK,size-at),at);
    if(!bytesRead)break;
    let from=0;
    while(from<bytesRead){
      const newline=buffer.subarray(0,bytesRead).indexOf(10,from),end=newline<0?bytesRead:newline,piece=buffer.subarray(from,end);
      if(!hit){const look=Buffer.concat([tail,piece]);hit=look.includes(mark);tail=look.subarray(Math.max(0,look.length-mark.length+1));}
      if(!over){if(held+piece.length>limit){over=true;parts=[];held=0;}else{parts.push(Buffer.from(piece));held+=piece.length;}}
      if(over&&hit)throw new Unknown('too-large');
      if(newline<0)break;
      if(hit)onLine(Buffer.concat(parts).toString('utf8'));
      parts=[];held=0;over=false;hit=false;tail=Buffer.alloc(0);
      from=newline+1;
    }
    at+=bytesRead;
  }
}

export function createTicketTokens({traces,limits:asked={},reuseFor=60000,now=Date.now}) {
  const limits={...TOKEN_LIMITS,...asked};
  // A file read in full into `found`; `room` refuses what goes beyond the entries of the reading. It tells whether the
  // file moved while it was read: what was read is then only a part of it.
  async function readSession(file,kind,found,room) {
    const handle=await fs.open(file,'r');
    try{
      const before=await handle.stat();
      if(before.size>limits.file)throw new Unknown('too-large');
      const line=kind==='claude'?claudeLine:codexLine;
      await scan(handle,{size:before.size,marker:MARKER[kind],limit:limits.line,onLine:text=>{line(found,text);room(found.size);}});
      const after=await handle.stat();
      return after.size!==before.size||after.mtimeMs!==before.mtimeMs;
    }finally{await handle.close();}
  }
  // The sub-agents of a Claude session, beside it: none is none, a folder that cannot be read is a failed reading.
  async function subagents(file,session) {
    const found=[];
    let dir;
    try{dir=await fs.opendir(path.join(path.dirname(file),session,'subagents'),{recursive:true});}
    catch(error){if(error?.code==='ENOENT')return found;throw new Unknown('unreadable');}
    try{
      for await(const e of dir){
        if(!e.isFile()||!e.name.startsWith('agent-')||!e.name.endsWith('.jsonl'))continue;
        if(found.length>=limits.subagents)throw new Unknown('too-large');
        found.push(path.join(e.parentPath??e.path,e.name));
      }
    }catch(error){if(error instanceof Unknown)throw error;throw new Unknown('unreadable');}
    finally{await dir.close().catch(()=>{});}
    return found;
  }
  // What a launch did from its start: Claude, its answers; Codex, what its running total added (or started again with).
  const claudeSum=(found,from)=>{const s=[0,0,0,0];for(const [at,...v] of found.values())if(at>=from)v.forEach((n,k)=>{s[k]+=n;});return s;};
  const codexSum=(found,from)=>{
    const s=[0,0,0,0];let before=null;
    for(const e of [...found.values()].sort((x,y)=>x[0]-y[0])){
      const restarted=!before||e[1]+e[3]<before[1]+before[3];
      const added=restarted?e.slice(1):e.slice(1).map((v,k)=>Math.max(0,v-before[k+1]));
      before=e;
      if(e[0]>=from){s[0]+=added[0];s[2]+=added[1];s[3]+=added[2];}
    }
    return s;
  };

  async function reading(mission) {
    const all=(await traces.ofMission(mission)).filter(t=>groupOf(t.role));
    if(!all.length)return null;
    // Too many launches: none is read.
    const agents=all.map(trace=>({trace,from:Date.parse(trace.at),reason:all.length>limits.agents?'too-large':null,sum:null,partial:false}));
    const holders=new Map(),keyOf=t=>t.tool+'|'+t.session;
    for(const {trace} of agents)if(trace.session)holders.set(keyOf(trace),(holders.get(keyOf(trace))||0)+1);
    // The entries of the reading: what each launch read once, never more than the limit. Beyond it, the Claude launches
    // are all unknown: the answers of the one not read could be found in the files of another.
    let used=0,claudeBeyond=false;
    const owners=new Map();
    for(const a of agents){
      const {trace}=a;
      if(a.reason)continue;
      if(!trace.session||!['claude','codex'].includes(trace.tool)){a.reason='trace';continue;}
      if(holders.get(keyOf(trace))>1){a.reason='shared';continue;}
      const file=await traces.sessionFile(trace).catch(()=>null);
      if(!file){a.reason='session';continue;}
      let beyond=false;
      const found=new Map(),room=size=>{if(used+size>limits.entries){beyond=true;throw new Unknown('too-large');}};
      try{
        if(trace.tool==='claude')for(const f of [file,...await subagents(file,trace.session)])a.partial=await readSession(f,'claude',found,room)||a.partial;
        else a.partial=await readSession(file,'codex',found,room);
      }catch(error){
        a.reason=error instanceof Unknown?error.reason:'unreadable';
        if(beyond&&trace.tool==='claude')claudeBeyond=true;
      }
      // The answers read, even by a launch whose reading failed: one held by two launches is no one's alone. Every
      // answer kept takes its place in the entries, a failed reading's too: beyond, that launch is unknown (too-large)
      // and so is every Claude launch, since an answer not kept could be found in the files of another.
      let kept=0;
      if(trace.tool==='claude'){
        const ids=[...found].filter(([,[at]])=>at>=a.from).map(([id])=>id);
        if(used+ids.length>limits.entries){a.reason='too-large';claudeBeyond=true;continue;}
        used+=kept=ids.length;
        for(const id of ids){
          const other=owners.get(id);
          if(other&&other!==a){other.reason||='shared';a.reason||='shared';}else owners.set(id,a);
        }
      }
      if(a.reason)continue;
      used+=found.size-kept;
      a.sum=trace.tool==='claude'?claudeSum(found,a.from):codexSum(found,a.from);
    }
    if(claudeBeyond)for(const a of agents)if(a.trace.tool==='claude'&&!a.reason)a.reason='too-large';
    const shown=a=>{
      const {trace}=a,head={role:trace.role,tool:trace.tool,turn:trace.turn,state:a.reason?'unknown':'counted',...(a.reason?{reason:a.reason}:a.partial?{partial:true}:{})};
      if(a.reason)return {...head,...UNKNOWN};
      const [input,cacheWrite,cacheRead,output]=a.sum;
      // Codex: input_tokens includes the cache read; what it wrote to the cache it does not tell apart.
      return trace.tool==='claude'?{...head,in:input+cacheWrite+cacheRead,out:output,input,cacheRead,cacheWrite}
        :{...head,in:input,out:output,input:Math.max(0,input-cacheRead),cacheRead,cacheWrite:null};
    };
    const sumOf=rows=>{
      if(rows.some(r=>r.state!=='counted'))return {...UNKNOWN};
      const total=k=>rows.reduce((s,r)=>s+r[k],0);
      return {in:total('in'),out:total('out'),input:total('input'),cacheRead:total('cacheRead'),cacheWrite:rows.some(r=>r.cacheWrite===null)?null:total('cacheWrite')};
    };
    const rows=agents.map(a=>({row:shown(a),trace:a.trace}));
    const tickets={};
    for(const {row,trace} of rows)if(trace.ticket&&ofTicket(trace.role))(tickets[trace.ticket]||=[]).push(row);
    const byGroup=new Map();
    for(const {row,trace} of rows){const k=groupOf(trace.role)+'|'+trace.tool;if(!byGroup.has(k))byGroup.set(k,{role:groupOf(trace.role),tool:trace.tool,rows:[]});byGroup.get(k).rows.push(row);}
    return {launches:rows,tokens:{
      estimate:true,
      tickets:Object.fromEntries(Object.entries(tickets).map(([id,list])=>[id,{...sumOf(list),unknown:list.filter(r=>r.state!=='counted').length,agents:list}])),
      agents:[...byGroup.values()].sort((x,y)=>GROUPS.indexOf(x.role)-GROUPS.indexOf(y.role)||x.tool.localeCompare(y.tool)).map(g=>({role:g.role,tool:g.tool,...sumOf(g.rows)})),
    }};
  }
  // A whole result, given again as it is for at most `reuseFor` milliseconds; a reading that fails is not kept.
  const recent=new Map();
  function read({mission}={}) {
    const at=now();
    for(const [k,v] of recent)if(!(at-v.at<reuseFor&&at>=v.at))recent.delete(k);
    if(recent.has(mission))return recent.get(mission).result;
    const result=reading(mission);
    if(reuseFor>0){recent.set(mission,{at,result});result.catch(()=>{if(recent.get(mission)?.result===result)recent.delete(mission);});}
    return result;
  }
  return {inspect:read,read:async input=>(await read(input))?.tokens??null};
}
