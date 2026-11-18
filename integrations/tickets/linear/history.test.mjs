import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {validateConfig} from '../../../src/config.mjs';
import {createMissionRegistry} from '../../../src/mission.mjs';
import {createTicketFactory,ticketError,ticketAction} from '../factory.mjs';

test('legacy transport configuration remains readable without changing disk or ticket text',()=>{
  const source={version:1,linear:{transport:'graphql',endpoint:'https://api.linear.app/graphql'},projects:[]};
  const before=JSON.stringify(source),config=validateConfig(source);
  assert.deepEqual(config.tracker,source.linear);assert.equal(JSON.stringify(source),before);
  assert.equal(ticketAction('linear-detail'),'ticket-detail');
  assert.equal(ticketAction('linear-mutate'),'ticket-mutate');
});
test('legacy mission ticket states remain readable and a read does not rewrite history',async t=>{
  const root=await mkdtemp(join(tmpdir(),'ticket-history-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const dir=join(root,'state','missions');await mkdir(dir,{recursive:true});
  const file=join(dir,'M-1.json'),raw=JSON.stringify({id:'M-1',step:'developing',tickets:[{id:'DEMO-1',linear:'completed'}],request:'Keep the word Linear in user content.'});await writeFile(file,raw);
  const mission=await createMissionRegistry({root}).read('M-1');
  assert.equal(mission.tickets[0].tracker,'completed');assert.equal(mission.request,'Keep the word Linear in user content.');assert.equal(await readFile(file,'utf8'),raw);
});
test('old transport injection still uses the supplied client rather than credentials',async()=>{
  const connector=await createTicketFactory({loadConfig:async()=>({linear:{transport:'graphql'}}),injectedLinear:{configured:async()=>true,detail:async()=>({issue:{id:'opaque',title:'From injected transport'}})}}).getTickets();
  assert.equal((await connector.detail('opaque')).ticket.title,'From injected transport');
});
test('provider errors cross the engine boundary with generic codes and safe messages',async()=>{
  const raw=Object.assign(new Error('Linear failed with '+['Bearer','fixture-secret'].join(' ')+' and captured stderr'),{code:'LINEAR_API'}),error=ticketError(raw);
  assert.equal(error.code,'TICKET_API');assert.doesNotMatch(error.message,/Linear|secret|stderr/);
  const connector=await createTicketFactory({loadConfig:async()=>({}),injectedTransport:{detail:async()=>{throw raw;}}}).getTickets();
  await assert.rejects(()=>connector.detail('opaque'),{code:'TICKET_API',message:'The ticket connection could not complete this operation.'});
});
test('legacy injected clients retain their pagination evidence and mutation guidance',async()=>{
  const connector=await createTicketFactory({loadConfig:async()=>({}),injectedLinear:{list:async()=>({issues:[],updatedAt:'2026-01-01T00:00:00Z'})}}).getTickets();
  assert.equal((await connector.list()).complete,true);
  const {AppError}=await import('../../../src/common.mjs');
  assert.match(ticketError(new AppError('LINEAR_MUTATION_UNCERTAIN','Linear response was lost. Reconcile before retrying.')).message,/Reconcile before retrying/);
});
test('legacy project-only scope is never reinterpreted as an authorized team',async()=>{
  const {ticketConnection}=await import('../factory.mjs');
  const config=validateConfig({version:1,projects:[{key:'demo',projectId:'project-only',repo:'/tmp/example',preferredAgent:'codex',mainBranch:'main',machine:null}]});
  assert.equal(ticketConnection(config,config.projects[0]).scope.id,null);
  assert.equal(ticketConnection(config,{key:'demo',ticketScope:{connection:'primary',scopeId:'explicit-team'}}).scope.id,'explicit-team');
});
test('legacy V2 and prepared migration journals retain settings, hashes and the byte-exact backup',async t=>{
  const {fixture}=await import('../../../tests/helpers/backend-fixture.mjs');
  const {convertV1Config}=await import('../../../src/config-migration.mjs');
  const {canonical}=await import('../../../src/common.mjs');
  const {createHash}=await import('node:crypto');
  const f=await fixture(t),source={...f.config,linear:{transport:'graphql'}},worktreesRoot=join(f.root,'worktrees');
  await mkdir(worktreesRoot);await f.write('config.json',source);
  const target=convertV1Config(source,{worktreesRoot});target.linear=target.tracker;delete target.tracker;
  assert.deepEqual(validateConfig(target).tracker,{transport:'graphql'});
  const hash=value=>createHash('sha256').update(value).digest('hex'),raw=await readFile(join(f.home,'config.json'),'utf8'),sourceHash=hash(raw),targetHash=hash(canonical(target));
  const backups=join(f.home,'backups'),migrations=join(f.home,'migrations');await mkdir(backups);await mkdir(migrations);
  const backup=join(backups,`config-v1-${sourceHash}.json`),journalFile=join(migrations,'config-v1-v2.json');
  await writeFile(backup,raw,{mode:0o600});await writeFile(journalFile,JSON.stringify({version:1,status:'prepared',sourceHash,targetHash,target}),{mode:0o600});
  const result=await f.backend.dispatch('config-migrate',{confirmed:true,worktreesRoot});
  assert.equal(result.status,'migrated');assert.deepEqual(result.config.tracker,{transport:'graphql'});
  assert.equal(await readFile(backup,'utf8'),raw);
  const journal=JSON.parse(await readFile(journalFile,'utf8'));assert.equal(journal.targetHash,targetHash);assert.equal(journal.sourceHash,sourceHash);
  assert.equal((await f.backend.dispatch('config-migrate',{confirmed:true,worktreesRoot})).status,'already-migrated');
});
