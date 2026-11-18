import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, readdir, mkdir, rm, rename, utimes, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { fixture } from './helpers/backend-fixture.mjs';
import { createWatcher, createWatchActions, watcherStatus, stateDir, issuesFile, TICKET_MS, LEASE_MS, STALE_MS } from '../src/watch.mjs';

// What another watcher does when it takes the lock: under the mutex, as src/watch.mjs does.
async function takeover(dir,pid,extra=async()=>{}) {
  const mutex=join(dir,'watcher.lock'),tmp=mutex+'.test-'+pid+'-'+Date.now();
  await mkdir(tmp);await writeFile(join(tmp,'pid'),String(pid));
  for(;;){try{await rename(tmp,mutex);break;}catch{await new Promise(r=>setTimeout(r,2));}}
  try{await writeFile(join(dir,'watcher.json'),JSON.stringify({pid,startedAt:'y',at:new Date().toISOString()}));await extra();}
  finally{await rename(mutex,tmp+'-gone');await rm(tmp+'-gone',{recursive:true,force:true});}
}
// Releases a mutex the test holds: moved aside first, as the code does (a delete in place leaves it empty an instant).
const release=async dir=>{const aside=join(dir,'gone-'+Date.now()+'-'+Math.random());try{await rename(join(dir,'watcher.lock'),aside);}catch{return;}await rm(aside,{recursive:true,force:true});};
const until=async(check,ms=5000)=>{const end=Date.now()+ms;while(!(await check())){if(Date.now()>end)throw new Error('condition not met in time');await new Promise(r=>setTimeout(r,5));}};
// A watcher on the fixture backend, with a clock and a sleep under the test's control. The sleep of a cycle waits
// for the reads the cycle started, unless the test says not to (`detached`): the loop itself never waits for them.
async function watcherFixture(t,{dispatch,detached=false}={}) {
  const f=await fixture(t,{approved:false});
  await f.write('config.json',{...f.config,projects:[{...f.config.projects[0],teamId:'characterization-team'}]});
  const list=f.tracker.list.bind(f.tracker);f.tracker.list=async(input,...rest)=>{if(input?.teamId&&!input.projectId){f.trackerCalls.push(['team-issues',input]);return {issues:[],cached:false,updatedAt:'2026-03-01T00:00:00Z'};}return list(input,...rest);};
  let clock=Date.parse('2026-11-07T10:00:00Z');const sleeps=[];
  const dir=stateDir(f.home);await mkdir(dir,{recursive:true});
  await writeFile(join(dir,'lease'),new Date(clock).toISOString()+'\n');
  const calls=[];
  const make=pid=>createWatcher({root:f.home,dispatch:async(action,input)=>{calls.push(action);return (dispatch||f.backend.dispatch)(action,input);},loadConfig:f.backend.loadConfig,sleep:async ms=>{sleeps.push(ms);if(!detached)await watcher.settle();else await new Promise(r=>setTimeout(r,2));clock+=ms;},now:()=>clock,pid});
  const watcher=make(process.pid);
  const read=async name=>JSON.parse(await readFile(join(dir,name),'utf8'));
  return {f,dir,watcher,make,calls,sleeps,read,tick:ms=>{clock+=ms;},clock:()=>clock};
}

test('the watcher writes the snapshot every cycle it changes, Tracker every minute, with a heartbeat; files are dated',async t=>{
  const w=await watcherFixture(t);
  await w.watcher.run({cycles:2});
  const files=(await readdir(w.dir)).sort();
  assert.deepEqual(files.filter(n=>!n.startsWith('watcher')),['issues-example.json','lease','my-issues.json','snapshot.json']);
  const snapshot=await w.read('snapshot.json');
  assert.equal(snapshot.at,'2026-11-07T10:00:00.000Z');assert.ok(Array.isArray(snapshot.data.projects));assert.ok(Array.isArray(snapshot.data.sessions));
  const backlog=await w.read(issuesFile('example'));assert.deepEqual(backlog.data.issues,[]);
  const mine=await w.read('my-issues.json');assert.ok(Array.isArray(mine.data.teams));
  assert.deepEqual(w.calls,['snapshot','ticket-backlog','ticket-my-issues','snapshot'],'Tracker once, the snapshot every cycle');
  assert.deepEqual(w.sleeps,[2000]);
  // The heartbeat is gone once the loop ends; while it ran, it named this process.
  assert.equal((await watcherStatus(w.f.home,w.clock())).running,false);
  assert.ok(!files.includes('watcher.json'));
});

