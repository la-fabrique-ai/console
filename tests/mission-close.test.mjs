import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, realpath, chmod, lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBackend } from '../src/backend.mjs';
import { createMissionRegistry } from '../src/mission.mjs';
import { createMissionClose } from '../src/mission-close.mjs';
import { createLeadWake } from '../src/lead-wake.mjs';
import { createDevFlow } from '../src/dev-flow.mjs';
import { createStorage } from '../src/state.mjs';
import { fakeHerdr } from './helpers/fake-herdr.mjs';

const HEAD='a'.repeat(40),BASE='b'.repeat(40),NEW='c'.repeat(40);
// External executables alone are simulated. Mission storage, QA reading, dispatch, locks and Lead sends stay real.
// No child process, network request or real repository is available through this boundary.
async function fixture(t) {
  const root=await realpath(await mkdtemp(join(tmpdir(),'fabrique-console-close-auto-'))),worktree=join(root,'worktree');
  t.after(()=>rm(root,{recursive:true,force:true}));
  await mkdir(join(worktree,'.git'),{recursive:true});await mkdir(join(worktree,'.fabrique-console'));
  const registry=createMissionRegistry({root}),session={id:'s1',role:'lead',missionId:'M-1',terminalId:'t7',worktree,branch:'xj-1',base:'origin/release',projectKey:'example',identifier:'XJ-1',issueId:'i1'};
  await writeFile(join(root,'state.json'),JSON.stringify({version:1,sessions:[session]}));
  await writeFile(join(root,'config.json'),JSON.stringify({version:1,projects:[{key:'example',repo:worktree,mainBranch:'main',machine:null,preferredAgent:'codex',teamId:'team',tests:{}}]}));
  await registry.create({project:'example',issue:{id:'i1',identifier:'XJ-1',title:'Let customers pay'},request:'r',lead:{sessionId:'s1'},worktree,branch:'xj-1',base:'origin/release',step:'validating',tldr:'Customers can pay securely.'});
  let qa={verdict:'ok',summary:'Checked',tests:[{id:'1',title:'Pay',auto:'ok'},{id:'2',title:'Refund',auto:'skipped'}]};
  let marks={'2':{result:'ok'}};
  const saveQA=()=>writeFile(join(worktree,'.fabrique-console','qa.json'),JSON.stringify(qa));
  const saveMarks=()=>writeFile(join(worktree,'.fabrique-console','validation.json'),JSON.stringify(marks));
  await saveQA();await saveMarks();
  const remote={branch:'xj-1',head:HEAD,base:BASE,pushed:null,pr:null,checks:[],mergeable:'MERGEABLE',behind:false,dirty:false,unreadable:false,lose:null,apply:true,events:[]},calls=[],remotes=new Map([[worktree,remote]]);
  const ok=stdout=>({stdout:String(stdout),stderr:''});
  const lost=(remote,step)=>{if(remote.lose===step){remote.lose=null;throw Object.assign(new Error('Transport response lost'),{killed:true});}};
  const mutate=async(remote,step,act)=>{remote.events.push(step);if(remote.reject===step)throw Object.assign(new Error('Command rejected'),{code:1,stderr:remote.rejection});if(remote.apply)await act();await remote.afterMutation?.(step);lost(remote,step);return ok('');};
  const exec=async(file,argv,options)=>{
    calls.push({file,argv,options});assert.equal(options.shell,false,'all subprocesses must use argv without a shell');
    assert.ok(!argv.includes('--force')&&!argv.includes('--delete'),'closure never forces or deletes a remote branch');
    const path=argv[0]==='-C'?argv[1]:options.cwd,remote=remotes.get(path);
    assert.ok(remote,'only explicitly mapped repositories are accessed');
    const a=argv[0]==='-C'?argv.slice(2):argv;
    if(file==='git') {
      if(a[0]==='check-ref-format')return ok('');
      if(a[0]==='status')return ok(remote.dirty?' M src/pay.mjs':'');
      if(a[0]==='symbolic-ref')return ok(a.includes('HEAD')?'xj-1':'origin/main');
      if(a[0]==='rev-parse') {
        if(a.includes('--show-toplevel'))return ok(path);
        if(a.includes('--git-common-dir'))return ok(join(path,'.git'));
        if(a.includes('--abbrev-ref'))return ok(remote.branch);
        const ref=a.at(-1);
        if(ref==='HEAD'||ref==='refs/heads/xj-1'||ref==='xj-1')return ok(remote.head);
        if(ref.includes('release'))return ok(remote.base);
        if(ref.includes('origin/xj-1')&&remote.pushed)return ok(remote.pushed);
        throw Object.assign(new Error('Unknown ref'),{code:1});
      }
      if(a[0]==='ls-remote') {
        if(remote.unreadable)throw new Error('Remote unavailable');
        return ok(a.at(-1).includes('release')?remote.base+'\trefs/heads/release\n':remote.pushed?remote.pushed+'\trefs/heads/xj-1\n':'');
      }
      if(a[0]==='fetch'){remote.fetched=true;return ok('');}
      if(a[0]==='merge-base'){if(remote.requireFetch&&!remote.fetched||remote.missingBase)throw Object.assign(new Error('Not a valid commit name'),{code:128});if(remote.behind)throw Object.assign(new Error('Not an ancestor'),{code:1});return ok(remote.base);}
      if(a[0]==='rev-list')return ok(a.includes('--left-right')?'0\t1':'1');
      if(a[0]==='remote')return ok(a.includes('--push')&&remote.pushurl?remote.pushurl:remote.origin??'https://github.com/example/project.git');
      if(a[0]==='push')return mutate(remote,'push',()=>{remote.pushed=remote.head;if(remote.afterPush)remote.afterPush();});
    }
    if(file==='gh') {
      if(remote.unreadable)throw new Error('GitHub unavailable');
      if(a[0]==='pr'&&a[1]==='list')await remote.onList?.();
      const pr=remote.pr&&{...remote.pr,headRefOid:remote.pushed,headRefName:remote.branch,baseRefName:'release',mergeable:remote.mergeable,mergeStateStatus:remote.behind?'BEHIND':'CLEAN',statusCheckRollup:remote.checks,isDraft:false};
      if(a[0]==='pr'&&a[1]==='list')return ok(JSON.stringify(pr?[pr]:[]));
      if(a[0]==='pr'&&a[1]==='view')return ok(JSON.stringify(pr));
      if(a[0]==='pr'&&a[1]==='checks')return ok(JSON.stringify(remote.checks));
      if(a[0]==='pr'&&a[1]==='create')return mutate(remote,'pr',()=>{remote.pr={number:17,url:'https://github.com/example/project/pull/17',state:'OPEN'};if(!remote.emptyAfterCreate&&!remote.checks.length)remote.checks=[{status:'COMPLETED',conclusion:'SUCCESS'}];});
      if(a[0]==='pr'&&a[1]==='merge')return mutate(remote,'merge',()=>{remote.pr.state='MERGED';});
    }
    throw new Error('Unexpected simulated executable: '+file+' '+a.join(' '));
  };
  const model=fakeHerdr({agents:[{address:'t7',space:'sp1',tab:'tab7',tab_name:'XJ-1 · Lead',status:'idle'}]});
  const messages=[],h=fakeHerdr({on:async(file,args,options)=>{if(file==='hc'&&args[0]==='send'){messages.push(args);return ok('{}');}return model.invoke(file,args,options);}});
  const tracker={configured:async()=>true,detail:async()=>({issue:{id:'i1',identifier:'XJ-1',description:'',team:{id:'team'}}}),mutate:async()=>assert.fail('The closure engine must never write Tracker')};
  const backend=()=>createBackend({root,exec,tracker,herdr:h.herdr,traceAgents:false,env:{}});
  let b=backend();
  const dispatch=(action,input={})=>b.dispatch(action,{mission:'M-1',...input});
  const addRepo=async(name,values={})=>{const path=join(worktree,name);await mkdir(join(path,'.git'),{recursive:true});const state={...remote,events:[],...values};remotes.set(path,state);return state;};
  const closeEngine=options=>{
    const storage=createStorage({root}),flow=createDevFlow({herdr:h.herdr,loadState:storage.loadState});
    const engine=createMissionClose({root,registry,invoke:(file,args,opts)=>exec(file,args,{...opts,shell:false}),
      validation:flow.validation,close:input=>dispatch('mission-close',input),...options});
    return {check:()=>engine.check({mission:'M-1'}),approve:seen=>engine.approve({mission:'M-1',seen})};
  };
  return {root,worktree,registry,remote,calls,qa,marks,saveQA,saveMarks,dispatch,addRepo,h,messages,exec,
    closeEngine,
    check:()=>dispatch('mission-close-check'),approve:seen=>dispatch('mission-approve-close',{seen}),
    restart:()=>{b=backend();},raw:()=>readFile(registry.fileOf('M-1'),'utf8')};
}

