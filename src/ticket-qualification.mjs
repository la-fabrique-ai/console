import { previewRepository } from './repository-preview.mjs';

import { ticketSections,visibleText,visibleCode,withinDescriptionLimits } from './ticket-markdown.mjs';
export { ticketSections } from './ticket-markdown.mjs';

const normalize=value=>value.normalize('NFC').replaceAll('’',"'").toLowerCase().trim().replace(/\s+/g,' ');
const labelName=value=>value.normalize('NFC').toLowerCase();
const placeholderKey=value=>{
  const content=normalize(value);let start=0,end=content.length;
  while(start<end&&'*_`~'.includes(content[start]))start++;
  while(end>start&&'*_`~.!?…:;'.includes(content[end-1]))end--;
  return content.slice(start,end).trim();
};
const placeholders=new Set([
  'todo','tbd','à remplir','(à remplir)','à compléter','...','…','-',
  "Pourquoi on le fait, pour qui. Lien vers l'epic.",
  "Ce que l'utilisateur voit ou peut faire à la fin. Ce qui est exclu.",
  'Liste vérifiable. Cas limites.', 'Profils de test à lancer. Preuves attendues (captures, sorties).',
  "Projet, environnement, version. Lien vers l'erreur dans l'outil.",
  'Première et dernière occurrence. Volume et personnes touchées.',
  'P0, P1, P2 ou P3, avec la raison.',
  'Étapes. Attendu, observé. Trace nettoyée, sans donnée personnelle.',
  'Établie ou hypothèse, avec le niveau de confiance.',
].map(placeholderKey));
function filled(lines) {
  return lines.some((line,index)=>{
    const content=normalize(lines.codeLines?.has(index)?line:visibleText(line));
    if(!content||placeholders.has(placeholderKey(content)))return false;
    return lines.codeLines?.has(index)?visibleCode(line):/[\p{L}\p{N}]/u.test(content);
  });
}

