import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, realpath, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createValidationDesk, safeServer, portFree, nodeOf, NODE_RUN } from '../src/validation-desk.mjs';
import { createMissionRegistry } from '../src/mission.mjs';
import { serverOfPlan } from '../ui/v3/view.js';

import { fakeHerdr } from './helpers/fake-herdr.mjs';
// The desk on a fake Git, gh and hc, in a real folder: a root repository, an admin one, an untouched website.
async function setup(t,{plan='Serveur : admin · pnpm dev:strict · [http://localhost:3000](<http://localhost:3000>)',gh='none',tracker=true,busy=[],says='',flutter=null,phones=null,ahead=null,hub=false,browsers=[],serving=true,undated=false,repo=null}={}) {
  const root=await realpath(await mkdtemp(join(tmpdir(),'fabrique-console-desk-')));t.after(()=>rm(root,{recursive:true,force:true}));
  const worktree=join(root,'XJ-689');
  for(const repo of ['admin','website'])await mkdir(join(worktree,repo,'.git'),{recursive:true});
  await mkdir(join(worktree,'plain'),{recursive:true});
  await writeFile(join(worktree,'admin','package.json'),JSON.stringify({scripts:{'dev:strict':'next dev',dev:'next dev'}}));
  if(flutter) {
    for(const dir of ['.git','lib','.vscode'])await mkdir(join(worktree,'app',dir),{recursive:true});
    await writeFile(join(worktree,'app','pubspec.yaml'),'name: x\ndependencies:\n  flutter:\n    sdk: flutter\n');await writeFile(join(worktree,'app','lib','main.dart'),'');
    await writeFile(join(worktree,'app','.vscode','launch.json'),JSON.stringify({configurations:[{type:'dart',toolArgs:['--dart-define-from-file=.dart-defines.json','--dart-define=MODE=x','--evil']}]}));
    await mkdir(join(root,'main-app'),{recursive:true});if(flutter.defines==='main')await writeFile(join(root,'main-app','.dart-defines.json'),'{}');
  }
  const terminals=[],calls=[];let n=0;
  const invoke=async(file,args,options={})=>{
    calls.push([file,args,options]);
    if(file==='git') {
      const path=args[1],website=path.endsWith('website');
      if(args.includes('--abbrev-ref'))return {stdout:'xj-689\n'};
      if(args.includes('--git-common-dir'))return {stdout:join(root,'main-app','.git')+'\n'};
      if(args.includes('symbolic-ref'))return {stdout:'origin/main\n'};
      if(args.includes('rev-list'))return {stdout:ahead??(website?'0\n':'13\n')};
      if(args.includes('--verify')){if(path.endsWith('admin'))return {stdout:'abc\n'};throw new Error('none');}
    }
    if(file==='xcrun') {
      if(args[1]==='list')return {stdout:JSON.stringify({devices:phones??{'com.apple.CoreSimulator.SimRuntime.iOS-26-5':[{name:'iPhone 17 Pro',udid:'OLD',state:'Shutdown'}],'com.apple.CoreSimulator.SimRuntime.iOS-27-0':[{name:'iPad',udid:'PAD',state:'Booted'},{name:'iPhone 18 Pro',udid:'NEW',state:'Shutdown'}],'com.apple.CoreSimulator.SimRuntime.watchOS-27-0':[{name:'iPhone-like watch',udid:'W',state:'Booted'}]}})};
      return {stdout:''};
    }
    if(file==='gh') {
      if(gh==='fail')throw new Error('offline');
      return {stdout:gh==='pr'&&options.cwd.endsWith('admin')?JSON.stringify([{number:21,url:'https://github.com/x/y/pull/21',state:'OPEN',isDraft:true}]):'[]'};
    }
    if(file==='ps')return {stdout:'ttys'+args[3]+'\n'};
    if(file==='terminal-browser')return {stdout:JSON.stringify({browsers})};
    // A core whose listing comes back with no list (an answer lost or cut short, an error said on stdout).
    if(args[0]==='ls'&&net.lsLost)return {stdout:'{}'};
    if(args[0]==='ls'){const wanted=args.filter((_a,i)=>args[i-1]==='--label'),rows=terminals.filter(x=>wanted.every(l=>x.labels.includes(l)));const shown=(args.includes('--all')?rows:rows.filter(x=>x.state==='live')).map(x=>undated?(({created_ms,...rest})=>rest)(x):x);return {stdout:JSON.stringify(shown)};}
    if(args[0]==='run'){const id='t'+(++n);terminals.push({id,pid:4200+n,state:'live',created_ms:n,labels:args.filter((_a,i)=>args[i-1]==='--label')});return {stdout:JSON.stringify({id})};}
    if(args[0]==='get'){if(net.getDown)throw new Error('down');if(net.getEmpty)return {stdout:'{}\n'};return {stdout:JSON.stringify(terminals.find(x=>x.id===args[1]))};}
    if(args[0]==='read'&&terminals.find(x=>x.id===args[1])?.said!==undefined)return {stdout:terminals.find(x=>x.id===args[1]).said};
    if(args[0]==='read'&&says)return {stdout:says};
    if(args[0]==='kill'){terminals.find(x=>x.id===args[1]).state='finished';return {stdout:'{}'};}
    if(args[0]==='read')return {stdout:'ligne 1\n\nError: Application Default Credentials are visible\n    at main (x.ts:1)\n ELIFECYCLE  Command failed\n'};
    return {stdout:'{}'};
  };
  const net={hub,serving,asked:[]};
  const registry=createMissionRegistry({root});
  await registry.create({project:'alpha',issue:{id:'i1',identifier:'XJ-689',title:'Mes lots',url:'u'},request:'r',worktree,branch:'xj-689',step:'validating'});
  const desk=createValidationDesk({root,invoke,herdr:fakeHerdr({on:invoke}).herdr,registry,...(repo?{loadConfig:async()=>({projects:[{key:'gamma',repo:'/elsewhere'},{key:'alpha',repo}]})}:{}),isFree:async port=>!busy.includes(port),probe:async()=>net.hub,answers:async url=>{net.asked.push(url);return net.serving;},wait:async()=>{},getTickets:async()=>({detail:async()=>{if(!tracker)throw new Error('down');return {issue:{description:'Base : x\n'+plan+'\n'}};}})});
  return {desk,calls,terminals,registry,root,worktree,net,runs:()=>calls.filter(([,a])=>a[0]==='run').map(([,a])=>a)};
}
const M={mission:'M-1'};

