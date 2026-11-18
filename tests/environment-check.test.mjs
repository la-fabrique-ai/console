// M6 (a): the environment check (src/environment-check.mjs), with fake executables (docker, lsof, ps) and a fake
// PostgreSQL engine on loopback: never a real base, a real container, a real server or the real docker.
// Families of the approach (workflow-v2-M6-approche-2.md § 6): 1 configuration (check side), 2 locality, 3 read only,
// 4 migrations, 5 accounts, 8 canary, 9 interruption; plus the commit checked frozen and bound to the result (review,
// point 1). No server step in v1 (decision 95): family 10 (tree and node_modules) is parked with the folder of that
// step on the local branch wip/m6-server-folder.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync, lstatSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createEnvironmentCheck, greenFor, QUERIES, accountQuery, correlationQuery, CAUSES, STEPS } from '../src/environment-check.mjs';
import { createStorage } from '../src/state.mjs';
import { createCommands } from '../src/commands.mjs';
import { exec } from '../src/common.mjs';
import { operationLock } from '../src/operation-lock.mjs';
import { configV2 } from './helpers/config-v2-fixture.mjs';
import { fakePostgres, fakeTools } from './helpers/environment-fakes.mjs';
import { sampleEnvironment } from './helpers/environment-sample.mjs';
// The markers of the checks under way (review 3): one `.running-<id>` per check, plus an old `.running`.
const markers=dir=>readdirSync(dir).filter(n=>n==='.running'||/^\.running-[a-f0-9]{24}$/.test(n)).sort();

const GIT=process.env.FABRIQUE_CONSOLE_TEST_GIT??'git';
const git=(cwd,...args)=>execFileSync(GIT,['-C',cwd,...args],{encoding:'utf8',env:{...process.env,GIT_AUTHOR_NAME:'t',GIT_AUTHOR_EMAIL:'t@example.invalid',GIT_COMMITTER_NAME:'t',GIT_COMMITTER_EMAIL:'t@example.invalid'}}).trim();
const HEX=c=>c.repeat(64);
const SYSTEM_ID='7301234567890123456';
const journal=entries=>JSON.stringify({version:'7',dialect:'postgresql',entries:entries.map(([idx,when,tag])=>({idx,version:'7',when,tag,breakpoints:true}))});
const WHEN=[1700000000000,1700000100000,1700000200000];

function makeRepo(dir,{canary}={}) {
  const repo=join(dir,'repo');mkdirSync(join(repo,'drizzle','meta'),{recursive:true});
  git(dir,'init','-q','-b','main',repo);
  writeFileSync(join(repo,'drizzle','meta','_journal.json'),journal(WHEN.map((w,i)=>[i,w,`000${i}_m${i}`])));
  for(let i=0;i<3;i++)writeFileSync(join(repo,'drizzle',`000${i}_m${i}.sql`),`CREATE TABLE t${i}(id int);\n`);
  // A script that would migrate, if anything ran it: it never runs.
  writeFileSync(join(repo,'package.json'),JSON.stringify({name:'p',scripts:{'db:migrate':'node migrate.js',dev:'node server.js'}}));
  writeFileSync(join(repo,'migrate.js'),`require('fs').writeFileSync(${JSON.stringify(join(dir,'MIGRATED'))},'1')`);
  writeFileSync(join(repo,'pnpm-lock.yaml'),'lockfileVersion: 9.0\n');
  writeFileSync(join(repo,'.gitignore'),'node_modules\n.env\n');
  git(repo,'add','-A');git(repo,'commit','-q','-m','init');
  // Untracked: the dependencies, and a .env the check must never read nor copy.
  mkdirSync(join(repo,'node_modules','next','dist','bin'),{recursive:true});mkdirSync(join(repo,'node_modules','.bin'));
  writeFileSync(join(repo,'node_modules','next','dist','bin','next'),'console.log("next")\n');
  writeFileSync(join(repo,'node_modules','next','package.json'),'{"name":"next","version":"1.0.0"}');
  symlinkSync('../next/dist/bin/next',join(repo,'node_modules','.bin','next'));
  writeFileSync(join(repo,'.env'),`DATABASE_URL=${'postgres:'}//u:${canary??'pw'}@db/x\nSECRET=${canary??'s'}\n`);
  return repo;
}

