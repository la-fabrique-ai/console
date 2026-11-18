import test from 'node:test';
import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { fstatSync,statSync } from 'node:fs';
import { join } from 'node:path';
import { withLock } from '../../../../src/common.mjs';
import { enrichedFixture } from './helpers/enriched-fixture.mjs';

const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
async function bounded(promise){let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Concurrent readers did not reach the held cache lock')),5000);})]);}finally{clearTimeout(timer);}}

for(const warm of [false,true])test('two enriched readers wait for the same held cache guard with '+(warm?'existing':'cold')+' cache',async t=>{
  const f=await enrichedFixture(t),base=join(f.home,'cache','linear-enriched');
  if(warm){await f.read('ticket-projects');await f.read();}
  const requests=f.calls.length,entered=deferred(),release=deferred(),attempted=deferred();
  const owner=withLock(base,async()=>{entered.resolve();await release.promise;});await bounded(entered.promise);
  const target=statSync(join(base,'operation.guard')),spawn=childProcess.spawn;
  let busy=0,reads=[];
  childProcess.spawn=function(file,args,options){
    const child=spawn.apply(this,arguments);
    if(file==='/usr/bin/lockf'&&options.stdio?.[3]!==undefined){
      const info=fstatSync(options.stdio[3]);
      if(info.dev===target.dev&&info.ino===target.ino)child.once('exit',code=>{if(code===75&&++busy===2)attempted.resolve();});
    }
    return child;
  };
  syncBuiltinESMExports();
  try{
    // Observe actual native BUSY exits before releasing the owner. No sleep or
    // production hook decides whether both operations really met contention.
    reads=[f.read('ticket-projects'),f.read()].map(promise=>promise.then(value=>({value}),error=>({error})));
    await bounded(attempted.promise);assert.equal(f.calls.length,requests);
    release.resolve();await owner;
    for(const result of await Promise.all(reads)){
      assert.equal(result.error,undefined);assert.equal(result.value.status,'complete');assert.equal(result.value.cached,warm);
    }
    assert.equal(f.calls.length,requests+(warm?0:2));
  }finally{
    release.resolve();await owner;await Promise.allSettled(reads);
    childProcess.spawn=spawn;syncBuiltinESMExports();
  }
});

test('cache guard contention ends as a partial envelope when the operation budget expires',async t=>{
  const f=await enrichedFixture(t,{options:{budgetMs:120}}),base=join(f.home,'cache','linear-enriched'),entered=deferred(),release=deferred();
  const owner=withLock(base,async()=>{entered.resolve();await release.promise;});await bounded(entered.promise);
  try{
    const start=performance.now(),result=await f.read();
    assert.equal(result.status,'partial');assert.ok(result.partialReasons.some(item=>item.reason==='deadline'));assert.equal(result.data.issues.total,null);assert.equal(f.calls.length,0);assert.ok(performance.now()-start<1500);
  }finally{release.resolve();await owner;}
});
