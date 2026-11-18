import { join } from 'node:path';
import { createDurableStorage,revisionOf } from './durable-storage.mjs';
import { canonical,clean,fail,withLock } from './common.mjs';

export const fingerprint=value=>revisionOf(canonical(value));
export function lossless(value) {
  if(canonical(clean(value))!==canonical(value))fail('UNSAFE_WORKSPACE_DATA','Workspace metadata cannot be stored without alteration.');
  return value;
}
export const activeAttempt=attempt=>!['released','failed-released'].includes(attempt.status);

export function createWorkspaceState(root) {
  const storage=createDurableStorage(),path=join(root,'workspace-state.json');
  async function read() {
    const document=await storage.read(path);
    const value=document.value??{version:1,plans:[],attempts:[]};
    if(value.version!==1||!Array.isArray(value.plans)||!Array.isArray(value.attempts)||value.fetches!==undefined&&!Array.isArray(value.fetches)||value.fetchAbandonments!==undefined&&!Array.isArray(value.fetchAbandonments)||value.missionPreviews!==undefined&&!Array.isArray(value.missionPreviews))fail('INVALID_DATA','Invalid workspace registry.');
    return {...document,value};
  }
  async function update(action) {
    const end=Date.now()+2000;
    for(;;) {
      try{return await withLock(root,async()=>{
        const document=await read(),result=await action(document.value);
        lossless(document.value);
        await storage.write(path,document.value,{expectedRevision:document.revision,conflictCode:'WORKSPACE_STATE_CONFLICT'});
        return result;
      });}catch(error){if(error.code!=='BUSY'||Date.now()>=end)throw error;await new Promise(resolve=>setTimeout(resolve,10));}
    }
  }
  return {path,read,update};
}

export function attemptHash(attempt) {
  const {updatedAt,...content}=attempt;
  return fingerprint(content);
}
export const refusal=(code,message,extra={})=>({status:'refused',code,message,agentLaunched:false,...extra});
