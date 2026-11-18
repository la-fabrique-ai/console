import { userInfo } from 'node:os';
import { fail,text } from './common.mjs';

export function forceReason(reason) {
  if(reason===undefined)return;
  text(reason,'reason',500);
  if(/[\x00-\x1f]/.test(reason))fail('INVALID_ARGUMENT','Invalid force reason.');
}
export function forcedAudit(kind,previousState,expectedHash,reason) {
  const {uid,username}=userInfo();
  return {kind,at:new Date().toISOString(),actor:{uid,username},expectedHash,previousState:structuredClone(previousState),...(reason===undefined?{}:{reason})};
}
