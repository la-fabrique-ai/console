import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, writeFile, rename, chmod, lstat, rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { operationLock } from './operation-lock.mjs';

export class AppError extends Error {
  constructor(code,message) { super(message);this.name='AppError';this.code=code; }
}
export function fail(code,message) { throw new AppError(code,message); }
export const exec = promisify(execFile);
export const commandOptions = {encoding:'utf8',timeout:15000,maxBuffer:2*1024*1024,shell:false,windowsHide:true};
const usageCounterFields=new Set(['inputTokens','cachedTokens','outputTokens','totalTokens']);
// The `tokens` of mission-read (M13) are counters, not a secret: they cross as they are only when they are exactly that
// shape, every leaf a count (or null), a ticket identifier, or one of the few words of a row; anything else under that
// name is masked like any field that reads like a secret.
const count=v=>v===null||(Number.isSafeInteger(v)&&v>=0);
const COUNTS=['in','out','input','cacheRead','cacheWrite'];
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const keysIn=(o,allowed)=>Object.keys(o).every(k=>allowed.includes(k));
const ofCounts=o=>COUNTS.every(k=>count(o[k]));
const TOOL=/^(?:claude|codex)$/;
const agentRow=r=>plain(r)&&keysIn(r,['role','tool',...COUNTS])&&/^(?:lead|dev|reviewer|qa)$/.test(r.role)&&TOOL.test(r.tool)&&ofCounts(r);
const launchRow=r=>plain(r)&&keysIn(r,['role','tool','turn','state','reason','partial',...COUNTS])&&/^(?:dev|review-\d{1,4})$/.test(r.role)&&TOOL.test(r.tool)
  &&Number.isSafeInteger(r.turn)&&r.turn>0&&/^(?:counted|unknown)$/.test(r.state)&&(r.reason===undefined||/^(?:trace|session|unreadable|too-large|shared)$/.test(r.reason))
  &&(r.partial===undefined||r.partial===true)&&ofCounts(r);
const ticketRow=t=>plain(t)&&keysIn(t,[...COUNTS,'unknown','agents'])&&ofCounts(t)&&Number.isSafeInteger(t.unknown)&&t.unknown>=0&&Array.isArray(t.agents)&&t.agents.every(launchRow);
const tokenCounts=v=>plain(v)&&keysIn(v,['estimate','tickets','agents','budgets'])&&(v.estimate===undefined||v.estimate===true)&&plain(v.tickets)&&Object.entries(v.tickets).every(([id,t])=>/^[\w.-]{1,200}$/.test(id)&&ticketRow(t))
  &&Array.isArray(v.agents)&&v.agents.every(agentRow)
  &&(v.budgets===undefined||(Array.isArray(v.budgets)&&v.budgets.length===4&&new Set(v.budgets.map(r=>r.role)).size===4&&v.budgets.every(r=>plain(r)&&keysIn(r,['role','consumed','budget','state','partial'])&&/^(?:lead|dev|reviewer|qa)$/.test(r.role)&&count(r.consumed)&&count(r.budget)&&/^(?:ok|exceeded|stopped|unknown|untracked)$/.test(r.state)&&typeof r.partial==='boolean')));
const secretField=(k,v)=>/(?:token|secret|password|apiKey|authorization)/i.test(k)&&!(usageCounterFields.has(k)&&count(v))&&!(k==='tokens'&&tokenCounts(v));
// The text under each answer of a request (`details`, beside its `answers`): a key that is one of those answers is a word
// of the Lead, not the name of a field, so it is cleaned as a word (« Keep Authorization header » stays readable). Any
// other key is cleaned as a field, and what is under every key is cleaned as usual.
const wordsUnder=(details,answers)=>Object.fromEntries(Object.entries(details).map(([k,v])=>answers.includes(k)?[clean(k),clean(v)]:[k,secretField(k,v)?'[redacted]':clean(v)]));
export function clean(value) {
  if (typeof value==='string') return value.replace(/lin_api_[a-zA-Z0-9_-]+/g,'[redacted]').replace(/Bearer\s+[a-zA-Z0-9._-]+/gi,'Bearer [redacted]');
  if (Array.isArray(value)) return value.map(clean);
  if (value && typeof value==='object') {
    const answers=Array.isArray(value.answers)?value.answers.filter(answer=>typeof answer==='string'):null;
    return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,k==='details'&&answers&&v&&typeof v==='object'&&!Array.isArray(v)?wordsUnder(v,answers):secretField(k,v)?'[redacted]':clean(v)]));
  }
  return value;
}
export async function privateDir(path) {
  await mkdir(path,{recursive:true,mode:0o700});
  const info=await lstat(path); if (!info.isDirectory()||info.isSymbolicLink()) fail('UNSAFE_STORAGE','Private storage must be a real directory.');
  await chmod(path,0o700);
}
export async function readJSON(path,fallback) {
  try { const info=await lstat(path);if(!info.isFile()||info.isSymbolicLink()) fail('UNSAFE_STORAGE','Private data must be a regular file.'); return JSON.parse(await readFile(path,'utf8')); }
  catch(error) { if(error.code==='ENOENT') return fallback; if(error instanceof AppError) throw error;fail('INVALID_DATA','A local JSON file is invalid or unreadable.'); }
}
// `scrub` masks the secrets before the write: clean by default. A register whose keys are words, not names of fields,
// passes its own, which cleans those keys as words.
export async function writeJSON(path,value,scrub=clean) {
  await privateDir(dirname(path)); const temp=`${path}.${randomUUID()}.tmp`;
  try { await writeFile(temp,JSON.stringify(scrub(value),null,2)+'\n',{mode:0o600,flag:'wx'});await rename(temp,path);await chmod(path,0o600); }
  finally {await rm(temp,{force:true}).catch(()=>{});}
}
export const withLock=operationLock;
// withLock refuses at once when the lock is held (BUSY). The short writes of the durable registers wait their turn.
export async function patientLock(dir,task,{tries=600,lock=withLock}={}) {
  for(let attempt=1;;attempt++) {
    try {return await lock(dir,task);}
    catch(error) {if(error.code!=='BUSY'||attempt>=tries)throw error;await new Promise(done=>setTimeout(done,2+Math.random()*10));}
  }
}
// Waits for a lock, and for the lock only. patientLock plays its whole task again whenever BUSY comes out of it, even
// from a lock taken inside the task: what was half done is then done twice. Here a task that was entered is never run
// again, whatever comes out of it.
export async function waitLock(dir,task,{tries=600}={}) {
  for(let attempt=1;;attempt++) {
    let entered=false;
    try {return await withLock(dir,()=>{entered=true;return task();});}
    catch(error) {if(entered||error.code!=='BUSY'||attempt>=tries)throw error;await new Promise(done=>setTimeout(done,2+Math.random()*10));}
  }
}
export function object(value,code='INVALID_ARGUMENT') { if(!value||typeof value!=='object'||Array.isArray(value)) fail(code,'Expected a JSON object.');return value; }
export function text(value,name,max=1000) {if(typeof value!=='string'||!value.trim()||value.length>max||value.includes('\0')) fail('INVALID_ARGUMENT',`Invalid ${name}.`);return value;}
export function canonical(value) {return JSON.stringify(value&&typeof value==='object'?(Array.isArray(value)?value.map(v=>JSON.parse(canonical(v))):Object.fromEntries(Object.keys(value).sort().map(k=>[k,JSON.parse(canonical(value[k]))]))):value);}
