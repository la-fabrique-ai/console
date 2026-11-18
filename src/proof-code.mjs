import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat,open,realpath,readlink,readdir } from 'node:fs/promises';
import { dirname,join,relative,isAbsolute } from 'node:path';
import { exec } from './common.mjs';
import { gitEnvironment } from './git-environment.mjs';

// Byte observations only: no patch, filename list or file content is persisted.
// Ignored files are outside Git's working-set contract. Git >= 2.45 is required.
const LIMIT=16*1024*1024,FILE_BUDGET=512*1024*1024;
const frame=(hash,value)=>{const bytes=Buffer.isBuffer(value)?value:Buffer.from(value);hash.update(String(bytes.length)+':');hash.update(bytes);};
export async function captureCode(cwd,{deadline=Date.now()+8000,depth=0}={}) {
  async function git(args,{input,allowExitOne=false}={}) {
    const timeout=Math.min(2000,deadline-Date.now());if(timeout<=0)throw new Error('deadline');
    const job=exec('git',['--no-lazy-fetch','-c','core.fsmonitor=false','-c','core.untrackedCache=false','-C',cwd,...args],{encoding:null,timeout,maxBuffer:LIMIT,shell:false,env:gitEnvironment()});
    let inputError;
    if(input!==undefined&&job.child?.stdin) {
      job.child.stdin.on('error',error=>{inputError=error;});job.child.stdin.end(input);
    }
    try {
      const result=await job;if(inputError)throw inputError;return result.stdout;
    }catch(error) {
      if(allowExitOne&&error.code===1&&!error.killed&&!error.signal&&!inputError)return Buffer.from(error.stdout??'');
      throw error;
    }
  }
  async function ignoredPaths(paths) {
    if(!paths.length)return new Set();
    // Prefix data paths so a leading :( cannot enable pathspec magic. Git's
    // check-ignore rejects --literal-pathspecs; validate the prefixed round trip.
    const literal=paths.map(path=>'./'+path);
    const bytes=await git(['check-ignore','--no-index','--stdin','-z'],{input:Buffer.from(literal.join('\0')+'\0'),allowExitOne:true});
    if(!Buffer.from(bytes.toString('utf8')).equals(bytes))throw new Error('unsupported names');
    const ignored=new Set(bytes.toString('utf8').split('\0').filter(Boolean)),candidates=new Set(literal);
    if([...ignored].some(path=>!candidates.has(path)))throw new Error('ignore protocol');
    return new Set([...ignored].map(path=>path.slice(2)));
  }
  async function sample() {
    if(depth>8||Date.now()>=deadline)throw new Error('budget');
    if(await realpath(cwd)!==cwd)throw new Error('worktree path');
    const sha=(await git(['rev-parse','--verify','HEAD^{commit}'])).toString('utf8').trim();
    if(!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(sha))throw new Error('head');
    const common=await realpath((await git(['rev-parse','--path-format=absolute','--git-common-dir'])).toString('utf8').trim());
    const [repoInfo,treeInfo]=await Promise.all([lstat(common),lstat(cwd)]);
    const identity=JSON.stringify([common,repoInfo.dev,repoInfo.ino,cwd,treeInfo.dev,treeInfo.ino]);
    const index=await git(['ls-files','--stage','-z']);
    // status/diff may run filter.*.clean. Compare metadata and bytes directly.
    const tree=await git(['ls-tree','-r','-z',sha]);
    const untracked=await git(['ls-files','--others','--exclude-standard','-z']);
    const hash=createHash('sha256');for(const value of ['proof-code-v2',sha,identity,index])frame(hash,value);
    const committed=new Map(tree.toString('utf8').split('\0').filter(Boolean).map(line=>{
      const match=line.match(/^(\d+) (?:blob|commit) ([a-f0-9]+)\t([\s\S]*)$/);if(!match)throw new Error('tree');
      return [match[3],{mode:match[1],oid:match[2]}];
    }));
    let dirty=untracked.length>0,total=0;
    const entries=index.toString('utf8').split('\0').filter(Boolean).map(line=>{
      const match=line.match(/^(\d+) ([a-f0-9]+) ([0-3])\t([\s\S]*)$/);if(!match)throw new Error('index');
      const head=committed.get(match[4]);
      if(match[3]!=='0'||!head||head.mode!==match[1]||head.oid!==match[2])dirty=true;
      committed.delete(match[4]);
      return {mode:match[1],oid:match[2],name:match[4]};
    });
    if(committed.size)dirty=true;
    entries.push(...untracked.toString('utf8').split('\0').filter(Boolean).map(name=>({mode:null,oid:null,name})));
    if(entries.length>10000||!Buffer.from(index.toString('utf8')).equals(index)||!Buffer.from(untracked.toString('utf8')).equals(untracked)||!Buffer.from(tree.toString('utf8')).equals(tree))throw new Error('unsupported names');
    for(const entry of entries) {
      if(Date.now()>=deadline)throw new Error('deadline');
      const path=join(cwd,entry.name),rel=relative(cwd,path);
      if(isAbsolute(rel)||rel==='..'||rel.startsWith('../'))throw new Error('outside worktree');
      const parent=await realpath(dirname(path)).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
      const parentRel=parent===null?'':relative(cwd,parent);
      if(isAbsolute(parentRel)||parentRel==='..'||parentRel.startsWith('../'))throw new Error('outside parent');
      frame(hash,entry.name);
      let info;try{info=await lstat(path);}catch(error){if(error.code!=='ENOENT')throw error;frame(hash,'absent');dirty=true;continue;}
      if(entry.mode==='160000') {
        frame(hash,'submodule');
        const child=await captureCode(path,{deadline,depth:depth+1});if(!child.stateHash)throw new Error('submodule');frame(hash,child.stateHash);
        if(child.dirty||child.sha!==entry.oid)dirty=true;continue;
      }
      frame(hash,info.isSymbolicLink()?'symlink':'file');frame(hash,String(info.mode&0o777));
      let oid;
      if(info.isSymbolicLink()) {
        const raw=Buffer.from(await readlink(path));frame(hash,raw);
        oid=createHash(sha.length===64?'sha256':'sha1').update('blob '+raw.length+'\0').update(raw).digest('hex');
      }else {
        if(!info.isFile()||total+info.size>FILE_BUDGET)throw new Error('unsupported file');
        const file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
        try {
          const start=await file.stat();let size=0;
          if(!start.isFile()||start.size!==info.size)throw new Error('changed file');
          const blob=createHash(sha.length===64?'sha256':'sha1').update('blob '+start.size+'\0');
          hash.update(String(start.size)+':');
          for await(const chunk of file.createReadStream({autoClose:false})) {
            if(Date.now()>=deadline)throw new Error('deadline');
            size+=chunk.length;total+=chunk.length;if(total>FILE_BUDGET)throw new Error('size');
            hash.update(chunk);blob.update(chunk);
          }
          const end=await file.stat();
          if(size!==start.size||end.size!==start.size||end.mtimeMs!==start.mtimeMs||end.ctimeMs!==start.ctimeMs)throw new Error('changed file');
          oid=blob.digest('hex');
        }finally{await file.close();}
      }
      if(entry.oid) {
        const mode=info.isSymbolicLink()?'120000':info.mode&0o111?'100755':'100644';
        if(oid!==entry.oid||mode!==entry.mode)dirty=true;
      }
    }
    // Git omits FIFOs/sockets from ls-files --others. Do not call that a complete
    // byte observation. Prune ignored directories, never descend through links.
    let visited=0;
    const submodules=new Set(entries.filter(entry=>entry.mode==='160000').map(entry=>join(cwd,entry.name)));
    const excluded=await git(['ls-files','--others','--ignored','--exclude-standard','--directory','-z']);
    if(!Buffer.from(excluded.toString('utf8')).equals(excluded))throw new Error('unsupported names');
    // ls-files may compact ignored CONTENTS of a directory that is not itself
    // ignored. Confirm directory pruning in one batch, so negated special files
    // cannot be hidden by that compaction.
    const ignoredDirectories=await ignoredPaths(excluded.toString('utf8').split('\0').filter(path=>path.endsWith('/')).map(path=>path.slice(0,-1)));
    const special=[];
    async function supported(folder) {
      for(const entry of await readdir(folder,{withFileTypes:true})) {
        if(entry.name==='.git')continue;
        const path=join(folder,entry.name),name=relative(cwd,path);
        if(entry.isDirectory()&&ignoredDirectories.has(name))continue;
        if(Date.now()>=deadline||++visited>10000)throw new Error('budget');
        if(entry.isDirectory()){if(!submodules.has(path))await supported(path);}
        else if(!entry.isFile()&&!entry.isSymbolicLink())special.push(name);
      }
    }
    await supported(cwd);
    const ignoredSpecial=await ignoredPaths(special);
    if(special.some(path=>!ignoredSpecial.has(path)))throw new Error('unsupported file');
    const stateHash=hash.digest('hex');return {sha,dirty,diffHash:dirty?stateHash:null,stateHash};
  }
  try {
    const first=await sample(),second=await sample();
    if(first.stateHash!==second.stateHash)throw new Error('unstable');
    return {...second,observedAt:new Date().toISOString()};
  }catch{return {sha:null,dirty:null,diffHash:null,stateHash:null,observedAt:new Date().toISOString(),reason:'QA_CODE_UNREADABLE'};}
}
