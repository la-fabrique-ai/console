import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { createBackend } from '../src/backend.mjs';
import { createWorkspaceState } from '../src/workspace-state.mjs';
import { worktreeFixture } from './helpers/worktree-fixture.mjs';
import { emptyWorkspaceFixture } from './helpers/empty-workspace-fixture.mjs';
import { assertInterfaceShape } from './helpers/interface-shape.mjs';

const wire=value=>JSON.parse(JSON.stringify(value));
test('configuration read/save contracts include the exact byte revision and reject missing or malformed fields',async t=>{
  const f=await worktreeFixture(t),current=await f.backend.dispatch('read-config',{});
  assertInterfaceShape('ReadConfig',wire(current));
  const saved=await f.backend.dispatch('config-save',{config:current.config,baseRevision:current.revision});
  assertInterfaceShape('SaveV2',wire(saved));
  assert.equal(saved.revision,createHash('sha256').update(await readFile(join(f.home,'config.json'))).digest('hex'));
  assert.throws(()=>assertInterfaceShape('ReadConfig',{config:wire(current.config)}));
  assert.throws(()=>assertInterfaceShape('ReadConfig',{...wire(current),revision:'present-but-invalid'}));
  assert.throws(()=>assertInterfaceShape('ReadConfig',{...wire(current),unexpected:true}));
  await assert.rejects(f.backend.dispatch('config-save',{config:saved.config}),{code:'BASE_REVISION_REQUIRED'});
});

test('migration contracts distinguish conversion, replay and already-v2 without inventing a baseRevision',async t=>{
  const f=await worktreeFixture(t),legacy={version:1,projects:[{key:'legacy',teamId:'team-fixture',projectId:'project-fixture',repo:f.repo,preferredAgent:'codex',mainBranch:'main',machine:null,tests:{}}]};
  await f.write('config.json',legacy);
  const savedV1=await f.backend.dispatch('config-save',{config:legacy});assertInterfaceShape('SaveV1',wire(savedV1));assert.equal(Object.hasOwn(savedV1,'revision'),false);
  const source=await readFile(join(f.home,'config.json'));
  const input={confirmed:true,worktreesRoot:join(f.root,'converted-worktrees')};
  const migrated=await f.backend.dispatch('config-migrate',input);assertInterfaceShape('Migration',wire(migrated));assert.equal(migrated.status,'migrated');
  assert.equal(migrated.sourceHash,createHash('sha256').update(source).digest('hex'));assert.equal(Object.hasOwn(migrated,'revision'),false);
  assert.equal(migrated.config.profiles.version,'unconfigured');assert.equal(migrated.config.projects[0].repos[0].key,'legacy');
  const replay=await f.backend.dispatch('config-migrate',input);assertInterfaceShape('Migration',wire(replay));assert.equal(replay.status,'already-migrated');
  const fresh=await worktreeFixture(t),already=await fresh.backend.dispatch('config-migrate',{confirmed:true});
  assertInterfaceShape('Migration',wire(already));assert.equal(already.status,'already-v2');
});

test('repository preview contracts preserve caller provenance and distinguish its refusal shape',async t=>{
  const f=await worktreeFixture(t),issue=f.issues.get('one');
  const result=await f.backend.dispatch('repo-preview',{issue});assertInterfaceShape('Preview',wire(result));
  assert.equal(result.source,"ticket fourni par l'appelant");assert.equal(result.launchAllowed,false);assert.equal(result.repository.path,f.repo);
  const refused=await f.backend.dispatch('repo-preview',{issue:{...issue,team:null}});assertInterfaceShape('PreviewRefusal',wire(refused));
  assert.equal(refused.code,'TEAM_REQUIRED');assert.equal(Object.hasOwn(refused,'agentLaunched'),false);
});

