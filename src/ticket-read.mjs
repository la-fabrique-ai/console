import { text } from './common.mjs';
import { fail } from './common.mjs';
import {ticketConnection} from '../integrations/tickets/factory.mjs';

// The configured project of a key, with the Tracker team the reads of the Issues page need.
export async function teamProject(loadConfig,key) {
  text(key,'project key',48);
  const config=await loadConfig(),project=config.projects.find(project=>project.key===key);
  if(!project)fail('NOT_FOUND','No configured project uses this key.');
  const scope=ticketConnection(config,project).scope;
  if(!scope.id)fail('TEAM_NOT_CONFIGURED','Une équipe de tickets doit être configurée pour cette lecture.');
  return {...project,teamId:scope.id};
}
// An issue as a list shows it: no description, no comments, no assignee; its team is the one of the list. A team
// of seven hundred issues weighs a megabyte whole, and the screens of the window have little memory.
export const briefIssue=issue=>({id:issue.id,identifier:issue.identifier,title:issue.title,priority:issue.priority,state:issue.state?{name:issue.state.name??null,type:issue.state.type??null}:null,
  project:issue.project?{id:issue.project.id,name:issue.project.name||'—'}:null,
  labels:(issue.labels||[]).map(l=>({name:l.name,...(l.color?{color:l.color}:{})})),createdAt:issue.createdAt,updatedAt:issue.updatedAt??null,
  parentId:typeof issue.parentId==='string'?issue.parentId:null,blocks:Number.isSafeInteger(issue.blocks)&&issue.blocks>=0?issue.blocks:0,blockedBy:Number.isSafeInteger(issue.blockedBy)&&issue.blockedBy>=0?issue.blockedBy:0});
