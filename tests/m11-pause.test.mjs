import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setup, news, devRuns, FG2 } from './helpers/dev-chain-setup.mjs';
import { createMissionRegistry } from '../src/mission.mjs';

// ---- M11, « Pause et reprise » (decisions 32 and 43; simulation/CONTRAT.md § 2 quater). Asked during a dev, the pause
// lets it finish its turn; nothing starts after it, not even a reviewer; it holds after the tool starts again; Resume
// takes up where it stopped, without a second agent. Panne: a dev cut while pausing leaves the mission paused, and
// nothing is launched again before Resume.
const M={sessionId:'s1'},ONE={mission:'M-1'};
const A='a'.repeat(40),C='c'.repeat(40);
const DEV_A={ticket:'XJ-2',kind:'dev',commit:A,repo:'admin',summary:'fait',at:'2026-11-09T10:00:00.000Z'};
const alive=t=>t.core.live().filter(x=>x.labels['fabrique-console.mission']==='M-1');
const stateOf=async t=>(await t.chain.read(ONE)).pause;
const reviews=t=>news(t.calls).filter(x=>/ · revue/.test(x)).length;

test('a pause asked during a dev lets it finish; nothing starts after it, not even a reviewer (M11)',async()=>{
  const t=await setup();
  try{
    assert.deepEqual(await stateOf(t),{state:'none'},'the engine says it has the pause');
    await t.chain.launch({...M,tickets:[FG2]});await t.chain.tick(M);
    const asked=await t.chain.pause(ONE);
    assert.equal(asked.pause.state,'requested');
    // The dev is at work: it is neither stopped nor told anything; the pause waits for the end of its turn.
    await t.chain.tick(M);
    assert.equal((await stateOf(t)).state,'requested');
    assert.equal(alive(t).length,1,'the dev keeps working');
    assert.deepEqual(t.sent.filter(x=>x.terminal!=='t1'),[],'nothing is sent to the dev');
    // It reports and ends its turn: no reviewer, the mission is paused.
    t.reports.push({...DEV_A});t.tab('XJ-2 · dev').status='idle';
    await t.chain.tick(M);await t.chain.tick(M);
    assert.equal(reviews(t),0,'no reviewer starts in pause');
    assert.equal((await stateOf(t)).state,'paused');
    assert.equal(alive(t).length,1,'the dev of the ticket is not stopped by the pause');
    // Asked twice, it changes nothing; the Lead asking for a dev is refused, nothing launched.
    assert.equal((await t.chain.pause(ONE)).pause.state,'paused');
    await assert.rejects(()=>t.chain.launch({mission:'M-1',fresh:false,tickets:[{...FG2,identifier:'XJ-3'}]}),e=>e.code==='MISSION_PAUSED');
    assert.equal(devRuns(t.calls,'XJ-3'),0);
    const p=(await t.chain.read(ONE)).pause;
    assert.ok(Date.parse(p.at)<=Date.parse(p.pausedAt),'the instants it was asked and became effective');
  }finally{await t.cleanup();}
});

test('the pause holds after the tool starts again; Resume takes up where it stopped, with no second agent (M11)',async()=>{
  const t=await setup();
  try{
    await t.chain.launch({...M,tickets:[FG2]});await t.chain.tick(M);
    await t.chain.pause(ONE);
    t.reports.push({...DEV_A});t.tab('XJ-2 · dev').status='idle';
    await t.chain.tick(M);
    // The tool starts again: another watcher on the same root, twice.
    const again=t.make();await again.tick(M);await again.tick(M);
    assert.equal((await again.read(ONE)).pause.state,'paused');
    assert.equal(reviews(t),0,'still no reviewer');
    // Resume: the review that waited starts, once; the dev is the same one.
    assert.deepEqual((await again.resume(ONE)).pause,{state:'none'});
    await again.tick(M);await again.tick(M);await t.chain.tick(M);
    assert.deepEqual(news(t.calls),['XJ-2 · dev','XJ-2 · revue'],'the review it held, once, and no second dev');
    assert.equal(devRuns(t.calls,'XJ-2'),1);
    // Resumed twice: nothing more.
    assert.deepEqual((await again.resume(ONE)).pause,{state:'none'});
    await again.tick(M);
    assert.deepEqual(news(t.calls),['XJ-2 · dev','XJ-2 · revue']);
  }finally{await t.cleanup();}
});

test('in pause the corrections wait: sent once after Resume (M11)',async()=>{
  const t=await setup();
  try{
    await t.chain.launch({...M,tickets:[FG2]});
    t.reports.push({...DEV_A});await t.chain.tick(M);
    assert.equal(reviews(t),1);
    await t.chain.pause(ONE);
    t.reports.push({ticket:'XJ-2',kind:'review-1',commit:A,verdict:'changes_requested',summary:'bug X',at:'2026-11-09T10:05:00.000Z'});
    t.tab('XJ-2 · revue').status='idle';t.tab('XJ-2 · dev').status='idle';
    await t.chain.tick(M);await t.chain.tick(M);
    const fixes=()=>t.sent.filter(x=>/XJ-2\.review-1\.json/.test(x.text)).length;
    assert.equal(fixes(),0,'the corrections are not sent in pause');
    assert.equal((await stateOf(t)).state,'paused');
    await t.chain.resume(ONE);await t.chain.tick(M);await t.chain.tick(M);
    assert.equal(fixes(),1,'sent once after Resume');
  }finally{await t.cleanup();}
});

