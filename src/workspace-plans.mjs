import {ticketOf} from '../integrations/tickets/contract.mjs';
import { join,resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { AppError,object,text,fail } from './common.mjs';
import { createRepositoryPreview } from './repository-preview.mjs';
import { fingerprint,lossless,refusal,activeAttempt } from './workspace-state.mjs';
import { inspectTarget } from './workspace-paths.mjs';
import { observeBase,branches,supportsWorkspaceGit,fullSha,branchConflict,repositoryIdentity } from './workspace-git.mjs';
import { createFetchRegistry } from './fetch-registry.mjs';
import { runGitGroup } from './git-process-group.mjs';

export function planInput(input) {
  object(input);
  if(Object.keys(input).some(key=>!['issueId','tool','role','reviewCommit','baseSource'].includes(key)))fail('INVALID_ARGUMENT','Only issueId, tool, role, reviewCommit and baseSource are accepted.');
  text(input.issueId,'issueId',200);
  if(!['codex','claude'].includes(input.tool)||!['dev','review'].includes(input.role))fail('INVALID_ARGUMENT','Choose a dev or review role and an allowed tool family.');
  if(input.role==='review'&&!fullSha(input.reviewCommit))fail('INVALID_ARGUMENT','A review requires its exact full commit SHA.');
  if(input.role==='dev'&&input.reviewCommit!==undefined)fail('INVALID_ARGUMENT','Development cannot use a review commit.');
  if(input.baseSource!==undefined&&(!['local','origin'].includes(input.baseSource)||input.role!=='dev'))fail('INVALID_ARGUMENT','Development baseSource must be local or origin.');
  return {...input};
}
const safeTicket=issue=>{
  const identifier=typeof issue.identifier==='string'?issue.identifier:issue.id;
  return identifier.toLowerCase().replace(/[^a-z0-9-]/g,'-').replace(/^-+|-+$/g,'').slice(0,50)||'issue-'+fingerprint(issue.id).slice(0,12);
};
async function branchFor(issue,main,instanceId,git,repo) {
  const value=issue.branchName;
  let valid=typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9._/-]{0,98}$/.test(value)&&!value.startsWith('refs/')&&!value.includes('//')&&!value.split('/').some(part=>part.startsWith('.'))&&value.toLowerCase()!==main.toLowerCase()&&value.toUpperCase()!=='HEAD';
  if(valid){try{await git(repo,['check-ref-format','--branch',value]);}catch{valid=false;}}
  const branch=valid?value:`fabrique-console/${safeTicket(issue)}-${instanceId}`;
  return {branch,branchSource:valid?'tracker':'fallback'};
}
export function manifestHash(plan) {
  const {fetch,...base}=plan.base;
  return fingerprint({planId:plan.planId,instanceId:plan.instanceId,input:plan.input,issueFingerprint:plan.issueFingerprint,configRevision:plan.configRevision,projectKey:plan.projectKey,repoKey:plan.repoKey,repo:plan.repo,gitCommonDir:plan.gitCommonDir,repositoryIdentity:plan.repositoryIdentity,worktreesRoot:plan.worktreesRoot,worktree:plan.worktree,branch:plan.branch,branchSource:plan.branchSource,base:{...base,fetchStatus:fetch.status},gitVersion:plan.gitVersion,laneSnapshot:plan.laneSnapshot});
}

