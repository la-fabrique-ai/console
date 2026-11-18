#!/usr/bin/env node
// The native check of the environment check (M6, approach § 7): what the fakes of the suite cannot show, shown once by
// the user on a DISPOSABLE repository and a DISPOSABLE PostgreSQL container (never the base of a real project). Never
// run by the suite, never by an agent:
//
//   node scripts/environment-native-check.mjs --root <throwaway state folder> --project <key> --container <name>
//        [--docker /usr/local/bin/docker] [--socket ~/.docker/run/docker.sock] [--expect MIGRATIONS_PENDING|green]
//
// <root>/config.json is a configuration v2 of Mission Control naming the disposable repository, with an `environment`
// whose database is the disposable container (docs/environnement.md). The script never starts a server, never runs a
// migration and never writes in the container: it reads.
//
// What it shows, each as a word (never the output of a program):
//  1. listener: the owner of the published port of the container is Docker Desktop by its real executable (lsof txt),
//               on 127.0.0.1 only.
//  2. top:      `docker top <id> -o pid,comm` on the official image names only postgres.
//  3. inside:   postmaster.pid gives the port and the socket folder; psql -X -w in the fixed environment sees the
//               connection of the script.
//  4. identity: pg_control_system() is readable by the user of the configuration.
//  5. cycle:    environment-enroll, then environment-check: the closed result (status, cause, detail of each step),
//               judged against --expect. MIGRATIONS_PENDING (the default) expects migrations left pending on purpose
//               in the disposable repository: database green, migrations MIGRATIONS_PENDING with their number,
//               accounts not run. green expects the three steps green.
//  6. dockerConfig: after all of it, the empty DOCKER_CONFIG folder shared with the module (dockerConfigFolder) is
//               still empty: the docker client wrote nothing there.
// There is no server step (decision 95) and no sandbox probe: the option --loopback is not built, nothing here checks it.
//
// Exit 0: every point above answered as expected (verdict, below); 1: something differs (the JSON on stdout says what,
// in `failed`); 2: a wrong use, or the script could not run to its end.
import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, realpathSync } from 'node:fs';
import { join, isAbsolute } from 'node:path';
import { userInfo } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createEnvironmentCheck, correlationCommand, dockerConfigFolder } from '../src/environment-check.mjs';
import { createStorage } from '../src/state.mjs';
import { createCommands } from '../src/commands.mjs';
import { exec } from '../src/common.mjs';
import { pgConnect } from '../src/environment-pg.mjs';

const EXPECT=['MIGRATIONS_PENDING','green'];
export function options(argv) {
  const out={root:null,project:null,container:null,docker:'/usr/local/bin/docker',socket:join(userInfo().homedir,'.docker','run','docker.sock'),expect:'MIGRATIONS_PENDING'};
  for(let i=0;i<argv.length;i++){
    const a=argv[i],next=()=>{const v=argv[++i];if(v===undefined)throw new Error('missing value for '+a);return v;};
    if(a==='--root')out.root=next();else if(a==='--project')out.project=next();else if(a==='--container')out.container=next();
    else if(a==='--docker')out.docker=next();else if(a==='--socket')out.socket=next();else if(a==='--expect')out.expect=next();
    else throw new Error('unknown argument '+a);
  }
  if(!out.root||!isAbsolute(out.root)||!out.project||!out.container)throw new Error('--root (absolute), --project and --container are required');
  if(!EXPECT.includes(out.expect))throw new Error('--expect takes '+EXPECT.join(' or '));
  return out;
}

// The cycle as expected: its steps, in order, with the statuses and causes that expectation names.
function cycleAsExpected(cycle,expect) {
  const steps=Array.isArray(cycle?.steps)?cycle.steps:[];
  const at=name=>steps.find(s=>s.step===name);
  if(steps.map(s=>s.step).join(',')!=='database,migrations,accounts'||at('database').status!=='green')return false;
  if(expect==='green')return cycle.status==='green'&&cycle.cause===null&&at('migrations').status==='green'&&at('accounts').status==='green';
  const m=at('migrations');
  return cycle.status==='failed'&&cycle.cause==='MIGRATIONS_PENDING'&&m.status==='failed'&&m.cause==='MIGRATIONS_PENDING'&&Number.isInteger(m.pending)&&m.pending>0&&at('accounts').status==='not-run';
}
// Every result of the report, each judged: the exit code is 0 only when none failed.
export function verdict(report,{expect}) {
  const checks=[
    ['container',report?.container==='found'],
    ['listener.owners',report?.listener?.owners===1],
    ['listener.dockerDesktop',report?.listener?.dockerDesktop===true],
    ['listener.loopbackOnly',report?.listener?.loopbackOnly===true],
    ['top.onlyPostgres',report?.top?.onlyPostgres===true],
    ['inside.port',report?.inside?.port===true],
    ['inside.socket',report?.inside?.socket===true],
    ['inside.correlation',report?.inside?.correlation===true],
    ['identity',report?.identity===true],
    ['connection',report?.connection===null],
    ['enroll',report?.enroll?.status==='enrolled'],
    ['cycle',cycleAsExpected(report?.cycle,expect)],
    ['dockerConfig.empty',report?.dockerConfig?.empty===true],
  ];
  const failed=checks.filter(([,ok])=>!ok).map(([name])=>name);
  return {ok:failed.length===0,failed};
}

