import { join } from 'node:path';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { patientLock } from './common.mjs';

// The claims of a mission, as its chain keeps them (dev-chain.mjs: a key, under a lock, in
// <root>/state/devchain-<mission>.json), for what must happen once outside a pass of the watcher: the message of a
// request left to the Lead. Same file, same lock, and nothing else of the file is touched.
export function createClaims({root,now=Date.now}) {
  const dir=join(root,'state'),lockDir=join(dir,'devchain'),file=id=>join(dir,'devchain-'+id+'.json');
  const safe=id=>{if(typeof id!=='string'||!/^[\w.-]{1,200}$/.test(id))throw new Error('Unknown mission.');return id;};
  const load=async id=>{try{const kept=JSON.parse(await readFile(file(safe(id)),'utf8'));return kept&&typeof kept==='object'&&!Array.isArray(kept)?kept:{};}catch{return {};}};
  const change=(id,act)=>patientLock(lockDir,async()=>{
    const kept=await load(id);kept.done=kept.done&&typeof kept.done==='object'?kept.done:{};
    const out=act(kept.done);
    if(out===false)return false;
    await mkdir(dir,{recursive:true});
    const temp=file(id)+'.'+process.pid+'.tmp';await writeFile(temp,JSON.stringify(kept)+'\n');await rename(temp,file(id));
    return out;
  });
  // True for the one caller that claims the key first.
  const claim=(id,key)=>change(id,done=>{if(done[key])return false;done[key]=now();return true;});
  const unclaim=(id,key)=>change(id,done=>{delete done[key];return true;});
  const claimedAt=async(id,key)=>(await load(id)).done?.[key]??null;
  return {claim,unclaim,claimedAt};
}