test('the code of a development: its repositories with their own commits, pushed or not, with their pull request',async t=>{
  const f=await setup(t,{gh:'pr'}),out=await f.desk.delivery(M);
  assert.deepEqual(out.repositories.map(r=>r.repo).sort(),['XJ-689','admin'],'a repository with nothing of its own is left out');
  const admin=out.repositories.find(r=>r.repo==='admin');
  assert.deepEqual(admin,{repo:'admin',branch:'xj-689',ahead:13,pushed:true,known:true,pr:{number:21,url:'https://github.com/x/y/pull/21',state:'OPEN',draft:true}});
  const rootRepo=out.repositories.find(r=>r.repo==='XJ-689');assert.equal(rootRepo.pushed,false);assert.equal(rootRepo.pr,null);assert.equal(rootRepo.known,true);
  assert.deepEqual(out.server,{dir:'admin',argv:['pnpm','run','dev:strict'],url:'http://localhost:3000'},'a link in the plan is still its address');
});

test('GitHub unreadable is unknown, not "no pull request"',async t=>{
  const f=await setup(t,{gh:'fail'}),out=await f.desk.delivery(M);
  assert.ok(out.repositories.every(r=>r.known===false&&r.pr===null));
});

test('a mission with no worktree has nothing to deliver yet',async t=>{
  const f=await setup(t);await f.registry.update('M-1',m=>{m.worktree=null;m.branch=null;});
  assert.deepEqual((await f.desk.delivery(M)).repositories,[]);
});

test('the server is started once, in its folder of the worktree, and stopped on demand',async t=>{
  const f=await setup(t);
  assert.deepEqual(await f.desk.server({...M,command:'status'}),{running:false,starting:false,terminal:null,url:null,reason:null,lastOutput:null});
  const both=await Promise.all([f.desk.server({...M,command:'start'}),f.desk.server({...M,command:'start'})]);
  assert.equal(f.runs().length,1,'two clicks make one server');assert.ok(both.every(x=>x.running&&x.terminal==='t1'));
  const run=f.runs()[0];assert.equal(run[run.indexOf('--cwd')+1],join(f.worktree,'admin'));assert.deepEqual(run.slice(run.indexOf('--')+1),['sh','-c',NODE_RUN,'fabrique-console-node','','env','-u','GOOGLE_APPLICATION_CREDENTIALS','PORT=3000','CLOUDSDK_CONFIG='+join(f.root,'state','gcloud-empty'),'pnpm','run','dev:strict']);assert.ok(run.includes('fabrique-console.server=M-1'));assert.ok(run.includes('herdr.space=fabrique-console-alpha-xj-689'));
  assert.equal((await f.desk.server({...M,command:'status'})).running,true);
  const off=await f.desk.server({...M,command:'stop'});assert.equal(off.running,false);
  assert.deepEqual(f.calls.filter(([,a])=>a[0]==='kill').map(([,a])=>a[1]),['t1']);
  await f.desk.server({...M,command:'stop'});assert.equal(f.calls.filter(([,a])=>a[0]==='kill').length,1,'nothing left to stop');
});

test('the server takes the first free port from the one in the plan, and says which',async t=>{
  const f=await setup(t,{busy:[3000,3001]}),out=await f.desk.server({...M,command:'start'});
  assert.equal(out.url,'http://localhost:3002');const run=f.runs()[0];assert.ok(run.includes('PORT=3002'));assert.ok(run.includes('fabrique-console.port=3002'));
  assert.equal((await f.desk.server({...M,command:'status'})).url,'http://localhost:3002','found again by its label');
});

test('two servers still starting never get the same port, and a port is free again once its server is gone',async t=>{
  const f=await setup(t);
  await f.registry.create({project:'alpha',issue:{id:'i2',identifier:'XJ-2',title:'T',url:'u'},request:'r',worktree:f.worktree,branch:'xj-689',step:'validating'});
  const [a,b]=await Promise.all([f.desk.server({mission:'M-1',command:'start'}),f.desk.server({mission:'M-2',command:'start'})]);
  assert.deepEqual([a.url,b.url].sort(),['http://localhost:3000','http://localhost:3001']);assert.equal(f.runs().length,2);
  const first=a.url.endsWith('3000')?'M-1':'M-2';
  await f.desk.server({mission:first,command:'stop'});
  await f.desk.server({mission:first,command:'start'});
  assert.ok(f.runs().at(-1).includes('PORT=3000'),'the port of the server that stopped is free again');
});

test('a port is busy whichever address listens on it',async t=>{
  const {createServer}=await import('node:net'),{execFile}=await import('node:child_process'),{promisify}=await import('node:util'),run=promisify(execFile);
  const free=portFree({invoke:(file,args)=>run(file,args,{encoding:'utf8',shell:false})}),listen=host=>new Promise((done,no)=>{const s=createServer();s.once('error',no);s.listen({port:0,host},()=>done(s));}),close=s=>new Promise(done=>s.close(done));
  for(const host of ['127.0.0.1','0.0.0.0','::1','::']) {
    const server=await listen(host),{port}=server.address();
    assert.equal(await free(port),false,host);await close(server);assert.equal(await free(port),true,host+' closed');
  }
  assert.equal(await portFree({invoke:async()=>{throw Object.assign(new Error('x'),{code:'ENOENT'});}})(3000),false,'what cannot be checked is not free');
});

test('what a server says about its address wins over the port it was given',async t=>{
  const f=await setup(t,{says:'  - Local: http://localhost:3005\n'});await f.desk.server({...M,command:'start'});
  assert.equal((await f.desk.server({...M,command:'status'})).url,'http://localhost:3005');
});

test('no free port starts nothing',async t=>{
  const f=await setup(t,{busy:Array.from({length:50},(_,n)=>3000+n)});
  await assert.rejects(()=>f.desk.server({...M,command:'start'}),e=>e.code==='SERVER_NOT_CONFIGURED');assert.equal(f.runs().length,0);
});

test('a server that stopped says why',async t=>{
  const f=await setup(t);await f.desk.server({...M,command:'start'});f.terminals[0].state='finished';
  const out=await f.desk.server({...M,command:'status'});
  assert.equal(out.running,false);assert.equal(out.reason,'Error: Application Default Credentials are visible','the line that says why');assert.match(out.lastOutput,/ELIFECYCLE/);
});