// A whole fixture: a repository, the configuration of Mission Control, the fakes, the check.
async function setup(t,{environment=sampleEnvironment(),repos=1,canary=null,db={}}={}) {
  const dir=realpathSync(mkdtempSync(join(tmpdir(),'mc-env-t-')));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const repo=makeRepo(dir,{canary});
  const state={systemId:SYSTEM_ID,name:'beta',readOnly:'on',table:true,rows:WHEN.map(w=>w),accounts:['po@example.invalid','dev@example.invalid'],...db};
  const tools=join(dir,'tools');mkdirSync(tools);
  const handler=(sql,params)=>{
    if(sql===QUERIES.readOnly)return [[state.readOnly]];
    if(sql===QUERIES.identity)return [[state.systemId,state.name]];
    if(sql===QUERIES.journalTable)return [[state.table?'t':'f']];
    if(sql===QUERIES.journalRows)return [[String(state.rows.length),String(state.rows.length?Math.max(...state.rows):0)]];
    if(sql===accountQuery({schema:'public',table:'user',column:'email'}))return [[state.accounts.includes(params[0])?'1':'0']];
    return {error:{code:'42601',message:'unexpected query'}};
  };
  const pg=await fakePostgres({dir:tools,handler,canary,auth:()=>state.auth??'trust'});t.after(pg.close);
  if(environment?.database)environment.database.port=pg.port;
  const socket=join(dir,'docker.sock');
  const scenario={canary,socket,container:{id:HEX('c'),name:'beta-db',image:'sha256:'+HEX('a'),running:true,ports:{'5432/tcp':[{HostIp:'127.0.0.1',HostPort:String(pg.port)}]}},
    engine:{ID:'ENGINE-LOCAL-0001',OperatingSystem:'Docker Desktop',Name:'docker-desktop'},
    listeners:[{pid:4242,command:'com.docker.backend',name:'127.0.0.1:'+pg.port}],processes:{4242:'/Applications/Docker.app/Contents/MacOS/com.docker.backend'},top:['postgres','postgres','postgres']};
  const fakes=fakeTools(tools,scenario);
  const config=configV2();config.projects[0].repos.splice(repos);config.projects[0].repos[0].path=repo;
  if(environment)config.projects[0].environment=environment;
  const root=join(dir,'state');mkdirSync(root);writeFileSync(join(root,'config.json'),JSON.stringify(config));
  const {loadConfig}=createStorage({root}),{invoke}=createCommands({exec});
  const check=createEnvironmentCheck({root,loadConfig,invoke,env:{},tools:{lsof:fakes.lsof,ps:fakes.ps}});
  const enroll=()=>check.enroll({project:'example',container:'beta-db',docker:fakes.docker,socket});
  return {dir,repo,root,pg,state,fakes,scenario,check,enroll,set:change=>{const next=structuredClone(scenario);change(next);fakes.set(next);}};
}
const step=(result,name)=>result.steps.find(s=>s.step===name);

// ---- 1. Configuration, the check side: never green.

test('no environment: « not declared », never green',async t=>{
  const f=await setup(t,{environment:null});
  const result=await f.check.check({project:'example'});
  assert.equal(result.status,'not-declared');assert.equal(result.green,false);
  assert.ok(result.steps.every(s=>s.status==='not-declared'));
});

test('a partial environment (database alone): the database is checked, the rest « not declared », never green',async t=>{
  const f=await setup(t,{environment:{database:sampleEnvironment().database}});
  await f.enroll();
  const result=await f.check.check({project:'example'});
  assert.equal(step(result,'database').status,'green',JSON.stringify(result));
  for(const name of ['migrations','accounts'])assert.equal(step(result,name).status,'not-declared');
  assert.equal(result.green,false);assert.equal(result.status,'incomplete');
});

test('an invalid environment or a project of two repositories: « invalid », never green, nothing run',async t=>{
  const f=await setup(t);
  const config=JSON.parse(readFileSync(join(f.root,'config.json'),'utf8'));config.projects[0].environment.accounts.table='x"--';
  writeFileSync(join(f.root,'config.json'),JSON.stringify(config));
  const result=await f.check.check({project:'example'});
  assert.equal(result.status,'invalid');assert.equal(result.green,false);
  assert.deepEqual(f.fakes.calls(),[]);assert.equal(f.pg.startups.length,0);
  const g=await setup(t,{repos:2});
  const two=await g.check.check({project:'example'});
  assert.equal(two.status,'invalid');assert.equal(two.green,false);
});

test('a full environment, all proofs given: green with database, migrations and accounts (no server step, decision 95)',async t=>{
  const f=await setup(t);await f.enroll();
  const result=await f.check.check({project:'example'});
  assert.deepEqual(STEPS,['database','migrations','accounts']);
  assert.deepEqual(result.steps.map(s=>[s.step,s.status]),[['database','green'],['migrations','green'],['accounts','green']],JSON.stringify(result));
  assert.equal(result.green,true);assert.equal(result.status,'green');assert.equal(result.cause,null);
  assert.equal(result.sha,git(f.repo,'rev-parse','HEAD'));
  assert.match(result.fingerprint,/^[a-f0-9]{64}$/);assert.match(result.enrollment,/^[a-f0-9]{64}$/);
  assert.deepEqual(JSON.parse(readFileSync(join(f.root,'environment','example','last.json'),'utf8')),JSON.parse(JSON.stringify(result)));
  assert.equal(greenFor(result,{sha:result.sha,fingerprint:result.fingerprint,enrollment:result.enrollment}),true);
  assert.ok(!f.fakes.calls().some(c=>c.tool==='ps'),'argv[0] is never asked: the owner is known by its real executable');
});

