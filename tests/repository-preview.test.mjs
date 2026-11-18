import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir,symlink,readFile,rename } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { previewFixture,treeEvidence } from './helpers/repository-preview-fixture.mjs';

for(const [project,repo,labels] of [
  ['alpha','workspace',['workspace']],['alpha','app',['app']],['alpha','website',['website']],
  ['gamma','admin',['admin']],['gamma','specs',['specs']],
  ['delta','app',['web','packages','infra']],['delta','admin',['admin']],
  ['beta','app',[]],['lba','app',[]],
])test(`preview resolves ${project}/${repo} from its explicit mapping`,async t=>{
  const f=await previewFixture(t),result=await f.preview(f.ticket(project,labels));
  assert.equal(result.status,'resolved');assert.equal(result.projectKey,project);
  assert.equal(result.repository.key,repo);assert.equal(result.repository.path,f.paths[project][repo==='app'&&!['alpha','gamma','delta'].includes(project)?'workspace':repo]);
  assert.match(result.repository.gitCommonDir,/\.git$/);assert.equal(result.repository.mainBranch,'main');
  assert.equal(result.repository.configVerification,'required');assert.equal(result.repository.mainBranchChecked,false);assert.equal(result.launchAllowed,false);
  assert.equal(result.source,"ticket fourni par l'appelant");assert.equal(result.issueUpdatedAt,null);
  assert.equal(result.selection,labels.length?'labels':'single-repository');
  assert.equal(result.configRevision,createHash('sha256').update(await readFile(join(f.home,'config.json'))).digest('hex'));
});

test('several ID/name aliases of one monorepo select one repository once',async t=>{
  const f=await previewFixture(t),project=f.config.projects.find(p=>p.key==='delta');
  project.repos.find(r=>r.key==='app').labels=['label-web'];await f.write('config.json',f.config);
  const result=await f.preview(f.ticket('delta',['web','packages','infra','packages']));
  assert.equal(result.status,'resolved');assert.equal(result.repository.key,'app');
  assert.deepEqual(result.matchedLabels,['infra','label-web','packages']);
});

test('two labels for distinct Git repositories cannot choose a repository',async t=>{
  const f=await previewFixture(t),result=await f.preview(f.ticket('alpha',['admin','specs']));
  assert.equal(result.status,'refused');assert.equal(result.code,'REPO_AMBIGUOUS');
  assert.deepEqual(result.candidates,['admin','specs']);
});

test('an alias shared with the historical admin repository remains ambiguous',async t=>{
  const f=await previewFixture(t);f.config.projects.find(p=>p.key==='delta').repos.find(r=>r.key==='app').aliases.push('admin');await f.write('config.json',f.config);
  const result=await f.preview(f.ticket('delta',['admin']));assert.equal(result.code,'REPO_AMBIGUOUS');
});

for(const labels of [[],['bug']])test(`multi-repository project needs a recognized repository label (${labels.join()||'none'})`,async t=>{
  const f=await previewFixture(t),result=await f.preview(f.ticket('gamma',labels));
  assert.equal(result.status,'refused');assert.equal(result.code,'REPO_LABEL_REQUIRED');assert.equal(f.commands.length,0);
});

test('a foreign team cannot use an otherwise matching project and repository label',async t=>{
  const f=await previewFixture(t),issue=f.ticket('alpha',['app']);issue.team.id='team-foreign';
  const result=await f.preview(issue);assert.equal(result.code,'TEAM_NOT_AUTHORIZED');assert.equal(f.commands.length,0);
});

test('a project restriction is enforced after the team match',async t=>{
  const f=await previewFixture(t),issue=f.ticket('alpha',['app']);issue.project.id='project-other';
  assert.equal((await f.preview(issue)).code,'PROJECT_NOT_AUTHORIZED');assert.equal(f.commands.length,0);
});

test('an explicitly team-wide mapping accepts tickets outside a Tracker project',async t=>{
  const f=await previewFixture(t);delete f.config.projects.find(p=>p.key==='beta').projectId;await f.write('config.json',f.config);
  const issue=f.ticket('beta');issue.project=null;
  assert.equal((await f.preview(issue)).status,'resolved');
});