test('an unchanged answer is not written again; a poke reads Tracker again at once, with refresh; a stop ends the loop',async t=>{
  const w=await watcherFixture(t);
  await w.watcher.run({cycles:1});
  const before=await readFile(join(w.dir,'snapshot.json'),'utf8');
  await writeFile(join(w.dir,'snapshot.json'),before.replace('"at":"2026','"at":"1999'));
  await w.watcher.run({cycles:1});
  assert.ok((await readFile(join(w.dir,'snapshot.json'),'utf8')).includes('"at":"1999'),'an unchanged snapshot leaves the file alone');
  w.calls.length=0;
  await writeFile(join(w.dir,'poke'),'now\n');
  await w.watcher.run({cycles:1});
  assert.deepEqual(w.calls,['snapshot','ticket-backlog','ticket-my-issues']);
  assert.ok(w.f.trackerCalls.some(c=>c[0]==='team-issues'&&c[1].refresh===true),'a poke rereads Tracker');
  await assert.rejects(()=>readFile(join(w.dir,'poke')),e=>e.code==='ENOENT');
  await writeFile(join(w.dir,'stop'),'\n');
  const {cycles}=await w.watcher.run({cycles:5});
  assert.equal(cycles,1,'a stop ends the loop at its next cycle');
});

test('a lapsed lease ends the loop; a failing read is published as an error, the others go on',async t=>{
  const w=await watcherFixture(t,{dispatch:async(action,input)=>{if(action==='ticket-my-issues'){const e=new Error('Tracker down');e.code='TICKET_API';throw e;}return null;}});
  await w.watcher.run({cycles:1});
  const mine=await w.read('my-issues.json');assert.deepEqual(mine.data,{error:{code:'TICKET_API',message:'Tracker down'}});
  const backlog=await w.read(issuesFile('example'));assert.equal(backlog.data,null);
  w.tick(LEASE_MS+1);
  const {cycles}=await w.watcher.run({cycles:5});
  assert.equal(cycles,1);
});

test('two watchers: the second refuses while the first beats; watch-start spawns one only when none runs',async t=>{
  const w=await watcherFixture(t);
  await writeFile(join(w.dir,'watcher.json'),JSON.stringify({pid:process.pid,startedAt:'x',at:new Date(w.clock()).toISOString()}));
  const second=w.make(process.ppid);
  await assert.rejects(()=>second.run({cycles:1}),e=>e.code==='WATCHER_RUNNING');
  const spawned=[];
  const actions=createWatchActions({root:w.f.home,spawnProcess:(file,args,options)=>{spawned.push({file,args,options});return {pid:4242,unref(){}};},runner:'/fixture/watch-run.mjs',now:w.clock});
  assert.deepEqual(await actions.start(),{started:false,pid:process.pid},'a running watcher is not started twice');
  await writeFile(join(w.dir,'watcher.json'),JSON.stringify({pid:process.pid,startedAt:'x',at:new Date(w.clock()-STALE_MS-1).toISOString()}));
  assert.deepEqual(await actions.start(),{started:true,pid:4242},'a stale heartbeat means no watcher');
  assert.equal(spawned.length,1);assert.equal(spawned[0].file,process.execPath);assert.deepEqual(spawned[0].args,['/fixture/watch-run.mjs']);
  assert.equal(spawned[0].options.detached,true);assert.equal(spawned[0].options.stdio,'ignore');assert.equal(spawned[0].options.env.FABRIQUE_CONSOLE_HOME,w.f.home);
  assert.ok((await readFile(join(w.dir,'lease'),'utf8')).trim().length>0,'starting renews the lease');
  assert.deepEqual(await actions.poke(),{poked:true});
  assert.equal(TICKET_MS,60000);
  // A heartbeat from the future is no proof of life either.
  await writeFile(join(w.dir,'watcher.json'),JSON.stringify({pid:process.pid,startedAt:'x',at:new Date(w.clock()+STALE_MS+1).toISOString()}));
  assert.equal((await watcherStatus(w.f.home,w.clock())).running,false);
});

