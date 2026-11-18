// The trial mode, from the inside: this suite runs only in the sandbox of the trial launcher (scripts/trial.mjs), which
// tests/trial-isolation.test.mjs starts. Every hole the two reviews of M17 found is a test here, and each is closed by
// the sandbox, not by a guard of the process: what the suite writes, reads or starts cannot leave the folder of the
// trial, so a regression cannot write, read or overwrite anything of the real home.
//
// What stays of M17 is tested too: the cross refusals of trialOf (a trial folder in real mode, the real folder in trial
// mode, an unmarked folder, a real agent, worktrees or a Herdr home of the machine), the simulated tracker, the journal,
// the agents named by absolute path, the worktrees under the root of the trial, the Herdr home of the trial.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, realpath, rm, symlink } from 'node:fs/promises';
import { readdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir, homedir, userInfo } from 'node:os';
import { join, basename } from 'node:path';
import childProcess, { execFile, spawn, spawnSync } from 'node:child_process';
import { request as httpRequest } from 'node:http';
import { connect } from 'node:net';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { createBackend } from '../../../../src/backend.mjs';
import { hcRunArgs } from '../../../../src/agents.mjs';
import { traceArgv } from '../../../../src/traces.mjs';
import { executeQA } from '../../../../src/qa-worker.mjs';
import { createMissionRegistry } from '../../../../src/mission.mjs';
import { trialExec } from '../../../../src/trial.mjs';

import { withFakeHerdr } from '../../../../tests/helpers/fake-herdr.mjs';
const run=promisify(execFile);
const here=path=>fileURLToPath(new URL(path,import.meta.url));
const CLI=here('../../../../src/cli.mjs'),WATCHER=here('../../../../src/watch-run.mjs');
// The folder of the launcher is the parent of its copy of Mission Control (<folder>/mc/tests/this file).
const realHome=userInfo().homedir,launcherFolder=here('../..');
const originals={fetch:globalThis.fetch,spawn:childProcess.spawn,execFile:childProcess.execFile};
const refusedCode=error=>['EPERM','EACCES'].includes(error?.code);
// Whether this process is in the sandbox of a trial: the real home cannot be listed, /private/tmp cannot be written.
function confinedHere() {
  try{readdirSync(realHome);return false;}catch(error){if(!refusedCode(error))return false;}
  try{writeFileSync(`/private/tmp/fabrique-console-suite-probe-${process.pid}`,'',{flag:'wx'});return false;}catch(error){return refusedCode(error);}
}
const script=async(path,body)=>writeFile(path,'#!/bin/sh\n'+body+'\n',{mode:0o755});
const lines=async path=>{try{return (await readFile(path,'utf8')).split('\n').filter(Boolean).map(line=>JSON.parse(line));}catch(error){if(error.code==='ENOENT')return [];throw error;}};
const issue={id:'iss-demo-1',identifier:'DEMO-1',title:'Trial issue',description:'Nothing real.',url:'https://example.invalid/DEMO-1',branchName:'tracker/demo-1',team:{id:'team-demo'},project:{id:'project-demo'},state:{id:'st-backlog',name:'Backlog',type:'backlog'},labels:[],comments:[],createdAt:'2026-11-13T10:00:00.000Z',updatedAt:'2026-11-13T10:00:00.000Z'};
const canary=()=>{try{return JSON.parse(readFileSync(join(launcherFolder,'canary.json'),'utf8'));}catch{return null;}};