test('the plan decides nothing beyond a plain script of a known tool, in a folder of the worktree',async t=>{
  for(const plan of ['Serveur : admin · rm -rf / · http://localhost:3000','Serveur : admin · pnpm dev;rm · http://localhost:3000','Serveur : .. · pnpm dev · http://localhost:3000','Serveur : admin · bash -c x · http://localhost:3000','','Serveur : admin · npm exec -- sh -c id · http://localhost:3000','Serveur : admin · pnpm -C /tmp/outside-project run dev · http://localhost:3000','Serveur : admin · yarn node /tmp/outside.js · http://localhost:3000','Serveur : admin · bun /tmp/outside.js · http://localhost:3000','Serveur : admin · pnpm dev --port 3001 · http://localhost:3000'])  {
    const f=await setup(t,{plan});
    assert.equal((await f.desk.delivery(M)).server,null,plan);
    await assert.rejects(()=>f.desk.server({...M,command:'start'}),e=>e.code==='SERVER_NOT_CONFIGURED',plan);assert.equal(f.runs().length,0);
  }
  assert.deepEqual(safeServer({dir:'',argv:['pnpm','dev']}).argv,['pnpm','run','dev']);assert.deepEqual(safeServer({dir:'',argv:['npm','run','dev']}).argv,['npm','run','dev']);assert.equal(safeServer(null),null);
});

test('a script that the package of its folder does not have is not run, whatever its name',async t=>{
  for(const name of ['exec','unknown','constructor']) {
    const f=await setup(t,{plan:'Serveur : admin · pnpm '+name+' · http://localhost:3000'});
    await assert.rejects(()=>f.desk.server({...M,command:'start'}),e=>e.code==='SERVER_NOT_CONFIGURED',name);assert.equal(f.runs().length,0);
  }
});

test('a folder of the plan that is not there starts nothing, and Tracker down means no server to offer',async t=>{
  const gone=await setup(t,{plan:'Serveur : nope · pnpm dev · http://localhost:3000'});
  await assert.rejects(()=>gone.desk.server({...M,command:'start'}),e=>e.code==='SERVER_NOT_CONFIGURED');
  const down=await setup(t,{tracker:false});assert.equal((await down.desk.delivery(M)).server,null);
});

test('only known commands and arguments are accepted',async t=>{
  const f=await setup(t);
  for(const input of [{...M,command:'restart'},{...M},{...M,command:'stop',extra:1}])await assert.rejects(()=>f.desk.server(input),e=>e.code==='INVALID_ARGUMENT');
  await assert.rejects(()=>f.desk.delivery({...M,extra:1}),e=>e.code==='INVALID_ARGUMENT');
  await assert.rejects(()=>f.desk.server({mission:'M-9',command:'stop'}),e=>e.code==='NOT_FOUND');
});

test('the address of a server is read from a plain line or a link',()=>{
  assert.equal(serverOfPlan('Serveur : admin · pnpm dev · http://localhost:3000').url,'http://localhost:3000');
  assert.equal(serverOfPlan('Serveur : admin · pnpm dev · [http://localhost:3000](<http://localhost:3000>)').url,'http://localhost:3000');
});

// The line of PRB-41 as Tracker gives it (2026-11-12): the project's folder written whole, corepack, a link.
const PROJECT='/Users/someone/Developer/alpha',WHOLE='Serveur : '+PROJECT+' · corepack pnpm dev · [http://localhost:3100](<http://localhost:3100>)';
test('a plan that names the project folder whole and runs corepack has its server at the root of the worktree, with or without a link',async t=>{
  for(const plan of [WHOLE,'Serveur : '+PROJECT+' · corepack pnpm dev · http://localhost:3100','- **Serveur** : `'+PROJECT+'/` · `corepack pnpm dev` · http://localhost:3100']) {
    const f=await setup(t,{plan,repo:PROJECT});await writeFile(join(f.worktree,'package.json'),JSON.stringify({scripts:{dev:'next dev'}}));
    assert.deepEqual((await f.desk.delivery(M)).server,{dir:'',argv:['corepack','pnpm','run','dev'],url:'http://localhost:3100'},plan);
    await f.desk.server({...M,command:'start'});
    const run=f.runs()[0];
    assert.equal(run[run.indexOf('--cwd')+1],f.worktree,'in the worktree, never in the folder of the project');
    assert.deepEqual(run.slice(-6),['PORT=3100','CLOUDSDK_CONFIG='+join(f.root,'state','gcloud-empty'),'corepack','pnpm','run','dev'],'its port from the plan, run through corepack');
  }
});

test('a folder of the project written whole is the same folder of the worktree; anywhere else, no server',async t=>{
  const at=(line,where={repo:PROJECT,worktree:'/wt/XJ-1'})=>serverOfPlan(line,where);
  assert.deepEqual(at('Serveur : '+PROJECT+'/admin · pnpm dev:strict · http://localhost:3000'),{dir:'admin',argv:['pnpm','dev:strict'],url:'http://localhost:3000'});
  assert.equal(at('Serveur : /wt/XJ-1/admin · pnpm dev · http://localhost:3000').dir,'admin','the worktree written whole');
  assert.equal(at('Serveur : /wt/XJ-1 · pnpm dev · http://localhost:3000').dir,'');
  for(const line of ['Serveur : /tmp/elsewhere · pnpm dev · http://localhost:3000','Serveur : '+PROJECT+'/admin/src · pnpm dev · http://localhost:3000','Serveur : '+PROJECT+'/.. · pnpm dev · http://localhost:3000','Serveur : '+PROJECT+'-copy · pnpm dev · http://localhost:3000'])assert.equal(at(line),null,line);
  assert.equal(at(WHOLE,{}),null,'with nothing to place it in, a folder written whole names no folder of the worktree');
  const admin=await setup(t,{plan:'Serveur : '+PROJECT+'/admin · pnpm dev:strict · http://localhost:3000',repo:PROJECT});
  assert.equal((await admin.desk.delivery(M)).server.dir,'admin');
  const outside=await setup(t,{plan:'Serveur : /tmp/elsewhere · pnpm dev · http://localhost:3000',repo:PROJECT});
  assert.equal((await outside.desk.delivery(M)).server,null);
});

test('a plan with no server line has no server to offer',async t=>{
  for(const plan of ['Objectif : rien à lancer','Serveurs à surveiller : aucun'])assert.equal((await (await setup(t,{plan,repo:PROJECT})).desk.delivery(M)).server,null,plan);
});