test('close-check is read only and ready without a PR, using the mission release base',async t=>{
  const f=await fixture(t),before=await f.raw(),r=await f.check();
  assert.equal(r.ready,true);assert.equal(r.base,'release');assert.match(r.seen,/^[a-f0-9]{64}$/);
  assert.equal(r.repositories.length,1);assert.equal(r.rows.length,5);assert.ok(r.rows.every(row=>row.ok));
  assert.ok(r.rows.every(row=>typeof row.key==='string'&&typeof row.detail==='string'));
  assert.deepEqual(r.rows,[
    {key:'qa',ok:true,detail:'2 QA points'},
    {key:'judgments',ok:true,detail:'2/2 checked'},
    {key:'problems',ok:true,detail:'0 problems, 0 tickets'},
    {key:f.worktree+':branch',ok:true,detail:'Up to date',repo:'worktree'},
    {key:f.worktree+':checks',ok:true,detail:'No PR yet',repo:'worktree'},
  ]);
  assert.equal(await f.raw(),before);assert.deepEqual(f.remote.events,[]);
});

test('long repository names stay separate from short checklist details',async t=>{
  const f=await fixture(t),repo='repository-with-a-name-longer-than-the-detail-column';
  await f.addRepo(repo,{dirty:true});
  const r=await f.check(),path=join(f.worktree,repo);
  assert.deepEqual(r.rows.filter(row=>row.repo===repo),[
    {key:path+':branch',ok:false,detail:'Uncommitted changes',repo},
    {key:path+':checks',ok:true,detail:'No PR yet',repo},
  ]);
  assert.ok(r.rows.every(row=>row.detail.length<=25));
});