for(const [mutation,code] of [
  [issue=>{delete issue.team;},'TEAM_REQUIRED'],
  [issue=>{delete issue.project;},'PROJECT_REQUIRED'],
  [issue=>{issue.project=null;},'PROJECT_REQUIRED'],
])test(`incomplete issue ownership is refused as ${code}`,async t=>{
  const f=await previewFixture(t),issue=f.ticket('alpha',['app']);mutation(issue);
  assert.equal((await f.preview(issue)).code,code);assert.equal(f.commands.length,0);
});

test('a project-only configuration cannot infer the authorized team',async t=>{
  const f=await previewFixture(t);delete f.config.projects.find(p=>p.key==='alpha').teamId;await f.write('config.json',f.config);
  assert.equal((await f.preview(f.ticket('alpha',['app']))).code,'TEAM_NOT_CONFIGURED');assert.equal(f.commands.length,0);
});

test('overlapping team/project mappings are refused rather than selected by order',async t=>{
  const f=await previewFixture(t),project=structuredClone(f.config.projects.find(p=>p.key==='beta'));project.key='beta-wide';delete project.projectId;
  f.config.projects.push(project);await f.write('config.json',f.config);
  assert.equal((await f.preview(f.ticket('beta'))).code,'AMBIGUOUS_PROJECT');assert.equal(f.commands.length,0);
});

test('a subfolder of a Git checkout is not an independent repository',async t=>{
  const f=await previewFixture(t),sub=join(f.paths.delta.app,'apps','web');
  f.config.projects.find(p=>p.key==='delta').repos.find(r=>r.key==='app').path=sub;await f.write('config.json',f.config);
  assert.equal((await f.preview(f.ticket('delta',['web']))).code,'REPO_NOT_ROOT');
});

test('a disappeared selected repository is refused and not replaced by the workspace',async t=>{
  const f=await previewFixture(t);f.config.projects[0].repos.find(r=>r.key==='app').path=join(f.root,'missing');await f.write('config.json',f.config);
  assert.equal((await f.preview(f.ticket('alpha',['app']))).code,'REPO_UNAVAILABLE');
});

test('an unrelated missing repository does not block a valid explicit selection',async t=>{
  const f=await previewFixture(t);f.config.projects[0].repos.find(r=>r.key==='specs').path=join(f.root,'missing');await f.write('config.json',f.config);
  assert.equal((await f.preview(f.ticket('alpha',['app']))).status,'resolved');
});

test('an ambiguous selection is refused before checking candidate availability',async t=>{
  const f=await previewFixture(t);f.config.projects[0].repos.find(r=>r.key==='specs').path=join(f.root,'missing');await f.write('config.json',f.config);
  assert.equal((await f.preview(f.ticket('alpha',['app','specs']))).code,'REPO_AMBIGUOUS');assert.equal(f.commands.length,0);
});

test('a plain directory is not a Git repository',async t=>{
  const f=await previewFixture(t),path=join(f.root,'not-git');await mkdir(path);
  f.config.projects[0].repos.find(r=>r.key==='app').path=path;await f.write('config.json',f.config);
  assert.equal((await f.preview(f.ticket('alpha',['app']))).code,'REPO_UNAVAILABLE');
});

test('a configured symlink resolves to the native checkout root',async t=>{
  const f=await previewFixture(t),path=join(f.root,'alias');await symlink(f.paths.alpha.app,path);
  f.config.projects[0].repos.find(r=>r.key==='app').path=path;await f.write('config.json',f.config);
  assert.equal((await f.preview(f.ticket('alpha',['app']))).repository.path,f.paths.alpha.app);
});

test('a detached checkout remains a repository independently of its current branch',async t=>{
  const f=await previewFixture(t),path=f.paths.gamma.specs;
  await f.command('git',['-C',path,'-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','--allow-empty','-m','fixture']);
  await f.command('git',['-C',path,'checkout','--detach']);
  assert.equal((await f.preview(f.ticket('gamma',['specs']))).status,'resolved');
});