test('corepack only runs a named script of pnpm or Yarn, and its emulators the same way',async t=>{
  assert.deepEqual(safeServer({dir:'',argv:['corepack','pnpm','dev']}).argv,['corepack','pnpm','run','dev']);
  assert.deepEqual(safeServer({dir:'',argv:['corepack','yarn','run','dev']}).argv,['corepack','yarn','run','dev']);
  for(const argv of [['corepack','enable'],['corepack','npm','dev'],['corepack','pnpm','dlx','x'],['corepack','corepack','pnpm','dev'],['corepack','pnpm','dev','--port','3001'],['corepack']])assert.equal(safeServer({dir:'',argv}),null,argv.join(' '));
  const f=await setup(t,{plan:'Serveur : admin · corepack pnpm dev:strict · http://localhost:3000'});await withEmulators(f);
  await f.desk.server({...M,command:'start'});
  const [emu,srv]=f.runs();
  assert.deepEqual(emu.slice(-4),['corepack','pnpm','run','emulators']);assert.deepEqual(srv.slice(-4),['corepack','pnpm','run','dev:strict']);
});

test('what to test follows the repositories changed: the admin server, the Flutter app, or both',async t=>{
  const both=await setup(t,{flutter:{defines:'main'}}),out=await both.desk.delivery(M);
  assert.deepEqual(out.app,{folder:'app'});assert.equal(out.server.dir,'admin');
  const appOnly=await setup(t,{flutter:{defines:'main'},plan:'Serveur : website · pnpm dev · http://localhost:3000'}),only=await appOnly.desk.delivery(M);
  assert.deepEqual(only.app,{folder:'app'});assert.equal(only.server,null,'a server whose folder was not touched has nothing to show');
  assert.equal((await (await setup(t)).desk.delivery(M)).app,null,'no Flutter app in this development');
});

test('a package that only uses Flutter is not an app to start',async t=>{
  const f=await setup(t,{flutter:{defines:'main'}});await rm(join(f.worktree,'app','lib','main.dart'));
  assert.equal((await f.desk.delivery(M)).app,null);
  await assert.rejects(()=>f.desk.server({...M,command:'start',target:'app'}),e=>e.code==='SERVER_NOT_CONFIGURED');assert.equal(f.runs().length,0);
});

test('the Flutter app starts on the simulator with the settings of its project, named and never read, once',async t=>{
  const f=await setup(t,{flutter:{defines:'main'}}),app={...M,target:'app'};
  assert.equal((await f.desk.server({...app,command:'status'})).running,false);
  const started=await f.desk.server({...app,command:'start'});
  assert.equal(started.running,true);assert.equal(started.url,null);
  const [run]=f.runs();
  assert.deepEqual(run.slice(run.indexOf('--')),['--','zsh','-lc','if command -v mise >/dev/null; then exec mise exec -- flutter run "$@"; fi; exec flutter run "$@"','flutter','-d','NEW','--device-timeout','60','--dart-define-from-file='+join(f.root,'main-app','.dart-defines.json'),'--dart-define=MODE=x'],'only the defines of the launch configuration');
  assert.equal(run[run.indexOf('--cwd')+1],join(f.worktree,'app'));
  assert.ok(f.calls.some(([file,args])=>file==='open'&&args.join(' ')==='-a Simulator'));
  assert.ok(f.calls.some(([file,args])=>file==='xcrun'&&args.join(' ')==='simctl boot NEW'),'an iPhone of the most recent system');
  assert.equal((await f.desk.server({...app,command:'start'})).running,true);assert.equal(f.runs().length,1,'two clicks make one app');
  assert.equal((await f.desk.server({...M,command:'status'})).running,false,'the server is told apart from the app');
  assert.equal((await f.desk.server({...app,command:'stop'})).running,false);
});

test('an app whose settings file is nowhere is not started',async t=>{
  const f=await setup(t,{flutter:{}});
  await assert.rejects(()=>f.desk.server({...M,command:'start',target:'app'}),e=>e.code==='SERVER_NOT_CONFIGURED'&&/\.dart-defines\.json/.test(e.message));
  assert.equal(f.runs().length,0);
  await assert.rejects(()=>f.desk.server({...M,command:'status',target:'constructor'}),e=>e.code==='INVALID_ARGUMENT');
});

test('an iPhone already started is used as it is, and a Mac without one says so',async t=>{
  const key='com.apple.CoreSimulator.SimRuntime.iOS-26-5';
  const on=await setup(t,{flutter:{defines:'main'},phones:{[key]:[{name:'iPhone 17',udid:'A',state:'Shutdown'},{name:'iPhone 17 Pro',udid:'B',state:'Booted'}]}});
  await on.desk.server({...M,command:'start',target:'app'});
  const [run]=on.runs();assert.equal(run[run.indexOf('-d')+1],'B');assert.ok(!on.calls.some(([file,args])=>file==='xcrun'&&args[1]==='boot'),'not started twice');
  const none=await setup(t,{flutter:{defines:'main'},phones:{[key]:[]}});
  await assert.rejects(()=>none.desk.server({...M,command:'start',target:'app'}),e=>e.code==='SERVER_NOT_CONFIGURED'&&/simulator/.test(e.message));
  assert.equal(none.runs().length,0);
});

test('a Flutter app at the root of the repository is found and started there',async t=>{
  const f=await setup(t,{phones:{'com.apple.CoreSimulator.SimRuntime.iOS-26-5':[{name:'iPhone 17',udid:'A',state:'Booted'}]}});
  await mkdir(join(f.worktree,'lib'),{recursive:true});await writeFile(join(f.worktree,'pubspec.yaml'),'dependencies:\n  flutter:\n    sdk: flutter\n');await writeFile(join(f.worktree,'lib','main.dart'),'');
  assert.deepEqual((await f.desk.delivery(M)).app,{folder:'.'});
  await f.desk.server({...M,command:'start',target:'app'});
  const [run]=f.runs();assert.equal(run[run.indexOf('--cwd')+1],f.worktree);
});