// A trial whose folder is its state folder (trial/), inside the folder of the launcher: its agents, worktrees, Herdr
// home and repository live in it. `home` (realhome/, beside it) stands for the home of an account: its ~/.local/bin
// holds agents a trial must refuse to name.
async function fixture(t,{marked=true,trial={},config=true}={}) {
  const base=await realpath(await mkdtemp(join(tmpdir(),'fabrique-console-trial-')));
  t.after(()=>rm(base,{recursive:true,force:true}));
  const root=join(base,'trial');
  const f={base,root,home:join(base,'realhome'),agents:join(root,'agents'),worktrees:join(root,'worktrees'),appHome:join(root,'app'),repo:join(root,'repo-'+basename(base).toLowerCase()),hcLog:join(root,'hc.log')};
  for(const dir of [f.root,f.home,f.agents,f.worktrees,f.appHome,f.repo,join(f.home,'.local','bin')])await mkdir(dir,{recursive:true});
  for(const name of ['claude','codex']){await script(join(f.agents,name),'echo trial-agent');await script(join(f.home,'.local','bin',name),'echo OTHER-HOME');}
  await script(join(f.agents,'hc'),`printf '%s\\n' "$*" >> '${f.hcLog}'\ncase "$1" in ls) echo '{"terminals":[]}';; *) echo '{}';; esac`);
  await script(join(f.agents,'herdr-app'),`printf 'herdr-app %s\\n' "$*" >> '${f.hcLog}'\necho '{"spaces":[]}'`);
  f.trial={version:1,agents:{claude:join(f.agents,'claude'),codex:join(f.agents,'codex')},worktreesRoot:f.worktrees,hcSession:'dvtrial',herdrAppHome:f.appHome,hc:join(f.agents,'hc'),herdrApp:join(f.agents,'herdr-app'),...trial};
  if(marked)await writeFile(join(f.root,'trial.json'),JSON.stringify(f.trial));
  await writeFile(join(f.root,'tracker.json'),JSON.stringify({viewer:{id:'u-trial',name:'Trial'},teams:[{id:'team-demo',key:'DEMO',name:'Demo'}],projects:[],states:[{id:'st-backlog',name:'Backlog',type:'backlog',team:{id:'team-demo'}}],issues:[issue]}));
  if(config)await writeFile(join(f.root,'config.json'),JSON.stringify({version:1,tracker:{transport:'graphql'},projects:[{key:'demo',name:'Demo',teamId:'team-demo',repo:f.repo,preferredAgent:'codex',mainBranch:'main',machine:null,tests:{}}]}));
  f.env={FABRIQUE_CONSOLE_MC_TRIAL:'1'};
  f.processEnv=(extra={})=>({...process.env,FABRIQUE_CONSOLE_HOME:f.root,...extra});
  f.git=args=>run('git',['-C',f.repo,...args],{encoding:'utf8'});
  f.initRepo=async()=>{await f.git(['init','-b','main']);await f.git(['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','--allow-empty','-m','base']);};
  return f;
}
const recorder=()=>{const calls=[];const exec=async(file,args,options={})=>{calls.push({file,args,options});if(String(file).endsWith('hc')&&args[0]==='run')return {stdout:JSON.stringify({id:'t1',status:'idle'})};if(String(file).endsWith('hc'))return {stdout:'{"terminals":[]}'};throw Object.assign(new Error('refused by the test'),{code:1});};return {calls,exec};};
const cli=(action,input,env)=>new Promise(resolve=>{
  const child=spawn(process.execPath,[CLI,action,JSON.stringify(input)],{env,stdio:['ignore','pipe','pipe']});
  let out='';child.stdout.on('data',d=>{out+=d;});child.on('exit',code=>resolve({code,result:JSON.parse(out.trim().split('\n').pop()||'{}')}));
});
const qaRun=(f,argv)=>({id:'00000000-0000-4000-8000-000000000001',argv,cwd:f.base,timeoutMs:15000,status:'running',stdout:'',stderr:''});
const trialOfFixture=f=>({root:f.root,folder:f.root,home:join(f.root,'home'),...f.trial});

test('the suite runs in the sandbox of the trial launcher, never outside it',()=>{
  assert.ok(confinedHere(),'not in the sandbox of a trial: run it through tests/trial-isolation.test.mjs');
  assert.notEqual(homedir(),realHome,'HOME is the home of the trial');
});

test('a folder marked as a trial is refused in real mode, by the backend and by the CLI',async t=>{
  const f=await fixture(t);
  assert.throws(()=>createBackend({root:f.root,env:{},home:f.home}),{code:'TRIAL_MODE_REQUIRED'});
  const {code,result}=await cli('read-config',{},f.processEnv({FABRIQUE_CONSOLE_MC_TRIAL:''}));
  assert.equal(code,1);assert.equal(result.error.code,'TRIAL_MODE_REQUIRED');
});