test('the lock: two watchers that both read a stale heartbeat start one loop only; a watcher that lost the lock leaves it alone',async t=>{
  // A holds the lock while its snapshot answers slowly; B, which read the same stale heartbeat, is refused.
  let release;const slow=new Promise(r=>{release=r;});
  const w=await watcherFixture(t,{detached:true,dispatch:async(action)=>{if(action==='snapshot')await slow;return null;}});
  await writeFile(join(w.dir,'watcher.json'),JSON.stringify({pid:process.pid,startedAt:'x',at:new Date(w.clock()-STALE_MS-1).toISOString()}));
  const a=w.make(process.pid),b=w.make(process.ppid);
  const running=a.run({cycles:2});
  await until(async()=>(await w.read('watcher.json')).startedAt!=='x');
  await assert.rejects(()=>b.run({cycles:2}),e=>e.code==='WATCHER_RUNNING');
  release();
  assert.deepEqual(await running,{cycles:2,owned:true});
  // Another process took the lock while this one ran (its heartbeat looked stale): the loop ends without a word.
  await writeFile(join(w.dir,'watcher.json'),JSON.stringify({pid:process.ppid,startedAt:'y',at:new Date(w.clock()).toISOString()}));
  const taken=await w.make(process.pid).run({cycles:3}).catch(e=>e);
  assert.equal(taken.code,'WATCHER_RUNNING');
  const stolen=w.make(process.pid);
  let cycle=0;
  const w2=await watcherFixture(t,{dispatch:async(action)=>{if(action==='snapshot'&&++cycle===1)await takeover(w2.dir,process.ppid);return null;}});
  const lost=await w2.watcher.run({cycles:4});
  assert.deepEqual(lost,{cycles:2,owned:false},'the loop ends at the next cycle');
  assert.equal(JSON.parse(await readFile(join(w2.dir,'watcher.json'),'utf8')).pid,process.ppid,'the lock of the other watcher is left alone');
  void stolen;
});

test('a slow Tracker read blocks neither the heartbeat nor the snapshot; a stop does not wait for it and its late answer is dropped',async t=>{
  let release;const pending=new Promise(r=>{release=r;});
  const w=await watcherFixture(t,{detached:true,dispatch:async(action)=>{if(action==='ticket-backlog'){await pending;return {issues:[]};}return {projects:[],sessions:[]};}});
  const start=w.clock(),running=w.watcher.run();
  await until(()=>w.calls.filter(c=>c==='snapshot').length>=3);
  const beat=await w.read('watcher.json');
  assert.ok(Date.parse(beat.at)>start,'the heartbeat kept its pace while Tracker hangs');
  assert.equal(w.calls.filter(c=>c==='ticket-backlog').length,1,'Tracker is not read again while it answers');
  assert.equal((await watcherStatus(w.f.home,w.clock())).running,true);
  await writeFile(join(w.dir,'stop'),'\n');
  const ended=await running;
  assert.equal(ended.owned,true);
  release();
  await w.watcher.settle();
  assert.ok(!(await readdir(w.dir)).includes(issuesFile('example')),'the late answer is not published after the stop');
});

