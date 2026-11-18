import test from 'node:test';
import assert from 'node:assert/strict';
import { setup, FG2 } from './helpers/dev-chain-setup.mjs';
import { createRequestRegistry } from '../src/requests.mjs';
import { createQuestionRegistry } from '../src/questions.mjs';
import { createMissionRegistry } from '../src/mission.mjs';

const A='a'.repeat(40),at=s=>Date.parse('2026-11-09T'+s+':00.000Z');
const BLOCK={ticket:'XJ-2',kind:'block',name:'XJ-2.block-1762682520000.json',at:'2026-11-09T10:02:00.000Z',reason:'La migration 0026 ne passe pas sur la base locale.',migration:'0026'};
// The register of the requests as the chain makes it, whose `mark` can be cut once: the process stops right there.
const cutInbox=(root,now)=>{
  const real=createRequestRegistry({root,now,notify:async()=>{},questions:createQuestionRegistry({root,now}),missions:createMissionRegistry({root,now})});
  const state={cut:false};
  const cut=fn=>async(...args)=>{if(state.cut){state.cut=false;throw Object.assign(new Error('process stopped'),{code:'CUT'});}return fn(...args);};
  return {state,inbox:{...real,mark:cut(real.mark),liftStop:cut(real.liftStop)}};
};

// ---- M10 review, P2: a stop between the reservation of the lift (stopover|…, seenover|…) and the lift itself never
// keeps the ticket stopped: the watcher started again lifts it.
test('a watcher stopped while it lifts a stop leaves it lifted at the next start: the dev delivered (M10 review)',async()=>{
  let clock=at('10:03');
  const t=await setup({now:()=>clock});
  try{
    const inbox=createRequestRegistry({root:t.root,now:()=>clock});
    const stops=async()=>(await inbox.list({mission:'M-1'})).filter(i=>i.type==='stuck'&&i.cause==='blocked'&&i.state!=='resolved');
    await t.chain.launch({sessionId:'s1',tickets:[FG2]});
    t.reports.push({...BLOCK});
    await t.chain.tick({sessionId:'s1'});
    assert.equal((await stops()).length,1);
    clock+=60000;t.reports.push({ticket:'XJ-2',kind:'dev',commit:A,repo:'admin',summary:'fait',at:new Date(clock).toISOString()});
    const cut=cutInbox(t.root,()=>clock);cut.state.cut=true;
    await assert.rejects(()=>t.make({now:()=>clock,inbox:cut.inbox}).tick({sessionId:'s1'}),e=>e.code==='CUT');
    clock+=60000;const again=t.make({now:()=>clock});await again.tick({sessionId:'s1'});await again.tick({sessionId:'s1'});
    assert.deepEqual(await stops(),[],'lifted by the watcher started again');
    assert.equal((await again.read({sessionId:'s1'})).log.filter(l=>/XJ-2 running again/.test(l.text)).length,1,'said once');
  }finally{await t.cleanup();}
});

test('a watcher stopped while it lifts the stop of a reviewer that never showed leaves it lifted at the next start: its verdict came (M10 review)',async()=>{
  let clock=at('10:00');
  const t=await setup({now:()=>clock});
  try{
    const inbox=createRequestRegistry({root:t.root,now:()=>clock});
    const stops=async()=>(await inbox.list({mission:'M-1'})).filter(i=>i.type==='stuck'&&i.cause==='reviewer'&&i.state!=='resolved');
    await t.chain.launch({sessionId:'s1',tickets:[FG2]});
    t.reports.push({ticket:'XJ-2',kind:'dev',commit:A,repo:'admin',summary:'fait',at:'2026-11-09T10:00:00.000Z'});
    await t.chain.tick({sessionId:'s1'});
    t.core.faults.hidden=a=>a.tab_name==='XJ-2 · revue';
    clock+=6*60000;await t.chain.tick({sessionId:'s1'});
    assert.equal((await stops()).length,1,'said in the Inbox');
    t.reports.push({ticket:'XJ-2',kind:'review-1',commit:A,verdict:'accepted',summary:'ok',at:new Date(clock).toISOString()});
    const cut=cutInbox(t.root,()=>clock);cut.state.cut=true;
    await assert.rejects(()=>t.make({now:()=>clock,inbox:cut.inbox}).tick({sessionId:'s1'}),e=>e.code==='CUT');
    clock+=60000;await t.make({now:()=>clock}).tick({sessionId:'s1'});
    assert.deepEqual(await stops(),[],'lifted by the watcher started again');
  }finally{await t.cleanup();}
});

