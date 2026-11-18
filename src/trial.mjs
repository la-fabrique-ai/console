import { appendFileSync, existsSync, readFileSync, realpathSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { homedir, userInfo } from 'node:os';
import { fail } from './common.mjs';
import { checkConfined } from './trial-validator.mjs';

// The trial mode (M17): Mission Control run on a state folder made for a trial, never on the real one.
//
// Signal, both required: the variable FABRIQUE_CONSOLE_MC_TRIAL=1, and the file trial.json in the state folder (FABRIQUE_CONSOLE_HOME).
// The variable without the file, the file without the variable, or the variable on the real folder
// (~/.config/fabrique-console, or a folder inside it) are refused before anything runs. Neither: real mode,
// where nothing of this module acts.
//
// trial.json: {version:1, folder? (the folder of the trial, else the state folder: everything below lives in it),
// agents:{claude?,codex?} (absolute paths, never a real agent), worktreesRoot (absolute, never under
// ~/Developer/worktrees), hcSession (the herdr-core session of the trial), herdrAppHome (its Herdr home), hc?,
// herdrApp? (absolute paths of the programs, else the installed ones), tracker? (a file of the folder, else
// tracker.json), agentFolder? (the folder of the general assistants, else worktreesRoot)}.
//
// A trial runs only in the sandbox of the trial launcher (scripts/trial.mjs, docs/essais.md), which confines the CLI,
// a herdr-core of its own and everything they start; what stays here gives clear messages and the simulated parts:
// the cross refusals above, the agents named by path, the journal (trial-journal.jsonl in the state folder: each
// launch, each read and write of the tracker, each refusal) and the tracker of the trial.
export const TRIAL_ENV='FABRIQUE_CONSOLE_MC_TRIAL',TRIAL_FILE='trial.json',TRIAL_JOURNAL='trial-journal.jsonl';
const AGENTS=['claude','codex'];
// A path as the system resolves it: the longest part that exists through its links, then the rest. A path that does
// not exist yet under a linked folder is where the link leads, not where its letters say.
export function resolvedPath(path) {
  let at=resolve(path);const rest=[];
  for(;;) {
    try{return join(realpathSync(at),...rest);}
    catch{const parent=dirname(at);if(parent===at)return resolve(path);rest.unshift(basename(at));at=parent;}
  }
}
const inside=(path,base)=>path===base||path.startsWith(base.endsWith(sep)?base:base+sep);
const insideAny=(path,bases)=>bases.some(base=>inside(resolve(path),resolve(base))||inside(resolvedPath(path),resolvedPath(base)));
export const realStateRoot=(home=homedir())=>join(home,'.config','fabrique-console');
// The homes a trial is checked against: the one given, and the one of the account, whatever HOME says.
const homesOf=home=>[...new Set([resolve(home),resolve(userInfo().homedir)])];

// A line of the journal of the trial: what was called, never a prompt, a body or a secret. Best effort.
export function journal(trial,entry) {
  try{appendFileSync(join(trial.root,TRIAL_JOURNAL),JSON.stringify({at:new Date().toISOString(),pid:process.pid,...entry})+'\n',{mode:0o600});}catch{}
}
// A refusal of the trial: written in the journal, said on stderr, thrown. Loud on purpose.
export function forbid(trial,message,entry) {
  journal(trial,{...entry,refused:true});
  try{process.stderr.write('FABRIQUE_CONSOLE trial: refused. '+message+'\n');}catch{}
  fail('TRIAL_FORBIDDEN',message);
}

// Where the real agents are: the installed folders and every folder of the PATH (a login shell puts ~/.local/bin
// first), with the files their links lead to.
export function realAgents(env,homes) {
  const dirs=[...homes.map(home=>join(home,'.local','bin')),...String(env.PATH??'').split(':').filter(Boolean),'/opt/homebrew/bin','/usr/local/bin',dirname(process.execPath),dirname(resolvedPath(process.execPath))];
  const found=new Set();
  for(const dir of dirs)for(const name of AGENTS){const path=join(dir,name);if(existsSync(path)){found.add(resolve(path));found.add(resolvedPath(path));}}
  return found;
}
// An absolute path a trial may name: no "..", nothing the sandbox profile could not quote.
const absolute=(value,name)=>{
  if(typeof value!=='string'||!isAbsolute(value)||/[\0"\\\n\r]/.test(value)||value.split('/').includes('..'))fail('TRIAL_INVALID',`${TRIAL_FILE}: ${name} must be an absolute path.`);
  return resolve(value);
};

// The trial of this state folder, or null in real mode. Refuses every mix of the two.
export function trialOf({root,env=process.env,home=homedir()}) {
  root=resolve(root);
  // Inside a trial HOME is the trial's own (state/home): never a home to protect from it.
  const asked=env[TRIAL_ENV],marker=join(root,TRIAL_FILE),marked=existsSync(marker);let homes=homesOf(home).filter(h=>h!==join(root,'home'));
  if(asked===undefined||asked==='') {
    if(marked)fail('TRIAL_MODE_REQUIRED',`This state folder is a trial folder (${TRIAL_FILE}). Run it with ${TRIAL_ENV}=1, or use the real folder.`);
    return null;
  }
  if(asked!=='1')fail('TRIAL_INVALID',`${TRIAL_ENV} must be 1.`);
  if(insideAny(root,homes.map(h=>realStateRoot(h))))fail('TRIAL_REAL_ROOT','A trial never runs on the real state folder of Mission Control. Set FABRIQUE_CONSOLE_HOME to a trial folder.');
  if(!marked)fail('TRIAL_NOT_MARKED',`A trial runs only on a folder marked by ${TRIAL_FILE}.`);
  let raw;
  try{raw=JSON.parse(readFileSync(marker,'utf8'));}catch{fail('TRIAL_INVALID',`${TRIAL_FILE} is not readable JSON.`);}
  if(!raw||typeof raw!=='object'||Array.isArray(raw)||raw.version!==1)fail('TRIAL_INVALID',`${TRIAL_FILE} must be an object of version 1.`);
  const known=['version','folder','agents','worktreesRoot','hcSession','herdrAppHome','hc','herdrApp','tracker','agentFolder'];
  if(Object.keys(raw).some(key=>!known.includes(key)))fail('TRIAL_INVALID',`${TRIAL_FILE} has an unknown field.`);
  // The folder of the trial: what it may write. Never a home, nor a folder of the real state of this Mac.
  const folder=raw.folder===undefined?root:absolute(raw.folder,'folder');
  // The HOME of a trial (in its folder, set by the launcher) is its own, never a home to protect from it.
  homes=homes.filter(h=>!inside(resolvedPath(h),resolvedPath(folder)));
  if(/[\0"\\\n\r]/.test(folder))fail('TRIAL_INVALID',`${TRIAL_FILE}: folder must be an absolute path.`);
  const sensitive=homes.flatMap(h=>[join(h,'.config'),join(h,'Library'),join(h,'.local'),join(h,'.ssh'),join(h,'Developer','worktrees'),join(h,'Developer','mockups')]);
  if(homes.some(h=>inside(resolvedPath(h),resolvedPath(folder))||inside(resolve(h),resolve(folder)))||insideAny(folder,sensitive))fail('TRIAL_INVALID',`${TRIAL_FILE}: folder must be a folder of its own, outside ~/.config, ~/Library, ~/.local, ~/Developer/worktrees, and never a home or above one.`);
  const within=(path,name)=>{if(!inside(resolvedPath(path),resolvedPath(folder)))fail('TRIAL_INVALID',`${TRIAL_FILE}: ${name} must be inside the folder of the trial.`);return path;};
  within(root,'the state folder');
  const agentsIn=raw.agents??{};
  if(!agentsIn||typeof agentsIn!=='object'||Array.isArray(agentsIn)||Object.keys(agentsIn).some(key=>!AGENTS.includes(key)))fail('TRIAL_INVALID',`${TRIAL_FILE}: agents names claude and codex only.`);
  // A program of the folder of the trial is the trial's own: the real agents are looked for everywhere else.
  const reals=new Set([...realAgents(env,homes)].filter(path=>!inside(resolvedPath(path),resolvedPath(folder)))),agents={};
  for(const [name,value] of Object.entries(agentsIn)) {
    const path=absolute(value,'agents.'+name);
    let info;try{info=statSync(path);}catch{fail('TRIAL_INVALID',`${TRIAL_FILE}: agents.${name} does not exist.`);}
    if(!info.isFile()||!(info.mode&0o111))fail('TRIAL_INVALID',`${TRIAL_FILE}: agents.${name} must be an executable file.`);
    if(reals.has(resolvedPath(path)))fail('TRIAL_REAL_AGENT',`${TRIAL_FILE}: agents.${name} is a real agent. A trial names fake agents only.`);
    agents[name]=path;
  }
  const worktreesRoot=absolute(raw.worktreesRoot,'worktreesRoot');
  if(insideAny(worktreesRoot,homes.flatMap(h=>[join(h,'Developer','worktrees'),realStateRoot(h)])))fail('TRIAL_INVALID',`${TRIAL_FILE}: worktreesRoot must be outside ~/Developer/worktrees and the real state folder.`);
  within(worktreesRoot,'worktreesRoot');
  if(typeof raw.hcSession!=='string'||!/^[a-z0-9_-]{1,32}$/.test(raw.hcSession))fail('TRIAL_INVALID',`${TRIAL_FILE}: hcSession must name the herdr-core session of the trial (1-32 of a-z 0-9 - _).`);
  const herdrAppHome=absolute(raw.herdrAppHome,'herdrAppHome');
  if(insideAny(herdrAppHome,homes.flatMap(h=>['herdr-app','herdr','herdr-web-ui'].map(name=>join(h,'.config',name)))))fail('TRIAL_INVALID',`${TRIAL_FILE}: herdrAppHome must be a Herdr home of the trial, not the one in service.`);
  within(herdrAppHome,'herdrAppHome');
  const tracker=raw.tracker??'tracker.json';
  if(typeof tracker!=='string'||!/^[A-Za-z0-9._-]{1,64}\.json$/.test(tracker)||tracker.startsWith('.'))fail('TRIAL_INVALID',`${TRIAL_FILE}: tracker names a JSON file of the trial folder.`);
  const agentFolder=raw.agentFolder===undefined?worktreesRoot:within(absolute(raw.agentFolder,'agentFolder'),'agentFolder');
  // The installed programs, by the home of the account: inside a trial HOME is the trial's.
  const account=resolve(userInfo().homedir);
  return {root,folder,home:join(root,'home'),realHome:homes[0],agents,worktreesRoot,hcSession:raw.hcSession,herdrAppHome,
    hc:raw.hc===undefined?join(account,'.local','bin','hc'):absolute(raw.hc,'hc'),herdrApp:raw.herdrApp===undefined?join(account,'.local','bin','herdr-app'):absolute(raw.herdrApp,'herdrApp'),
    tracker:join(root,tracker),agentFolder,realAgents:[...reals]};
}

// ---- In a trial: the sandbox checked, the agents named by their paths, each launch journaled.

// A trial runs only in the sandbox of the trial launcher (scripts/trial.mjs). The engine and the CLI check it at
// start with the whole common validator, never by a variable: every refusal the launcher announces, in this very
// process (the real home is the one of the account, whatever HOME says). Otherwise TRIAL_NOT_CONFINED, before any
// action. A sandbox cannot be lifted: once proved, it stays proved for the life of the process.
let proved=null;
export function assertConfined(trial,check=checkConfined) {
  if(proved===trial.folder)return;
  const {confined,reasons}=check({realHome:userInfo().homedir,place:'engine-'+process.pid});
  if(confined){proved=trial.folder;return;}
  journal(trial,{kind:'not-confined',reasons});
  fail('TRIAL_NOT_CONFINED','A trial runs only in the sandbox of the trial launcher: node scripts/trial.mjs <folder> -- <command>. Nothing was read or started.');
}

// The programs of a trial, for the backend: claude and codex become the agents the trial names by absolute path,
// asked directly, in a terminal (hc run -- <agent>) or in a tab (herdr-app do … {argv}); an agent the trial does not
// name is refused. Each launch is a line of the journal. The sandbox, not this, keeps a real agent from starting.
export function trialExec(exec,trial) {
  const agents=trial.agents||{};
  const named=(program,via)=>{
    if(!AGENTS.includes(program))return null;
    if(!agents[program])forbid(trial,`The trial names no ${program}; a real ${program} never starts in a trial.`,{kind:'agent',program,via});
    return agents[program];
  };
  return async(file,args=[],options={})=>{
    let program=String(file),agent=named(program,'exec');const argv=[...args];
    if(agent)program=agent;
    if(program===trial.hc||basename(program)==='hc') {
      const at=argv.indexOf('--');
      if(argv[0]==='run'&&at>=0&&typeof argv[at+1]==='string'){const mapped=named(argv[at+1],'hc run');if(mapped){argv[at+1]=mapped;agent=mapped;}}
    }else if(program===trial.herdrApp||basename(program)==='herdr-app') {
      if(argv[0]==='do'&&typeof argv[2]==='string') {
        let payload=null;try{payload=JSON.parse(argv[2]);}catch{}
        if(Array.isArray(payload?.argv)&&typeof payload.argv[0]==='string'){const mapped=named(payload.argv[0],'herdr-app '+argv[1]);if(mapped){payload.argv[0]=mapped;agent=mapped;argv[2]=JSON.stringify(payload);}}
      }
    }
    journal(trial,{kind:'exec',program,command:typeof argv[0]==='string'&&!argv[0].includes('\n')?argv[0].slice(0,40):null,...(argv[0]==='do'?{action:String(argv[1]??'')}:{}),...(agent?{agent}:{})});
    return exec(program,argv,options);
  };
}

// The tracker of a trial: a JSON file of its folder {viewer, teams, projects, states, issues}, the issues as the real
// client gives them. Reads and writes are journaled; a write changes the file, nothing else.
export class TrialTracker {
  constructor(trial){this.trial=trial;}
  load(call) {
    journal(this.trial,{kind:'tracker',call});
    try{return JSON.parse(readFileSync(this.trial.tracker,'utf8'));}catch{fail('TRIAL_TRACKER','The tracker file of the trial is missing or unreadable.');}
  }
  save(data,entry) {
    const temp=this.trial.tracker+'.'+process.pid+'.tmp';
    writeFileSync(temp,JSON.stringify(data,null,2)+'\n',{mode:0o600});renameSync(temp,this.trial.tracker);
    journal(this.trial,{kind:'ticket-write',...entry});
  }
  find(data,id){const issue=(data.issues||[]).find(i=>i.id===id||i.identifier===id);if(!issue)fail('NOT_FOUND','The Tracker issue was not found.');return issue;}
  async configured(){this.load('configured');return true;}
  async list({teamId,projectId,stateId,search}={}) {
    const data=this.load('list'),needle=typeof search==='string'?search.toLowerCase():null;
    const issues=(data.issues||[]).filter(i=>(!teamId||i.team?.id===teamId)&&(!projectId||i.project?.id===projectId)&&(!stateId||i.state?.id===stateId)
      &&(!needle||[i.title,i.description,i.identifier].some(v=>String(v??'').toLowerCase().includes(needle))));
    return {issues:structuredClone(issues),relations:'full',cached:false,updatedAt:new Date().toISOString()};
  }
  async backlog({teamId}={}) {
    const data=this.load('backlog');
    return {issues:structuredClone((data.issues||[]).filter(i=>i.team?.id===teamId&&!i.project&&i.state?.type==='backlog')),relations:'full',cached:false,updatedAt:new Date().toISOString()};
  }
  async forgetBacklog(){}
  async detail(id){const data=this.load('detail');return {issue:structuredClone(this.find(data,id)),relations:'full'};}
  async meta(){const data=this.load('meta');return {viewer:data.viewer??null,teams:data.teams??[],projects:data.projects??[],states:data.states??[]};}
  async create({teamId,title,stateId=null,id=null}) {
    const data=this.load('create'),issues=data.issues||(data.issues=[]);
    const team=(data.teams||[]).find(t=>t.id===teamId),number=issues.length+1,state=(data.states||[]).find(s=>s.id===stateId)||null;
    if(!team)fail('NOT_FOUND','The team is not in the tracker of the trial.');
    const issue={id:id||'trial-'+number,identifier:team.key+'-'+(100+number),title,description:'',team:{id:teamId},state,labels:[],comments:[],createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
    issues.push(issue);this.save(data,{call:'create',issue:issue.identifier});
    return {success:true,issue:structuredClone(issue)};
  }
  async mutate({issueId,stateId,comment}) {
    const data=this.load('mutate'),issue=this.find(data,issueId),results={};
    if(stateId){const state=(data.states||[]).find(s=>s.id===stateId);if(!state)fail('INVALID_STATE','Unknown state in the tracker of the trial.');issue.state={id:state.id,name:state.name,type:state.type};results.state={issueUpdate:{success:true,issue:{id:issue.id,identifier:issue.identifier,state:issue.state}}};}
    if(comment){(issue.comments||(issue.comments=[])).push({id:'c-'+Date.now(),body:comment,createdAt:new Date().toISOString(),user:data.viewer??null});results.comment={commentCreate:{success:true}};}
    issue.updatedAt=new Date().toISOString();
    this.save(data,{call:'mutate',issue:issue.identifier,...(stateId?{state:stateId}:{}),...(comment?{comment:true}:{})});
    return results;
  }
}