for(const [name,change] of [
  ['QA has not finished',async f=>{f.qa.verdict=null;f.qa.tests=[];await f.saveQA();}],
  ['one point is not judged',async f=>{delete f.marks['2'];await f.saveMarks();}],
  ['one problem is unresolved',async f=>{f.marks['2']={result:'ko',note:'Refund failed'};await f.saveMarks();}],
  ['the target is not an ancestor of the branch',async f=>{f.remote.behind=true;}],
  ['the remote cannot be read',async f=>{f.remote.unreadable=true;}],
  ['the worktree has uncommitted changes',async f=>{f.remote.dirty=true;}],
])test('closure refuses when '+name,async t=>{
  const f=await fixture(t);await change(f);const r=await f.check();assert.equal(r.ready,false);
  await assert.rejects(()=>f.approve(r.seen));assert.deepEqual(f.remote.events,[]);
  assert.equal((await f.registry.read('M-1')).closeAskedAt,undefined);
});

for(const conclusion of ['FAILURE','CANCELLED','TIMED_OUT','ACTION_REQUIRED',null])test('PR checks block closure for '+conclusion,async t=>{
  const f=await fixture(t);f.remote.pr={number:17,state:'OPEN'};f.remote.pushed=HEAD;
  f.remote.checks=[{__typename:'CheckRun',name:'tests',status:conclusion?'COMPLETED':'IN_PROGRESS',conclusion}];
  assert.equal((await f.check()).ready,false);assert.deepEqual(f.remote.events,[]);
});

for(const conclusion of ['SKIPPED','NEUTRAL'])test('PR checks permit closure for '+conclusion,async t=>{
  const f=await fixture(t);f.remote.pr={number:17,state:'OPEN'};f.remote.pushed=HEAD;
  f.remote.checks=[{status:'COMPLETED',conclusion}];
  const r=await f.check();assert.equal(r.ready,true);await f.approve(r.seen);
  assert.equal(f.remote.pr.state,'MERGED');
});

test('an existing PR with no CI reports no checks and permits closure',async t=>{
  const f=await fixture(t);f.remote.pr={number:17,state:'OPEN'};f.remote.pushed=HEAD;
  const r=await f.check();assert.equal(r.ready,true);assert.match(JSON.stringify(r),/no checks/i);
});

test('green PR checks show the actual successful count',async t=>{
  const f=await fixture(t);f.remote.pr={number:17,state:'OPEN'};f.remote.pushed=HEAD;
  f.remote.checks=['tests','lint'].map(name=>({__typename:'CheckRun',name,status:'COMPLETED',conclusion:'SUCCESS'}));
  const r=await f.check();assert.equal(r.ready,true);assert.match(JSON.stringify(r),/2\/2/);
});

test('an old checklist cannot authorize a changed mission head',async t=>{
  const f=await fixture(t),r=await f.check();f.remote.head=NEW;
  await assert.rejects(()=>f.approve(r.seen));assert.deepEqual(f.remote.events,[]);
});

test('a different origin pushurl cannot receive an approved push',async t=>{
  const f=await fixture(t);f.remote.pushurl='https://github.com/other/unapproved.git';
  const r=await f.check();assert.equal(r.ready,false);assert.match(JSON.stringify(r),/Push destination changed/);
  await assert.rejects(()=>f.approve(r.seen));assert.deepEqual(f.remote.events,[]);
});

test('credential-bearing origins never enter closure responses, records or journals',async t=>{
  const f=await fixture(t),before=await f.check(),secret='fake-closure-secret-123';
  f.remote.origin='https:'+'//fixture:'+secret+'@github.com/example/project.git';
  const checked=await f.check();
  let rejected;
  await assert.rejects(()=>f.approve(before.seen),error=>{rejected={code:error.code,message:error.message};return true;});
  const mission=await f.registry.read('M-1');
  for(const [surface,value] of Object.entries({check:checked,approve:rejected,closure:mission.closure,log:mission.log,stored:await f.raw()})) {
    assert.ok(!JSON.stringify(value)?.includes(secret),surface+' must not contain origin credentials');
  }
  assert.equal(checked.ready,false);assert.deepEqual(f.remote.events,[]);assert.equal(f.messages.length,0);
});

test('an open PR on the previous head permits a fast-forward push and checks the new head',async t=>{
  const f=await fixture(t);f.remote.pr={number:17,state:'OPEN'};f.remote.pushed=BASE;
  f.remote.checks=[{status:'COMPLETED',conclusion:'FAILURE'}];
  f.remote.afterPush=()=>{f.remote.checks=[{status:'COMPLETED',conclusion:'SUCCESS'}];};
  const r=await f.check();assert.equal(r.ready,true);await f.approve(r.seen);
  assert.deepEqual(f.remote.events,['push','merge']);assert.equal(f.remote.pushed,HEAD);
  const merge=f.calls.find(c=>c.file==='gh'&&c.argv[1]==='merge').argv;
  assert.equal(merge[merge.indexOf('--match-head-commit')+1],HEAD);
});