test('the mutex: a takeover waits for the process holding it, then finds the new owner; a dead holder is moved aside; an empty lock is no watcher',async t=>{
  const w=await watcherFixture(t);
  // A live process holds the mutex while it installs its lock: the other watcher waits, then is refused.
  await mkdir(join(w.dir,'held'));await writeFile(join(w.dir,'held','pid'),String(process.pid));await rename(join(w.dir,'held'),join(w.dir,'watcher.lock'));
  const waiting=w.make(process.ppid).run({cycles:1});
  await new Promise(r=>setTimeout(r,60));
  await writeFile(join(w.dir,'watcher.json'),JSON.stringify({pid:process.pid,startedAt:'x',at:new Date(w.clock()).toISOString()}));
  await release(w.dir);
  await assert.rejects(()=>waiting,e=>e.code==='WATCHER_RUNNING','the lock written under the mutex is seen by the one that waited');
  // A mutex whose holder is gone does not block anyone.
  await rm(join(w.dir,'watcher.json'),{force:true});
  await mkdir(join(w.dir,'dead'));await writeFile(join(w.dir,'dead','pid'),'999999999');await rename(join(w.dir,'dead'),join(w.dir,'watcher.lock'));
  assert.deepEqual(await w.watcher.run({cycles:1}),{cycles:1,owned:true});
  assert.ok(!(await readdir(w.dir)).some(n=>n.startsWith('watcher.lock')),'the dead mutex is gone');
  // A dead mutex already claimed by a cleaner that died is cleaned by the next one; one claimed by a live cleaner is left to it.
  await mkdir(join(w.dir,'dead2'));await writeFile(join(w.dir,'dead2','pid'),'999999999');await writeFile(join(w.dir,'dead2','tomb-999999999.1'),'999999998');await rename(join(w.dir,'dead2'),join(w.dir,'watcher.lock'));
  assert.deepEqual(await w.watcher.run({cycles:1}),{cycles:1,owned:true});
  await mkdir(join(w.dir,'dead3'));await writeFile(join(w.dir,'dead3','pid'),'999999999');await writeFile(join(w.dir,'dead3','tomb-999999999.1'),String(process.ppid));await rename(join(w.dir,'dead3'),join(w.dir,'watcher.lock'));
  await assert.rejects(()=>w.watcher.run({cycles:1}),e=>e.code==='MUTEX_BUSY');
  await release(w.dir);
  // A tomb of another operation of this very process is another cleaner: left to it as well.
  await mkdir(join(w.dir,'dead4'));await writeFile(join(w.dir,'dead4','pid'),'999999999');await writeFile(join(w.dir,'dead4','tomb-999999999.1'),process.pid+'.0');await rename(join(w.dir,'dead4'),join(w.dir,'watcher.lock'));
  await assert.rejects(()=>w.watcher.run({cycles:1}),e=>e.code==='MUTEX_BUSY');
  await release(w.dir);
  // A tomb that cannot be read is a cleaner at work while it is recent, and gone once it is old.
  await mkdir(join(w.dir,'dead5'));await writeFile(join(w.dir,'dead5','pid'),'999999999');await writeFile(join(w.dir,'dead5','tomb-999999999.1'),'');await rename(join(w.dir,'dead5'),join(w.dir,'watcher.lock'));
  await assert.rejects(()=>w.watcher.run({cycles:1}),e=>e.code==='MUTEX_BUSY');
  const old=new Date(Date.now()-STALE_MS-1000);await utimes(join(w.dir,'watcher.lock','tomb-999999999.1'),old,old);
  assert.deepEqual(await w.watcher.run({cycles:1}),{cycles:1,owned:true});
  // A tomb that cannot be read at all (its rights) is a cleaner at work, however old: no proof, no cleaning.
  await mkdir(join(w.dir,'dead7'));await writeFile(join(w.dir,'dead7','pid'),'999999999');await writeFile(join(w.dir,'dead7','tomb-999999999.1'),'999999998.1');
  await chmod(join(w.dir,'dead7','tomb-999999999.1'),0);await utimes(join(w.dir,'dead7','tomb-999999999.1'),old,old);await rename(join(w.dir,'dead7'),join(w.dir,'watcher.lock'));
  await assert.rejects(()=>w.watcher.run({cycles:1}),e=>e.code==='MUTEX_BUSY');
  await chmod(join(w.dir,'watcher.lock','tomb-999999999.1'),0o600);await release(w.dir);
  // Tombs are complete the moment they exist: no tomb is ever found empty by another cleaner.
  await mkdir(join(w.dir,'dead6'));await writeFile(join(w.dir,'dead6','pid'),'999999999');await rename(join(w.dir,'dead6'),join(w.dir,'watcher.lock'));
  await writeFile(join(w.dir,'watcher.json'),JSON.stringify({pid:process.pid,startedAt:'x',at:new Date(w.clock()).toISOString()}));
  const both=await Promise.all([w.watcher.publish('a.json',{n:1}),w.watcher.publish('b.json',{n:2})]);
  assert.deepEqual(both,[true,true],'two operations of one process on a dead mutex both get their turn');
  assert.ok(!(await readdir(w.dir)).some(n=>n.startsWith('watcher.lock')),'and leave no mutex behind');
  // A lock cut short (empty, or not JSON) is no watcher: it is replaced, and watch-start starts one.
  await writeFile(join(w.dir,'watcher.json'),'');
  assert.equal((await watcherStatus(w.f.home,w.clock())).running,false);
  const spawned=[];
  const actions=createWatchActions({root:w.f.home,spawnProcess:()=>{spawned.push(1);return {pid:1,unref(){}};},runner:'/fixture/watch-run.mjs',now:w.clock});
  assert.equal((await actions.start()).started,true);assert.equal(spawned.length,1);
  await writeFile(join(w.dir,'watcher.json'),'{"pid":');
  assert.deepEqual(await w.watcher.run({cycles:1}),{cycles:1,owned:true});
});

