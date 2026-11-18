import {normalizeTicketConfig,validateTicketSettings} from '../integrations/tickets/factory.mjs';
import { isAbsolute, basename, resolve } from 'node:path';
import { nativeRealpath } from './repository-config.mjs';
import { fail, object } from './common.mjs';
import { validateBudgets } from './budget-config.mjs';
import { validateEnvironment } from './environment-config.mjs';
const shells=new Set(['sh','bash','zsh','fish','dash','ksh','csh','tcsh','nu','powershell','pwsh','cmd','env','sudo','doas','ssh']);
function validateV1(input) {
  fields(input,['version','tracker','projects','budgets','owner','ticketConnector']);
  if(input.version!==1||!Array.isArray(input.projects)) fail('INVALID_CONFIG','Configuration requires version 1 and a projects array.');
  const tracker=validateTicketSettings(input.tracker);
  const keys=new Set();
  const projects=input.projects.map(raw=>{
    fields(raw,['key','name','projectId','teamId','repo','preferredAgent','mainBranch','machine','tests','budgets','color','icon','leadLayout','ticketScope']);
    if(typeof raw.key!=='string'||!/^[a-z0-9][a-z0-9_-]{0,47}$/.test(raw.key)||keys.has(raw.key)) fail('INVALID_CONFIG','Project keys must be unique lowercase identifiers.');keys.add(raw.key);
    for(const id of ['projectId','teamId']) if(raw[id]!==undefined&&(typeof raw[id]!=='string'||!raw[id].trim()||raw[id].length>200)) fail('INVALID_CONFIG',`Invalid ${id}.`);
    if(!raw.projectId&&!raw.teamId&&!raw.ticketScope) fail('INVALID_CONFIG','Every repository requires an explicit tracker projectId or teamId.');
    if(typeof raw.repo!=='string'||!isAbsolute(raw.repo)||/[\x00-\x1f]/.test(raw.repo)) fail('INVALID_CONFIG','Repository paths must be absolute.');
    if(raw.machine!==null) fail('INVALID_CONFIG','V1 supports machine: null only.');
    if(!['claude','codex'].includes(raw.preferredAgent)) fail('INVALID_CONFIG','preferredAgent must be claude or codex.');
    if(typeof raw.mainBranch!=='string'||!raw.mainBranch||raw.mainBranch.startsWith('-')||/[\s~^:?*\[\\\x00-\x1f]/.test(raw.mainBranch)||raw.mainBranch.includes('..')||raw.mainBranch.includes('@{')) fail('INVALID_CONFIG','Invalid mainBranch.');
    if(raw.name!==undefined&&(typeof raw.name!=='string'||raw.name.length>200)) fail('INVALID_CONFIG','Invalid project name.');
    const tests=Object.create(null);object(raw.tests===undefined?{}:raw.tests,'INVALID_CONFIG');
    for(const [name,test] of Object.entries(raw.tests??{})) {
      if(name==='__proto__'||!/^[a-zA-Z0-9_-]{1,48}$/.test(name)) fail('INVALID_CONFIG','Invalid test profile name.');fields(test,['argv','timeoutMs','terminal']);
      if(!Array.isArray(test.argv)||!test.argv.length||test.argv.length>100||test.argv.some(v=>typeof v!=='string'||v.includes('\0')||v.length>10000)||!test.argv[0]||test.argv[0].startsWith('-')||shells.has(basename(test.argv[0]).toLowerCase().replace(/\.exe$/,''))) fail('INVALID_CONFIG','Test commands require a direct executable argv; shell wrappers are forbidden.');
      const timeoutMs=test.timeoutMs??120000;
      if(!Number.isInteger(timeoutMs)||timeoutMs<100||timeoutMs>3600000) fail('INVALID_CONFIG','Test timeoutMs must be between 100 and 3600000.');
      if(test.terminal!==undefined&&typeof test.terminal!=='boolean') fail('INVALID_CONFIG','Test terminal must be a boolean.');
      tests[name]={argv:test.argv,timeoutMs,...(test.terminal!==undefined?{terminal:test.terminal}:{})};
    }
    return {key:raw.key,...(raw.name?{name:raw.name}:{}),...(raw.projectId?{projectId:raw.projectId}:{}),...(raw.teamId?{teamId:raw.teamId}:{}),repo:raw.repo,preferredAgent:raw.preferredAgent,mainBranch:raw.mainBranch,machine:null,tests,...(raw.budgets!==undefined?{budgets:validateBudgets(raw.budgets)}:{})};
  });
  return {version:1,tracker,projects,...(input.budgets!==undefined?{budgets:validateBudgets(input.budgets)}:{})};
}

// Local policy from the adopted C1 contract. This is not an account-capability probe.
export const MODEL_ALLOWLIST=Object.freeze({
  codex:Object.freeze(['gpt-6-luna','gpt-6.1-sol','gpt-6-astra']),
  claude:Object.freeze(['claude-haiku-5-5','claude-sonnet-5-5','claude-opus-5-5']),
});
const levels=['léger','standard','fort'];
export const MODEL_EFFORTS=Object.freeze(['low','medium','high']);
const efforts=new Set(MODEL_EFFORTS);
const valid=(condition,message)=>{if(!condition)fail('INVALID_CONFIG',message);};
function fields(value,allowed) {
  object(value,'INVALID_CONFIG');
  valid(Object.keys(value).every(key=>allowed.includes(key)),'Unknown configuration field.');
}
function identifier(value) {valid(typeof value==='string'&&/^[a-z0-9][a-z0-9_-]{0,47}$/.test(value),'Invalid configuration key.');}
function boundedText(value) {valid(typeof value==='string'&&value.trim()===value&&value.length>0&&value.length<=200&&!/[\x00-\x1f]/.test(value),'Invalid configuration text.');}
function absolutePath(value) {valid(typeof value==='string'&&isAbsolute(value)&&!/[\x00-\x1f]/.test(value),'Configuration paths must be absolute.');}
function validateWip(value,global=false) {
  fields(value,global?['dev','review','maxParallelDevs']:['dev','review']);
  for(const key of ['dev','review'])valid(Number.isInteger(value[key])&&value[key]>=1&&value[key]<=100,'Invalid WIP limit.');
  if(global)valid(Number.isInteger(value.maxParallelDevs)&&value.maxParallelDevs>=1&&value.maxParallelDevs<=4,'Invalid developer concurrency limit.');
  return {...value};
}
function labelList(value) {
  valid(Array.isArray(value)&&value.length<=100,'Labels and aliases must be arrays.');
  value.forEach(boundedText);
  valid(new Set(value).size===value.length,'Duplicate label or alias.');
  return [...value];
}
function validateProfiles(value) {
  fields(value,['version','dev','review']);boundedText(value.version);
  const profiles={version:value.version};
  for(const role of ['dev','review']) {
    fields(value[role],['claude','codex']);profiles[role]={};
    for(const [tool,entries] of Object.entries(value[role])) {
      fields(entries,levels);profiles[role][tool]={};
      for(const [level,profile] of Object.entries(entries)) {
        fields(profile,['model','effort']);
        valid(MODEL_ALLOWLIST[tool].includes(profile.model),'Model is not allowed for this family.');
        valid(efforts.has(profile.effort),'Effort is not allowed.');
        profiles[role][tool][level]={model:profile.model,effort:profile.effort};
      }
    }
  }
  return profiles;
}
function validateV2(input) {
  fields(input,['version','tracker','worktreesRoot','wip','launch','projects','profiles','budgets','owner','ticketConnector']);
  absolutePath(input.worktreesRoot);
  const tracker=validateTicketSettings(input.tracker);
  const wip=validateWip(input.wip,true);
  fields(input.launch,['confirm']);valid(['each','wave'].includes(input.launch.confirm),'Invalid launch confirmation mode.');
  valid(Array.isArray(input.projects),'Projects must be an array.');
  const keys=new Set();
  const projects=input.projects.map(project=>{
    fields(project,['key','name','projectId','teamId','kind','color','preferredAgent','machine','wip','repos','environment','budgets','icon','leadLayout','ticketScope']);
    identifier(project.key);valid(!keys.has(project.key),'Duplicate project key.');keys.add(project.key);
    if(project.name!==undefined)boundedText(project.name);
    for(const key of ['projectId','teamId'])if(project[key]!==undefined)boundedText(project[key]);
    valid(Boolean(project.projectId||project.teamId||project.ticketScope),'An explicit tracker projectId or teamId is required.');
    valid(project.machine===null,'Only local machine:null is supported.');
    valid(['produit','annexe'].includes(project.kind),'Invalid project kind.');
    valid(typeof project.color==='string'&&/^#[0-9a-fA-F]{6}$/.test(project.color),'Color must be a six-digit hex value.');
    if(project.preferredAgent!==undefined)valid(['claude','codex'].includes(project.preferredAgent),'Invalid preferred agent.');
    valid(Array.isArray(project.repos)&&project.repos.length>0,'Every project requires explicit repositories.');
    const repoKeys=new Set(),repoPaths=new Set();
    const repos=project.repos.map(repo=>{
      fields(repo,['key','path','labels','aliases','mainBranch','tests','verification']);
      identifier(repo.key);valid(!repoKeys.has(repo.key),'Duplicate repository key.');repoKeys.add(repo.key);
      absolutePath(repo.path);
      const path=resolve(repo.path);
      valid(!repoPaths.has(path),'Duplicate normalized repository path.');repoPaths.add(path);
      if(repo.tests!==undefined) {
        object(repo.tests,'INVALID_CONFIG');
        for(const profile of Object.values(repo.tests))fields(profile,['argv','timeoutMs','terminal']);
      }
      const legacy=validateV1({version:1,projects:[{key:repo.key,projectId:'validation',repo:repo.path,mainBranch:repo.mainBranch,preferredAgent:'codex',machine:null,tests:repo.tests}]}).projects[0];
      const verification=repo.verification??'required';valid(['required','verified'].includes(verification),'Invalid repository verification status.');
      return {key:repo.key,path:repo.path,labels:labelList(repo.labels??[]),aliases:labelList(repo.aliases??[]),mainBranch:legacy.mainBranch,verification,tests:legacy.tests};
    });
    return {key:project.key,...(project.name!==undefined?{name:project.name}:{}),...(project.projectId!==undefined?{projectId:project.projectId}:{}),...(project.teamId!==undefined?{teamId:project.teamId}:{}),kind:project.kind,color:project.color,...(project.preferredAgent!==undefined?{preferredAgent:project.preferredAgent}:{}),machine:null,...(project.budgets!==undefined?{budgets:validateBudgets(project.budgets)}:{}),...(project.wip!==undefined?{wip:validateWip(project.wip)}:{}),repos,...(project.environment!==undefined?{environment:validateEnvironment(project.environment,{repos:repos.length})}:{})};
  });
  return {version:2,tracker,worktreesRoot:input.worktreesRoot,wip,launch:{confirm:input.launch.confirm},projects,profiles:validateProfiles(input.profiles),...(input.budgets!==undefined?{budgets:validateBudgets(input.budgets)}:{})};
}
// Owner and presentation are engine data; the legacy transport is kept only for existing clients.
function presentation(raw,connection) {
  const color=raw.color===undefined?'#9AA2AD':raw.color,icon=raw.icon===undefined?'folder':raw.icon,leadLayout=raw.leadLayout===undefined?'generic':raw.leadLayout;
  valid(typeof color==='string'&&/^#[0-9a-fA-F]{6}$/.test(color),'Color must be a six-digit hex value.');
  valid(typeof icon==='string'&&(icon==='folder'||(!/[a-zA-Z0-9/\\<>\x00-\x20]/.test(icon)&&[...icon].length<=4&&icon.length>0)),'Icon must be folder or a short glyph.');
  valid(['generic','generated'].includes(leadLayout),'Invalid Lead layout.');
  const scope=raw.ticketScope===undefined?((raw.projectId||raw.teamId)?{connection,scopeId:raw.projectId||raw.teamId}:null):raw.ticketScope;
  fields(scope,['connection','scopeId']);identifier(scope.connection);boundedText(scope.scopeId);
  // A historical projectId narrows its team; the scope identifies that project, not both IDs.
  const field=raw.projectId?'projectId':'teamId';
  if(raw[field]!==undefined)valid(raw[field]===scope.scopeId,`ticketScope.scopeId conflicts with ${field}.`);
  return {color,icon,leadLayout,ticketScope:{...scope},...(!raw.projectId&&!raw.teamId?{teamId:scope.scopeId}:{})};
}
export function validateConfig(input) {
  input=normalizeTicketConfig(input);
  object(input,'INVALID_CONFIG');
  valid([1,2].includes(input.version),'Unsupported configuration version.');
  if(input.owner!==undefined||input.ticketConnector!==undefined)valid(input.owner!==undefined&&input.ticketConnector!==undefined,'Owner and ticketConnector must be configured together.');
  const owner=input.owner===undefined?{id:'owner',displayName:'Responsable'}:input.owner,connection=input.ticketConnector===undefined?'primary':input.ticketConnector;
  fields(owner,['id','displayName']);identifier(owner.id);boundedText(owner.displayName);identifier(connection);
  // Reserve agent role identifiers so owner records can never be mistaken for agent answers.
  valid(!['lead','dev','qa','claude','codex','review-1','review-2'].includes(owner.id),'Owner id conflicts with an agent role.');
  const config=input.version===2?validateV2(input):validateV1(input);
  return {...config,owner:{...owner},ticketConnector:connection,projects:config.projects.map((p,i)=>({...p,...presentation(input.projects[i],connection)}))};
}

function legacyProject(project,repo) {
  return {...project,repo:repo?.path??null,mainBranch:repo?.mainBranch??null,tests:repo?.tests??{}};
}
export function legacyProjects(config) {
  return config.version===1?config.projects:config.projects.map(project=>legacyProject(project,project.repos.length===1?project.repos[0]:null));
}
export async function projectForSession(config,session) {
  const project=config.projects.find(p=>p.key===session.projectKey);
  if(!project||config.version===1)return project;
  const sessionPath=await nativeRealpath(session.repo).catch(()=>resolve(session.repo));
  const paths=await Promise.all(project.repos.map(repo=>nativeRealpath(repo.path).catch(()=>resolve(repo.path))));
  const repos=project.repos.filter((_repo,index)=>paths[index]===sessionPath);
  return repos.length===1?legacyProject(project,repos[0]):null;
}
