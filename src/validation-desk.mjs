import {ticketOf} from '../integrations/tickets/contract.mjs';
import { join, basename, dirname } from 'node:path';
import { mkdir, readFile, readdir, realpath, stat } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { fail, object, patientLock } from './common.mjs';
import { labels, parsed, terminalId } from './terminals.mjs';
import { poSpace } from './po-launch.mjs';
import { serverOfPlan } from '../ui/v3/view.js';

// What the user needs to validate a development: where its code stands (branch, pull request) and a test server he starts
// and stops himself. The command comes from the plan, which Tracker holds: only one form is run, a named script of the
// package of a folder of the worktree (`pnpm run dev`), never an option, a sub-command or a shell. Corepack may come
// first (`corepack pnpm dev`): the same script, run by the version of pnpm or Yarn the package pins.
const MANAGERS=['pnpm','npm','yarn','bun'],PINNED=['pnpm','yarn'],SCRIPT=/^[A-Za-z0-9_][\w:.-]*$/,FOLDER=/^[\w.-]+$/;
export function safeServer(plan) {
  const all=plan?.argv||[],via=all[0]==='corepack'&&PINNED.includes(all[1])?['corepack']:[],words=all.slice(via.length),named=words[1]==='run'?words.slice(2):words.slice(1);
  if(!MANAGERS.includes(words[0])||named.length!==1||!SCRIPT.test(named[0]))return null;
  if(plan.dir&&(!FOLDER.test(plan.dir)||/^\.+$/.test(plan.dir)))return null;
  return {...plan,argv:[...via,words[0],'run',named[0]]};
}
// What a safe server runs: its manager (corepack first when it is), then `run` and its script.
const managerOf=plan=>plan.argv.slice(0,-2),scriptOf=plan=>plan.argv.at(-1);

// Free when nothing listens on it, on any address: lsof sees them all, and answers 1 when it finds none.
export const portFree=({invoke})=>port=>invoke('lsof',['-nP','-iTCP:'+port,'-sTCP:LISTEN'],{timeout:10000}).then(()=>false,error=>error.code===1);
// What a test can start, and the label that finds its terminal again.
const TARGET_LABEL={server:'fabrique-console.server',app:'fabrique-console.apptest'};
// The app of a development, or of one of its tickets, run from that ticket's own worktree.
const appKey=(mission,ticket)=>mission.id+(ticket?'.'+ticket:''),ticketForm=/^[A-Z][A-Z0-9]{0,9}-\d{1,7}$/;
const portTries=50,localAddress=/https?:\/\/(?:localhost|127\.0\.0\.1):(\d{2,5})/;