test('the target is fetched locally before the ancestry check',async t=>{
  const f=await fixture(t);f.remote.requireFetch=true;
  assert.equal((await f.check()).ready,true);
  const fetch=f.calls.findIndex(c=>c.file==='git'&&c.argv[2]==='fetch'),ancestor=f.calls.findIndex(c=>c.file==='git'&&c.argv[2]==='merge-base');
  assert.ok(fetch>=0&&fetch<ancestor);assert.deepEqual(f.remote.events,[]);
});

test('a missing base commit is reported as target not verified',async t=>{
  const f=await fixture(t);f.remote.missingBase=true;
  const r=await f.check();assert.equal(r.ready,false);assert.match(JSON.stringify(r),/Target not verified/);
});

test('one approval pushes, creates the PR toward release, merges and asks the Lead to close',async t=>{
  const f=await fixture(t),r=await f.check();await f.approve(r.seen);
  assert.equal(f.remote.pushed,HEAD);assert.equal(f.remote.pr.state,'MERGED');
  assert.deepEqual(f.remote.events,['push','pr','merge']);
  const create=f.calls.find(c=>c.file==='gh'&&c.argv[1]==='create').argv;
  assert.equal(create[create.indexOf('--base')+1],'release');
  assert.match(create[create.indexOf('--title')+1],/Let customers pay/);
  assert.equal(create[create.indexOf('--body')+1],'Customers can pay securely.');
  assert.ok(f.calls.find(c=>c.file==='gh'&&c.argv[1]==='merge').argv.includes('--merge'));
  const m=await f.registry.read('M-1');assert.ok(m.closeAskedAt);assert.equal(m.step,'validating');
  assert.match(JSON.stringify(m),/17/,'the PR is recorded for the screen');
  await f.dispatch('lead-close');assert.equal((await f.registry.read('M-1')).step,'closed');
});

for(const step of ['push','pr','merge'])test('a lost '+step+' response is reconciled after restart without duplicating the operation',async t=>{
  const f=await fixture(t),r=await f.check();f.remote.lose=step;
  await assert.rejects(()=>f.approve(r.seen),error=>error.code==='CLOSE_UNCERTAIN'&&error.message===`worktree: The result of ${step==='pr'?'PR creation':step} is unknown. Check its actual state and review the checklist before approving again. Nothing is retried automatically.`);f.restart();
  await f.approve((await f.check()).seen);
  assert.equal(f.remote.pr?.state,'MERGED');assert.equal(f.remote.events.filter(s=>s===step).length,1);
  assert.ok((await f.registry.read('M-1')).closeAskedAt);
});

test('a lost push proven absent can be retried only with a fresh approval',async t=>{
  const f=await fixture(t),r=await f.check();f.remote.lose='push';f.remote.apply=false;
  await assert.rejects(()=>f.approve(r.seen),e=>e.code==='CLOSE_UNCERTAIN');f.restart();
  await assert.rejects(()=>f.approve(r.seen),e=>e.code==='CLOSE_CHANGED');
  f.remote.apply=true;const again=await f.check();assert.equal(again.ready,true);await f.approve(again.seen);
  assert.equal(f.remote.events.filter(s=>s==='push').length,2);assert.equal(f.remote.pr.state,'MERGED');
});

test('two approval clicks cannot create two PRs or merge twice',async t=>{
  const f=await fixture(t),r=await f.check();
  await Promise.allSettled([f.approve(r.seen),f.approve(r.seen)]);
  assert.equal(f.remote.pr?.state,'MERGED');assert.deepEqual(f.remote.events,['push','pr','merge']);
});

test('reopen requires a nonblank bounded reason and a closed mission',async t=>{
  const f=await fixture(t);
  await assert.rejects(()=>f.dispatch('mission-reopen',{reason:'Refund regression'}),e=>e.code==='MISSION_NOT_CLOSED');
  await f.registry.setStep('M-1','closed');
  for(const reason of [undefined,'','   ','x'.repeat(2001)])await assert.rejects(()=>f.dispatch('mission-reopen',{reason}),e=>e.code==='INVALID_ARGUMENT');
  assert.equal((await f.registry.read('M-1')).step,'closed');assert.deepEqual(f.remote.events,[]);
});

test('reopen records its reason, returns to Validate and invalidates the old close request without changing git',async t=>{
  const f=await fixture(t);
  await f.registry.update('M-1',m=>{m.step='closed';m.closeAskedAt='2026-11-17T10:00:00Z';});
  await f.dispatch('mission-reopen',{reason:' Refund regression '});
  const m=await f.registry.read('M-1');assert.equal(m.step,'validating');assert.equal(m.closeAskedAt,undefined);
  assert.match(m.log.at(-1).text,/Refund regression/);assert.deepEqual(f.remote.events,[]);
  await assert.rejects(()=>f.dispatch('lead-close'),'an old close request cannot close the reopened mission');
});

// These catch accepting pending checks, ignoring a repository, or resending a GitHub operation of uncertain outcome.
test('pending CI reports successful and pending counts and refuses approval',async t=>{
  const f=await fixture(t);f.remote.pr={number:17,state:'OPEN'};f.remote.pushed=HEAD;
  f.remote.checks=[{name:'lint',status:'COMPLETED',conclusion:'SUCCESS'},{name:'tests',status:'IN_PROGRESS',conclusion:null}];
  const r=await f.check();assert.equal(r.ready,false);assert.match(JSON.stringify(r),/1\/2 · 1 pending/);
  await assert.rejects(()=>f.approve(r.seen));assert.deepEqual(f.remote.events,[]);
});

