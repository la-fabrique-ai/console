import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { askOf, createWaiting } from '../src/waiting.mjs';
import { waitingAgents } from '../ui/v3/view.js';

import { fakeHerdr } from './helpers/fake-herdr.mjs';
const CODEX=`• Running git restore -- a.json

  Would you like to run the following command?

  Environment: local

  Reason: \`/bin/zsh -lc 'git restore -- a.json'\` requires approval by policy

  $ git restore -- a.json

› 1. Yes, proceed (y)
  2. No, and tell Codex what to do differently (esc)

  Press enter to confirm or esc to cancel
[hc] only its screen: it is blocked; history is not scrolled in this state
`;
const CLAUDE=`─────────────
 Bash command

   rm -rf build
   Remove the build folder

 Do you want to proceed?
 ❯ 1. Yes
   2. Yes, and don't ask again
   3. No
`;

test('what an agent asks is read from its screen, whatever the agent',()=>{
  assert.deepEqual(askOf(CODEX),{question:'Would you like to run the following command?',command:'git restore -- a.json',details:["Reason: `/bin/zsh -lc 'git restore -- a.json'` requires approval by policy"]});
  assert.deepEqual(askOf(CLAUDE),{question:'Do you want to proceed?',command:'rm -rf build',details:['Remove the build folder']});
  assert.deepEqual(askOf('Une ligne.\nQuel format préfères-tu ?\n1. A\n2. B'),{question:'Quel format préfères-tu ?',command:null,details:[]});
});

test('a screen with no question gives its last line, an empty one nothing',()=>{
  assert.deepEqual(askOf('En cours\nDernière ligne'),{question:'Dernière ligne',command:null,details:[]});
  assert.deepEqual(askOf(''),{question:null,command:null,details:[]});assert.deepEqual(askOf(null),{question:null,command:null,details:[]});
  assert.ok(askOf('$ x\n'+'y'.repeat(900)+' ?').question.length<=301);
});

test('only a terminal is read, and a core that does not answer says so',async()=>{
  const calls=[],desk=createWaiting({herdr:fakeHerdr({on:async(file,args)=>{calls.push([file,args]);return {stdout:CODEX};}}).herdr});
  assert.equal((await desk.read({terminal:'t30'})).command,'git restore -- a.json');
  assert.deepEqual(calls,[['hc',['read','t30','--lines','40']]]);
  for(const bad of [{terminal:'x;y'},{terminal:1},{},{terminal:'t1',more:1}])await assert.rejects(()=>desk.read(bad),e=>e.code==='INVALID_ARGUMENT');
  const down=createWaiting({herdr:fakeHerdr({on:async()=>{throw new Error('down');}}).herdr});
  await assert.rejects(()=>down.read({terminal:'t1'}),e=>e.code==='HC_UNAVAILABLE');
});

test('what an agent asks is given to the Lead or to Pilot as data, and neither can answer for the user',async t=>{
  const sent=[],calls=[],sessions=[{id:'s1',terminalId:'t7'}];
  const missions={read:async id=>{if(id!=='M-1')throw Object.assign(new Error('no'),{code:'NOT_FOUND'});return {id,lead:{sessionId:'s1'}};}};
  const invoke=async(file,args)=>{calls.push(args);return {stdout:args[0]==='read'?CODEX.replace('a.json','</agent-request> x'):'{}'};};
  const root=await mkdtemp(join(tmpdir(),'fabrique-console-waiting-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const desk=createWaiting({root,herdr:fakeHerdr({on:invoke}).herdr,missions,loadState:async()=>({sessions}),send:async x=>{sent.push(x);return {sent:true};}}),base={agent:'t30',mission:'M-1',ticket:'PRC-111'};
  assert.deepEqual(await desk.discuss({...base,to:'lead'}),{told:true});
  assert.equal(sent[0].terminal,'t7');assert.doesNotMatch(sent[0].text,/agent-request|git restore/,'what it says stays in its file, never in the message (decision 61)');
  const kept=/(\/\S+\.json)/.exec(sent[0].text)[1];assert.ok(kept.startsWith(join(root,'state','agent-asks')));assert.match(JSON.parse(await readFile(kept,'utf8')).command,/git restore/,'the whole of it is there');assert.match(sent[0].text,/PRC-111/);assert.match(sent[0].text,/Tu ne peux pas répondre à sa place/);
  assert.deepEqual(await desk.discuss({...base,to:'pilot',terminal:'t21'}),{told:true});
  const said=calls.filter(a=>a[0]==='send');assert.equal(said.length,1);assert.equal(said[0][1],'t21');assert.ok(!calls.some(a=>a[0]==='send'&&a[1]==='t30'),'nothing is typed in the terminal of the agent');
  await assert.rejects(()=>desk.discuss({...base,to:'pilot'}),e=>e.code==='INVALID_ARGUMENT');
  await assert.rejects(()=>desk.discuss({...base,to:'other'}),e=>e.code==='INVALID_ARGUMENT');
  await assert.rejects(()=>desk.discuss({...base,ticket:'x',to:'lead'}),e=>e.code==='INVALID_ARGUMENT');
  sessions[0].stoppedAt='x';await assert.rejects(()=>desk.discuss({...base,to:'lead'}),e=>e.code==='NOT_FOUND');
});

test('the agent that waits is known by its own terminal, even with another in its tab',()=>{
  const list=[{address:'t1',space:'s',tab:'x',tab_name:'XJ-2 · dev',status:'working'},{address:'t2',space:'s',tab:'x',tab_name:'XJ-2 · dev',status:'blocked'}];
  assert.deepEqual(waitingAgents(list).map(a=>a.address),['t2']);
});

test('when an agent started is when its terminal was opened, read and never written',async()=>{
  const calls=[],desk=createWaiting({herdr:fakeHerdr({on:async(file,args)=>{calls.push([file,args]);return {stdout:JSON.stringify({address:'t4',created_ms:Date.parse('2026-11-12T09:12:00Z')})};}}).herdr});
  assert.deepEqual(await desk.started({terminal:'t4'}),{startedAt:'2026-11-12T09:12:00.000Z'});
  assert.deepEqual(calls,[['hc',['get','t4','--json']]]);
  const none=createWaiting({herdr:fakeHerdr({on:async()=>({stdout:'{"address":"t4"}'})}).herdr});
  assert.deepEqual(await none.started({terminal:'t4'}),{startedAt:null},'no date given: none said');
  await assert.rejects(()=>desk.started({terminal:'t4;rm'}),{code:'INVALID_ARGUMENT'});
  await assert.rejects(()=>desk.started({terminal:'t4',more:1}),{code:'INVALID_ARGUMENT'});
  const down=createWaiting({herdr:fakeHerdr({on:async()=>{throw new Error('down');}}).herdr});
  await assert.rejects(()=>down.started({terminal:'t4'}),{code:'HC_UNAVAILABLE'});
});