test('trial mode refuses the real state folder and a folder without the mark',async t=>{
  const f=await fixture(t),real=join(f.home,'.config','fabrique-console');
  await mkdir(real,{recursive:true});await writeFile(join(real,'trial.json'),JSON.stringify(f.trial));
  assert.throws(()=>createBackend({root:real,env:f.env,home:f.home}),{code:'TRIAL_REAL_ROOT'});
  assert.throws(()=>createBackend({env:f.env,home:f.home}),{code:'TRIAL_REAL_ROOT'});
  const unmarked=await fixture(t,{marked:false});
  assert.throws(()=>createBackend({root:unmarked.root,env:unmarked.env,home:unmarked.home}),{code:'TRIAL_NOT_MARKED'});
  const {result}=await cli('read-config',{},unmarked.processEnv({FABRIQUE_CONSOLE_MC_TRIAL:'1'}));
  assert.equal(result.error.code,'TRIAL_NOT_MARKED');
});

test('a trial names its agents by absolute path, never a real agent, and keeps its worktrees off ~/Developer/worktrees',async t=>{
  const f=await fixture(t);
  assert.ok(createBackend({root:f.root,env:f.env,home:f.home}),'the fixture itself is a valid trial');
  const refusal=async(change,code)=>{
    const g=await fixture(t),trial={...g.trial,...await change(g)};
    await writeFile(join(g.root,'trial.json'),JSON.stringify(trial));
    assert.throws(()=>createBackend({root:g.root,env:g.env,home:g.home}),{code},JSON.stringify(trial));
  };
  await refusal(()=>({agents:{claude:'claude'}}),'TRIAL_INVALID');
  await refusal(g=>({agents:{codex:join(g.home,'.local','bin','codex')}}),'TRIAL_REAL_AGENT');
  await refusal(async g=>{const link=join(g.base,'linked-claude');await symlink(join(g.home,'.local','bin','claude'),link);return {agents:{claude:link}};},'TRIAL_REAL_AGENT');
  await refusal(g=>({worktreesRoot:join(g.home,'Developer','worktrees','demo')}),'TRIAL_INVALID');
  await refusal(g=>({herdrAppHome:join(g.home,'.config','herdr-app')}),'TRIAL_INVALID');
  await refusal(()=>({hcSession:''}),'TRIAL_INVALID');
});

test('a worktrees root that does not exist yet, under a link to ~/Developer/worktrees, is refused (review M17, 5)',async t=>{
  const f=await fixture(t);
  await mkdir(join(f.home,'Developer','worktrees'),{recursive:true});
  await symlink(join(f.home,'Developer','worktrees'),join(f.base,'link'));
  await writeFile(join(f.root,'trial.json'),JSON.stringify({...f.trial,worktreesRoot:join(f.base,'link','new','sub')}));
  assert.throws(()=>createBackend({root:f.root,env:f.env,home:f.home}),{code:'TRIAL_INVALID'});
});

test('a link placed in the folder of the trial and leading to the real ~/Developer/worktrees cannot be written through (review M17-2, 3)',async t=>{
  const f=await fixture(t),link=join(f.root,'out');
  await symlink(join(realHome,'Developer','worktrees'),link);
  await assert.rejects(writeFile(join(link,'fabrique-console-trial-never'),'x'),error=>refusedCode(error));
  await assert.rejects(mkdir(join(link,'fabrique-console-trial-never','sub'),{recursive:true}),error=>refusedCode(error));
});