test('decision 95: the check prepares no folder and never reads node_modules: green without them',async t=>{
  const f=await setup(t);await f.enroll();
  rmSync(join(f.repo,'node_modules'),{recursive:true});
  const before=readdirSync('/private/tmp').filter(name=>name.startsWith('mc-env-example'));
  const result=await f.check.check({project:'example'});
  assert.equal(result.green,true,JSON.stringify(result));
  assert.deepEqual(readdirSync('/private/tmp').filter(name=>name.startsWith('mc-env-example')),before);
  assert.ok(!f.fakes.calls().some(c=>c.args.some(a=>/node_modules|ls-tree/.test(a))));
});

test('every cause given is one of the closed list',()=>{
  assert.deepEqual([...CAUSES].sort(),['ACCOUNT_MISSING','DB_ABSENT','DB_AHEAD','DB_AUTH_UNSUPPORTED','DB_NOT_LOCAL','DB_UNKNOWN','INTERRUPTED','MIGRATIONS_PENDING','MIGRATIONS_UNREADABLE']);
});

// ---- 2. Locality: a table; in every case the database fails, nothing after it runs.

const LOCALITY=[
  ['not enrolled','DB_UNKNOWN','not-enrolled',null,{enroll:false}],
  ['container absent','DB_ABSENT','container-absent',s=>{s.container=null;}],
  ['container stopped','DB_ABSENT','container-stopped',s=>{s.container.running=false;}],
  ['the engine unreachable','DB_ABSENT','docker-unreachable',s=>{s.dockerDown=true;}],
  ['another image','DB_NOT_LOCAL','image-other',s=>{s.container.image='sha256:'+HEX('b');}],
  ['port published on 0.0.0.0','DB_NOT_LOCAL','port-public',s=>{s.container.ports['5432/tcp'][0].HostIp='0.0.0.0';}],
  ['port published on all addresses','DB_NOT_LOCAL','port-public',s=>{s.container.ports['5432/tcp'][0].HostIp='';}],
  ['another port published too','DB_NOT_LOCAL','port-other',s=>{s.container.ports['8080/tcp']=[{HostIp:'127.0.0.1',HostPort:'8080'}];}],
  ['the listener is ssh','DB_NOT_LOCAL','listener-foreign',s=>{s.listeners[0].command='ssh';s.processes[4242]='/usr/bin/ssh';}],
  ['the listener is socat in Docker\'s name','DB_NOT_LOCAL','listener-foreign',s=>{s.processes[4242]='/opt/homebrew/bin/socat';}],
  ['the listener forges Docker\'s path as argv[0] (exec -a): its real executable decides (review 2, m1)','DB_NOT_LOCAL','listener-foreign',s=>{s.processes[4242]='/opt/homebrew/bin/socat';s.argv0={4242:'/Applications/Docker.app/Contents/MacOS/com.docker.backend'};}],
  ['two listeners','DB_NOT_LOCAL','listener-many',s=>{s.listeners.push({pid:4343,command:'socat',name:'127.0.0.1:'+s.listeners[0].name.split(':')[1]});s.processes[4343]='/opt/homebrew/bin/socat';}],
  ['a listener on all addresses','DB_NOT_LOCAL','listener-public',s=>{s.listeners[0].name='*:'+s.listeners[0].name.split(':')[1];}],
  ['no listener','DB_ABSENT','listener-none',s=>{s.listeners=[];}],
  ['another Docker engine behind the enrolled socket (review 2, I1)','DB_NOT_LOCAL','engine-other',s=>{s.engine={...s.engine,ID:'ENGINE-OTHER-0002'};}],
  ['the engine renamed (review 2, I1)','DB_NOT_LOCAL','engine-other',s=>{s.engine={...s.engine,Name:'cloud-builder'};}],
  ['an engine that is not Docker Desktop: remote (review 2, I1)','DB_NOT_LOCAL','engine-remote',s=>{s.engine={...s.engine,OperatingSystem:'Ubuntu 24.04.1 LTS'};}],
  ['a relay in the container','DB_NOT_LOCAL','relay',s=>{s.top=['postgres','socat','postgres'];}],
  ['the connection not seen from inside','DB_NOT_LOCAL','correlation',s=>{s.correlation=false;}],
  ['the socket of the container asks a password: not a locality failure (review 2, m8)','DB_AUTH_UNSUPPORTED','socket',s=>{s.socketAuth='password';}],
  ['the socket of the container in peer for another user (review 2, m8)','DB_AUTH_UNSUPPORTED','socket',s=>{s.socketAuth='peer';}],
  ['another base (fingerprint)','DB_UNKNOWN','fingerprint',null,{db:{systemId:'1111'}}],
  ['another base name','DB_UNKNOWN','name',null,{db:{name:'other'}}],
  ['a session not in read only','DB_UNKNOWN','read-only',null,{db:{readOnly:'off'}}],
  ['a password asked','DB_AUTH_UNSUPPORTED',null,null,{db:{auth:'md5'}}],
];
for(const [why,cause,detail,change,options={}] of LOCALITY)test(`locality: ${why} → ${cause}`,async t=>{
  const f=await setup(t);
  if(options.enroll!==false)assert.equal((await f.enroll()).status,'enrolled');
  if(change)f.set(change);
  if(options.db)Object.assign(f.state,options.db);
  const result=await f.check.check({project:'example'});
  const db=step(result,'database');
  assert.equal(db.status,'failed',JSON.stringify(result));assert.equal(db.cause,cause,JSON.stringify(db));
  if(detail)assert.equal(db.detail,detail);
  for(const name of ['migrations','accounts'])assert.equal(step(result,name).status,'not-run',name);
  assert.equal(result.green,false);assert.equal(result.cause,cause);
});

