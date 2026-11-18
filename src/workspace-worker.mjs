import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createWorkspaceState } from './workspace-state.mjs';
import { executeWorkspaceJob } from './workspace-execution.mjs';
import { fail } from './common.mjs';

export function startWorkspaceWorker({root,preparationId,nonce,execute=executeWorkspaceJob}) {
  let started=false;
  const timer=setTimeout(()=>process.exit(3),10000);
  process.once('disconnect',()=>{if(!started)process.exit(3);});
  process.once('message',async message=>{
    if(message?.type!=='go'||message.nonce!==nonce){process.exitCode=3;process.disconnect?.();return;}
    started=true;clearTimeout(timer);
    try {
      await createWorkspaceState(root).update(state=>{
        const attempt=state.attempts.find(a=>a.preparationId===preparationId);
        if(!attempt||attempt.worker?.pid!==process.pid||attempt.worker.nonce!==nonce||attempt.status!=='reserved'||attempt.goState!=='requested')fail('WORKER_OWNERSHIP','Worker go does not match its persisted process group and delivery intent.');
        attempt.status='creating';attempt.goAcknowledgedAt=new Date().toISOString();attempt.updatedAt=attempt.goAcknowledgedAt;
      });
      try{if(process.connected)process.send({type:'ack',nonce},()=>{});}catch{}
      await execute({root,preparationId,nonce});
    }catch{process.exitCode=1;}
    finally{if(process.connected)process.disconnect();}
  });
  try{if(process.connected)process.send({type:'ready',nonce,pid:process.pid},()=>{});}catch{}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const [root,preparationId,nonce]=process.argv.slice(2);startWorkspaceWorker({root,preparationId,nonce});
}
