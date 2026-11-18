import test from 'node:test';
import assert from 'node:assert/strict';
import { fakeHerdr } from './helpers/fake-herdr.mjs';

// The window as src/herdr.mjs reads it (M9 review): a terminal with no agent (its shell kept after the agent exited) is
// said so; a status left out or not known is not. A command refused by herdr-app is told apart from an answer lost.
const windowOf=on=>fakeHerdr({on:async(file,args)=>on(file,args)}).herdr.window;
const listing=terminals=>({stdout:JSON.stringify({spaces:[{id:'s',name:'S',active:true,tabs:[{id:'x',name:'XJ-2 · revue',active:true,terminals}]}]})});

test('the window says which terminal holds a shell and no agent; a status left out or unknown says nothing (M9 review)',async()=>{
  const cases=[[{terminal:'t1',status:null},true],[{terminal:'t1',status:'working'},false],[{terminal:'t1'},false],[{terminal:'t1',status:'rebooting'},false],
    [{terminal:'t1',status:null,program:{key:'claude',agent:true,shell:false}},false],[{terminal:'t1',status:'idle',program:{key:'shell',agent:false,shell:true}},true]];
  for(const [terminal,shell] of cases){
    const {agents}=await windowOf(()=>listing([terminal])).ls();
    assert.equal(agents[0].shell,shell,JSON.stringify(terminal));
  }
});

test('a command of the window refused by herdr-app is refused; an answer lost or unreadable is uncertain (M9 review)',async()=>{
  const refused=windowOf(()=>{throw Object.assign(new Error('Command failed'),{code:1,stdout:'{"error":"no such space"}\n'});});
  await assert.rejects(()=>refused.run('tab.new',{name:'x'}),e=>e.refused===true&&!e.uncertain);
  const lost=windowOf(()=>{throw Object.assign(new Error('Command failed'),{killed:true,signal:'SIGTERM',stdout:''});});
  await assert.rejects(()=>lost.run('tab.new',{name:'x'}),e=>e.uncertain===true&&!e.refused);
  const cut=windowOf(()=>({stdout:'{"terminal":'}));
  await assert.rejects(()=>cut.run('tab.new',{name:'x'}),e=>e.uncertain===true);
  assert.deepEqual(await windowOf(()=>({stdout:'{"terminal":"t9"}'})).run('tab.new',{name:'x'}),{terminal:'t9'});
});