test('locality: a hostile DOCKER_HOST or context of the caller never reaches docker; the engine is the enrolled socket, DOCKER_CONFIG empty',async t=>{
  const f=await setup(t);
  const saved={host:process.env.DOCKER_HOST,context:process.env.DOCKER_CONTEXT};
  process.env.DOCKER_HOST='tcp://192.0.2.1:2375';process.env.DOCKER_CONTEXT='hostile';
  t.after(()=>{for(const [k,v] of [['DOCKER_HOST',saved.host],['DOCKER_CONTEXT',saved.context]])if(v===undefined)delete process.env[k];else process.env[k]=v;});
  await f.enroll();
  const result=await f.check.check({project:'example'});
  assert.equal(step(result,'database').status,'green',JSON.stringify(result));
  const docker=f.fakes.calls().filter(c=>c.tool==='docker');
  assert.ok(docker.length>4);
  for(const call of docker) {
    assert.equal(call.dockerHost,null);assert.equal(call.args[0],'--host');assert.equal(call.args[1],'unix://'+f.scenario.socket);
    assert.ok(call.dockerConfig&&readdirSync(call.dockerConfig).length===0,'DOCKER_CONFIG must be an empty folder');
    assert.deepEqual(call.env.filter(name=>!['DOCKER_CONFIG','__CF_USER_TEXT_ENCODING'].includes(name)),[],'nothing of the caller reaches docker: '+call.env.join(' '));
  }
});

test('locality: the proofs are taken again after the other steps; a change between the two is DB_NOT_LOCAL',async t=>{
  const f=await setup(t);await f.enroll();
  // The listener changes owner once the first proofs are taken (at the first account query).
  let changed=false;const handler=f.pg;void handler;
  const original=f.state.accounts;f.state.accounts=new Proxy(original,{get(target,key){if(key==='includes'&&!changed){changed=true;f.set(s=>{s.listeners[0].pid=5555;s.processes[5555]='/Applications/Docker.app/Contents/MacOS/com.docker.backend';});}return Reflect.get(target,key);}});
  const result=await f.check.check({project:'example'});
  const db=step(result,'database');
  assert.equal(db.status,'failed',JSON.stringify(result));assert.equal(db.cause,'DB_NOT_LOCAL');assert.equal(db.detail,'changed');
  assert.equal(result.green,false);
});

// ---- The enrollment is validated when loaded (review 2, m2): a field missing or malformed is never skipped.

const ENROLLMENT_BROKEN=[
  ['the container id missing',e=>{delete e.containerId;}],
  ['the image missing',e=>{delete e.image;}],
  ['the engine missing',e=>{delete e.engine;}],
  ['an engine field missing',e=>{delete e.engine.id;}],
  ['the container id not hexadecimal',e=>{e.containerId='beta-db';}],
  ['the image not a sha256',e=>{e.image='postgres:17';}],
  ['the fingerprint not hexadecimal',e=>{e.systemIdentifier='7301234567890123456';}],
  ['a relative docker program',e=>{e.docker='docker';}],
  ['a docker program with a control character',e=>{e.docker+='\n';}],
  ['a relative socket',e=>{e.socket='docker.sock';}],
  ['a port that is a string',e=>{e.port=String(e.port);}],
  ['a port out of range',e=>{e.port=70000;}],
  ['the base name missing',e=>{delete e.database;}],
  ['an unknown field',e=>{e.extra=true;}],
  ['another version',e=>{e.version=2;}],
];
for(const [why,change] of ENROLLMENT_BROKEN)test(`enrollment loaded: ${why} → DB_UNKNOWN enrollment-invalid, docker never run`,async t=>{
  const f=await setup(t);assert.equal((await f.enroll()).status,'enrolled');
  const path=join(f.root,'environment','example','enrollment.json'),record=JSON.parse(readFileSync(path,'utf8'));
  change(record);writeFileSync(path,JSON.stringify(record));
  const before=f.fakes.calls().length;
  const result=await f.check.check({project:'example'});
  const db=step(result,'database');
  assert.deepEqual([db.status,db.cause,db.detail],['failed','DB_UNKNOWN','enrollment-invalid'],JSON.stringify(result));
  assert.equal(result.enrollment,null);assert.equal(result.green,false);
  assert.equal(f.fakes.calls().length,before,'a program was run from an invalid enrollment');
});

test('enrollment loaded: not JSON, or not an object → DB_UNKNOWN enrollment-invalid',async t=>{
  for(const text of ['[]','"x"','null']) {
    const f=await setup(t);await f.enroll();
    writeFileSync(join(f.root,'environment','example','enrollment.json'),text);
    const db=step(await f.check.check({project:'example'}),'database');
    assert.deepEqual([db.cause,db.detail],['DB_UNKNOWN','enrollment-invalid'],text);
  }
});

