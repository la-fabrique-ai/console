import { fork } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { AppError,fail,text,object } from './common.mjs';
import { fingerprint,attemptHash,refusal,activeAttempt } from './workspace-state.mjs';
import { manifestHash } from './workspace-plans.mjs';
import { legacyClaims,reservationRefusal } from './workspace-reservations.mjs';
import { inspectWorkspace,cleanupAdvice } from './workspace-inspection.mjs';
import { processBirth,workerGroupAlive,identifiedWorkerAlive } from './process-identity.mjs';
import { statusAfterInspection,manualCleanupMessage } from './workspace-policy.mjs';
import { proposeCleanup } from './workspace-cleanup.mjs';
import { forcedAudit,forceReason } from './forced-audit.mjs';

const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function publicAttempt(attempt) {
  const keys=['preparationId','planId','instanceId','sessionId','runId','issueId','tool','role','projectKey','repoKey','repo','gitCommonDir','worktree','branch','base','status','phase','createdAt','updatedAt','preparedAt','errorCode'];
  return Object.fromEntries(keys.filter(key=>attempt[key]!==undefined).map(key=>[key,attempt[key]]));
}
function result(attempt,status=attempt.status,extra={}) {
  return {status,preparationId:attempt.preparationId,preparation:publicAttempt(attempt),preparationHash:attemptHash(attempt),agentLaunched:false,...extra};
}
function fields(input,allowed) {object(input);if(Object.keys(input).some(key=>!allowed.includes(key)))fail('INVALID_ARGUMENT','Unexpected workspace action argument.');}
function waitMessage(child,type,timeoutMs) {
  return new Promise(resolve=>{
    const finish=value=>{clearTimeout(timer);child.off('message',message);child.off('exit',exit);child.off('error',exit);resolve(value);};
    const message=value=>{if(value?.type===type)finish(value);};const exit=()=>finish(null);
    const timer=setTimeout(()=>finish(null),timeoutMs);child.on('message',message);child.once('exit',exit);child.once('error',exit);
  });
}