// Whether the hub of the emulators answers.
const hubAnswers=url=>fetch(url,{signal:AbortSignal.timeout(2000)}).then(r=>r.ok,()=>false);
// The server waits for the hub of its emulators, then becomes its own command; the hub and the command are arguments.
const GAVE_UP='Error: the emulators did not start. See their terminal.';
const waitHub='n=0; until curl -fsS "$1" >/dev/null 2>&1; do n=$((n+1)); if [ "$n" -ge 120 ]; then echo "'+GAVE_UP+'" >&2; exit 1; fi; sleep 2; done; shift; exec "$@"';
// The Node of the project, never the first one of the PATH, where another tool may have put a newer one: mise runs the
// command with the version the project names, else the one mise is set to. Without mise, a version named must be the
// one of the PATH; with none named, nothing can vouch for the PATH, so nothing starts, and it says why.
export const NODE_RUN='v=$1; shift; if command -v mise >/dev/null 2>&1; then if [ -n "$v" ]; then exec mise exec "node@$v" -- "$@"; fi; exec mise exec -- "$@"; fi; if [ -n "$v" ]; then n=$(node -v 2>/dev/null); case "$n" in "v$v"|"v$v".*) ;; *) echo "Error: this project needs Node $v, and mise is not installed to run it (node: ${n:-none})." >&2; exit 1;; esac; exec "$@"; fi; echo "Error: mise is not installed, and this project names no Node version: its Node cannot be chosen." >&2; exit 1';
const withNode=(version,command)=>['sh','-c',NODE_RUN,'fabrique-console-node',version,...command];
// The variables of a test server are set last, after mise: an [env] of a project's mise configuration cannot give it the
// Google folder of the user back, nor a file of credentials.
const isolated=(version,home,command,more=[])=>withNode(version,['env','-u','GOOGLE_APPLICATION_CREDENTIALS',...more,'CLOUDSDK_CONFIG='+home,...command]);
const versionForm=/^v?(\d{1,2}(?:\.\d{1,3}){0,2})$/;
// The version a project names: its .nvmrc or .node-version, else the major of its engines, from the folder of the
// server up to its worktree. A bare lower bound (">=22") names no version: the search goes on, else mise keeps its own.
export async function nodeOf(...folders) {
  for(const folder of folders) {
    for(const file of ['.nvmrc','.node-version']) {
      const named=versionForm.exec((await readFile(join(folder,file),'utf8').catch(()=>'')).trim())?.[1];
      if(named)return named;
    }
    const engines=await readFile(join(folder,'package.json'),'utf8').then(raw=>{try{return JSON.parse(raw)?.engines?.node;}catch{return null;}},()=>null);
    if(typeof engines!=='string')continue;
    if(/^\s*>=?\s*v?\d+(?:\.[\dx*]+)*\s*$/.test(engines))continue;
    const major=/(\d{1,2})/.exec(engines)?.[1];
    if(major)return major;
  }
  return '';
}
// Whether a page of this Mac answers at all: any HTTP answer, even an error page, is a server that runs. A local HTTPS
// server has its own certificate: nothing is sent nor read, so it is not checked.
const pageAnswers=url=>new Promise(done=>{
  const ask=(url.startsWith('https:')?httpsRequest:httpRequest)(url,{method:'GET',timeout:5000,rejectUnauthorized:false},res=>{res.destroy();done(true);});
  ask.on('timeout',()=>{ask.destroy();done(false);});ask.on('error',()=>done(false));ask.end();
});
// The address of the application among what a terminal said: the last localhost it names, never one of the tools it
// starts beside (an emulator named just before it, a row of the emulators' table), with the protocol and host it says.
export function appAddress(said) {
  let found=null;
  for(const line of String(said||'').split('\n')) {
    if(line.includes('│'))continue;
    let from=0;
    for(const m of line.matchAll(/(https?):\/\/(localhost|127\.0\.0\.1):(\d{2,5})(?![\d])/g)) {
      const before=line.slice(from,m.index);from=m.index+m[0].length;
      if(!/emulat/i.test(before))found=m[1]+'://'+m[2]+':'+m[3];
    }
  }
  return found;
}
const hubForm=/^http:\/\/127\.0\.0\.1:\d{2,5}\/emulators$/;
export function createValidationDesk({root,invoke,herdr,registry,getTickets,loadConfig=null,isFree=portFree({invoke}),probe=hubAnswers,answers=pageAnswers,wait=ms=>new Promise(done=>setTimeout(done,ms))}) {
  const git=async(path,args)=>(await invoke('git',['-C',path,...args],{timeout:15000})).stdout.trim();
  const only=(input,names)=>{if(Object.keys(input).some(key=>!names.includes(key)))fail('INVALID_ARGUMENT','Unexpected argument.');};
  // The folder of the project on this Mac, which a plan may name whole; unreadable, unknown.
  async function repoOf(mission) {
    if(!loadConfig)return null;
    try{const repo=((await loadConfig())?.projects||[]).find(p=>p?.key===mission.project)?.repo;return typeof repo==='string'?repo:null;}catch{return null;}
  }
  async function planOf(mission) {
    if(!mission.issue?.id)return null;
    try{return safeServer(serverOfPlan(ticketOf(await (await getTickets()).detail(mission.issue.id))?.description,{repo:await repoOf(mission),worktree:mission.worktree}));}catch{return null;}
  }
  // The worktree and the repositories inside it.
  async function folders(worktree) {
    const nested=await readdir(worktree,{withFileTypes:true}).catch(()=>[]);
    const found=[worktree];
    for(const entry of nested)if(entry.isDirectory()&&!entry.name.startsWith('.')&&await stat(join(worktree,entry.name,'.git')).then(()=>true,()=>false))found.push(join(worktree,entry.name));
    return found;
  }
  // What is known of its pull request. GitHub unreadable stays unknown: it is never "no pull request".
  async function pullRequest(path,branch) {
    try{
      const list=JSON.parse((await invoke('gh',['pr','list','--head',branch,'--state','all','--limit','1','--json','number,url,state,isDraft'],{cwd:path,timeout:20000})).stdout||'[]');
      const pr=list[0]||null;
      return {known:true,pr:pr&&{number:pr.number,url:pr.url,state:pr.state,draft:Boolean(pr.isDraft)}};
    }catch{return {known:false,pr:null};}
  }
  // A repository counts when it is on the branch of the issue and holds commits of its own.
  async function repositoryOf(path,branch,worktree) {
    if(await git(path,['rev-parse','--abbrev-ref','HEAD']).catch(()=>null)!==branch)return null;
    const base=await git(path,['symbolic-ref','--short','refs/remotes/origin/HEAD']).catch(()=>null),ahead=base?Number(await git(path,['rev-list','--count',base+'..HEAD']).catch(()=>NaN)):NaN;
    if(ahead===0)return null;
    const pushed=await git(path,['rev-parse','--verify','--quiet','refs/remotes/origin/'+branch]).then(()=>true,()=>false);
    return {repo:path===worktree?basename(worktree):basename(path),branch,ahead:Number.isNaN(ahead)?null:ahead,pushed,...await pullRequest(path,branch)};
  }
  async function delivery(raw) {
    const input=object(raw);only(input,['mission']);
    const mission=await registry.read(input.mission),plan=await serverPlanOf(mission);
    if(!mission.worktree||!mission.branch)return {repositories:[],server:plan,app:null,flutter:false};
    const rows=await Promise.all((await folders(mission.worktree)).map(path=>repositoryOf(path,mission.branch,mission.worktree))),repositories=rows.filter(Boolean);
    // Whether its tickets have an app to run, whatever has been merged yet.
    return {repositories,...await targets(mission.worktree,repositories,plan),flutter:Boolean(await flutterFolderOf(mission.worktree))};
  }
  // A mobile application, not a package that only uses Flutter.
  const isFlutter=path=>readFile(join(path,'pubspec.yaml'),'utf8').then(text=>/^\s+sdk:\s*flutter\s*$/m.test(text),()=>false).then(flutter=>flutter&&stat(join(path,'lib','main.dart')).then(()=>true,()=>false));
  // The Flutter app of a worktree: the worktree itself, or one of its folders.
  async function flutterFolderOf(root) {
    const entries=await readdir(root,{withFileTypes:true}).catch(()=>[]);
    for(const path of [root,...entries.filter(e=>e.isDirectory()&&!e.name.startsWith('.')).map(e=>join(root,e.name)).sort()])if(await isFlutter(path))return path;
    return null;
  }
  // What has to be started to test a development, from the repositories it changed: the server of the plan, the Flutter app, or both.
  async function targets(worktree,repositories,plan) {
    const root=basename(worktree),names=repositories.map(r=>r.repo),changed=names.filter(name=>name!==root),flutter=await Promise.all(names.map(name=>isFlutter(name===root?worktree:join(worktree,name)))),app=names.find((_name,n)=>flutter[n])??null;
    // A server whose folder was not touched has nothing to show; with no repository of its own to tell, the plan decides.
    return {server:plan&&(!changed.length||!plan.dir||changed.includes(plan.dir))?plan:null,app:app===null?null:{folder:app===root?'.':app}};
  }
  // Where a server really listens: what it says itself, else the port it was given.
  async function addressOf(terminal,own) {
    const said=await herdr.read(terminal,200).then(r=>String(r.stdout||''),()=>''),found=appAddress(said);
    if(found)return found;
    const port=/^\d{2,5}$/.test(own['fabrique-console.port']||'')?own['fabrique-console.port']:null;
    // Its port, with the protocol the plan names for it.
    return port?(/^https:\/\//.test(own['fabrique-console.planned']||'')?'https':'http')+'://localhost:'+port:null;
  }
  // A listing that says nothing (not answered, lost, no list) is unknown, never an empty one.
  const listOf=async(filter,what)=>{
    try{return await herdr.list(filter);}
    catch{fail('HC_UNAVAILABLE','herdr-core is unavailable. '+what);}
  };
  const labelsOf=terminal=>herdr.get(terminal).then(r=>labels(parsed(r.stdout)),()=>({}));
  // Labels that decide what is ours: unreadable is never "not ours", which would start a second server.
  const ownedLabels=terminal=>herdr.get(terminal).then(r=>labels(parsed(r.stdout)),()=>fail('HC_UNAVAILABLE','herdr-core is unavailable. The server status cannot be verified.'));
  // The newest terminal of a list: the list does not always say when each was created, their own record does.
  async function newest(list) {
    const dated=await Promise.all(list.map(async t=>({t,at:Number.isFinite(t.created_ms)?t.created_ms:await herdr.get(terminalId(t)).then(r=>Number(parsed(r.stdout)?.created_ms)||0,()=>0)})));
    return dated.sort((a,b)=>b.at-a.at)[0]?.t||null;
  }
  // What a terminal said last, and the line that says why, not the end of a stack.
  async function told(terminal) {
    const said=await herdr.read(terminal,400).then(r=>String(r.stdout||''),()=>''),lines=said.split('\n').map(line=>line.trimEnd()).filter(Boolean);
    const reason=lines.find(line=>/^\s*(?:[\w.]*Error\b|error\b|ERR!|fatal\b)|command not found|No supported devices/i.test(line))?.trim().slice(0,300)||null;
    return {reason,lastOutput:lines.slice(-8).join('\n').slice(-1200)||null};
  }
  // Emulators a waiting server will never get: their hub silent and none of their terminals alive. Only a hub of this Mac
  // is asked.
  async function emulatorsFailed(mission,hub) {
    if(typeof hub!=='string'||!hubForm.test(hub)||await probe(hub))return null;
    const list=await listOf({all:true,label:'fabrique-console.emulators='+mission.project},'The emulators cannot be verified.');
    if(list.some(t=>t.state==='live'))return null;
    const last=await newest(list);
    if(!last)return null;
    const {reason,lastOutput}=await told(terminalId(last));
    return {reason:'The emulators did not start: '+(reason||'see their terminal.'),lastOutput};
  }
  // The ports given to the servers alive: one still starting does not listen yet, and already holds its port.
  async function portsGiven() {
    const what='The ports in use cannot be verified.',list=await listOf({label:'fabrique-console.role=server'},what);
    // A port whose record is lost may be given: unknown, never free. A terminal the core says is gone holds none.
    const given=await Promise.all(list.map(t=>herdr.record(terminalId(t)).then(r=>r?Number(labels(r)['fabrique-console.port']):NaN,()=>fail('HC_UNAVAILABLE','herdr-core is unavailable. '+what))));
    return new Set(given.filter(Number.isInteger));
  }
  // The first free port from the one the plan names, under the lock of the launches.
  async function freePort(plan) {
    const from=Number(localAddress.exec(plan.url||'')?.[1])||3000,given=await portsGiven();
    for(let port=from;port<from+portTries;port++)if(!given.has(port)&&await isFree(port))return port;
    fail('SERVER_NOT_CONFIGURED','No free port was found for this server.');
  }
  // The terminal of the server: the live one, or the last one and what it said when it stopped.
  async function status(mission,target='server',ticket=null) {
    const list=await listOf({all:true,label:TARGET_LABEL[target]+'='+(target==='app'?appKey(mission,ticket):mission.id)},'The server status cannot be verified.');
    let live=list.find(t=>t.state==='live');
    if(live&&target==='app') {
      // Where it is shown and on which iPhone: the simulator page opens on both.
      const own=await herdr.get(terminalId(live)).then(r=>labels(parsed(r.stdout)),()=>({}));
      return {running:true,terminal:terminalId(live),url:null,reason:null,lastOutput:null,device:own['fabrique-console.device']||null,space:own['herdr.space']||null,tab:own['herdr.tab']||null};
    }
    // Running only once its address answers: a terminal alive may still be waiting for its emulators, or compiling.
    // Only a server terminal of Mission Control is ours: one that only carries the label of this server is left alone.
    let own={};
    for(const candidate of list.filter(t=>t.state==='live')) {
      const seen=await ownedLabels(terminalId(candidate));
      if(seen['fabrique-console.app']==='fabrique-console'&&seen['fabrique-console.role']==='server'&&seen['fabrique-console.server']===mission.id){live=candidate;own=seen;break;}
      live=null;
    }
    if(live) {
      const id=terminalId(live),url=await addressOf(id,own),planned=own['fabrique-console.planned']||null;
      if(url&&await answers(url))return {running:true,starting:false,terminal:id,url,planned,reason:null,lastOutput:null};
      // Waiting for emulators that are gone: it never will answer, and says why.
      const failed=await emulatorsFailed(mission,own['fabrique-console.hub']||null);
      if(failed)return {running:false,starting:false,stuck:true,terminal:id,url:null,planned,...failed};
      return {running:false,starting:true,terminal:id,url:null,planned,reason:null,lastOutput:(await told(id)).lastOutput};
    }
    // The last start, not the first one: an old failure is not the news.
    const last=await newest(list);
    if(!last)return {running:false,starting:false,terminal:null,url:null,reason:null,lastOutput:null};
    // A server that gave up waiting for its emulators: their reason, not its own. One that failed by itself keeps its own.
    const said=await told(terminalId(last)),gaveUp=!said.reason||said.reason===GAVE_UP;
    const failed=gaveUp?await emulatorsFailed(mission,(await labelsOf(terminalId(last)))['fabrique-console.hub']):null;
    return {running:false,starting:false,terminal:terminalId(last),url:null,...said,...(failed||{})};
  }
  // A plan that names no server: the development script of the project, at the root of its worktree (./dev.sh), as
  // its own tests tell the user to run it. It is a file of the repository, never a line of Tracker.
  async function devScript(worktree) {
    // The file itself: a link, wherever it leads, is not the script of the repository.
    const home=await realpath(worktree).catch(()=>null),file=home?await realpath(join(home,'dev.sh')).catch(()=>null):null;
    if(!file||file!==join(home,'dev.sh'))return false;
    const info=await stat(file).catch(()=>null);
    return Boolean(info?.isFile()&&(info.mode&0o111));
  }
  // A Google folder with nothing in it: a test server never sees the credentials of the user, which stay where they are,
  // as the strict mode of the projects asks.
  async function emptyGcloud() {
    const home=join(root,'state','gcloud-empty');
    await mkdir(home,{recursive:true,mode:0o700});
    if(await stat(join(home,'application_default_credentials.json')).then(()=>true,()=>false))fail('SERVER_NOT_CONFIGURED','The empty Google folder of the test servers holds credentials.');
    return home;
  }
  // The Firebase emulators a server needs: its package has an emulators script and their configuration names them.
  async function emulatorsOf(folder,scripts) {
    if(typeof scripts.emulators!=='string'||!Object.hasOwn(scripts,'emulators'))return null;
    const named=/--config[= ]([\w.-]+\.json)(?:\s|$)/.exec(scripts.emulators)?.[1]||'firebase.json';
    const config=await readFile(join(folder,named),'utf8').then(raw=>{try{return JSON.parse(raw)?.emulators;}catch{return null;}},()=>null);
    if(!config||typeof config!=='object')return null;
    const portOf=value=>Number.isInteger(value?.port)&&value.port>0&&value.port<65536?value.port:null;
    const hub=portOf(config.hub)||4400;
    return {hub,ports:[...new Set([hub,...Object.values(config).map(portOf).filter(Boolean)])]};
  }
  // Started once per project, in their own terminal, with no Google credentials either. Ports held without their hub are
  // an earlier start that went wrong: said, never stopped here. Their manager is the server's, corepack first when it is.
  async function ensureEmulators(mission,folder,manager,emulators,home,node) {
    const hub='http://127.0.0.1:'+emulators.hub+'/emulators';
    if(await probe(hub))return hub;
    const list=await listOf({label:'fabrique-console.emulators='+mission.project},'The emulators cannot be verified.');
    if(list.length)return hub;
    const taken=[];
    for(const port of emulators.ports)if(!await isFree(port))taken.push(port);
    if(taken.length)fail('EMULATORS_BUSY',`The emulator ports ${taken.join(', ')} are already in use, without their hub. Stop what holds them, then try again.`);
    const args=['run','--bg','--json','--no-parent','--outlive-parent','--name',('fabrique-console-emu-'+mission.project).toLowerCase(),'--cwd',folder,'--label','fabrique-console.app=fabrique-console','--label','fabrique-console.role=emulators','--label','fabrique-console.emulators='+mission.project,'--label','herdr.space='+poSpace({key:mission.project},mission.issue,{id:mission.id}),'--',...isolated(node,home,[...manager,'run','emulators'])];
    try{await herdr.run(args);}catch{fail('LAUNCH_UNCERTAIN','The emulators could not be confirmed as started. Check their terminal before trying again.');}
    return hub;
  }
  async function serverPlanOf(mission) {
    const plan=await planOf(mission);
    if(plan||!mission.worktree)return plan;
    return await devScript(mission.worktree)?{dir:'',argv:['./dev.sh'],url:null,script:true}:null;
  }
  async function startScript(mission) {
    const worktree=await realpath(mission.worktree).catch(()=>null);
    if(!worktree||!await devScript(worktree))fail('SERVER_NOT_CONFIGURED','This development has no test server to start.');
    const args=['run','--bg','--json','--no-parent','--outlive-parent','--name',('fabrique-console-srv-'+mission.id).toLowerCase(),'--cwd',worktree,'--label','fabrique-console.app=fabrique-console','--label','fabrique-console.role=server','--label','fabrique-console.server='+mission.id,'--label','herdr.space='+poSpace({key:mission.project},mission.issue,{id:mission.id}),'--',...isolated(await nodeOf(worktree),await emptyGcloud(),['./dev.sh'])];
    try{await herdr.run(args);}catch{fail('LAUNCH_UNCERTAIN','The server could not be confirmed as started. Check its status before trying again.');}
    // Its address comes when it says it, and counts once it answers: the status reads both.
    return status(mission);
  }
  async function start(mission) {
    const plan=await serverPlanOf(mission);
    if(!plan||!mission.worktree)fail('SERVER_NOT_CONFIGURED','This development has no test server to start.');
    if(plan.script)return startScript(mission);
    const worktree=await realpath(mission.worktree).catch(()=>null),folder=worktree?await realpath(join(worktree,plan.dir||'.')).catch(()=>null):null;
    if(!folder||(folder!==worktree&&!folder.startsWith(worktree+'/')))fail('SERVER_NOT_CONFIGURED','The folder of this server is not in the worktree.');
    const scripts=await readFile(join(folder,'package.json'),'utf8').then(raw=>JSON.parse(raw).scripts||{},()=>({}));
    const script=scriptOf(plan);
    if(typeof scripts[script]!=='string'||!Object.hasOwn(scripts,script))fail('SERVER_NOT_CONFIGURED','This script is not in the package of its folder.');
    const home=await emptyGcloud(),node=await nodeOf(folder,worktree),emulators=await emulatorsOf(folder,scripts),hub=emulators?await ensureEmulators(mission,folder,managerOf(plan),emulators,home,node):null;
    const port=await freePort(plan),command=isolated(node,home,plan.argv,['PORT='+port]);
    // The address the plan names, so that its test steps can be shown at the real one; the hub it waits for.
    const planned=localAddress.exec(plan.url||'')?.[0]||null,more=[...(planned?['--label','fabrique-console.planned='+planned]:[]),...(hub?['--label','fabrique-console.hub='+hub]:[])];
    const args=['run','--bg','--json','--no-parent','--outlive-parent','--name',('fabrique-console-srv-'+mission.id).toLowerCase(),'--cwd',folder,'--label','fabrique-console.app=fabrique-console','--label','fabrique-console.role=server','--label','fabrique-console.server='+mission.id,'--label','fabrique-console.port='+port,...more,'--label','herdr.space='+poSpace({key:mission.project},mission.issue,{id:mission.id}),'--',...(hub?['sh','-c',waitHub,'fabrique-console-wait',hub,...command]:command)];
    try{await herdr.run(args);}catch{fail('LAUNCH_UNCERTAIN','The server could not be confirmed as started. Check its status before trying again.');}
    return status(mission);
  }
  // How the project runs its own app: only the defines of its launch configuration. A file of defines is ignored by Git,
  // so a worktree may have it only in the main checkout: it is named there, never read nor copied.
  async function flutterDefines(folder) {
    const config=await readFile(join(folder,'.vscode','launch.json'),'utf8').then(raw=>{try{return JSON.parse(raw);}catch{return null;}},()=>null);
    const given=(config?.configurations||[]).find(c=>c?.type==='dart'&&Array.isArray(c.toolArgs))?.toolArgs||[],kept=[];
    for(const arg of given.filter(a=>typeof a==='string'&&/^--dart-define(?:-from-file)?=/.test(a))) {
      const file=/^--dart-define-from-file=(.+)$/.exec(arg)?.[1];
      if(!file||await stat(join(folder,file)).then(()=>true,()=>false)){kept.push(arg);continue;}
      const main=dirname(await git(folder,['rev-parse','--path-format=absolute','--git-common-dir']).catch(()=>'.'));
      if(!await stat(join(main,file)).then(()=>true,()=>false))fail('SERVER_NOT_CONFIGURED','The settings file of this app is missing: '+file);
      kept.push('--dart-define-from-file='+join(main,file));
    }
    return kept;
  }
  // A simulator to run on: an iPhone already started, else one of the most recent system, started here.
  async function simulator() {
    let devices;
    try{devices=JSON.parse((await invoke('xcrun',['simctl','list','devices','available','-j'],{timeout:20000})).stdout).devices;}catch{fail('SERVER_NOT_CONFIGURED','The iPhone simulators of this Mac could not be read.');}
    const version=key=>/iOS-(\d+)-(\d+)/.exec(key).slice(1).map(Number);
    const phones=Object.entries(devices||{}).filter(([key])=>/iOS-\d+-\d+/.test(key)).sort(([a],[b])=>{const [x,y]=[version(a),version(b)];return y[0]-x[0]||y[1]-x[1];}).flatMap(([,list])=>list).filter(device=>/^iPhone/.test(device.name));
    if(!phones.length)fail('SERVER_NOT_CONFIGURED','No iPhone simulator is installed on this Mac.');
    const started=phones.find(device=>device.state==='Booted');
    if(started)return started.udid;
    await invoke('xcrun',['simctl','boot',phones[0].udid],{timeout:60000}).catch(()=>{});
    return phones[0].udid;
  }
  // The app of a development, on the simulator, in a terminal of its own, with the Flutter its project pins through mise.
  const FLUTTER_RUN='if command -v mise >/dev/null; then exec mise exec -- flutter run "$@"; fi; exec flutter run "$@"';
  async function startApp(mission,ticket=null) {
    let base=mission.worktree;
    if(ticket){const own=(mission.tickets||[]).find(t=>t.id===ticket);if(!own?.worktree)fail('SERVER_NOT_CONFIGURED','This ticket has no worktree of its own.');base=own.worktree;}
    // A ticket runs what its own worktree holds, merged or not; the development, the app it changed.
    const worktree=base?await realpath(base).catch(()=>null):null,app=ticket?null:(await delivery({mission:mission.id})).app;
    const found=!worktree?null:ticket?await flutterFolderOf(worktree):app?join(worktree,app.folder):null,folder=found?await realpath(found).catch(()=>null):null;
    if(!folder||(folder!==worktree&&!folder.startsWith(worktree+'/'))||!await isFlutter(folder))fail('SERVER_NOT_CONFIGURED',ticket?'This ticket has no Flutter app to start.':'This development has no Flutter app to start.');
    const defines=await flutterDefines(folder),device=await simulator();
    // One app on the simulator at a time: each version installs the same app there, the last one would replace the others.
    const others=await listOf({label:'fabrique-console.role=app-test'},'The apps already running cannot be verified.');
    for(const other of others.filter(t=>t.state==='live'||t.state===undefined))try{await herdr.kill(terminalId(other));}catch{fail('STOP_FAILED','The app already running could not be stopped.');}
    await invoke('open',['-a','Simulator'],{timeout:15000}).catch(()=>{});
    const name=('fabrique-console-app-'+appKey(mission,ticket)).toLowerCase(),space=poSpace({key:mission.project},mission.issue,{id:mission.id});
    const args=['run','--bg','--json','--no-parent','--outlive-parent','--name',name,'--cwd',folder,'--label','fabrique-console.app=fabrique-console','--label','fabrique-console.role=app-test','--label',TARGET_LABEL.app+'='+appKey(mission,ticket),'--label','fabrique-console.device='+device,'--label','herdr.space='+space,'--label','herdr.tab='+name,'--','zsh','-lc',FLUTTER_RUN,'flutter','-d',device,'--device-timeout','60',...defines];
    let launched;
    try{launched=parsed((await herdr.run(args)).stdout);}catch{fail('LAUNCH_UNCERTAIN','The app could not be confirmed as started. Check its status before trying again.');}
    return {running:true,terminal:terminalId(launched),url:null,reason:null,lastOutput:null,device,space,tab:name};
  }
  // The back office in terminal-browser, in a terminal the QA window shows: one per development, on the page it is
  // asked for. Only a page of this Mac is opened.
  // The key terminal-browser gives the browser of a terminal: the one on the same tty, so that an agent can drive it.
  // A browser just started registers in a moment; never found, it stays unknown.
  async function browserKey(terminal) {
    for(let n=0;n<10;n++) {
      const pid=await herdr.get(terminal).then(r=>parsed(r.stdout)?.pid,()=>null);
      const tty=Number.isInteger(pid)?await invoke('ps',['-o','tty=','-p',String(pid)],{timeout:5000}).then(r=>String(r.stdout||'').trim(),()=>''):'';
      if(/^ttys?\d+$/.test(tty)) {
        const list=await invoke('terminal-browser',['ls','--all','--json'],{timeout:15000}).then(r=>parsed(r.stdout)?.browsers,()=>null);
        const key=Array.isArray(list)?list.find(b=>b?.tty==='/dev/'+tty)?.key:null;
        if(typeof key==='string'&&/^\d+-\d+$/.test(key))return key;
      }
      await wait(500);
    }
    return null;
  }
  const pageForm=/^https?:\/\/(?:localhost|127\.0\.0\.1):\d{2,5}(?:\/[^\s]*)?$/;
  async function qaBrowser(raw) {
    const input=object(raw);only(input,['mission','url']);
    if(typeof input.url!=='string'||!pageForm.test(input.url))fail('INVALID_ARGUMENT','Only a page of this Mac is opened.');
    const mission=await registry.read(input.mission);
    const what='The browser of the QA cannot be verified.',list=await listOf({label:'fabrique-console.qabrowser='+mission.id},what);
    for(const open of list) {
      // Its page unknown is never another page: it is neither closed nor opened again.
      const own=await herdr.record(terminalId(open)).then(r=>r?labels(r):{},()=>fail('HC_UNAVAILABLE','herdr-core is unavailable. '+what));
      if(own['fabrique-console.url']===input.url)return {terminal:terminalId(open),reused:true,key:await browserKey(terminalId(open))};
      try{await herdr.kill(terminalId(open));}catch{fail('STOP_FAILED','The browser on another page could not be closed.');}
    }
    const name=('fabrique-console-qa-browser-'+mission.id).toLowerCase();
    const args=['run','--bg','--json','--no-parent','--outlive-parent','--name',name,'--label','fabrique-console.app=fabrique-console','--label','fabrique-console.role=qa-browser','--label','fabrique-console.qabrowser='+mission.id,'--label','fabrique-console.url='+input.url,'--label','herdr.space='+poSpace({key:mission.project},mission.issue,{id:mission.id}),'--label','herdr.tab='+name,'--','zsh','-lc','exec terminal-browser open --no-merge "$1"','terminal-browser',input.url];
    let launched;
    try{launched=parsed((await herdr.run(args)).stdout);}catch{fail('LAUNCH_UNCERTAIN','The browser could not be confirmed as started. Try again.');}
    return {terminal:terminalId(launched),reused:false,key:await browserKey(terminalId(launched))};
  }
  async function server(raw) {
    const input=object(raw);only(input,['mission','command','target','ticket']);
    if(!['status','start','stop'].includes(input.command))fail('INVALID_ARGUMENT','The command is status, start or stop.');
    const target=input.target??'server';
    if(typeof target!=='string'||!Object.hasOwn(TARGET_LABEL,target))fail('INVALID_ARGUMENT','The target is server or app.');
    if(input.ticket!==undefined&&(target!=='app'||typeof input.ticket!=='string'||!ticketForm.test(input.ticket)))fail('INVALID_ARGUMENT','A ticket runs only its app.');
    const mission=await registry.read(input.mission),ticket=input.ticket??null;
    if(input.command==='status')return status(mission,target,ticket);
    // Two clicks make one server, and a server already there is simply found again.
    return patientLock(join(root,'state','server'),async()=>{
      const now=await status(mission,target,ticket),alive=now.running||now.starting||now.stuck;
      const kill=async()=>{try{await herdr.kill(now.terminal);}catch{fail('STOP_FAILED','The server could not be stopped.');}};
      if(input.command==='start') {
        // One still starting is waited for; one that will never answer makes room for a new start.
        if(now.running||now.starting)return now;
        if(now.stuck)await kill();
        return target==='app'?startApp(mission,ticket):start(mission);
      }
      if(alive)await kill();
      return {running:false,starting:false,terminal:now.terminal,url:null,reason:null,lastOutput:null};
    },{tries:3000});
  }
  return {delivery,server,qaBrowser};
}
