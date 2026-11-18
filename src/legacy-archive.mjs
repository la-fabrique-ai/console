import { join } from 'node:path';
import { lstat, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { AppError, fail, patientLock, readJSON, waitLock, writeJSON } from './common.mjs';

// The switch-over to the requests (src/requests.mjs), made once, on the first start of this version. The old stock of
// decisions and requests is moved, as it is, into a dated folder outside every path the code reads to pass anything on:
// <root>/archive/legacy-<date>/state/…, under the same names. Nothing is deleted, nothing is copied back.
//
// What is moved: state/inbox/ (the requests of before); the decisions of state/decisions/ that no request recorded; the
// questions that carry an answer of the user no request put there (in place, or kept aside for the relay); the notes
// queued for the Lead in each state/devchain-<mission>.json (digest, withheld), which are copied to
// state/devchain-digest/<mission>.json and emptied in the chain.
//
// Safe after a stop at any point: the plan is written first (state/legacy-archive.json, « moving », with its folder);
// each file is moved by one rename and never over another; a file already in the archive and gone from its place is
// done; the same name in both places is a conflict, said, and nothing is overwritten. Played again, it goes on where it
// stopped, and says « done » once everything is there. Anything that fails is LEGACY_ARCHIVE_FAILED: the requests,
// and so the relay, do nothing until it is made.
export const MARKER=['state','legacy-archive.json'];
const CHAIN=/^devchain-([\w.-]{1,200})\.json$/,DECISION=/^D-\d{1,7}\.json$/,QUESTION=/^Q-\d{1,7}\.json$/;
const exists=path=>lstat(path).then(()=>true,error=>{if(error.code==='ENOENT')return false;throw error;});
// What the screens say (worded by Codex, chosen by the user: decision 61), and apart from it the technical cause.
export const ARCHIVE_FAILED='Couldn\'t archive old requests and decisions. Request delivery is paused.';
const failed=error=>{
  const cause=error instanceof AppError&&error.code==='LEGACY_ARCHIVE_FAILED'?(typeof error.cause==='string'?error.cause:error.message):String(error?.message||error);
  const out=new AppError('LEGACY_ARCHIVE_FAILED',ARCHIVE_FAILED);out.cause=cause.slice(0,300);return out;
};
async function names(dir) {
  try{return await readdir(dir);}catch(error){if(error.code==='ENOENT')return [];throw error;}
}
// The folder of the archive once the switch is made or under way; null before.
export async function archiveOf(root) {
  const marker=await readJSON(join(root,...MARKER),null);
  return marker?.folder?{folder:join(root,marker.folder),state:marker.state}:null;
}
// The archive as the screens may consult it: the files of one of its folders (inbox, questions, decisions), read and
// never written. Before the switch, or for a folder it does not hold, nothing.
export async function archived(root,part,pattern) {
  const where=await archiveOf(root);
  if(!where)return [];
  const dir=join(where.folder,'state',part);
  return (await Promise.all((await names(dir)).filter(name=>pattern.test(name)).map(name=>readJSON(join(dir,name),null).catch(()=>null)))).filter(Boolean);
}
// One file (or folder) moved once: absent from its place and in the archive is done; in both places is a conflict.
async function moveOnce(from,to,probe) {
  const here=await exists(from),there=await exists(to);
  if(!here)return false;
  if(there)fail('LEGACY_ARCHIVE_FAILED','The same file is in its place and in the archive: '+to);
  await mkdir(join(to,'..'),{recursive:true,mode:0o700});
  await rename(from,to);
  await probe('switch:moved');
  return true;
}
async function writeAtomic(path,text) {
  const temp=path+'.'+randomUUID()+'.tmp';
  try{await writeFile(temp,text,{mode:0o600,flag:'wx'});await rename(temp,path);}finally{await rm(temp,{force:true}).catch(()=>{});}
}
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);

// `keeps` is worked out by the requests under their lock: which decision and which question they recorded.
export async function switchOver({root,now=Date.now,probe=async()=>{},keeps}) {
  const markerPath=join(root,...MARKER),state=join(root,'state');
  try {
    const marker=await readJSON(markerPath,null);
    if(marker?.state==='done')return {switched:false,folder:marker.folder};
    const folder=marker?.folder??join('archive','legacy-'+new Date(now()).toISOString().replace(/:/g,'-'));
    const home=join(root,folder,'state');
    const startedAt=marker?.startedAt??new Date(now()).toISOString();
    if(!marker)await writeJSON(markerPath,{state:'moving',folder,startedAt});
    await mkdir(home,{recursive:true,mode:0o700});
    const {decision,question}=await keeps();
    // The requests of before: the whole folder at once, else (it came back after a stop) file by file.
    const inbox=join(state,'inbox');
    if(!(await exists(join(home,'inbox'))))await moveOnce(inbox,join(home,'inbox'),probe);
    else for(const name of await names(inbox))await moveOnce(join(inbox,name),join(home,'inbox',name),probe);
    for(const name of (await names(join(state,'decisions'))).filter(name=>DECISION.test(name))) {
      const d=await readJSON(join(state,'decisions',name),null);
      if(d&&decision(d))continue;
      await moveOnce(join(state,'decisions',name),join(home,'decisions',name),probe);
    }
    await waitLock(join(state,'questions'),async()=>{
      for(const name of (await names(join(state,'questions'))).filter(name=>QUESTION.test(name))) {
        const q=await readJSON(join(state,'questions',name),null);
        if(!q||question(q))continue;
        await moveOnce(join(state,'questions',name),join(home,'questions',name),probe);
      }
    });
    // The notes queued for the Lead, under the lock of the chains: copied, then emptied; a copy already there is
    // done when the queue still holds the same notes, a conflict when it holds others.
    await patientLock(join(state,'devchain'),async()=>{
      for(const name of await names(state)) {
        const id=CHAIN.exec(name)?.[1];if(!id)continue;
        // A chain that cannot be read is read by no one (dev-chain takes it for empty): its notes go nowhere.
        const path=join(state,name);let chain;
        try{chain=JSON.parse(await readFile(path,'utf8'));}catch{continue;}
        if(!chain||typeof chain!=='object')continue;
        const old={digest:Array.isArray(chain.digest)?chain.digest:[],withheld:Array.isArray(chain.withheld)?chain.withheld:[]};
        if(!old.digest.length&&!old.withheld.length)continue;
        const copy=join(home,'devchain-digest',id+'.json'),kept=await readJSON(copy,null);
        if(kept&&!same({digest:kept.digest,withheld:kept.withheld},old))fail('LEGACY_ARCHIVE_FAILED','Other notes are already in the archive: '+copy);
        if(!kept){await writeJSON(copy,{mission:id,...old,digestAt:chain.digestAt??null});await probe('switch:moved');}
        await writeAtomic(path,JSON.stringify({...chain,digest:[],withheld:[]})+'\n');
        await probe('switch:moved');
      }
    });
    const at=new Date(now()).toISOString();
    await writeJSON(markerPath,{state:'done',folder,startedAt,doneAt:at});
    return {switched:true,folder};
  } catch(error){throw failed(error);}
}
