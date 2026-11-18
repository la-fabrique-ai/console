import { lstat } from 'node:fs/promises';
import { runGitGroup } from './git-process-group.mjs';
import { fail } from './common.mjs';
import { chosenBaseSha } from './workspace-policy.mjs';

export const fullSha=value=>typeof value==='string'&&/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value);
export function branchConflict(left,right) {
  left=left.toLowerCase();right=right.toLowerCase();
  return left===right||left.startsWith(right+'/')||right.startsWith(left+'/');
}
export const safeGitOptions=['-c','core.hooksPath=/dev/null','-c','core.fsmonitor=false','-c','gc.auto=0','-c','maintenance.auto=false'];
export function parseWorktrees(output) {
  return output.split('\0\0').filter(Boolean).map(record=>Object.fromEntries(record.split('\0').filter(Boolean).map(field=>{const i=field.indexOf(' ');return i<0?[field,true]:[field.slice(0,i),field.slice(i+1)];})));
}
export const listWorktrees=(git,repo)=>git(repo,['worktree','list','--porcelain','-z']).then(parseWorktrees);
export async function repositoryIdentity(repo,commonDir) {
  const [source,common]=await Promise.all([lstat(repo,{bigint:true}),lstat(commonDir,{bigint:true})]);
  if(!source?.isDirectory()||source.isSymbolicLink()||!common?.isDirectory()||common.isSymbolicLink())fail('REPO_UNAVAILABLE','Repository identity requires canonical real directories.');
  return {repo:{dev:String(source.dev),ino:String(source.ino)},common:{dev:String(common.dev),ino:String(common.ino)}};
}
export async function branches(git,repo) {
  return (await git(repo,['for-each-ref','--format=%(refname)','refs/heads/'])).split('\n').filter(Boolean).map(ref=>ref.slice('refs/heads/'.length));
}
export async function supportsWorkspaceGit(invoke,repo) {
  const version=(await invoke('git',['-C',repo,'--version'])).stdout.trim();
  const help=async command=>{try{return (await invoke('git',['-C',repo,...command,'-h'])).stdout;}catch(error){if(error.code!==129)throw error;return (error.stdout??'')+(error.stderr??'');}};
  const [worktree,fetch]=await Promise.all([help(['worktree','add']),help(['fetch'])]);
  if(!worktree.includes('--reason')||!worktree.includes('--lock')||!(/--(?:\[no-\])?write-fetch-head/).test(fetch)||!fetch.includes('auto-maintenance'))fail('GIT_UNSUPPORTED','Git must support worktree lock/reason and bounded fetch without FETCH_HEAD or auto-maintenance.');
  return version;
}