export function createWorkspacePlans({readConfig,getTickets,git,invoke,store,worktreesRoot:fixedRoot=null,fetchTimeoutMs=30000,fetchProof={},fetchWaitMs}) {
  const fetches=createFetchRegistry({store,...fetchProof,waitMs:fetchWaitMs??fetchProof.waitMs??5000});
  async function fresh(planInput) {
    const {config,revision}=await readConfig();
    if(config.version!==2)fail('CONFIG_V2_REQUIRED','Workspace preparation requires configuration version 2.');
    const issue=ticketOf(await (await getTickets()).detail(planInput.issueId,{refresh:true}));
    const selected=await createRepositoryPreview({readConfig:async()=>({config,revision}),git}).preview({issue});
    if(selected.status!=='resolved')return {refused:selected};
    return {config,revision,issue,selected};
  }
  async function observe(input,seed={}) {
    const loaded=await fresh(input);if(loaded.refused)return loaded.refused;
    const {config,revision,issue,selected}=loaded,repo=selected.repository.path,gitCommonDir=selected.repository.gitCommonDir;
    const gitVersion=await supportsWorkspaceGit(invoke,repo);
    const identity=await repositoryIdentity(repo,gitCommonDir);
    const instanceId=seed.instanceId??randomUUID(),planId=seed.planId??randomUUID();
    const {value:state}=await store.read();
    const active=state.attempts.find(a=>activeAttempt(a)&&a.role==='dev'&&input.role==='dev'&&a.issueId===issue.id&&a.gitCommonDir===gitCommonDir);
    if(active)return refusal('TICKET_ALREADY_RESERVED','This ticket already owns a development preparation in this Git.',{preparationId:active.preparationId});
    const previous=state.plans.filter(p=>p.gitCommonDir===gitCommonDir&&p.base.mainBranch===selected.repository.mainBranch&&p.base.fetch.lastSucceededAt).map(p=>p.base.fetch.lastSucceededAt).sort().at(-1)??null;
    const base=await observeBase({git,invoke,repo,mainBranch:selected.repository.mainBranch,lastSucceededAt:previous,reviewCommit:input.reviewCommit,baseSource:input.baseSource??'local',fetchTimeoutMs,runFetch:(cwd,args,options)=>fetches.run(gitCommonDir,beforeGo=>runGitGroup(cwd,args,{...options,beforeGo}))});
    const choice=input.role==='dev'?await branchFor(issue,base.mainBranch,instanceId,git,repo):{branch:null,branchSource:'detached'};
    if(choice.branch&&(await branches(git,repo)).some(branch=>branchConflict(branch,choice.branch)))return refusal('BRANCH_COLLISION','The proposed branch conflicts with an existing branch name or directory prefix.');
    // A trial keeps its worktrees in its own root, whatever the configuration names.
    const worktreesRoot=fixedRoot??config.worktreesRoot,worktree=join(worktreesRoot,selected.projectKey,`${selected.repository.key}-${safeTicket(issue)}-${input.role}-${instanceId}`);
    await inspectTarget(worktreesRoot,worktree,repo,gitCommonDir);
    const plan=lossless({status:'planned',planId,instanceId,sessionId:seed.sessionId??randomUUID(),runId:seed.runId??randomUUID(),createdAt:seed.createdAt??new Date().toISOString(),input,issue:{id:issue.id,identifier:safeTicket(issue),updatedAt:issue.updatedAt??null},issueFingerprint:fingerprint(JSON.parse(JSON.stringify(issue))),configRevision:revision,projectKey:selected.projectKey,repoKey:selected.repository.key,repo,gitCommonDir,repositoryIdentity:identity,worktreesRoot,worktree,...choice,base,gitVersion,laneSnapshot:state.attempts.filter(a=>activeAttempt(a)&&a.role==='dev'&&a.gitCommonDir===gitCommonDir).map(a=>a.preparationId).sort(),needsConfirmation:input.role==='dev'&&(!base.verified||['behind','diverged','unknown'].includes(base.relation)),agentLaunched:false});
    return {...plan,manifestHash:manifestHash(plan)};
  }
  async function plan(input) {
    input=planInput(input);
    try {
      const result=await observe(input);if(result.status!=='planned')return result;
      await store.update(state=>{state.plans.push(result);});return result;
    }catch(error){if(error instanceof AppError&&error.code!=='INVALID_ARGUMENT')return refusal(error.code,error.message);throw error;}
  }
  return {plan,observe,fresh,inspectFetches:fetches.inspect,abandonFetch:fetches.abandon};
}
