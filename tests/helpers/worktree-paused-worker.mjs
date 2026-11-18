import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { startWorkspaceWorker } from '../../src/workspace-worker.mjs';
import { executeWorkspaceJob,createWorkspacePublisher } from '../../src/workspace-execution.mjs';
const [root,preparationId,nonce]=process.argv.slice(2);
const publish=createWorkspacePublisher(root,preparationId,nonce);
startWorkspaceWorker({root,preparationId,nonce,execute:job=>executeWorkspaceJob({...job,publish:async patch=>{
  if(patch.status==='prepared'){await writeFile(join(root,'after-git-'+preparationId),'fixture');await new Promise(()=>{});}
  return publish(patch);
}})});
// The deliberately delayed durable publisher represents a stalled state write.
setInterval(()=>{},1000);