// ---- 3. Read only: only the fixed queries leave, on a read-only session; psql inside the container is fixed too.

test('read only: every query is one of the fixed ones, on a session opened read only; psql runs -X -w in a fixed environment',async t=>{
  const f=await setup(t);await f.enroll();
  await f.check.check({project:'example'});
  const allowed=new Set([...Object.values(QUERIES),accountQuery({schema:'public',table:'user',column:'email'})]);
  assert.ok(f.pg.queries.length>=6);
  for(const q of f.pg.queries){assert.ok(allowed.has(q.sql),'a query outside the fixed set: '+q.sql);assert.ok(!q.simple);}
  for(const s of f.pg.startups){assert.equal(s.options,'-c default_transaction_read_only=on');assert.match(s.application_name,/^mc-env-[a-f0-9]{24}$/);}
  const account=f.pg.queries.filter(q=>q.sql.includes('$1'));
  assert.deepEqual(account.map(q=>q.params).sort(),[['dev@example.invalid'],['po@example.invalid']].sort());
  const psql=f.fakes.calls().filter(c=>c.tool==='docker'&&c.args.includes('psql'));
  assert.ok(psql.length>=2);
  for(const call of psql) {
    const at=call.args.indexOf('psql'),before=call.args.slice(0,at),after=call.args.slice(at+1);
    assert.deepEqual(before.slice(2,6),['exec','-u','postgres',HEX('c')]);
    assert.deepEqual(before.slice(6),['/usr/bin/env','-i','PATH=/usr/local/bin:/usr/bin:/bin','PGPASSFILE=/dev/null','PGSERVICEFILE=/dev/null','PGSYSCONFDIR=/nonexistent','PSQLRC=/dev/null','LC_ALL=C']);
    for(const flag of ['-X','-w','-A','-t'])assert.ok(after.includes(flag),flag);
    assert.equal(after[after.indexOf('-h')+1],'/var/run/postgresql');
    assert.match(after[after.indexOf('-c')+1],/^SELECT count\(\*\)::text FROM pg_stat_activity WHERE application_name = 'mc-env-[a-f0-9]{24}' AND client_addr IS NOT NULL$/);
    assert.equal(after[after.indexOf('-c')+1],correlationQuery(/'(mc-env-[a-f0-9]{24})'/.exec(after[after.indexOf('-c')+1])[1]));
  }
  // The inspection asks a format that never includes the environment of the container (its password).
  for(const call of f.fakes.calls().filter(c=>c.tool==='docker'&&c.args[2]==='inspect'))assert.ok(!call.args.join(' ').includes('Env')&&!call.args.join(' ').includes('.Config'),call.args.join(' '));
});

// ---- 4. Migrations: read at the commit checked, compared with drizzle.__drizzle_migrations; nothing run.

const MIGRATIONS=[
  ['up to date','green',null,{},0],
  ['two pending','failed','MIGRATIONS_PENDING',{rows:[WHEN[0]]},2],
  ['the table absent: all pending','failed','MIGRATIONS_PENDING',{table:false,rows:[]},3],
  ['the base ahead of the journal','failed','DB_AHEAD',{rows:[...WHEN,WHEN[2]+5000]},null],
];
for(const [why,status,cause,db,pending] of MIGRATIONS)test(`migrations: ${why}`,async t=>{
  const f=await setup(t,{db});await f.enroll();
  const result=await f.check.check({project:'example'});
  const m=step(result,'migrations');
  assert.equal(m.status,status,JSON.stringify(result));
  if(cause){assert.equal(m.cause,cause);assert.equal(step(result,'accounts').status,'not-run');}
  if(pending!==null)assert.equal(m.pending,pending);
  assert.equal(m.journal,3);
  assert.equal(existsSync(join(f.dir,'MIGRATED')),false,'a script of the project ran');
  assert.ok(f.fakes.calls().every(c=>['docker','lsof','ps'].includes(c.tool)));
});

for(const [why,change] of [
  ['a journal that is not JSON',repo=>writeFileSync(join(repo,'drizzle','meta','_journal.json'),'{not json')],
  ['a journal without entries',repo=>writeFileSync(join(repo,'drizzle','meta','_journal.json'),JSON.stringify({version:'7'}))],
  ['an entry with a trapped tag',repo=>writeFileSync(join(repo,'drizzle','meta','_journal.json'),journal([[0,WHEN[0],'../../etc/passwd']]))],
  ['a journal out of order',repo=>writeFileSync(join(repo,'drizzle','meta','_journal.json'),journal([[0,WHEN[1],'0000_m0'],[1,WHEN[0],'0001_m1']]))],
  ['a SQL file missing',repo=>rmSync(join(repo,'drizzle','0001_m1.sql'))],
  ['no journal at all',repo=>rmSync(join(repo,'drizzle'),{recursive:true})],
])test(`migrations: ${why} → MIGRATIONS_UNREADABLE, read at the commit, never run`,async t=>{
  const f=await setup(t);await f.enroll();
  change(f.repo);git(f.repo,'add','-A');git(f.repo,'commit','-q','-m','change');
  const result=await f.check.check({project:'example'});
  const m=step(result,'migrations');
  assert.equal(m.status,'failed',JSON.stringify(result));assert.equal(m.cause,'MIGRATIONS_UNREADABLE');
  assert.equal(result.green,false);
});