test('a PR merge conflict blocks even when the local branch contains the target',async t=>{
  const f=await fixture(t);f.remote.pr={number:17,state:'OPEN'};f.remote.pushed=HEAD;f.remote.mergeable='CONFLICTING';
  const r=await f.check();assert.equal(r.ready,false);await assert.rejects(()=>f.approve(r.seen));assert.deepEqual(f.remote.events,[]);
});

test('no repository on the mission branch is an explicit refusal',async t=>{
  const f=await fixture(t);f.remote.branch='other';const r=await f.check();
  assert.equal(r.ready,false);assert.match(JSON.stringify(r),/No mission repository/);assert.equal(r.repositories.length,0);
});

test('multiple repositories include one already merged without merging it again',async t=>{
  const f=await fixture(t);const other=await f.addRepo('api',{pushed:HEAD,pr:{number:23,state:'MERGED'}});
  const r=await f.check();assert.equal(r.repositories.length,2);assert.equal(r.ready,true);
  await f.approve(r.seen);assert.deepEqual(other.events,[]);assert.equal(f.remote.pr.state,'MERGED');assert.ok((await f.registry.read('M-1')).closeAskedAt);
});

for(const step of ['pr','merge'])test('a lost '+step+' proven absent permits a second explicit approval',async t=>{
  const f=await fixture(t);
  if(step==='merge'){f.remote.pushed=HEAD;f.remote.pr={number:17,state:'OPEN'};}
  else f.remote.pushed=HEAD;
  const r=await f.check();f.remote.lose=step;f.remote.apply=false;
  await f.approve(r.seen).catch(()=>{});f.restart();const again=await f.check();
  assert.equal(again.ready,true);f.remote.apply=true;
  await f.approve(again.seen);assert.equal(f.remote.events.filter(x=>x===step).length,2);
  assert.ok((await f.registry.read('M-1')).closeAskedAt);
});

for(const rejection of ['! [rejected] non-fast-forward','fatal: Authentication failed'])test('a definite push refusal is failed: '+rejection,async t=>{
  const f=await fixture(t);f.remote.reject='push';f.remote.rejection=rejection;
  const ready=await f.check();await assert.rejects(()=>f.approve(ready.seen),e=>e.code==='CLOSE_FAILED'&&e.message===(rejection.includes('non-fast-forward')?'worktree: Push rejected: the remote branch has commits missing locally.':'worktree: push failed: authentication refused.'));
  const step=(await f.registry.read('M-1')).closure.repositories[0].push;
  assert.equal(step.status,'failed');assert.equal(step.reason,rejection.includes('non-fast-forward')?'Remote branch ahead':'Authentication refused');
  assert.deepEqual(f.remote.events,['push']);assert.equal((await f.check()).ready,true);
});

test('a lost operation stays blocking while real-state reconciliation fails',async t=>{
  const f=await fixture(t);f.remote.lose='push';f.remote.apply=false;
  await f.approve((await f.check()).seen).catch(()=>{});f.remote.unreadable=true;
  const again=await f.check();assert.equal(again.ready,false);assert.deepEqual(again.rows.find(row=>row.key===f.worktree+':push'),{key:f.worktree+':push',ok:false,detail:'Result unknown',repo:'worktree'});
  await assert.rejects(()=>f.approve(again.seen));assert.deepEqual(f.remote.events,['push']);
});

test('CI appearing after push prevents merge and the Lead close request',async t=>{
  const f=await fixture(t);f.remote.afterPush=()=>{f.remote.checks=[{name:'tests',status:'IN_PROGRESS',conclusion:null}];};
  await f.approve((await f.check()).seen).catch(()=>{});
  assert.ok(!f.remote.events.includes('merge'));assert.equal((await f.registry.read('M-1')).closeAskedAt,undefined);
});

for(const action of ['mission-approve-close','mission-reopen'])test(action+' refuses an orchestrated agent before acting',async t=>{
  const f=await fixture(t),b=createBackend({root:f.root,env:{FABRIQUE_CONSOLE_AGENT:'s-agent'},traceAgents:false});
  await assert.rejects(()=>b.dispatch(action,{mission:'M-1',seen:'a'.repeat(64),reason:'Regression'}),e=>e.code==='AGENT_SESSION');
  assert.deepEqual(f.remote.events,[]);
});

test('a changed QA judgment invalidates an earlier checklist',async t=>{
  const f=await fixture(t),before=await f.check();f.marks['2']={result:'ko',note:'Broken'};await f.saveMarks();
  await assert.rejects(()=>f.approve(before.seen));assert.deepEqual(f.remote.events,[]);
});

test('a dirty nested repository blocks the whole mission',async t=>{
  const f=await fixture(t);await f.addRepo('api',{dirty:true});const r=await f.check();
  assert.equal(r.ready,false);await assert.rejects(()=>f.approve(r.seen));assert.deepEqual(f.remote.events,[]);
});

