import { writeFile,readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { startWorkspaceWorker } from '../../src/workspace-worker.mjs';
import { executeWorkspaceJob,createWorkspacePublisher } from '../../src/workspace-execution.mjs';
const [root,preparationId,nonce]=process.argv.slice(2),phase=await readFile(join(root,'cleanup-pause-phase'),'utf8');
const publish=createWorkspacePublisher(root,preparationId,nonce);
startWorkspaceWorker({root,preparationId,nonce,execute:job=>executeWorkspaceJob({...job,publish:async patch=>{
  if(patch.phase===phase){await writeFile(join(root,'cleanup-checkpoint'),'fixture');await new Promise(()=>{});}
  return publish(patch);
}})});
setInterval(()=>{},1000);