test('in pause a dev that ended its turn without its report is not asked for it; it is, once, after Resume (M11)',async()=>{
  const t=await setup();
  try{
    await t.chain.launch({...M,tickets:[FG2]});
    await t.chain.pause(ONE);
    t.tab('XJ-2 · dev').status='idle';
    await t.chain.tick(M);await t.chain.tick(M);
    const asks=()=>t.sent.filter(x=>/rends compte maintenant/.test(x.text)).length;
    assert.equal(asks(),0);assert.equal((await stateOf(t)).state,'paused');
    await t.chain.resume(ONE);await t.chain.tick(M);await t.chain.tick(M);
    assert.equal(asks(),1);
  }finally{await t.cleanup();}
});

test('the last review accepted in pause: no QA agent, no Validation, no next dev until Resume (M11)',async()=>{
  const t=await setup();
  try{
    await t.chain.launch({...M,tickets:[FG2]});
    t.reports.push({...DEV_A});await t.chain.tick(M);
    await t.chain.pause(ONE);
    t.reports.push({ticket:'XJ-2',kind:'review-1',commit:A,verdict:'accepted',summary:'ok',at:'2026-11-09T10:05:00.000Z'});
    for(const a of t.agents)if(a.tab_name.startsWith('XJ-2'))a.status='idle';
    await t.chain.tick(M);await t.chain.tick(M);
    assert.equal(devRuns(t.calls,'XJ-3'),0,'XJ-3 waits for Resume');
    assert.equal((await t.chain.read(ONE)).log.filter(l=>/XJ-3/.test(l.text)).length,0,'never said launched while it waits');
    assert.equal((await stateOf(t)).state,'paused');
    await t.chain.resume(ONE);await t.chain.tick(M);
    assert.equal(devRuns(t.calls,'XJ-3'),1,'XJ-3 starts once after Resume');
    // XJ-3 done and accepted in pause: the QA agent and the Validation wait too.
    t.reports.push({ticket:'XJ-3',kind:'dev',commit:C,repo:'admin',summary:'fait',at:'2026-11-09T11:00:00.000Z'});
    await t.chain.tick(M);
    await t.chain.pause(ONE);
    t.reports.push({ticket:'XJ-3',kind:'review-1',commit:C,verdict:'accepted',summary:'ok',at:'2026-11-09T11:05:00.000Z'});
    for(const a of t.agents)if(a.tab_name.startsWith('XJ-3'))a.status='idle';
    await t.chain.tick(M);await t.chain.tick(M);
    assert.equal(news(t.calls).filter(x=>x==='QA · XJ-1').length,0,'no QA agent in pause');
    assert.deepEqual(t.steps,[],'no Validation in pause');
    await t.chain.resume(ONE);await t.chain.tick(M);await t.chain.tick(M);
    assert.equal(news(t.calls).filter(x=>x==='QA · XJ-1').length,1);
    assert.deepEqual(t.steps,[{sessionId:'s1',step:'check'}]);
  }finally{await t.cleanup();}
});

test('panne: a dev cut while pausing leaves the mission paused; nothing is launched again before Resume (M11)',async()=>{
  const t=await setup();
  try{
    await t.chain.launch({...M,tickets:[FG2]});await t.chain.tick(M);
    await t.chain.pause(ONE);
    t.core.end(alive(t)[0]);
    await t.chain.tick(M);
    assert.equal((await stateOf(t)).state,'paused','its terminal gone, nothing runs');
    const again=t.make();await again.tick(M);await again.tick(M);await t.chain.tick(M);
    assert.equal(devRuns(t.calls,'XJ-2'),1,'not launched again');
    assert.equal(reviews(t),0);
    await assert.rejects(()=>t.chain.launch({mission:'M-1',fresh:false,resume:true,tickets:[FG2]}),e=>e.code==='MISSION_PAUSED','nor by the Lead');
    assert.equal(devRuns(t.calls,'XJ-2'),1);
    // M15: after Resume, the watcher takes up a dev proven stopped. The Lead cannot duplicate it.
    await t.chain.resume(ONE);await t.chain.tick(M);
    assert.equal(devRuns(t.calls,'XJ-2'),2,'one automatic resume after the pause is lifted');
    assert.deepEqual((await t.chain.launch({mission:'M-1',fresh:false,resume:true,tickets:[FG2]})).launched,[{identifier:'XJ-2',launched:false,reason:'already'}]);
    assert.equal(devRuns(t.calls,'XJ-2'),2);
  }finally{await t.cleanup();}
});