test('migrations are read at the commit checked, not in the working tree',async t=>{
  const f=await setup(t,{db:{rows:[WHEN[0]]}});await f.enroll();
  // The working tree says nothing is pending (a journal of one entry), the commit says two are.
  writeFileSync(join(f.repo,'drizzle','meta','_journal.json'),journal([[0,WHEN[0],'0000_m0']]));
  const result=await f.check.check({project:'example'});
  assert.equal(step(result,'migrations').pending,2);
});

// ---- Git in local strict (review, point 4): no read may download an object, call a credential helper or write.

test('git: a partial clone missing the journal blob: nothing is downloaded, no helper or monitor runs, nothing is written; MIGRATIONS_UNREADABLE',async t=>{
  const f=await setup(t);await f.enroll();
  git(f.repo,'config','uploadpack.allowFilter','true');
  const partial=join(f.dir,'partial'),marker=join(f.dir,'HELPER_OR_MONITOR_RAN');
  execFileSync(GIT,['clone','-q','--filter=blob:none','--no-checkout','file://'+f.repo,partial]);
  git(partial,'config','credential.helper',`!touch ${marker}; true`);git(partial,'config','core.fsmonitor',`touch ${marker}; true`);
  const sha=git(partial,'rev-parse','refs/remotes/origin/main');
  const absent=()=>{try{execFileSync(GIT,['-C',partial,'--no-lazy-fetch','cat-file','-e',sha+':drizzle/meta/_journal.json'],{stdio:'ignore'});return false;}catch{return true;}};
  assert.ok(absent(),'the fixture must miss the blob');
  const packs=()=>readdirSync(join(partial,'.git','objects','pack')).sort();
  const before={packs:packs(),config:readFileSync(join(partial,'.git','config'),'utf8')};
  const config=JSON.parse(readFileSync(join(f.root,'config.json'),'utf8'));config.projects[0].repos[0].path=partial;
  writeFileSync(join(f.root,'config.json'),JSON.stringify(config));
  const result=await f.check.check({project:'example'});
  assert.equal(result.sha,sha);
  const m=step(result,'migrations');
  assert.equal(m.status,'failed',JSON.stringify(result));assert.equal(m.cause,'MIGRATIONS_UNREADABLE');
  assert.ok(absent(),'the blob was downloaded');
  assert.deepEqual(packs(),before.packs,'objects were written');
  assert.equal(readFileSync(join(partial,'.git','config'),'utf8'),before.config);
  assert.equal(existsSync(marker),false,'a credential helper or a monitor ran');
});

test('git: every call of the check is local strict, with a fixed environment (no HOME, nothing of the caller)',async t=>{
  const f=await setup(t);
  const calls=[],{invoke}=createCommands({exec:async(file,args,options)=>{calls.push({file,args,env:options.env});return exec(file,args,options);}});
  const saved=process.env.FABRIQUE_CONSOLE_TEST_CANARY;process.env.FABRIQUE_CONSOLE_TEST_CANARY='caller';t.after(()=>{if(saved===undefined)delete process.env.FABRIQUE_CONSOLE_TEST_CANARY;else process.env.FABRIQUE_CONSOLE_TEST_CANARY=saved;});
  const {loadConfig}=createStorage({root:f.root});
  const check=createEnvironmentCheck({root:f.root,loadConfig,invoke,env:{},tools:{lsof:f.fakes.lsof,ps:f.fakes.ps}});
  await check.enroll({project:'example',container:'beta-db',docker:f.fakes.docker,socket:f.scenario.socket});
  assert.equal((await check.check({project:'example'})).green,true);
  const gits=calls.filter(c=>c.file==='git');
  assert.ok(gits.length>=5);
  for(const call of gits) {
    assert.equal(call.args[0],'--no-lazy-fetch',call.args.join(' '));
    for(const setting of ['protocol.allow=never','credential.helper=','core.fsmonitor=false'])assert.ok(call.args.includes(setting),setting);
    assert.deepEqual(Object.keys(call.env).sort(),['GIT_OPTIONAL_LOCKS','GIT_TERMINAL_PROMPT','LC_ALL','PATH'],Object.keys(call.env).join(' '));
  }
});

// ---- 5. Accounts: yes or no only.

test('accounts: yes or no for each name, never the identifier; one missing is ACCOUNT_MISSING',async t=>{
  const f=await setup(t,{db:{accounts:['po@example.invalid']}});await f.enroll();
  const result=await f.check.check({project:'example'});
  const a=step(result,'accounts');
  assert.equal(a.status,'failed');assert.equal(a.cause,'ACCOUNT_MISSING');
  assert.deepEqual(a.accounts,{po:true,dev:false});
  const text=JSON.stringify(result)+readFileSync(join(f.root,'environment','example','last.json'),'utf8');
  assert.ok(!text.includes('@example.invalid'),'an identifier of an account is kept');
});