test('plan, preparation, replay, reconciliation and release response contracts remain distinct',async t=>{
  const f=await worktreeFixture(t),plan=await f.plan();assertInterfaceShape('Plan',wire(plan));assert.equal(plan.issue.identifier,'fix-1');
  assert.deepEqual(plan.base.verification,{status:'verified',reason:null});assert.equal(plan.agentLaunched,false);
  const prepared=await f.prepare(plan);assertInterfaceShape('PreparationResult',wire(prepared));assert.equal(prepared.status,'prepared');assert.equal(prepared.agentLaunched,false);
  assert.deepEqual(wire(prepared.preparation.base),wire(plan.base));
  const replay=await f.prepare(plan);assertInterfaceShape('PreparationResult',wire(replay));assert.equal(replay.reused,true);assert.equal(replay.preparationId,prepared.preparationId);
  const proof=await f.backend.dispatch('worktree-reconcile',{preparationId:prepared.preparationId});assertInterfaceShape('PreparationResult',wire(proof));assert.equal(proof.proof,'prepared');
  const released=await f.backend.dispatch('worktree-release',{preparationId:prepared.preparationId,confirmed:true,expectedHash:proof.preparationHash});
  assertInterfaceShape('PreparationResult',wire(released));assert.equal(released.status,'released');assert.equal(Object.hasOwn(released,'proof'),false);
  const observed=await f.backend.dispatch('worktree-reconcile',{preparationId:prepared.preparationId});assertInterfaceShape('PreparationResult',wire(observed));assert.equal(observed.status,'released');
  const blocked=await f.plan();assertInterfaceShape('Refusal',wire(blocked));assert.equal(blocked.code,'BRANCH_COLLISION');
});

test('empty-directory cleanup contract exposes exact commands and retains explicit release',async t=>{
  const f=await emptyWorkspaceFixture(t);
  await f.store.update(state=>{state.attempts[0].updatedAt=state.attempts[0].createdAt;});
  const proof=await f.backend.dispatch('worktree-reconcile',{preparationId:f.id});assertInterfaceShape('PreparationResult',wire(proof));
  assertInterfaceShape('CleanupProposal',wire(proof.cleanupProposal));assert.deepEqual(proof.cleanupProposal.commands,[{program:'rmdir',argv:[f.worktree]}]);
  const result=await f.backend.dispatch('worktree-cleanup',{preparationId:f.id,confirmed:true,expectedHash:proof.cleanupProposal.hash});
  assertInterfaceShape('PreparationResult',wire(result));assert.equal(result.status,'failed-certain');assert.equal(result.automaticRelease,false);
  const released=await f.backend.dispatch('worktree-release',{preparationId:f.id,confirmed:true,expectedHash:result.preparationHash});assert.equal(released.status,'released');
});

test('base confirmation refusal contract includes the exact manifest and observed base',async t=>{
  const f=await worktreeFixture(t);await f.commit(f.peer,'remote advance');await f.publish();
  const plan=await f.plan();assertInterfaceShape('Plan',wire(plan));assert.equal(plan.needsConfirmation,true);
  const result=await f.prepare(plan);assertInterfaceShape('Refusal',wire(result));assert.equal(result.code,'BASE_CONFIRMATION_REQUIRED');
  assert.equal(result.planId,plan.planId);assert.equal(result.manifestHash,plan.manifestHash);assert.equal(result.base.chosenSha,plan.base.chosenSha);
});

test('forced reservation response contract remains explicit for an older unprovable identity',async t=>{
  const f=await emptyWorkspaceFixture(t);
  await f.store.update(state=>{const attempt=state.attempts[0];attempt.updatedAt=attempt.createdAt;delete attempt.repositoryIdentity;delete attempt.plan.repositoryIdentity;});
  const proof=await f.backend.dispatch('worktree-reconcile',{preparationId:f.id});assertInterfaceShape('PreparationResult',wire(proof));assert.equal(proof.status,'uncertain');
  const result=await f.backend.dispatch('worktree-release',{preparationId:f.id,force:true,confirmed:true,expectedHash:proof.preparationHash});
  assertInterfaceShape('PreparationResult',wire(result));assert.equal(result.status,'released');assert.equal(result.forced,true);
});

test('an older stored preparation base remains a historical snapshot without new verification metadata',async t=>{
  const f=await emptyWorkspaceFixture(t);
  await f.store.update(state=>{
    const attempt=state.attempts[0];attempt.updatedAt=attempt.createdAt;
    delete attempt.base.verification;delete attempt.plan.base.verification;
  });
  const result=await f.backend.dispatch('worktree-reconcile',{preparationId:f.id});
  assertInterfaceShape('PreparationResult',wire(result));assert.equal(result.status,'failed-certain');
  assert.equal(Object.hasOwn(result.preparation.base,'verification'),false);
});

