import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile,readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { worktreeFixture } from './helpers/worktree-fixture.mjs';

test('an advertised known promisor cannot change the source repository configuration during observation',async t=>{
  const f=await worktreeFixture(t);await f.commit(f.peer,'remote change');await f.publish();
  const setups=[
    [f.remote,{'promisor.advertise':'true','promisor.sendFields':'partialCloneFilter','remote.objects.promisor':'true','remote.objects.url':f.remote,'remote.objects.partialCloneFilter':'blob:limit=20k'}],
    [f.repo,{'protocol.version':'2','remote.objects.promisor':'true','remote.objects.url':f.remote,'remote.objects.partialCloneFilter':'blob:none','promisor.acceptFromServer':'knownUrl','promisor.storeFields':'partialCloneFilter'}],
  ];
  for(const [cwd,settings] of setups) {
    for(const [key,value] of Object.entries(settings))await f.command('git',['-C',cwd,'config',key,value]);
  }
  const before=await readFile(join(f.repo,'.git','config')),result=await f.plan();
  assert.equal(result.status,'planned');assert.equal(result.base.fetch.status,'succeeded');
  assert.deepEqual(await readFile(join(f.repo,'.git','config')),before,'Remote advertisement must not update even an already configured promisor filter.');
  assert.deepEqual(result.base.fetch.writes,['objects','temporary-locks']);
});

test('preparing a partial clone checks the checkout tree without fetching historical blobs',async t=>{
  const f=await worktreeFixture(t);await writeFile(join(f.peer,'historical'),'historical payload');await f.command('git',['-C',f.peer,'add','historical']);
  await f.commit(f.peer,'old tree');const historical=(await f.command('git',['-C',f.peer,'rev-parse','HEAD:historical'])).stdout.trim();
  await f.command('git',['-C',f.peer,'rm','historical']);await writeFile(join(f.peer,'current'),'current payload');await f.command('git',['-C',f.peer,'add','current']);await f.commit(f.peer,'current tree');await f.publish();
  await f.command('git',['-C',f.remote,'config','uploadpack.allowFilter','true']);
  const partial=join(f.root,'partial');await f.command('git',['clone','--filter=blob:none','--no-checkout','file://'+f.remote,partial]);
  await f.command('git',['-C',partial,'checkout','main']);
  await assert.rejects(f.command('git',['-C',partial,'--no-lazy-fetch','cat-file','-e',historical]));
  f.config.projects[0].repos[0].path=partial;await f.write('config.json',f.config);
  const plan=await f.plan();assert.equal(plan.status,'planned');assert.equal((await f.prepare(plan)).status,'prepared');
  await assert.rejects(f.command('git',['-C',partial,'--no-lazy-fetch','cat-file','-e',historical]),'A historical blob irrelevant to the target tree must remain absent.');
});

test('a shallow preview reports successful object download separately from its unverified relation',async t=>{
  const f=await worktreeFixture(t);await f.commit(f.peer,'remote first');await f.publish();
  const shallow=join(f.root,'shallow');await f.command('git',['clone','--depth=1','file://'+f.remote,shallow]);
  f.config.projects[0].repos[0].path=shallow;await f.write('config.json',f.config);
  const result=await f.plan();assert.equal(result.status,'planned');assert.equal(result.base.fetch.status,'succeeded');
  assert.equal(result.base.verified,false);assert.deepEqual(result.base.verification,{status:'unverified',reason:'shallow-repository'});
  assert.equal(result.base.options.some(option=>option.source==='origin'),false);
});
