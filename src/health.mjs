// The health of a project: for now, the CI of its GitHub repositories, read with the gh
// command of this machine. Nothing of a remote address is kept but the owner and the name.
import {exec,commandOptions} from './common.mjs';
import {projectFolder,projectRepos,mainBranch} from './project-sheet.mjs';

const PART=/^[A-Za-z0-9_.-]{1,100}$/,FAILED=['failure','timed_out','startup_failure','action_required'];
const defaultRun=(command,args,options={})=>exec(command,args,{...commandOptions,...options});

export function githubSlug(url) {
  const match=String(url??'').trim().match(/github\.com[:/]([^/\s:]+)\/([^/\s]+?)(?:\.git)?$/);
  return match&&PART.test(match[1])&&PART.test(match[2])?match[1]+'/'+match[2]:null;
}
const BRANCH=/^[A-Za-z0-9._/][A-Za-z0-9._/-]{0,99}$/,MAX_WORKFLOWS=20;
// An action has thirty seconds: GitHub is asked a few requests at a time, each with its own limit,
// and nothing more is asked once the overall budget is spent. What was not read is unread.
const CONCURRENCY=6,CALL_TIMEOUT=8000,BUDGET=22000;
function pool(size) {
  let active=0;const waiting=[];
  const next=()=>{if(active<size&&waiting.length) {active+=1;waiting.shift()();}};
  return async task=>{await new Promise(resolve=>{waiting.push(resolve);next();});try {return await task();}finally {active-=1;next();}};
}
// Each workflow is judged on its own last run on the main branch (null when it never ran there).
// Green means every one of those runs succeeded: a cancelled or skipped run settles nothing.
// A workflow that never ran on the main branch (one that only runs on pull requests, for instance)
// is not counted for or against: it is listed apart, so that the screen can name it.
export function ciState(workflows) {
  const failing=[],running=[],unsettled=[],unrun=[],name=value=>String(value).replace(/[\u0000-\u001f]/g,'').slice(0,80);
  let last=null,failed=null,seen=0;
  for(const {name:workflow,run} of Array.isArray(workflows)?workflows:[]) {
    if(!run||typeof run!=='object') {unrun.push(name(workflow));continue;}
    seen+=1;
    const at=Date.parse(run.updatedAt),known=Number.isFinite(at);
    if(run.status!=='completed') running.push(name(workflow));
    else if(FAILED.includes(run.conclusion)) {failing.push(name(workflow));if(known&&(failed===null||at>failed)) failed=at;}
    else if(run.conclusion!=='success') unsettled.push(name(workflow));
    if(known&&(last===null||at>last)) last=at;
  }
  if(!seen) return {state:'none',failing:[],running:[],unsettled:[],unrun,at:null};
  // For a red CI the date is the one of the failure; otherwise the one of the last run.
  const at=failing.length?failed:last;
  return {state:failing.length?'red':running.length?'running':unsettled.length?'unsettled':'green',failing,running,unsettled,unrun,at:at===null?null:new Date(at).toISOString()};
}

const unread=(name,slug=null)=>({name,slug,state:'unavailable',failing:[],running:[],unsettled:[],unrun:[],at:null});
async function repositoryCi({dir,name},run,ask) {
  const main=await mainBranch(dir,run);
  if(!main.readable) return unread(name);
  // A repository without a remote has no CI to read: it is not listed.
  if(!main.remote) return null;
  let slug;
  try {slug=githubSlug((await run('git',['--no-optional-locks','-C',dir,'remote','get-url',main.remote])).stdout);}catch {return unread(name);}
  if(!slug) return null;
  try {
    // gh prints nothing at all for an empty list.
    const gh=args=>ask(async()=>{const out=String((await run('gh',args,{cwd:dir})).stdout??'').trim();return out?JSON.parse(out):[];});
    // The branch is the one the remote names as default; failing that, GitHub is asked.
    const branch=main.branch??(await gh(['repo','view',slug,'--json','defaultBranchRef'])).defaultBranchRef?.name;
    if(typeof branch!=='string'||!BRANCH.test(branch)) throw new Error('no branch');
    const active=(await gh(['workflow','list','-R',slug,'--limit',String(MAX_WORKFLOWS+1),'--json','id,name,state'])).filter(w=>w?.state==='active'&&Number.isInteger(w.id)&&typeof w.name==='string');
    // More workflows than are read: nothing can be said about the whole.
    if(active.length>MAX_WORKFLOWS) throw new Error('too many workflows');
    const workflows=await Promise.all(active.map(async w=>({name:w.name,run:(await gh(['run','list','-R',slug,'--workflow',String(w.id),'--branch',branch,'--limit','1','--json','status,conclusion,updatedAt']))[0]??null})));
    return {name,slug,...ciState(workflows)};
  }catch {return unread(name,slug);}
}

export async function readHealth({repo,run=defaultRun,now=Date.now(),budgetMs=BUDGET}={}) {
  // The deadline is set before anything is read and covers every command, Git included: each one
  // gets at most the time that is left, and none starts once it is spent.
  const deadline=Date.now()+budgetMs,limit=pool(CONCURRENCY);
  const bounded=(command,args,options={})=>{
    const left=deadline-Date.now();
    if(left<=0) throw new Error('budget spent');
    return run(command,args,{...options,timeout:Math.min(CALL_TIMEOUT,left)});
  };
  const root=await projectFolder(repo),report={failed:false},found=await projectRepos(root,report);
  const items=(await Promise.all(found.map(repository=>repositoryCi(repository,bounded,limit)))).filter(Boolean);
  // A folder that could not be read, or repositories left out, makes the list of repositories partial.
  return {checkedAt:new Date(now).toISOString(),ci:{state:report.failed||found.truncated?'partial':'read',items}};
}
