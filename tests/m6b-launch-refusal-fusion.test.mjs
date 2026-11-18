// M6 (b), the engine, fusion review point 3 of the refusal of a launch (decision 111): a first check green, then the
// check under the lock refuses: the chain of an adopted or resumed mission is neither moved nor started. The first pass
// of a launch writes nothing; the chain is settled only once the check under the lock lets the launch by, by a launch
// asked or by the watcher on its own. Fakes only: never a real base, container, Herdr or agent.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setup, leadMission, devRuns, FG2 } from './helpers/dev-chain-setup.mjs';
import { createMissionRegistry } from '../src/mission.mjs';
import { createQuestionRegistry, createQuestionActions } from '../src/questions.mjs';
import { createRequestRegistry } from '../src/requests.mjs';
import { asScreen } from './helpers/versions.mjs';

const NOT_RECORDS=/(^|\/)(operation\.guard|legacy-archive\.json)$/;
function snapshot(dir) {
  const out={};
  const walk=d=>{for(const name of readdirSync(d)){const p=join(d,name);if(statSync(p).isDirectory())walk(p);else if(!NOT_RECORDS.test(p))out[p.slice(dir.length)]=readFileSync(p,'utf8');}};
  try{walk(dir);}catch(error){if(error.code!=='ENOENT')throw error;}
  return out;
}
const STEPS=[{key:'database',ok:true,status:'green'},{key:'migrations',ok:true,status:'green',journal:3,pending:0},{key:'accounts',ok:true,status:'green',accounts:{po:true,dev:true}}];
const READY={state:'ready',ok:true,recheck:true,at:'2026-11-16T10:00:00.000Z',checks:STEPS};
const UNCHECKED={state:'unchecked',ok:false,cause:'NOT_CHECKED',recheck:true,checks:[]};
const chainFile=(root,id)=>join(root,'state','devchain-'+id+'.json');
const writeChain=(root,id,data)=>{mkdirSync(join(root,'state'),{recursive:true});writeFileSync(chainFile(root,id),JSON.stringify({done:{},log:[],seen:{},paths:{},bases:{},on:true,digest:[],withheld:[],digestAt:0,settled:false,lane:null,laneSeq:0,...data})+'\n');};
// Green at the first reading, not green at every reading after it.
const greenOnce=()=>{let n=0;const reader=async()=>(n++===0?READY:UNCHECKED);reader.count=()=>n;return reader;};
const resumed=async (c,from,on)=>{
  const {missions}=await leadMission(c.root);
  await missions.update('M-1',m=>{m[from]='s0';});
  writeChain(c.root,'s0',{on,log:[{at:'10:00',text:'fil ancien',tone:'ok',detail:''}]});
  return missions;
};

test('a launch green at the first check, refused under the lock: the chain of an adopted or resumed mission is neither moved nor started',async t=>{
  for(const from of ['adoptedFrom','resumedFrom'])for(const on of [false,true]) {
    const reader=greenOnce(),c=await setup({environment:reader});t.after(c.cleanup);
    await resumed(c,from,on);
    const before=snapshot(join(c.root,'state'));
    // The page reads the chain as settle would leave it, and moves nothing.
    assert.equal((await c.chain.read({mission:'M-1'})).on,on||from==='resumedFrom',from);
    await assert.rejects(()=>c.chain.launch({mission:'M-1',tickets:[FG2]}),{code:'ENVIRONMENT_NOT_READY'},from);
    assert.equal(reader.count(),2,from+': green first, then refused under the lock');
    assert.deepEqual(snapshot(join(c.root,'state')),before,from+': nothing written');
    assert.equal(existsSync(chainFile(c.root,'M-1')),false,from+': the chain stays where it was');
    assert.equal(JSON.parse(readFileSync(chainFile(c.root,'s0'),'utf8')).on,on,from+': on unchanged');
    assert.equal(devRuns(c.calls,'XJ-2'),0);
  }
});

