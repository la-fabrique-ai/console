// the user's decisions, transmitted by Claude. Keep policy out of Git execution.
export const workspacePolicy=Object.freeze({
  releaseWithoutArtifacts:'automatic-before-go',cleanup:'empty-owned-directory-only',countLegacy:true,
  baseSource:'local-with-origin-option-when-behind',reviewsConsumeDevCapacity:false,localDevMaximum:2,
});

export function reservationLimits(config,projectKey) {
  const project=config.projects.find(project=>project.key===projectKey);
  return {dev:Math.min(config.wip.maxParallelDevs,workspacePolicy.localDevMaximum),review:project?.wip?.review??config.wip.review};
}

// These three functions isolate decisions 1, 2 and 4. Git execution
// does not decide release, cleanup or the default source of a development base.
export function statusAfterInspection(proof,attempt) {
  if(proof.state==='none'&&attempt.status==='reserved'&&attempt.phase==='create'&&attempt.goState==='not-sent'&&!attempt.goAcknowledgedAt)return 'failed-released';
  return proof.state==='prepared'?'prepared':proof.state==='attach'?'checkout-ready':['none','failed-owned-empty','cleaned'].includes(proof.state)?'failed-certain':'uncertain';
}
export const chosenBaseSha=({localSha,remoteSha,baseSource,reviewCommit})=>reviewCommit??(baseSource==='origin'?remoteSha:localSha);
export const manualCleanupMessage='Nettoyage manuel requis. Inspectez les fichiers réels, même masqués par assume-unchanged/skip-worktree ou ignorés, et les commits/branches. Préservez le travail avant de déverrouiller et retirer manuellement le dossier Git. Après effacement hors Git, inspectez git worktree prune --dry-run ; un prune manuel peut être nécessaire après déverrouillage de l’entrée concernée et vérification des autres entrées obsolètes. La branche créée peut subsister : conservez ses commits avant de la retirer aussi. Ensuite, lancez worktree-reconcile puis worktree-release avec confirmation ; la réservation reste prise jusque-là.';
export function cleanupAdvice(attempt,proof) {
  if(proof.state==='failed-owned-empty')return [{program:'rmdir',argv:[attempt.worktree],requiresConfirmation:true}];
  if(!['partial','attach'].includes(proof.state))return [];
  return [
    {program:'git',argv:['-C',attempt.worktree,'status','--short','--ignored'],requiresConfirmation:false,note:'Le statut ne prouve pas le contenu réel des fichiers masqués dans l’index.'},
    {program:'git',argv:['-C',attempt.worktree,'ls-files','-v'],requiresConfirmation:false,note:'Examiner notamment les indicateurs h et S et vérifier les fichiers réels.'},
    {program:'git',argv:['-C',attempt.worktree,'log','--oneline',`${attempt.base.chosenSha}..HEAD`,'--'],requiresConfirmation:false},
    {program:'git',argv:['-C',attempt.worktree,'branch','--contains','HEAD'],requiresConfirmation:false,note:manualCleanupMessage},
    {program:'git',argv:['-C',attempt.repo,'worktree','prune','--dry-run','--expire','now'],requiresConfirmation:false,note:'Inspection seule ; un enregistrement verrouillé demande d’abord une vérification et un déverrouillage manuels.'},
  ];
}
