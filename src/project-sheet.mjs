// The project sheet: what runs for a project on this machine, and which tools its agents have.
// Only names, counts and states are read from the configuration files: never a value of a
// server's configuration (address, command, arguments, environment), which may hold secrets.
import {promises as fs} from 'node:fs';
import path from 'node:path';
import {homedir} from 'node:os';
import {request} from 'node:http';
import {randomUUID} from 'node:crypto';
import {exec,commandOptions,fail} from './common.mjs';

const NAME=/^[A-Za-z0-9_.:@-]{1,64}$/;
const SKIP=new Set(['node_modules','worktrees','vendor','build','dist','out','target','Pods','archive','archives']);
const RULES=['CLAUDE.md','AGENTS.md','WORKFLOW.md'];
const CHECK_STATES=['connected','failed','auth','pending','unknown'];
const STALE_CHECK=5*60000,MAX_REPOS=12,MAX_SERVERS=40;
const defaultRun=(command,args,options={})=>exec(command,args,{...commandOptions,...options});
const byName=(a,b)=>a.name<b.name?-1:a.name>b.name?1:0;
// A name read from a configuration is shown only if it cannot be a secret: short words, no key prefix.
// A name that fails is counted as hidden, never returned.
const KEY_PREFIX=/^((sk|pk|rk)[_-](live|test|proj|ant|or|svc)|(ghp|gho|ghu|ghs|ghr)_|github_pat_|glpat-|xox[a-z]-|lin_(api|oauth)_|(akia|asia)[0-9a-z]{8}|eyj|ya29\.|aiza|npm_[a-z0-9]{12})/i;
// This is a filter on the shape of a name, not a proof that a name is not a secret: whoever names a
// server after a short password will see it listed, as in the tools themselves.
const opaque=part=>part.length>20||(part.length>=12&&/[a-z]/i.test(part)&&(part.match(/\d/g)||[]).length>=3);
export const publishable=name=>typeof name==='string'&&NAME.test(name)&&name.length<=48&&!name.split(/[:@.]/).some(segment=>KEY_PREFIX.test(segment))&&!name.split(/[_.:@-]/).some(opaque);
const shown=(name,report)=>{if(publishable(name)) return true;if(report) report.hidden+=1;return false;};

// absent: the file does not exist. unavailable: it exists and could not be read or understood.
async function readText(file) {
  try {return {state:'read',text:await fs.readFile(file,'utf8')};}
  catch(error) {return {state:error?.code==='ENOENT'?'absent':'unavailable'};}
}
async function readJson(file) {
  const raw=await readText(file);
  if(raw.state!=='read') return raw;
  try {const data=JSON.parse(raw.text);return data&&typeof data==='object'?{state:'read',data}:{state:'unavailable'};}catch {return {state:'unavailable'};}
}
// A folder that does not exist is empty; one that cannot be read makes the inventory partial.
async function entries(dir,report) {
  try {return await fs.readdir(dir,{withFileTypes:true});}
  catch(error) {if(report&&error?.code!=='ENOENT'&&error?.code!=='ENOTDIR') report.failed=true;return [];}
}
const folders=async (dir,report)=>(await entries(dir,report)).filter(e=>(e.isDirectory()||e.isSymbolicLink())&&!e.name.startsWith('.')&&!SKIP.has(e.name)).map(e=>e.name).sort();
const markdown=async (dir,report)=>(await entries(dir,report)).filter(e=>e.isFile()&&e.name.endsWith('.md')).map(e=>e.name.slice(0,-3)).filter(name=>shown(name,report));

export async function projectFolder(repo) {
  if(typeof repo!=='string'||!path.isAbsolute(repo)||repo.includes('\0')) fail('INVALID_ARGUMENT','The project folder is invalid.');
  try {if(!(await fs.stat(repo)).isDirectory()) throw new Error('not a directory');}catch {fail('INVALID_ARGUMENT','The project folder is invalid.');}
  return path.resolve(repo);
}

