// The configuration `environment` of a project (M6, decisions 89, 93 and 95): what the environment check of
// src/environment-check.mjs verifies before a launch. It lives in the configuration of Mission Control (config.json of
// its state folder), never in the repository of the project: the project cannot change what checks it.
//
// Three optional blocks, checked in this order: database (PostgreSQL in a local Docker container, enrolled by
// the user), migrations (Drizzle, read at the commit checked, never run), accounts (presence of test accounts only).
// migrations and accounts require database. A project of more than one repository cannot declare one (v1: one
// repository, PostgreSQL). A `server` block is refused: the server step is not part of v1 (decision 95) and comes back
// before M16 with its own rules.
import { createHash } from 'node:crypto';
import { fail, canonical } from './common.mjs';

const valid=(condition,message)=>{if(!condition)fail('INVALID_CONFIG','Environment: '+message);};
const plain=value=>Boolean(value)&&typeof value==='object'&&!Array.isArray(value);
const only=(value,allowed,what)=>{valid(plain(value),what+' must be an object.');valid(Object.keys(value).every(key=>allowed.includes(key)),'unknown field in '+what+'.');};
const port=(value,what)=>{valid(Number.isInteger(value)&&value>=1024&&value<=65535,what+' must be a port between 1024 and 65535.');return value;};
// A SQL identifier the check quotes itself: lower case, no quote, no dot.
const IDENT=/^[a-z_][a-z0-9_]{0,62}$/;
const ident=(value,what)=>{valid(typeof value==='string'&&IDENT.test(value),what+' must be a plain lower-case SQL identifier.');return value;};
// A relative path inside the tree of the commit checked: no absolute path, no `..`, no `.git`.
const inTree=(value,what)=>{
  valid(typeof value==='string'&&value.length<=300&&/^[A-Za-z0-9._@+-]+(\/[A-Za-z0-9._@+-]+)*$/.test(value),what+' must be a relative path of the repository.');
  valid(value.split('/').every(part=>part!=='.'&&part!=='..'&&part.toLowerCase()!=='.git'),what+' cannot leave the repository.');
  return value;
};
const VALUE=/^[^\x00-\x1f\x7f]{0,1000}$/;

function database(raw) {
  only(raw,['engine','port','name','user','dataDir'],'database');
  valid(raw.engine==='postgres','database.engine must be postgres (v1).');
  return {engine:'postgres',port:port(raw.port,'database.port'),name:ident(raw.name,'database.name'),user:ident(raw.user,'database.user'),
    dataDir:raw.dataDir===undefined?'/var/lib/postgresql/data':(valid(typeof raw.dataDir==='string'&&/^\/[A-Za-z0-9._\/-]{1,200}$/.test(raw.dataDir)&&!raw.dataDir.split('/').includes('..'),'database.dataDir must be an absolute path of the container.'),raw.dataDir)};
}
function migrations(raw) {
  only(raw,['tool','folder'],'migrations');
  valid(raw.tool==='drizzle','migrations.tool must be drizzle (v1).');
  return {tool:'drizzle',folder:inTree(raw.folder??'drizzle','migrations.folder')};
}
function accounts(raw) {
  only(raw,['schema','table','column','keys'],'accounts');
  valid(plain(raw.keys)&&Object.keys(raw.keys).length>=1&&Object.keys(raw.keys).length<=20,'accounts.keys must name one to twenty accounts.');
  const keys={};
  for(const [name,value] of Object.entries(raw.keys)) {
    valid(/^[a-z0-9][a-z0-9_-]{0,47}$/.test(name),'accounts.keys: invalid account name.');
    valid(typeof value==='string'&&value.length>=1&&value.length<=200&&VALUE.test(value),'accounts.keys: an account is a short string.');
    keys[name]=value;
  }
  return {schema:ident(raw.schema??'public','accounts.schema'),table:ident(raw.table,'accounts.table'),column:ident(raw.column,'accounts.column'),keys};
}
// The environment as the check uses it, or INVALID_CONFIG. `repos`: the number of repositories of the project.
export function validateEnvironment(raw,{repos}) {
  valid(!plain(raw)||raw.server===undefined,'the server step is not part of this version (decision 95): remove environment.server.');
  only(raw,['database','migrations','accounts'],'environment');
  valid(repos===1,'a project of more than one repository cannot declare an environment (v1).');
  const out={};
  if(raw.database!==undefined)out.database=database(raw.database);
  for(const block of ['migrations','accounts'])if(raw[block]!==undefined)valid(Boolean(out.database),block+' requires database.');
  if(raw.migrations!==undefined)out.migrations=migrations(raw.migrations);
  if(raw.accounts!==undefined)out.accounts=accounts(raw.accounts);
  return out;
}

// What a green result is bound to, besides the commit and the enrollment: the environment, the repository and its
// main branch, in a canonical form.
export function environmentFingerprint({environment,repo}) {
  return createHash('sha256').update(canonical({environment,repo:{path:repo.path,mainBranch:repo.mainBranch}})).digest('hex');
}
