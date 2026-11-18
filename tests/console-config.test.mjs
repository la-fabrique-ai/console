import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { validateConfig } from '../src/config.mjs';
import { convertV1Config } from '../src/config-migration.mjs';
import { configV2 } from './helpers/config-v2-fixture.mjs';
const fresh=()=>{
  const c=configV2();delete c.tracker;
  c.owner={id:'responsable-42',displayName:'Camille'};c.ticketConnector='primary';
  const p=c.projects[0];delete p.teamId;delete p.projectId;
  Object.assign(p,{key:'synthetic-orbit',icon:'◆',leadLayout:'generated',ticketScope:{connection:'primary',scopeId:'scope-42'}});
  return c;
};
test('provider-neutral configuration keeps owner, scope, presentation, repositories and profiles',()=>{
  const input=fresh(),config=validateConfig(input);
  assert.deepEqual(config.owner,input.owner);assert.equal(config.ticketConnector,'primary');
  assert.deepEqual(JSON.parse(JSON.stringify(config.projects)),input.projects.map(p=>({...p,teamId:p.ticketScope.scopeId})));assert.deepEqual(config.profiles,input.profiles);
  assert.deepEqual(validateConfig(config),config);
});
for(const [name,mutate] of [
  ['null owner',c=>c.owner=null],['null icon',c=>c.projects[0].icon=null],['null layout',c=>c.projects[0].leadLayout=null],['null scope',c=>c.projects[0].ticketScope=null],['null connection',c=>c.ticketConnector=null],['null transport',c=>c.tracker=null],['owner field',c=>c.owner.extra=true],['owner id',c=>c.owner.id='../other'],['owner text',c=>c.owner.displayName='\nadmin'],
  ['connection',c=>c.ticketConnector='../connection'],['scope field',c=>c.projects[0].ticketScope.provider='vendor'],
  ['scope id',c=>c.projects[0].ticketScope.scopeId=''],['icon path',c=>c.projects[0].icon='../private.svg'],
  ['layout path',c=>c.projects[0].leadLayout='../../official'],['missing owner',c=>delete c.owner],
  ['unknown field',c=>c.secret='x'],['repo field',c=>c.projects[0].repos[0].secret='x'],
])test('new configuration rejects invalid '+name,()=>{
  const c=fresh();mutate(c);assert.throws(()=>validateConfig(c),{code:'INVALID_CONFIG'});
});
test('legacy V1 and V2 configurations gain generic metadata and explicit scopes without losing IDs',()=>{
  const c=configV2(),old=structuredClone(c),config=validateConfig(c);
  assert.deepEqual(c,old);assert.equal(config.projects[0].teamId,old.projects[0].teamId);
  assert.deepEqual(config.projects[0].ticketScope,{connection:'primary',scopeId:old.projects[0].projectId});
  assert.deepEqual(config.owner,{id:'owner',displayName:'Responsable'});
  const v1={version:1,projects:[{key:'synthetic-nova',teamId:'team-only',repo:'/example/app',mainBranch:'main',preferredAgent:'codex',machine:null,tests:{}}]};
  assert.deepEqual(validateConfig(v1).projects[0].ticketScope,{connection:'primary',scopeId:'team-only'});
  const migrated=convertV1Config(v1,{worktreesRoot:'/example/worktrees'});
  assert.equal(migrated.projects[0].kind,'annexe');assert.equal(migrated.projects[0].repos[0].path,'/example/app');
  assert.deepEqual(migrated.projects[0].ticketScope,{connection:'primary',scopeId:'team-only'});
});
test('V1 rejects fields it would otherwise silently discard',()=>{
  const c={version:1,projects:[],unexpected:true};assert.throws(()=>validateConfig(c),{code:'INVALID_CONFIG'});
});
test('fictitious example uses a generic owner and demo project',async()=>{
  const raw=JSON.parse(await readFile(new URL('../config/projects.example.json',import.meta.url),'utf8'));
  assert.equal(raw.owner.displayName,'Responsable');assert.equal(raw.projects[0].key,'demo');assert.ok(raw.ticketConnector);
  const config=validateConfig(raw);
  assert.equal(config.projects[0].teamId,'EXAMPLE_SCOPE');
  assert.equal(config.projects[0].projectId,undefined);
  assert.deepEqual(validateConfig(config),config);
});

for(const version of [1,2]) {
  const scoped=()=>version===2?fresh():{version:1,projects:[{key:'demo',repo:'/example/app',mainBranch:'main',preferredAgent:'codex',machine:null,ticketScope:{connection:'primary',scopeId:'scope-42'}}]};
  test(`V${version} derives a team scope without changing the source configuration`,()=>{
    const input=scoped(),before=structuredClone(input),config=validateConfig(input);
    assert.equal(config.projects[0].teamId,'scope-42');
    assert.deepEqual(input,before);
    assert.deepEqual(validateConfig(config),config);
  });
  for(const field of ['teamId','projectId'])test(`V${version} rejects ticketScope contradicting ${field}`,()=>{
    const input=scoped();input.projects[0][field]='different-scope';
    assert.throws(()=>validateConfig(input),{code:'INVALID_CONFIG',message:new RegExp(`ticketScope.*${field}`)});
  });
  test(`V${version} preserves matching project scope and its separate team`,()=>{
    const input=scoped();Object.assign(input.projects[0],{projectId:'scope-42',teamId:'team-42'});
    const config=validateConfig(input);
    assert.equal(config.projects[0].projectId,'scope-42');assert.equal(config.projects[0].teamId,'team-42');
    assert.deepEqual(validateConfig(config),config);
  });
}

test('V1 strict validation rejects invalid endpoint, null tests and control characters in paths',()=>{
 const c={version:1,projects:[{key:'demo',teamId:'team',repo:'/example/app',mainBranch:'main',preferredAgent:'codex',machine:null}]};
 for(const change of [x=>x.tracker={transport:'graphql',endpoint:'https://untrusted.invalid'},x=>x.projects[0].tests=null,x=>x.projects[0].repo='/example/\napp']){
  const input=structuredClone(c);change(input);assert.throws(()=>validateConfig(input),{code:'INVALID_CONFIG'});
 }
});
