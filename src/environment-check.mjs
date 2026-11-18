// The environment check of a project (M6, decisions 89, 93 and 95; approach workflow-v2-M6-approche-2.md and its review).
//
// In this order: database, migrations, accounts. The first failure stops the rest: the steps after it are « not run »,
// never green. A failure gives one cause of a closed list (CAUSES) with a detail key and numbers; no output of a
// program is ever kept (docker, lsof, psql, Git, PostgreSQL: their text is read to take a decision, then dropped).
// Green needs the three steps declared and green, and is bound to the commit checked, the fingerprint of the
// configuration and the enrollment of the base (greenFor).
//
// - The commit checked is resolved once, at the start, without a fetch (origin/<main branch>, else HEAD): every read
//   of the project is made at that SHA (git cat-file), never in its working tree. Every Git call is local strict
//   (src/environment-git.mjs): nothing downloaded, no credential helper, nothing written, a fixed environment.
// - Database: present, local, recognised. Docker is run as `env -i DOCKER_CONFIG=<empty> docker --host unix://<socket
//   enrolled>`: no context, no DOCKER_HOST of the caller. The engine behind the socket is Docker Desktop and the one
//   enrolled (docker info: ID, OperatingSystem, Name), at the start and at the end (review 2, I1). The container (full id, image id) was enrolled once by
//   the user (environment-enroll, refused from an agent). It publishes the port on 127.0.0.1 only; the listener of the
//   host has one owner, Docker Desktop by its real executable (lsof txt, never argv[0]); `docker top` shows only
//   postgres; the check keeps a TCP connection to 127.0.0.1:<port> open with a random application_name, and psql inside the container (on the socket named by
//   postmaster.pid, -X -w, a fixed environment) must see it in pg_stat_activity. Recognised: the fingerprint of
//   system_identifier and the base name are the enrolled ones. The proofs are taken again at the end: a change is
//   DB_NOT_LOCAL. Only the fixed SELECTs of QUERIES leave, on a session in default_transaction_read_only=on.
// - Migrations (Drizzle): the journal and each SQL file at the commit checked, against drizzle.__drizzle_migrations,
//   with Drizzle's rule (an entry is pending when its `when` is after the largest created_at). Nothing is run.
// - Accounts: one count per account, the identifier sent as a parameter; only yes or no is kept.
// - No server step in v1 (decision 95): the macOS sandbox filters the port, not the address, so a confined server
//   would be reachable from the local network. It comes back before M16 (firewall or dedicated account); the
//   preparation of its folder is parked on the local branch wip/m6-server-folder.
//
// One check at a time per project (review, point 3): the kernel lock of src/operation-lock.mjs (flock on
// environment/<project>/operation.guard), held for the whole check and dropped by the kernel when its process dies.
// Each check has its own marker `.running-<id>` (review 3), written before that lock is tried and removed by that check
// only, after its result is saved: one left behind says that its check died, so the next one is « interrupted » for it
// and removes it.
//
// This module sends no signal and starts no server, no base, no container: it only reads.
import { createHash, randomBytes } from 'node:crypto';
import { lstat, readdir, readFile, unlink } from 'node:fs/promises';
import { dirname, isAbsolute, join } from 'node:path';
import { userInfo } from 'node:os';
import { fail, canonical, readJSON, writeJSON, privateDir } from './common.mjs';
import { validateEnvironment, environmentFingerprint } from './environment-config.mjs';
import { pgConnect } from './environment-pg.mjs';
import { operationLock } from './operation-lock.mjs';
import { ownerAlive } from './workspace-inspection.mjs';
import { localGit } from './environment-git.mjs';
import { CAUSES, Stop, stop } from './environment-causes.mjs';
import { AGENT_MARK } from '../ui/v3/view.js';

