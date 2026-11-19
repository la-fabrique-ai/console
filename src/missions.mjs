import { randomUUID } from 'node:crypto';
import { object,text,fail,AppError } from './common.mjs';
import { createWorkspacePlans } from './workspace-plans.mjs';
import { activeAttempt,refusal } from './workspace-state.mjs';
import { reservationLimits } from './workspace-policy.mjs';
import { legacyClaims } from './workspace-reservations.mjs';
import { missionSource } from './mission-source.mjs';
import { missionPrompt } from './mission-prompt.mjs';
import { connectorAgentContext } from '../integrations/tickets/factory.mjs';
import { createMissionStore } from './mission-store.mjs';
import { ticketSections } from './ticket-qualification.mjs';

function previewInput(input) {
  object(input);
  if(Object.keys(input).some(key=>!['key','issueId','role','baseSource','plan','sourceRunId','continuationOf'].includes(key)))fail('INVALID_ARGUMENT','Unexpected mission preview argument.');
  text(input.key,'project key',48);text(input.issueId,'internal issue ID',200);
  if(!['dev','review','po','designer','produit','bugs'].includes(input.role))fail('INVALID_ARGUMENT','Choose a declared mission role.');
  if(input.baseSource!==undefined&&!['local','origin'].includes(input.baseSource))fail('INVALID_ARGUMENT','Choose a local or origin base.');
  if(input.plan!==undefined) {
    object(input.plan);
    if(Object.keys(input.plan).some(key=>!['projectId','documentId'].includes(key)))fail('INVALID_ARGUMENT','A plan is selected by projectId and documentId only.');
    text(input.plan.projectId,'plan projectId',200);text(input.plan.documentId,'plan documentId',200);
  }
  for(const key of ['sourceRunId','continuationOf'])if(input[key]!==undefined)text(input[key],key,200);
  return input;
}
const refused=(code,extra={})=>refusal(code,'La mission ne peut pas être préparée. Consultez la raison et demandez un nouvel aperçu.',{launchAllowed:false,...extra});

export function createMissions(context,options={}) {
  const now=options.now??Date.now,missions=createMissionStore({...context,now});
  async function preview(raw) {
    const input=previewInput(raw);
    if(input.role!=='dev')return refused('MISSION_ROLE_UNAVAILABLE');
    if(input.sourceRunId!==undefined||input.continuationOf!==undefined)return refused('MISSION_CONTINUATION_UNAVAILABLE');
    const source=await missionSource(context,input,options);
    if(source.refused)return refused(source.refused,source.qualification?{qualification:source.qualification}:{});
    const {issue,config,configRevision,qualification}=source,{tool,level}=qualification.selection;
    // Bind the existing workspace observer to THIS verified enriched snapshot.
    // No MCP read, no independently chosen issue and no worktree creation.
    const projected={id:issue.id,identifier:issue.identifier,updatedAt:issue.updatedAt,team:{id:source.scope.teamId},project:issue.projectId?{id:issue.projectId}:null,labels:issue.labels.items};
    const planner=createWorkspacePlans({...context,readConfig:async()=>({config,revision:configRevision}),getTickets:async()=>({detail:async()=>({issue:projected})}),...context.workspaceOptions});
    try {
      const plan=await planner.observe({issueId:issue.id,tool,role:'dev',...(input.baseSource?{baseSource:input.baseSource}:{})});
      if(plan.status!=='planned')return refused(plan.code,plan.preparationId?{preparationId:plan.preparationId}:{});
      if((await context.readConfig()).revision!==configRevision)return refused('MISSION_SOURCE_CHANGED');
      const createdAt=new Date(now()).toISOString(),expiresAt=new Date(now()+15*60*1000).toISOString();
      const sections=ticketSections(issue.description);
      const mission={schemaVersion:1,missionId:randomUUID(),createdAt,expiresAt,issue,criteria:sections.get('criteria')[0].join('\n').trim(),verification:sections.get('verification')[0].join('\n').trim(),project:source.project.key,repo:source.repository.key,role:'dev',tool,level,
        profile:source.profile,machine:null,base:{...plan.base,branch:plan.base.mainBranch,sha:plan.base.chosenSha,checkedAt:plan.base.fetch.attemptedAt,upToDate:plan.base.verified&&plan.base.relation==='equal'},
        worktree:plan.worktree,branch:plan.branch,context:{parent:issue.parent,plan:source.plan,dependencies:issue.dependencies.blockedBy.items,design:{url:null},untrusted:true},
        qaProfiles:{...source.repository.tests},ready:qualification.ready,configRevision,source:{observedAt:source.observedAt,sourceHash:source.sourceHash,untrusted:true},workspacePlan:plan,promptVersion:'dev-1'};
      mission.prompt=missionPrompt(mission,qualification.template,{connector:connectorAgentContext(config)});
      const {value:state}=await context.store.read(),legacy=await legacyClaims(context.loadState,context.git),active=state.attempts.filter(activeAttempt),limits=reservationLimits(config,source.project.key);
      const dev=active.filter(a=>a.role==='dev').length+legacy.claims.filter(a=>a.role==='dev').length;
      const review=active.filter(a=>a.role==='review'&&a.projectKey===source.project.key).length+legacy.claims.filter(a=>a.role==='review'&&a.projectKey===source.project.key).length;
      const projectDev=active.filter(a=>a.role==='dev'&&a.projectKey===source.project.key).length+legacy.claims.filter(a=>a.role==='dev'&&a.projectKey===source.project.key).length;
      const projectDevLimit=source.project.wip?.dev??config.wip.dev;
      const capacity={dev:{used:dev,limit:limits.dev},projectDev:{atLeast:projectDev,total:null,limit:projectDevLimit},review:{atLeast:review,total:null,limit:limits.review}};
      const warnings=[{code:'REVIEW_QUEUE_UNMEASURED',message:`File de revue : au moins ${review}, total non mesuré.`}];
      if(review>=limits.review)warnings.push({code:'REVIEW_QUEUE_LIMIT',message:'La borne basse connue de la file de revue atteint le plafond. Confirmez que vous l’avez vu.'});
      if(projectDev>=projectDevLimit)warnings.push({code:'PROJECT_DEV_LIMIT',message:'Le nombre connu de développements du projet atteint le plafond indiqué.'});
      const legacyCollision=legacy.claims.some(claim=>claim.role==='dev'&&(!claim.gitCommonDir||claim.gitCommonDir===plan.gitCommonDir));
      const expectedHash=await missions.publish(mission);
      return {status:'preview',mission,expectedHash,expiresAt,expired:false,launchAllowed:false,
        launchBlockers:['MISSION_LAUNCH_NOT_IMPLEMENTED',...(dev>=limits.dev?['GLOBAL_CAPACITY']:[]),...(legacyCollision?['LEGACY_RESERVATION_UNKNOWN']:[])],capacity,warnings,
        confirmation:{required:true,baseRequired:plan.needsConfirmation,parallelRequired:plan.laneSnapshot.length>0,reviewQueueAcknowledgementRequired:review>=limits.review}};
    }catch(error){if(error instanceof AppError)return refused(error.code);throw error;}
  }
  async function read(input) {
    object(input);if(Object.keys(input).some(key=>key!=='missionId'))fail('INVALID_ARGUMENT','Mission read accepts missionId only.');
    return missions.read(input.missionId);
  }
  return {preview,read};
}
