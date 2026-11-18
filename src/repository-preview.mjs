import { resolve } from 'node:path';
import { fail, object, clean, canonical } from './common.mjs';
import { validateConfig } from './config.mjs';
import { nativeRealpath } from './repository-config.mjs';

const source="ticket fourni par l'appelant";
const messages={
  CONFIG_V2_REQUIRED:'Configurer les associations de dépôts en version 2.',
  TEAM_REQUIRED:'L’équipe du ticket est manquante. Recharger le ticket.',
  TEAM_NOT_CONFIGURED:'L’équipe autorisée manque dans cette association. Compléter la configuration.',
  TEAM_NOT_AUTHORIZED:'L’équipe du ticket n’est pas autorisée par la configuration.',
  PROJECT_REQUIRED:'Le projet du ticket manque pour cette association restreinte.',
  PROJECT_NOT_AUTHORIZED:'Le projet du ticket n’est pas autorisé par les associations de cette équipe.',
  AMBIGUOUS_PROJECT:'Plusieurs associations autorisent ce ticket. Préciser la configuration.',
  REPO_LABEL_REQUIRED:'Dépôt à préciser : aucun label ne désigne un dépôt configuré.',
  REPO_AMBIGUOUS:'Dépôt à préciser : plusieurs dépôts configurés sont désignés.',
  REPO_UNAVAILABLE:'Le dépôt sélectionné est introuvable ou inaccessible comme dépôt Git.',
  REPO_NOT_WORKTREE:'Le chemin sélectionné n’est pas un checkout Git utilisable.',
  REPO_NOT_ROOT:'Le chemin sélectionné est un sous-dossier. Configurer la racine du dépôt Git.',
  REPO_UNSAFE_PATH:'Les paramètres du dépôt ne peuvent pas être présentés sans altération. Corriger l’association.',
};
const refused=(base,code,details={})=>({...base,status:'refused',code,message:messages[code],...details});

function bounded(value) {
  if(typeof value!=='string'||!value.length||value.length>200||/[\x00-\x1f\x7f]/.test(value))fail('INVALID_ARGUMENT','Expected bounded issue identifiers and labels without control characters.');
  return value;
}
function relation(value,team=false) {
  if(value===undefined||value===null)return null;
  object(value);
  if(team&&(value.id===undefined||value.id===null))return null;
  return bounded(value.id);
}
function issueData(issue) {
  object(issue);
  const id=bounded(issue.id),teamId=relation(issue.team,true),projectId=relation(issue.project);
  const labels=issue.labels===undefined?[]:issue.labels;
  if(!Array.isArray(labels)||labels.length>100)fail('INVALID_ARGUMENT','Issue labels must be an array of at most 100 entries.');
  const values=new Set();
  for(const label of labels) {
    object(label);
    if(label.id===undefined&&label.name===undefined)fail('INVALID_ARGUMENT','Every issue label needs an id or name.');
    for(const field of ['id','name'])if(label[field]!==undefined)values.add(bounded(label[field]));
  }
  const updatedAt=issue.updatedAt===undefined||issue.updatedAt===null?null:bounded(issue.updatedAt);
  if(updatedAt!==null&&!Number.isFinite(Date.parse(updatedAt)))fail('INVALID_ARGUMENT','Invalid issue update time.');
  return {id,teamId,projectId,labels:values,updatedAt};
}

// Provisional V2 policy, isolated for the user: explicit team and no specificity priority.
function authorizedProject(projects,issue) {
  if(issue.teamId===null)return {code:'TEAM_REQUIRED'};
  const team=projects.filter(project=>project.teamId===issue.teamId);
  if(!team.length) {
    const incomplete=projects.some(project=>!project.teamId&&project.projectId===issue.projectId);
    return {code:incomplete?'TEAM_NOT_CONFIGURED':'TEAM_NOT_AUTHORIZED'};
  }
  const matches=team.filter(project=>!project.projectId||project.projectId===issue.projectId);
  if(!matches.length)return {code:issue.projectId===null?'PROJECT_REQUIRED':'PROJECT_NOT_AUTHORIZED'};
  if(matches.length!==1)return {code:'AMBIGUOUS_PROJECT'};
  return {project:matches[0]};
}

// Pure selection only. Physical root/identity verification belongs to the action below.
export function previewRepository(input,rawIssue) {
  const issue=issueData(rawIssue),config=validateConfig(input);
  const base={issueId:issue.id,source,issueUpdatedAt:issue.updatedAt,launchAllowed:false};
  if(config.version!==2)return refused(base,'CONFIG_V2_REQUIRED');
  const authorization=authorizedProject(config.projects,issue);
  if(authorization.code)return refused(base,authorization.code);
  const {project}=authorization,context={...base,projectKey:project.key};
  const matches=repo=>[...new Set([...repo.labels,...repo.aliases])].filter(value=>issue.labels.has(value)).sort();
  const candidates=project.repos.length===1?project.repos:project.repos.filter(repo=>matches(repo).length);
  if(!candidates.length)return refused(context,'REPO_LABEL_REQUIRED');
  if(candidates.length!==1)return refused(context,'REPO_AMBIGUOUS',{candidates:candidates.map(repo=>repo.key).sort()});
  const repo=candidates[0];
  return {...context,status:'selected',selection:project.repos.length===1?'single-repository':'labels',matchedLabels:matches(repo),repository:{key:repo.key,path:repo.path,mainBranch:repo.mainBranch,mainBranchChecked:false,configVerification:repo.verification}};
}

export function createRepositoryPreview({readConfig,git}) {
  async function preview(input) {
    if(Object.keys(input).some(key=>key!=='issue'))fail('INVALID_ARGUMENT','Repository preview accepts an issue snapshot only.');
    const {config,revision}=await readConfig();
    const selected={...previewRepository(config,input.issue),configRevision:revision};
    if(selected.status!=='selected')return selected;
    const {repository,...base}=selected,details={candidates:[repository.key]};
    try {
      const path=await nativeRealpath(repository.path);
      if(await git(path,['rev-parse','--is-inside-work-tree'])!=='true')return refused(base,'REPO_NOT_WORKTREE',details);
      const root=await nativeRealpath(await git(path,['rev-parse','--show-toplevel']));
      if(root!==path)return refused(base,'REPO_NOT_ROOT',details);
      const common=await git(root,['rev-parse','--git-common-dir']);
      const gitCommonDir=await nativeRealpath(resolve(root,common));
      const physical={...repository,path,gitCommonDir};
      if(canonical(clean(physical))!==canonical(physical))return refused(base,'REPO_UNSAFE_PATH',details);
      return {...selected,status:'resolved',repository:physical};
    }catch {
      return refused(base,'REPO_UNAVAILABLE',details);
    }
  }
  return {preview};
}