test('the app of a ticket runs from its own worktree, on its own, and says where it is shown',async t=>{
  const f=await setup(t,{flutter:{defines:'main'}});
  const own=join(f.root,'XJ-689-XJ-2');
  for(const dir of ['lib','.vscode'])await mkdir(join(own,'app',dir),{recursive:true});
  await writeFile(join(own,'app','pubspec.yaml'),'dependencies:\n  flutter:\n    sdk: flutter\n');await writeFile(join(own,'app','lib','main.dart'),'');
  await f.registry.update('M-1',m=>{m.tickets=[{id:'XJ-2',worktree:own},{id:'XJ-3',worktree:null}];});
  const app={...M,target:'app',ticket:'XJ-2'};
  const started=await f.desk.server({...app,command:'start'});
  assert.equal(started.device,'NEW');assert.equal(started.tab,'fabrique-console-app-m-1.xj-2');assert.ok(started.space);
  const [run]=f.runs();
  assert.equal(run[run.indexOf('--cwd')+1],join(own,'app'));
  for(const label of ['fabrique-console.apptest=M-1.XJ-2','fabrique-console.device=NEW','herdr.tab=fabrique-console-app-m-1.xj-2'])assert.ok(run.includes(label),label);
  const seen=await f.desk.server({...app,command:'status'});assert.equal(seen.running,true);assert.equal(seen.device,'NEW');assert.equal(seen.tab,'fabrique-console-app-m-1.xj-2');
  assert.equal((await f.desk.server({...M,target:'app',command:'status'})).running,false,'the app of the development is another one');
  await assert.rejects(()=>f.desk.server({...M,target:'app',ticket:'XJ-3',command:'start'}),e=>e.code==='SERVER_NOT_CONFIGURED');
  await assert.rejects(()=>f.desk.server({...M,ticket:'XJ-2',command:'start'}),e=>e.code==='INVALID_ARGUMENT','a server is not run for a ticket');
  await assert.rejects(()=>f.desk.server({...M,target:'app',ticket:'nope',command:'start'}),e=>e.code==='INVALID_ARGUMENT');
  assert.equal(f.runs().length,1);
});

const ticketApp=async(f,id)=>{const own=join(f.root,'XJ-689-'+id);for(const dir of ['lib','.vscode'])await mkdir(join(own,'app',dir),{recursive:true});await writeFile(join(own,'app','pubspec.yaml'),'dependencies:\n  flutter:\n    sdk: flutter\n');await writeFile(join(own,'app','lib','main.dart'),'');return own;};

test('a ticket runs its app before anything is merged in its development',async t=>{
  const f=await setup(t,{flutter:{defines:'main'},ahead:'0\n'}),own=await ticketApp(f,'XJ-2');
  await f.registry.update('M-1',m=>{m.tickets=[{id:'XJ-2',worktree:own}];});
  const out=await f.desk.delivery(M);assert.equal(out.app,null,'nothing of its own yet');assert.equal(out.flutter,true,'but an app its tickets can run');
  assert.equal((await f.desk.server({...M,target:'app',ticket:'XJ-2',command:'start'})).running,true);
  const [run]=f.runs();assert.equal(run[run.indexOf('--cwd')+1],join(own,'app'));
});

test('one app on the simulator at a time: starting another stops the one running',async t=>{
  const f=await setup(t,{flutter:{defines:'main'}}),two=await ticketApp(f,'XJ-2'),three=await ticketApp(f,'XJ-3');
  await f.registry.update('M-1',m=>{m.tickets=[{id:'XJ-2',worktree:two},{id:'XJ-3',worktree:three}];});
  await f.desk.server({...M,target:'app',ticket:'XJ-2',command:'start'});
  await f.desk.server({...M,target:'app',ticket:'XJ-3',command:'start'});
  const kills=()=>f.calls.filter(([,a])=>a[0]==='kill').map(([,a])=>a[1]);
  assert.deepEqual(kills(),['t1'],'the app of XJ-2 was stopped');
  assert.equal((await f.desk.server({...M,target:'app',ticket:'XJ-2',command:'status'})).running,false);
  await f.desk.server({...M,target:'app',command:'start'});
  assert.deepEqual(kills(),['t1','t2'],'and the app of XJ-3 for the one of the development');
  assert.equal(f.terminals.filter(x=>x.state==='live'&&x.labels.includes('fabrique-console.role=app-test')).length,1);
});

test('the back office of a development opens in terminal-browser, once per page',async t=>{
  const f=await setup(t);
  const first=await f.desk.qaBrowser({...M,url:'http://localhost:3000'});
  const [run]=f.runs();
  assert.deepEqual(run.slice(run.indexOf('--')),['--','zsh','-lc','exec terminal-browser open --no-merge "$1"','terminal-browser','http://localhost:3000']);
  for(const label of ['fabrique-console.qabrowser=M-1','fabrique-console.url=http://localhost:3000','herdr.tab=fabrique-console-qa-browser-m-1'])assert.ok(run.includes(label),label);
  assert.deepEqual(await f.desk.qaBrowser({...M,url:'http://localhost:3000'}),{terminal:first.terminal,reused:true,key:null},'the same page again');
  const other=await f.desk.qaBrowser({...M,url:'http://localhost:3001/admin'});
  assert.equal(other.reused,false);assert.deepEqual(f.calls.filter(([,a])=>a[0]==='kill').map(([,a])=>a[1]),[first.terminal],'the page before is closed');
  for(const url of ['https://example.com','file:///etc/passwd','http://localhost:3000 x','javascript:alert(1)'])await assert.rejects(()=>f.desk.qaBrowser({...M,url}),e=>e.code==='INVALID_ARGUMENT',url);
  assert.equal(f.runs().length,2);
});

test('a plan that names no server starts the development script of the project, and its address is the one of the app',async t=>{
  const f=await setup(t,{plan:'',says:'== emulators up: http://127.0.0.1:4410/emulators\n== admin: http://localhost:3000  (emulator UI: http://127.0.0.1:4010)\n'});
  await assert.rejects(()=>f.desk.server({...M,command:'start'}),e=>e.code==='SERVER_NOT_CONFIGURED','no script either');
  await writeFile(join(f.worktree,'dev.sh'),'#!/bin/sh\n',{mode:0o755});
  assert.deepEqual((await f.desk.delivery(M)).server,{dir:'',argv:['./dev.sh'],url:null,script:true});
  const started=await f.desk.server({...M,command:'start'});
  assert.equal(started.running,true,'it answers at the address it says');
  const [run]=f.runs();assert.equal(run[run.indexOf('--cwd')+1],f.worktree);assert.deepEqual(run.slice(run.indexOf('--')),['--','sh','-c',NODE_RUN,'fabrique-console-node','','env','-u','GOOGLE_APPLICATION_CREDENTIALS','CLOUDSDK_CONFIG='+join(f.root,'state','gcloud-empty'),'./dev.sh']);
  assert.equal((await f.desk.server({...M,command:'status'})).url,'http://localhost:3000','the app, not its emulators');
});

test('a script that cannot be run is not a server',async t=>{
  const f=await setup(t,{plan:''});await writeFile(join(f.worktree,'dev.sh'),'#!/bin/sh\n',{mode:0o644});
  assert.equal((await f.desk.delivery(M)).server,null);
  await assert.rejects(()=>f.desk.server({...M,command:'start'}),e=>e.code==='SERVER_NOT_CONFIGURED');assert.equal(f.runs().length,0);
});

