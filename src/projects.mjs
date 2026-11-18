import {ticketsOf} from '../integrations/tickets/contract.mjs';
import { join } from 'node:path';
import { AppError, fail, text, withLock, readJSON, canonical, clean } from './common.mjs';
import { validateConfig } from './config.mjs';
import { createDurableStorage } from './durable-storage.mjs';
import { resolveRepositories } from './repository-config.mjs';

export function createProjects({root,configPath,loadConfig,getTickets,git}) {
  const storage=createDurableStorage();
  async function saveConfig(input) {
    return withLock(root,async()=>{
      const journal=await readJSON(join(root,'migrations','config-v1-v2.json'),null);
      if(journal?.status==='prepared')fail('MIGRATION_PENDING','Resume the pending configuration migration before saving.');
      const current=await storage.read(configPath),stored=current.value;
      if(stored?.version===2&&input.config?.version===1)fail('STALE_CONFIG_VERSION','A version 1 client cannot replace a version 2 configuration.');
      if(stored?.version===1&&input.config?.version===2)fail('MIGRATION_REQUIRED','Use the confirmed configuration migration to convert version 1.');
      const config=validateConfig(input.config);
      if(config.version===2&&canonical(clean(config))!==canonical(config))fail('INVALID_CONFIG','Configuration cannot be serialized without alteration.');
      if(config.version===2) {
        if(!Object.hasOwn(input,'baseRevision'))fail('BASE_REVISION_REQUIRED','Read the current configuration and supply its baseRevision.');
        if(input.baseRevision!==current.revision)fail('CONFIG_CONFLICT','The configuration changed since it was read.');
      }
      await resolveRepositories(config,{git});
      // Resolving an alias can introduce values that the output filter would alter.
      // This guard deliberately applies to V1 saves as well as V2.
      if(canonical(clean(config))!==canonical(config))fail('INVALID_CONFIG','Resolved configuration cannot be serialized without alteration.');
      if(current.raw!==null)await storage.backup(join(root,'backups',`config-save-${current.revision}.json`),current.raw);
      const {revision}=await storage.write(configPath,config,{expectedRevision:current.revision});
      return config.version===2?{config,revision}:{config};
    });
  }
  async function projectSummary(input) {
    const key=text(input.key,'project key',48);
    if(input.refresh!==undefined&&typeof input.refresh!=='boolean')fail('INVALID_ARGUMENT','refresh must be a boolean.');
    const project=(await loadConfig()).projects.find(p=>p.key===key);
    if(!project)fail('NOT_FOUND','No configured project uses this key.');
    const filter={scope:project.teamId?{id:project.teamId}:undefined,filter:project.projectId?{projectId:project.projectId}:{},refresh:input.refresh===true};
    let timer,result;
    try {
      const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>reject(new AppError('TICKET_TIMEOUT','The project summary exceeded 25 seconds. Retry this project separately.')),25000);});
      result=await Promise.race([(async()=>(await getTickets()).list(filter))(),deadline]);
    }finally{clearTimeout(timer);}
    const tickets=ticketsOf(result),observedAt=result.freshness?.observedAt??result.updatedAt;
    if(!Array.isArray(tickets)||result.complete===false||result.hasNextPage===true)fail('TICKET_INCOMPLETE','The tracker did not return a complete issue list for this project.');
    if(typeof observedAt!=='string'||!Number.isFinite(Date.parse(observedAt)))fail('TICKET_API','The tracker did not provide a valid summary observation time.');
    const openTypes=new Set(['triage','backlog','unstarted','started','ready','active']),closedTypes=new Set(['completed','canceled','done']);
    let open=0,unknown=0;
    for(const issue of tickets) {
      const type=issue?.status?.category??issue?.state?.type;
      if(openTypes.has(type))open++;
      else if(!closedTypes.has(type))unknown++;
    }
    return {key,open:unknown?null:open,total:tickets.length,unknown,updatedAt:observedAt,...(typeof result.cached==='boolean'?{cached:result.cached}:{}),source:'tracker',complete:true};
  }
  return {saveConfig,projectSummary};
}

export function selectProject(config,issue) {
  const projectMatches=config.projects.filter(p=>p.projectId&&issue.project?.id&&p.projectId===issue.project.id);
  const matches=projectMatches.length?projectMatches:config.projects.filter(p=>!p.projectId&&p.teamId===issue.team?.id);
  if(!matches.length) fail('UNMAPPED_PROJECT','No repository mapping explicitly authorizes this Tracker issue.');
  if(matches.length!==1) fail('AMBIGUOUS_PROJECT','Several mappings match this Tracker issue. Resolve the configuration.');
  return matches[0];
}
