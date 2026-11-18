// M6 (b): a project whose environment check runs for real (src/environment-check.mjs) against fakes only: fake docker,
// lsof and ps executables, a fake PostgreSQL engine on loopback, a throwaway Git repository with Drizzle migrations.
// Never a real base, container, server or docker. The same fixture as tests/environment-check.test.mjs (`setup`), with a
// cleanup callback instead of a node:test context, so that the page probe (tests/helpers/environment-page-probe.mjs)
// can build it too. `after` registers a cleanup.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createEnvironmentCheck, QUERIES, accountQuery } from '../../src/environment-check.mjs';
import { createStorage } from '../../src/state.mjs';
import { createCommands } from '../../src/commands.mjs';
import { exec } from '../../src/common.mjs';
import { configV2 } from './config-v2-fixture.mjs';
import { fakePostgres, fakeTools } from './environment-fakes.mjs';
import { sampleEnvironment } from './environment-sample.mjs';

const GIT=process.env.FABRIQUE_CONSOLE_TEST_GIT??'git';
export const git=(cwd,...args)=>execFileSync(GIT,['-C',cwd,...args],{encoding:'utf8',env:{...process.env,GIT_AUTHOR_NAME:'t',GIT_AUTHOR_EMAIL:'t@example.invalid',GIT_COMMITTER_NAME:'t',GIT_COMMITTER_EMAIL:'t@example.invalid'}}).trim();
const HEX=c=>c.repeat(64);
export const WHEN=[1700000000000,1700000100000,1700000200000];
const journal=entries=>JSON.stringify({version:'7',dialect:'postgresql',entries:entries.map(([idx,when,tag])=>({idx,version:'7',when,tag,breakpoints:true}))});

function makeRepo(dir) {
  const repo=join(dir,'repo');mkdirSync(join(repo,'drizzle','meta'),{recursive:true});
  git(dir,'init','-q','-b','main',repo);
  writeFileSync(join(repo,'drizzle','meta','_journal.json'),journal(WHEN.map((w,i)=>[i,w,`000${i}_m${i}`])));
  for(let i=0;i<3;i++)writeFileSync(join(repo,'drizzle',`000${i}_m${i}.sql`),`CREATE TABLE t${i}(id int);\n`);
  git(repo,'add','-A');git(repo,'commit','-q','-m','init');
  return repo;
}

// `db` sets the fake base (rows: the migrations applied; accounts: the identifiers present; auth). `set` changes the
// scenario of the fake executables (dockerDown, socketAuth, engine…), `configure` the environment of the project.
export async function environmentWorld(after,{environment=sampleEnvironment(),db={}}={}) {
  const dir=realpathSync(mkdtempSync(join(tmpdir(),'mc-env-w-')));after(()=>rmSync(dir,{recursive:true,force:true}));
  const repo=makeRepo(dir);
  const state={systemId:'7301234567890123456',name:'beta',readOnly:'on',table:true,rows:[...WHEN],accounts:['po@example.invalid','dev@example.invalid'],...db};
  const tools=join(dir,'tools');mkdirSync(tools);
  const handler=(sql,params)=>{
    if(sql===QUERIES.readOnly)return [[state.readOnly]];
    if(sql===QUERIES.identity)return [[state.systemId,state.name]];
    if(sql===QUERIES.journalTable)return [[state.table?'t':'f']];
    if(sql===QUERIES.journalRows)return [[String(state.rows.length),String(state.rows.length?Math.max(...state.rows):0)]];
    if(sql===accountQuery({schema:'public',table:'user',column:'email'}))return [[state.accounts.includes(params[0])?'1':'0']];
    return {error:{code:'42601',message:'unexpected query'}};
  };
  const pg=await fakePostgres({dir:tools,handler,auth:()=>state.auth??'trust'});after(pg.close);
  if(environment?.database)environment.database.port=pg.port;
  const socket=join(dir,'docker.sock');
  const scenario={socket,container:{id:HEX('c'),name:'beta-db',image:'sha256:'+HEX('a'),running:true,ports:{'5432/tcp':[{HostIp:'127.0.0.1',HostPort:String(pg.port)}]}},
    engine:{ID:'ENGINE-LOCAL-0001',OperatingSystem:'Docker Desktop',Name:'docker-desktop'},
    listeners:[{pid:4242,command:'com.docker.backend',name:'127.0.0.1:'+pg.port}],processes:{4242:'/Applications/Docker.app/Contents/MacOS/com.docker.backend'},top:['postgres','postgres','postgres']};
  const fakes=fakeTools(tools,scenario);
  const config=configV2();config.projects[0].repos.splice(1);config.projects[0].repos[0].path=repo;
  if(environment)config.projects[0].environment=environment;
  const root=join(dir,'state');mkdirSync(root);writeFileSync(join(root,'config.json'),JSON.stringify(config));
  const {loadConfig}=createStorage({root}),{invoke}=createCommands({exec});
  const check=createEnvironmentCheck({root,loadConfig,invoke,env:{},tools:{lsof:fakes.lsof,ps:fakes.ps}});
  const enroll=()=>check.enroll({project:'example',container:'beta-db',docker:fakes.docker,socket});
  const configure=change=>{const next=JSON.parse(readFileSync(join(root,'config.json'),'utf8'));change(next.projects[0]);writeFileSync(join(root,'config.json'),JSON.stringify(next));};
  let current=structuredClone(scenario);
  return {dir,repo,root,pg,state,fakes,check,enroll,loadConfig,configure,
    set:change=>{const next=structuredClone(current);change(next);current=next;fakes.set(next);},
    reset:()=>{current=structuredClone(scenario);fakes.set(current);},
    commit:(change,message='change')=>{change(repo);git(repo,'add','-A');git(repo,'commit','-q','-m',message);}};
}
