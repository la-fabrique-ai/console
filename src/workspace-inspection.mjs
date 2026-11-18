import { dirname,resolve } from 'node:path';
import { readdir } from 'node:fs/promises';
import { inspectWorkerGroup } from './process-identity.mjs';
import { nativeRealpath } from './repository-config.mjs';
import { exists,directoryChain } from './workspace-paths.mjs';
import { listWorktrees,branches,safeGitOptions,repositoryIdentity } from './workspace-git.mjs';
import { fingerprint } from './workspace-state.mjs';
export { cleanupAdvice } from './workspace-policy.mjs';

export const workspaceMarker=attempt=>`fabrique-console:${attempt.preparationId}:${attempt.instanceId}`;
export function ownerAlive(pid) {try{process.kill(pid,0);return true;}catch(error){return error.code!=='ESRCH';}}
export async function inspectWorkspace(attempt,git,{ignoreGroup=false}={}) {
  if(!ignoreGroup) {
    const group=await inspectWorkerGroup(attempt.worker);
    if(group.state==='reused')return {state:'group-reused',birth:group.birth};
    if(group.state==='alive'||(!attempt.worker&&attempt.ownerActive!==false&&ownerAlive(attempt.ownerPid)))return {state:'in-progress'};
  }
  try {
    const saved=attempt.repositoryIdentity??attempt.plan?.repositoryIdentity;
    if(!saved)return {state:'partial',reason:'repository-identity-unrecorded'};
    const source=await nativeRealpath(attempt.repo),sourceCommon=await nativeRealpath(resolve(source,await git(source,['rev-parse','--git-common-dir'])));
    if(source!==attempt.repo||sourceCommon!==attempt.gitCommonDir||fingerprint(await repositoryIdentity(source,sourceCommon))!==fingerprint(saved))return {state:'partial',reason:'repository-identity-changed'};
    const records=await listWorktrees(git,attempt.repo),expected=attempt.branch?'refs/heads/'+attempt.branch:null;
    const elsewhere=records.find(record=>record.worktree.toLowerCase()!==attempt.worktree.toLowerCase()&&(record.locked===workspaceMarker(attempt)||expected&&record.branch===expected));
    if(elsewhere)return {state:'partial',reason:'workspace-moved',path:elsewhere.worktree};
    let ancestorMissing=false;
    if(attempt.claimedPath) {
      for(const entry of attempt.claimedPath.chain) {
        const current=await exists(entry.path);
        if(!current){ancestorMissing=true;break;}
        if(!current.isDirectory()||current.isSymbolicLink()||current.dev!==entry.dev||current.ino!==entry.ino)return {state:'partial',reason:'ancestor-identity-changed',ancestor:entry.path};
      }
    }else await directoryChain(dirname(attempt.worktree));
    const record=records.find(record=>record.worktree.toLowerCase()===attempt.worktree.toLowerCase());
    const path=ancestorMissing?null:await exists(attempt.worktree),branch=attempt.branch&&(await branches(git,attempt.repo)).some(name=>name.toLowerCase()===attempt.branch.toLowerCase());
    if(!record&&!path&&!branch&&attempt.cleanupCompletedAt)return {state:'cleaned'};
    if(!record&&!path&&!branch)return {state:'none'};
    if(!record&&path?.isDirectory()&&!path.isSymbolicLink()&&!branch&&attempt.claimedPath?.dev===path.dev&&attempt.claimedPath?.ino===path.ino&&(await readdir(attempt.worktree)).length===0)return {state:'failed-owned-empty'};
    if(!record||!path?.isDirectory()||path.isSymbolicLink()||record.locked!==workspaceMarker(attempt))return {state:'partial',reason:'ownership-mismatch'};
    if(attempt.claimedPath&&(attempt.claimedPath.dev!==path.dev||attempt.claimedPath.ino!==path.ino))return {state:'partial',reason:'path-identity-changed'};
    const canonical=await nativeRealpath(attempt.worktree);
    if(canonical!==attempt.worktree)return {state:'partial',reason:'path-alias'};
    const common=await nativeRealpath(resolve(canonical,await git(canonical,['rev-parse','--git-common-dir'])));
    if(common!==attempt.gitCommonDir)return {state:'partial',reason:'git-identity-changed'};
    const head=await git(canonical,['rev-parse','--verify','HEAD']);
    if(attempt.cleanup&&!attempt.preparedAt)return {state:'partial',reason:'cleanup-pending',owned:true};
    const expectedBranch=attempt.branch?'refs/heads/'+attempt.branch:null;
    const detached=record.detached===true;
    if(attempt.preparedAt&&((expectedBranch&&record.branch===expectedBranch)||(!expectedBranch&&detached)))return {state:'prepared',head};
    if(head!==attempt.base.chosenSha)return {state:'partial',reason:'head-changed',owned:true};
    const indexLock=resolve(canonical,await git(canonical,['rev-parse','--git-path','index.lock']));
    if(await exists(indexLock))return {state:'partial',reason:'index-locked',owned:true};
    if(await git(canonical,[...safeGitOptions,'status','--porcelain=v1','--untracked-files=normal']))return {state:'partial',reason:'worktree-changed',owned:true};
    if(!expectedBranch&&detached||expectedBranch&&record.branch===expectedBranch)return {state:'prepared',head};
    if(expectedBranch&&detached&&!branch)return {state:'attach',head,owned:true};
    return {state:'partial',reason:'branch-mismatch',owned:true};
  }catch{return {state:'partial',reason:'inspection-failed'};}
}
