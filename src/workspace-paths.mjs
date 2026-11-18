import { lstat,mkdir } from 'node:fs/promises';
import { resolve,join,dirname,parse,relative,isAbsolute,sep } from 'node:path';
import { fail } from './common.mjs';

export const within=(path,parent)=>{const suffix=relative(parent,path);return suffix===''||(!suffix.startsWith('..'+sep)&&suffix!=='..'&&!isAbsolute(suffix));};
export async function exists(path) {try{return await lstat(path);}catch(error){if(error.code==='ENOENT')return null;throw error;}}
export async function directoryChain(path,{create=false}={}) {
  const absolute=resolve(path),root=parse(absolute).root,parts=absolute.slice(root.length).split('/').filter(Boolean),chain=[];
  let current=root;
  for(const part of parts) {
    current=join(current,part);let info=await exists(current);
    if(!info&&create){try{await mkdir(current,{mode:0o700});}catch(error){if(error.code!=='EEXIST')throw error;}info=await exists(current);}
    if(!info)break;
    if(!info.isDirectory()||info.isSymbolicLink())fail('WORKTREES_ROOT_UNSAFE','The workspace directory must have real directory ancestors.');
    chain.push({path:current,dev:info.dev,ino:info.ino});
  }
  return chain;
}
export async function assertChain(chain) {
  for(const entry of chain){const info=await lstat(entry.path);if(!info.isDirectory()||info.isSymbolicLink()||info.dev!==entry.dev||info.ino!==entry.ino)fail('WORKTREES_ROOT_UNSAFE','A workspace ancestor changed.');}
}
export async function inspectTarget(root,worktree,repo,commonDir) {
  if(Buffer.byteLength(worktree)>900||worktree.split('/').some(part=>Buffer.byteLength(part)>255))fail('WORKTREE_PATH_TOO_LONG','The planned workspace path is too long for the supported local filesystem.');
  if(resolve(root)!==root||!within(worktree,root)||within(root,repo)||within(root,commonDir)||within(worktree,repo)||within(worktree,commonDir))fail('WORKTREES_ROOT_UNSAFE','The workspace destination is outside its safe configured boundary.');
  const chain=await directoryChain(dirname(worktree));
  if(await exists(worktree))fail('WORKTREE_COLLISION','The planned workspace path is occupied.');
  return chain;
}
export async function claimTarget(plan) {
  await inspectTarget(plan.worktreesRoot,plan.worktree,plan.repo,plan.gitCommonDir);
  const chain=await directoryChain(dirname(plan.worktree),{create:true});await assertChain(chain);
  try{await mkdir(plan.worktree,{mode:0o700});}catch(error){if(error.code==='EEXIST')fail('WORKTREE_COLLISION','The planned workspace path is occupied.');throw error;}
  const info=await lstat(plan.worktree);await assertChain(chain);
  return {dev:info.dev,ino:info.ino,chain};
}
