import {readdir} from 'node:fs/promises';

// Bundled adapters only: request data never determines an import path. V0 ships one.
const folders=(await readdir(new URL('./',import.meta.url),{withFileTypes:true})).filter(entry=>entry.isDirectory()&&/^[a-z][a-z0-9-]*$/.test(entry.name));
const definitions=await Promise.all(folders.map(async entry=>(await import(new URL(`./${entry.name}/definition.mjs`,import.meta.url))).definition));
if(definitions.length!==1)throw new Error('Exactly one bundled ticket connector is required.');
const active=definitions[0];
export const connectorAgentContext=config=>active.agentContext(config);
export const normalizeTicketConfig=input=>active.configInput(input);
export const validateTicketSettings=settings=>active.settings(settings);
export const normalizeBackendOptions=options=>active.backendOptions(options);
export const normalizeTicketMission=mission=>active.mission(mission);
export const ticketState=record=>active.ticketState(record);
export const ticketAction=action=>active.action(action);
export const ticketError=error=>active.error(error);
export const ticketConnection=(config,project=null)=>({id:config.ticketConnector??'primary',driver:active.id,...validateTicketSettings(normalizeTicketConfig(config).tracker),...(project?{scope:active.scope(project)}:{})});
const guarded=async task=>{try{return await task();}catch(error){throw ticketError(error);}};
function boundary(connector){
  return new Proxy(connector,{get(target,key){const value=Reflect.get(target,key);return typeof value==='function'?(...args)=>guarded(()=>value.apply(target,args)):value;}});
}
export function createTicketFactory(raw){
  const options=active.factoryOptions(raw);
  let runtime;
  const load=()=>runtime??=active.runtime().then(module=>module.createTicketFactory({...options,loadConfig:async()=>normalizeTicketConfig(await options.loadConfig())}));
  return {
    getTickets:async()=>boundary(await guarded(async()=> (await load()).getTickets())),
    createWriter:context=>Object.fromEntries(['create','mutate'].map(kind=>[kind,input=>guarded(async()=> (await load()).createWriter(context)[kind](input))])),
  };
}
export const loginTickets=options=>guarded(async()=> (await active.runtime()).loginTickets(options));
export const ticketLoginMain=options=>guarded(async()=> (await active.runtime()).ticketLoginMain(options));
