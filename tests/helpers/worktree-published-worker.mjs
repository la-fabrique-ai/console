import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { startWorkspaceWorker } from '../../src/workspace-worker.mjs';
import { executeWorkspaceJob,createWorkspacePublisher } from '../../src/workspace-execution.mjs';
const [root,preparationId,nonce]=process.argv.slice(2),publish=createWorkspacePublisher(root,preparationId,nonce);
startWorkspaceWorker({root,preparationId,nonce,execute:job=>executeWorkspaceJob({...job,publish:async patch=>{
  const result=await publish(patch);
  if(patch.status==='prepared'){await writeFile(join(root,'prepared-published'),'fixture');await new Promise(()=>{});}
  return result;
}})});
setInterval(()=>{},1000);