// The same DOCKER_CONFIG as the module: the empty folder of the state folder, which must stay empty (review 2, m9).
const docker=(o,args)=>spawnSync('/usr/bin/env',['-i','DOCKER_CONFIG='+dockerConfigFolder(o.root),o.docker,'--host','unix://'+o.socket,...args],{encoding:'utf8',timeout:30000});
const emptyFolder=path=>{try{return readdirSync(path).length===0;}catch{return false;}};

async function main() {
  const o=options(process.argv.slice(2)),report={connection:null};
  const {loadConfig}=createStorage({root:o.root}),config=await loadConfig(),project=config.projects.find(p=>p.key===o.project);
  const database=project?.environment?.database;
  if(!database)throw new Error('the project declares no environment database');
  mkdirSync(dockerConfigFolder(o.root),{recursive:true,mode:0o700});
  if(!emptyFolder(dockerConfigFolder(o.root)))throw new Error('the DOCKER_CONFIG folder of the state folder is not empty');
  const id=docker(o,['inspect','--format','{{.Id}}',o.container]).stdout.trim();
  report.container=/^[a-f0-9]{64}$/.test(id)?'found':'missing';
  const lsof=spawnSync('/usr/sbin/lsof',['-nP','-iTCP:'+database.port,'-sTCP:LISTEN','-Fpn','+c','0'],{encoding:'utf8',timeout:15000}).stdout.split('\n');
  const pids=[...new Set(lsof.filter(l=>l.startsWith('p')).map(l=>l.slice(1)))],names=lsof.filter(l=>l.startsWith('n')).map(l=>l.slice(1));
  // The real executable of the owner (first text file of the process), never argv[0], as the module does.
  const owner=pids.length===1?(spawnSync('/usr/sbin/lsof',['-a','-p',pids[0],'-d','txt','-Fn'],{encoding:'utf8',timeout:15000}).stdout??'').split('\n').find(l=>l.startsWith('n'))?.slice(1)??'':'';
  report.listener={owners:pids.length,dockerDesktop:owner.startsWith('/Applications/Docker.app/Contents/'),loopbackOnly:names.length>0&&names.every(n=>n==='127.0.0.1:'+database.port)};
  const top=docker(o,['top',id,'-o','pid,comm']).stdout.trim().split('\n').slice(1);
  report.top={rows:top.length,onlyPostgres:top.length>0&&top.every(l=>l.trim().split(/\s+/).pop()==='postgres')};
  const pidFile=docker(o,['exec','-u','postgres',id,'/usr/bin/env','-i','/usr/bin/head','-n','5',database.dataDir+'/postmaster.pid']).stdout.split('\n');
  report.inside={port:/^\d+$/.test(pidFile[3]?.trim()??''),socket:/^\//.test(pidFile[4]?.trim()??''),correlation:false};
  report.identity=false;
  const app='mc-env-'+'0'.repeat(24);
  let connection=null;
  try{
    connection=await pgConnect({port:database.port,user:database.user,database:database.name,applicationName:app});
    const seen=docker(o,correlationCommand({containerId:id,socketDir:pidFile[4]?.trim()??'',port:pidFile[3]?.trim()??'',user:database.user,name:database.name,appName:app})).stdout.trim();
    report.inside.correlation=/^\d+$/.test(seen)&&Number(seen)>=1;
    try{const [row]=await connection.query('SELECT system_identifier::text, current_database() FROM pg_control_system()');report.identity=/^\d+$/.test(row?.[0]??'');}catch{report.identity=false;}
  }catch(error){report.connection=error?.pg??'failed';}
  finally{await connection?.close();}
  const {invoke}=createCommands({exec});
  const check=createEnvironmentCheck({root:o.root,loadConfig,invoke,env:process.env});
  const enrolled=await check.enroll({project:o.project,container:o.container,docker:o.docker,socket:o.socket});
  report.enroll={status:enrolled.status,cause:enrolled.cause??null,detail:enrolled.detail??null};
  const result=await check.check({project:o.project});
  report.cycle={status:result.status,cause:result.cause,steps:result.steps.map(s=>({step:s.step,status:s.status,cause:s.cause??null,detail:s.detail??null,pending:s.pending??null}))};
  // After every docker call of the script and of the cycle: the client wrote nothing in DOCKER_CONFIG (otherwise each
  // later check would fail with docker-config).
  report.dockerConfig={empty:emptyFolder(dockerConfigFolder(o.root))};
  const judged=verdict(report,{expect:o.expect});
  console.log(JSON.stringify({...report,expect:o.expect,failed:judged.failed},null,1));
  return judged.ok?0:1;
}

if(process.argv[1]&&realpathSync(process.argv[1])===fileURLToPath(import.meta.url)) {
  try{process.exitCode=await main();}
  catch(error){console.error('environment-native-check: '+String(error?.message??error));process.exitCode=2;}
}