test('a dev.sh that is a link is not the script of the repository, even to a file of the worktree',async t=>{
  const f=await setup(t,{plan:''});
  await writeFile(join(f.root,'outside.sh'),'#!/bin/sh\n',{mode:0o755});await symlink(join(f.root,'outside.sh'),join(f.worktree,'dev.sh'));
  assert.equal((await f.desk.delivery(M)).server,null);
  await assert.rejects(()=>f.desk.server({...M,command:'start'}),e=>e.code==='SERVER_NOT_CONFIGURED');
  await rm(join(f.worktree,'dev.sh'));await writeFile(join(f.worktree,'real.sh'),'#!/bin/sh\n',{mode:0o755});await symlink(join(f.worktree,'real.sh'),join(f.worktree,'dev.sh'));
  assert.equal((await f.desk.delivery(M)).server,null);assert.equal(f.runs().length,0);
});

test('a test server never sees the Google credentials: an empty folder of its own, refused if something put them there',async t=>{
  const f=await setup(t);const home=join(f.root,'state','gcloud-empty');
  await f.desk.server({...M,command:'start'});assert.ok(f.runs()[0].includes('CLOUDSDK_CONFIG='+home));
  await f.desk.server({...M,command:'stop'});await writeFile(join(home,'application_default_credentials.json'),'{}');
  await assert.rejects(()=>f.desk.server({...M,command:'start'}),e=>e.code==='SERVER_NOT_CONFIGURED');assert.equal(f.runs().length,1);
});

async function withEmulators(f) {
  await writeFile(join(f.worktree,'admin','package.json'),JSON.stringify({scripts:{'dev:strict':'next dev',emulators:'firebase emulators:start --project demo-x --config firebase.emulators.json'}}));
  await writeFile(join(f.worktree,'admin','firebase.emulators.json'),JSON.stringify({emulators:{hub:{port:4400},firestore:{port:8080},ui:{enabled:true,port:4000},singleProjectMode:true}}));
}
test('the emulators a server needs are started once per project, with no credentials, and the server waits for their hub',async t=>{
  const f=await setup(t);await withEmulators(f);const home=join(f.root,'state','gcloud-empty');
  await f.desk.server({...M,command:'start'});
  const [emu,srv]=f.runs();
  assert.equal(emu[emu.indexOf('--cwd')+1],join(f.worktree,'admin'));assert.ok(emu.includes('fabrique-console.emulators=alpha'));
  assert.deepEqual(emu.slice(emu.indexOf('--')+1),['sh','-c',NODE_RUN,'fabrique-console-node','','env','-u','GOOGLE_APPLICATION_CREDENTIALS','CLOUDSDK_CONFIG='+home,'pnpm','run','emulators']);
  const command=srv.slice(srv.indexOf('--')+1);
  assert.deepEqual([command[0],command[1]],['sh','-c']);assert.ok(!command[2].includes('pnpm')&&!command[2].includes('dev:strict'),'the command stays an argument');
  assert.deepEqual(command.slice(3),['fabrique-console-wait','http://127.0.0.1:4400/emulators','sh','-c',NODE_RUN,'fabrique-console-node','','env','-u','GOOGLE_APPLICATION_CREDENTIALS','PORT=3000','CLOUDSDK_CONFIG='+home,'pnpm','run','dev:strict']);
  await f.desk.server({...M,command:'stop'});await f.desk.server({...M,command:'start'});
  assert.equal(f.runs().filter(r=>r.includes('fabrique-console.role=emulators')).length,1,'still starting: not started twice');
});
test('emulators already answering are left as they are; their ports held without a hub are said, never taken',async t=>{
  const up=await setup(t,{hub:true});await withEmulators(up);await up.desk.server({...M,command:'start'});
  assert.equal(up.runs().length,1);assert.ok(up.runs()[0].includes('fabrique-console-wait'));
  const held=await setup(t,{busy:[8080]});await withEmulators(held);
  await assert.rejects(()=>held.desk.server({...M,command:'start'}),e=>e.code==='EMULATORS_BUSY'&&/8080/.test(e.message));assert.equal(held.runs().length,0);
});

test('the browser of the QA window is given with the key an agent drives it by: the browser on the tty of its terminal',async t=>{
  const f=await setup(t,{browsers:[{key:'900-1',tty:'/dev/ttys4999'},{key:'900-2',tty:'/dev/ttys4201'},{key:'bad key',tty:'/dev/ttys4202'}]});
  const first=await f.desk.qaBrowser({...M,url:'http://localhost:3000'});
  assert.equal(first.key,'900-2');
  const other=await f.desk.qaBrowser({...M,url:'http://localhost:3001'});
  assert.equal(other.key,null,'a key that is not one stays unknown');
});

test('a server alive whose address does not answer yet is starting, not running, and a second start waits for it',async t=>{
  const f=await setup(t,{serving:false});
  const first=await f.desk.server({...M,command:'start'});
  assert.equal(first.running,false);assert.equal(first.starting,true);assert.equal(first.url,null,'no address shown before it answers');
  assert.deepEqual(f.net.asked,['http://localhost:3000'],'the address is really asked');
  assert.equal((await f.desk.server({...M,command:'start'})).starting,true);assert.equal(f.runs().length,1,'never started twice');
  f.net.serving=true;
  const up=await f.desk.server({...M,command:'status'});assert.equal(up.running,true);assert.equal(up.url,'http://localhost:3000');
  assert.equal(up.planned,'http://localhost:3000','the address the plan names, for its test steps');
  f.net.serving=false;await f.desk.server({...M,command:'stop'});assert.deepEqual(f.calls.filter(([,a])=>a[0]==='kill').map(([,a])=>a[1]),['t1'],'one starting is stopped too');
});

test('the reason told is the one of the last start, even when the list of herdr-core does not date its terminals',async t=>{
  const f=await setup(t,{undated:true});
  await f.desk.server({...M,command:'start'});f.terminals[0].state='finished';f.terminals[0].said='Error: Application Default Credentials are visible at /x\n';
  await f.desk.server({...M,command:'start'});f.terminals[1].state='finished';f.terminals[1].said='Error: the emulators did not start. See their terminal.\n';
  const out=await f.desk.server({...M,command:'status'});
  assert.equal(out.terminal,'t2');assert.equal(out.reason,'Error: the emulators did not start. See their terminal.');
});

