// Git for the environment check, in local strict (M6, review point 4): a read may never download an object, call a
// credential helper or a monitor, or write in the repository.
//
// - --no-lazy-fetch: a missing object of a partial clone is an error, never fetched from its promisor remote.
// - protocol.allow=never: no transport at all, even if something asked for one; credential.helper= and core.askPass=
//   empty: no helper is ever called (the list of helpers is reset, those of the repository included).
// - core.fsmonitor=false, core.untrackedCache=false, gc.auto=0, maintenance.auto=false: no program of the
//   configuration and no housekeeping; GIT_OPTIONAL_LOCKS=0 (src/git-environment.mjs): no optional write.
// - A fixed environment: PATH and LC_ALL only (then GIT_OPTIONAL_LOCKS and GIT_TERMINAL_PROMPT, added by every Git call
//   of the tool). No HOME, so no global configuration of the account; nothing else of the caller.
export const LOCAL_GIT=Object.freeze(['--no-lazy-fetch','-c','protocol.allow=never','-c','credential.helper=','-c','core.askPass=','-c','core.fsmonitor=false','-c','core.untrackedCache=false','-c','gc.auto=0','-c','maintenance.auto=false']);
export const localGitEnvironment=(source=process.env)=>({PATH:source.PATH??'/usr/bin:/bin',LC_ALL:'C'});
// A function (args, options) running Git on `repo` in local strict, through `invoke` of src/commands.mjs.
export function localGit(invoke,repo,{source=process.env}={}) {
  return (args,options={})=>invoke('git',[...LOCAL_GIT,'-C',repo,...args],{timeout:60000,...options,env:localGitEnvironment(source)});
}