test('accepted tickets already merged into the mission branch do not block closure',async t=>{
  const f=await fixture(t);await f.registry.update('M-1',m=>{m.tickets=[{id:'XJ-2',state:'merged',tracker:'started'}];});
  assert.equal((await f.check()).ready,true);
});

test('a QA problem corrected and judged OK by the user can be closed',async t=>{
  const f=await fixture(t);f.qa.verdict='problèmes';f.qa.tests[0].auto='ko';f.marks['1']={result:'ok'};await f.saveQA();await f.saveMarks();
  assert.equal((await f.check()).ready,true);
});

test('an umbrella folder without git does not hide its mission repositories',async t=>{
  const f=await fixture(t);await f.addRepo('api');await rm(join(f.worktree,'.git'),{recursive:true});
  const r=await f.check();assert.equal(r.ready,true);assert.equal(r.repositories.length,1);assert.equal(r.repositories[0].repo,'api');
});

test('EACCES discovering a nested repository blocks the mission',async t=>{
  const f=await fixture(t);await f.addRepo('private');const folder=join(f.worktree,'private');
  await chmod(folder,0);
  try {
    await assert.rejects(()=>lstat(join(folder,'.git')),e=>e.code==='EACCES');
    const r=await f.check();assert.equal(r.ready,false);assert.match(JSON.stringify(r),/Repositories unreadable/);
    await assert.rejects(()=>f.approve(r.seen));assert.deepEqual(f.remote.events,[]);
  } finally {await chmod(folder,0o700);}
});

test('reopening refuses if another mission is already active on this issue',async t=>{
  const f=await fixture(t);await f.registry.setStep('M-1','closed');
  await f.registry.create({project:'example',issue:{id:'i1'},step:'building'});
  await assert.rejects(()=>f.dispatch('mission-reopen',{reason:'Regression'}));
  assert.equal((await f.registry.read('M-1')).step,'closed');assert.equal(f.messages.length,0);
});

test('a lost PR response requires a fresh checklist approval after reconciliation',async t=>{
  const f=await fixture(t),r=await f.check();f.remote.lose='pr';
  await assert.rejects(()=>f.approve(r.seen),e=>e.code==='CLOSE_UNCERTAIN');
  assert.equal(f.remote.pr.state,'OPEN');assert.equal((await f.registry.read('M-1')).closeAskedAt,undefined);
  await assert.rejects(()=>f.approve(r.seen),e=>e.code==='CLOSE_CHANGED');
  await f.approve((await f.check()).seen);assert.equal(f.remote.events.filter(x=>x==='pr').length,1);
});


for(const resting of ['restedAt','closedOutAt'])test('reopen wakes a Lead marked '+resting+' before sending the reason',async t=>{
  const f=await fixture(t),storage=createStorage({root:f.root});
  await f.registry.update('M-1',m=>{m.step='closed';m.lead[resting]='2026-11-17T20:00:00Z';});
  const woken=[],flow=createDevFlow({herdr:f.h.herdr,loadState:storage.loadState});
  const send=createLeadWake({root:f.root,missions:f.registry,loadState:storage.loadState,send:flow.send,leadLaunch:async()=>{
    woken.push('M-1');const state=await storage.loadState();state.sessions[0].terminalId='t9';
    await writeFile(join(f.root,'state.json'),JSON.stringify(state));await f.registry.update('M-1',m=>{delete m.lead.restedAt;});
    return {session:{id:'s1',terminalId:'t9'}};
  }});
  const engine=createMissionClose({root:f.root,registry:f.registry,loadState:storage.loadState,send});
  await engine.reopen({mission:'M-1',reason:'Refund regression'});
  assert.deepEqual(woken,['M-1']);assert.ok(f.messages.some(args=>args.includes('t9')&&args.some(a=>a.includes(f.registry.fileOf('M-1')))));
  assert.equal((await f.registry.read('M-1')).step,'validating');assert.deepEqual(f.remote.events,[]);
});

test('reopen preserves the delivery record as history while removing its previous approval',async t=>{
  const f=await fixture(t);await f.approve((await f.check()).seen);await f.dispatch('lead-close');
  await f.dispatch('mission-reopen',{reason:'Refund regression'});
  const m=await f.registry.read('M-1');assert.equal(m.closure,undefined);assert.equal(m.closureHistory.at(-1).repositories[0].pullRequest.number,17);
});

test('an approval from before reopen never authorizes the next closure cycle',async t=>{
  const f=await fixture(t);f.remote.pr={number:17,state:'MERGED'};f.remote.pushed=HEAD;
  const before=await f.check();await f.approve(before.seen);await f.dispatch('lead-close');
  await f.dispatch('mission-reopen',{reason:'Recheck'});
  await assert.rejects(()=>f.approve(before.seen),e=>e.code==='CLOSE_CHANGED');
  assert.notEqual((await f.check()).seen,before.seen);assert.deepEqual(f.remote.events,[]);
});

