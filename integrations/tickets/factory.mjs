import {readdir} from 'node:fs/promises';
import {fail} from '../../src/common.mjs';

// Bundled adapters only: request data never determines an import path. The configuration selects one of them
// by its id (`tracker.driver`); ticket content never does.
const folders=(await readdir(new URL('./',import.meta.url),{withFileTypes:true})).filter(entry=>entry.isDirectory()&&/^[a-z][a-z0-9-]*$/.test(entry.name)).sort((a,b)=>a.name.localeCompare(b.name));
const definitions=await Promise.all(folders.map(async entry=>(await import(new URL(`./${entry.name}/definition.mjs`,import.meta.url))).definition));
if(!definitions.length)throw new Error('At least one bundled ticket connector is required.');
const registry=new Map(definitions.map(definition=>[definition.id,definition]));
if(registry.size!==definitions.length)throw new Error('Bundled ticket connectors must have distinct ids.');
// The connector used when the configuration names none: the one that served every configuration before the registry.
const defaults=definitions.filter(definition=>definition.default===true);
if(defaults.length!==1)throw new Error('Exactly one bundled ticket connector must be the default.');
export const DEFAULT_TICKET_DRIVER=defaults[0].id;
export const ticketDrivers=()=>[...registry.keys()];
// Compatibility shims for persisted data and legacy options predate the registry: they come from the default connector.
const legacy=registry.get(DEFAULT_TICKET_DRIVER);

const isObject=value=>Boolean(value)&&typeof value==='object'&&!Array.isArray(value);
// Legacy aliases of the connection settings are resolved by the default connector.
const settingsOf=config=>isObject(config)?legacy.configInput(config).tracker:undefined;
const driverOf=settings=>isObject(settings)?settings.driver:undefined;
function definitionFor(driver) {
  if(driver===undefined)return legacy;
  if(typeof driver!=='string'||!registry.has(driver))fail('INVALID_CONFIG','Unknown ticket connector.');
  return registry.get(driver);
}
const definitionOfConfig=config=>definitionFor(driverOf(settingsOf(config)));

export const connectorAgentContext=config=>definitionOfConfig(config).agentContext(config);
export const normalizeTicketConfig=input=>definitionOfConfig(input).configInput(input);
// The driver is the registry's business: the adapter validates its own settings, and an explicit choice is kept.
export function validateTicketSettings(settings) {
  const driver=driverOf(settings),definition=definitionFor(driver);
  if(driver===undefined)return definition.settings(settings);
  // Nothing but the driver means the adapter's own defaults, exactly as when no settings are given.
  const {driver:_,...rest}=settings;
  return {...definition.settings(Object.keys(rest).length?rest:undefined),driver};
}
export const normalizeBackendOptions=options=>legacy.backendOptions(options);
export const normalizeTicketMission=mission=>legacy.mission(mission);
export const ticketState=record=>legacy.ticketState(record);
export const ticketAction=action=>legacy.action(action);
export const ticketError=error=>legacy.error(error);
export function ticketConnection(config,project=null) {
  const normalized=normalizeTicketConfig(config),definition=definitionOfConfig(normalized);
  return {id:config.ticketConnector??'primary',driver:definition.id,...validateTicketSettings(settingsOf(normalized)),...(project?{scope:definition.scope(project)}:{})};
}
const guarded=async task=>{try{return await task();}catch(error){throw ticketError(error);}};
function boundary(connector){
  return new Proxy(connector,{get(target,key){const value=Reflect.get(target,key);return typeof value==='function'?(...args)=>guarded(()=>value.apply(target,args)):value;}});
}
export function createTicketFactory(raw){
  const options=legacy.factoryOptions(raw);
  const runtimes=new Map();
  // The driver is read from the current configuration on every access, so a changed choice takes effect.
  const load=async()=>{
    const definition=definitionOfConfig(await options.loadConfig());
    if(!runtimes.has(definition.id))runtimes.set(definition.id,definition.runtime().then(module=>module.createTicketFactory({...definition.factoryOptions(raw),loadConfig:async()=>normalizeTicketConfig(await options.loadConfig())})));
    return runtimes.get(definition.id);
  };
  return {
    getTickets:async()=>boundary(await guarded(async()=> (await load()).getTickets())),
    createWriter:context=>Object.fromEntries(['create','mutate'].map(kind=>[kind,input=>guarded(async()=> (await load()).createWriter(context)[kind](input))])),
  };
}
const loginDefinition=options=>definitionFor(options?.driver);
export const loginTickets=options=>guarded(async()=> (await loginDefinition(options).runtime()).loginTickets(options));
export const ticketLoginMain=options=>guarded(async()=> (await loginDefinition(options).runtime()).ticketLoginMain(options));