// ---- M10 review, P2: lead-block acts on the stop as it is now, in one step under the lock of the register. Its tries
// written on a stop that was replaced or lifted meanwhile are refused (STOP_CHANGED), never written on the old one nor
// opening the stop again; lifted lifts the stop of now and says which.
import { desk } from './helpers/requests.mjs';
const STOP={type:'stuck',cause:'blocked',mission:'M-1',project:'alpha',issue:'XJ-1',ticket:'XJ-2',question:null,title:'Migration 0026 fails locally',text:'La migration 0026 ne passe pas.',blocked:['XJ-2'],proofs:[],since:'2026-11-13T08:52:00.000Z',owner:'lead',forUser:false,migration:'0026'};
const TRY=[{text:'Le Lead fait dédoublonner les rangs',outcome:'running'}];
// The register as lead-block reads it, with something done right after its reading: another write, the watcher.
const between=(f,then)=>{const list=f.inbox.list;let done=false;f.inbox.list=async(...args)=>{const out=await list(...args);if(!done){done=true;await then();}return out;};};

test('lead-block refuses tries written on a stop replaced meanwhile, and leaves the stop of now as it is (M10 review)',async t=>{
  const f=await desk(t);
  await f.inbox.ask(STOP);
  let now=null;between(f,async()=>{now=(await f.inbox.ask({...STOP,tries:[{text:'Dev 1 a relancé',outcome:'same'}]})).item;});
  await assert.rejects(()=>f.actions.block({mission:'M-1',ticket:'XJ-2',tries:TRY}),e=>e.code==='STOP_CHANGED');
  const shown=(await f.shown()).filter(i=>i.type==='stuck');
  assert.deepEqual(shown.map(i=>[i.id,i.tries?.[0]?.text]),[[now.id,'Dev 1 a relancé']],'the stop of now, untouched');
});

test('lead-block never opens again a stop the watcher lifted right after it was read (M10 review)',async t=>{
  const f=await desk(t);
  const {item}=await f.inbox.ask(STOP);
  between(f,()=>f.inbox.mark(item.id,{state:'resolved'}));
  await assert.rejects(()=>f.actions.block({mission:'M-1',ticket:'XJ-2',tries:TRY}),e=>['STOP_CHANGED','NOT_FOUND'].includes(e.code));
  assert.deepEqual((await f.shown()).filter(i=>i.type==='stuck'),[],'still lifted');
});

test('lead-block lifted lifts the stop of now, whatever was read before, and says which (M10 review)',async t=>{
  const f=await desk(t);
  await f.inbox.ask(STOP);
  // Written again by another command just before: lifted takes the stop of now, not the one of before.
  const now=(await f.inbox.ask({...STOP,tries:TRY})).item;
  const out=await f.actions.block({mission:'M-1',ticket:'XJ-2',lifted:true});
  assert.equal(out.lifted,true);assert.equal(out.item,now.id);
  assert.deepEqual((await f.shown()).filter(i=>i.type==='stuck'),[]);
  await assert.rejects(()=>f.actions.block({mission:'M-1',ticket:'XJ-2',lifted:true}),e=>e.code==='NOT_FOUND','nothing left to lift');
});