test('two configured keys remain ambiguous without probing even their shared physical Git',async t=>{
  const f=await previewFixture(t),linked=join(f.root,'linked');
  await f.command('git',['-C',f.repo,'worktree','add','-b','fixture-linked',linked]);
  f.config.projects[0].repos.push({key:'linked',path:linked,labels:['linked'],mainBranch:'main',tests:{}});await f.write('config.json',f.config);
  assert.equal((await f.preview(f.ticket('alpha',['workspace','linked']))).code,'REPO_AMBIGUOUS');assert.equal(f.commands.length,0);
});

test('a linked checkout selected alone exposes its canonical shared Git identity',async t=>{
  const f=await previewFixture(t),linked=join(f.root,'linked');
  await f.command('git',['-C',f.repo,'worktree','add','-b','fixture-linked',linked]);
  f.config.projects[0].repos.push({key:'linked',path:linked,labels:['linked'],mainBranch:'main',tests:{}});await f.write('config.json',f.config);
  const result=await f.preview(f.ticket('alpha',['linked']));
  assert.equal(result.status,'resolved');assert.equal(result.repository.path,linked);assert.equal(result.repository.gitCommonDir,join(f.repo,'.git'));
});

test('a bare Git repository is distinguished from an unavailable directory',async t=>{
  const f=await previewFixture(t),path=join(f.root,'bare');await f.command('git',['init','--bare',path]);
  f.config.projects[0].repos.find(r=>r.key==='app').path=path;await f.write('config.json',f.config);
  assert.equal((await f.preview(f.ticket('alpha',['app']))).code,'REPO_NOT_WORKTREE');
});

test('single-repository selection does not require labels even if unrelated labels are present',async t=>{
  const f=await previewFixture(t),result=await f.preview(f.ticket('lba',['admin','website','foreign']));
  assert.equal(result.status,'resolved');assert.equal(result.selection,'single-repository');assert.equal(result.repository.path,f.paths.lba.workspace);
});

test('the preview reflects the caller timestamp without asserting that it observed Tracker',async t=>{
  const f=await previewFixture(t),issue=f.ticket('beta');issue.updatedAt='2026-11-06T10:20:00Z';
  const result=await f.preview(issue);assert.equal(result.issueUpdatedAt,'2026-11-06T10:20:00Z');assert.equal(result.source,"ticket fourni par l'appelant");
});

test('preview is repeatable without creating or modifying any fixture file, branch or worktree',async t=>{
  const f=await previewFixture(t),before=await treeEvidence(f.root);
  const optionalLocks=process.env.GIT_OPTIONAL_LOCKS;delete process.env.GIT_OPTIONAL_LOCKS;
  try {
    for(let i=0;i<2;i++) {
      assert.equal((await f.preview(f.ticket('delta',['web','packages']))).status,'resolved');
      assert.equal((await f.preview(f.ticket('alpha',['admin','specs']))).code,'REPO_AMBIGUOUS');
    }
  }finally{if(optionalLocks===undefined)delete process.env.GIT_OPTIONAL_LOCKS;else process.env.GIT_OPTIONAL_LOCKS=optionalLocks;}
  assert.deepEqual(await treeEvidence(f.root),before);assert.deepEqual(f.trackerCalls,[]);
  for(const {file,args,options} of f.commands) {
    assert.equal(file,'git');assert.equal(options.shell,false);assert.equal(args[0],'-C');assert.equal(args[2],'rev-parse');
    assert.ok(['--is-inside-work-tree','--show-toplevel','--git-common-dir'].includes(args[3]));assert.equal(args.length,4);
  }
});

test('untrusted issue text cannot choose an executable, option, repository path or profile',async t=>{
  const f=await previewFixture(t),issue=f.ticket('alpha',['app']);
  Object.assign(issue,{title:'$(touch injected)',branchName:'--upload-pack=hostile',tool:'evil',profile:{argv:['evil']},repo:'/tmp/evil'});
  assert.equal((await f.preview(issue)).repository.path,f.paths.alpha.app);
  const executed=JSON.stringify(f.commands.map(({file,args})=>({file,args})));
  assert.ok(!executed.includes('hostile'));assert.ok(!executed.includes('evil'));
});