test('the CLI in trial mode answers from the simulated tracker; an enriched read finds no key: the keychain is refused, no request made',async t=>{
  const f=await fixture(t);
  const {code,result}=await cli('ticket-detail',{id:'DEMO-1'},f.processEnv({FABRIQUE_CONSOLE_MC_TRIAL:'1'}));
  assert.equal(code,0,JSON.stringify(result));assert.equal(result.data.issue.title,'Trial issue');
  const list=await cli('ticket-my-issues',{},f.processEnv({FABRIQUE_CONSOLE_MC_TRIAL:'1'}));
  assert.equal(list.code,0,JSON.stringify(list.result));assert.deepEqual(list.result.data.activity.map(i=>i.identifier),['DEMO-1']);
  assert.ok((await lines(join(f.root,'trial-journal.jsonl'))).some(e=>e.kind==='tracker'&&e.call==='detail'));
  const enriched=await cli('ticket-issue-enriched',{key:'demo',issueId:'DEMO-1'},f.processEnv({FABRIQUE_CONSOLE_MC_TRIAL:'1'}));
  assert.equal(enriched.code,0,JSON.stringify(enriched.result));
  assert.equal(enriched.result.data.status,'unavailable');assert.equal(enriched.result.data.usage.requests,0);
  assert.deepEqual(enriched.result.data.partialReasons,[{path:'credentials',reason:'api-key-unavailable'}]);
});

test('the watcher in trial mode reads the simulated tracker and asks the core of the trial',async t=>{
  const f=await fixture(t),state=join(f.root,'state');
  await mkdir(state,{recursive:true});await writeFile(join(state,'lease'),new Date().toISOString()+'\n');
  const child=spawn(process.execPath,[WATCHER],{env:f.processEnv({FABRIQUE_CONSOLE_MC_TRIAL:'1'}),stdio:'ignore'});
  const exited=new Promise(resolve=>child.on('exit',resolve));
  t.after(()=>{try{child.kill('SIGKILL');}catch{}});
  let published=null;
  for(let i=0;i<200&&!published;i++){await new Promise(r=>setTimeout(r,50));try{published=JSON.parse(await readFile(join(state,'my-issues.json'),'utf8'));}catch{}}
  await writeFile(join(state,'stop'),'');await exited;
  assert.ok(published,'the watcher published My issues');
  assert.deepEqual(published.data?.activity?.map(i=>i.identifier),['DEMO-1'],JSON.stringify(published));
  assert.ok((await readFile(f.hcLog,'utf8')).includes('ls'),'the watcher asked the core of the trial');
});

test('agents start by the absolute path of the trial, in a terminal or a tab, and each launch is journaled',async t=>{
  const f=await fixture(t),{calls,exec}=recorder();
  const backend=createBackend({root:f.root,env:f.env,home:f.home,exec});
  await backend.dispatch('agent-start',{tool:'codex'});
  const launch=calls.find(c=>c.args[0]==='run');
  assert.equal(launch.file,f.trial.hc);
  // Traced (M12): the fake Codex carries the key of its trace, kept in the folder of the trial, with no word of its argv.
  const [kept]=readdirSync(join(f.root,'state','traces')),trace=JSON.parse(readFileSync(join(f.root,'state','traces',kept),'utf8'));
  assert.deepEqual(launch.args.slice(-6),[f.trial.agents.codex,'--no-daemon','-c','shell_environment_policy.set.FABRIQUE_CONSOLE_AGENT="1"','-c',`shell_environment_policy.set.FABRIQUE_CONSOLE_TRACE="${trace.key}"`]);
  assert.deepEqual([trace.role,trace.tool,trace.session,trace.mission],['agent','codex',null,null]);
  // No wrapper any more: the sandbox is around the whole trial, not around each program.
  assert.ok(!launch.args.includes('/usr/bin/sandbox-exec')&&!launch.args.includes('/usr/bin/env'));
  const named=trialExec(exec,trialOfFixture(f));
  await named(f.trial.herdrApp,['do','tab.new',JSON.stringify({name:'review',argv:['claude','--model','x','prompt']})]).catch(()=>{});
  assert.deepEqual(JSON.parse(calls.at(-1).args[2]).argv,[f.trial.agents.claude,'--model','x','prompt']);
  await named(f.trial.hc,['run','--bg','--','codex','go']);
  assert.deepEqual(calls.at(-1).args.slice(-2),[f.trial.agents.codex,'go']);
  assert.ok((await lines(join(f.root,'trial-journal.jsonl'))).some(e=>e.kind==='exec'&&e.agent===f.trial.agents.codex));
});