test('an agent whose state is not known keeps the pause asked: « Paused » is said only when nothing runs (M11)',async()=>{
  const t=await setup();
  try{
    await t.chain.launch({...M,tickets:[FG2]});
    t.reports.push({...DEV_A});await t.chain.tick(M);
    await t.chain.pause(ONE);
    t.tab('XJ-2 · dev').status='idle';t.tab('XJ-2 · revue').status='unknown';
    await t.chain.tick(M);
    assert.equal((await stateOf(t)).state,'requested','a reviewer of unknown state may still be at work');
    t.tab('XJ-2 · revue').status='done';
    await t.chain.tick(M);
    assert.equal((await stateOf(t)).state,'paused');
  }finally{await t.cleanup();}
});

test('the pause is checked: a mission that is over, an unknown mission, a pause the file does not say rightly (M11)',async()=>{
  const t=await setup();
  try{
    await assert.rejects(()=>t.chain.pause({mission:'M-9'}),e=>e.code==='NOT_FOUND');
    await assert.rejects(()=>t.chain.pause({mission:'M-1',more:1}),e=>e.code==='INVALID_ARGUMENT');
    await t.chain.launch({...M,tickets:[FG2]});
    // A pause the file says wrongly is never taken for no pause: nothing is decided on it.
    const file=join(t.root,'state','devchain-M-1.json'),raw=JSON.parse(await readFile(file,'utf8'));
    await writeFile(file,JSON.stringify({...raw,pause:{state:'later'}}));
    await assert.rejects(()=>t.chain.tick(M),e=>e.code==='INVALID_DATA');
    await writeFile(file,JSON.stringify(raw));
    await createMissionRegistry({root:t.root}).setStep('M-1','closed','fin');
    await assert.rejects(()=>t.chain.pause(ONE),e=>e.code==='MISSION_OVER');
  }finally{await t.cleanup();}
});

// ---- Through the backend, as the page asks (mods/fabrique-console-v4-ticket/main.js: mission-pause, mission-resume, then
// mission-read): the pause is said by mission-read; the two commands are clicks of the screen, refused from an agent.
import { mkdtemp, readdir, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createBackend, SCREEN_COMMANDS } from '../src/backend.mjs';
import { AGENT_MARK } from '../ui/v3/view.js';
import { withFakeHerdr } from './helpers/fake-herdr.mjs';
const backendOf=async(t,env={})=>{
  const root=await realpath(await mkdtemp(join(tmpdir(),'fabrique-console-pause-')));t.after(()=>rm(root,{recursive:true,force:true}));
  return {root,backend:createBackend(withFakeHerdr({root,env:{...process.env,FABRIQUE_CONSOLE_AGENT:'',...env},exec:async()=>{throw new Error('nothing runs');}}))};
};
test('mission-read says the pause; mission-pause and mission-resume write it for good (M11)',async t=>{
  const {root,backend}=await backendOf(t);
  const registry=createMissionRegistry({root});
  await registry.create({project:'alpha',issue:{id:'i1',identifier:'XJ-1',title:'Paiement',url:'u'},request:'Payer'});
  assert.deepEqual((await backend.dispatch('mission-read',{mission:'M-1'})).pause,{state:'none'});
  // Offered in Develop only (decision 106 point 7, M11 review 2): out of it, refused and nothing written.
  await assert.rejects(()=>backend.dispatch('mission-pause',{mission:'M-1'}),e=>e.code==='PAUSE_NOT_DEVELOP');
  assert.deepEqual((await backend.dispatch('mission-read',{mission:'M-1'})).pause,{state:'none'});
  await registry.setStep('M-1','building','devs');
  assert.equal((await backend.dispatch('mission-pause',{mission:'M-1'})).pause.state,'requested');
  const again=createBackend(withFakeHerdr({root,env:{...process.env,FABRIQUE_CONSOLE_AGENT:''},exec:async()=>{throw new Error('nothing runs');}}));
  assert.equal((await again.dispatch('mission-read',{mission:'M-1'})).pause.state,'requested','after the tool starts again');
  assert.deepEqual((await again.dispatch('mission-resume',{mission:'M-1'})).pause,{state:'none'});
  assert.deepEqual((await backend.dispatch('mission-read',{mission:'M-1'})).pause,{state:'none'});
});
test('mission-pause and mission-resume are commands of the screens: refused from a session of an agent, writing nothing (M11)',async t=>{
  assert.ok(['mission-pause','mission-resume'].every(c=>SCREEN_COMMANDS.includes(c)));
  const {root,backend}=await backendOf(t,{[AGENT_MARK]:'1'});
  for(const c of ['mission-pause','mission-resume'])await assert.rejects(()=>backend.dispatch(c,{mission:'M-1'}),e=>e.code==='AGENT_SESSION'&&e.message.includes('réservée au propriétaire'));
  assert.deepEqual(await readdir(root),[]);
});
