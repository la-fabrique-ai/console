import {join} from 'node:path';
import {readFile} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {fail,object,text,canonical,readJSON,writeJSON,withLock} from '../../../src/common.mjs';
import {engineIssue,enrichedIssue,engineState} from '../ticket.mjs';
import {STATUSES,statusOf,keyPrefix,folderOf,readFolder,nextNumber,parseTicket,serializeTicket,createFile,replaceFile} from './store.mjs';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const now=()=>new Date().toISOString();
const known=values=>({items:values,complete:true,cursor:null});

// The scopes of the configured projects: one Markdown folder each, in the project's first repository.
export function scopesOf(config,scopeOfProject) {
  return (config?.projects??[]).map(project=>({id:scopeOfProject(project).id,key:project.key,name:project.name??project.key,folder:folderOf(project),prefix:keyPrefix(project.key)})).filter(scope=>scope.id);
}

// Records of one folder, as common tickets.
export function ticketsOf(scope,folder,connection) {
  const index=new Map(folder.records.map(record=>[record.key,record]));
  const statusFor=record=>statusOf(record.status)??{id:record.status,label:record.status,category:'unknown'};
  const linkTo=record=>({ref:{connection,id:record.id},key:record.key,title:record.title,status:statusFor(record)});
  return folder.records.map(record=>{
    const blockedBy=record.blockedBy.map(key=>index.get(key)).filter(Boolean);
    const latest=[record.updated,record.modifiedAt].filter(Boolean).sort().at(-1)??null;
    return {
      ref:{connection,id:record.id},key:record.key,scope:{id:scope.id,key:scope.key,name:scope.name},url:null,
      title:record.title,description:record.description,status:statusFor(record),
      parent:record.parent&&index.has(record.parent)?linkTo(index.get(record.parent)):null,
      children:{items:folder.records.filter(other=>other.parent===record.key).map(linkTo),complete:folder.complete,cursor:null},
      relations:{
        blocks:{items:folder.records.filter(other=>other.blockedBy.includes(record.key)).map(linkTo),complete:folder.complete,cursor:null},
        blockedBy:{items:blockedBy.map(linkTo),complete:folder.complete&&blockedBy.length===record.blockedBy.length,cursor:null},
      },
      labels:known(record.labels.map(name=>({id:name,name,color:null}))),
      comments:known(record.comments.map((comment,index)=>({id:record.id+':'+(index+1),author:{id:null,name:comment.author},body:comment.body,createdAt:comment.at,updatedAt:null}))),
      createdAt:record.created,updatedAt:latest,untrusted:true,
    };
  });
}

