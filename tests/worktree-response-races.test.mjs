import test from 'node:test';
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { writeFile,access } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { groupAlive } from '../src/git-process-group.mjs';
import { worktreeFixture } from './helpers/worktree-fixture.mjs';

const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(predicate){const end=Date.now()+10000;while(!await predicate()&&Date.now()<end)await delay(10);assert.ok(await predicate(),'Fixture checkpoint missing');}
async function start(f,job,name) {
  const path=join(f.root,name+'.json');await writeFile(path,JSON.stringify({root:f.home,issues:[...f.issues.values()],...job}));
  const child=fork(new URL('./helpers/worktree-client-process.mjs',import.meta.url),[path],{silent:true}),messages=[];
  child.on('message',message=>messages.push(message));await until(()=>messages.some(message=>message.ready));return {child,messages};
}
async function stop(child){if(child.exitCode!==null||child.signalCode!==null)return;const done=once(child,'exit');child.kill('SIGKILL');await done;}

test('two real clients of different families cannot implement the same ticket concurrently',async t=>{
  const f=await worktreeFixture(t),codex=await f.plan(),claude=await f.plan({tool:'claude'});
  const clients=await Promise.all([start(f,{action:'worktree-prepare',input:{planId:codex.planId}},'codex-client'),start(f,{action:'worktree-prepare',input:{planId:claude.planId}},'claude-client')]);
  try {
    clients.forEach(client=>client.child.send('go'));await until(()=>clients.every(client=>client.messages.some(message=>message.done)));
    const results=clients.map(client=>client.messages.find(message=>message.done));assert.ok(results.every(message=>!message.error),JSON.stringify(results));
    assert.equal(results.filter(message=>message.result.status==='prepared').length,1,JSON.stringify(results));
    assert.equal(results.filter(message=>message.result.status==='refused').length,1,JSON.stringify(results));
    assert.equal((await f.read('workspace-state.json')).attempts.length,1);
    assert.equal((await f.command('git',['-C',f.repo,'worktree','list','--porcelain'])).stdout.match(/^worktree /gm).length,2);
  }finally{await Promise.all(clients.map(client=>stop(client.child)));}
});

test('parent SIGKILL after durable prepared publication but before its response reuses exactly that checkout',async t=>{
  const f=await worktreeFixture(t),plan=await f.plan(),client=await start(f,{action:'worktree-prepare',input:{planId:plan.planId},workspaceOptions:{workerPath:fileURLToPath(new URL('./helpers/worktree-published-worker.mjs',import.meta.url))}},'published-response');let group;
  try {
    client.child.send('go');await until(async()=>{try{await access(join(f.home,'prepared-published'));return true;}catch{return false;}});
    const attempt=(await f.read('workspace-state.json')).attempts[0];group=attempt.worker.pgid;
    assert.equal(attempt.status,'prepared');assert.ok(attempt.preparedAt);assert.equal(client.messages.some(message=>message.done),false);
    await stop(client.child);process.kill(-group,'SIGKILL');await until(()=>!groupAlive(group));
    const proof=await f.backend.dispatch('worktree-reconcile',{preparationId:attempt.preparationId});assert.equal(proof.status,'prepared');
    const reused=await f.prepare(plan);assert.equal(reused.preparationId,attempt.preparationId);assert.equal(reused.preparation.worktree,attempt.worktree);
    assert.equal((await f.command('git',['-C',f.repo,'worktree','list','--porcelain'])).stdout.match(/^worktree /gm).length,2);
  }finally{await stop(client.child);if(group&&groupAlive(group)){process.kill(-group,'SIGKILL');await until(()=>!groupAlive(group));}}
});