test('a real agent or the keychain never starts, whoever asks: the QA, a direct call (review M17, 1; M17-2, 1)',async t=>{
  const f=await fixture(t);
  createBackend({root:f.root,env:f.env,home:f.home});
  for(const argv of [[join(realHome,'.local','bin','codex'),'--version'],[join(realHome,'.local','bin','claude'),'--version'],['/usr/bin/security','help']]) {
    const result=await executeQA(qaRun(f,argv));
    assert.equal(result.status,'error',argv[0]);assert.equal(result.stdout,'',argv[0]);
    await assert.rejects(async()=>run(argv[0],argv.slice(1)),error=>refusedCode(error),argv[0]);
  }
  const env=await executeQA(qaRun(f,['/bin/sh','-c','printf "%s|%s" "$HOME" "$PATH"']));
  const [home,path]=env.stdout.split('|');
  assert.equal(home,homedir());assert.ok(!path.includes(join(realHome,'.local','bin')),path);
});

test('a trial reaches no network: node:http, net, the DNS resolver, a program of the system, git fetch (review M17, 2)',async t=>{
  const f=await fixture(t),port=canary()?.http?.port??9;
  createBackend({root:f.root,env:f.env,home:f.home});
  const failed=handle=>new Promise(done=>{const timer=setTimeout(()=>{handle.destroy?.();done({code:'NOT_REFUSED'});},3000);handle.once('error',error=>{clearTimeout(timer);done(error);});});
  const req=httpRequest({hostname:'127.0.0.1',port,path:'/'});req.end();
  assert.ok(refusedCode(await failed(req)),'node:http');
  assert.ok(refusedCode(await failed(connect(port,'127.0.0.1'))),'net');
  assert.ok(refusedCode(await failed(connect('/var/run/mDNSResponder'))),'the socket of the DNS resolver');
  const perl=spawnSync('/usr/bin/perl',['-MIO::Socket::INET','-e',`print IO::Socket::INET->new("127.0.0.1:${port}")?"connected":"refused:$!"`],{encoding:'utf8'});
  assert.match(perl.stdout,/^refused:Operation not permitted/,perl.stderr);
  await f.initRepo();
  await f.git(['remote','add','origin',`http://127.0.0.1:${port}/demo.git`]);
  await assert.rejects(f.git(['fetch','origin']));
});

test('a login shell of the trial gets nothing real back: its profile cannot read the home nor start a real agent (review M17, 4)',async t=>{
  const f=await fixture(t);
  await writeFile(join(homedir(),'.zprofile'),`export PATH='${join(realHome,'.local','bin')}':$PATH\n`);
  t.after(()=>rm(join(homedir(),'.zprofile'),{force:true}));
  const real=join(realHome,'.local','bin','codex');
  const shell=spawnSync('/bin/zsh',['-l','-c',`ls '${realHome}'; echo "ls=$?"; '${real}' --version; echo "real=$?"; codex --version; echo "codex=$?"`],{encoding:'utf8',cwd:f.base});
  assert.match(shell.stdout,/ls=1/);assert.match(shell.stdout,/real=12[67]/);
  assert.ok(shell.stderr.toLowerCase().includes('operation not permitted: '+real.toLowerCase()),shell.stderr);
  // By its name, the codex found is the fake of the trial: the one the profile put first cannot even be looked at.
  assert.match(shell.stdout,/fabrique-console trial: fake codex --version\ncodex=0/);
  assert.match(shell.stderr,/Operation not permitted|operation not permitted/);
});

test('mockup-publish keeps its pictures in the Herdr home of the trial; ~/.config/herdr-app cannot be written (review M17, 3)',async t=>{
  const f=await fixture(t),folder=join(homedir(),'Developer','mockups','trial-'+basename(f.base));
  await mkdir(folder,{recursive:true});await writeFile(join(folder,'a.html'),'<p>x');
  t.after(()=>rm(folder,{recursive:true,force:true}));
  const {mission}=await createMissionRegistry({root:f.root}).create({project:'demo',issue:{id:issue.id,identifier:'DEMO-1'},request:'r',lead:{sessionId:'s1',lastSeen:null}});
  const backend=createBackend({root:f.root,env:f.env,home:f.home});
  await assert.rejects(backend.dispatch('mockup-publish',{mission:mission.id,title:'Lots',folder}));
  assert.deepEqual(await readdir(join(f.appHome,'mockups')),['MK-1'],'the folder of its pictures is in the Herdr home of the trial');
  await assert.rejects(mkdir(join(realHome,'.config','herdr-app','mockups','MK-trial'),{recursive:true}),error=>refusedCode(error));
  await assert.rejects(readdir(join(realHome,'.config','herdr-app')),error=>refusedCode(error));
});

