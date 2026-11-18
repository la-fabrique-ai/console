import { createHash } from 'node:crypto';
import { readdir,rm,lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { canonical,fail,privateDir,readJSON,writeJSON,withLock } from '../../../src/common.mjs';

export function assertNoCredential(value,credential){
  const contains=value=>typeof value==='string'?value.includes(credential):value&&typeof value==='object'?Object.entries(value).some(([key,item])=>key.includes(credential)||contains(item)):false;
  if(contains(value))fail('LINEAR_SECRET_RESPONSE','La réponse Linear contient une valeur sensible et ne peut pas être restituée.');
}
export async function enrichedCache(root,credential,parameters,{assertActive=()=>{}}={}){
  assertActive();
  const base=join(root,'cache','linear-enriched'),identity=createHash('sha256').update('fabrique-console-linear-enriched-cache-v1\0'+credential).digest('hex');
  const digest=createHash('sha256').update(canonical(parameters)).digest('hex'),directory=join(base,identity),file=join(directory,digest+'.json');
  await privateDir(base);
  // This namespace belongs exclusively to enriched reads. Concurrent old reads
  // can recreate their partition; the next access purges it again, never serves it.
  await withLock(base,async()=>{
    assertActive();
    for(const item of await readdir(base,{withFileTypes:true})){
      assertActive();
      if(!/^[a-f0-9]{64}$/.test(item.name))continue;
      const path=join(base,item.name),info=await lstat(path);
      if(info.isSymbolicLink()||!info.isDirectory())fail('UNSAFE_STORAGE','Unsafe enriched Linear cache compartment.');
      if(item.name!==identity)await rm(path,{recursive:true});
    }
    assertActive();
    await privateDir(directory);
  });
  return {
    async get(){
      const record=await readJSON(file,null);if(!record)return null;assertNoCredential(record,credential);
      const age=Date.now()-Date.parse(record.response?.observedAt);
      return record.version===1&&record.response?.complete===true&&age>=0&&age<60000?{...record.response,cached:true}:null;
    },
    async put(response){assertNoCredential(response,credential);if(response.complete)await writeJSON(file,{version:1,response});},
  };
}
