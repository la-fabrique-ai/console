import { join } from 'node:path';
import { fail, readJSON, text } from './common.mjs';
import { validateConfig } from './config.mjs';
import { createDurableStorage } from './durable-storage.mjs';
import { poStep } from './po-method.mjs';

const emptyConfig={version:1,projects:[]};
export const now=()=>new Date().toISOString();
// The session that leads the work of an issue: a Lead, or a PO of the first version, treated as one.
export const isLead=session=>session?.role==='po'||session?.role==='lead';

export function createStorage({root}) {
  const configPath=join(root,'config.json'),statePath=join(root,'state.json');
  const loadConfig=async()=>validateConfig(await readJSON(configPath,emptyConfig));
  const loadState=async()=>{
    const state=await readJSON(statePath,{version:1,sessions:[]});
    if(state.version!==1||!Array.isArray(state.sessions)) fail('INVALID_DATA','Unsupported or invalid local session state.');
    return {...state,sessions:state.sessions.map(s=>s?.role==='po'?{...s,step:poStep(s.step)}:s)};
  };
  const getSession=(state,id)=>{text(id,'sessionId',200);const session=state.sessions.find(s=>s.id===id);if(!session)fail('NOT_FOUND','This local session was not found.');return session;};
  const readConfig=async()=>{
    const {value,revision}=await createDurableStorage().read(configPath);
    return {config:validateConfig(value??emptyConfig),revision};
  };
  return {configPath,statePath,loadConfig,loadState,getSession,readConfig};
}
