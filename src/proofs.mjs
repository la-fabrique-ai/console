import { join } from 'node:path';
import { realpath } from 'node:fs/promises';
import { randomUUID,createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { fail, readJSON, writeJSON, withLock,canonical,clean,text } from './common.mjs';
import { now } from './state.mjs';
import { terminalId, labels, terminalState, parsed } from './terminals.mjs';
import { executeQA } from './qa-worker.mjs';
import { projectForSession } from './config.mjs';
import { captureCode } from './proof-code.mjs';
import { publishProof,observeProofQA,sessionProofs } from './proof-store.mjs';

export function createProofs({root,loadState,getSession,loadConfig,statePath,readTerminals,ensureWorktree,herdr}) {
  const qaRecordFor=async(session)=>{
    if(!session.qaId)return null;
    const result=await readJSON(join(root,'qa',`${session.qaId}.json`),null);
    if(result&&result.id!==session.qaId)fail('INVALID_DATA','The QA record does not match its filename.');
    const metadata=await readJSON(join(root,'qa',`${session.qaId}.terminal.json`),null);
    return result?{...result,...(metadata?{terminalId:metadata.terminalId}:{})}:null;
  };
  const qaFor=async session=>observeProofQA(root,session.qaId,await qaRecordFor(session));
  const observeQA=(qa,terminals)=>{
    if(!qa||!['running','unknown'].includes(qa.status))return qa;
    if(qa.finishedAt)return qa;
    if(qa.execution==='inline') {
      let alive=false;try{process.kill(qa.workerPid,0);alive=true;}catch{}
      return alive?qa:{...qa,status:'interrupted',exitCode:null,reason:'QA_WORKER_GONE'};
    }
    if(!terminals)return {...qa,status:'unknown',reason:'HC_UNAVAILABLE'};
    const terminal=terminals.find(t=>labels(t)['fabrique-console.qa']===qa.id&&labels(t)['fabrique-console.app']==='fabrique-console');
    if(terminal&&terminalState(terminal)!=='historical')return {...qa,status:'running'};
    if(terminal||qa.terminalId)return {...qa,status:'interrupted',exitCode:null,reason:'QA_TERMINAL_GONE'};
    return {...qa,status:'unknown',reason:'QA_LAUNCH_UNCERTAIN'};
  };
  async function reservation(task) {
    const until=Date.now()+5000;
    for(;;) {
      try{return await withLock(root,task);}catch(error){
        if(error.code!=='BUSY'||Date.now()>=until)throw error;
        await new Promise(resolve=>setTimeout(resolve,20));
      }
    }
  }
  async function qa(input) {
    const {run,project,session}=await reservation(async()=>{
      const state=await loadState(),session=getSession(state,input.sessionId),config=await loadConfig();
      const candidate=await projectForSession(config,session);
      const project=candidate&&await realpath(candidate.repo).catch(()=>null)===session.repo?candidate:null;
      if(!project)fail('MAPPING_CHANGED','The session repository mapping changed.');
      const profile=input.profile??Object.keys(project.tests)[0];
      if(typeof profile!=='string'||!Object.hasOwn(project.tests,profile))fail('QA_NOT_CONFIGURED','Choose a configured QA profile.');
      let current=await qaRecordFor(session);
      if(current&&['running','unknown'].includes(current.status)) {
        current=observeQA(current,current.execution==='inline'?undefined:await readTerminals());
        if(current.status==='running')fail('QA_RUNNING','This session already has a running QA job.');
        if(current.status==='unknown')fail('QA_UNCERTAIN','The previous QA launch is uncertain. Inspect its labeled terminal before starting another run.');
        await writeJSON(join(root,'qa',`${current.id}.json`),current);
      }
      await ensureWorktree(session);
      const test=project.tests[profile],id=randomUUID();
      const useTerminal=test.terminal===true||(test.terminal!==false&&test.timeoutMs>60000);
      const run={id,sessionId:session.id,profile,argv:test.argv,timeoutMs:test.timeoutMs,cwd:session.worktree,execution:useTerminal?'terminal':'inline',workerPid:useTerminal?null:process.pid,status:'running',startedAt:now(),finishedAt:null,exitCode:null,stdout:'',stderr:'',terminalId:null};
      if(canonical(clean(run))!==canonical(run))fail('PROOF_UNSERIALIZABLE','Evidence cannot be stored without alteration.');
      const before=await captureCode(session.worktree);
      const intent={proofId:id,runId:session.runId??null,sessionId:session.id,issueId:session.issueId,project:session.projectKey,
        repo:session.repoKey??session.repo,sha:before.sha,dirty:before.dirty,diffHash:before.diffHash,
        profile,profilesVersion:'sha256:'+createHash('sha256').update(canonical(project.tests)).digest('hex'),argv:test.argv,
        environment:'local',startedAt:run.startedAt,finishedAt:null,exitCode:null,status:'inconnu',originalStatus:'inconnu',before,after:null};
      await publishProof(root,id,intent,{intent:true});
      await writeJSON(join(root,'qa',`${id}.json`),run);session.qaId=id;await writeJSON(statePath,state);
      return {run,project,session};
    });
    const id=run.id;
    if(run.execution==='terminal') {
      const worker=fileURLToPath(new URL('./qa-worker.mjs',import.meta.url));
      try {
        const result=parsed((await herdr.run(['run','--bg','--json','--no-parent','--outlive-parent','--cwd',session.worktree,'--label',`herdr.space=fabrique-console-${project.key}`,'--label',`herdr.tab=fabrique-console-${session.id}`,'--label','fabrique-console.app=fabrique-console','--label',`fabrique-console.qa=${id}`,'--',process.execPath,worker,root,id])).stdout);
        // Separate metadata prevents racing with the worker's atomic result write.
        await writeJSON(join(root,'qa',`${id}.terminal.json`),{terminalId:terminalId(result)??null});
        return {run:await qaFor(session)};
      }catch {
        const latest=await readJSON(join(root,'qa',`${id}.json`),run);
        if(latest.status!=='running')return {run:await qaFor(session)};
        latest.status='unknown';latest.stderr='Could not confirm the QA terminal launch. Inspect herdr-core before retrying.';
        await writeJSON(join(root,'qa',`${id}.json`),latest);return {run:latest};
      }
    }
    const result=await executeQA(run,{root});await writeJSON(join(root,'qa',`${id}.json`),result);return {run:await qaFor(session)};
  }
  async function testProofs(input) {
    if((input.sessionId!==undefined)===(input.issueId!==undefined))fail('INVALID_ARGUMENT','Choose exactly one sessionId or issueId.');
    const state=await loadState();
    if(input.issueId!==undefined)text(input.issueId,'issueId',200);
    const sessions=input.sessionId!==undefined?[getSession(state,input.sessionId)]:state.sessions.filter(s=>!s.role&&s.issueId===input.issueId);
    const proofs=(await Promise.all(sessions.map(async session=>sessionProofs(root,session,await captureCode(session.worktree))))).flat();
    return {proofs,observedAt:now()};
  }
  return {qaFor,observeQA,qa,testProofs};
}
