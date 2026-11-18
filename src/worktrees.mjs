import { join } from 'node:path';
import { realpath, access, writeFile, rm } from 'node:fs/promises';
import { randomUUID, createHash } from 'node:crypto';
import { AppError, fail, privateDir } from './common.mjs';
import { now } from './state.mjs';

export function createWorktrees({root,git,invoke,loadState,getSession}) {
  const ensureWorktree=async(session)=>{
    let cwd;try{cwd=await realpath(session.worktree);}catch{fail('WORKTREE_MISSING','The session worktree is unavailable.');}
    if(cwd!==session.worktree) fail('UNSAFE_WORKTREE','The session worktree path changed.');
    const branch=await git(cwd,['branch','--show-current']);if(branch!==session.branch)fail('WORKTREE_CHANGED','The session worktree is on a different branch.');return cwd;
  };
  const inspectGit=async(session)=>{
    const cwd=await ensureWorktree(session);
    const [status,diff,stat,commits]=await Promise.all([
      git(cwd,['status','--short','--untracked-files=normal']),
      git(cwd,['diff','--no-ext-diff','--no-textconv',session.baseCommit,'--']),
      git(cwd,['diff','--no-ext-diff','--no-textconv','--stat',session.baseCommit,'--']),
      git(cwd,['log','--oneline',`${session.baseCommit}..HEAD`,'--']),
    ]);
    return {branch:session.branch,status,diff,stat,commits};
  };
  async function createSession({issue,input,project,state,review}) {
    let repo;try{repo=await realpath(project.repo);}catch{fail('INVALID_CONFIG','The configured local repository is unavailable.');}
    let baseCommit,reviewSource=null,patch='';
    if(review) {
      const sources=state.sessions.filter(s=>!s.role&&s.issueId===issue.id&&s.projectKey===project.key&&!s.review&&s.repo===repo).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));
      const source=sources.find(s=>s.tool!==input.tool)??sources[0];
      if(!source)fail('REVIEW_SOURCE_REQUIRED','Start an implementation session for this issue before creating an independent review.');
      await ensureWorktree(source);baseCommit=await git(source.worktree,['rev-parse','--verify','HEAD']);
      try {patch=(await invoke('git',['-C',source.worktree,'diff','--binary','--no-ext-diff','--no-textconv',baseCommit,'--'],{maxBuffer:8*1024*1024})).stdout;}
      catch {fail('REVIEW_SNAPSHOT','The tracked source diff could not be captured.');}
      reviewSource={sessionId:source.id,tool:source.tool,worktree:source.worktree,branch:source.branch,head:baseCommit,snapshotAt:now(),trackedPatchApplied:!!patch};
    }else baseCommit=await git(repo,['rev-parse','--verify',`refs/heads/${project.mainBranch}^{commit}`]);
    const key=createHash('sha256').update(`${issue.id}:${input.tool}:${review?'review':'work'}:${project.key}`).digest('hex').slice(0,16);
    const branch=`fabrique-console/${String(issue.identifier??'issue').toLowerCase().replace(/[^a-z0-9-]/g,'-').slice(0,60)}-${input.tool}-${review?'review':'work'}-${key.slice(0,6)}`;
    await privateDir(join(root,'worktrees'));const worktree=join(root,'worktrees',`${project.key}-${key}`);
    try{await access(worktree);fail('WORKTREE_COLLISION','An unmanaged worktree already occupies the target path.');}catch(error){if(error instanceof AppError)throw error;if(error.code!=='ENOENT')fail('WORKTREE_COLLISION','Cannot verify the worktree target.');}
    await git(repo,['worktree','add','-b',branch,worktree,baseCommit]);
    if(patch) {
      await privateDir(join(root,'patches'));const patchPath=join(root,'patches',`${randomUUID()}.patch`);
      try {await writeFile(patchPath,patch,{mode:0o600,flag:'wx'});await git(worktree,['apply','--check','--binary',patchPath]);await git(worktree,['apply','--binary',patchPath]);}
      finally {await rm(patchPath,{force:true});}
    }
    const session={id:randomUUID(),issueId:issue.id,identifier:issue.identifier,title:issue.title,issueUrl:issue.url,tool:input.tool,review,...(reviewSource?{reviewSource}:{}),projectKey:project.key,repo,worktree:await realpath(worktree),branch,mainBranch:project.mainBranch,baseCommit,terminalId:null,status:'unknown',createdAt:now(),updatedAt:now(),qaId:null};
    return session;
  }
  const inspectSessionGit=async input=>inspectGit(getSession(await loadState(),input.sessionId));
  return {ensureWorktree,inspectGit,createSession,inspectSessionGit};
}
