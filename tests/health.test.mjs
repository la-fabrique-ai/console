import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {readHealth,githubSlug,ciState} from '../src/health.mjs';
import {clean} from '../src/common.mjs';

const NOW=Date.parse('2026-11-06T12:00:00Z');

test('a GitHub repository is recognised from its remote, and nothing else of the address is kept',()=>{
  assert.equal(githubSlug('git@github.com:FABRIQUE-CONSOLE-Consulting/alpha-admin.git'),'FABRIQUE-CONSOLE-Consulting/alpha-admin');
  assert.equal(githubSlug('https://github.com/acme/site\n'),'acme/site');
  assert.equal(githubSlug('https:'+'//fixture:fake@github.com/acme/site.git'),'acme/site');
  for(const other of ['https://gitlab.com/acme/site.git','','git@github.com:acme','https://github.com/acme/site/extra','https://github.com/ac me/site']) assert.equal(githubSlug(other),null,other);
});

const wf=(name,status,conclusion,updatedAt)=>({name,run:status?{status,conclusion,updatedAt}:null});
test('CI: each workflow is judged on its own last run, and green needs every one of them to have succeeded',()=>{
  const none={state:'none',failing:[],running:[],unsettled:[],unrun:[],at:null};
  assert.deepEqual(ciState([]),none);assert.deepEqual(ciState('nope'),none);assert.deepEqual(ciState([wf('Never ran')]),{...none,unrun:['Never ran']});
  // A workflow that never ran on the branch counts neither for nor against: it is named apart.
  const missing=ciState([wf('Build','completed','success','2026-11-06T11:00:00Z'),wf('Review on pull requests')]);
  assert.equal(missing.state,'green');assert.deepEqual(missing.unrun,['Review on pull requests']);
  assert.deepEqual(ciState([wf('CI','completed','success','2026-11-06T11:00:00Z')]),{state:'green',failing:[],running:[],unsettled:[],unrun:[],at:'2026-11-06T11:00:00.000Z'});
  // A rare workflow that failed is seen however many runs the frequent ones had since.
  const red=ciState([wf('Build','completed','success','2026-11-06T11:00:00Z'),wf('Security audit','completed','failure','2026-11-02T14:58:46Z'),wf('Deploy','in_progress',null,'2026-11-06T11:59:00Z')]);
  assert.deepEqual(red,{state:'red',failing:['Security audit'],running:['Deploy'],unsettled:[],unrun:[],at:'2026-11-02T14:58:46.000Z'});
  assert.equal(ciState([wf('CI','queued',null,'2026-11-06T11:59:00Z')]).state,'running');
  // A cancelled or skipped run is neither a failure nor a success.
  const unsettled=ciState([wf('CI','completed','cancelled','2026-11-06T11:00:00Z'),wf('Lint','completed','success','2026-11-06T11:00:00Z'),wf('Docs','completed','skipped','2026-11-06T11:00:00Z')]);
  assert.equal(unsettled.state,'unsettled');assert.deepEqual(unsettled.unsettled,['CI','Docs']);
});

