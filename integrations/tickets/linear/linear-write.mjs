import { join } from 'node:path';
import { readdir } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { fail, object, text, canonical, readJSON, writeJSON, withLock } from '../../../src/common.mjs';
import { now } from '../../../src/state.mjs';
import { teamProject } from '../../../src/ticket-read.mjs';

export function createLinearWriter({root,getLinear,loadConfig}) {
  const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  // The most recent uncertain creation of this exact payload, if any. No journal folder yet is no creation; a folder
  // that cannot be read is no proof of absence: the creation is refused. Only published journals are read, never
  // the temporary files of an interrupted write; a published journal that cannot be parsed refuses as well.
  const JOURNAL=/^create-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.json$/;
  async function uncertainCreation(payloadHash) {
    let names=[];
    try{names=(await readdir(join(root,'mutations'))).filter(n=>JOURNAL.test(n));}
    catch(error){if(error.code==='ENOENT')return null;fail('MUTATION_JOURNAL_UNREADABLE','The journal of past creations could not be read; no issue was created. Check the permissions of the mutations folder.');}
    const journals=await Promise.all(names.map(n=>readJSON(join(root,'mutations',n),null)));
    return journals.filter(j=>j&&j.kind==='issue-create'&&j.payloadHash===payloadHash&&['uncertain','pending'].includes(j.status)&&j.operationId).sort((a,b)=>String(b.attemptedAt).localeCompare(String(a.attemptedAt)))[0]||null;
  }
  // A new issue in the Backlog of the team of a configured project. The screen names the operation (one id per
  // submission, kept while it retries): the journal of that id knows the issue id chosen before the call, so a
  // lost answer is reconciled by reading that issue, never by creating it a second time. Two submissions with the
  // same title are two issues.
  async function create(input) {
    if(input.confirmed!==true)fail('CONFIRMATION_REQUIRED','Confirm the issue creation explicitly before writing to Linear.');
    const title=text(input.title,'title',255).trim();if(!title)fail('INVALID_ARGUMENT','Invalid title.');
    const operationId=text(input.operationId,'operationId',36);if(!UUID.test(operationId))fail('INVALID_ARGUMENT','Invalid operationId.');
    const project=await teamProject(loadConfig,input.key);
    const linear=await getLinear();
    const meta=await linear.meta({refresh:false});
    const backlog=meta.states.find(s=>s.team?.id===project.teamId&&s.type==='backlog');
    const payload={teamId:project.teamId,title,...(backlog?{stateId:backlog.id}:{})};
    const payloadHash=createHash('sha256').update(canonical(payload)).digest('hex');
    return withLock(root,async()=>{
      const path=join(root,'mutations',`create-${operationId.toLowerCase()}.json`),previous=await readJSON(path,null);
      if(previous&&previous.payloadHash!==payloadHash)fail('INVALID_ARGUMENT','This operationId was already used for another creation.');
      // A new operation while an identical one is still uncertain (the screen that asked it may be gone): the
      // caller is told, and chooses to resume that operation or to create another issue on purpose.
      if(!previous&&input.another!==true) {
        const pending=await uncertainCreation(payloadHash);
        if(pending)return {issue:null,pending:{operationId:pending.operationId,title,attemptedAt:pending.attemptedAt}};
      }
      if(previous?.status==='applied')return {issue:(await linear.detail(previous.issueId,{refresh:true})).issue,replayed:true};
      const issueId=previous?.issueId||randomUUID();
      const journal={kind:'issue-create',operationId:operationId.toLowerCase(),issueId,payloadHash,attemptedAt:now(),status:'pending',...(previous?{attempts:(previous.attempts||1)+1}:{})};
      // An uncertain attempt may have created the issue: it is looked for before anything is sent again.
      if(previous&&previous.status!=='rejected') {
        let found=null;try{found=(await linear.detail(issueId,{refresh:true})).issue;}catch(error){if(!['NOT_FOUND','LINEAR_API'].includes(error.code))throw error;}
        if(found){await writeJSON(path,{...journal,status:'applied',finishedAt:now(),reconciled:true});await linear.forgetBacklog?.(project.teamId);return {issue:found,replayed:true};}
      }
      await writeJSON(path,journal);
      try {
        const result=await linear.create({...payload,id:issueId});
        if(result?.success!==true||!result.issue)fail('LINEAR_MUTATION_FAILED','Linear did not confirm the issue creation. Refresh the backlog before another attempt.');
        await writeJSON(path,{...journal,status:'applied',finishedAt:now(),issueId:result.issue.id});
        await linear.forgetBacklog?.(project.teamId);
        return {issue:result.issue};
      }catch(error) {
        await writeJSON(path,{...journal,status:error.code==='LINEAR_MUTATION_FAILED'||error.code==='LINEAR_READ_ONLY'?'rejected':'uncertain',finishedAt:now(),errorCode:error.code??'INTERNAL_ERROR'});
        throw error;
      }
    });
  }
  async function mutate(input) {
    const payload=object(input.payload);
    if(input.confirmed!==true||!input.confirmedPayload||canonical(payload)!==canonical(input.confirmedPayload))fail('CONFIRMATION_REQUIRED','Confirm the exact mutation payload explicitly before writing to Linear.');
    if(Object.keys(payload).some(k=>!['issueId','stateId','comment'].includes(k)))fail('INVALID_ARGUMENT','Unsupported Linear mutation field.');
    text(payload.issueId,'issueId',200);
    if(!payload.stateId&&!payload.comment)fail('INVALID_ARGUMENT','A stateId or comment is required.');
    if(payload.comment)text(payload.comment,'comment',20000);
    const linear=await getLinear();let teamId=null;
    if(payload.stateId) {
      text(payload.stateId,'stateId',200);const [{issue},meta]=await Promise.all([linear.detail(payload.issueId,{refresh:true}),linear.meta({refresh:true})]);
      if(!meta.states.some(s=>s.id===payload.stateId&&s.team?.id===issue.team?.id))fail('INVALID_STATE','stateId must be a real workflow state ID belonging to this issue’s team.');
      teamId=issue.team?.id||null;
    }
    return withLock(root,async()=>{
      const hash=createHash('sha256').update(canonical(payload)).digest('hex');
      const path=join(root,'mutations',`${hash}.json`),previous=await readJSON(path,null);
      if(previous?.status==='applied')return previous.result;
      if(previous&&previous.status!=='rejected')fail('LINEAR_MUTATION_UNCERTAIN','This exact payload already had an uncertain or partial attempt. Reconcile Linear before preparing a new confirmed payload.');
      const journal={payloadHash:hash,attemptedAt:now(),status:'pending'};
      await writeJSON(path,journal);
      try {
        const result=await linear.mutate(payload);
        if(result?.success!==true)fail('LINEAR_MUTATION_FAILED','Linear did not confirm this mutation. Refresh before another attempt.');
        await writeJSON(path,{...journal,status:'applied',finishedAt:now(),result});
        // The lists kept for the team are stale now: the next read of the backlog goes to Linear.
        if(teamId)await linear.forgetBacklog?.(teamId);
        return result;
      }catch(error) {
        await writeJSON(path,{...journal,status:error.code==='LINEAR_MUTATION_FAILED'?'rejected':'uncertain',finishedAt:now(),errorCode:error.code??'INTERNAL_ERROR'});
        throw error;
      }
    });
  }
  return {mutate,create};
}