test('a resolved path that the CLI would redact is refused instead of reported with an altered identity',async t=>{
  const f=await previewFixture(t),path=join(f.paths.alpha.workspace,'lin_api_docs'),alias=join(f.root,'safe-alias');
  await rename(f.paths.alpha.app,path);await symlink(path,alias);
  f.config.projects[0].repos.find(r=>r.key==='app').path=alias;await f.write('config.json',f.config);
  assert.equal((await f.preview(f.ticket('alpha',['app']))).code,'REPO_UNSAFE_PATH');
});

test('invalid issue payloads never reach Git',async t=>{
  const f=await previewFixture(t);
  for(const issue of [null,[],{}, {...f.ticket('alpha'),id:'x'.repeat(201)}, {...f.ticket('alpha'),team:'team'}, {...f.ticket('alpha'),project:{}}, {...f.ticket('alpha'),labels:'app'}, {...f.ticket('alpha'),labels:[{}]}, {...f.ticket('alpha'),labels:Array.from({length:101},()=>({name:'app'}))}, {...f.ticket('alpha'),labels:[{name:'app\n'}]}]) {
    await assert.rejects(f.preview(issue),{code:'INVALID_ARGUMENT'});
  }
  await assert.rejects(f.backend.dispatch('repo-preview',{issue:f.ticket('alpha',['app']),tool:'evil',argv:['evil'],path:'/tmp/evil'}),{code:'INVALID_ARGUMENT'});
  assert.equal(f.commands.length,0);
});

test('a null MCP team identifier is an explicit missing-team refusal',async t=>{
  const f=await previewFixture(t),issue=f.ticket('beta');issue.team.id=null;
  assert.equal((await f.preview(issue)).code,'TEAM_REQUIRED');assert.equal(f.commands.length,0);
});

test('name-only MCP labels match exactly with no case folding or trimming',async t=>{
  const f=await previewFixture(t),issue=f.ticket('alpha');issue.labels=[{name:'app'}];
  assert.equal((await f.preview(issue)).repository.key,'app');
  for(const name of ['App',' app','app ']){issue.labels=[{name}];assert.equal((await f.preview(issue)).code,'REPO_LABEL_REQUIRED');}
});

test('the pure selection function neither mutates its arguments nor requires Git or state files',async t=>{
  const f=await previewFixture(t),{previewRepository}=await import('../src/repository-preview.mjs');
  const issue=f.ticket('beta'),before=structuredClone({config:f.config,issue});
  const result=previewRepository(f.config,issue);
  assert.equal(result.status,'selected');assert.equal(result.repository.key,'app');
  assert.deepEqual({config:f.config,issue},before);assert.equal(f.commands.length,0);
});

test('preview CLI on absent configuration returns a refusal without even creating its home',async t=>{
  const f=await previewFixture(t),home=join(f.root,'absent-private'),before=await treeEvidence(f.root);
  const result=spawnSync(process.execPath,['src/cli.mjs','repo-preview',JSON.stringify({issue:f.ticket('beta')})],{encoding:'utf8',env:{...process.env,FABRIQUE_CONSOLE_HOME:home},timeout:5000});
  assert.equal(result.status,0,result.stderr);const body=JSON.parse(result.stdout);
  assert.equal(body.ok,true);assert.equal(body.data.code,'CONFIG_V2_REQUIRED');assert.equal(body.data.configRevision,null);
  assert.deepEqual(await treeEvidence(f.root),before);
});

test('resolving a V2 repository does not enable launching it',async t=>{
  const f=await previewFixture(t);assert.equal((await f.preview(f.ticket('alpha',['app']))).launchAllowed,false);
  await assert.rejects(f.backend.dispatch('launch',{issueId:'ticket-alpha',tool:'codex'}),{code:'CONFIG_V2_LAUNCH_UNAVAILABLE'});
  assert.deepEqual(f.trackerCalls,[]);
});
