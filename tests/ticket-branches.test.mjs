import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,realpath,mkdir,writeFile,readFile,rm,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {createBackend} from '../src/backend.mjs';
import {createIssueWorktree} from '../src/issue-worktree.mjs';
const execute=promisify(execFile),reportScript=fileURLToPath(new URL('../scripts/fabrique-console-report.mjs',import.meta.url));
async function fixture(t){
  const root=await realpath(await mkdtemp('/private/tmp/fabrique-console-ticket-branch-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const source=join(root,'project'),issue=join(root,'worktrees','project','XJ-100'),home=join(root,'private');await mkdir(source);await mkdir(home);
  const git=async(repo,args)=>(await execute('git',['-C',repo,...args],{encoding:'utf8',shell:false})).stdout.trim();
  for(const path of[source,join(source,'admin')]){
    await mkdir(path,{recursive:true});await git(path,['init','-b','main']);await git(path,['config','user.name','Fixture']);await git(path,['config','user.email','fixture@example.invalid']);
    await writeFile(join(path,'file.txt'),'base\n');if(path===source)await writeFile(join(path,'.gitignore'),'admin/\n.fabrique-console/\n');
    await git(path,['add','.']);await git(path,['commit','-m','base']);await git(path,['worktree','add','-b','xj-100',path===source?issue:join(issue,'admin'),'HEAD']);
  }
  await writeFile(join(home,'state.json'),JSON.stringify({version:1,sessions:[{id:'po',role:'po',repo:source,worktree:issue,branch:'xj-100',identifier:'XJ-100'}]}));
  const backend=createBackend({root:home}),prepare=(ticket='XJ-101')=>backend.dispatch('ticket-branch',{sessionId:'po',ticket}),merge=(ticket='XJ-101')=>backend.dispatch('ticket-merge',{sessionId:'po',ticket});
  const commit=async(path,text,file='file.txt')=>{await writeFile(join(path,file),text);await git(path,['add',file]);await git(path,['commit','-m','ticket work']);return git(path,['rev-parse','HEAD']);};
  const report=async(path,sha)=>JSON.parse((await execute(process.execPath,[reportScript,'dev','--ticket','XJ-101','--commit',sha,'--repo','admin','--summary','Done'],{cwd:path,encoding:'utf8',shell:false})).stdout);
  return{root,source,issue,home,git,backend,prepare,merge,commit,report};
}
test('ticket-branch creates and reuses a dedicated root and nested worktree from the current issue branches',async t=>{
  const f=await fixture(t),base=await f.commit(f.issue,'issue updated\n'),nestedBase=await f.git(join(f.issue,'admin'),['rev-parse','HEAD']),result=await f.prepare();
  assert.equal(result.path,join(f.root,'worktrees','project','XJ-100-XJ-101'));assert.equal(result.branch,'xj-100--xj-101');assert.equal(result.issueBranch,'xj-100');assert.equal(result.reused,false);
  assert.deepEqual(result.repositories.map(({repo,baseCommit})=>({repo,baseCommit})),[{repo:'.',baseCommit:base},{repo:'admin',baseCommit:nestedBase}]);
  for(const repo of['.','admin'])assert.equal(await f.git(join(result.path,repo),['branch','--show-current']),'xj-100--xj-101');
  const again=await f.prepare();assert.equal(again.reused,true);assert.equal(again.path,result.path);assert.equal(await f.git(f.issue,['branch','--show-current']),'xj-100');
});
test('accepted ticket commits fast-forward every touched repository without deleting any branch or worktree',async t=>{
  const f=await fixture(t),ticket=await f.prepare(),rootSha=await f.commit(ticket.path,'root work\n'),adminSha=await f.commit(join(ticket.path,'admin'),'admin work\n');
  const result=await f.merge();assert.equal(result.status,'merged');assert.deepEqual(result.merged.map(row=>row.repo),['.','admin']);
  assert.equal(await f.git(f.issue,['rev-parse','HEAD']),rootSha);assert.equal(await f.git(join(f.issue,'admin'),['rev-parse','HEAD']),adminSha);
  assert.equal((await stat(ticket.path)).isDirectory(),true);assert.equal(await f.git(ticket.path,['branch','--show-current']),ticket.branch);
  const replay=await f.merge();assert.equal(replay.status,'merged');assert.equal(replay.merged.length,0);
});
test('nonconflicting divergence merges and preserves both issue and ticket changes',async t=>{
  const f=await fixture(t),ticket=await f.prepare();await f.commit(f.issue,'issue\n','issue.txt');const ticketSha=await f.commit(ticket.path,'ticket\n','ticket.txt');
  const result=await f.merge();assert.equal(result.status,'merged');assert.equal(await readFile(join(f.issue,'issue.txt'),'utf8'),'issue\n');assert.equal(await readFile(join(f.issue,'ticket.txt'),'utf8'),'ticket\n');
  const parents=(await f.git(f.issue,['rev-list','--parents','-n','1','HEAD'])).split(' ');assert.equal(parents.length,3);assert.equal(parents[2],ticketSha);
});
test('a nested conflict leaves all issue branches, index and files unchanged, including a root that could merge',async t=>{
  const f=await fixture(t),ticket=await f.prepare();await f.commit(ticket.path,'root ticket\n','ticket.txt');await f.commit(join(ticket.path,'admin'),'ticket conflicting\n');await f.commit(join(f.issue,'admin'),'issue conflicting\n');
  const before=await f.git(f.issue,['rev-parse','HEAD']),adminBefore=await f.git(join(f.issue,'admin'),['rev-parse','HEAD']);
  const result=await f.merge();assert.equal(result.status,'conflict');assert.deepEqual(result.conflicts,[{repo:'admin',files:['file.txt']}]);assert.equal(result.merged.length,0);
  assert.equal(await f.git(f.issue,['rev-parse','HEAD']),before);assert.equal(await f.git(join(f.issue,'admin'),['rev-parse','HEAD']),adminBefore);
  assert.equal(await f.git(f.issue,['status','--porcelain']),'');assert.equal(await f.git(join(f.issue,'admin'),['status','--porcelain']),'');
  await assert.rejects(()=>f.git(join(f.issue,'admin'),['rev-parse','--verify','MERGE_HEAD']));assert.equal(await readFile(join(f.issue,'admin','file.txt'),'utf8'),'issue conflicting\n');
});
test('dirty issue content is preserved and refused before any merge',async t=>{
  const f=await fixture(t),ticket=await f.prepare();await f.commit(ticket.path,'ticket\n');await writeFile(join(f.issue,'file.txt'),'unfinished work\n');
  await assert.rejects(()=>f.merge(),{code:'WORKTREE_DIRTY'});assert.equal(await readFile(join(f.issue,'file.txt'),'utf8'),'unfinished work\n');
});
test('an existing unrelated destination is never adopted or removed',async t=>{
  const f=await fixture(t),target=join(f.root,'worktrees','project','XJ-100-XJ-101');await mkdir(target);await writeFile(join(target,'keep'),'personal work');
  await assert.rejects(()=>f.prepare(),{code:'WORKTREE_COLLISION'});assert.equal(await readFile(join(target,'keep'),'utf8'),'personal work');
});
test('the report command routes a ticket worktree report to the issue and exposes the precise review base',async t=>{
  const f=await fixture(t),ticket=await f.prepare(),base=ticket.repositories.find(row=>row.repo==='admin').baseCommit,sha=await f.commit(join(ticket.path,'admin'),'ticket admin\n');
  const result=await f.report(ticket.path,sha);assert.equal(result.ok,true);assert.equal(result.baseCommit,base);
  const reports=(await f.backend.dispatch('dev-reports',{sessionId:'po'})).reports;assert.equal(reports.length,1);assert.equal(reports[0].baseCommit,base);assert.equal(reports[0].commit,sha);assert.equal(reports[0].branch,ticket.branch);
  assert.equal(await f.git(join(ticket.path,'admin'),['diff','--name-only',base,sha]),'file.txt');assert.equal((await f.merge()).status,'merged');
});
test('a branch that advanced after its report is not merged as though that later work had been reviewed',async t=>{
  const f=await fixture(t),ticket=await f.prepare(),sha=await f.commit(join(ticket.path,'admin'),'reported\n');await f.report(ticket.path,sha);await f.commit(join(ticket.path,'admin'),'later unreviewed\n');
  await assert.rejects(()=>f.merge(),{code:'REPORT_STALE'});assert.equal(await readFile(join(f.issue,'admin','file.txt'),'utf8'),'base\n');
});
test('another PO session for the same issue reuses the ticket worktree and its frozen review base',async t=>{
  const f=await fixture(t),first=await f.prepare(),state=JSON.parse(await readFile(join(f.home,'state.json'),'utf8'));state.sessions[0].id='new-po';await writeFile(join(f.home,'state.json'),JSON.stringify(state));
  const next=await f.backend.dispatch('ticket-branch',{sessionId:'new-po',ticket:'XJ-101'});assert.equal(next.reused,true);assert.equal(next.path,first.path);assert.deepEqual(next.repositories,first.repositories);
});
test('a second ticket starts from the updated issue and its review diff excludes the first accepted ticket',async t=>{
  const f=await fixture(t),first=await f.prepare();await f.commit(first.path,'first ticket\n','first.txt');await f.merge();const issueHead=await f.git(f.issue,['rev-parse','HEAD']),second=await f.prepare('XJ-102');
  const base=second.repositories.find(row=>row.repo==='.').baseCommit;assert.equal(base,issueHead);const sha=await f.commit(second.path,'second ticket\n','second.txt');assert.equal(await f.git(second.path,['diff','--name-only',base,sha]),'second.txt');
});
test('the report command also works from a nested ticket repository and never silently reports another ticket',async t=>{
  const f=await fixture(t),ticket=await f.prepare(),sha=await f.commit(join(ticket.path,'admin'),'ticket\n');assert.equal((await f.report(join(ticket.path,'admin'),sha)).ok,true);
  await assert.rejects(()=>execute(process.execPath,[reportScript,'dev','--ticket','XJ-999','--commit',sha,'--repo','admin'],{cwd:ticket.path,encoding:'utf8',shell:false}),error=>JSON.parse(error.stdout).error.code==='WORKTREE_CHANGED');
});
test('a preexisting clean but unfinished merge is preserved rather than aborted by the layout',async t=>{
  const f=await fixture(t),ticket=await f.prepare();await f.commit(ticket.path,'ticket\n');
  await f.git(f.issue,['switch','-c','manual-pending']);await f.git(f.issue,['commit','--allow-empty','-m','manual pending']);const pending=await f.git(f.issue,['rev-parse','HEAD']);await f.git(f.issue,['switch','xj-100']);await f.git(f.issue,['merge','--no-ff','--no-commit','manual-pending']);assert.equal(await f.git(f.issue,['status','--porcelain']),'');
  const result=await f.merge().catch(error=>error);assert.equal(await f.git(f.issue,['rev-parse','--verify','MERGE_HEAD']),pending);assert.equal(result.code,'WORKTREE_DIRTY');
});
test('the layout refuses a wrong issue or ticket branch before merging into it',async t=>{
  for(const where of ['issue','ticket']){
    const f=await fixture(t),ticket=await f.prepare();await f.commit(ticket.path,'ticket\n');const path=where==='issue'?f.issue:ticket.path;await f.git(path,['switch','-c','manual-other']);
    await assert.rejects(()=>f.merge(),{code:'WORKTREE_CHANGED'});assert.equal(await f.git(path,['branch','--show-current']),'manual-other');
  }
});
test('the actual JSON CLI dispatches ticket-branch and ticket-merge against the fixture state',async t=>{
  const f=await fixture(t),cli=fileURLToPath(new URL('../src/cli.mjs',import.meta.url)),input=JSON.stringify({sessionId:'po',ticket:'XJ-101'}),env={...process.env,FABRIQUE_CONSOLE_HOME:f.home};
  const branch=JSON.parse((await execute(process.execPath,[cli,'ticket-branch',input],{env,encoding:'utf8',shell:false})).stdout);assert.equal(branch.ok,true);assert.equal(branch.data.branch,'xj-100--xj-101');
  await f.commit(branch.data.path,'cli work\n');const merge=JSON.parse((await execute(process.execPath,[cli,'ticket-merge',input],{env,encoding:'utf8',shell:false})).stdout);assert.equal(merge.ok,true);assert.equal(merge.data.status,'merged');assert.equal(await readFile(join(f.issue,'file.txt'),'utf8'),'cli work\n');
});
test('a Lead is served like the PO it replaces, and no other session is',async t=>{
  const f=await fixture(t),path=join(f.home,'state.json'),state=JSON.parse(await readFile(path,'utf8')),as=role=>{state.sessions[0].role=role;return writeFile(path,JSON.stringify(state));};
  await as('lead');
  assert.equal((await f.prepare()).branch,'xj-100--xj-101');
  assert.deepEqual((await f.backend.dispatch('dev-reports',{sessionId:'po'})).reports,[]);
  await as('pilot');
  await assert.rejects(()=>f.backend.dispatch('dev-reports',{sessionId:'po'}),e=>e.code==='NOT_FOUND');
  await assert.rejects(()=>f.prepare(),e=>e.code==='NOT_FOUND');
  const ensure=role=>createIssueWorktree({invoke:async()=>({stdout:''}),root:f.home,statePath:path,loadState:async()=>({sessions:[{id:'s',role,repo:'/nowhere'}]})}).ensure({sessionId:'s'});
  await assert.rejects(()=>ensure('lead'),/Git repository/);
  await assert.rejects(()=>ensure('pilot'),/PO session/);
});
