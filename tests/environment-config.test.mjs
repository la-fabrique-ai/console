// M6 (a), family 1: the configuration `environment` of a project (decision 89). Optional, four blocks, kept in the
// configuration of Mission Control, never in the repository of the project; refused for a project of more than one
// repository; migrations and accounts require database; a server block is refused (decision 95).
// Absent, partial or invalid: never green (the check side is in environment-check.test.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { validateConfig } from '../src/config.mjs';
import { validateEnvironment, environmentFingerprint } from '../src/environment-config.mjs';
import { configV2 } from './helpers/config-v2-fixture.mjs';
import { sampleEnvironment } from './helpers/environment-sample.mjs';

const single=environment=>{const c=configV2();c.projects[0].repos.splice(1);c.projects[0].environment=environment;return c;};

test('a full environment is kept as declared, with defaults made explicit, in the configuration of Mission Control',()=>{
  const project=validateConfig(single(sampleEnvironment())).projects[0];
  assert.deepEqual(project.environment.database,{engine:'postgres',port:5461,name:'beta',user:'postgres',dataDir:'/var/lib/postgresql/data'});
  assert.deepEqual(project.environment.accounts,{schema:'public',table:'user',column:'email',keys:{po:'po@example.invalid',dev:'dev@example.invalid'}});
  assert.deepEqual(Object.keys(project.environment),['database','migrations','accounts']);
});

test('decision 95: a server block is refused, with the reason, even a well-formed one',()=>{
  const e={...sampleEnvironment(),server:{argv:['node_modules/next/dist/bin/next','dev'],port:3100,path:'/'}};
  assert.throws(()=>validateConfig(single(e)),error=>error.code==='INVALID_CONFIG'&&/decision 95/.test(error.message));
  assert.throws(()=>validateEnvironment({database:sampleEnvironment().database,server:{}},{repos:1}),{code:'INVALID_CONFIG'});
});

test('no environment: the project is valid and has none (the check says « not declared », never green)',()=>{
  const c=configV2();c.projects[0].repos.splice(1);
  assert.equal(validateConfig(c).projects[0].environment,undefined);
});

test('a partial environment (database alone) is valid; a block without database is refused',()=>{
  assert.deepEqual(Object.keys(validateEnvironment({database:sampleEnvironment().database},{repos:1})),['database']);
  for(const block of ['migrations','accounts'])
    assert.throws(()=>validateEnvironment({[block]:sampleEnvironment()[block]},{repos:1}),{code:'INVALID_CONFIG'},block);
});

test('a project of more than one repository cannot declare an environment',()=>{
  const c=configV2();c.projects[0].environment=sampleEnvironment();
  assert.equal(c.projects[0].repos.length,2);
  assert.throws(()=>validateConfig(c),{code:'INVALID_CONFIG'});
});

const traps=[
  ['unknown block',e=>{e.cache={};}],
  ['another engine',e=>{e.database.engine='mysql';}],
  ['database port out of range',e=>{e.database.port=80;}],
  ['database name with a quote',e=>{e.database.name='x"; DROP TABLE x; --';}],
  ['user with a space',e=>{e.user='a b';e.database.user='a b';}],
  ['relative data folder',e=>{e.database.dataDir='data';}],
  ['another migration tool',e=>{e.migrations.tool='prisma';}],
  ['migrations folder leaving the tree',e=>{e.migrations.folder='../drizzle';}],
  ['absolute migrations folder',e=>{e.migrations.folder='/drizzle';}],
  ['table with a quote',e=>{e.accounts.table='user"--';}],
  ['column with a dot',e=>{e.accounts.column='a.b';}],
  ['schema in capitals and quotes',e=>{e.accounts.schema='"Public"';}],
  ['no account key',e=>{e.accounts.keys={};}],
  ['account value not a string',e=>{e.accounts.keys.po=1;}],
  ['account name with spaces',e=>{e.accounts.keys={'a b':'x'};}],
];
for(const [why,change] of traps)test(`a trapped environment is refused: ${why}`,()=>{
  const e=sampleEnvironment();change(e);
  assert.throws(()=>validateConfig(single(e)),{code:'INVALID_CONFIG'},why);
});

test('the fingerprint changes with the environment, the repository or its main branch, never with key order',()=>{
  const e=sampleEnvironment(),repo={path:'/r',mainBranch:'main'};
  const base=environmentFingerprint({environment:validateEnvironment(e,{repos:1}),repo});
  const reordered=Object.fromEntries(Object.entries(e).reverse());
  assert.equal(environmentFingerprint({environment:validateEnvironment(reordered,{repos:1}),repo}),base);
  assert.notEqual(environmentFingerprint({environment:validateEnvironment({...e,database:{...e.database,port:5462}},{repos:1}),repo}),base);
  assert.notEqual(environmentFingerprint({environment:validateEnvironment(e,{repos:1}),repo:{...repo,mainBranch:'dev'}}),base);
  assert.match(base,/^[a-f0-9]{64}$/);
});
