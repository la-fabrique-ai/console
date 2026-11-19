import {readdir,readFile,writeFile,rename,link,unlink,mkdir,stat} from 'node:fs/promises';
import {join,isAbsolute} from 'node:path';
import {randomUUID} from 'node:crypto';

// One Markdown file per ticket, `<KEY>.md`, in `<first repository of the project>/la-fabrique/output/tickets/`.
// A header of `name: value` lines between `---` fences, then the description, then `## Commentaires`.
export const FOLDER=['la-fabrique','output','tickets'];
export const STATUSES=Object.freeze([
  {id:'backlog',label:'Backlog',category:'backlog'},
  {id:'ready',label:'Prêt',category:'ready'},
  {id:'active',label:'En cours',category:'active'},
  {id:'done',label:'Terminé',category:'done'},
  {id:'canceled',label:'Annulé',category:'canceled'},
]);
export const statusOf=id=>STATUSES.find(status=>status.id===id)??null;
const COMMENTS='## Commentaires';
const FILE=/^([A-Z0-9][A-Z0-9_]*)-([1-9][0-9]*)\.md$/;
const HEADER=['id','key','title','status','parent','blocked-by','labels','created','updated'];
const REQUIRED=['id','key','title','status'];

export const keyPrefix=projectKey=>projectKey.toUpperCase().replace(/[^A-Z0-9]+/g,'_').replace(/^_+|_+$/g,'')||null;
export function folderOf(project) {
  const path=project?.repos?.[0]?.path??(typeof project?.repo==='string'?project.repo:project?.repo?.path);
  if(typeof path!=='string'||!isAbsolute(path))return null;
  return join(path,...FOLDER);
}

const quoted=value=>value===''||/^[\s"']|\s$|[\r\n]/.test(value)?JSON.stringify(value):value;
function headerValue(raw) {
  const value=raw.trim();
  if(!value.startsWith('"'))return value;
  try{const parsed=JSON.parse(value);return typeof parsed==='string'?parsed:null;}catch{return null;}
}
const list=value=>value?value.split(',').map(item=>item.trim()).filter(Boolean):[];

// A file read as the store sees it, or {error} with the reason it cannot be one; never a guessed ticket.
export function parseTicket(text,file) {
  const lines=text.replace(/\r\n/g,'\n').split('\n');
  if(lines[0]!=='---')return {error:'header-missing'};
  const end=lines.indexOf('---',1);if(end<0)return {error:'header-unclosed'};
  const header={};
  for(const line of lines.slice(1,end)) {
    if(!line.trim())continue;
    const match=/^([a-z-]+):(.*)$/.exec(line);if(!match)return {error:'header-line-invalid'};
    if(HEADER.includes(match[1])){const value=headerValue(match[2]);if(value===null)return {error:'header-value-invalid'};header[match[1]]=value;}
  }
  if(!header.id)return {error:'id-missing'};
  if(!header.key||header.key+'.md'!==file)return {error:'key-mismatch'};
  if(!header.title)return {error:'title-missing'};
  const rest=lines.slice(end+1),split=rest.indexOf(COMMENTS);
  const description=(split<0?rest:rest.slice(0,split)).join('\n').trim()||null;
  const comments=[];
  if(split>=0) {
    let current=null;
    for(const line of rest.slice(split+1)) {
      const heading=/^### (\S+) — (.+)$/.exec(line);
      if(heading){current={at:heading[1],author:heading[2].trim(),lines:[]};comments.push(current);}
      else if(current)current.lines.push(line);
      else if(line.trim())return {error:'comment-without-heading'};
    }
  }
  return {value:{id:header.id,key:header.key,title:header.title,status:header.status??null,parent:header.parent||null,
    blockedBy:list(header['blocked-by']),labels:list(header.labels),created:header.created||null,updated:header.updated||null,description,
    comments:comments.map(comment=>({at:comment.at,author:comment.author,body:comment.lines.join('\n').trim()}))}};
}

export function serializeTicket(record) {
  const header={id:record.id,key:record.key,title:record.title,status:record.status,parent:record.parent??'',
    'blocked-by':(record.blockedBy??[]).join(', '),labels:(record.labels??[]).join(', '),created:record.created??'',updated:record.updated??''};
  const lines=['---',...HEADER.filter(name=>header[name]!==''||REQUIRED.includes(name)).map(name=>name+': '+quoted(String(header[name]))),'---','',record.description??''];
  if(record.comments?.length) {
    lines.push('',COMMENTS);
    for(const comment of record.comments)lines.push('','### '+comment.at+' — '+comment.author,'',comment.body);
  }
  return lines.join('\n').replace(/\n{3,}/g,'\n\n').trimEnd()+'\n';
}

export async function folderNames(folder){try{return await readdir(folder);}catch(error){if(error.code==='ENOENT')return null;throw error;}}

// Every ticket file of a folder. An absent folder is a known, empty and complete collection; a file that cannot be
// read as a ticket makes the collection incomplete, with its reason, and is never silently left out.
export async function readFolder(folder) {
  const names=await folderNames(folder);
  if(names===null)return {records:[],names:[],complete:true,reasons:[]};
  const parsed=[],reasons=[];
  for(const name of names.filter(name=>FILE.test(name)).sort()) {
    const path=join(folder,name);
    try {
      const [text,info]=await Promise.all([readFile(path,'utf8'),stat(path)]);
      const result=parseTicket(text,name);
      if(result.error)reasons.push({file:name,reason:result.error});
      else parsed.push({...result.value,file:name,modifiedAt:info.mtime.toISOString()});
    }catch(error){if(error.code!=='ENOENT')reasons.push({file:name,reason:'unreadable'});}
  }
  const counts=new Map();for(const record of parsed)counts.set(record.id,(counts.get(record.id)??0)+1);
  const records=[];
  for(const record of parsed){if(counts.get(record.id)>1)reasons.push({file:record.file,reason:'duplicate-id'});else records.push(record);}
  return {records,names,complete:reasons.length===0,reasons};
}

// The next number of a prefix: one more than every file name of the folder, readable or not.
export function nextNumber(names,prefix) {
  let max=0;
  for(const name of names){const match=FILE.exec(name);if(match&&match[1]===prefix)max=Math.max(max,Number(match[2]));}
  return max+1;
}

// A new file appears whole or not at all, and never replaces an existing one.
export async function createFile(folder,name,text) {
  await mkdir(folder,{recursive:true});
  const temporary=join(folder,'.'+name+'.'+randomUUID()+'.tmp');
  await writeFile(temporary,text,{flag:'wx'});
  try{await link(temporary,join(folder,name));}finally{await unlink(temporary).catch(()=>{});}
}
// An existing file is replaced whole: readers see the previous or the next version, never half of one.
export async function replaceFile(folder,name,text) {
  const temporary=join(folder,'.'+name+'.'+randomUUID()+'.tmp');
  await writeFile(temporary,text,{flag:'wx'});
  try{await rename(temporary,join(folder,name));}catch(error){await unlink(temporary).catch(()=>{});throw error;}
}