for(const state of ['send-failed','stopped','absent'])test('reopen stays in Validate when the Lead is '+state,async t=>{
  const f=await fixture(t);await f.registry.setStep('M-1','closed');
  const storage=createStorage({root:f.root}),snapshot=await storage.loadState();
  if(state==='absent')snapshot.sessions=[];
  if(state==='stopped')snapshot.sessions[0].stoppedAt='2026-11-17T20:00:00Z';
  await writeFile(join(f.root,'state.json'),JSON.stringify(snapshot));
  const engine=createMissionClose({root:f.root,registry:f.registry,loadState:storage.loadState,send:async()=>{throw new Error('send failed');}});
  const result=await engine.reopen({mission:'M-1',reason:'Recheck refunds'});
  assert.equal(result.reopened,true);assert.match(result.warning,/Lead/);
  const m=await f.registry.read('M-1');assert.equal(m.step,'validating');assert.match(m.log.at(-1).text,/The mission is back in Validate\. The Lead could not be notified\./);
  assert.match(JSON.stringify(m.log),/Recheck refunds/);assert.deepEqual(f.remote.events,[]);
});

test('reopen succeeds even when both Lead notification and warning persistence fail',async t=>{
  const f=await fixture(t);await f.registry.setStep('M-1','closed');
  const storage=createStorage({root:f.root});let writes=0;
  const engine=createMissionClose({root:f.root,loadState:storage.loadState,
    registry:{...f.registry,update:async(...args)=>{if(++writes===2)throw new Error('Warning write failed');return f.registry.update(...args);}},
    send:async()=>{throw new Error('Lead notification failed');},
  });
  const result=await engine.reopen({mission:'M-1',reason:'Recheck refunds'});
  assert.equal(writes,2);assert.equal(result.reopened,true);assert.equal(result.step,'validating');assert.match(result.warning,/The mission is back in Validate\. The Lead could not be notified\./);
  const mission=await f.registry.read('M-1');assert.equal(mission.step,'validating');assert.match(mission.log.at(-1).text,/Recheck refunds/);
  assert.deepEqual(f.remote.events,[]);
});

test('a missing closure record returns a controlled error after publication',async t=>{
  const f=await fixture(t);f.remote.afterMutation=async step=>{if(step==='push')await f.registry.update('M-1',m=>{delete m.closure;});};
  const r=await f.check();await assert.rejects(()=>f.approve(r.seen),e=>e.code==='CLOSE_CHANGED'&&!(e instanceof TypeError));
  assert.deepEqual(f.remote.events,['push']);
});

for(const change of ['qa','marks','tickets'])test('approval rechecks '+change+' before merging under the closure lock',async t=>{
  const f=await fixture(t);
  f.remote.afterMutation=async step=>{if(step!=='pr')return;
    if(change==='qa'){f.qa.verdict='ko';await f.saveQA();}
    if(change==='marks'){f.marks['2']={result:'ko'};await f.saveMarks();}
    if(change==='tickets')await f.registry.update('M-1',m=>{m.tickets=[{id:'XJ-2',state:'open'}];});
  };
  const r=await f.check();await assert.rejects(()=>f.approve(r.seen),e=>e.code==='CLOSE_CHANGED');
  assert.deepEqual(f.remote.events,['push','pr']);assert.equal((await f.registry.read('M-1')).closeAskedAt,undefined);
});

test('QA changed after merging prevents the Lead close request',async t=>{
  const f=await fixture(t);f.remote.afterMutation=async step=>{if(step==='merge'){f.marks['1']={result:'ko'};await f.saveMarks();}};
  const r=await f.check();await assert.rejects(()=>f.approve(r.seen),e=>e.code==='CLOSE_CHANGED');
  assert.equal(f.remote.pr.state,'MERGED');assert.equal((await f.registry.read('M-1')).closeAskedAt,undefined);
});

test('QA is checked again before merging each repository',async t=>{
  const f=await fixture(t),other=await f.addRepo('api');
  f.remote.afterMutation=async step=>{if(step==='merge'){f.marks['1']={result:'ko'};await f.saveMarks();}};
  const r=await f.check();await assert.rejects(()=>f.approve(r.seen),e=>e.code==='CLOSE_CHANGED');
  assert.equal(f.remote.pr.state,'MERGED');assert.ok(!other.events.includes('merge'));
  assert.equal((await f.registry.read('M-1')).closeAskedAt,undefined);
});

for(const publish of ['pr','push'])test('CI registered after 20 simulated seconds after '+publish+' is awaited before merging',async t=>{
  const f=await fixture(t);f.remote.emptyAfterCreate=true;
  if(publish==='push'){f.remote.pr={number:17,state:'OPEN'};f.remote.pushed=BASE;}
  let elapsed=0;
  const engine=f.closeEngine({now:()=>elapsed,sleep:async ms=>{elapsed+=ms;}});
  f.remote.onList=()=>{if(elapsed>=20000)f.remote.checks=[{status:'COMPLETED',conclusion:'SUCCESS'}];};
  const r=await engine.check();await engine.approve(r.seen);
  assert.equal(elapsed,20000);assert.equal(f.remote.pr.state,'MERGED');
  assert.deepEqual(f.remote.events,publish==='pr'?['push','pr','merge']:['push','merge']);
  assert.ok((await f.registry.read('M-1')).closeAskedAt);
});