test('a server waiting for emulators that crashed says their reason, and a new start replaces it',async t=>{
  const f=await setup(t,{serving:false});await withEmulators(f);
  await f.desk.server({...M,command:'start'});
  const [emu,srv]=f.terminals;assert.ok(srv.labels.includes('fabrique-console.hub=http://127.0.0.1:4400/emulators'));
  assert.equal((await f.desk.server({...M,command:'status'})).starting,true,'emulators still starting');
  emu.state='finished';emu.said='> firebase emulators:start\nTypeError: Cannot read properties of undefined (reading \'prototype\')\n    at Object.<anonymous> (x.js:37:35)\nNode.js v26.8.2\n';
  const out=await f.desk.server({...M,command:'status'});
  assert.equal(out.running,false);assert.equal(out.starting,false);
  assert.equal(out.reason,"The emulators did not start: TypeError: Cannot read properties of undefined (reading 'prototype')");
  await f.desk.server({...M,command:'start'});
  assert.equal(srv.state,'finished','the server that waited in vain is stopped');
  assert.equal(f.runs().filter(r=>r.includes('fabrique-console.role=emulators')).length,2,'the emulators are started again');
  f.net.hub=true;assert.equal((await f.desk.server({...M,command:'status'})).starting,true,'emulators answering: only waiting');
});

test('servers, scripts and emulators run with the Node of their project, never the first one of the PATH',async t=>{
  const f=await setup(t);await withEmulators(f);
  const pkg=join(f.worktree,'admin','package.json'),scripts={'dev:strict':'next dev',emulators:'firebase emulators:start --config firebase.emulators.json'};
  await writeFile(pkg,JSON.stringify({engines:{node:'24.x'},scripts}));
  await f.desk.server({...M,command:'start'});
  for(const run of f.runs()){const at=run.indexOf(NODE_RUN);assert.ok(at>0,'through mise');assert.equal(run[at+2],'24');}
  assert.equal(await nodeOf(join(f.worktree,'admin')),'24');
  await writeFile(pkg,JSON.stringify({engines:{node:'>=24 <25'}}));assert.equal(await nodeOf(join(f.worktree,'admin')),'24');
  await writeFile(pkg,JSON.stringify({engines:{node:'>=22'}}));assert.equal(await nodeOf(join(f.worktree,'admin')),'','a bare lower bound: the version of mise');
  await writeFile(join(f.worktree,'.nvmrc'),'v24.18.1\n');assert.equal(await nodeOf(join(f.worktree,'admin'),f.worktree),'24.18.1','the worktree names it');
  await writeFile(join(f.worktree,'.nvmrc'),'24; rm -rf /\n');assert.equal(await nodeOf(f.worktree),'','only a version is a version');
  assert.equal(await nodeOf(join(f.worktree,'plain')),'','nothing named: the version of mise');
  const {execFile}=await import('node:child_process'),{promisify}=await import('node:util');
  await assert.rejects(promisify(execFile)('sh',['-c',NODE_RUN,'fabrique-console-node','','echo','started'],{env:{PATH:'/usr/bin:/bin'}}),e=>e.code===1&&/mise is not installed, and this project names no Node version/.test(e.stderr)&&!/started/.test(e.stdout||''),'without mise nor version, nothing starts');
  const bin=join(f.root,'node-bin');await mkdir(bin);await writeFile(join(bin,'node'),'#!/bin/sh\necho v24.18.1\n',{mode:0o755});
  const said=(await promisify(execFile)('sh',['-c',NODE_RUN,'fabrique-console-node','24','echo','$1 stays an argument'],{env:{PATH:bin+':/usr/bin:/bin'}})).stdout;
  assert.equal(said,'$1 stays an argument\n','without mise, the Node of the PATH that is the one named: the command itself, its arguments untouched');
});

test('a mise configuration of a project cannot give a test server the Google folder of the user back, nor credentials',async t=>{
  const f=await setup(t);await f.desk.server({...M,command:'start'});
  const command=f.runs()[0].slice(f.runs()[0].indexOf('--')+1),bin=join(f.root,'bin');await mkdir(bin);
  // A mise that applies the [env] of a project, then runs the command; a pnpm that tells what it sees.
  await writeFile(join(bin,'mise'),'#!/bin/sh\nexport CLOUDSDK_CONFIG=/Users/x/.config/gcloud GOOGLE_APPLICATION_CREDENTIALS=/Users/x/adc.json\nwhile [ "$1" != "--" ]; do shift; done; shift; exec "$@"\n',{mode:0o755});
  await writeFile(join(bin,'pnpm'),'#!/bin/sh\necho "$CLOUDSDK_CONFIG|${GOOGLE_APPLICATION_CREDENTIALS-unset}|$PORT|$*"\n',{mode:0o755});
  const {execFile}=await import('node:child_process'),{promisify}=await import('node:util');
  const said=(await promisify(execFile)(command[0],command.slice(1),{env:{PATH:bin+':/usr/bin:/bin',GOOGLE_APPLICATION_CREDENTIALS:'/Users/x/adc.json'}})).stdout;
  assert.equal(said,join(f.root,'state','gcloud-empty')+'|unset|3000|run dev:strict\n');
});

test('review: a terminal that only carries the label of the server is never ours, and only a hub of this Mac is asked',async t=>{
  const f=await setup(t,{serving:false});
  f.terminals.push({id:'tx',pid:1,state:'live',created_ms:99,labels:['fabrique-console.server=M-1','fabrique-console.app=another-app','fabrique-console.role=worker','fabrique-console.hub=https://remote.invalid/emulators']});
  const asked=[];f.net.hub=false;
  const out=await f.desk.server({...M,command:'status'});assert.equal(out.terminal,'tx','seen as the last one, never as ours');assert.equal(out.stuck,undefined);
  await f.desk.server({...M,command:'start'});await f.desk.server({...M,command:'stop'});
  assert.ok(!f.calls.some(([,a])=>a[0]==='kill'&&a[1]==='tx'),'never stopped');
  assert.equal(f.terminals.find(x=>x.id==='tx').state,'live');
});

test('review: without mise, a version named must be the Node of the PATH, or nothing starts and it says why',async()=>{
  const {execFile}=await import('node:child_process'),{promisify}=await import('node:util');
  const run=promisify(execFile)('sh',['-c',NODE_RUN,'fabrique-console-node','24','echo','started'],{env:{PATH:'/usr/bin:/bin'}});
  await assert.rejects(run,e=>e.code===1&&/needs Node 24, and mise is not installed/.test(e.stderr)&&!/started/.test(e.stdout||''));
});

