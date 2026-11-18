import { join } from 'node:path';
import { readdir } from 'node:fs/promises';
import { clean,canonical,fail,readJSON } from './common.mjs';
import { createDurableStorage } from './durable-storage.mjs';
import { captureCode } from './proof-code.mjs';

const uuid=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const pathFor=(root,id,suffix='')=>{
  if(typeof id!=='string'||!uuid.test(id))fail('INVALID_DATA','Invalid proof identifier.');
  return join(root,'proofs',`${id}${suffix}.json`);
};
export async function publishProof(root,id,value,{intent=false}={}) {
  if(canonical(clean(value))!==canonical(value))fail('PROOF_UNSERIALIZABLE','Evidence cannot be stored without alteration.');
  // backup publishes a complete fsynced file with link(O_EXCL semantics), never rename over an existing record.
  await createDurableStorage().backup(pathFor(root,id,intent?'.intent':''),JSON.stringify(value,null,2)+'\n');
}
export const readProofIntent=(root,id)=>readJSON(pathFor(root,id,'.intent'),null);
export async function finishProof(root,run,before,after) {
  const intent=await readProofIntent(root,run.id);if(!intent)return null;
  const same=!!before.stateHash&&before.stateHash===after.stateHash;
  const known=same&&!run.outputTruncated&&!run.signal&&Number.isInteger(run.exitCode)&&['passed','failed'].includes(run.status);
  const originalStatus=known?(run.exitCode===0?'réussi':'échoué'):'inconnu';
  const proof={...intent,sha:before.sha,dirty:before.dirty,diffHash:before.diffHash,before,after,
    startedAt:run.startedAt,finishedAt:run.finishedAt,exitCode:run.exitCode,signal:run.signal??null,
    outputTruncated:run.outputTruncated===true,originalStatus,status:originalStatus};
  await publishProof(root,run.id,proof);return proof;
}
export function proofStatus(proof,current) {
  if(!current?.stateHash||!proof.before?.stateHash)return 'inconnu';
  if(current.stateHash!==proof.before.stateHash)return 'périmé';
  if(!proof.finishedAt||!proof.after?.stateHash||proof.before.stateHash!==proof.after.stateHash)return 'inconnu';
  return proof.originalStatus;
}
export async function evaluatedProof(root,id,run,current) {
  if(run.id!==id)fail('INVALID_DATA','The QA record does not match its filename.');
  const [intent,stored]=await Promise.all([readProofIntent(root,id),readJSON(pathFor(root,id),null)]);
  for(const record of [intent,stored])if(record&&(record.proofId!==id||record.sessionId!==run.sessionId))fail('INVALID_DATA','The proof does not match its QA record.');
  if(stored)return {...stored,status:proofStatus(stored,current)};
  if(intent)return {...intent,status:'inconnu',originalStatus:'inconnu'};
  return {proofId:run.id,runId:null,sessionId:run.sessionId,issueId:null,project:null,repo:null,
    sha:null,dirty:null,diffHash:null,profile:run.profile,profilesVersion:null,argv:run.argv,
    environment:'local',startedAt:run.startedAt,finishedAt:run.finishedAt??null,exitCode:run.exitCode??null,
    status:'inconnu',originalStatus:'inconnu',legacy:true};
}
export async function sessionProofs(root,session,current) {
  let names;try{names=await readdir(join(root,'qa'));}catch(error){if(error.code==='ENOENT')return [];throw error;}
  const runs=[];
  for(const name of names.filter(name=>name.endsWith('.json')&&uuid.test(name.slice(0,-5))).sort()) {
    const run=await readJSON(join(root,'qa',name),null);
    if(run?.sessionId===session.id)runs.push(await evaluatedProof(root,name.slice(0,-5),run,current));
  }
  return runs.sort((a,b)=>a.startedAt.localeCompare(b.startedAt)||a.proofId.localeCompare(b.proofId));
}
export async function observeProofQA(root,id,run) {
  if(!run||!run.finishedAt)return run;
  const proof=await evaluatedProof(root,id,run,await captureCode(run.cwd));
  if(proof.status==='réussi'||proof.status==='échoué')return run;
  // Retain informative historical failure states; C5 is still unknown. Only a
  // success must be removed when its code cannot be verified.
  if(proof.status==='inconnu'&&['timed-out','interrupted','error','failed'].includes(run.status))return run;
  return {...run,status:proof.status==='périmé'?'stale':'unknown',reason:proof.status==='périmé'?'QA_PROOF_STALE':'QA_PROOF_UNKNOWN'};
}