test('a watcher that lost its lock publishes nothing more, not even an answer already on its way; a stop ends the series of reads',async t=>{
  let release;const pending=new Promise(r=>{release=r;});
  let snapshots=0;
  const w=await watcherFixture(t,{detached:true,dispatch:async(action)=>{if(action==='snapshot'&&++snapshots===1){await pending;return {generation:'old'};}return {generation:'fresh'};}});
  const running=w.watcher.run();
  await until(()=>snapshots>=1);
  // Another watcher takes the lock (this one's heartbeat looked stale to it) and publishes, under the mutex as any watcher does.
  await takeover(w.dir,process.ppid,()=>writeFile(join(w.dir,'snapshot.json'),JSON.stringify({at:'now',data:{generation:'new'}})));
  release();
  const result=await running;
  assert.equal(result.owned,false);
  await w.watcher.settle();
  assert.deepEqual((await w.read('snapshot.json')).data,{generation:'new'},'the late answer of the old owner does not cover the new one');
  assert.equal(JSON.parse(await readFile(join(w.dir,'watcher.json'),'utf8')).pid,process.ppid);
  // A stop while a backlog hangs: the loop ends at its next cycle without waiting, and My issues is not read.
  let free;const hang=new Promise(r=>{free=r;});
  const w2=await watcherFixture(t,{detached:true,dispatch:async(action)=>{if(action==='ticket-backlog'){await hang;return {issues:[]};}return {projects:[],sessions:[]};}});
  const run2=w2.watcher.run();
  await until(()=>w2.calls.includes('ticket-backlog'));
  await writeFile(join(w2.dir,'stop'),'\n');
  const ended=await Promise.race([run2,new Promise(r=>setTimeout(()=>r('late'),500))]);
  assert.notEqual(ended,'late','the loop does not wait for the read');
  assert.deepEqual(ended.owned,true);
  free();
  await w2.watcher.settle();
  assert.ok(!w2.calls.includes('ticket-my-issues'),'the series stops where the loop ended');
  assert.ok(!(await readdir(w2.dir)).includes(issuesFile('example')),'the late backlog is not published');
});

test('a failure of the storage ends the loop and the run, so the resident exits; a failure of a read does not',async t=>{
  const w=await watcherFixture(t);
  // The folder of the state is made read-only after the lock is taken: the first publication fails.
  await w.watcher.run({cycles:1});
  let count=0;
  const w2=await watcherFixture(t,{dispatch:async(action)=>{if(action==='snapshot'&&++count===1)await chmod(w2.dir,0o500);return null;}});
  await assert.rejects(()=>w2.watcher.run({cycles:3}),e=>['EACCES','EPERM'].includes(e.code));
  await chmod(w2.dir,0o700);
  assert.ok(count<3,'the loop did not go on after the failure');
});

test('after each step of the chain the active missions are published, dated, with a short story',async t=>{
  const w=await watcherFixture(t);
  await w.f.write('config.json',{...w.f.config,projects:[{...w.f.config.projects[0],teamId:'characterization-team'}]});
  await w.f.backend.dispatch('mission-create',{project:'example',issueId:'characterization-issue',request:'Demande'});
  await w.watcher.run({cycles:3});
  assert.ok(w.calls.includes('dev-chain-tick-all'));
  const published=await w.read('missions.json');
  assert.equal(published.at.slice(0,4),'2026');
  assert.deepEqual(published.data.map(m=>[m.id,m.step,m.request]),[['M-1','requested','Demande']]);
  assert.deepEqual(published.data[0].journal,[]);assert.equal(published.data[0].on,false);
  const inbox=await w.read('inbox.json');assert.equal(inbox.at.slice(0,4),'2026');assert.deepEqual(inbox.data,{items:[]});
});

test('a list of missions that cannot be read is published as its error',async t=>{
  const w=await watcherFixture(t,{dispatch:async action=>{if(action==='mission-list'){const e=new Error('state busy');e.code='BUSY';throw e;}return null;}});
  await w.watcher.run({cycles:3});
  assert.deepEqual((await w.read('missions.json')).data,{error:{code:'BUSY',message:'state busy'}});
});