export { CAUSES };
export const STEPS=Object.freeze(['database','migrations','accounts']);
// The only queries sent on the connection of the check, plus accountQuery for the declared (validated) identifiers.
export const QUERIES=Object.freeze({
  readOnly:"SELECT current_setting('default_transaction_read_only')",
  identity:'SELECT system_identifier::text, current_database() FROM pg_control_system()',
  journalTable:"SELECT to_regclass('drizzle.__drizzle_migrations') IS NOT NULL",
  journalRows:'SELECT count(*)::text, coalesce(max(created_at),0)::text FROM drizzle.__drizzle_migrations',
});
const IDENT=/^[a-z_][a-z0-9_]{0,62}$/,APP=/^mc-env-[a-f0-9]{24}$/;
export function accountQuery({schema,table,column}) {
  if(![schema,table,column].every(v=>IDENT.test(v)))throw new Error('An account query takes validated identifiers only.');
  return `SELECT count(*)::text FROM "${schema}"."${table}" WHERE "${column}" = $1`;
}
// The query psql runs inside the container: the application_name is the random one of the check (hex), never a value
// of the configuration.
export function correlationQuery(name) {
  if(!APP.test(name))throw new Error('A correlation query takes the random name of the check only.');
  return `SELECT count(*)::text FROM pg_stat_activity WHERE application_name = '${name}' AND client_addr IS NOT NULL`;
}
// The fixed environment of psql in the container: no rc file, no password file, no service file, no system folder.
const PSQL_ENV=['/usr/bin/env','-i','PATH=/usr/local/bin:/usr/bin:/bin','PGPASSFILE=/dev/null','PGSERVICEFILE=/dev/null','PGSYSCONFDIR=/nonexistent','PSQLRC=/dev/null','LC_ALL=C'];
// The docker arguments of the correlation, shared with scripts/environment-native-check.mjs (review 2, m9): psql -X -w
// in the fixed environment, stopping at the first error.
export function correlationCommand({containerId,socketDir,port,user,name,appName}) {
  return ['exec','-u','postgres',containerId,...PSQL_ENV,'psql','-X','-w','-q','-A','-t','-v','ON_ERROR_STOP=1','-h',socketDir,'-p',port,'-U',user,'-d',name,'-c',correlationQuery(appName)];
}
// The empty DOCKER_CONFIG of every docker call, in the state folder of Mission Control; shared with the native check.
export const dockerConfigFolder=root=>join(root,'environment','.docker-config');
// What docker inspect gives: four fields, never the environment of the container (it holds its password).
const INSPECT='{"id":{{json .Id}},"image":{{json .Image}},"running":{{json .State.Running}},"ports":{{json .NetworkSettings.Ports}}}';
// What docker info gives: the identity of the engine, three fields, nothing else (review 2, I1).
export const ENGINE_INFO='{"id":{{json .ID}},"os":{{json .OperatingSystem}},"name":{{json .Name}}}';
// The only engine accepted: Docker Desktop on this Mac. Another OperatingSystem is an engine that is not local
// (a remote or cloud engine behind the socket).
const LOCAL_ENGINE='Docker Desktop';
const DOCKER_DESKTOP='/Applications/Docker.app/Contents/';
const MAX_BLOB=64*1024*1024;
// What psql says when the socket of the container is not in trust (libpq, LC_ALL=C).
const SOCKET_AUTH=/fe_sendauth: no password supplied|password authentication failed|Peer authentication failed|Ident authentication failed/;

const sha256=value=>createHash('sha256').update(value).digest('hex');

