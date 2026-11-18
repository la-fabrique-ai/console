import { basename, join } from 'node:path';
import { homedir } from 'node:os';
import { lstat, readdir, readFile, appendFile, mkdir } from 'node:fs/promises';
import { fail, writeJSON, withLock } from './common.mjs';
import { REPORT_COMMAND } from './dev-flow.mjs';
import { isLead } from './state.mjs';

// The worktree of an issue, made when the user clicks "Lancer les devs": the repository of the PO as it stands (its
// current commit), checked out on a branch named after the issue under ~/Developer/worktrees/<repo>/<issue>; every
// repository nested in it (admin, specs… of a workspace, each its own Git) gets its worktree at the same place inside.
// All the devs of the issue work there. Made once: a second click finds it again.
const exists=async path=>{try{await lstat(path);return true;}catch{return false;}};
const isRepo=async folder=>{try{return (await lstat(join(folder,'.git'))).isDirectory();}catch{return false;}};

export function createIssueWorktree({invoke,loadState,statePath,root,worktreesRoot=join(homedir(),'Developer','worktrees')}) {
  const git=(args)=>invoke('git',args,{timeout:60000});
  // The base of the issue (its branch, e.g. release/backoffice-v2), as origin has it now, when the repository knows it.
  async function baseRef(source,base) {
    if(!base)return null;
    try{await git(['-C',source,'fetch','-q','origin',base]);}catch{}
    try{await git(['-C',source,'rev-parse','--verify','-q','origin/'+base]);return 'origin/'+base;}catch{return null;}
  }
  async function add(source,dest,branch,base) {
    if(await exists(dest))return false;
    const known=(await git(['-C',source,'branch','--list',branch])).stdout.trim(),start=await baseRef(source,base)||'HEAD';
    await git(['-C',source,'worktree','add',...(known?[dest,branch]:['-b',branch,dest,start])]);
    return true;
  }
  // Before devs are launched (none at work): a clean worktree is rebased on the latest base; a conflict is undone and said.
  async function rebase(folder,source,base,out) {
    const ref=await baseRef(source,base);if(!ref)return;
    try{
      if((await git(['-C',folder,'status','--porcelain'])).stdout.trim()){out.push({repo:folder,result:'dirty'});return;}
      try{await git(['-C',folder,'merge-base','--is-ancestor',ref,'HEAD']);return;}catch{}
      await git(['-C',folder,'rebase','-q',ref]);out.push({repo:folder,result:'rebased'});
    }catch{try{await git(['-C',folder,'rebase','--abort']);}catch{}out.push({repo:folder,result:'conflict'});}
  }
  async function ensure(input) {
    return withLock(root,async()=>{
      const state=await loadState(),po=(state.sessions||[]).find(s=>s.id===input?.sessionId&&isLead(s));
      if(!po)fail('NOT_FOUND','PO session not found.');
      if(typeof po.repo!=='string'||!await isRepo(po.repo))fail('NOT_FOUND','The folder of the PO is not a Git repository.');
      if(typeof po.identifier!=='string'||!/^[A-Z][A-Z0-9]{0,9}-\d{1,7}$/.test(po.identifier))fail('INVALID_ARGUMENT','The PO has no tracker identifier.');
      const dest=join(worktreesRoot,basename(po.repo),po.identifier),branch=po.identifier.toLowerCase();
      // The base: given now (from the plan), else the one kept for the issue; none means the current commit.
      const base=typeof input?.base==='string'&&/^[A-Za-z0-9._\/-]{1,120}$/.test(input.base)&&!input.base.startsWith('-')?input.base:po.base||null;
      const created=[],rebased=[],repos=[[po.repo,dest]];
      try {
        if(await add(po.repo,dest,branch,base))created.push('.');
        for(const entry of await readdir(po.repo,{withFileTypes:true})) {
          if(!entry.isDirectory()||entry.name.startsWith('.'))continue;
          const nested=join(po.repo,entry.name);
          if(!await isRepo(nested))continue;
          repos.push([nested,join(dest,entry.name)]);
          if(await add(nested,join(dest,entry.name),branch,base))created.push(entry.name);
        }
      } catch {fail('WORKTREE_FAILED','The worktree of the issue could not be made. Look at the repository before trying again.');}
      if(input?.rebase===true&&base)for(const [source,folder] of repos)if(!created.includes(folder===dest?'.':basename(folder)))await rebase(folder,source,base,rebased);
      po.base=base;
      // The reports of the agents (.fabrique-console/) stay out of Git: one line in the exclude file of the repository.
      try{
        const common=(await git(['-C',po.repo,'rev-parse','--path-format=absolute','--git-common-dir'])).stdout.trim(),exclude=join(common,'info','exclude');
        let text='';try{text=await readFile(exclude,'utf8');}catch{}
        if(!text.split('\n').includes('.fabrique-console/')){await mkdir(join(common,'info'),{recursive:true});await appendFile(exclude,(text&&!text.endsWith('\n')?'\n':'')+'.fabrique-console/\n');}
      }catch{}
      po.worktree=dest;po.branch=branch;
      await writeJSON(statePath,state);
      return {path:dest,branch,base,created,rebased,command:REPORT_COMMAND};
    });
  }
  return {ensure};
}