test('the V2 preparation plans its worktree under the root of the trial, whatever the configuration names (review M17, 5)',async t=>{
  const f=await fixture(t,{config:false});await f.initRepo();
  const named=join(f.home,'Developer','worktrees');
  await writeFile(join(f.root,'config.json'),JSON.stringify({version:2,tracker:{transport:'mcp',endpoint:'https://mcp.linear.app/mcp/readonly'},worktreesRoot:named,wip:{dev:2,review:3,maxParallelDevs:2},launch:{confirm:'each'},projects:[{
    key:'demo',name:'Demo',teamId:'team-demo',projectId:'project-demo',kind:'produit',color:'#808080',machine:null,
    repos:[{key:'app',path:f.repo,labels:[],aliases:[],mainBranch:'main',verification:'verified',tests:{}}]}],profiles:{version:'unconfigured',dev:{},review:{}}}));
  const backend=createBackend({root:f.root,env:f.env,home:f.home});
  const plan=await backend.dispatch('worktree-plan',{issueId:'DEMO-1',tool:'codex',role:'dev'});
  assert.equal(plan.status,'planned',JSON.stringify(plan));
  assert.equal(plan.worktreesRoot,f.worktrees);assert.ok(plan.worktree.startsWith(f.worktrees+'/'),plan.worktree);
  await assert.rejects(readdir(named),{code:'ENOENT'});
});

test('the worktree of an issue goes under the root of the trial',async t=>{
  const f=await fixture(t);await f.initRepo();
  await writeFile(join(f.root,'state.json'),JSON.stringify({version:1,sessions:[{id:'lead',role:'lead',repo:f.repo,identifier:'DEMO-1'}]}));
  const backend=createBackend({root:f.root,env:f.env,home:f.home});
  const made=await backend.dispatch('issue-worktree',{sessionId:'lead'});
  assert.equal(made.path,join(f.worktrees,basename(f.repo),'DEMO-1'));
  assert.equal((await f.git(['worktree','list'])).stdout.includes(made.path),true);
});

test('a trial changes nothing of the process: fetch and child_process stay as they were (review M17, 7)',async t=>{
  const f=await fixture(t);
  createBackend({root:f.root,env:f.env,home:f.home});
  assert.equal(globalThis.fetch,originals.fetch);assert.equal(childProcess.spawn,originals.spawn);assert.equal(childProcess.execFile,originals.execFile);
});

test('real mode, even in the sandbox, is unchanged: the same argv, no environment added, the real tracker asked',async t=>{
  const f=await fixture(t,{marked:false}),{calls,exec}=recorder();
  const backend=createBackend(withFakeHerdr({root:f.root,env:{},home:f.home,exec}));
  await backend.dispatch('agent-start',{tool:'codex'});
  const launch=calls.find(c=>c.args[0]==='run');
  assert.equal(launch.file,'/fixture/hc');
  // The argv the agents table builds, traced as in a trial (M12): the key of its trace for its commands, nothing else.
  const built=hcRunArgs({tool:'codex',cwd:join(homedir(),'Developer'),name:'fabrique-console-agent-codex',labels:{'herdr.space':'fabrique-console-agent','herdr.tab':'fabrique-console-agent-codex','fabrique-console.app':'fabrique-console','fabrique-console.role':'agent','fabrique-console.tool':'codex'}});
  const key=readdirSync(join(f.root,'state','traces'))[0].slice(0,-5),dash=built.indexOf('--');
  assert.deepEqual(launch.args,[...built.slice(0,dash+1),...traceArgv(built.slice(dash+1),key).argv]);
  assert.equal(launch.options.env,undefined);
  await assert.rejects(backend.dispatch('ticket-detail',{id:'DEMO-1'}));
  assert.ok(calls.some(c=>c.file==='/usr/bin/security'),'the keychain is asked, as before');
});