// ---- Tools of the agents
function servers(map,scope,into,report) {
  if(!map||typeof map!=='object') return;
  for(const [name,value] of Object.entries(map)) {
    if(!value||typeof value!=='object'||!shown(name,report)) continue;
    into.set(name,{name,scope,kind:value.type==='http'||value.type==='sse'||typeof value.url==='string'?'remote':'local'});
  }
}
async function claudeServices(home,repo,report) {
  const user=await readJson(path.join(home,'.claude.json')),local=await readJson(path.join(repo,'.mcp.json'));
  if(user.state==='unavailable'||local.state==='unavailable') return {state:'unavailable',items:[]};
  const found=new Map();
  servers(user.data?.mcpServers,'global',found,report);
  servers(user.data?.projects?.[repo]?.mcpServers,'project',found,report);
  servers(local.data?.mcpServers,'project',found,report);
  return {state:'read',items:[...found.values()].sort(byName)};
}
// The table headers of the Codex configuration, read outside of any multi-line string: a line that
// looks like a header inside a value is not one.
export function codexServerNames(text) {
  const names=[];let mode=null,unsupported=false,depth=0,root=true;
  // A multi-line string may hold up to two quotes of its own right before its closing mark.
  const closing=(line,i,quote)=>{let n=3;while(n<5&&line[i+n]===quote) n+=1;return n;};
  // The exact component mcp_servers, bare or quoted: "mcp_servers-helper" and "mcp_servers.helper" are other names.
  const SERVERS='(?:mcp_servers|"mcp_servers"|\'mcp_servers\')';
  const header=new RegExp('^\\s*\\[\\[?\\s*'+SERVERS+'\\s*[.\\]]'),key=new RegExp('^\\s*'+SERVERS+'\\s*[.=]');
  for(const line of String(text??'').split('\n')) {
    // A line is a header or a key only outside a string and outside a value written on several lines.
    if(mode===null&&depth===0) {
      const match=line.match(/^\s*\[mcp_servers\.(?:"([^"]+)"|'([^']+)'|([A-Za-z0-9_-]+))[.\]]/),name=match?.[1]??match?.[2]??match?.[3];
      if(name) names.push(name);
      // Servers declared in another form (a table of inline tables, dotted keys, spaced or quoted
      // headers) are not read here: the list is then unread, not empty.
      else if(header.test(line)) unsupported=true;
      // A key only names the servers at the root of the file, before any table.
      else if(root&&key.test(line)) unsupported=true;
      if(/^\s*\[/.test(line)) root=false;
    }
    // The line is then walked to know in which string, if any, the next one starts.
    for(let i=0;i<line.length;i++) {
      const three=line.slice(i,i+3),ch=line[i];
      if(mode===null) {
        if(ch==='#') break;
        if(three==='"""'||three==="'''") {mode=three;i+=2;}
        else if(ch==='"'||ch==="'") mode=ch;
        else if(ch==='['||ch==='{') depth+=1;
        else if((ch===']'||ch==='}')&&depth>0) depth-=1;
      }
      else if(mode==='"'||mode==='"""') {
        if(ch==='\\') i+=1;
        else if(mode==='"'&&ch==='"') mode=null;
        else if(mode==='"""'&&three==='"""') {i+=closing(line,i,'"')-1;mode=null;}
      }
      else if(mode==="'"&&ch==="'") mode=null;
      else if(mode==="'''"&&three==="'''") {i+=closing(line,i,"'")-1;mode=null;}
    }
    // A one-line string never continues on the next line.
    if(mode==='"'||mode==="'") mode=null;
  }
  return Object.assign([...new Set(names)],{unsupported});
}
async function codexServices(home,report) {
  const raw=await readText(path.join(home,'.codex','config.toml'));
  if(raw.state==='unavailable') return {state:'unavailable',items:[]};
  const names=codexServerNames(raw.text);
  // A declaration in a form that is not read is an unread list, not an empty one.
  if(names.unsupported) return {state:'unavailable',items:[]};
  return {state:'read',items:names.filter(name=>shown(name,report)).sort().map(name=>({name}))};
}
async function plugins(home,report) {
  const settings=await readJson(path.join(home,'.claude','settings.json'));
  if(settings.state==='unavailable') return {state:'unavailable',items:[]};
  const items=[];
  for(const [id,enabled] of Object.entries(settings.data?.enabledPlugins??{})) {
    const cut=id.lastIndexOf('@'),name=cut>0?id.slice(0,cut):id,source=cut>0?id.slice(cut+1):null;
    if(enabled===true&&shown(name,report)&&(source===null||shown(source,report))) items.push({name,source});
  }
  return {state:'read',items:items.sort(byName)};
}
// What the project itself brings: at its root (where: null) and in each of its sub-folders.
async function declared(repo,children,kind,list) {
  const out=[];
  for(const where of [null,...children]) for(const name of await list(path.join(repo,where??'','.claude',kind))) out.push({name,where});
  return out.sort(byName);
}

// ---- Repositories
// The main branch of a repository is the one its remote names as default (origin/HEAD, as recorded
// at clone time or by "git remote set-head"). A local branch called main proves nothing.
// Returns {branch, remote}: branch is null when it cannot be told; remote is null without a remote.
export async function mainBranch(dir,run=defaultRun) {
  const git=(...args)=>run('git',['--no-optional-locks','-C',dir,...args]).then(r=>String(r.stdout??'').trim());
  let remotes;
  try {remotes=(await git('remote')).split('\n').filter(Boolean);}catch {return {branch:null,remote:null,readable:false};}
  if(!remotes.length) {
    try {const head=await git('symbolic-ref','--quiet','--short','HEAD');return {branch:head||null,remote:null,readable:true};}catch {return {branch:null,remote:null,readable:true};}
  }
  const remote=remotes.includes('origin')?'origin':remotes[0];
  try {
    const ref=await git('symbolic-ref','--quiet','refs/remotes/'+remote+'/HEAD'),prefix='refs/remotes/'+remote+'/';
    if(ref.startsWith(prefix)&&ref.length>prefix.length) return {branch:ref.slice(prefix.length),remote,readable:true};
  }catch {}
  return {branch:null,remote,readable:true};
}
// The repositories of a project folder: itself and its direct sub-folders. A sub-folder whose .git is
// a file is a linked worktree of another repository and is not listed twice; the root always counts.
export async function projectRepos(root,report={failed:false}) {
  const found=[];let truncated=false;
  const candidates=[[root,path.basename(root),true],...(await folders(root,report)).map(child=>[path.join(root,child),child,false])];
  const canonical=async dir=>{try {return await fs.realpath(dir);}catch {return path.resolve(dir);}};
  const present=new Set(await Promise.all(candidates.map(([dir])=>canonical(dir))));
  for(const [dir,name,isRoot] of candidates) {
    let entry;
    try {entry=await fs.lstat(path.join(dir,'.git'));}catch(error) {if(error?.code!=='ENOENT'&&error?.code!=='ENOTDIR') report.failed=true;continue;}
    // A .git file names where the repository data lives. Under "<repository>/.git/worktrees" it is a
    // linked worktree: it is left out only when that repository is itself listed here, so that a
    // repository is never listed twice and never dropped. Anything else (a submodule) is listed.
    if(!entry.isDirectory()&&!isRoot) {
      let pointer;try {pointer=await fs.readFile(path.join(dir,'.git'),'utf8');}catch {report.failed=true;continue;}
      const target=pointer.match(/^gitdir:\s*(.+?)\s*$/m)?.[1],owner=target?path.resolve(dir,target).match(/^(.*)[\\/]\.git[\\/]worktrees[\\/][^\\/]+$/)?.[1]:null;
      if(owner&&present.has(await canonical(owner))) continue;
    }
    if(found.length>=MAX_REPOS) {truncated=true;break;}
    found.push({dir,name});
  }
  return Object.assign(found,{truncated});
}
async function repository(dir,name,run) {
  const git=(...args)=>run('git',['--no-optional-locks','-C',dir,...args]).then(r=>String(r.stdout??'').trim());
  const unknown={name,branch:null,remote:false,ahead:null,behind:null,tracked:false,fetchedAt:null};
  const main=await mainBranch(dir,run);
  if(!main.readable) return {...unknown,readable:false};
  if(!main.branch) return {...unknown,remote:!!main.remote,readable:true};
  if(!main.remote) return {...unknown,branch:main.branch,readable:true};
  let ahead=null,behind=null,tracked=false,fetchedAt=null;
  try {
    // "--" keeps a branch name from ever being read as an option.
    const [left,right]=(await git('rev-list','--left-right','--count','refs/heads/'+main.branch+'...refs/remotes/'+main.remote+'/'+main.branch,'--')).split(/\s+/).map(Number);
    if(Number.isInteger(left)&&Number.isInteger(right)) {ahead=left;behind=right;tracked=true;}
  }catch {}
  try {fetchedAt=(await fs.stat(path.join(dir,'.git','FETCH_HEAD'))).mtime.toISOString();}catch {}
  return {name,branch:main.branch,remote:true,ahead,behind,tracked,fetchedAt,readable:true};
}
async function repositories(repo,run) {
  const report={failed:false},found=await projectRepos(repo,report),items=[];
  for(const {dir,name} of found) items.push(await repository(dir,name,run));
  // A folder that could not be read, or more repositories than are listed, makes the list partial.
  return {state:report.failed||found.truncated?'partial':'read',items,truncated:found.truncated};
}

// ---- Servers
export function parseListeners(text) {
  const out=[],seen=new Set();let pid=null,command='';
  for(const line of String(text).split('\n')) {
    const value=line.slice(1);
    if(line[0]==='p') {pid=/^\d+$/.test(value)?Number(value):null;command='';}
    else if(line[0]==='c') command=value.replace(/[^\w.+-]/g,'').slice(0,32);
    else if(line[0]==='n'&&pid!==null) {
      const port=Number(value.slice(value.lastIndexOf(':')+1));
      if(!value.includes(':')||!Number.isInteger(port)||port<1||port>65535||seen.has(pid+':'+port)) continue;
      seen.add(pid+':'+port);out.push({pid,command,port});
    }
  }
  return out;
}
function parseFolders(text) {
  const out=new Map();let pid=null;
  for(const line of String(text).split('\n')) {
    if(line[0]==='p') pid=/^\d+$/.test(line.slice(1))?Number(line.slice(1)):null;
    else if(line[0]==='n'&&pid!==null) out.set(pid,line.slice(1));
  }
  return out;
}
// Any HTTP answer, whatever its status, means the server responds. The probe ends at the first
// answer, and after a total delay whatever the server keeps sending.
const answers=port=>new Promise(resolve=>{
  let done=false;
  const finish=value=>{if(done) return;done=true;clearTimeout(deadline);req.destroy();resolve(value);};
  const req=request({hostname:'localhost',port,path:'/',method:'GET',timeout:1200},res=>{res.destroy();finish(true);});
  const deadline=setTimeout(()=>finish(false),1500);
  req.on('timeout',()=>finish(false));req.on('error',()=>finish(false));req.end();
});
const real=async dir=>{try {return await fs.realpath(dir);}catch {return dir;}};
async function listening(repo,run,probe) {
  const none={state:'unavailable',items:[],unattributed:0,truncated:false};
  let listeners;
  try {listeners=parseListeners((await run('lsof',['-nP','-iTCP','-sTCP:LISTEN','-Fpcn'])).stdout);}
  // lsof ends with status 1 when nothing listens: that is a reading, not a failure.
  catch(error) {if(error?.code===1&&!error.stdout) listeners=[];else return none;}
  if(!listeners.length) return {state:'read',items:[],unattributed:0,truncated:false};
  let cwds;
  try {cwds=parseFolders((await run('lsof',['-a','-p',[...new Set(listeners.map(l=>l.pid))].join(','),'-d','cwd','-Fn'])).stdout);}
  catch(error) {if(error?.code===1&&!error.stdout) cwds=new Map();else return none;}
  // Folders are compared by their real path, so a symbolic link does not hide a server.
  // The worktrees folder is looked for beside the folder as given and beside its real location.
  const root=await real(repo),beside=dir=>path.join(path.dirname(dir),'worktrees',path.basename(dir)),items=[],ports=new Set(),orphans=new Set();
  const worktreeRoots=[...new Set([await real(beside(repo)),await real(beside(root))])];
  for(const {pid,command,port} of listeners) {
    const cwd=cwds.get(pid);
    // A process whose folder cannot be read may belong to the project: it is counted apart.
    if(!cwd) {orphans.add(pid);continue;}
    if(ports.has(port)) continue;
    let from=null,worktree=false;
    if(cwd===root) from=path.basename(root);
    else if(cwd.startsWith(root+path.sep)) from=cwd.slice(root.length+1).split(path.sep)[0];
    else {const worktrees=worktreeRoots.find(dir=>cwd.startsWith(dir+path.sep));if(worktrees) {from=cwd.slice(worktrees.length+1).split(path.sep)[0];worktree=true;}}
    if(from===null) continue;
    ports.add(port);items.push({port,command,pid,from,worktree});
  }
  const kept=items.sort((a,b)=>a.port-b.port).slice(0,MAX_SERVERS),truncated=items.length>kept.length;
  return {state:orphans.size||truncated?'partial':'read',items:await Promise.all(kept.map(async item=>({...item,responds:await probe(item.port).catch(()=>false)===true}))),unattributed:orphans.size,truncated};
}

// ---- Connection check of the services (made on request: it starts the local servers for a moment)
export function parseMcpList(text) {
  const out={};
  for(const line of String(text).split('\n')) {
    const match=line.match(/^([A-Za-z0-9_.:@-]{1,64}): (.+)$/);if(!match) continue;
    const verdict=match[2].slice(match[2].lastIndexOf(' - ')+1);
    if(!publishable(match[1])) continue;
    out[match[1]]=/Connected/.test(verdict)?'connected':/Needs authentication/.test(verdict)?'auth':/Failed to connect/.test(verdict)?'failed':/Pending approval/.test(verdict)?'pending':'unknown';
  }
  return out;
}
async function store(cachePath,value) {
  await fs.mkdir(path.dirname(cachePath),{recursive:true,mode:0o700});
  const temporary=cachePath+'.'+process.pid+'.'+randomUUID()+'.tmp';
  try {await fs.writeFile(temporary,JSON.stringify(value),{mode:0o600});await fs.rename(temporary,cachePath);}
  catch(error) {await fs.rm(temporary,{force:true}).catch(()=>{});throw error;}
}
export async function markChecking({repo,cachePath,now=Date.now()}) {
  await store(cachePath,{repo:await projectFolder(repo),state:'running',at:new Date(now).toISOString()});
}
export async function failChecking({repo,cachePath,now=Date.now()}) {
  await store(cachePath,{repo:await projectFolder(repo),state:'failed',at:new Date(now).toISOString()});
}
export async function runMcpCheck({repo,cachePath,run=defaultRun,now,command='claude'}) {
  const root=await projectFolder(repo),at=()=>new Date(now??Date.now()).toISOString();
  await store(cachePath,{repo:root,state:'running',at:at()});
  try {
    const {stdout}=await run(command,['mcp','list'],{cwd:root,timeout:120000});
    await store(cachePath,{repo:root,state:'done',at:at(),results:parseMcpList(stdout)});
  }catch {await store(cachePath,{repo:root,state:'failed',at:at()});}
}
async function lastCheck(cachePath,repo,now) {
  const cache=cachePath?await readJson(cachePath):{state:'absent'},data=cache.data;
  if(cache.state!=='read'||data.repo!==repo||typeof data.at!=='string'||!Number.isFinite(Date.parse(data.at))) return {state:'never'};
  if(data.state==='running') return {state:now-Date.parse(data.at)>STALE_CHECK?'failed':'running',at:data.at};
  if(data.state==='done'&&data.results&&typeof data.results==='object') return {state:'done',at:data.at,results:Object.fromEntries(Object.entries(data.results).filter(([name,state])=>publishable(name)&&CHECK_STATES.includes(state)))};
  return {state:'failed',at:data.at};
}

export async function readSheet({repo,home=homedir(),cachePath,now=Date.now(),run=defaultRun,probe=answers}={}) {
  const root=await projectFolder(repo),report={failed:false,hidden:0},children=await folders(root,report);
  const skillFolders=async dir=>(await folders(dir,report)).filter(name=>shown(name,report)),files=dir=>markdown(dir,report);
  const [claude,codex,enabled,agents,commands,projectSkills,globalSkills,repos,running,check]=await Promise.all([
    claudeServices(home,root,report),codexServices(home,report),plugins(home,report),
    declared(root,children,'agents',files),declared(root,children,'commands',files),declared(root,children,'skills',skillFolders),
    skillFolders(path.join(home,'.claude','skills')),repositories(root,run),listening(root,run,probe),lastCheck(cachePath,root,now),
  ]);
  const rules=[];
  for(const name of RULES) try {if((await fs.stat(path.join(root,name))).isFile()) rules.push({name,path:path.join(root,name)});}catch(error) {if(error?.code!=='ENOENT') report.failed=true;}
  return {
    checkedAt:new Date(now).toISOString(),servers:running,repos,
    mcp:{claude,codex,check},plugins:enabled,inventory:{state:report.failed?'partial':'read',hidden:report.hidden},agents,commands,
    skills:{global:globalSkills,project:[...new Set(projectSkills.map(s=>s.name))]},rules,
  };
}
