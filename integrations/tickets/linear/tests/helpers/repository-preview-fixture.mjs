import { mkdir,readdir,lstat,readFile } from 'node:fs/promises';
import { join,relative } from 'node:path';
import { createHash } from 'node:crypto';
import { fixture } from '../../../../../tests/helpers/backend-fixture.mjs';
import { createBackend } from '../../../../../src/backend.mjs';

import { withFakeHerdr } from '../../../../../tests/helpers/fake-herdr.mjs';
export async function previewFixture(t) {
  const f=await fixture(t),commands=[],paths={};
  const init=async path=>{await mkdir(path,{recursive:true});await f.command('git',['init','-b','main',path]);return path;};
  const projects=[];
  for(const [key,children] of [
    ['alpha',['admin','app','specs','website']],['gamma',['admin','app','specs']],
    ['delta',['app','admin','specs']],['beta',[]],['lba',[]],
  ]) {
    const root=key==='alpha'?f.repo:await init(join(f.root,key));
    paths[key]={workspace:root};
    const repos=[];
    if(children.length)repos.push({key:'workspace',path:root,labels:['workspace'],aliases:[],mainBranch:'main',tests:{}});
    else repos.push({key:'app',path:root,labels:[],aliases:[],mainBranch:'main',tests:{}});
    for(const child of children) {
      const path=await init(join(root,child));paths[key][child]=path;
      repos.push({key:child,path,labels:[key==='delta'&&child==='app'?'web':child],aliases:key==='delta'&&child==='app'?['packages','infra']:[],mainBranch:'main',tests:{}});
    }
    projects.push({key,name:key,teamId:'team-'+key,projectId:'project-'+key,kind:children.length?'produit':'annexe',color:'#808080',machine:null,repos});
  }
  for(const path of [join(paths.delta.app,'apps','web'),join(paths.delta.app,'apps','admin'),join(paths.lba.workspace,'apps','strapi')])await mkdir(path,{recursive:true});
  const config={version:2,tracker:{transport:'mcp',endpoint:'https://mcp.linear.app/mcp/readonly'},worktreesRoot:join(f.root,'future-worktrees'),wip:{dev:2,review:3,maxParallelDevs:2},launch:{confirm:'each'},projects,profiles:{version:'unconfigured',dev:{},review:{}}};
  await f.write('config.json',config);
  const backend=createBackend(withFakeHerdr({root:f.home,tracker:f.tracker,exec:async(file,args,options)=>{
    commands.push({file,args,options});
    if(file!=='git')throw new Error('Preview invoked a non-Git program');
    return f.command(file,args,options);
  }}));
  const ticket=(key,labels=[])=>({id:'ticket-'+key,identifier:'FIX-1',team:{id:'team-'+key},project:{id:'project-'+key},labels:labels.map(name=>({id:'label-'+name,name}))});
  const preview=issue=>backend.dispatch('repo-preview',{issue});
  return {...f,backend,config,paths,commands,ticket,preview,init};
}

export async function treeEvidence(root) {
  const entries=[];
  async function walk(path) {
    const info=await lstat(path),name=relative(root,path);
    entries.push([name,info.mode,info.size,info.mtimeMs,info.ino,info.isFile()?createHash('sha256').update(await readFile(path)).digest('hex'):null]);
    if(info.isDirectory())for(const child of (await readdir(path)).sort())await walk(join(path,child));
  }
  await walk(root);return entries;
}
