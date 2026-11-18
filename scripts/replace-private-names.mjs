#!/usr/bin/env node
// Operates only on a disposable export copy. Diagnostics never contain names or paths.
import * as fs from 'node:fs/promises';
import path from 'node:path';
import {PublicationError,regularPath,repositoryRoot,isMain,publicationCli} from './publish-guard.mjs';

const fail=code=>{throw new PublicationError(code);};
const inside=(root,file)=>file===root||file.startsWith(root+path.sep);
const literal=value=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');

async function replacementFor(root,{sourceRoot,namesPath}) {
  if(!namesPath)fail('names-required');
  let file;
  try {
    if(!path.isAbsolute(namesPath))fail('names-invalid');
    await regularPath(namesPath);
    if(!(await fs.lstat(namesPath)).isFile())fail('names-invalid');
    file=await fs.realpath(namesPath);
  }catch{fail('names-invalid');}
  if(inside(root,file)||inside(sourceRoot,file))fail('names-not-external');
  let table;
  try{table=JSON.parse(await fs.readFile(file,'utf8'));}catch{fail('names-invalid');}
  if(!table||Array.isArray(table)||typeof table!=='object'||!Object.keys(table).length)fail('names-invalid');
  const entries=Object.entries(table);
  for(const [from,to] of entries) {
    if(!from.trim()||typeof to!=='string'||!to.trim()||/[\x00-\x1f\x7f/\\]/.test(from+to)||to==='.'||to==='..')fail('names-invalid');
  }
  // One simultaneous pass: longest names win; outputs are never reinterpreted as inputs.
  // Underscores separate filename words; regex word-boundary escapes also delimit names.
  // Letters, accents and digits inside an ordinary word do not.
  const pattern=new RegExp('(?:(?<![\\p{L}\\p{M}\\p{N}])|(?<=\\\\b))(?:'+entries.sort((a,b)=>b[0].length-a[0].length).map(([from])=>literal(from)).join('|')+')(?![\\p{L}\\p{M}\\p{N}])','gu');
  const replace=text=>text.replace(pattern,match=>table[match]);
  if(entries.some(([,to])=>replace(to)!==to))fail('names-not-idempotent');
  return replace;
}

export async function replacePrivateNames(folder,{sourceRoot=repositoryRoot,namesPath=process.env.FABRIQUE_CONSOLE_GUARD_NAMES}={}) {
  await regularPath(folder);await regularPath(sourceRoot);
  const root=await fs.realpath(folder),source=await fs.realpath(sourceRoot);
  if(inside(source,root)||inside(root,source)||!(await fs.lstat(root)).isDirectory())fail('unsafe-file');
  for(let parent=root;;parent=path.dirname(parent)) {
    try{await fs.lstat(path.join(parent,'.git'));fail('unsafe-file');}
    catch(error){if(error.code!=='ENOENT')throw error;}
    if(path.dirname(parent)===parent)break;
  }
  const replace=await replacementFor(root,{sourceRoot:source,namesPath}),entries=[],destinations=new Set();
  async function walk(relative='') {
    for(const name of (await fs.readdir(path.join(root,relative))).sort()) {
      const file=relative?relative+'/'+name:name,absolute=path.join(root,file),info=await fs.lstat(absolute);
      if(info.isSymbolicLink()||(!info.isDirectory()&&!info.isFile())||info.isFile()&&info.nlink!==1)fail('unsafe-file');
      const target=replace(file),key=target.normalize('NFC').toLowerCase();
      if(target.split('/').some(part=>!part||part==='.'||part==='..'))fail('names-invalid');
      if(replace(target)!==target)fail('names-not-idempotent');
      if(destinations.has(key))fail('names-collision');destinations.add(key);
      const entry={file,target,directory:info.isDirectory()};entries.push(entry);
      if(entry.directory)await walk(file);
      else {
        const bytes=await fs.readFile(absolute);let text;
        try{text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);}catch{continue;}
        if(text.includes('\0'))continue;
        const output=replace(text);
        if(replace(output)!==output)fail('names-not-idempotent');
        if(output!==text)entry.output=output;
      }
    }
  }
  await walk(); // Preflight all collisions, links and contents before the first write.
  for(const entry of entries)if(entry.output!==undefined)await fs.writeFile(path.join(root,entry.file),entry.output);
  for(const entry of entries.sort((a,b)=>b.file.split('/').length-a.file.split('/').length)) {
    if(path.basename(entry.file)!==path.basename(entry.target))await fs.rename(path.join(root,entry.file),path.join(root,path.dirname(entry.file),path.basename(entry.target)));
  }
  return {ok:true};
}
if(isMain(import.meta.url))await publicationCli(replacePrivateNames);