// ---- 8. Canary: nothing of the caller, of the .env, of the outputs of the fakes is kept anywhere.

const files=dir=>{const out=[];const walk=d=>{for(const e of readdirSync(d,{withFileTypes:true})){const p=join(d,e.name);if(e.isDirectory())walk(p);else if(e.isFile())out.push(p);}};if(existsSync(dir))walk(dir);return out;};
for(const [why,db,change] of [['green steps',{},null],['a failure of the engine',{},s=>{s.dockerDown=true;}],['an SQL error',{table:true,name:'beta'},null],['accounts missing',{accounts:[]},null]])
  test(`canary: ${why}, the canary appears nowhere`,async t=>{
    const canary='CANARY-'+Math.random().toString(36).slice(2,10);
    const saved=process.env.FABRIQUE_CONSOLE_TEST_CANARY;process.env.FABRIQUE_CONSOLE_TEST_CANARY=canary;t.after(()=>{if(saved===undefined)delete process.env.FABRIQUE_CONSOLE_TEST_CANARY;else process.env.FABRIQUE_CONSOLE_TEST_CANARY=saved;});
    const f=await setup(t,{canary,db});await f.enroll();
    if(change)f.set(s=>{s.canary=canary;change(s);});
    if(why==='an SQL error')f.state.systemId=null;
    const result=await f.check.check({project:'example'});
    assert.ok(!JSON.stringify(result).includes(canary),'in the result');
    for(const file of files(join(f.root,'environment')))assert.ok(!readFileSync(file,'utf8').includes(canary),file);
  });

// ---- 9. Interruption (the part of (a)): a check killed is « interrupted » for the next; one check at a time.

test('a check killed: the next says « interrupted » for it; while the kernel lock is held, a second check is refused and changes no result',async t=>{
  const f=await setup(t);await f.enroll();
  const dir=join(f.root,'environment','example');mkdirSync(dir,{recursive:true});
  // What a killed check of a version before leaves: an old `.running`, still read as a marker (review 3).
  writeFileSync(join(dir,'.running'),JSON.stringify({pid:999999,at:'2026-11-14T00:00:00.000Z'}));
  const result=await f.check.check({project:'example'});
  assert.equal(result.previous,'interrupted');
  assert.equal(existsSync(join(dir,'.running')),false);
  // The lock held (here in this process; tests/environment-lock.test.mjs races real processes).
  const last=readFileSync(join(dir,'last.json'),'utf8');
  await operationLock(dir,async()=>{await assert.rejects(f.check.check({project:'example'}),{code:'ENVIRONMENT_BUSY'});});
  assert.equal(readFileSync(join(dir,'last.json'),'utf8'),last);
  // Review 3: the refused check wrote its own marker before trying the lock and removes it, and only it.
  assert.deepEqual(markers(dir),[],'a check refused leaves no marker');
  const other=join(dir,'.running-'+'b'.repeat(24));writeFileSync(other,JSON.stringify({id:'b'.repeat(24),pid:process.pid,at:'2026-11-16T00:00:00.000Z'}));
  await operationLock(dir,async()=>{await assert.rejects(f.check.check({project:'example'}),{code:'ENVIRONMENT_BUSY'});});
  assert.deepEqual(markers(dir),['.running-'+'b'.repeat(24)],'nor removes the marker of another check');
  // Run again: that marker is of no check running in this process (dead), so interrupted, then removed.
  assert.equal((await f.check.check({project:'example'})).previous,'interrupted');
  assert.deepEqual(markers(dir),[]);
});

test('review 3: a marker whose check may be alive is never removed by another check; a dead one is',async t=>{
  const f=await setup(t);await f.enroll();
  const dir=join(f.root,'environment','example');mkdirSync(dir,{recursive:true});
  const alive=join(dir,'.running-'+'c'.repeat(24)),dead=join(dir,'.running-'+'d'.repeat(24));
  // Alive: another process that answers (the parent of this one); dead: a process that is gone.
  writeFileSync(alive,JSON.stringify({id:'c'.repeat(24),pid:process.ppid,at:'2026-11-16T00:00:00.000Z'}));
  writeFileSync(dead,JSON.stringify({id:'d'.repeat(24),pid:999999,at:'2026-11-16T00:00:00.000Z'}));
  assert.equal((await f.check.check({project:'example'})).previous,'interrupted','the dead one');
  assert.deepEqual(markers(dir),['.running-'+'c'.repeat(24)],'the one that may be alive is left to its check');
  rmSync(alive);
  assert.equal((await f.check.check({project:'example'})).previous??null,null);
  assert.deepEqual(markers(dir),[]);
});