test('the watcher on a resumed mission, the environment not green: its chain is neither moved nor started; green, it is settled and the dev starts once',async t=>{
  for(const from of ['adoptedFrom','resumedFrom']) {
    let current=UNCHECKED;
    const c=await setup({environment:async()=>current});t.after(c.cleanup);
    const missions=await resumed(c,from,from==='adoptedFrom');
    const before=snapshot(join(c.root,'state'));
    for(let n=0;n<2;n++)await c.make().tick({mission:'M-1'});
    assert.deepEqual(snapshot(join(c.root,'state')),before,from+': nothing written');
    assert.equal(existsSync(chainFile(c.root,'M-1')),false,from+': not moved');
    assert.equal(devRuns(c.calls,'XJ-2'),0);
    current=READY;
    await c.make().tick({mission:'M-1'});
    assert.equal(existsSync(chainFile(c.root,'s0')),false,from+': moved once green');
    const chain=JSON.parse(readFileSync(chainFile(c.root,'M-1'),'utf8'));
    assert.equal(chain.on,true);
    assert.ok(chain.log.some(l=>l.text==='fil ancien'),from+': its story goes with it');
    assert.equal(devRuns(c.calls,'XJ-2'),1,from+': the dev starts once');
    assert.equal(typeof (await missions.read('M-1')).devStartedAt,'string');
  }
});

test('the watcher on a resumed mission, green at the first check and not green after: the chain is moved only with the dev it launches',async t=>{
  const reader=greenOnce(),c=await setup({environment:reader});t.after(c.cleanup);
  await resumed(c,'resumedFrom',false);
  await c.make().tick({mission:'M-1'});
  const launched=devRuns(c.calls,'XJ-2'),moved=existsSync(chainFile(c.root,'M-1'));
  // The reading that lets the chain be settled is the one kept to the launch: never moved and refused.
  assert.equal(moved,launched===1,'moved: '+moved+', launched: '+launched);
  if(!moved)assert.equal(JSON.parse(readFileSync(chainFile(c.root,'s0'),'utf8')).on,false,'on unchanged');
});

// Fusion review, blocking point: the environment not green holds only the launch. The exchanges go on: the question of
// an agent is taken in and told to the Lead, the decision of the user is carried to it, and the chain is neither moved
// nor started.
test('the watcher on a resumed mission, the environment not green: questions and answers still go, and the chain is neither moved nor started',async t=>{
  let current=UNCHECKED;
  const c=await setup({environment:async()=>current});t.after(c.cleanup);
  await resumed(c,'resumedFrom',false);
  const questions=createQuestionRegistry({root:c.root}),missions=createMissionRegistry({root:c.root}),inbox=createRequestRegistry({root:c.root,questions,missions,notify:async()=>{}});
  const actions=asScreen(createQuestionActions({questions,inbox,missions,launch:c.chain.launch}),inbox);
  const toLead=()=>c.sent.filter(x=>x.terminal==='t1');
  c.reports.push({name:'XJ-2.ask-1794000000000.json',ticket:'XJ-2',kind:'ask',at:'2026-11-10T10:00:00.000Z',question:'Quel rôle ?',options:['Garder','Fusionner'],from:'dev'});
  const M={mission:'M-1'};
  await c.make().tick(M);await c.make().tick(M);
  assert.equal((await questions.list(M)).length,1,'the question is taken in');
  assert.equal(toLead().length,1,'the question is told to the Lead, once');
  assert.ok(toLead()[0].text.includes('Q-1')&&toLead()[0].text.includes('lead-answer'));
  await actions.escalate({mission:'M-1',question:'Q-1',ticket:'XJ-2',type:'decision',title:'Repli image',text:'Client ou serveur ?',recommendation:'Serveur',why:'Coût récurrent'});
  await actions.decide({item:'I-1',text:'Serveur, plafond 50'});
  await c.make().tick(M);await c.make().tick(M);
  const relayed=toLead().filter(x=>x.text.includes('Serveur, plafond 50'));
  assert.equal(relayed.length,1,'the answer of the user reaches the Lead, once');
  assert.match(relayed[0].text,/<legacyOwner-decision>/);
  assert.equal(existsSync(chainFile(c.root,'M-1')),false,'not moved');
  const kept=JSON.parse(readFileSync(chainFile(c.root,'s0'),'utf8'));
  assert.equal(kept.on,false,'not started');
  assert.ok(kept.done['route|Q-1']!==undefined,'the marks of the exchanges are kept where the chain is');
  assert.equal(devRuns(c.calls,'XJ-2'),0);
  // Green, the chain is settled with the marks of the exchanges: nothing told is told again.
  current=READY;
  await c.make().tick(M);
  const moved=JSON.parse(readFileSync(chainFile(c.root,'M-1'),'utf8'));
  assert.equal(moved.on,true);
  assert.ok(moved.done['route|Q-1']!==undefined&&moved.done['relay|Q-1']!==undefined,'the marks go with the chain');
  assert.equal(toLead().filter(x=>x.text.includes('Serveur, plafond 50')).length,1,'not told again');
});
