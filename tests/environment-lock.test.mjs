// M6, review point 3: one environment check at a time per project, proved with real processes racing for the lock,
// during its creation, during the reclaim of an old `.running` (a version before), and after a holder is killed. Every child is a node
// process of this test (tests/helpers/environment-lock-child.mjs), killed at the end if still alive.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CHILD=fileURLToPath(new URL('./helpers/environment-lock-child.mjs',import.meta.url));
const until=async(condition,what,ms=20000)=>{const end=Date.now()+ms;while(!condition()){if(Date.now()>end)throw new Error('timeout: '+what);await new Promise(r=>setTimeout(r,10));}};

function race(t,count) {
  const dir=realpathSync(mkdtempSync(join(tmpdir(),'mc-env-l-')));
  const root=join(dir,'state'),control=join(dir,'control');mkdirSync(root);mkdirSync(control);
  const children=[];
  t.after(async()=>{
    for(const c of children)if(c.exitCode===null&&c.signalCode===null)c.kill('SIGKILL');
    await Promise.all(children.map(c=>c.done));
    rmSync(dir,{recursive:true,force:true});
  });
  const start=names=>{for(const name of names){
    const child=spawn(process.execPath,[CHILD,root,control,name],{stdio:['ignore','pipe','pipe']});
    let out='';child.stdout.on('data',d=>{out+=d;});child.stderr.on('data',()=>{});
    child.done=new Promise(r=>child.once('exit',()=>r()));
    child.result=()=>{try{return JSON.parse(out.trim().split('\n').pop());}catch{return null;}};
    child.name=name;children.push(child);
  }};
  const names=Array.from({length:count},(_,i)=>'c'+i);
  return {dir,root,control,children,names,start,
    held:()=>readdirSync(control).filter(n=>n.startsWith('held-')),
    exited:()=>children.filter(c=>c.exitCode!==null||c.signalCode!==null),
    running:join(root,'environment','example','.running'),
    markers:()=>{try{return readdirSync(join(root,'environment','example')).filter(n=>n==='.running'||/^\.running-[a-f0-9]{24}$/.test(n));}catch{return [];}}};
}
// Starts every child together (each waits for `go`), then waits until each one either holds the lock or has exited.
async function together(r) {
  r.start(r.names);
  await until(()=>r.names.every(n=>existsSync(join(r.control,'ready-'+n))),'children ready');
  writeFileSync(join(r.control,'go'),'');
  await until(()=>r.held().length+r.exited().length>=r.names.length,'every child decided');
  // Give a late second holder a chance to show itself before judging.
  await new Promise(r=>setTimeout(r,300));
}

test('lock: five checks started together, the lock being created: exactly one runs, the four others are ENVIRONMENT_BUSY',async t=>{
  const r=race(t,5);
  await together(r);
  assert.equal(r.held().length,1,'holders: '+r.held().join(' '));
  const busy=r.exited().map(c=>c.result());
  assert.equal(busy.length,4);assert.ok(busy.every(b=>b?.error==='ENVIRONMENT_BUSY'),JSON.stringify(busy));
  writeFileSync(join(r.control,'release'),'');
  await Promise.all(r.children.map(c=>c.done));
  const holder=r.children.find(c=>'held-'+c.name===r.held()[0]).result();
  assert.equal(holder.status,'failed');assert.equal(holder.cause,'DB_UNKNOWN');assert.equal(holder.previous,null);
  assert.deepEqual(r.markers(),[]);
});

test('lock: an old `.running` of a dead check, reclaimed by five checks together: exactly one runs and says « interrupted »',async t=>{
  const r=race(t,5);
  mkdirSync(join(r.root,'environment','example'),{recursive:true});
  writeFileSync(r.running,JSON.stringify({pid:999999,birth:'Thu Jan  1 00:00:00 1970',at:'2026-11-14T00:00:00.000Z'}));
  await together(r);
  assert.equal(r.held().length,1,'holders: '+r.held().join(' '));
  assert.ok(r.exited().every(c=>c.result()?.error==='ENVIRONMENT_BUSY'),JSON.stringify(r.exited().map(c=>c.result())));
  writeFileSync(join(r.control,'release'),'');
  await Promise.all(r.children.map(c=>c.done));
  const holder=r.children.find(c=>'held-'+c.name===r.held()[0]).result();
  assert.equal(holder.previous,'interrupted');
  assert.deepEqual(r.markers(),[]);
});

test('lock: a check killed while holding the lock frees it at once; the next says « interrupted » and runs',async t=>{
  const r=race(t,1);
  await together(r);
  assert.equal(r.held().length,1);
  const victim=r.children[0];victim.kill('SIGKILL');await victim.done;
  assert.equal(r.markers().length,1,'the killed check leaves its own marker');
  // The next check, with the release already there: it is not refused and names the interrupted one.
  writeFileSync(join(r.control,'release'),'');rmSync(join(r.control,'go'));
  r.names=['next'];await together(r);
  await Promise.all(r.children.map(c=>c.done));
  const next=r.children.find(c=>c.name==='next').result();
  assert.equal(next.status,'failed',JSON.stringify(next));assert.equal(next.previous,'interrupted');
  assert.deepEqual(r.markers(),[],'a check run again removes the marker of the dead one');
});
