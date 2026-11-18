import test from 'node:test';
import assert from 'node:assert/strict';
import { setup, FG2 } from './helpers/dev-chain-setup.mjs';
import { createMissionRegistry } from '../src/mission.mjs';
import { pageBand } from '../mods/fabrique-console-v4-ticket/page.js';

// ---- M11, second review. A Validation made just before a pause leaves no pause without « Resume »; Herdr unreadable
// keeps « Pausing » with a cause and an alert; the pause is said in the journal, once each, at its instant.
const M={sessionId:'s1'},ONE={mission:'M-1'};
const stateOf=async t=>(await t.chain.read(ONE)).pause;
const journal=async t=>(await t.chain.read(ONE)).log;
const hm=ms=>{const d=new Date(ms);return String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0');};
// The lane says when a caller waits for its lock: the click stands behind the operation under way, no fixed delay.
function laneWaits(){
  const box={};box.waiting=new Promise(r=>{box.hit=r;});
  box.wait=()=>{box.hit();return new Promise(r=>setTimeout(r,5));};
  return box;
}

test('Validation takes the lock just before Pause: the pause is read again under the lock and refused, nothing written (M11 review 2)',async()=>{
  const lw=laneWaits(),t=await setup({wait:lw.wait}),missions=createMissionRegistry({root:t.root});
  try{
    await t.chain.launch({...M,tickets:[FG2]});
    // The Validation of the Lead, held under the lock of the lane (as lead-request validation runs it).
    let release,inside;const gate=new Promise(r=>{release=r;}),entered=new Promise(r=>{inside=r;});
    const validation=t.chain.unpaused('M-1',async()=>{inside();await gate;await missions.setStep('M-1','validating','validation demandée');});
    await entered;
    const click=t.chain.pause(ONE).then(r=>({r}),error=>({error}));
    await lw.waiting;release();await validation;
    const out=await click;
    assert.equal(out.error?.code,'PAUSE_NOT_DEVELOP','refused once the mission left Develop');
    assert.equal((await stateOf(t)).state,'none','no pause left without « Resume »');
    assert.ok(!(await journal(t)).some(l=>/Pause/.test(l.text)),'nothing said');
    assert.equal((await missions.read('M-1')).step,'validating');
  }finally{await t.cleanup();}
});

test('Herdr unreadable while « Pausing »: a cause dated from the click, an alert after 5 min, never a resume on its own (M11 review 2)',async()=>{
  let clock=Date.parse('2026-11-09T10:01:00.000Z'),broken=false;const box={t:null};
  const invoke=async(file,args,options)=>{
    if(broken&&((file==='herdr-app'&&args[0]==='ls')||(file==='hc'&&args[0]==='get')))throw Object.assign(new Error('herdr down'),{code:1,stdout:'',stderr:''});
    return box.t.core.invoke(file,args,options);
  };
  const t=await setup({invoke,now:()=>clock});box.t=t;
  try{
    await t.chain.launch({...M,tickets:[FG2]});
    const asked=(await t.chain.pause(ONE)).pause.at;
    broken=true;clock+=60000;
    await t.chain.tick(M).catch(()=>{});
    let p=await stateOf(t);
    assert.equal(p.state,'requested');
    assert.ok((p.waiting||[]).some(w=>w.why==='unreadable'&&w.since===asked),'the cause, dated from the click');
    assert.ok(!p.alert,'no alert yet');
    clock+=5*60000;
    await t.chain.tick(M).catch(()=>{});
    p=await stateOf(t);
    assert.equal(p.state,'requested','never paused nor resumed on a delay');
    assert.equal(p.alert,true,'five minutes since the click: an alert');
    const band=pageBand({mission:{step:'building',tickets:[{id:'XJ-2',state:'dev',rounds:0}]},pause:p});
    assert.match(band.det,/status unavailable/);
    assert.equal(band.tone,'stop');
    assert.equal(band.button.key,'resume');
    // Herdr read again, the dev at the end of its turn: effective, not resumed.
    broken=false;t.tab('XJ-2 · dev').status='idle';
    await t.chain.tick(M);
    p=await stateOf(t);
    assert.equal(p.state,'paused');
    assert.equal(p.waiting,undefined);
  }finally{await t.cleanup();}
});

test('the banner of « Pausing » says the state of the agents cannot be read (M11 review 2)',()=>{
  const band=pageBand({mission:{step:'building',tickets:[{id:'XJ-2',state:'dev',rounds:0}]},pause:{state:'requested',at:'2026-11-09T10:00:00.000Z',waiting:[{role:'agents',ticket:null,why:'unreadable',since:'2026-11-09T10:00:00.000Z'}]}});
  assert.match(band.det,/status unavailable/);
  assert.equal(band.button.key,'resume');
});

test('« Pause requested », « Paused » and « Resumed » are said in the journal once each, at their instants, kept after Resume (M11 review 2)',async()=>{
  let clock=Date.parse('2026-11-09T10:01:00.000Z');
  const t=await setup({now:()=>clock});
  try{
    await t.chain.launch({...M,tickets:[FG2]});
    const asked=clock;await t.chain.pause(ONE);
    clock+=60000;await t.chain.pause(ONE);
    clock+=60000;t.tab('XJ-2 · dev').status='idle';const done=clock;await t.chain.tick(M);await t.chain.tick(M);
    assert.equal((await stateOf(t)).state,'paused');
    clock+=60000;const back=clock;await t.chain.resume(ONE);await t.chain.resume(ONE);
    const lines=(await journal(t)).filter(l=>['Pause requested','Paused','Resumed'].includes(l.text));
    assert.deepEqual(lines.map(l=>[l.text,l.at]),[['Pause requested',hm(asked)],['Paused',hm(done)],['Resumed',hm(back)]]);
  }finally{await t.cleanup();}
});