export function createMarkdownConnector({root,loadConfig,scopeOfProject,connection='primary'}) {
  const scopes=async()=>scopesOf(await loadConfig(),scopeOfProject);
  async function scopeById(id) {
    const scope=(await scopes()).find(scope=>scope.id===id);
    if(!scope)fail('TEAM_NOT_CONFIGURED','No configured project uses this ticket scope.');
    if(!scope.folder||!scope.prefix)fail('INVALID_CONFIG','The project needs an absolute repository path and a key to keep its tickets.');
    return scope;
  }
  async function read(scope) {
    const folder=await readFolder(scope.folder);
    return {scope,folder,tickets:ticketsOf(scope,folder,connection),observedAt:now(),reasons:folder.reasons.map(entry=>({path:entry.file,reason:entry.reason}))};
  }
  const readAll=async scopeId=>scopeId?[await read(await scopeById(scopeId))]:Promise.all((await scopes()).filter(scope=>scope.folder).map(read));
  const cursorCheck=cursor=>{if(cursor!==undefined&&cursor!==null)fail('TICKET_CURSOR_UNSUPPORTED','This connection reads whole collections; continuation cursors are unsupported.');};
  const observation=(complete,observedAt)=>({complete,cursor:null,freshness:{observedAt,cached:false},updatedAt:observedAt,cached:false});
  const envelope=(reads,data,complete)=>{
    const observedAt=reads[0]?.observedAt??now(),scope=reads[0]?.scope;
    return {status:complete?'complete':'partial',available:true,source:'files',
      scope:{key:scope?.key??null,teamId:scope?.id??null,projectId:null,includeArchived:false,linkedOutsideTeam:'identifier-state-only'},untrusted:true,data,
      partialReasons:reads.flatMap(entry=>entry.reasons),limits:{},usage:{requests:0,nodes:reads.reduce((sum,entry)=>sum+entry.tickets.length,0),maxComplexity:null},
      observedAt,...observation(complete,observedAt)};
  };
  function matches(ticket,filter) {
    if(filter.search){const needle=String(filter.search).toLowerCase();if(!ticket.title.toLowerCase().includes(needle)&&!String(ticket.key).toLowerCase().includes(needle))return false;}
    if(filter.stateId&&ticket.status.id!==filter.stateId)return false;
    if(filter.backlog===true&&ticket.status.category!=='backlog')return false;
    // Markdown tickets have no grouping, no priority and no assignee: such filters match nothing.
    if(filter.projectId||filter.priority!==undefined||filter.mine===true)return false;
    return true;
  }
  async function list({scope,filter={},cursor=null,include=[],readOptions:_,...legacy}={}) {
    cursorCheck(cursor);
    const {refresh:__,teamId,...criteria}={...legacy,...filter},scopeId=scope?.id??scope?.teamId??teamId??null;
    if(include.includes('projects')||include.includes('enriched')) {
      if(!scopeId)fail('TEAM_NOT_CONFIGURED','A ticket scope must be configured for this read.');
      const reads=await readAll(scopeId),complete=reads.every(entry=>entry.folder.complete);
      if(include.includes('projects'))return envelope(reads,{projects:{items:[],complete:true,total:0,cursor:null,reasons:[]}},true);
      const tickets=reads.flatMap(entry=>entry.tickets).filter(ticket=>matches(ticket,criteria)),issues=tickets.map(enrichedIssue);
      const collection={items:issues,complete,total:complete?issues.length:null,cursor:null,reasons:complete?[]:['unreadable-files']};
      return {...envelope(reads,{issues:collection},complete&&issues.every(issue=>issue.complete)),collection,tickets:issues.map((issue,index)=>({...issue,status:tickets[index].status,reference:tickets[index].ref}))};
    }
    const reads=await readAll(scopeId),complete=reads.every(entry=>entry.folder.complete);
    const issues=reads.flatMap(entry=>entry.tickets).filter(ticket=>matches(ticket,criteria)).map(engineIssue);
    return {...observation(complete,reads[0]?.observedAt??now()),issues,tickets:issues,relations:'full',partialReasons:reads.flatMap(entry=>entry.reasons)};
  }
  async function find(id,scope) {
    text(id,'issue id',200);
    for(const entry of await readAll(scope?.id??scope?.teamId??null)) {
      const ticket=entry.tickets.find(ticket=>ticket.ref.id===id);
      if(ticket)return {entry,ticket};
    }
    fail('NOT_FOUND','The ticket was not found.');
  }
  async function detail(id,{include=[],scope,refresh:_}={}) {
    if(include.includes('document')) {
      const reads=scope?.id?await readAll(scope.id):[];
      return {...envelope(reads,{document:null},false),status:'unavailable',available:false};
    }
    const {entry,ticket}=await find(id,scope);
    if(include.includes('enriched')){const issue=enrichedIssue(ticket);return {...envelope([entry],{issue},entry.folder.complete&&issue.complete),ticket:{...issue,status:ticket.status,reference:ticket.ref}};}
    const issue=engineIssue(ticket);
    return {...observation(entry.folder.complete,entry.observedAt),issue,ticket:issue,collections:{comments:ticket.comments,children:ticket.children,labels:ticket.labels}};
  }
  async function meta() {
    const all=await scopes(),observedAt=now();
    const states=all.flatMap(scope=>STATUSES.map(status=>({id:status.id,name:status.label,type:engineState(status).type,category:status.category,team:{id:scope.id}})));
    const listed=all.map(scope=>({id:scope.id,key:scope.key,name:scope.name}));
    return {...observation(true,observedAt),teams:listed,scopes:listed,projects:[],states,readOnly:false,
      capabilities:{projects:false,documents:false,milestones:false,comments:true,children:true,enriched:true,mutate:true}};
  }

  // Writes: one console lock, a journal per operation, whole-file replacement.
  async function apply(payload) {
    const {entry}=await find(payload.issueId),record=entry.folder.records.find(record=>record.id===payload.issueId);
    // The file is read again just before writing: an edit made by hand since the list is kept.
    const fresh=parseTicket(await readFile(join(entry.scope.folder,record.file),'utf8'),record.file);
    if(fresh.error||fresh.value.id!==payload.issueId)fail('INVALID_DATA','The ticket file changed and can no longer be read; correct it before writing.');
    const next={...fresh.value,updated:now()};
    if(payload.stateId!==undefined)next.status=payload.stateId;
    if(payload.comment!==undefined)next.comments=[...fresh.value.comments,{at:next.updated,author:'Console',body:payload.comment.trim()}];
    await replaceFile(entry.scope.folder,record.file,serializeTicket(next));
    return {success:true,issue:(await detail(payload.issueId)).issue};
  }
  async function mutate(input) {
    const payload=object(input.payload);
    if(input.confirmed!==true||!input.confirmedPayload||canonical(payload)!==canonical(input.confirmedPayload))fail('CONFIRMATION_REQUIRED','Confirm the exact mutation payload explicitly before writing the ticket.');
    if(Object.keys(payload).some(key=>!['issueId','stateId','comment'].includes(key)))fail('INVALID_ARGUMENT','Unsupported ticket mutation field.');
    text(payload.issueId,'issueId',200);
    if(payload.stateId===undefined&&payload.comment===undefined)fail('INVALID_ARGUMENT','A stateId or comment is required.');
    if(payload.stateId!==undefined&&!statusOf(payload.stateId))fail('INVALID_STATE','stateId must be one of the Markdown ticket statuses.');
    if(payload.comment!==undefined)text(payload.comment,'comment',20000);
    return withLock(root,async()=>{
      const hash=createHash('sha256').update(canonical({connector:'markdown',...payload})).digest('hex'),path=join(root,'mutations',`markdown-${hash}.json`);
      const previous=await readJSON(path,null);
      if(previous?.status==='applied')return previous.result;
      const journal={payloadHash:hash,attemptedAt:now(),status:'pending'};await writeJSON(path,journal);
      try{const result=await apply(payload);await writeJSON(path,{...journal,status:'applied',finishedAt:now(),result});return result;}
      catch(error){await writeJSON(path,{...journal,status:'rejected',finishedAt:now(),errorCode:error.code??'INTERNAL_ERROR'});throw error;}
    });
  }
  async function create(input) {
    if(input.confirmed!==true)fail('CONFIRMATION_REQUIRED','Confirm the ticket creation explicitly before writing it.');
    const title=text(input.title,'title',255).trim();if(!title||/[\r\n]/.test(title))fail('INVALID_ARGUMENT','Invalid title.');
    const operationId=text(input.operationId,'operationId',36);if(!UUID.test(operationId))fail('INVALID_ARGUMENT','Invalid operationId.');
    const description=input.description===undefined?null:text(input.description,'description',20000).trim();
    const parentId=input.parentId===undefined?null:text(input.parentId,'parentId',200);
    text(input.key,'project key',48);
    const project=(await loadConfig()).projects?.find(project=>project.key===input.key);
    if(!project)fail('NOT_FOUND','No configured project uses this key.');
    const scope=await scopeById(scopeOfProject(project).id);
    return withLock(root,async()=>{
      const path=join(root,'mutations',`markdown-create-${operationId.toLowerCase()}.json`),previous=await readJSON(path,null);
      const payloadHash=createHash('sha256').update(canonical({scope:scope.id,title,description,parentId})).digest('hex');
      if(previous&&previous.payloadHash!==payloadHash)fail('INVALID_ARGUMENT','This operationId was already used for another creation.');
      const folder=await readFolder(scope.folder);
      // A replayed operation finds the ticket it chose before writing; it never writes a second one.
      if(previous){const existing=folder.records.find(record=>record.id===previous.ticketId);if(existing){await writeJSON(path,{...previous,status:'applied'});return {issue:(await detail(existing.id)).issue,replayed:true};}}
      const parent=parentId===null?null:folder.records.find(record=>record.id===parentId);
      if(parentId!==null&&!parent)fail('NOT_FOUND','The parent ticket was not found in this project.');
      const id=previous?.ticketId??randomUUID(),key=scope.prefix+'-'+nextNumber(folder.names,scope.prefix),at=now();
      const journal={kind:'ticket-create',operationId:operationId.toLowerCase(),ticketId:id,key,payloadHash,attemptedAt:at,status:'pending'};
      await writeJSON(path,journal);
      await createFile(scope.folder,key+'.md',serializeTicket({id,key,title,status:'backlog',parent:parent?.key??null,blockedBy:[],labels:[],created:at,updated:at,description,comments:[]}));
      await writeJSON(path,{...journal,status:'applied',finishedAt:now()});
      return {issue:(await detail(id)).issue};
    });
  }
  return {configured:async()=>true,list,detail,meta,mutate:apply,create,forgetBacklog:()=>{},writer:{create,mutate},connection:{transport:'files',provider:'none'}};
}