test('health: each GitHub repository of the project gets its CI state; a failed reading is not a green one',async t=>{
  const root=await mkdtemp(join(tmpdir(),'fabrique-console-health-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const repo=join(root,'alpha');
  for(const name of ['admin','app','local','other','odd','deaf']) await mkdir(join(repo,name,'.git'),{recursive:true});
  await mkdir(join(repo,'docs'),{recursive:true});
  const remotes={admin:'git@github.com:acme/admin.git',app:'https:'+'//fixture:fake@github.com/acme/app.git',other:'https://gitlab.com/acme/other.git',odd:'git@github.com:acme/odd.git'};
  const calls=[];
  const fake=async(command,args,options)=>{
    calls.push([command,...args]);
    const dir=command==='git'?args[args.indexOf('-C')+1]:options?.cwd,name=dir.split('/').pop();
    if(command==='git'&&args.at(-1)==='remote') {if(name==='deaf') throw new Error('unreadable');return {stdout:name==='local'?'':'origin\n'};}
    if(command==='git'&&args.includes('symbolic-ref')) {if(name==='odd') throw new Error('no head');return {stdout:'refs/remotes/origin/'+(name==='admin'?'trunk':'main')+'\n'};}
    if(command==='git'&&args.includes('get-url')) return {stdout:remotes[name]+'\n'};
    if(command==='gh'&&name==='admin'&&args[0]==='workflow') return {stdout:JSON.stringify([{id:1,name:'CI',state:'active'},{id:2,name:'Old',state:'disabled_manually'},{id:3,name:'Security audit',state:'active'}])};
    if(command==='gh'&&name==='admin'&&args[0]==='run') return {stdout:JSON.stringify(args.includes('3')?[{status:'completed',conclusion:'failure',updatedAt:'2026-11-06T11:20:00Z'}]:[{status:'completed',conclusion:'success',updatedAt:'2026-11-06T11:30:00Z'}])};
    // A repository without any workflow: gh prints nothing.
    if(command==='gh'&&name==='app'&&args[0]==='workflow') return {stdout:''};
    if(command==='gh'&&name==='odd'&&args[0]==='repo') return {stdout:JSON.stringify({defaultBranchRef:{name:'-evil'}})};
    throw new Error('gh failed SECRET');
  };
  const health=await readHealth({repo,run:fake,now:NOW});
  assert.equal(health.checkedAt,new Date(NOW).toISOString());
  const unread=(name,slug)=>({name,slug,state:'unavailable',failing:[],running:[],unsettled:[],unrun:[],at:null});
  assert.deepEqual(health.ci,{state:'read',items:[
    {name:'admin',slug:'acme/admin',state:'red',failing:['Security audit'],running:[],unsettled:[],unrun:[],at:'2026-11-06T11:20:00.000Z'},
    {name:'app',slug:'acme/app',state:'none',failing:[],running:[],unsettled:[],unrun:[],at:null},
    // A repository whose remotes cannot be read is counted as unread, not dropped.
    unread('deaf',null),
    // A default branch that could be read as an option is refused.
    unread('odd','acme/odd'),
  ]});
  // The runs are asked per workflow, on the branch the remote names as default.
  const runs=calls.filter(c=>c[0]==='gh'&&c[1]==='run');
  assert.deepEqual(runs.map(c=>[c[c.indexOf('--workflow')+1],c[c.indexOf('--branch')+1],c[c.indexOf('--limit')+1]]),[['1','trunk','1'],['3','trunk','1']]);
  assert.equal(JSON.stringify(clean(health)).includes('SECRET'),false);
  await assert.rejects(readHealth({repo:'relative',run:fake}),{code:'INVALID_ARGUMENT'});
  // Past the overall deadline nothing more is asked: what was not read is unread, not green.
  let asked=0;
  const late=await readHealth({repo,run:async(...args)=>{if(args[0]==='gh') asked+=1;return fake(...args);},now:NOW,budgetMs:0});
  assert.equal(asked,0);// With no time left even the remotes are not read: every repository is unread, none is dropped.
  assert.deepEqual(late.ci.items.map(i=>i.state),Array(6).fill('unavailable'));
  assert.equal(JSON.stringify(late).includes('SECRET'),false);
  // The budget covers the whole action: each request gets at most the time that is left.
  const limits=[];
  await readHealth({repo,run:async(command,args,options)=>{limits.push(options?.timeout);return fake(command,args,options);},now:NOW,budgetMs:5000});
  assert.ok(limits.length>0&&limits.every(ms=>Number.isFinite(ms)&&ms>0&&ms<=5000),JSON.stringify(limits));
  // Never more than a few requests at the same time.
  let live=0,peak=0;
  await readHealth({repo,run:async(command,args,options)=>{if(command!=='gh') return fake(command,args,options);live+=1;peak=Math.max(peak,live);await new Promise(r=>setTimeout(r,5));try {return await fake(command,args,options);}finally {live-=1;}},now:NOW});
  assert.ok(peak<=6,'peak '+peak);
});
