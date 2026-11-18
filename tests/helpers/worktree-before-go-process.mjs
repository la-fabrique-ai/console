import { readFile } from 'node:fs/promises';
import { fork } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createWorkspaceState } from '../../src/workspace-state.mjs';
const {root,plan}=JSON.parse(await readFile(process.argv[2],'utf8'));
const store=createWorkspaceState(root),preparationId=randomUUID(),nonce=randomUUID();
await store.update(state=>state.attempts.push({...plan,plan,preparationId,issueId:plan.issue.id,tool:plan.input.tool,role:plan.input.role,status:'reserved',phase:'create',goState:'not-sent',ownerPid:process.pid,ownerActive:true,worker:null,updatedAt:new Date().toISOString()}));
const worker=fork(new URL('../../src/workspace-worker.mjs',import.meta.url),[root,preparationId,nonce],{detached:true,stdio:['ignore','ignore','ignore','ipc']});
worker.once('message',async message=>{
  if(message.type!=='ready')throw new Error('Worker failed before go');
  await store.update(state=>{state.attempts.find(a=>a.preparationId===preparationId).worker={pid:worker.pid,pgid:worker.pid,nonce};});
  process.send({ready:true,preparationId,workerPid:worker.pid});
  // Deliberately no go. Killing this producer must make the real worker exit at EOF.
});
process.on('message',()=>{});