// ---- M10 review: lead-block is the Lead's. The same barrier as decisions 70 and 76: the tool marks the role of the
// agents it starts (FABRIQUE_CONSOLE_ROLE beside FABRIQUE_CONSOLE_AGENT); a session of an agent that is not the Lead is refused (LEAD_ONLY)
// before anything is read or written. Its limit is the one of decision 76, written in the reference.
import { mkdtemp, readdir, rm, realpath, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createBackend } from '../src/backend.mjs';
import { hcRunArgs } from '../src/agents.mjs';
import { AGENT_MARK, ROLE_MARK, devArgv } from '../ui/v3/view.js';
import { withFakeHerdr } from './helpers/fake-herdr.mjs';
const backendIn=async(t,env)=>{const root=await realpath(await mkdtemp(join(tmpdir(),'fabrique-console-lead-only-')));t.after(()=>rm(root,{recursive:true,force:true}));return {root,backend:createBackend(withFakeHerdr({root,env,exec:async()=>{throw new Error('nothing runs');}}))};};
const plainEnv=()=>Object.fromEntries(Object.entries(process.env).filter(([k])=>k!==AGENT_MARK&&k!==ROLE_MARK));

test('lead-block from a session of an agent that is not the Lead is refused before anything is read or written (M10 review)',async t=>{
  for(const env of [{[AGENT_MARK]:'1'},{[AGENT_MARK]:'1',[ROLE_MARK]:'dev'},{[AGENT_MARK]:'1',[ROLE_MARK]:'agent'}]){
    const {root,backend}=await backendIn(t,{...plainEnv(),...env});
    await assert.rejects(()=>backend.dispatch('lead-block',{mission:'M-1',ticket:'XJ-2',lifted:true}),e=>e.code==='LEAD_ONLY',JSON.stringify(env));
    assert.deepEqual(await readdir(root),[],'nothing is written');
  }
  for(const env of [{[AGENT_MARK]:'1',[ROLE_MARK]:'lead'},{}]){
    const {backend}=await backendIn(t,{...plainEnv(),...env});
    await assert.rejects(()=>backend.dispatch('lead-block',{mission:'M-1',ticket:'XJ-2',lifted:true}),e=>e.code!=='LEAD_ONLY','the Lead, or the user by hand, reaches the handler');
  }
});

test('the Lead the tool starts carries its role mark; a dev, a reviewer and the other agents carry none (M10 review)',async()=>{
  const roleOf=argv=>{
    if(argv[0]==='claude'){const at=argv.indexOf('--settings');return at>0?JSON.parse(argv[at+1]).env?.[ROLE_MARK]??null:null;}
    const set=argv.find((a,n)=>argv[n-1]==='-c'&&a.startsWith(`shell_environment_policy.set.${ROLE_MARK}=`));return set?JSON.parse(set.split('=')[1]):null;
  };
  const program=args=>args.slice(args.indexOf('--')+1);
  for(const tool of ['claude','codex']){
    assert.equal(roleOf(program(hcRunArgs({tool,prompt:'p',cwd:'/x',role:'lead'}))),'lead',tool);
    assert.equal(roleOf(program(hcRunArgs({tool,prompt:'p',cwd:'/x'}))),null,tool+': no role, no mark');
    assert.equal(roleOf(devArgv(tool,'m','high','tâche')),null,tool+': a dev carries no role of the Lead');
  }
});

test('the reference writes the limit of the barrier of lead-block as decision 76 does (M10 review)',async()=>{
  const doc=JSON.parse(await readFile(new URL('../docs/backend-interface.json',import.meta.url),'utf8'));
  const block=doc.actions['lead-block'];
  assert.ok(block.codes.includes('LEAD_ONLY')&&block.codes.includes('STOP_CHANGED'));
  assert.match(block.confirmation,/FABRIQUE_CONSOLE_ROLE/);assert.match(block.confirmation,/env -u/,'the limit, as it is');
  assert.ok(doc.codes.LEAD_ONLY&&doc.codes.STOP_CHANGED);
});

