import { readFile } from 'node:fs/promises';
import { createFetchRegistry } from '../../src/fetch-registry.mjs';
import { createWorkspaceState } from '../../src/workspace-state.mjs';
import { runGitGroup } from '../../src/git-process-group.mjs';
const job=JSON.parse(await readFile(process.argv[2],'utf8'));
setInterval(()=>{},1000);
const registry=createFetchRegistry({store:createWorkspaceState(job.root)});
await registry.run(job.common,async beforeGo=>{
  if(job.mode==='intention'){process.send({stage:'intention'});await new Promise(()=>{});}
  return runGitGroup(job.repo,job.args,{timeoutMs:10000,beforeGo:async worker=>{
    await beforeGo(worker);process.send({stage:'identity',worker});
    if(job.mode==='identity')await new Promise(()=>{});
  }});
});
