import { nativeRealpath } from './repository-config.mjs';
import { resolve } from 'node:path';
import { activeAttempt,refusal,fingerprint } from './workspace-state.mjs';
import { reservationLimits,workspacePolicy } from './workspace-policy.mjs';
import { branchConflict } from './workspace-git.mjs';

function stopped(session) {
  const at=Date.parse(session.stoppedAt),launch=session.launchAttemptAt?Date.parse(session.launchAttemptAt):null;
  return Number.isFinite(at)&&session.launchUncertain!==true&&(launch===null||(Number.isFinite(launch)&&at>=launch));
}
export async function legacyClaims(loadState,git) {
  const state=await loadState(),claims=[];
  for(const session of state.sessions) {
    if(stopped(session))continue;
    let common=null;
    try{const repo=await nativeRealpath(session.repo);common=await nativeRealpath(resolve(repo,await git(repo,['rev-parse','--git-common-dir'])));}catch{}
    claims.push({id:session.id,gitCommonDir:common,projectKey:session.projectKey??null,role:session.review?'review':'dev'});
  }
  return {fingerprint:fingerprint(state),claims};
}

export function reservationRefusal(state,plan,config,legacy,confirmation) {
  const active=state.attempts.filter(activeAttempt),limits=reservationLimits(config,plan.projectKey);
  const prior=active.find(a=>a.role==='dev'&&plan.input.role==='dev'&&a.issueId===plan.issue.id&&a.gitCommonDir===plan.gitCommonDir);
  if(prior)return refusal('TICKET_ALREADY_RESERVED','This ticket already owns a development preparation in this Git.',{preparationId:prior.preparationId});
  const old=workspacePolicy.countLegacy?legacy.claims:[];
  if(plan.input.role==='dev'&&old.some(c=>c.role==='dev'&&(!c.gitCommonDir||c.gitCommonDir===plan.gitCommonDir)))return refusal('LEGACY_RESERVATION_UNKNOWN','A legacy session may still own this Git. Reconcile or explicitly stop it first.');
  const used=plan.input.role==='dev'?active.filter(a=>a.role==='dev').length+old.filter(c=>c.role==='dev').length:active.filter(a=>a.role==='review'&&a.projectKey===plan.projectKey).length+old.filter(c=>c.role==='review'&&(!c.projectKey||c.projectKey===plan.projectKey)).length;
  if(used>=(plan.input.role==='dev'?limits.dev:limits.review))return refusal(plan.input.role==='dev'?'GLOBAL_CAPACITY':'REVIEW_CAPACITY','The preparation capacity is already reserved.');
  if(plan.input.role==='dev') {
    const occupants=active.filter(a=>a.role==='dev'&&a.gitCommonDir===plan.gitCommonDir).map(a=>a.preparationId).sort();
    if(occupants.length) {
      if(!confirmation?.parallel)return refusal('LANE_BUSY','Another development preparation owns this Git lane.',{occupants});
      const approval=confirmation.parallel;
      if(confirmation.manifestHash!==plan.manifestHash||!Array.isArray(approval.occupantIds)||fingerprint([...approval.occupantIds].sort())!==fingerprint(occupants)||fingerprint(occupants)!==fingerprint(plan.laneSnapshot)||typeof approval.reason!=='string'||!approval.reason.trim()||approval.reason.length>500||/[\x00-\x1f]/.test(approval.reason))return refusal('PARALLEL_CONFIRMATION_MISMATCH','Parallel approval must name the exact current occupants and independent modules.');
    }
  }
  const collision=active.find(a=>a.worktree.toLowerCase()===plan.worktree.toLowerCase()||(plan.branch&&a.branch&&a.gitCommonDir===plan.gitCommonDir&&branchConflict(a.branch,plan.branch)));
  return collision?refusal('WORKSPACE_RESERVED','The planned branch or path is already reserved.',{preparationId:collision.preparationId}):null;
}
