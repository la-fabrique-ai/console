import { rmdir,readdir } from 'node:fs/promises';
import { fail } from './common.mjs';
import { fingerprint,attemptHash,activeAttempt } from './workspace-state.mjs';
import { exists,assertChain } from './workspace-paths.mjs';
import { listWorktrees,branches } from './workspace-git.mjs';
import { manualCleanupMessage } from './workspace-policy.mjs';

async function snapshot(attempt,git) {
  if(!attempt.claimedPath)fail('CLEANUP_UNAVAILABLE','No recorded directory ownership is available.');
  await assertChain(attempt.claimedPath.chain);
  const path=await exists(attempt.worktree);
  if(!path?.isDirectory()||path.isSymbolicLink()||path.dev!==attempt.claimedPath.dev||path.ino!==attempt.claimedPath.ino)fail('CLEANUP_UNAVAILABLE','The cleanup path no longer has its recorded identity.');
  const record=(await listWorktrees(git,attempt.repo)).find(record=>record.worktree===attempt.worktree);
  if(record)fail('CLEANUP_MANUAL_REQUIRED',manualCleanupMessage);
  if((await readdir(attempt.worktree)).length)fail('CLEANUP_UNAVAILABLE','Only the recorded empty directory can be removed.');
  if(attempt.branch&&(await branches(git,attempt.repo)).some(branch=>branch.toLowerCase()===attempt.branch.toLowerCase()))fail('CLEANUP_MANUAL_REQUIRED',manualCleanupMessage);
  return {dev:path.dev,ino:path.ino};
}
export async function proposeCleanup(attempt,proof,git) {
  if(!activeAttempt(attempt)||attempt.preparedAt||proof.state!=='failed-owned-empty')return null;
  try {
    const proposal={kind:'empty-directory',snapshot:await snapshot(attempt,git),commands:[{program:'rmdir',argv:[attempt.worktree]}]};
    return {...proposal,hash:fingerprint({preparationId:attempt.preparationId,attemptHash:attemptHash(attempt),...proposal}),requiresConfirmation:true};
  }catch{return null;}
}

export async function executeWorkspaceCleanup({attempt,git,publish,removeEmptyDirectory=rmdir}) {
  const request=attempt.cleanup;
  // Also reject requests persisted by the previous release, before ANY Git call.
  if(request?.kind==='git-worktree')fail('CLEANUP_MANUAL_REQUIRED',manualCleanupMessage);
  if(request?.kind!=='empty-directory')fail('CLEANUP_UNAVAILABLE','No confirmed empty-directory cleanup is recorded.');
  const verify=async()=>{
    if(fingerprint(await snapshot(attempt,git))!==fingerprint(request.snapshot))fail('CLEANUP_CHANGED','The directory changed after cleanup confirmation.');
  };
  await verify();
  await publish({phase:'cleanup-starting'});
  await verify();await removeEmptyDirectory(attempt.worktree); // Atomic refusal if a file appears, or if the target becomes a symlink.
  if(await exists(attempt.worktree)||(await listWorktrees(git,attempt.repo)).some(record=>record.worktree===attempt.worktree))fail('CLEANUP_UNCERTAIN','Cleanup could not be proven complete.');
  await publish({cleanupCompletedAt:new Date().toISOString(),status:'failed-certain',phase:'cleaned'});
}
