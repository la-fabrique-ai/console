import { createWorkspaceState } from './workspace-state.mjs';
import { createCommands } from './commands.mjs';
import { exec,fail } from './common.mjs';
import { claimTarget,assertChain } from './workspace-paths.mjs';
import { inspectWorkspace,workspaceMarker } from './workspace-inspection.mjs';
import { safeGitOptions,branches,branchConflict } from './workspace-git.mjs';
import { executeWorkspaceCleanup } from './workspace-cleanup.mjs';

export function createWorkspacePublisher(root,preparationId,nonce) {
  const store=createWorkspaceState(root);
  return patch=>store.update(state=>{
    const attempt=state.attempts.find(attempt=>attempt.preparationId===preparationId);
    if(!attempt||attempt.worker?.nonce!==nonce||['released','failed-released'].includes(attempt.status))fail('WORKER_OWNERSHIP','This worker no longer owns its reservation.');
    Object.assign(attempt,patch,{updatedAt:new Date().toISOString()});return structuredClone(attempt);
  });
}

const creationGit=createCommands({exec:(file,args,options)=>exec(file,args,{...options,timeout:0})}).git;
async function assertCompleteBase(attempt,git) {
  try {
    await git(attempt.repo,['--no-lazy-fetch',...safeGitOptions,'cat-file','-e',`${attempt.base.chosenSha}^{commit}`]);
  }catch{fail('REMOTE_BASE_UNAVAILABLE','Le commit de base n’est plus disponible. Demandez un nouvel aperçu.');}
  try {
    // Only the selected checkout tree is needed. Walking parent commits would
    // hydrate historical blobs in partial clones, even when the tree is ready.
    await git(attempt.repo,['--no-lazy-fetch',...safeGitOptions,'rev-list','--objects','--no-walk','--quiet',attempt.base.chosenSha,'--']);
  }catch{
    let partial=false;
    try{partial=/\s+true$/m.test(await git(attempt.repo,['config','--get-regexp','^remote\\..*\\.promisor$']));}catch{}
    if(partial)fail('BASE_TREE_NOT_MATERIALIZED','Les fichiers de la base sont incomplets dans ce clone partiel. Matérialisez manuellement l’arbre choisi avant de réconcilier et de libérer la réservation, puis demandez un nouvel aperçu.');
    fail('REMOTE_BASE_UNAVAILABLE','Le commit de base ou ses objets ne sont plus disponibles. Demandez un nouvel aperçu avant de réessayer.');
  }
}
export async function executeWorkspaceJob({root,preparationId,nonce,publish=createWorkspacePublisher(root,preparationId,nonce),git=creationGit,removeEmptyDirectory}) {
  const {value:state}=await createWorkspaceState(root).read(),attempt=state.attempts.find(a=>a.preparationId===preparationId);
  if(!attempt||attempt.worker?.nonce!==nonce||attempt.worker.pid!==process.pid||attempt.status!=='creating')fail('WORKER_OWNERSHIP','The worker has no durable creation acknowledgement.');
  try {
    if(attempt.phase==='cleanup')return await executeWorkspaceCleanup({attempt,git,publish,removeEmptyDirectory});
    await assertCompleteBase(attempt,git);
    if(attempt.phase!=='attach') {
      const claimedPath=await claimTarget(attempt.plan);
      await publish({claimedPath,phase:'checkout-starting'});attempt.claimedPath=claimedPath;
      await assertChain(claimedPath.chain);
      await assertCompleteBase(attempt,git);
      await git(attempt.repo,[...safeGitOptions,'worktree','add','--quiet','--detach','--lock','--reason',workspaceMarker(attempt),'--',attempt.worktree,attempt.base.chosenSha]);
      await assertChain(claimedPath.chain);
      await publish({phase:'checkout-created'});
    }else {
      const proof=await inspectWorkspace(attempt,git,{ignoreGroup:true});if(proof.state!=='attach')fail('WORKTREE_UNCERTAIN','The checkout is not safe to finish.');
    }
    if(attempt.branch) {
      if((await branches(git,attempt.repo)).some(branch=>branchConflict(branch,attempt.branch)))fail('BRANCH_COLLISION','The development branch name or directory prefix became occupied.');
      await git(attempt.worktree,[...safeGitOptions,'switch','--no-guess','-c',attempt.branch,attempt.base.chosenSha]);
    }
    const proof=await inspectWorkspace({...attempt,status:'creating'},git,{ignoreGroup:true});
    if(proof.state!=='prepared')fail('WORKTREE_UNCERTAIN','The created checkout could not be verified.');
    await publish({status:'prepared',phase:'complete',preparedAt:new Date().toISOString()});
  }catch(error) {
    await publish({status:'uncertain',phase:'inspection-required',errorCode:typeof error.code==='string'?error.code:'GIT_ERROR'});
  }
}
