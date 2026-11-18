// M6, review point 5: the native check of the environment check (scripts/environment-native-check.mjs, run by the user
// only, never by the suite on a real container). Here only its verdict is tested, as a pure function: its exit code
// must reflect every one of its results, the cycle included, and it no longer claims to check --loopback (decision 95).
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { verdict, options } from '../scripts/environment-native-check.mjs';

const SCRIPT=fileURLToPath(new URL('../scripts/environment-native-check.mjs',import.meta.url));
const cycle=kind=>kind==='green'
  ?{status:'green',cause:null,steps:[{step:'database',status:'green'},{step:'migrations',status:'green',pending:0},{step:'accounts',status:'green'}]}
  :{status:'failed',cause:'MIGRATIONS_PENDING',steps:[{step:'database',status:'green'},{step:'migrations',status:'failed',cause:'MIGRATIONS_PENDING',pending:2},{step:'accounts',status:'not-run'}]};
const good=kind=>({container:'found',listener:{owners:1,dockerDesktop:true,loopbackOnly:true},top:{rows:3,onlyPostgres:true},
  inside:{port:true,socket:true,correlation:true},identity:true,connection:null,enroll:{status:'enrolled',cause:null,detail:null},cycle:cycle(kind),
  dockerConfig:{empty:true}});

test('native check: a report where every point answered as expected passes, for each expectation',()=>{
  for(const expect of ['MIGRATIONS_PENDING','green'])assert.deepEqual(verdict(good(expect),{expect}),{ok:true,failed:[]},expect);
});

const BREAKS=[
  ['container',r=>{r.container='missing';}],
  ['listener.owners',r=>{r.listener.owners=2;}],
  ['listener.dockerDesktop',r=>{r.listener.dockerDesktop=false;}],
  ['listener.loopbackOnly',r=>{r.listener.loopbackOnly=false;}],
  ['top.onlyPostgres',r=>{r.top.onlyPostgres=false;}],
  ['inside.port',r=>{r.inside.port=false;}],
  ['inside.socket',r=>{r.inside.socket=false;}],
  ['inside.correlation',r=>{delete r.inside.correlation;}],
  ['identity',r=>{r.identity=false;}],
  ['connection',r=>{r.connection='refused';}],
  ['enroll',r=>{r.enroll={status:'refused',cause:'DB_NOT_LOCAL',detail:'relay'};}],
  ['cycle',r=>{r.cycle.steps[0]={step:'database',status:'failed',cause:'DB_NOT_LOCAL'};r.cycle.status='failed';r.cycle.cause='DB_NOT_LOCAL';}],
  ['cycle',r=>{r.cycle=null;}],
  ['dockerConfig.empty',r=>{r.dockerConfig.empty=false;}],
  ['dockerConfig.empty',r=>{delete r.dockerConfig;}],
];
for(const expect of ['MIGRATIONS_PENDING','green'])for(const [name,change] of BREAKS)test(`native check (${expect}): ${name} wrong fails the verdict and is named`,()=>{
  const report=structuredClone(good(expect));change(report);
  const out=verdict(report,{expect});
  assert.equal(out.ok,false);assert.ok(out.failed.includes(name),JSON.stringify(out));
});

test('native check: the cycle is judged against the expectation: green when pending was expected fails, and the reverse',()=>{
  assert.deepEqual(verdict(good('green'),{expect:'MIGRATIONS_PENDING'}),{ok:false,failed:['cycle']});
  assert.deepEqual(verdict(good('MIGRATIONS_PENDING'),{expect:'green'}),{ok:false,failed:['cycle']});
  const none=good('MIGRATIONS_PENDING');none.cycle.steps[1].pending=0;
  assert.equal(verdict(none,{expect:'MIGRATIONS_PENDING'}).ok,false,'pending without a number');
});

test('native check: no sandbox probe, nothing about --loopback is checked or reported (decision 95)',()=>{
  const source=readFileSync(SCRIPT,'utf8');
  assert.doesNotMatch(source,/sandbox-exec|sandboxBinds|sandboxFiltersAddress|local tcp/);
  assert.equal('sandbox' in good('green'),false);
  assert.deepEqual(options(['--root','/x','--project','p','--container','c']).expect,'MIGRATIONS_PENDING');
  assert.equal(options(['--root','/x','--project','p','--container','c','--expect','green']).expect,'green');
  assert.throws(()=>options(['--root','/x','--project','p','--container','c','--expect','yes']));
  assert.throws(()=>options(['--root','/x','--project','p','--container','c','--port','5000']),'--port belonged to the loopback probe');
});

test('native check: a wrong use exits 2 before touching anything',()=>{
  const run=spawnSync(process.execPath,[SCRIPT],{encoding:'utf8',timeout:20000});
  assert.equal(run.status,2,run.stderr);
});

test('native check: the correlation and DOCKER_CONFIG are the module\'s own, ON_ERROR_STOP included (review 2, m9)',async()=>{
  const module=await import('../src/environment-check.mjs');
  assert.equal(typeof module.correlationCommand,'function');assert.equal(typeof module.dockerConfigFolder,'function');
  const args=module.correlationCommand({containerId:'c'.repeat(64),socketDir:'/var/run/postgresql',port:'5432',user:'postgres',name:'beta',appName:'mc-env-'+'0'.repeat(24)});
  const at=args.indexOf('-v');assert.ok(at>0&&args[at+1]==='ON_ERROR_STOP=1',args.join(' '));
  assert.equal(module.dockerConfigFolder('/x'),'/x/environment/.docker-config');
  const source=readFileSync(SCRIPT,'utf8');
  assert.doesNotMatch(source,/nonexistent-fabrique-console-empty/,'a DOCKER_CONFIG of its own');
  assert.match(source,/correlationCommand\(/);assert.match(source,/dockerConfigFolder\(/);
  assert.doesNotMatch(source,/'psql'/,'a psql command line of its own');
});