// The shape of enrollment.json, checked when it is loaded (review 2, m2): every field present and well formed, none
// unknown; a field missing is never skipped, the record is refused whole (DB_UNKNOWN enrollment-invalid). It names
// the program the check runs (docker), so nothing of it is used before this.
const ENROLLMENT_FIELDS=['version','docker','socket','engine','containerId','image','port','database','user','systemIdentifier','at'];
const absolutePath=value=>typeof value==='string'&&value.length<=1024&&isAbsolute(value)&&!/[\x00-\x1f\x7f]/.test(value)&&!value.split('/').includes('..');
export function validEnrollment(value) {
  const plain=v=>Boolean(v)&&typeof v==='object'&&!Array.isArray(v),text=(v,pattern)=>typeof v==='string'&&pattern.test(v);
  if(!plain(value)||value.version!==1)return false;
  const keys=Object.keys(value);
  if(keys.length!==ENROLLMENT_FIELDS.length||!ENROLLMENT_FIELDS.every(key=>keys.includes(key)))return false;
  const engine=value.engine;
  return absolutePath(value.docker)&&absolutePath(value.socket)
    &&plain(engine)&&Object.keys(engine).sort().join(',')==='id,name,os'&&text(engine.id,/^[A-Za-z0-9:_-]{1,128}$/)&&text(engine.name,/^[A-Za-z0-9._-]{1,128}$/)&&text(engine.os,/^[^\x00-\x1f\x7f]{1,128}$/)
    &&text(value.containerId,/^[a-f0-9]{64}$/)&&text(value.image,/^sha256:[a-f0-9]{64}$/)&&text(value.systemIdentifier,/^[a-f0-9]{64}$/)
    &&Number.isInteger(value.port)&&value.port>=1024&&value.port<=65535
    &&text(value.database,IDENT)&&text(value.user,IDENT)&&text(value.at,/^\d{4}-\d{2}-\d{2}T[0-9:.]+Z$/);
}

// ---- What a launch may rely on (part b): green, for this exact commit, configuration and enrollment.

export function greenFor(last,{sha,fingerprint,enrollment}) {
  if(!last||last.green!==true||last.status!=='green'||!Array.isArray(last.steps))return false;
  if(!STEPS.every(name=>last.steps.find(s=>s.step===name)?.status==='green'))return false;
  return typeof sha==='string'&&/^[a-f0-9]{40}$/.test(sha)&&last.sha===sha&&last.fingerprint===fingerprint&&last.enrollment===enrollment;
}

// ---- The check.