export function createWorkspacePreparation({root,readConfig,loadState,git,store,plans,workerPath=fileURLToPath(new URL('./workspace-worker.mjs',import.meta.url)),alertAfterMs=30000}) {
  async function find(id) {
    text(id,'preparationId',200);const attempt=(await store.read()).value.attempts.find(attempt=>attempt.preparationId===id);
    if(!attempt)fail('PREPARATION_NOT_FOUND','No workspace preparation has this id.');return attempt;
  }
  async function reconcile(input) {
    fields(input,['preparationId']);const attempt=await find(input.preparationId);
    if(['released','failed-released'].includes(attempt.status))return result(attempt,'released');
    const proof=await inspectWorkspace(attempt,git);
    if(proof.state==='group-reused') {
      const retired=await store.update(state=>{
        const current=state.attempts.find(a=>a.preparationId===attempt.preparationId);
        if(attemptHash(current)!==attemptHash(attempt))return false;
        current.worker.retiredAsReusedAt=new Date().toISOString();current.worker.observedBirth=proof.birth;return true;
      });
      return retired?reconcile(input):refusal('RECONCILE_CHANGED','The preparation changed during process inspection. Inspect it again.');
    }
    if(proof.state==='in-progress')return result(attempt,'creating',{warning:'The recorded worker group or owner is still active; its reservation is retained.'});
    const status=statusAfterInspection(proof,attempt);
    const updated=await store.update(state=>{
      const current=state.attempts.find(a=>a.preparationId===attempt.preparationId);
      if(attemptHash(current)!==attemptHash(attempt))return null;
      if(current.status!==status){current.status=status;current.phase=status==='prepared'?'complete':status==='checkout-ready'?'attach':status;current.updatedAt=new Date().toISOString();}
      if(status==='prepared'&&!current.preparedAt)current.preparedAt=new Date().toISOString();
      return structuredClone(current);
    });
    if(!updated)return refusal('RECONCILE_CHANGED','The preparation changed during inspection. Inspect it again.');
    return result(updated,status==='checkout-ready'?'needs-finalization':status==='failed-released'?'released':status,{proof:proof.state,inspection:proof,automaticRelease:status==='failed-released',manualCleanup:cleanupAdvice(updated,proof),cleanupProposal:await proposeCleanup(updated,proof,git)});
  }
  async function runWorker(attempt,phase='create') {
    const nonce=randomUUID();let child;
    // A worker gets no go until its process group and nonce have been persisted.
    try {
      child=fork(workerPath,[root,attempt.preparationId,nonce],{detached:true,stdio:['ignore','ignore','ignore','ipc']});
      const ready=await waitMessage(child,'ready',10000);
      if(!ready||ready.nonce!==nonce||ready.pid!==child.pid)throw new AppError('WORKER_START_UNCERTAIN','The workspace worker did not announce a valid identity.');
      const birth=await processBirth(child.pid);
      await store.update(state=>{
        const current=state.attempts.find(a=>a.preparationId===attempt.preparationId);
        if(attemptHash(current)!==attemptHash(attempt)||workerGroupAlive(current.worker))fail('WORKER_OWNERSHIP','Another worker already owns this preparation.');
        current.workerHistory??=[];if(current.worker)current.workerHistory.push(current.worker);
        current.worker={pid:child.pid,pgid:child.pid,nonce,birth,registeredAt:new Date().toISOString()};
        current.goState='not-sent';
        current.status='reserved';current.phase=phase;current.ownerPid=process.pid;current.ownerActive=true;current.updatedAt=new Date().toISOString();
      });
      // Persist possible delivery before IPC: absence of this intent proves no go.
      await store.update(state=>{
        const current=state.attempts.find(a=>a.preparationId===attempt.preparationId);
        if(current?.worker?.nonce!==nonce||current.status!=='reserved')fail('WORKER_OWNERSHIP','The worker lost its reservation before go.');
        current.goState='requested';
      });
      const acknowledged=waitMessage(child,'ack',10000);
      child.send({type:'go',nonce},()=>{});
      await acknowledged; // The durable acknowledgement remains authoritative if IPC is lost.
    }catch {
      await store.update(state=>{
        const current=state.attempts.find(a=>a.preparationId===attempt.preparationId);
        if(current&&activeAttempt(current)&&(!current.worker||current.worker.nonce===nonce)){current.ownerActive=false;current.status='uncertain';current.phase='worker-start-uncertain';current.updatedAt=new Date().toISOString();}
      });
      return refusal('WORKER_START_UNCERTAIN','Worker startup could not be confirmed. Reconcile this reservation before another attempt.',{preparationId:attempt.preparationId});
    }finally {
      try{if(child?.connected)child.disconnect();}catch{}
      child?.unref();
      await store.update(state=>{
        const current=state.attempts.find(a=>a.preparationId===attempt.preparationId);
        if(current&&(!current.worker||current.worker.nonce===nonce))current.ownerActive=false;
      });
    }
    const end=Date.now()+alertAfterMs;
    while(Date.now()<end) {
      const current=await find(attempt.preparationId);
      if(!workerGroupAlive(current.worker))return reconcile({preparationId:attempt.preparationId});
      await delay(25);
    }
    return result(await find(attempt.preparationId),'creating',{warning:'Git is still running. Its reservation is retained; inspect this preparation instead of creating another.'});
  }
  async function prepare(input) {
    fields(input,['planId','confirmation']);text(input.planId,'planId',200);
    if(input.confirmation!==undefined){fields(input.confirmation,['manifestHash','parallel']);if(input.confirmation.parallel!==undefined)fields(input.confirmation.parallel,['reason','occupantIds']);}
    const state=(await store.read()).value,plan=state.plans.find(p=>p.planId===input.planId);
    if(!plan)fail('PLAN_NOT_FOUND','No workspace plan has this id.');
    const existing=state.attempts.find(a=>a.planId===plan.planId);
    if(existing) {
      const loaded=await plans.fresh(plan.input);
      if(loaded.refused)return loaded.refused;
      if(loaded.selected.repository.gitCommonDir!==existing.gitCommonDir||loaded.selected.repository.path!==existing.repo)return refusal('MAPPING_CHANGED','The ticket no longer selects the preparation repository.');
      const inspected=await reconcile({preparationId:existing.preparationId});
      if(inspected.status==='needs-finalization'&&!existing.cleanup)return runWorker(await find(existing.preparationId),'attach');
      return {...inspected,reused:true};
    }
    const observed=await plans.observe(plan.input,plan);
    if((await store.read()).value.attempts.some(a=>a.planId===plan.planId))return prepare(input);
    if(observed.status!=='planned')return observed;
    if(manifestHash(observed)!==plan.manifestHash)return refusal('PLAN_CHANGED','The ticket, repository, base or lane observations changed. Request a new plan.');
    if(input.confirmation&&input.confirmation.manifestHash!==plan.manifestHash)return refusal('CONFIRMATION_MISMATCH','Confirmation must match this exact workspace manifest.');
    if(plan.needsConfirmation&&!input.confirmation)return refusal('BASE_CONFIRMATION_REQUIRED','Confirm this exact behind, divergent or unverified base.',{planId:plan.planId,manifestHash:plan.manifestHash,base:plan.base});
    const legacy=await legacyClaims(loadState,git);
    const reserved=await store.update(async current=>{
      const config=await readConfig();
      if(config.revision!==plan.configRevision||fingerprint(await loadState())!==legacy.fingerprint)return {refused:refusal('PLAN_CHANGED','Configuration or legacy activity changed before reservation.')};
      const own=current.attempts.find(a=>a.planId===plan.planId);if(own)return {attempt:structuredClone(own),created:false};
      const blocked=reservationRefusal(current,plan,config.config,legacy,input.confirmation);if(blocked)return {refused:blocked};
      const now=new Date().toISOString(),attempt={preparationId:randomUUID(),planId:plan.planId,instanceId:plan.instanceId,sessionId:plan.sessionId,runId:plan.runId,issueId:plan.issue.id,tool:plan.input.tool,role:plan.input.role,projectKey:plan.projectKey,repoKey:plan.repoKey,repo:plan.repo,gitCommonDir:plan.gitCommonDir,worktree:plan.worktree,branch:plan.branch,base:plan.base,manifestHash:plan.manifestHash,plan,status:'reserved',phase:'create',goState:'not-sent',ownerPid:process.pid,ownerActive:true,worker:null,createdAt:now,updatedAt:now,parallelApproval:input.confirmation?.parallel??null};
      current.attempts.push(attempt);return {attempt:structuredClone(attempt),created:true};
    });
    if(reserved.refused)return reserved.refused;
    return reserved.created?runWorker(reserved.attempt):{...await reconcile({preparationId:reserved.attempt.preparationId}),reused:true};
  }
  async function release(input) {
    fields(input,['preparationId','confirmed','expectedHash','force','reason']);
    if(input.force!==undefined&&typeof input.force!=='boolean')fail('INVALID_ARGUMENT','force must be an explicit boolean.');
    forceReason(input.reason);
    if(input.confirmed!==true)return refusal('CONFIRMATION_REQUIRED','Releasing a reservation requires exact explicit confirmation.');
    const before=await find(input.preparationId);
    if(input.expectedHash!==attemptHash(before))return refusal('CONFIRMATION_MISMATCH','The preparation changed. Reconcile and confirm its current state.');
    const inspected=await reconcile({preparationId:before.preparationId});
    if(input.force===true) {
      if(inspected.status==='refused')return inspected;
      if(['prepared','failed-certain','released'].includes(inspected.status))return refusal('FORCE_NOT_REQUIRED','L’état est prouvé ; utilisez la libération normale.');
      return store.update(async state=>{
        const current=state.attempts.find(a=>a.preparationId===before.preparationId);
        if(attemptHash(current)!==input.expectedHash)return refusal('CONFIRMATION_MISMATCH','La préparation a changé avant la libération forcée.');
        if(await identifiedWorkerAlive(current.worker))return refusal('WORKER_ACTIVE','Le worker identifié est encore actif ; attendez sa fin puis réconciliez.');
        current.forcedRelease=forcedAudit('reservation-release',current,input.expectedHash,input.reason);
        current.status='released';current.phase='forced-release';current.updatedAt=new Date().toISOString();
        return result(current,'released',{forced:true});
      });
    }
    if(!['prepared','failed-certain'].includes(inspected.status))return refusal('PREPARATION_UNCERTAIN','A running or uncertain preparation cannot be released.',{preparationId:before.preparationId});
    return store.update(state=>{
      const current=state.attempts.find(a=>a.preparationId===before.preparationId);
      if(attemptHash(current)!==input.expectedHash||workerGroupAlive(current.worker))return refusal('CONFIRMATION_MISMATCH','The preparation changed before release.');
      current.status=current.status==='failed-certain'?'failed-released':'released';current.updatedAt=new Date().toISOString();return result(current,'released');
    });
  }
  async function cleanup(input) {
    fields(input,['preparationId','confirmed','expectedHash']);
    if(input.confirmed!==true)return refusal('CONFIRMATION_REQUIRED','Confirm the exact proposed cleanup commands before execution.');
    const inspected=await reconcile({preparationId:input.preparationId}),proposal=inspected.cleanupProposal;
    if(!proposal)return refusal('CLEANUP_MANUAL_REQUIRED',manualCleanupMessage);
    if(input.expectedHash!==proposal.hash)return refusal('CLEANUP_CHANGED','The cleanup proposal changed. Inspect and confirm the current commands.');
    const reserved=await store.update(state=>{
      const current=state.attempts.find(a=>a.preparationId===input.preparationId);
      if(attemptHash(current)!==inspected.preparationHash||workerGroupAlive(current.worker))return null;
      current.workerHistory??=[];if(current.worker)current.workerHistory.push(current.worker);
      current.worker=null;current.cleanup=proposal;current.cleanupRequestedAt=new Date().toISOString();current.status='reserved';current.phase='cleanup';current.goState='not-sent';
      current.ownerPid=process.pid;current.ownerActive=true;return structuredClone(current);
    });
    if(!reserved)return refusal('CLEANUP_CHANGED','The preparation changed before cleanup reservation.');
    return runWorker(reserved,'cleanup');
  }
  const guarded=action=>async input=>{try{return await action(input);}catch(error){if(error instanceof AppError&&error.code!=='INVALID_ARGUMENT')return refusal(error.code,error.message);throw error;}};
  return {prepare:guarded(prepare),reconcile:guarded(reconcile),release:guarded(release),cleanup:guarded(cleanup)};
}