export function createTicketReader({getTickets,loadConfig}) {
  const list=async ({scope,filter,cursor,include,refresh=false,teamId,...legacy}={})=>{
    const data=await (await getTickets()).list({scope:scope??(teamId?{id:teamId}:undefined),filter:filter??legacy,...(cursor!==undefined?{cursor}:{}),...(include?{include}:{}),refresh});
    return {...data,issues:data.tickets??data.issues,updatedAt:data.freshness?.observedAt??data.updatedAt,cached:data.freshness?.cached??data.cached};
  };
  const detail=async input=>{const id=text(input.id,'issue id',200);const data=await (await getTickets()).detail(id,{refresh:input.refresh===true});return {...data,issue:data.ticket??data.issue};};
  const meta=async input=>{const data=await (await getTickets()).meta({refresh:input.refresh===true});return {...data,teams:data.scopes??data.teams};};
  // The backlog of the team: issues in no project, newest first. With all:true, every issue of the team. Each issue
  // as a list shows it (briefIssue).
  const backlog=async input=>{
    if(input.refresh!==undefined&&typeof input.refresh!=='boolean')fail('INVALID_ARGUMENT','refresh must be a boolean.');
    if(input.all!==undefined&&typeof input.all!=='boolean')fail('INVALID_ARGUMENT','all must be a boolean.');
    const project=await teamProject(loadConfig,input.key),tickets=await getTickets();
    const data=await tickets.list({scope:{id:project.teamId},filter:{backlog:input.all!==true},refresh:input.refresh===true});
    return {...data,issues:(data.tickets??data.issues).map(briefIssue).sort((a,b)=>String(b.createdAt??'').localeCompare(String(a.createdAt??''))),teamId:project.teamId};
  };
  // The Tracker projects of every configured team, with every one of their issues (open first, then completed and
  // canceled): what the "Mes issues" page lists. One read per team; a team that cannot be read says so in its own
  // entry, the others are still listed.
  const ORDER={started:0,triage:1,unstarted:2,backlog:3,completed:4,canceled:5,unknown:6},ACTIVITY_LIMIT=300;
  const myIssues=async input=>{
    if(input.refresh!==undefined&&typeof input.refresh!=='boolean')fail('INVALID_ARGUMENT','refresh must be a boolean.');
    const tickets=await getTickets(),teams=[],activity=[];let cached=true,updatedAt=null,relationRank=2,readTeams=0;
    const brief=issue=>({id:issue.id,identifier:issue.identifier,title:issue.title,url:issue.url,priority:issue.priority,state:issue.state||null,assignee:issue.assignee||null,labels:(issue.labels||[]).map(l=>({name:l.name,...(l.color?{color:l.color}:{})})),createdAt:issue.createdAt,updatedAt:issue.updatedAt??null,
      parentId:typeof issue.parentId==='string'?issue.parentId:null,blocks:Number.isSafeInteger(issue.blocks)&&issue.blocks>=0?issue.blocks:0,blockedBy:Number.isSafeInteger(issue.blockedBy)&&issue.blockedBy>=0?issue.blockedBy:0});
    // The teams are read at once, not one after the other; each keeps its place in the answer.
    const config=await loadConfig(),configured=config.projects.map(p=>({...p,teamId:ticketConnection(config,p).scope.id})).filter(p=>p.teamId);
    const reads=await Promise.all(configured.map(team=>tickets.list({scope:{id:team.teamId},refresh:input.refresh===true}).then(data=>({data}),error=>({error}))));
    for(const [index,team] of configured.entries()) {
      try {
        const {data,error}=reads[index];if(error)throw error;
        cached=cached&&data.cached===true;if(data.updatedAt&&(!updatedAt||data.updatedAt>updatedAt))updatedAt=data.updatedAt;
        const projects=new Map();
        for(const issue of data.tickets??data.issues) {
          activity.push({...brief(issue),team:{key:team.key,name:team.name||team.key},project:issue.project?{id:issue.project.id,name:issue.project.name||'—'}:null});
          if(!issue.project?.id)continue;
          const entry=projects.get(issue.project.id)||{id:issue.project.id,name:issue.project.name||'—',counts:{},states:new Map(),total:0,issues:[]};
          const type=issue.state?.type||'unknown',name=issue.state?.name||'—';entry.counts[type]=(entry.counts[type]||0)+1;entry.total++;
          const state=entry.states.get(name)||{name,type,count:0};state.count++;entry.states.set(name,state);
          entry.issues.push(brief(issue));
          projects.set(issue.project.id,entry);
        }
        // The states of a project, in Tracker's words, in the order of their types.
        for(const entry of projects.values())entry.states=[...entry.states.values()].sort((a,b)=>(ORDER[a.type]??9)-(ORDER[b.type]??9)||a.name.localeCompare(b.name));
        for(const entry of projects.values())entry.issues.sort((a,b)=>(ORDER[a.state?.type]??9)-(ORDER[b.state?.type]??9)||String(a.identifier??'').localeCompare(String(b.identifier??''),undefined,{numeric:true}));
        teams.push({key:team.key,name:team.name||team.key,teamId:team.teamId,projects:[...projects.values()].sort((a,b)=>a.name.localeCompare(b.name))});
        relationRank=Math.min(relationRank,Math.max(0,['none','parent','full'].indexOf(data.relations)));readTeams++;
      }catch(error) {teams.push({key:team.key,name:team.name||team.key,teamId:team.teamId,projects:[],error:{code:error.code||'INTERNAL_ERROR',message:error.message}});}
    }
    // The activity: every issue of every team, the most recently updated first.
    activity.sort((a,b)=>String(b.updatedAt??'').localeCompare(String(a.updatedAt??'')));
    return {teams,activity:activity.slice(0,ACTIVITY_LIMIT),relations:readTeams?['none','parent','full'][relationRank]:'none',cached,updatedAt};
  };
  return {list,detail,meta,backlog,myIssues};
}

export function createEnrichedTicketReader({getTickets,loadConfig,options={}}){
  const read=kind=>async input=>{
    const allowed=['key','refresh',...(kind==='issues'?['projectId']:kind==='issue'?['issueId']:kind==='document'?['projectId','documentId']:[])];
    if(Object.keys(input).some(key=>!allowed.includes(key)))fail('INVALID_ARGUMENT','Unexpected enriched Tracker read argument.');
    text(input.key,'project key',48);
    if(input.refresh!==undefined&&typeof input.refresh!=='boolean')fail('INVALID_ARGUMENT','refresh must be a boolean.');
    for(const field of ['projectId','issueId','documentId'])if(input[field]!==undefined)text(input[field],field,200);
    if(kind==='issue')text(input.issueId,'issueId',200);
    if(kind==='document'){text(input.projectId,'projectId',200);text(input.documentId,'documentId',200);}
    const project=await teamProject(loadConfig,input.key);
    const connector=await getTickets(),scope={key:project.key,id:project.teamId},refresh=input.refresh===true;
    if(kind==='issue'||kind==='document')return connector.detail(kind==='issue'?input.issueId:input.documentId,{scope,include:[kind==='issue'?'enriched':'document'],projectId:input.projectId,refresh,readOptions:options});
    return connector.list({scope,filter:input.projectId?{projectId:input.projectId}:{},include:[kind==='projects'?'projects':'enriched'],refresh,readOptions:options});
  };
  return {projects:read('projects'),issues:read('issues'),issue:read('issue'),document:read('document')};
}