for(const publish of ['pr','push'])for(const budget of [60000,23])test('empty checks after '+publish+' require another approval after '+budget+' simulated ms',async t=>{
  const f=await fixture(t);f.remote.emptyAfterCreate=true;
  if(publish==='push'){f.remote.pr={number:17,state:'OPEN'};f.remote.pushed=BASE;}
  let elapsed=0;
  const engine=f.closeEngine({now:()=>elapsed,sleep:async ms=>{elapsed+=ms;},...(budget===23?{checksWaitMs:23,checksPollMs:5}:{})});
  const r=await engine.check();await assert.rejects(()=>engine.approve(r.seen),e=>e.code==='CLOSE_NOT_READY'&&e.message==='worktree: GitHub checks are not registered yet. Review the checklist and approve again before merging.');
  assert.equal(elapsed,budget);
  assert.deepEqual((await f.registry.read('M-1')).closure.repositories[0].checks,{ok:false,detail:'Checks not registered'});
  assert.ok(!f.remote.events.includes('merge'));assert.equal((await f.registry.read('M-1')).closeAskedAt,undefined);
  const again=await engine.check();assert.equal(again.ready,true);await engine.approve(again.seen);
  assert.equal(f.remote.pr.state,'MERGED');assert.equal(f.remote.events.filter(s=>s==='push').length,1);
});

for(const conclusion of ['SUCCESS',null])test('new PR checks are reread while registration is delayed: '+conclusion,async t=>{
  const f=await fixture(t);f.remote.emptyAfterCreate=true;let reads=0;
  let elapsed=0;
  const engine=f.closeEngine({checksWaitMs:60,checksPollMs:5,now:()=>elapsed,sleep:async ms=>{elapsed+=ms;}});
  f.remote.onList=()=>{if(f.remote.events.includes('pr')&&++reads>=3)f.remote.checks=[{status:conclusion?'COMPLETED':'IN_PROGRESS',conclusion}];};
  f.remote.afterMutation=step=>{if(step==='merge')assert.ok(reads>=3,'CI must be reread before merging');};
  const r=await engine.check();
  if(conclusion)await engine.approve(r.seen);else await assert.rejects(()=>engine.approve(r.seen),e=>e.code==='CLOSE_NOT_READY');
  assert.ok(reads>=3);assert.equal(f.remote.events.includes('merge'),Boolean(conclusion));
});

for(const field of ['branch','base'])test('a mission '+field+' starting with a dash is refused before invoking git',async t=>{
  const f=await fixture(t);await f.registry.update('M-1',m=>{m[field]='-untrusted';});
  const r=await f.check();assert.equal(r.ready,false);await assert.rejects(()=>f.approve(r.seen));
  assert.equal(f.calls.length,0);assert.deepEqual(f.remote.events,[]);
});

test('the base advancing after approval prevents merging',async t=>{
  const f=await fixture(t);f.remote.afterMutation=step=>{if(step==='pr')f.remote.base=NEW;};
  const r=await f.check();await assert.rejects(()=>f.approve(r.seen),e=>e.code==='CLOSE_NOT_READY');
  assert.deepEqual(f.remote.events,['push','pr']);assert.equal((await f.registry.read('M-1')).closeAskedAt,undefined);
});

for(const moment of ['QA reread','merge record save','ancestry change'])test('the final merge guard blocks a base change during '+moment,async t=>{
  const f=await fixture(t),storage=createStorage({root:f.root});
  const flow=createDevFlow({herdr:f.h.herdr,loadState:storage.loadState});
  const move=()=>{if(moment==='ancestry change')f.remote.behind=true;else f.remote.base=NEW;};
  let changed=false;
  const engine=createMissionClose({root:f.root,
    registry:{...f.registry,update:async(...args)=>{
      const result=await f.registry.update(...args);
      if(moment==='merge record save'&&(await f.registry.read('M-1')).closure?.repositories[0].merge?.status==='asking'){move();changed=true;}
      return result;
    }},
    invoke:(file,args,options)=>f.exec(file,args,{...options,shell:false}),
    validation:async input=>{
      const result=await flow.validation(input);
      if(moment!=='merge record save'&&f.remote.events.includes('pr')){move();changed=true;}
      return result;
    },
    close:input=>f.dispatch('mission-close',input),
  });
  const checklist=await engine.check({mission:'M-1'});
  await assert.rejects(()=>engine.approve({mission:'M-1',seen:checklist.seen}),error=>error.code==='CLOSE_NOT_READY'&&(moment==='ancestry change'||error.message==='worktree: The target branch changed. Review the checklist and approve again before merging.'));
  assert.equal(changed,true);assert.deepEqual(f.remote.events,['push','pr']);assert.equal(f.remote.pr.state,'OPEN');
  const mission=await f.registry.read('M-1');assert.equal(mission.closeAskedAt,undefined);assert.equal(f.messages.length,0);
  assert.equal(mission.closure.repositories[0].merge.status,'failed');
  if(moment!=='ancestry change')assert.equal(mission.closure.repositories[0].branchDetail,'Target branch changed');
});

test('an uncertain delivery record from before origin was persisted can still be reconciled',async t=>{
  const f=await fixture(t);f.remote.lose='push';await f.approve((await f.check()).seen).catch(()=>{});
  await f.registry.update('M-1',m=>{delete m.closure.repositories[0].origin;});
  const r=await f.check();assert.equal(r.ready,true);await f.approve(r.seen);
  assert.equal(f.remote.events.filter(s=>s==='push').length,1);assert.equal(f.remote.pr.state,'MERGED');
});
