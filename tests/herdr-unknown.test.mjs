import test from 'node:test';
import assert from 'node:assert/strict';
import { fakeHerdr } from './helpers/fake-herdr.mjs';

// A Herdr that does not answer, or loses its answer, is unknown, never absent (M2). Absent is only what Herdr itself
// said: a listing that lists nothing, a terminal it answers not_found for.
const mute=()=>Object.assign(new Error('Command failed: hc'),{killed:true,signal:'SIGTERM',code:null,stdout:'',stderr:''});
const notFound=()=>Object.assign(new Error('Command failed: hc'),{code:3,stdout:'',stderr:JSON.stringify({error:{kind:'not_found',message:'no terminal'}})+'\n'});
const answering=answer=>fakeHerdr({on:async()=>{if(answer instanceof Error)throw answer;return {stdout:answer,stderr:''};}}).herdr;
const unknown=e=>e.code==='HC_UNAVAILABLE';

test('a listing of terminals that is not answered, lost or carries no list is unknown; an empty list is absent',async()=>{
  for(const [label,answer] of [['no answer',mute()],['an answer lost (nothing on stdout)',''],['an answer cut short','{"terminals":['],['an answer with no list','{}'],['an error said on stdout','{"error":{"kind":"internal"}}'],['a list that is not one','{"terminals":null}']])
    await assert.rejects(()=>answering(answer).list({label:'fabrique-console.role=server'}),unknown,label);
  assert.deepEqual(await answering('{"terminals":[]}').list(),[],'Herdr said: none');
  assert.deepEqual(await answering('[]').list(),[]);
  assert.deepEqual(await answering('{"terminals":[{"address":"t1"}]}').list(),[{address:'t1'}]);
});

test('the record of a terminal that is not answered or lost is unknown; only not_found says it is gone',async()=>{
  for(const [label,answer] of [['no answer',mute()],['an error that is not not_found',Object.assign(new Error('Command failed: hc'),{code:1,stderr:'boom'})],['an answer lost',''],['an answer that is no record','[]'],['null','null'],['an empty record','{}'],['a record with no terminal','{"labels":{"a":"1"}}'],['a record with no labels','{"address":"t4"}'],['labels that are none','{"address":"t4","labels":"a=1"}']])
    await assert.rejects(()=>answering(answer).record('t4'),unknown,label);
  assert.equal(await answering(notFound()).record('t4'),null,'Herdr said: no such terminal');
  assert.deepEqual(await answering('{"address":"t4","labels":{"a":"1"}}').record('t4'),{address:'t4',labels:{a:'1'}});
  assert.deepEqual(await answering('{"id":"t4","labels":["a=1"]}').record('t4'),{id:'t4',labels:['a=1']},'labels as a list, as older cores give them');
  assert.deepEqual(await answering('{"address":"t4","labels":{}}').record('t4'),{address:'t4',labels:{}},'Herdr said: no labels');
});

test('a listing of the window that is not answered, lost or carries no spaces is unknown, never a window with no tabs',async()=>{
  for(const [label,answer] of [['no answer',mute()],['an answer lost',''],['an answer with no spaces','{}'],['spaces that are not a list','{"spaces":{}}']])
    await assert.rejects(()=>answering(answer).window.ls(),label);
  await assert.rejects(()=>answering('{}').window.ls(),unknown,'said unknown');
  assert.deepEqual(await answering('{"spaces":[]}').window.ls(),{agents:[],shown:null,spaces:[]},'Herdr said: nothing open');
});

test('the one fake Herdr: a window that does not answer is unknown to the chain too, through the same module',async()=>{
  const f=fakeHerdr({agents:[{address:'t1',space:'sp',tab:'po',tab_name:'PO',status:'idle'}]});
  assert.equal((await f.herdr.window.ls()).agents.length,1);
  f.faults.hidden=()=>true;
  assert.deepEqual((await f.herdr.window.ls()).agents,[],'a window that answers and lists nothing is empty');
  const lost=f.through(async(file,args,options)=>file==='herdr-app'?{stdout:''}:f.invoke(file,args,options));
  await assert.rejects(()=>lost.window.ls(),'a lost answer is no empty window');
});

test('M2 review: the one fake Herdr keeps the terminals it makes with no agents given: a tab made, a dev shown in a tab',async()=>{
  const f=fakeHerdr();
  const made=await f.herdr.window.run('tab.new',{space:'sp',name:'PO'});
  assert.deepEqual((await f.herdr.window.ls()).agents.map(a=>a.address),[made.terminal],'the tab made by tab.new');
  const dev=await f.herdr.kernel.run({name:'dev-m1',cwd:'/w',labels:{'herdr.space':'sp','herdr.tab':'dev'},argv:['claude']});
  const agents=(await f.herdr.window.ls()).agents;
  assert.deepEqual(agents.map(a=>a.address),[made.terminal,dev.address],'and the dev the core shows in a tab');
  assert.equal(agents[1].tab,'dev');
  await f.herdr.window.run('tab.close',{id:'dev'});
  assert.equal((await f.herdr.kernel.get('dev-m1')).state,'finished','its tab closed, the dev has ended');
});

test('M2 review: the window says its status and takes a picture through the module',async()=>{
  const sent=[];
  const f=fakeHerdr({on:async(file,args,options)=>{sent.push([file,args,options.timeout]);return {stdout:args[0]==='status'?'{"errors":[]}\n':''};}});
  assert.deepEqual(await f.herdr.window.status(),{errors:[]});
  await f.herdr.window.shot('/w/docs/local/a-shot.png');
  assert.deepEqual(sent,[['herdr-app',['status'],15000],['herdr-app',['shot','/w/docs/local/a-shot.png'],30000]]);
  await assert.rejects(()=>f.herdr.window.shot('a-shot.png'),e=>e.code==='INVALID_ARGUMENT','a picture goes to an absolute path');
  await assert.rejects(()=>fakeHerdr({on:async()=>({stdout:''})}).herdr.window.status(),e=>e.code==='HC_UNAVAILABLE','a status lost is unknown');
});
