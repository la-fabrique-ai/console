import { performance } from 'node:perf_hooks';
import { createEnrichedTicketReader } from './ticket-read.mjs';
import { qualifyTicket } from './ticket-qualification.mjs';
import { fingerprint } from './workspace-state.mjs';
import { revisionOf } from './durable-storage.mjs';
import { fail } from './common.mjs';

export async function missionSource(context,input,{budgetMs=23000,monotonicNow=()=>performance.now()}={}) {
  const deadline=monotonicNow()+Math.min(23000,budgetMs),before=await context.readConfig(),{config}=before;
  if(config.version!==2)fail('CONFIG_V2_REQUIRED','Mission preview requires configuration version 2.');
  const project=config.projects.find(project=>project.key===input.key);
  if(!project)fail('NOT_FOUND','No configured project uses this key.');
  const read=async(kind,args)=>{
    const remaining=deadline-monotonicNow();if(remaining<=0)return null;
    const reader=createEnrichedTicketReader({...context,loadConfig:async()=>config,options:{...context.ticketReadOptions,budgetMs:remaining}});
    return reader[kind]({...args,key:input.key,refresh:true});
  };
  let issueRead,failureReason;
  try{issueRead=await read('issue',{issueId:input.issueId});}
  catch(error){failureReason=error.code==='TICKET_SCOPE'?'QUALIFICATION_SCOPE_UNVERIFIED':'QUALIFICATION_SOURCE_UNAVAILABLE';}
  const qualification={...qualifyTicket(config,{key:input.key,issueId:input.issueId,read:issueRead,failureReason}),configRevision:before.revision};
  if(!qualification.ready.ok)return {refused:'TICKET_NOT_READY',qualification};
  const issue=issueRead.data.issue,{tool,level,repoKey}=qualification.selection;
  const profile=config.profiles.dev[tool]?.[level];
  if(!profile)return {refused:'MISSION_PROFILE_REQUIRED'};
  if(!input.plan&&level!=='léger')return {refused:'MISSION_PLAN_REQUIRED'};
  let plan=null;
  if(input.plan) {
    if(issue.projectId&&input.plan.projectId!==issue.projectId)return {refused:'MISSION_PLAN_SCOPE'};
    let response;try{response=await read('document',input.plan);}catch{return {refused:'MISSION_PLAN_UNVERIFIED'};}
    const document=response?.data?.document;
    if(!response?.complete||response.cached||document?.id!==input.plan.documentId||document.truncated||typeof document.content!=='string'||!document.content.trim())return {refused:'MISSION_PLAN_UNVERIFIED'};
    plan={projectId:input.plan.projectId,documentId:document.id,title:document.title,url:document.url,updatedAt:document.updatedAt,
      content:document.content,contentHash:revisionOf(document.content),approved:false,untrusted:true};
  }
  if((await context.readConfig()).revision!==before.revision)return {refused:'MISSION_SOURCE_CHANGED'};
  return {config,configRevision:before.revision,project,repository:project.repos.find(repo=>repo.key===repoKey),issue,plan,qualification,
    profile:{...profile,profilesVersion:config.profiles.version},observedAt:issueRead.observedAt,
    sourceHash:fingerprint({issue,plan,configRevision:before.revision}),scope:issueRead.scope};
}