test('the module sends no signal: no kill anywhere in it',()=>{
  const source=readFileSync(fileURLToPath(new URL('../src/environment-check.mjs',import.meta.url)),'utf8');
  assert.ok(!/\.kill\(|process\.kill|SIGKILL|SIGTERM/.test(source));
});

// ---- The commit checked: resolved once (origin/<base>, else HEAD), without a fetch, bound to the result.

test('the commit checked is origin/<main branch> when known, else HEAD, never fetched; green only for that exact commit',async t=>{
  const f=await setup(t);await f.enroll();
  const first=git(f.repo,'rev-parse','HEAD');
  writeFileSync(join(f.repo,'later.txt'),'x');git(f.repo,'add','-A');git(f.repo,'commit','-q','-m','later');
  git(f.repo,'update-ref','refs/remotes/origin/main',first);
  const result=await f.check.check({project:'example'});
  assert.equal(result.sha,first);
  const green={...result,status:'green',green:true,steps:result.steps.map(s=>({...s,status:'green'}))};
  const bound={sha:first,fingerprint:result.fingerprint,enrollment:result.enrollment};
  assert.equal(greenFor(green,bound),true);
  assert.equal(greenFor(green,{...bound,sha:git(f.repo,'rev-parse','HEAD')}),false,'another commit');
  assert.equal(greenFor(green,{...bound,fingerprint:'0'.repeat(64)}),false,'another configuration');
  assert.equal(greenFor(green,{...bound,enrollment:'0'.repeat(64)}),false,'another enrollment');
  assert.equal(greenFor(result,bound),true,'decision 95: three green steps are a green');
  assert.equal(greenFor({...green,status:'failed',green:false},bound),false,'a result that is not green');
  assert.equal(greenFor({...green,steps:green.steps.map(s=>s.step==='accounts'?{...s,status:'not-run'}:s)},bound),false,'a step not green');
  assert.equal(greenFor(null,bound),false);
});

// ---- Enrollment: done by the user, refused on anything the check would refuse.

test('enrollment records the container, its image, the socket and a fingerprint of the base, never the base identifier itself',async t=>{
  const f=await setup(t);
  const out=await f.enroll();
  assert.equal(out.status,'enrolled');
  const saved=JSON.parse(readFileSync(join(f.root,'environment','example','enrollment.json'),'utf8'));
  assert.equal(saved.containerId,HEX('c'));assert.equal(saved.image,'sha256:'+HEX('a'));assert.equal(saved.socket,f.scenario.socket);
  assert.match(saved.systemIdentifier,/^[a-f0-9]{64}$/);assert.ok(!JSON.stringify(saved).includes(SYSTEM_ID));
  assert.equal('dependencies' in saved,false,'no server step, no node_modules enrolled (decision 95)');
  // The engine (review 2, I1): its ID, OperatingSystem and Name, nothing else of docker info.
  assert.deepEqual(saved.engine,{id:'ENGINE-LOCAL-0001',os:'Docker Desktop',name:'docker-desktop'});
  const info=f.fakes.calls().filter(c=>c.tool==='docker'&&c.args[2]==='info');
  assert.ok(info.length>=1);
  for(const call of info)assert.deepEqual(call.args.slice(3),['--format','{"id":{{json .ID}},"os":{{json .OperatingSystem}},"name":{{json .Name}}}']);
});

test('enrollment refused on an engine that is not Docker Desktop (remote): nothing recorded (review 2, I1)',async t=>{
  const f=await setup(t);f.set(s=>{s.engine={...s.engine,OperatingSystem:'Ubuntu 24.04.1 LTS'};});
  const out=await f.enroll();
  assert.deepEqual([out.status,out.cause,out.detail],['refused','DB_NOT_LOCAL','engine-remote']);
  assert.equal(existsSync(join(f.root,'environment','example','enrollment.json')),false);
});

test('the engine is checked again at the end: swapped during the check is DB_NOT_LOCAL changed (review 2, I1)',async t=>{
  const f=await setup(t);await f.enroll();
  let changed=false;
  const original=f.state.accounts;f.state.accounts=new Proxy(original,{get(target,key){if(key==='includes'&&!changed){changed=true;f.set(s=>{s.engine={...s.engine,ID:'ENGINE-OTHER-0002'};});}return Reflect.get(target,key);}});
  const result=await f.check.check({project:'example'});
  const db=step(result,'database');
  assert.deepEqual([db.status,db.cause,db.detail],['failed','DB_NOT_LOCAL','changed'],JSON.stringify(result));
  assert.equal(result.green,false);
});

test('enrollment refused: a port on all addresses, a relay, a password asked: nothing recorded',async t=>{
  for(const change of [s=>{s.container.ports['5432/tcp'][0].HostIp='0.0.0.0';},s=>{s.top=['postgres','sshd'];}]) {
    const f=await setup(t);f.set(change);
    const out=await f.enroll();
    assert.equal(out.status,'refused');assert.equal(out.cause,'DB_NOT_LOCAL');
    assert.equal(existsSync(join(f.root,'environment','example','enrollment.json')),false);
  }
  const g=await setup(t,{db:{auth:'scram'}});
  const out=await g.enroll();
  assert.equal(out.status,'refused');assert.equal(out.cause,'DB_AUTH_UNSUPPORTED');
});
