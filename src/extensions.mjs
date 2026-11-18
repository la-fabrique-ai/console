// Actions added for the V2 interface. They read local facts and never go through the tracker or Git
// code of the backend, so they live apart from it and are dispatched first by the CLI.
import {homedir} from 'node:os';
import {join} from 'node:path';
import {AppError} from './common.mjs';
import {readUsage} from './usage.mjs';
import {promises as fs} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {readSheet,markChecking,failChecking,projectFolder} from './project-sheet.mjs';
import {readHealth} from './health.mjs';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const root=()=>process.env.FABRIQUE_CONSOLE_HOME??join(homedir(),'.config','fabrique-console');
const text=value=>typeof value==='string'&&value.length<=4096?value:null;
// Only the few fields the reading needs are kept from what the interface sends.
function list(value,fields) {
  if(value===undefined) return [];
  if(!Array.isArray(value)||value.length>500) throw new AppError('INVALID_ARGUMENT','A list argument is invalid.');
  return value.filter(item=>item&&typeof item==='object').map(item=>Object.fromEntries(fields.map(field=>[field,text(item[field])])));
}

// One result of the connection check per project folder.
function checkPath(repo) {
  if(typeof repo!=='string'||!repo||repo.length>4096) throw new AppError('INVALID_ARGUMENT','The project folder is invalid.');
  return join(root(),'mcp-check-'+createHash('sha256').update(repo).digest('hex').slice(0,16)+'.json');
}

// Takes the marker of a running check. A marker older than the longest check is a leftover of a
// check that died. Taking it over is done under a guard that only one process can hold (a folder
// creation is atomic): inside it the marker is examined again, so a marker just renewed by another
// process is never removed on the faith of an older look.
const STALE_MARKER=5*60000,STALE_GUARD=30000;
const create=async marker=>{
  try {const handle=await fs.open(marker,'wx',0o600);await handle.close();return true;}
  catch(error) {if(error?.code==='EEXIST') return false;throw new AppError('STORAGE_ERROR','The local state folder cannot be written.');}
};
const age=async file=>{try {return Date.now()-(await fs.stat(file)).mtimeMs;}catch {return null;}};
async function acquire(marker) {
  if(await create(marker)) return true;
  const old=await age(marker);
  if(old===null) return create(marker);
  if(old<=STALE_MARKER) return false;
  const guard=marker+'.takeover';
  try {await fs.mkdir(guard,{mode:0o700});}
  catch {
    // A guard left by a process that died is removed; this request gives up, the next one will pass.
    // Known limit: two requests that both find such a leftover guard, with a third taking a new one
    // in between, could let two checks start. It needs a process killed inside the guard first, and
    // costs one extra connection check, nothing else.
    const held=await age(guard);
    if(held!==null&&held>STALE_GUARD) await fs.rmdir(guard).catch(()=>{});
    return false;
  }
  try {
    const now=await age(marker);
    if(now!==null&&now<=STALE_MARKER) return false;
    await fs.rm(marker,{force:true});
    return await create(marker);
  }finally {await fs.rmdir(guard).catch(()=>{});}
}

export const extensions={
  'project-health':input=>readHealth({repo:input.repo}),
  'project-sheet':input=>readSheet({repo:input.repo,cachePath:checkPath(input.repo)}),
  // The check takes longer than an action may: it is started apart and the sheet shows its result.
  // Only one check runs per project: the marker file is created exclusively, across processes.
  async 'mcp-check'(input) {
    const cachePath=checkPath(input.repo),repo=await projectFolder(input.repo),marker=cachePath+'.running';
    if(!await acquire(marker)) return {started:false};
    try {
      await markChecking({repo,cachePath});
      const worker=spawn(process.execPath,[fileURLToPath(new URL('./mcp-check.mjs',import.meta.url)),repo,cachePath,marker],{detached:true,stdio:'ignore'});
      await new Promise((resolve,reject)=>{worker.once('spawn',resolve);worker.once('error',reject);});
      worker.unref();
      return {started:true};
    }catch(error) {
      // A check that could not start leaves neither a marker nor a "running" state behind.
      await fs.rm(marker,{force:true}).catch(()=>{});
      await failChecking({repo,cachePath}).catch(()=>{});
      if(error instanceof AppError) throw error;
      throw new AppError('CHECK_NOT_STARTED','The connection check could not be started.');
    }
  },
  async usage(input={}) {
    const days=[1,7,30].includes(input.days)?input.days:7;
    return readUsage({cachePath:join(root(),'usage-cache.json'),days,projects:list(input.projects,['key','name','repo']).filter(p=>p.key),sessions:list(input.sessions,['id','identifier','worktree','projectKey','tool']).filter(s=>s.worktree)});
  },
};
