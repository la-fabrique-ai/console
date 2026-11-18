import { rm,writeFile,readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { startWorkspaceWorker } from '../../src/workspace-worker.mjs';
import { executeWorkspaceJob } from '../../src/workspace-execution.mjs';
import { createWorkspaceState } from '../../src/workspace-state.mjs';
import { createCommands } from '../../src/commands.mjs';
import { exec } from '../../src/common.mjs';
const [root,preparationId,nonce]=process.argv.slice(2),git=createCommands({exec}).git;
startWorkspaceWorker({root,preparationId,nonce,execute:async job=>{
  const attempt=(await createWorkspaceState(root).read()).value.attempts.find(item=>item.preparationId===preparationId);
  if(await readFile(join(root,'object-loss-mode'),'utf8')==='gc') {
    // Actual GC between the parent's final observation and worktree add.
    await git(attempt.repo,['reflog','expire','--expire=now','--all']);
    await git(attempt.repo,['gc','--prune=now']);
  }else {
    const blob=await git(attempt.repo,['rev-parse',attempt.base.chosenSha+':payload']);
    // Incomplete closure with a commit that still exists. No production hook.
    await rm(join(attempt.gitCommonDir,'objects',blob.slice(0,2),blob.slice(2)));
  }
  await writeFile(join(root,'missing-object-checkpoint'),'fixture');
  return executeWorkspaceJob({...job,git});
}});
