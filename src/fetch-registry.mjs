import { randomUUID } from 'node:crypto';
import { fail,AppError,object,text } from './common.mjs';
import { fingerprint,refusal } from './workspace-state.mjs';
import { forcedAudit,forceReason } from './forced-audit.mjs';
import { groupAlive } from './git-process-group.mjs';
import { systemBootId,processBirth,identifiedWorkerAlive } from './process-identity.mjs';

const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const ownerAlive=pid=>{try{process.kill(pid,0);return true;}catch(error){return error.code!=='ESRCH';}};

export function createFetchRegistry({store,bootId=systemBootId,birth=processBirth,alive=groupAlive,waitMs=5000}) {
  async function ended(lease,boot) {
    if(boot&&lease.bootId&&boot!==lease.bootId)return true;
    if(lease.worker) {
      const worker=lease.worker;
      if(!Number.isSafeInteger(worker.pgid)||worker.pgid<=1)return false;
      try{if(!alive(worker.pgid))return true;}catch{return false;}
      if(worker.pid===worker.pgid&&worker.birth){const current=await birth(worker.pid);if(current&&current!==worker.birth)return true;}
      return false;
    }
    // No group was persisted, hence go could not be delivered.
    if(lease.ownerActive===false||!ownerAlive(lease.owner.pid))return true;
    const current=lease.owner.birth&&await birth(lease.owner.pid);
    return Boolean(current&&current!==lease.owner.birth);
  }
  const description=lease=>`Fetch ${lease.id}, groupe ${lease.worker?.pgid??'non démarré'}, dépôt ${lease.gitCommonDir}, depuis ${lease.createdAt}. Inspectez le groupe (ps -g) et son identité ; ne le signalez jamais par son numéro seul.`;
  async function run(gitCommonDir,perform) {
    const boot=await bootId(),owner={pid:process.pid,birth:await birth(process.pid)},deadline=Date.now()+waitMs;
    let lease;
    for(;;) {
      const pending=(await store.read()).value.fetches?.find(item=>item.gitCommonDir===gitCommonDir);
      if(pending) {
        if(await ended(pending,boot)) {
          await store.update(state=>{const i=state.fetches?.findIndex(item=>item.id===pending.id)??-1;if(i>=0&&fingerprint(state.fetches[i])===fingerprint(pending))state.fetches.splice(i,1);});
          continue;
        }
        if(pending.status==='uncertain'||pending.ownerActive===false||!ownerAlive(pending.owner.pid))fail('FETCH_RECOVERY_REQUIRED',description(pending)+' La terminaison reste incertaine ; nouvel aperçu refusé.');
        if(Date.now()>=deadline)fail('FETCH_BUSY',description(pending)+' Un fetch est en cours ; réessayez cet aperçu après sa fin.');
        await delay(25);continue;
      }
      lease={id:randomUUID(),gitCommonDir,status:'starting',bootId:boot,owner,ownerActive:true,worker:null,createdAt:new Date().toISOString()};
      const acquired=await store.update(state=>{state.fetches??=[];if(state.fetches.some(item=>item.gitCommonDir===gitCommonDir))return false;state.fetches.push(lease);return true;});
      if(acquired)break;
    }
    const finish=async confirmed=>store.update(state=>{
      const index=state.fetches?.findIndex(item=>item.id===lease.id)??-1;if(index<0)return;
      const current=state.fetches[index];
      if(confirmed||!current.worker)state.fetches.splice(index,1);
      else {current.status='uncertain';current.ownerActive=false;}
    });
    try {
      const result=await perform(async identity=>{
        const worker={...identity,birth:await birth(identity.pid)};
        await store.update(state=>{
          const current=state.fetches?.find(item=>item.id===lease.id);
          if(!current||current.status!=='starting')fail('FETCH_INTENT_CHANGED','The fetch intention changed before go.');
          current.worker=worker;current.status='running';
        });
      });
      await finish(result.terminated);return result;
    }catch(error){await finish(false);throw error;}
  }
  function fields(input,keys) {object(input);if(Object.keys(input).some(key=>!keys.includes(key)))fail('INVALID_ARGUMENT','Unexpected fetch recovery argument.');}
  async function inspect(input={}) {
    fields(input,['fetchId']);if(input.fetchId!==undefined)text(input.fetchId,'fetchId',200);
    const pending=(await store.read()).value.fetches??[],boot=await bootId();
    return {fetches:await Promise.all(pending.filter(item=>!input.fetchId||item.id===input.fetchId).map(async item=>({id:item.id,status:item.status,gitCommonDir:item.gitCommonDir,createdAt:item.createdAt,bootId:item.bootId,owner:item.owner,worker:item.worker?{pid:item.worker.pid,pgid:item.worker.pgid,birth:item.worker.birth}:null,confirmationHash:fingerprint(item),terminationProven:await ended(item,boot)})))};
  }
  async function abandon(input) {
    fields(input,['fetchId','confirmed','expectedHash','reason']);text(input.fetchId,'fetchId',200);forceReason(input.reason);
    if(input.confirmed!==true)return refusal('CONFIRMATION_REQUIRED','Confirmez explicitement l’abandon de cette intention ; il ne supprime ni ne signale rien et l’opération peut encore continuer.');
    const pending=(await store.read()).value.fetches?.find(item=>item.id===input.fetchId);
    if(!pending)fail('FETCH_INTENT_NOT_FOUND','No pending fetch has this id.');
    if(input.expectedHash!==fingerprint(pending))return refusal('CONFIRMATION_MISMATCH','L’intention a changé ; inspectez et confirmez son empreinte actuelle.');
    if(await ended(pending,await bootId()))return refusal('FORCE_NOT_REQUIRED','La fin est prouvée ; rejouez normalement l’aperçu pour réconcilier cette intention.');
    return store.update(async state=>{
      const index=state.fetches?.findIndex(item=>item.id===input.fetchId)??-1;
      if(index<0||fingerprint(state.fetches[index])!==input.expectedHash)return refusal('CONFIRMATION_MISMATCH','L’intention a changé avant son abandon.');
      if(await identifiedWorkerAlive(state.fetches[index].worker,{alive,birth}))return refusal('WORKER_ACTIVE','Le worker identifié est encore actif ; attendez sa fin puis réconciliez.');
      const audit=forcedAudit('fetch-abandon',state.fetches[index],input.expectedHash,input.reason);
      state.fetchAbandonments??=[];state.fetchAbandonments.push(audit);state.fetches.splice(index,1);
      return {status:'abandoned',fetchId:input.fetchId,audit:{at:audit.at,actor:audit.actor,expectedHash:audit.expectedHash}};
    });
  }
  const guarded=action=>async input=>{try{return await action(input);}catch(error){if(error instanceof AppError&&error.code!=='INVALID_ARGUMENT')return refusal(error.code,error.message);throw error;}};
  return {run,inspect:guarded(inspect),abandon:guarded(abandon)};
}