async function optionalGitRead(invoke,repo,args) {
  try{return (await invoke('git',['-C',repo,...args])).stdout.trim();}
  catch(error){if(error.code===1)return null;fail('FETCH_PREFLIGHT_FAILED','The bundle configuration could not be verified before fetching objects.');}
}
export async function observeBase({git,invoke,repo,mainBranch,lastSucceededAt=null,reviewCommit,baseSource='local',fetchTimeoutMs=30000,runFetch=runGitGroup}) {
  const localRef=`refs/heads/${mainBranch}`,remoteRef=`refs/remotes/origin/${mainBranch}`;
  const readSha=async ref=>{try{const sha=await git(repo,['rev-parse','--verify',`${ref}^{commit}`]);return fullSha(sha)?sha:null;}catch{return null;}};
  let localSha=await readSha(localRef);
  if(!localSha)fail('BASE_UNAVAILABLE','The configured main branch has no usable local commit.');
  const attemptedAt=new Date().toISOString(),shallow=(await git(repo,['rev-parse','--is-shallow-repository']))!=='false';
  const remotes=(await git(repo,['remote'])).split('\n');
  let fetch={status:'missing',attemptedAt,lastSucceededAt},verified=false,observedRemoteSha=null;
  if(remotes.includes('origin')) {
    if(await optionalGitRead(invoke,repo,['config','--get-all','fetch.bundleURI'])!==null)fail('FETCH_BUNDLE_UNSUPPORTED','Bundle fetching is configured and can write additional references/configuration. No fetch was started.');
    const result=await runFetch(repo,[],{timeoutMs:fetchTimeoutMs,fetchSpec:{sourceRef:localRef,gitOptions:safeGitOptions}});
    if(!result.terminated)fail('FETCH_TERMINATION_UNCONFIRMED','The fetch owner could not confirm group termination. Inspect it before planning another workspace; no numeric group signal was sent by the parent.');
    verified=result.ok&&fullSha(result.remoteSha);
    observedRemoteSha=result.remoteSha;
    fetch={status:verified?'succeeded':'failed',attemptedAt,lastSucceededAt:verified?new Date().toISOString():lastSucceededAt,observedAt:result.observedAt??null,...(!verified?{reason:result.timedOut?'timeout':'fetch-failed'}:{})};
  }
  localSha=await readSha(localRef);
  if(!localSha)fail('BASE_UNAVAILABLE','The local main branch changed or disappeared during observation.');
  const remoteSha=verified?observedRemoteSha:null;
  let ahead=null,behind=null,relation='unknown';
  if(verified&&remoteSha&&!shallow) {
    try {
      const counts=(await git(repo,['--no-lazy-fetch','rev-list','--left-right','--count',`${localSha}...${remoteSha}`])).split(/\s+/).map(Number);
      if(counts.length!==2||counts.some(n=>!Number.isSafeInteger(n)||n<0))throw new Error('Invalid Git counts');
      [ahead,behind]=counts;relation=ahead&&behind?'diverged':ahead?'ahead':behind?'behind':'equal';
    }catch{verified=false;}
  }else verified=false;
  if(reviewCommit!==undefined) {
    if(!fullSha(reviewCommit))fail('INVALID_ARGUMENT','Review preparation requires a complete commit SHA.');
    try{await git(repo,['--no-lazy-fetch','cat-file','-e',`${reviewCommit}^{commit}`]);}catch{fail('REVIEW_COMMIT_UNAVAILABLE','The examined review commit is unavailable in this Git repository.');}
  }
  if(baseSource==='origin'&&(!verified||relation!=='behind'))fail('REMOTE_BASE_UNAVAILABLE','The origin base is offered only when a fresh verified fetch shows the local branch behind.');
  const options=reviewCommit?[{source:'review',sha:reviewCommit}]:[{source:'local',ref:localRef,sha:localSha},...(verified&&relation==='behind'?[{source:'origin',remote:'origin',ref:localRef,sha:remoteSha}]:[])];
  const chosenSha=chosenBaseSha({localSha,remoteSha,baseSource,reviewCommit});
  fetch.writes=fetch.status==='missing'?[]:['objects','temporary-locks'];
  fetch.observedAt??=null;fetch.observedSha=remoteSha;fetch.trackingRefUpdated=false;
  fetch.notice=fetch.status==='succeeded'?'Les objets du SHA distant observé ont été téléchargés. Le suivi local reste inchangé.':'Le SHA distant n’a pas pu être vérifié. Le suivi local reste inchangé.';
  const verification={status:verified?'verified':'unverified',reason:verified?null:fetch.status!=='succeeded'?'fetch-unavailable':shallow?'shallow-repository':'relation-unavailable'};
  if(fetch.status==='succeeded'&&!verified)fetch.notice+=shallow?' La relation avec le distant reste non vérifiée : historique local tronqué.':' La relation avec le distant reste non vérifiée : comparaison indisponible.';
  return {mainBranch,localRef,remote:'origin',remoteRef,localSha,remoteSha,chosenSha,source:reviewCommit?'review':baseSource,options,relation,ahead,behind,verified,shallow,verification,fetch};
}