// A4 only: no network, filesystem, process, clock or model decision. A complete
// formal qualification is not a mission or permission to start an agent.
export function qualifyTicket(config,{key,issueId,read,configStable=true,failureReason=null}) {
  const project=config.projects.find(project=>project.key===key),issue=read?.data?.issue;
  const observedAt=typeof read?.observedAt==='string'&&Number.isFinite(Date.parse(read.observedAt))?read.observedAt:null;
  const source={status:read?.status??'unavailable',complete:read?.complete===true,cached:read?.cached===true,partialReasons:read?.partialReasons??[]};
  const selection={projectKey:key,repoKey:null,tool:null,level:null};
  let template=null;
  const check=(rule,result,reasons=[],paths=[])=>({rule,result,reasons,paths,observedAt});
  const output=(checks,global=[])=>{
    const missing=[...checks.filter(check=>check.result!=='satisfied'),...global];
    const verified=source.complete&&!source.cached&&!!observedAt&&configStable&&checks.every(check=>check.result!=='unverified');
    return {key,issueId,observedAt,source,selection,template,ready:{ok:verified&&missing.length===0,verified,checks,missing},launchAllowed:false};
  };
  const unknown=reason=>output(Array.from({length:6},(_,index)=>check(index+1,'unverified',[reason],['issue'])));
  if(!issue||source.status==='unavailable')return unknown(failureReason??'QUALIFICATION_SOURCE_UNAVAILABLE');
  if(issue.id!==issueId||read.scope?.key!==key||!project?.teamId||read.scope.teamId!==project.teamId)return unknown('QUALIFICATION_SCOPE_UNVERIFIED');
  if(source.cached||!observedAt)return unknown('QUALIFICATION_SOURCE_NOT_FRESH');
  const checks=[];
  const labelsKnown=issue.labels?.complete===true&&Array.isArray(issue.labels.items)&&issue.labels.items.length<=100&&
    issue.labels.items.every(label=>typeof label?.id==='string'&&typeof label?.name==='string');
  const labels=labelsKnown?issue.labels.items:[],names=labels.map(label=>labelName(label.name));
  checks.push(!labelsKnown?check(1,'unverified',['QUALIFICATION_LABELS_UNVERIFIED'],['issue.labels']):
    names.includes('prêt')?check(1,'satisfied'):check(1,'missing',['QUALIFICATION_READY_REQUIRED'],['issue.labels']));

  if(!configStable)checks.push(check(2,'unverified',['QUALIFICATION_CONFIG_CHANGED'],['configuration']));
  else if(!labelsKnown)checks.push(check(2,'unverified',['QUALIFICATION_LABELS_UNVERIFIED'],['issue.labels']));
  else {
    try {
      const selected=previewRepository(config,{id:issueId,updatedAt:issue.updatedAt,team:{id:read.scope.teamId},project:issue.projectId?{id:issue.projectId}:null,labels});
      if(selected.status==='selected'&&selected.projectKey===key){selection.repoKey=selected.repository.key;checks.push(check(2,'satisfied'));}
      else checks.push(check(2,'missing',[selected.code??'QUALIFICATION_SCOPE_UNVERIFIED'],['issue.labels','configuration.projects']));
    }catch{checks.push(check(2,'unverified',['QUALIFICATION_REPOSITORY_UNVERIFIED'],['issue.labels','configuration.projects']));}
  }

  if(!labelsKnown)checks.push(check(3,'unverified',['QUALIFICATION_LABELS_UNVERIFIED'],['issue.labels']));
  else {
    const agents=names.filter(name=>name.startsWith('agent:')),levels=names.filter(name=>name.startsWith('niveau:')),reasons=[];
    if(!agents.length)reasons.push('QUALIFICATION_AGENT_REQUIRED');
    else if(agents.length>1)reasons.push('QUALIFICATION_AGENT_AMBIGUOUS');
    else if(!['agent:claude','agent:codex'].includes(agents[0]))reasons.push('QUALIFICATION_AGENT_UNSUPPORTED');
    else selection.tool=agents[0].slice(6);
    if(!levels.length)reasons.push('QUALIFICATION_LEVEL_REQUIRED');
    else if(levels.length>1)reasons.push('QUALIFICATION_LEVEL_AMBIGUOUS');
    else if(!['niveau:léger','niveau:standard','niveau:fort'].includes(levels[0]))reasons.push('QUALIFICATION_LEVEL_UNSUPPORTED');
    else selection.level=levels[0].slice(7);
    checks.push(check(3,reasons.length?'missing':'satisfied',reasons,reasons.length?['issue.labels']:[]));
  }

  if(!labelsKnown)checks.push(check(4,'unverified',['QUALIFICATION_LABELS_UNVERIFIED'],['issue.labels','issue.description']));
  else if(typeof issue.description!=='string'&&issue.description!==null)checks.push(check(4,'unverified',['QUALIFICATION_DESCRIPTION_UNVERIFIED'],['issue.description']));
  else if(!withinDescriptionLimits(issue.description??''))checks.push(check(4,'unverified',['QUALIFICATION_DESCRIPTION_LIMIT'],['issue.description']));
  else {
    const types=names.map(normalize);template=types.includes('investigation')?'investigation':types.some(name=>name==='bug'||name==='bugs')?'bug':'ordinary';
    const required=template==='ordinary'?['need','outcome','criteria','verification']:['observation','severity','reproduction','cause','criteria','verification'];
    const sections=ticketSections(issue.description??''),ambiguous=required.filter(key=>(sections.get(key)?.length??0)>1);
    const missing=required.filter(key=>!sections.has(key)||!filled(sections.get(key)[0]));
    checks.push(ambiguous.length?check(4,'unverified',['QUALIFICATION_SECTIONS_AMBIGUOUS'],ambiguous.map(key=>'issue.description#'+key)):
      missing.length?check(4,'missing',['QUALIFICATION_SECTIONS_MISSING'],missing.map(key=>'issue.description#'+key)):check(4,'satisfied'));
  }

  const dependencies=issue.dependencies?.blockedBy;
  if(dependencies?.complete!==true||!Array.isArray(dependencies.items))checks.push(check(5,'unverified',['QUALIFICATION_DEPENDENCIES_UNVERIFIED'],['issue.dependencies.blockedBy']));
  else {
    const types=dependencies.items.map(item=>item?.state?.type),unknown=types.some(type=>!['completed','canceled','unstarted','started','backlog','triage'].includes(type));
    const open=types.some(type=>['unstarted','started','backlog','triage'].includes(type)),reasons=[];
    if(unknown)reasons.push('QUALIFICATION_DEPENDENCY_STATE_UNKNOWN');if(open)reasons.push('QUALIFICATION_DEPENDENCY_OPEN');
    checks.push(check(5,unknown?'unverified':open?'missing':'satisfied',reasons,reasons.length?['issue.dependencies.blockedBy']:[]));
  }
  const state=issue.state?.type;
  checks.push(['unstarted','started'].includes(state)?check(6,'satisfied'):
    ['completed','canceled','backlog','triage'].includes(state)?check(6,'missing',['QUALIFICATION_STATUS_NOT_STARTABLE'],['issue.state']):
      check(6,'unverified',['QUALIFICATION_STATUS_UNKNOWN'],['issue.state']));
  return output(checks,source.complete?[]:[check(0,'unverified',['QUALIFICATION_SOURCE_PARTIAL'],['issue'])]);
}