// ---- M10 review, P2: a dev stopped on its ticket is left to the Lead. Its turn over without a report never makes the
// watcher ask it to finish and commit while the stop is open.
test('a dev stopped on its ticket is never asked for its report while its stop is open (M10 review)',async()=>{
  let clock=at('10:03');
  const t=await setup({now:()=>clock});
  try{
    await t.chain.launch({sessionId:'s1',tickets:[FG2]});
    t.reports.push({...BLOCK});
    t.tab('XJ-2 · dev').status='idle';
    await t.chain.tick({sessionId:'s1'});clock+=60000;await t.chain.tick({sessionId:'s1'});
    assert.equal(t.sent.filter(x=>/rends compte maintenant/.test(x.text)).length,0,'not told to finish and commit');
  }finally{await t.cleanup();}
});

// ---- M10 review, P2: « the Lead is on it » and « Lead called » are said only once the Lead was told for sure. Lead
// absent: the stop waits without them and the request goes when it comes back; a send refused is made again at the next
// pass; a send not sure is never made again and keeps the stop without them.
const leadStops=async(root,clock)=>(await createRequestRegistry({root,now:()=>clock}).list({mission:'M-1'})).filter(i=>i.type==='stuck'&&i.cause==='blocked'&&i.state!=='resolved');
const toLead=t=>t.sent.filter(x=>x.terminal==='t1'&&/lead-block/.test(x.text));
const called=async(c)=>(await c.read({sessionId:'s1'})).log.filter(l=>l.text==='XJ-2 stopped, Lead called').length;

test('a stop found with the Lead absent waits without « the Lead is on it »; the Lead told once back, then on it (M10 review)',async()=>{
  let clock=at('10:03');
  const t=await setup({now:()=>clock});
  try{
    await t.chain.launch({sessionId:'s1',tickets:[FG2]});
    const po=t.agents.splice(t.agents.findIndex(a=>a.address==='t1'),1)[0];
    t.reports.push({...BLOCK});
    await t.chain.tick({sessionId:'s1'});
    let [stop,...more]=await leadStops(t.root,clock);
    assert.deepEqual(more,[]);
    assert.deepEqual([stop.owner,stop.forUser,stop.since],[undefined,undefined,BLOCK.at],'nobody said on it');
    assert.equal(await called(t.chain),0,'« Lead called » not said');
    clock+=60000;t.agents.push(po);
    await t.chain.tick({sessionId:'s1'});await t.chain.tick({sessionId:'s1'});
    [stop,...more]=await leadStops(t.root,clock);
    assert.deepEqual(more,[]);
    assert.deepEqual([stop.owner,stop.forUser,stop.since],['lead',false,BLOCK.at],'on it once told, from the instant of the stop');
    assert.equal(toLead(t).length,1);assert.equal(await called(t.chain),1);
  }finally{await t.cleanup();}
});

test('a send to the Lead refused leaves the stop without « the Lead is on it » and is made again at the next pass (M10 review)',async()=>{
  let clock=at('10:03');
  const t=await setup({now:()=>clock});
  try{
    await t.chain.launch({sessionId:'s1',tickets:[FG2]});
    let refuse=true;
    const c=t.make({now:()=>clock,send:async x=>{if(refuse&&x.terminal==='t1'&&/lead-block/.test(x.text))throw Object.assign(new Error('not sent'),{code:'SEND_FAILED'});t.sent.push(x);return {sent:true};}});
    t.reports.push({...BLOCK});
    await c.tick({sessionId:'s1'});
    let [stop]=await leadStops(t.root,clock);
    assert.deepEqual([stop.owner,stop.forUser],[undefined,undefined]);
    assert.equal(await called(c),0);
    refuse=false;clock+=60000;await c.tick({sessionId:'s1'});
    [stop]=await leadStops(t.root,clock);
    assert.deepEqual([stop.owner,stop.forUser],['lead',false]);
    assert.equal(toLead(t).length,1);assert.equal(await called(c),1);
  }finally{await t.cleanup();}
});