test('fetch inspection and confirmed abandonment contracts retain the exact current fingerprint',async t=>{
  const f=await worktreeFixture(t),store=createWorkspaceState(f.home);
  const backend=createBackend({root:f.home,exec:f.exec,tracker:f.tracker,workspaceOptions:{fetchProof:{bootId:async()=> 'fixture-boot',birth:async()=> null,alive:()=>true}}});
  assertInterfaceShape('FetchInspection',await backend.dispatch('fetch-inspect',{}));
  await store.update(state=>{state.fetches=[{id:'fixture-intention',gitCommonDir:join(f.repo,'.git'),status:'uncertain',createdAt:new Date().toISOString(),bootId:'fixture-boot',owner:{pid:765432,birth:null},ownerActive:false,worker:{pid:765433,pgid:765433,birth:null,nonce:'fixture'}}];});
  const inspected=await backend.dispatch('fetch-inspect',{});assertInterfaceShape('FetchInspection',wire(inspected));
  const item=inspected.fetches[0],input={fetchId:item.id,confirmed:true,expectedHash:item.confirmationHash};
  const refused=await backend.dispatch('fetch-abandon',{...input,confirmed:false});assertInterfaceShape('Refusal',wire(refused));assert.equal(refused.code,'CONFIRMATION_REQUIRED');
  const abandoned=await backend.dispatch('fetch-abandon',input);assertInterfaceShape('FetchAbandoned',wire(abandoned));assert.equal(abandoned.audit.expectedHash,item.confirmationHash);
  assert.deepEqual((await backend.dispatch('fetch-inspect',{})).fetches,[]);
});

test('snapshot compatibility projection and the v2 launch block are contractual without launching agents',async t=>{
  const f=await worktreeFixture(t),snapshot=await f.backend.dispatch('snapshot',{});assertInterfaceShape('Snapshot',wire(snapshot));
  assert.equal(snapshot.projects[0].repo,f.repo);assert.deepEqual(snapshot.sessions,[]);
  f.config.projects[0].repos.push({...f.config.projects[0].repos[0],key:'other',path:join(f.root,'unavailable-other-repository')});await f.write('config.json',f.config);
  const multiple=await f.backend.dispatch('snapshot',{});assertInterfaceShape('Snapshot',wire(multiple));
  assert.equal(multiple.projects[0].repo,null);assert.equal(multiple.projects[0].mainBranch,null);assert.deepEqual(multiple.projects[0].tests,{});
  await assert.rejects(f.backend.dispatch('launch',{issueId:'one',tool:'codex'}),{code:'CONFIG_V2_LAUNCH_UNAVAILABLE'});
  assert.equal(f.trackerCalls.length,0);
});

test('the actual CLI distinguishes success, business refusal and typed error envelopes',async t=>{
  const f=await worktreeFixture(t),cli=fileURLToPath(new URL('../src/cli.mjs',import.meta.url)),options={env:{...process.env,FABRIQUE_CONSOLE_HOME:f.home}};
  const read=await f.command(process.execPath,[cli,'read-config','{}'],options),result=JSON.parse(read.stdout);
  assert.deepEqual(Object.keys(result).sort(),['data','ok']);assert.equal(result.ok,true);assertInterfaceShape('ReadConfig',result.data);
  const refusal=JSON.parse((await f.command(process.execPath,[cli,'worktree-cleanup','{"confirmed":false}'],options)).stdout);
  assert.equal(refusal.ok,true);assertInterfaceShape('Refusal',refusal.data);assert.equal(refusal.data.code,'CONFIRMATION_REQUIRED');
  let failure;try{await f.command(process.execPath,[cli,'unknown-contract-action','{}'],options);}catch(error){failure=error;}
  assert.equal(failure.code,1);const body=JSON.parse(failure.stdout);assert.deepEqual(Object.keys(body).sort(),['error','ok']);
  assert.equal(body.ok,false);assert.deepEqual(Object.keys(body.error).sort(),['code','message']);assert.equal(body.error.code,'UNKNOWN_ACTION');assert.equal(typeof body.error.message,'string');
});