test('review: the address of the app is never the one of its emulators, and keeps its protocol',async t=>{
  const {appAddress}=await import('../src/validation-desk.mjs');
  assert.equal(appAddress('== emulators up: http://127.0.0.1:4410/emulators\n'),null,'only the emulators said something');
  assert.equal(appAddress('== emulators up: http://localhost:4410/emulators\n'),null);
  assert.equal(appAddress('- Local: http://localhost:3000\nView Emulator UI at http://localhost:4000/\n'),'http://localhost:3000');
  assert.equal(appAddress('│ Authentication │ localhost:9099 │ http://localhost:4000/auth │\n'),null,'a row of their table');
  assert.equal(appAddress('== admin: http://localhost:3000  (emulator UI: http://localhost:4010)\n'),'http://localhost:3000');
  assert.equal(appAddress('  - Local: https://localhost:3443\n'),'https://localhost:3443');
  const f=await setup(t,{says:'  - Local: https://localhost:3443\n'});await f.desk.server({...M,command:'start'});
  assert.equal((await f.desk.server({...M,command:'status'})).url,'https://localhost:3443');assert.ok(f.net.asked.includes('https://localhost:3443'));
});

test('review: a server that gave up waiting for its emulators tells their reason, not its own',async t=>{
  const f=await setup(t,{serving:false});await withEmulators(f);await f.desk.server({...M,command:'start'});
  const [emu,srv]=f.terminals;
  emu.state='finished';emu.said='TypeError: Firebase crashed on Node 26\n';
  srv.state='finished';srv.said='Error: the emulators did not start. See their terminal.\n';
  assert.equal((await f.desk.server({...M,command:'status'})).reason,'The emulators did not start: TypeError: Firebase crashed on Node 26');
});

test('review 2: a port label is only a port, and labels that cannot be read never start a second server',async t=>{
  const f=await setup(t,{serving:false});await f.desk.server({...M,command:'start'});
  const srv=f.terminals[0];srv.labels=srv.labels.map(l=>l.startsWith('fabrique-console.port=')?'fabrique-console.port=3000@remote.invalid':l);
  await f.desk.server({...M,command:'status'});assert.ok(!f.net.asked.some(u=>u.includes('remote')),'never asked');
  f.net.getDown=true;
  await assert.rejects(()=>f.desk.server({...M,command:'start'}),e=>e.code==='HC_UNAVAILABLE');
  assert.equal(f.runs().length,1,'no second server');
});

test('review 2: an app said at 127.0.0.1 is found, and a server that failed by itself keeps its own reason',async t=>{
  const {appAddress}=await import('../src/validation-desk.mjs');
  assert.equal(appAddress('App ready at http://127.0.0.1:5173/\n'),'http://127.0.0.1:5173');
  assert.equal(appAddress('i  View Emulator UI at http://127.0.0.1:4000/\n'),null);
  const f=await setup(t,{serving:false});await withEmulators(f);await f.desk.server({...M,command:'start'});
  const [emu,srv]=f.terminals;emu.state='finished';emu.said='stopped\n';
  srv.state='finished';srv.said='Error: Cannot find module next\n';
  assert.equal((await f.desk.server({...M,command:'status'})).reason,'Error: Cannot find module next');
});

test('review 3: a server that says no address is asked with the protocol of its plan',async t=>{
  const f=await setup(t,{plan:'Serveur : admin · pnpm dev:strict · https://localhost:3443',says:'Listening on port 3443\n'});
  await f.desk.server({...M,command:'start'});
  assert.equal((await f.desk.server({...M,command:'status'})).url,'https://localhost:3443');
  assert.ok(f.net.asked.every(u=>u==='https://localhost:3443'));
});

// A core that does not answer, or loses its answer, is unknown, never absent (M2).
test('a listing of the core that comes back with no list says nothing of the server: unknown, never not running',async t=>{
  const f=await setup(t);f.net.lsLost=true;
  await assert.rejects(()=>f.desk.server({...M,command:'status'}),e=>e.code==='HC_UNAVAILABLE');
  await assert.rejects(()=>f.desk.server({...M,command:'start'}),e=>e.code==='HC_UNAVAILABLE');
  assert.deepEqual(f.runs(),[],'no server started on a listing that said nothing');
});

test('the port of another server whose record is lost is not taken for free: nothing starts on a port perhaps given',async t=>{
  const f=await setup(t);
  f.terminals.push({id:'t9',pid:4199,state:'live',created_ms:0,labels:['fabrique-console.app=fabrique-console','fabrique-console.role=server','fabrique-console.server=M-9','fabrique-console.port=3000']});
  f.net.getDown=true;
  await assert.rejects(()=>f.desk.server({...M,command:'start'}),e=>e.code==='HC_UNAVAILABLE');
  assert.deepEqual(f.runs(),[],'not started on 3000, the port of the other server');
});

test('a browser of the QA whose record is lost is neither closed nor opened again: unknown, never another page',async t=>{
  const f=await setup(t);
  await f.desk.qaBrowser({...M,url:'http://localhost:3000'});
  f.net.getDown=true;
  await assert.rejects(()=>f.desk.qaBrowser({...M,url:'http://localhost:3000'}),e=>e.code==='HC_UNAVAILABLE');
  assert.deepEqual(f.calls.filter(([,a])=>a[0]==='kill'),[],'nothing closed');
  assert.equal(f.runs().length,1,'nothing opened again');
});

// An answer that carries no record (`{}`: no terminal, no labels) is no record with no labels: unknown too (M2 review).
test('M2 review: a browser of the QA whose record comes back empty is neither closed nor opened again',async t=>{
  const f=await setup(t);
  await f.desk.qaBrowser({...M,url:'http://localhost:3000'});
  f.net.getEmpty=true;
  await assert.rejects(()=>f.desk.qaBrowser({...M,url:'http://localhost:3000'}),e=>e.code==='HC_UNAVAILABLE');
  assert.deepEqual(f.calls.filter(([,a])=>a[0]==='kill'),[],'nothing closed');
  assert.equal(f.runs().length,1,'nothing opened again');
});

test('M2 review: the port of another server whose record comes back empty is not taken for free',async t=>{
  const f=await setup(t);
  f.terminals.push({id:'t9',pid:4199,state:'live',created_ms:0,labels:['fabrique-console.app=fabrique-console','fabrique-console.role=server','fabrique-console.server=M-9','fabrique-console.port=3000']});
  f.net.getEmpty=true;
  await assert.rejects(()=>f.desk.server({...M,command:'start'}),e=>e.code==='HC_UNAVAILABLE');
  assert.deepEqual(f.runs(),[],'not started on 3000, the port of the other server');
});