// The markers of the checks under way (review 3): `.running-<24 hex>`, one per check, plus an old `.running` left by a
// version before, read as a marker. The temporary files of writeJSON (`<name>.<uuid>.tmp`) are not markers.
export const MARKER_PREFIX='.running-';
export const isMarker=name=>name==='.running'||/^\.running-[a-f0-9]{24}$/.test(name);
// The ids of the checks of this process that run now: a marker of this process outside it is dead.
const LIVE=new Set();
// The names of the markers of a folder; a marker that is not a regular file is unsafe.
async function markersOf(dir) {
  const names=[];
  for(const name of (await readdir(dir)).filter(isMarker)) {
    let info;
    // A marker removed meanwhile (a check refused removes its own) is no longer there: skipped.
    try{info=await lstat(join(dir,name));}catch(error){if(error?.code==='ENOENT')continue;throw error;}
    if(!info.isFile()||info.isSymbolicLink())fail('UNSAFE_STORAGE','The marker of a running check must be a regular file.');
    names.push(name);
  }
  return names;
}
// Whether the check of a marker is dead. An old `.running` or a marker that cannot be read is dead (the
// marker is written whole, by a rename). Another process: alive unless the system says it is gone (ownerAlive, a
// probe that delivers nothing); a pid reused keeps the marker, which only says « interrupted »: never a green.
// A marker removed meanwhile is not dead: its check removed it (a check refused removes its own before it exits), so a
// marker is dead only if it is still there once its owner is known gone.
async function markerDead(path) {
  let text;
  try{text=await readFile(path,'utf8');}catch(error){if(error?.code==='ENOENT')return false;throw error;}
  let value=null;try{value=JSON.parse(text);}catch{}
  const whole=value&&typeof value.id==='string'&&Number.isInteger(value.pid)&&value.pid>0&&!path.endsWith('/.running');
  if(whole&&(value.pid===process.pid?LIVE.has(value.id):ownerAlive(value.pid)))return false;
  try{await lstat(path);return true;}catch(error){if(error?.code==='ENOENT')return false;throw error;}
}
export function createEnvironmentCheck({root,loadConfig,invoke,env=process.env,tools={},connect=pgConnect}) {
  const lsof=tools.lsof??'/usr/sbin/lsof';
  const dirOf=key=>join(root,'environment',key),emptyConfig=dockerConfigFolder(root);
  const keyOf=value=>{if(typeof value!=='string'||!/^[a-z0-9][a-z0-9_-]{0,47}$/.test(value))fail('INVALID_ARGUMENT','A project key is required.');return value;};

  async function docker(e,args) {
    await privateDir(emptyConfig);
    if((await readdir(emptyConfig)).length)stop('DB_NOT_LOCAL','docker-config');
    return invoke('/usr/bin/env',['-i','DOCKER_CONFIG='+emptyConfig,e.docker,'--host','unix://'+e.socket,...args],{timeout:30000,maxBuffer:1024*1024});
  }
  // The engine behind the socket: Docker Desktop, and the one enrolled when there is an enrollment.
  async function engineOf(e,enrolled) {
    let info;
    try{info=JSON.parse((await docker(e,['info','--format',ENGINE_INFO])).stdout.trim().split('\n')[0]);}
    catch(error){if(error instanceof Stop)throw error;stop('DB_ABSENT','docker-unreachable');}
    const text=(value,pattern)=>typeof value==='string'&&pattern.test(value);
    if(!info||!text(info.id,/^[A-Za-z0-9:_-]{1,128}$/)||!text(info.name,/^[A-Za-z0-9._-]{1,128}$/)||!text(info.os,/^[^\x00-\x1f\x7f]{1,128}$/))stop('DB_NOT_LOCAL','engine-unknown');
    if(info.os!==LOCAL_ENGINE)stop('DB_NOT_LOCAL','engine-remote');
    if(enrolled&&(info.id!==e.engine?.id||info.os!==e.engine?.os||info.name!==e.engine?.name))stop('DB_NOT_LOCAL','engine-other');
    return {id:info.id,os:info.os,name:info.name};
  }
  // The proofs taken from outside, before the connection: engine, container, publication, listener of the host,
  // processes. `enrolled`: e is the enrollment (the check), else the candidate of an enrollment.
  async function outside(e,database,enrolled) {
    const engine=await engineOf(e,enrolled);
    let info;
    try{info=JSON.parse((await docker(e,['inspect','--format',INSPECT,enrolled?e.containerId:e.container])).stdout.trim().split('\n')[0]);}
    catch(error){if(error instanceof Stop)throw error;stop('DB_ABSENT',/No such (object|container)/i.test(String(error?.stderr??''))?'container-absent':'docker-unreachable');}
    if(!info||typeof info!=='object')stop('DB_ABSENT','docker-unreachable');
    if(info.running!==true)stop('DB_ABSENT','container-stopped');
    if(typeof info.id!=='string'||!/^[a-f0-9]{64}$/.test(info.id)||(enrolled&&info.id!==e.containerId))stop('DB_NOT_LOCAL','container-other');
    if(typeof info.image!=='string'||!/^sha256:[a-f0-9]{64}$/.test(info.image)||(enrolled&&info.image!==e.image))stop('DB_NOT_LOCAL','image-other');
    const bindings=Object.values(info.ports??{}).filter(Array.isArray).flat();
    if(bindings.some(b=>b?.HostIp!=='127.0.0.1'))stop('DB_NOT_LOCAL','port-public');
    if(bindings.length!==1||bindings[0].HostPort!==String(database.port))stop('DB_NOT_LOCAL','port-other');
    // The listener of the host: one owner, Docker Desktop, on 127.0.0.1 only.
    let rows;
    try{rows=(await invoke(lsof,['-nP','-iTCP:'+database.port,'-sTCP:LISTEN','-Fpcn','+c','0'],{timeout:15000,maxBuffer:1024*1024})).stdout.split('\n');}
    catch{stop('DB_ABSENT','listener-none');}
    const pids=new Set(),names=[];
    for(const row of rows){if(row.startsWith('p'))pids.add(row.slice(1));else if(row.startsWith('n'))names.push(row.slice(1));}
    if(!pids.size)stop('DB_ABSENT','listener-none');
    if(pids.size>1)stop('DB_NOT_LOCAL','listener-many');
    if(!names.length||names.some(name=>name!=='127.0.0.1:'+database.port))stop('DB_NOT_LOCAL','listener-public');
    const [pid]=[...pids];
    if(!/^\d+$/.test(pid))stop('DB_NOT_LOCAL','listener-foreign');
    // Its real executable, never argv[0] (`ps -o comm=` gives what the process chose, `exec -a` forges it): the first
    // text file lsof lists for the process is the program the kernel runs; the libraries follow it.
    let path='';
    try{const rows=(await invoke(lsof,['-a','-p',pid,'-d','txt','-Fn'],{timeout:10000,maxBuffer:1024*1024})).stdout.split('\n');path=rows.find(row=>row.startsWith('n'))?.slice(1)??'';}catch{}
    if(!isAbsolute(path)||!path.startsWith(DOCKER_DESKTOP)||path.split('/').includes('..'))stop('DB_NOT_LOCAL','listener-foreign');
    // No relay in the container: postgres processes only.
    let top;try{top=(await docker(e,['top',info.id,'-o','pid,comm'])).stdout.trim().split('\n').slice(1);}catch(error){if(error instanceof Stop)throw error;stop('DB_NOT_LOCAL','relay');}
    if(!top.length||top.some(line=>line.trim().split(/\s+/).pop()!=='postgres'))stop('DB_NOT_LOCAL','relay');
    return {engine,containerId:info.id,image:info.image,listener:pid,processes:top.length};
  }
  // From inside the container: the connection of the check is seen by PostgreSQL itself.
  async function correlate(e,database,containerId,appName) {
    let socketDir,port;
    try{
      const lines=(await docker(e,['exec','-u','postgres',containerId,'/usr/bin/env','-i','/usr/bin/head','-n','5',database.dataDir+'/postmaster.pid'])).stdout.split('\n');
      port=lines[3]?.trim();socketDir=lines[4]?.trim();
    }catch(error){if(error instanceof Stop)throw error;stop('DB_NOT_LOCAL','correlation');}
    if(!/^\d{1,5}$/.test(port??'')||!/^\/[A-Za-z0-9._\/-]{1,200}$/.test(socketDir??''))stop('DB_NOT_LOCAL','correlation');
    let seen;
    try{seen=(await docker(e,correlationCommand({containerId,socketDir,port,user:database.user,name:database.name,appName}))).stdout.trim();}
    catch(error){
      if(error instanceof Stop)throw error;
      // The local socket of the container asks a password (psql -w gives up) or refuses in peer: an authentication
      // not supported (trust only, decision 93), not a proof of locality that failed (review 2, m8). The text of psql
      // is read for this decision only, then dropped.
      if(SOCKET_AUTH.test(String(error?.stderr??'')))stop('DB_AUTH_UNSUPPORTED','socket');
      stop('DB_NOT_LOCAL','correlation');
    }
    if(!/^\d+$/.test(seen)||Number(seen)<1)stop('DB_NOT_LOCAL','correlation');
  }
  async function opened(database,appName) {
    try{return await connect({host:'127.0.0.1',port:database.port,user:database.user,database:database.name,applicationName:appName});}
    catch(error){
      if(error?.pg==='auth'||['28000','28P01'].includes(error?.sqlstate))stop('DB_AUTH_UNSUPPORTED','password');
      if(error?.sqlstate==='3D000')stop('DB_ABSENT','no-database');
      if(['refused','closed','timeout','network'].includes(error?.pg))stop('DB_ABSENT','connection');
      stop('DB_UNKNOWN','connection');
    }
  }
  const ask=async(connection,sql,params,detail)=>{try{return await connection.query(sql,params);}catch{stop('DB_UNKNOWN',detail);}};
  // Proves the base: outside, then the connection (read only), then inside; returns the connection, kept open.
  async function proveDatabase(e,database,enrolled) {
    const before=await outside(e,database,enrolled);
    const appName='mc-env-'+randomBytes(12).toString('hex');
    const connection=await opened(database,appName);
    try{
      if((await ask(connection,QUERIES.readOnly,[],'read-only'))[0]?.[0]!=='on')stop('DB_UNKNOWN','read-only');
      await correlate(e,database,before.containerId,appName);
      const [row]=await ask(connection,QUERIES.identity,[],'identity');
      if(!row||!/^\d{1,30}$/.test(row[0]??''))stop('DB_UNKNOWN','fingerprint');
      return {connection,before,appName,systemIdentifier:sha256('postgres-system-identifier:'+row[0]),name:row[1]};
    }catch(error){await connection.close();throw error;}
  }

  // Runs task(previous) under the kernel lock of the project; ENVIRONMENT_BUSY if another check holds it.
  // Each check has its own marker, `.running-<id>` (review 3): written BEFORE the lock is tried, written again once
  // inside, and removed by this check only, once its result is saved. A check killed at any instant after it starts
  // therefore leaves its own marker, which no other check removes while it may still be alive, and the page says
  // « interrupted », never a green of before. A check refused (BUSY), or that could not try the lock, removes its own
  // marker and never another's. Inside the lock, the markers of dead checks (an old `.running`, a marker whose process
  // is gone, or one of this process that no longer runs) make `previous` « interrupted » and are removed once the
  // result is saved. A marker whose owner may still be alive (a check refused in this very instant) is left to it.
  async function locked(key,task) {
    const dir=dirOf(key);await privateDir(dirname(dir));await privateDir(dir);
    const id=randomBytes(12).toString('hex'),path=join(dir,MARKER_PREFIX+id);
    const mark=()=>writeJSON(path,{id,pid:process.pid,at:new Date().toISOString()},value=>value);
    LIVE.add(id);
    let entered=false;
    try {
      await markersOf(dir);
      await mark();
      return await operationLock(dir,async()=>{
        entered=true;
        await mark();
        const dead=[];
        for(const name of await markersOf(dir))if(name!==MARKER_PREFIX+id&&await markerDead(join(dir,name)))dead.push(name);
        const out=await task(dead.length?'interrupted':null);
        await unlink(path).catch(()=>{});
        for(const name of dead)await unlink(join(dir,name)).catch(()=>{});
        return out;
      },{lockf:tools.lockf??'/usr/bin/lockf'});
    }catch(error) {
      if(!entered)await unlink(path).catch(()=>{});
      if(!entered&&error?.code==='BUSY')fail('ENVIRONMENT_BUSY','An environment check of this project is already running; one at a time.');
      throw error;
    }finally{LIVE.delete(id);}
  }
  // {record} when enrolled and well formed, {absent} when never enrolled, {invalid} otherwise.
  const ABSENT=Symbol('absent');
  async function enrollmentOf(key) {
    let value;
    try{value=await readJSON(join(dirOf(key),'enrollment.json'),ABSENT);}catch(error){if(error?.code==='INVALID_DATA')return {invalid:true};throw error;}
    if(value===ABSENT)return {absent:true};
    return validEnrollment(value)?{record:value}:{invalid:true};
  }

  async function resolveSha(repo,mainBranch) {
    for(const ref of ['refs/remotes/origin/'+mainBranch,'HEAD']) {
      try{const out=(await localGit(invoke,repo)(['rev-parse','--verify','-q',ref+'^{commit}'],{timeout:30000})).stdout.trim();if(/^[a-f0-9]{40}$/.test(out))return out;}catch{}
    }
    return null;
  }
  const blobAt=async(repo,sha,path)=>{try{return (await localGit(invoke,repo)(['cat-file','blob',sha+':'+path],{maxBuffer:MAX_BLOB,encoding:'buffer'})).stdout;}catch{return null;}};

  async function migrationsStep(ctx,spec) {
    const raw=await blobAt(ctx.repo.path,ctx.sha,spec.folder+'/meta/_journal.json');
    let entries;
    try{entries=JSON.parse(raw.toString('utf8')).entries;}catch{stop('MIGRATIONS_UNREADABLE','journal');}
    if(!Array.isArray(entries)||entries.length>10000)stop('MIGRATIONS_UNREADABLE','journal');
    let last=0;
    for(const entry of entries) {
      if(!entry||!Number.isSafeInteger(entry.when)||entry.when<=last||typeof entry.tag!=='string'||!/^[A-Za-z0-9_-]{1,120}$/.test(entry.tag))stop('MIGRATIONS_UNREADABLE','journal');
      last=entry.when;
      const sql=await blobAt(ctx.repo.path,ctx.sha,spec.folder+'/'+entry.tag+'.sql');
      if(!sql)stop('MIGRATIONS_UNREADABLE','sql-missing',{journal:entries.length});
    }
    const counts={journal:entries.length};
    const exists=(await ask(ctx.connection,QUERIES.journalTable,[],'migrations'))[0]?.[0]==='t';
    let applied=0;
    if(exists) {
      const [row]=await ask(ctx.connection,QUERIES.journalRows,[],'migrations');
      if(!/^\d+$/.test(row?.[0]??'')||!/^\d+$/.test(row?.[1]??''))stop('DB_UNKNOWN','migrations');
      applied=Number(row[1]);
      if(applied>last)stop('DB_AHEAD',null,counts);
    }
    const pending=entries.filter(entry=>!exists||entry.when>applied).length;
    if(pending)stop('MIGRATIONS_PENDING',null,{...counts,pending});
    return {...counts,pending:0};
  }
  async function accountsStep(ctx,spec) {
    const sql=accountQuery(spec),accounts={};
    for(const [name,value] of Object.entries(spec.keys)) {
      const [row]=await ask(ctx.connection,sql,[value],'accounts');
      if(!/^\d+$/.test(row?.[0]??''))stop('DB_UNKNOWN','accounts');
      accounts[name]=Number(row[0])>0;
    }
    if(Object.values(accounts).some(found=>!found))stop('ACCOUNT_MISSING',null,{accounts});
    return {accounts};
  }
  async function check(input={}) {
    const key=keyOf(input.project),at=new Date().toISOString();
    const base={version:1,project:key,at,sha:null,fingerprint:null,enrollment:null,cause:null,green:false};
    let config;
    try{config=await loadConfig();}catch(error){if(error?.code!=='INVALID_CONFIG')throw error;return save(key,{...base,status:'invalid',steps:STEPS.map(step=>({step,status:'not-run'}))});}
    const project=config.projects.find(p=>p.key===key);
    if(!project)fail('NOT_FOUND','No configured project uses this key.');
    if(config.version!==2||project.environment===undefined)return save(key,{...base,status:'not-declared',steps:STEPS.map(step=>({step,status:'not-declared'}))});
    let environment;
    try{environment=validateEnvironment(project.environment,{repos:project.repos.length});}catch{return save(key,{...base,status:'invalid',steps:STEPS.map(step=>({step,status:'not-run'}))});}
    return await locked(key,async previous=>{
    const ctx={key,repo:project.repos[0],connection:null};
    try {
      ctx.sha=await resolveSha(ctx.repo.path,ctx.repo.mainBranch);
      const loaded=await enrollmentOf(key);ctx.enrollment=loaded.record??null;
      const result={...base,sha:ctx.sha,fingerprint:environmentFingerprint({environment,repo:ctx.repo}),enrollment:ctx.enrollment?sha256(canonical(ctx.enrollment)):null,...(previous?{previous}:{})};
      const steps=[];let failed=null;
      for(const name of STEPS) {
        if(!environment[name]){steps.push({step:name,status:'not-declared'});continue;}
        if(failed){steps.push({step:name,status:'not-run'});continue;}
        try {
          let out;
          if(!ctx.sha&&name==='migrations')stop('MIGRATIONS_UNREADABLE','no-commit');
          if(name==='database') {
            const e=ctx.enrollment,database=environment.database;
            if(loaded.invalid)stop('DB_UNKNOWN','enrollment-invalid');
            if(!e)stop('DB_UNKNOWN','not-enrolled');
            if(e.port!==database.port||e.database!==database.name||e.user!==database.user)stop('DB_UNKNOWN','enrollment-stale');
            const proof=await proveDatabase(e,database,true);
            ctx.connection=proof.connection;ctx.proof=proof;
            if(proof.systemIdentifier!==e.systemIdentifier)stop('DB_UNKNOWN','fingerprint');
            if(proof.name!==e.database)stop('DB_UNKNOWN','name');
            out={status:'green'};
          }
          else if(name==='migrations')out={status:'green',...await migrationsStep(ctx,environment.migrations)};
          else out={status:'green',...await accountsStep(ctx,environment.accounts)};
          steps.push({step:name,...out});
        }catch(error) {
          if(!(error instanceof Stop))throw error;
          failed=error;steps.push({step:name,status:'failed',cause:error.cause,...(error.detail?{detail:error.detail}:{}),...error.extra});
        }
      }
      // The proofs again, at the end: the base must be the same, reached the same way.
      if(!failed&&ctx.proof) {
        try{
          const after=await outside(ctx.enrollment,environment.database,true);
          await correlate(ctx.enrollment,environment.database,after.containerId,ctx.proof.appName);
          if(after.listener!==ctx.proof.before.listener||after.containerId!==ctx.proof.before.containerId||after.image!==ctx.proof.before.image)stop('DB_NOT_LOCAL','changed');
        }catch(error) {
          if(!(error instanceof Stop))throw error;
          failed=error;
          // Whatever failed the second time, the base is no longer the one proved: its cause, and the detail « changed ».
          Object.assign(steps.find(s=>s.step==='database'),{status:'failed',cause:error.cause,detail:'changed'});
        }
      }
      const green=STEPS.every(name=>steps.find(s=>s.step===name)?.status==='green');
      return await save(key,{...result,status:green?'green':failed?'failed':'incomplete',green,cause:failed?.cause??null,steps});
    }finally{
      try{await ctx.connection?.close();}catch{}
    }
    });
  }
  async function save(key,result) {
    await privateDir(dirname(dirOf(key)));await privateDir(dirOf(key));
    await writeJSON(join(dirOf(key),'last.json'),result,value=>value);
    return result;
  }

  // Done once by the user, never from an agent (decisions 70 and 76): the container, its image, the docker program, its
  // socket, the identity of the engine behind it (docker info: ID, OperatingSystem, Name) and a fingerprint of the base.
  async function enroll(input={}) {
    if(env[AGENT_MARK])fail('AGENT_SESSION','Refused: environment-enroll is for le propriétaire only; a session of an agent launched by Mission Control cannot use it. Nothing is written.');
    const key=keyOf(input.project);
    const container=input.container,docker=input.docker??'/usr/local/bin/docker',socket=input.socket??join(userInfo().homedir,'.docker','run','docker.sock');
    if(typeof container!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(container))fail('INVALID_ARGUMENT','A container name or id is required.');
    for(const path of [docker,socket])if(typeof path!=='string'||!isAbsolute(path)||/[\x00-\x1f]/.test(path))fail('INVALID_ARGUMENT','The docker program and its socket are absolute paths.');
    const config=await loadConfig(),project=config.projects.find(p=>p.key===key);
    if(!project)fail('NOT_FOUND','No configured project uses this key.');
    if(config.version!==2||!project.environment?.database)fail('INVALID_ARGUMENT','The project declares no environment database.');
    const environment=validateEnvironment(project.environment,{repos:project.repos.length}),database=environment.database;
    return await locked(key,async()=>{
    let connection=null;
    try {
      const candidate={docker,socket,container};
      const proof=await proveDatabase(candidate,database,false);connection=proof.connection;
      if(proof.name!==database.name)stop('DB_UNKNOWN','name');
      const record={version:1,docker,socket,engine:proof.before.engine,containerId:proof.before.containerId,image:proof.before.image,port:database.port,database:database.name,user:database.user,systemIdentifier:proof.systemIdentifier,at:new Date().toISOString()};
      if(!validEnrollment(record))stop('DB_UNKNOWN','enrollment-invalid');
      await writeJSON(join(dirOf(key),'enrollment.json'),record,value=>value);
      return {status:'enrolled',project:key,enrollment:sha256(canonical(record))};
    }catch(error) {
      if(!(error instanceof Stop))throw error;
      return {status:'refused',project:key,cause:error.cause,...(error.detail?{detail:error.detail}:{})};
    }finally{try{await connection?.close();}catch{}}
    });
  }
  const read=async(input={})=>{const key=keyOf(input.project);return await readJSON(join(dirOf(key),'last.json'),null);};
  return {check,enroll,read};
}
