import { startWorkspaceWorker } from '../../src/workspace-worker.mjs';
import { executeWorkspaceJob,createWorkspacePublisher } from '../../src/workspace-execution.mjs';
const [root,preparationId,nonce]=process.argv.slice(2);
startWorkspaceWorker({root,preparationId,nonce,execute:options=>{
  const publish=createWorkspacePublisher(root,preparationId,nonce);
  return executeWorkspaceJob({...options,publish:patch=>{
    if(patch.phase==='checkout-created')throw new Error('Fixture failure before branch attachment');
    return publish(patch);
  }});
}});