test('a send to the Lead not sure is never made again and never says « the Lead is on it » (M10 review)',async()=>{
  let clock=at('10:03');
  const t=await setup({now:()=>clock});
  try{
    await t.chain.launch({sessionId:'s1',tickets:[FG2]});
    let tries=0;
    const c=t.make({now:()=>clock,send:async x=>{if(x.terminal==='t1'&&/lead-block/.test(x.text)){tries++;throw new Error('timed out');}t.sent.push(x);return {sent:true};}});
    t.reports.push({...BLOCK});
    await c.tick({sessionId:'s1'});clock+=10*60000;await c.tick({sessionId:'s1'});await c.tick({sessionId:'s1'});
    const [stop]=await leadStops(t.root,clock);
    assert.deepEqual([stop.owner,stop.forUser],[undefined,undefined]);
    assert.equal(tries,1,'never sent again');assert.equal(await called(c),0);
    assert.equal((await c.read({sessionId:'s1'})).log.filter(l=>/message to the Lead not confirmed/.test(l.text)).length,1,'said once');
  }finally{await t.cleanup();}
});

// ---- M10 review, gap 2: what the Lead tries is said in « Recent activity », in the words of the mockup (screen 12):
// a try that fails the same way, a try running, the last try failed when the Lead asks the user. Each once, whatever
// watcher passes.
test('the tries of the Lead are said once each in the journal, in the words of the mockup (M10 review)',async()=>{
  let clock=at('10:03');
  const t=await setup({now:()=>clock});
  try{
    const inbox=createRequestRegistry({root:t.root,now:()=>clock});
    await t.chain.launch({sessionId:'s1',tickets:[FG2]});
    t.reports.push({...BLOCK});
    await t.chain.tick({sessionId:'s1'});
    const write=async(tries,forUser=false)=>{const it=(await leadStops(t.root,clock))[0];const {type,cause,mission,project,issue,ticket,title,text,blocked,proofs,migration,since,owner}=it;
      await inbox.ask({type,cause,mission,project,issue,ticket,question:null,title,text,blocked,proofs,migration,since,owner,forUser,tries,expect:it.id});};
    const lines=async()=>(await t.chain.read({sessionId:'s1'})).log.map(l=>[l.at,l.text]).filter(([,x])=>/try|fails again/.test(x));
    clock=at('10:12');
    await write([{text:'Dev 1 relaunched the migration as is',at:'2026-11-09T10:04:00.000Z',outcome:'same'},{text:'dedupe the ranks',at:'2026-11-09T10:12:00.000Z',outcome:'running'},{text:'regenerate the test project',last:true}]);
    await t.chain.tick({sessionId:'s1'});await t.make({now:()=>clock}).tick({sessionId:'s1'});
    const hm=s=>{const d=new Date(at(s));return String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0');};
    assert.deepEqual(await lines(),[[hm('10:04'),'XJ-2: the migration fails again'],[hm('10:12'),'Lead: try 2, dedupe the ranks']]);
    clock=at('10:20');
    await write([{text:'Dev 1 relaunched the migration as is',at:'2026-11-09T10:04:00.000Z',outcome:'same'},{text:'dedupe the ranks',at:'2026-11-09T10:12:00.000Z',outcome:'same'},{text:'regenerate the test project',at:'2026-11-09T10:20:00.000Z',outcome:'same',last:true}],true);
    await t.chain.tick({sessionId:'s1'});await t.chain.tick({sessionId:'s1'});
    assert.deepEqual((await lines()).slice(2),[[hm('10:20'),'XJ-2: the migration fails again'],[hm('10:20'),'Lead: try 3 fails, asks you']]);
  }finally{await t.cleanup();}
});

// ---- M10 review 2, P1: a watcher cut right after tab.new, before the terminal of the reviewer is written: the launch
// is known as asked, its absence is not proven, and no second reviewer is made, however long its tab takes to show.
import { withLock } from '../src/common.mjs';
import { news } from './helpers/dev-chain-setup.mjs';
test('a watcher cut right after launching a reviewer never makes a second one while that tab may still show (M10 review 2)',async()=>{
  let clock=at('10:00');
  const t=await setup({now:()=>clock});
  try{
    await t.chain.launch({sessionId:'s1',tickets:[FG2]});
    t.reports.push({ticket:'XJ-2',kind:'dev',commit:A,repo:'admin',summary:'fait',at:'2026-11-09T10:00:00.000Z'});
    let dead=false;
    const lock=async(dir,task)=>{if(dead)throw Object.assign(new Error('process stopped'),{code:'CUT'});return withLock(dir,task);};
    const invoke=async(file,args)=>{const out=await t.core.invoke(file,args);if(JSON.stringify(args).includes('XJ-2 · revue')&&JSON.stringify(args).includes('tab.new'))dead=true;return out;};
    t.core.faults.hidden=a=>a.tab_name==='XJ-2 · revue';
    await t.make({now:()=>clock,lock,invoke}).tick({sessionId:'s1'}).catch(e=>{if(e.code!=='CUT')throw e;});
    assert.equal(dead,true,'cut right after tab.new');
    const reviews=()=>news(t.calls).filter(x=>x==='XJ-2 · revue').length;
    assert.equal(reviews(),1,'launched once before the cut');
    for(const step of [60000,60000,3*60000]){clock+=step;const again=t.make({now:()=>clock});await again.tick({sessionId:'s1'});await again.tick({sessionId:'s1'});}
    assert.equal(reviews(),1,'never a second reviewer while the first may show');
  }finally{await t.cleanup();}
});

// ---- M10 review 2, P2: the watcher lifts the stop of now, whatever the Lead wrote on it between its reading and the lift.
test('the watcher lifts the stop the Lead wrote again right before the lift, never leaving it open (M10 review 2)',async()=>{
  let clock=at('10:03');
  const t=await setup({now:()=>clock});
  try{
    const real=createRequestRegistry({root:t.root,now:()=>clock});
    await t.chain.launch({sessionId:'s1',tickets:[FG2]});
    t.reports.push({...BLOCK});
    await t.chain.tick({sessionId:'s1'});
    clock+=60000;t.reports.push({ticket:'XJ-2',kind:'dev',commit:A,repo:'admin',summary:'fait',at:new Date(clock).toISOString()});
    let once=false;
    const inbox={...real,list:async(...args)=>{const out=await real.list(...args);
      if(!once&&new Error().stack.includes('lift')){once=true;const it=out.find(i=>i.type==='stuck'&&i.cause==='blocked'&&i.state!=='resolved');
        if(it){const {type,cause,mission,project,issue,ticket,title,text,blocked,proofs,migration,since,owner,forUser}=it;await real.ask({type,cause,mission,project,issue,ticket,question:null,title,text,blocked,proofs,migration,since,owner,forUser,tries:[{text:'try'}],expect:it.id});}}
      return out;}};
    await t.make({now:()=>clock,inbox}).tick({sessionId:'s1'});
    assert.deepEqual(await leadStops(t.root,clock),[],'no stop left open');
  }finally{await t.cleanup();}
});

// ---- M10 review 2, P2: a line of the journal and its mark are written together: a watcher cut between them never
// loses the line.
test('a try of the Lead is said in the journal even when the watcher was cut as it said it (M10 review 2)',async()=>{
  let clock=at('10:03');
  const t=await setup({now:()=>clock});
  try{
    const inbox=createRequestRegistry({root:t.root,now:()=>clock});
    await t.chain.launch({sessionId:'s1',tickets:[FG2]});
    t.reports.push({...BLOCK});
    await t.chain.tick({sessionId:'s1'});
    const it=(await leadStops(t.root,clock))[0];const {type,cause,mission,project,issue,ticket,title,text,blocked,proofs,migration,since,owner,forUser}=it;
    await inbox.ask({type,cause,mission,project,issue,ticket,question:null,title,text,blocked,proofs,migration,since,owner,forUser,tries:[{text:'dedupe the ranks',at:'2026-11-09T10:12:00.000Z',outcome:'running'}],expect:it.id});
    // The chain dies on its first write after the try is marked: what was written with the mark stays, nothing after.
    const {readFile}=await import('node:fs/promises'),{join}=await import('node:path');
    const marked=async()=>{try{return Object.keys(JSON.parse(await readFile(join(t.root,'state','devchain-M-1.json'),'utf8')).done||{}).some(k=>k.startsWith('tryrun|'));}catch{return false;}};
    const lock=async(dir,task)=>{if(await marked())throw Object.assign(new Error('process stopped'),{code:'CUT'});return withLock(dir,task);};
    clock=at('10:12');
    await t.make({now:()=>clock,lock}).tick({sessionId:'s1'}).catch(e=>{if(e.code!=='CUT')throw e;});
    assert.ok(await marked(),'cut after the mark');
    clock+=60000;await t.make({now:()=>clock}).tick({sessionId:'s1'});
    assert.equal((await t.chain.read({sessionId:'s1'})).log.filter(l=>/Lead: try 1, dedupe the ranks/.test(l.text)).length,1,'said once, even after the cut');
  }finally{await t.cleanup();}
});

// ---- M10 review 3, P1: a write that fails once right after a reviewer was launched never gives its reservation back:
// the reviewer exists, so no second one is made.
test('a write that fails once after a reviewer was launched keeps its reservation: never a second reviewer (M10 review 3)',async()=>{
  let clock=at('10:00');
  const t=await setup({now:()=>clock});
  try{
    await t.chain.launch({sessionId:'s1',tickets:[FG2]});
    t.reports.push({ticket:'XJ-2',kind:'dev',commit:A,repo:'admin',summary:'fait',at:'2026-11-09T10:00:00.000Z'});
    let fail=false;
    const lock=async(dir,task)=>{if(fail){fail=false;throw Object.assign(new Error('disk'),{code:'EIO'});}return withLock(dir,task);};
    const invoke=async(file,args)=>{const out=await t.core.invoke(file,args);if(JSON.stringify(args).includes('XJ-2 · revue')&&JSON.stringify(args).includes('tab.new'))fail=true;return out;};
    t.core.faults.hidden=a=>a.tab_name==='XJ-2 · revue';
    const c=t.make({now:()=>clock,lock,invoke});
    await c.tick({sessionId:'s1'}).catch(()=>{});
    const reviews=()=>news(t.calls).filter(x=>x==='XJ-2 · revue').length;
    for(const step of [60000,60000,3*60000]){clock+=step;await c.tick({sessionId:'s1'}).catch(()=>{});await c.tick({sessionId:'s1'}).catch(()=>{});}
    assert.equal(reviews(),1,'never a second reviewer');
  }finally{await t.cleanup();}
});

// ---- M10 review 3, P2: the watcher lifts the stop of its instant only: a later stop of the same ticket, opened after
// the first was lifted, stays open, and so does the stop of another ticket.
test('liftStop with an instant lifts that stop only, never a later stop of the ticket nor another ticket (M10 review 3)',async t=>{
  const f=await desk(t);
  const first=(await f.inbox.ask(STOP)).item;
  await f.inbox.mark(first.id,{state:'resolved'});
  const later=(await f.inbox.ask({...STOP,text:'Encore',since:'2026-11-13T09:30:00.000Z'})).item;
  const other=(await f.inbox.ask({...STOP,ticket:'XJ-6',blocked:['XJ-6']})).item;
  assert.equal(await f.inbox.liftStop({mission:'M-1',ticket:'XJ-2',since:STOP.since}),null,'nothing of that instant is open');
  const open=(await f.inbox.list({mission:'M-1'})).filter(i=>i.state!=='resolved').map(i=>i.id).sort();
  assert.deepEqual(open,[later.id,other.id].sort());
  assert.equal((await f.inbox.liftStop({mission:'M-1',ticket:'XJ-2',since:later.since})).id,later.id);
  assert.deepEqual((await f.inbox.list({mission:'M-1'})).filter(i=>i.state!=='resolved').map(i=>i.id),[other.id]);
});
