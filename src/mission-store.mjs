import { join } from 'node:path';
import * as fs from 'node:fs/promises';
import { constants } from 'node:fs';
import { clean,canonical,fail,privateDir } from './common.mjs';
import { createDurableStorage,revisionOf } from './durable-storage.mjs';

const validId=value=>typeof value==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
export function missionId(value) {if(!validId(value))fail('INVALID_ARGUMENT','Expected a complete mission UUID.');return value;}
export function createMissionStore({root,store,readConfig,now=Date.now}) {
  // Nonblocking open closes the lstat/open race too: fstat rejects special files
  // without waiting for a FIFO writer. Ordinary file/fsync semantics stay intact.
  const folder=join(root,'missions'),storage=createDurableStorage({fs:{...fs,open:(path,flags,...args)=>fs.open(path,flags|constants.O_NONBLOCK,...args)}}),path=id=>join(folder,missionId(id)+'.json');
  async function publish(mission) {
    if(canonical(clean(mission))!==canonical(mission))fail('MISSION_UNSERIALIZABLE','The mission cannot be stored without alteration.');
    const raw=JSON.stringify(mission,null,2)+'\n',hash=revisionOf(raw);
    await privateDir(folder);await storage.backup(path(mission.missionId),raw);
    await store.update(async state=>{
      if((await readConfig()).revision!==mission.configRevision)fail('MISSION_SOURCE_CHANGED','Configuration changed before mission publication.');
      state.missionPreviews??=[];
      state.plans.push(mission.workspacePlan);
      state.missionPreviews.push({missionId:mission.missionId,hash,planId:mission.workspacePlan.planId,createdAt:mission.createdAt,expiresAt:mission.expiresAt});
    });
    return hash;
  }
  async function read(id) {
    missionId(id);
    const {value:state}=await store.read(),record=state.missionPreviews?.find(record=>record.missionId===id);
    if(!record)fail('NOT_FOUND','No published mission preview uses this identifier.');
    const directory=await fs.lstat(folder);
    if(!directory.isDirectory()||directory.isSymbolicLink())fail('UNSAFE_STORAGE','Mission storage must be a real directory.');
    const document=await storage.read(path(id)),mission=document.value;
    if(document.revision!==record.hash||mission?.schemaVersion!==1||mission.missionId!==id||mission.expiresAt!==record.expiresAt||mission.createdAt!==record.createdAt||mission.workspacePlan?.planId!==record.planId)fail('MISSION_INTEGRITY','The stored mission differs from its published preview. Request another preview.');
    return {status:'read',mission,expectedHash:document.revision,expiresAt:record.expiresAt,expired:now()>=Date.parse(record.expiresAt),launchAllowed:false};
  }
  return {publish,read};
}
