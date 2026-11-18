import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createMissionRegistry } from '../src/mission.mjs';
import { createQuestionRegistry } from '../src/questions.mjs';
import { createRequestRegistry } from '../src/requests.mjs';
import { devName } from '../src/dev-lane.mjs';
import { AppError } from '../src/common.mjs';
import { planTicket, recordPlan, approvePlan, setup, leadMission, news, devRuns, FG2 } from './helpers/dev-chain-setup.mjs';

// One dev alive per mission (ticket 3 of the workflow v2, decisions 46 and 48 of the owner): the scenarios of the six
// reviews of the mechanism of before (R1 to R6), the lines of the table of the approach that take a chain to play, the
// three rules of the owner, the stops after a merge, the resumes nobody is sure of, and every interleaving of two and
// three operations a seed can draw. The lines of the table that the lane plays alone are in dev-lane.test.mjs.
const FG3={...FG2,identifier:'XJ-3'},FG4={...FG2,identifier:'XJ-4'},LEAD={role:'lead'},M={mission:'M-1'};
const T0=Date.parse('2026-11-09T09:00:00.000Z'),MIN=60000,HOUR=60*MIN;
const sha=c=>c.repeat(40);
const accept=(t,ticket,c,hour)=>t.reports.push({ticket,kind:'dev',commit:sha(c),repo:'admin',summary:'fait',at:'2026-11-09T'+hour+':00:00.000Z'},{ticket,kind:'review-1',commit:sha(c),verdict:'accepted',summary:'ok',at:'2026-11-09T'+hour+':30:00.000Z'});
const devs=calls=>news(calls).filter(name=>name.endsWith(' · dev'));
const from=more=>({mission:'M-1',fresh:false,...more});
const twice=async t=>{await t.chain.tick(M);await t.chain.tick(M);};
const door=()=>{let open,reached;const wait=new Promise(done=>{open=done;}),there=new Promise(done=>{reached=done;});return {open,there,through:async()=>{reached();await wait;}};};
const chainFile=t=>join(t.root,'state','devchain-M-1.json');
const stateOf=async t=>JSON.parse(await readFile(chainFile(t),'utf8'));
const laneOf=async t=>(await stateOf(t)).lane;
// The devs of the mission alive in the core, whatever their names.
const alive=t=>t.core.live().filter(x=>x.labels['fabrique-console.mission']==='M-1');
const one=(t,ticket,note)=>{const now=alive(t);assert.ok(now.length<=1,(note||'')+': at most one dev alive, got '+now.map(x=>x.labels['fabrique-console.ticket']).join(', '));if(ticket!==undefined)assert.deepEqual(now.map(x=>x.labels['fabrique-console.ticket']),ticket?[ticket]:[],note);};
const TWO_FREE=[planTicket('XJ-2',1),planTicket('XJ-3',2)];
// A mission of two tickets that wait for nothing, a clock the test moves, a patience that costs no real time.
async function serie(extra={},plan=TWO_FREE){
  const at={now:T0},t=await setup({now:()=>at.now++,wait:async()=>{at.now+=1000;},...extra},LEAD,{plan});
  t.issue.children=plan.map(p=>t.kid(p.id,'u'+p.id.split('-')[1]));
  return {t,at};
}
// Two callers at the same moment wait for each other for real.
const REAL_WAIT=ms=>new Promise(done=>setTimeout(done,ms));
const inboxOf=async t=>(await createRequestRegistry({root:t.root,questions:createQuestionRegistry({root:t.root}),missions:createMissionRegistry({root:t.root})}).list({mission:'M-1'}));
const state=(t,ticket)=>leadMission(t.root).then(({mission})=>mission.tickets.find(x=>x.id===ticket)?.state);

// ---- The basics of the lane, seen from the chain.
test('a dev is a terminal of the core under the name of its mission: asked at the launch, seen at the next pass, its tab named', async()=>{
  const {t}=await serie();
  try{
    assert.deepEqual((await t.chain.launch(from({tickets:[FG2]}))).launched,[{identifier:'XJ-2',launched:true}]);
    const [dev]=alive(t);
    assert.equal(dev.name,devName('M-1'));assert.equal(dev.labels['fabrique-console.ticket'],'XJ-2');assert.equal(dev.labels['fabrique-console.launch'],'1');assert.equal(dev.labels['herdr.space'],'sp');
    assert.deepEqual(await laneOf(t),{ticket:'XJ-2',launch:1,tab:'asked',terminal:dev.address});
    assert.equal(t.tab('XJ-2 · dev')?.address,dev.address,'its tab bears the name of a dev');
    assert.equal(t.calls.some(([c,a])=>c==='tab.new'&&/· dev$/.test(a.name)),false,'no tab of a dev is asked of the window');
    await t.chain.tick(M);
    assert.deepEqual(await laneOf(t),{ticket:'XJ-2',launch:1,tab:'seen',terminal:dev.address});
  }finally{await t.cleanup();}
});

test('a name the window refused to give the tab of a dev is asked again at the next pass, and the dev is found without it', async()=>{
  const {t}=await serie();
  try{
    let refuse=true;
    t.core.faults.do=command=>refuse&&command==='tab.rename'?'fail':null;
    assert.deepEqual((await t.chain.launch(from({tickets:[FG2]}))).launched,[{identifier:'XJ-2',launched:true}],'launched all the same');
    assert.equal(t.tab('XJ-2 · dev'),undefined);
    // Its report comes, a fix is asked: it reaches the dev by the address the lane keeps, whatever its tab is called.
    t.reports.push({ticket:'XJ-2',kind:'dev',commit:sha('a'),repo:'admin',summary:'x',at:'2026-11-09T10:00:00.000Z'},{ticket:'XJ-2',kind:'review-1',commit:sha('a'),verdict:'changes_requested',summary:'bug Z',at:'2026-11-09T10:05:00.000Z'});
    await twice(t);
    assert.deepEqual(t.sent.filter(x=>/XJ-2\.review-1\.json/.test(x.text)).map(x=>x.terminal),[alive(t)[0].address]);
    refuse=false;await t.chain.tick(M);
    assert.equal(t.tab('XJ-2 · dev')?.address,alive(t)[0].address,'named at a later pass');
  }finally{await t.cleanup();}
});

test('the watcher skips a mission whose lane is busy, and a command waits ten seconds for the lock then says busy', {timeout:60000}, async()=>{
  const d=door(),{t,at}=await serie();
  try{
    const first=t.make({ensureWorktree:async()=>{await d.through();return {path:'/wt',branch:'xj-1',base:'release/x',created:[],rebased:[],command:"'node' '/r.mjs'"};}}).launch(from({tickets:[FG2]}));
    await d.there;
    assert.deepEqual(await t.chain.tickAll(),{missions:[{mission:'M-1',ran:false,skipped:'busy'}]});
    const before=at.now;
    await assert.rejects(()=>t.chain.launch(from({tickets:[FG3]})),e=>e.code==='DEV_LANE_BUSY');
    assert.ok(at.now-before>=10000&&at.now-before<12000,'ten seconds of patience');
    one(t,null);
    d.open();
    assert.deepEqual((await first).launched,[{identifier:'XJ-2',launched:true}]);
    assert.deepEqual((await t.chain.tickAll()).missions,[{mission:'M-1',ran:true}]);
  }finally{await t.cleanup();}
});

// ---- The six reviews: each scenario that got around the series of before, by its name.
test('R1 — a resume of a ticket accepted and merged, while the next one is at work, starts no second dev', async()=>{
  const {t}=await serie();
  try{
    await t.chain.launch(from({tickets:[FG2]}));accept(t,'XJ-2','a','10');await twice(t);
    one(t,'XJ-3');
    assert.deepEqual((await t.chain.launch(from({resume:true,tickets:[FG2]}))).launched,[{identifier:'XJ-2',launched:false,reason:'over'}]);
    one(t,'XJ-3');assert.deepEqual(devs(t.calls),['XJ-2 · dev','XJ-3 · dev']);
  }finally{await t.cleanup();}
});

test('R1 — a ticket launched that the tracker says done is not over: only its acceptance, its merge and the stop of its dev free the lane', async()=>{
  const {t}=await serie();
  try{
    await t.chain.launch(from({tickets:[FG2]}));
    t.issue.children[0].state={type:'completed'};t.chain.forget();await twice(t);
    one(t,'XJ-2');assert.equal((await laneOf(t)).ticket,'XJ-2');
    assert.deepEqual((await t.chain.launch(from({tickets:[FG3]}))).launched,[{identifier:'XJ-3',launched:false,reason:'serial'}]);
    accept(t,'XJ-2','a','10');await twice(t);
    one(t,'XJ-3');
  }finally{await t.cleanup();}
});

test('R1 — the rank is worked out under the lock: of two launches at the same moment, the first of the plan starts', async()=>{
  const {t}=await serie({wait:REAL_WAIT});
  try{
    const [a,b]=await Promise.all([t.make().launch(from({tickets:[FG3]})),t.make().launch(from({tickets:[FG2]}))]);
    assert.deepEqual([...a.launched,...b.launched].filter(x=>x.launched),[{identifier:'XJ-2',launched:true}]);
    assert.ok(['rank','serial'].includes(a.launched[0].reason));one(t,'XJ-2');
  }finally{await t.cleanup();}
});

test('R2 — two resumes of one ticket that start from the same state start one dev: the second finds the first one\'s alive', async()=>{
  const {t}=await serie({wait:REAL_WAIT});
  try{
    await t.chain.launch(from({tickets:[FG2]}));await t.chain.tick(M);
    t.core.end(alive(t)[0]);
    const outs=await Promise.all([t.make().launch(from({resume:true,tickets:[FG2]})),t.make().launch(from({resume:true,tickets:[FG2]}))]);
    assert.deepEqual(outs.flatMap(o=>o.launched).filter(x=>x.launched),[{identifier:'XJ-2',launched:true}]);
    assert.equal(outs.flatMap(o=>o.launched).find(x=>!x.launched).reason,'already');
    one(t,'XJ-2');assert.equal(devRuns(t.calls,'XJ-2'),2,'the first launch, and one resume');
  }finally{await t.cleanup();}
});

test('R2 — a canceled ticket taken out of the plan does not hold the lane: the lane names its ticket, and frees once its dev is seen stopped', async()=>{
  const {t}=await serie();
  try{
    await t.chain.launch(from({tickets:[FG2]}));
    t.issue.children[0].state={type:'canceled'};t.chain.forget();
    // The plan rewritten without XJ-2, approved again (M7 stands here; decision 77): XJ-3 changed in it.
    const {missions}=await leadMission(t.root);await recordPlan(missions,'M-1',[planTicket('XJ-3',1)]);await approvePlan(missions,'M-1');
    await twice(t);
    one(t,'XJ-3');assert.equal((await laneOf(t)).ticket,'XJ-3');
    accept(t,'XJ-3','b','11');await twice(t);
    assert.equal(news(t.calls).filter(name=>name==='QA · XJ-1').length,1);
  }finally{await t.cleanup();}
});

test('R3 — the answer of the launch is lost: the lane stays asked, and a resume at once finds the dev alive in the core', async()=>{
  const {t}=await serie();
  try{
    t.core.faults.run='lost';
    const first=await t.chain.launch(from({tickets:[FG2]}));
    assert.equal(first.launched[0].launched,false);t.core.faults.run=null;
    assert.deepEqual(await laneOf(t),{ticket:'XJ-2',launch:1,tab:'asked',terminal:null},'asked is not erased by the failure');
    assert.equal(typeof (await stateOf(t)).done['dev|XJ-2'],'number');
    assert.deepEqual((await t.chain.launch(from({resume:true,tickets:[FG2]}))).launched,[{identifier:'XJ-2',launched:false,reason:'already'}]);
    assert.deepEqual((await t.chain.launch(from({tickets:[FG2,FG3]}))).launched,[{identifier:'XJ-2',launched:false,reason:'already'},{identifier:'XJ-3',launched:false,reason:'serial'}]);
    one(t,'XJ-2');assert.equal((await laneOf(t)).tab,'seen');
    assert.deepEqual(await inboxOf(t),[],'no doubt: the core showed it');
  }finally{await t.cleanup();}
});

test('R3 — a preparation that lasts hours holds the lane for as long: no delay gives it to a resume', {timeout:60000}, async()=>{
  const d=door(),{t,at}=await serie();
  try{
    const first=t.make({ticketBranch:async({ticket})=>{await d.through();return {path:'/wt-'+ticket,branch:'b',issueBranch:'xj-1'};}}).launch(from({tickets:[FG2]}));
    await d.there;at.now+=3*HOUR;
    await assert.rejects(()=>t.make().launch(from({resume:true,tickets:[FG2]})),e=>e.code==='DEV_LANE_BUSY');
    assert.deepEqual((await t.chain.tickAll()).missions,[{mission:'M-1',ran:false,skipped:'busy'}]);
    one(t,null);
    d.open();
    assert.deepEqual((await first).launched,[{identifier:'XJ-2',launched:true}]);
    assert.deepEqual((await t.chain.launch(from({resume:true,tickets:[FG2]}))).launched,[{identifier:'XJ-2',launched:false,reason:'already'}]);
    one(t,'XJ-2');assert.equal(devRuns(t.calls,'XJ-2'),1);
  }finally{await t.cleanup();}
});

test('R3 — a ticket canceled while its launch prepares: the pass waits for the launch to end, then stops its dev before the next one starts', {timeout:60000}, async()=>{
  const d=door(),{t,at}=await serie();
  try{
    const first=t.make({ticketBranch:async({ticket})=>{await d.through();return {path:'/wt-'+ticket,branch:'b',issueBranch:'xj-1'};}}).launch(from({tickets:[FG2]}));
    await d.there;
    t.issue.children[0].state={type:'canceled'};t.chain.forget();at.now+=5*MIN;
    assert.deepEqual((await t.chain.tickAll()).missions,[{mission:'M-1',ran:false,skipped:'busy'}],'nothing is said stopped, nothing starts meanwhile');
    one(t,null);
    d.open();await first;
    one(t);
    await t.chain.tick(M);
    one(t,'XJ-3','XJ-2 stopped and seen stopped, then XJ-3');
    assert.equal(await state(t,'XJ-2'),'canceled');
  }finally{await t.cleanup();}
});

test('R4 — made is not seen: the answer of the core leaves the lane asked, and seen comes from a reading of the core', async()=>{
  const {t}=await serie();
  try{
    await t.chain.launch(from({tickets:[FG2]}));
    assert.equal((await laneOf(t)).tab,'asked');
    // A resume at once: the core is read, the dev is there.
    assert.deepEqual((await t.chain.launch(from({resume:true,tickets:[FG2]}))).launched,[{identifier:'XJ-2',launched:false,reason:'already'}]);
    assert.equal((await laneOf(t)).tab,'seen');one(t,'XJ-2');assert.equal(devRuns(t.calls,'XJ-2'),1);
  }finally{await t.cleanup();}
});

test('R4 — a window that does not list the dev proves nothing: after a lost answer, a launch much later still finds it in the core', async()=>{
  const {t,at}=await serie();
  try{
    // The window never shows a dev, and says nothing of what it made.
    t.core.faults.hidden=a=>/· dev$/.test(a.tab_name)||/^mc-dev-/.test(a.tab_name);
    t.core.faults.run='lost';
    const chain=t.make();
    assert.equal((await chain.launch(from({tickets:[FG2]}))).launched[0].launched,false);t.core.faults.run=null;
    at.now+=3*MIN;
    assert.deepEqual((await chain.launch(from({tickets:[FG2]}))).launched,[{identifier:'XJ-2',launched:false,reason:'already'}]);
    at.now+=3*HOUR;await chain.tick(M);
    assert.deepEqual((await chain.launch(from({resume:true,tickets:[FG2]}))).launched,[{identifier:'XJ-2',launched:false,reason:'already'}]);
    one(t,'XJ-2');assert.equal(devRuns(t.calls,'XJ-2'),1);
  }finally{await t.cleanup();}
});

test('R4 — a ticket canceled after the answer of its launch was lost: its dev is stopped and seen stopped before the next one starts', async()=>{
  const {t}=await serie();
  try{
    t.core.faults.run='lost';await t.chain.launch(from({tickets:[FG2]}));t.core.faults.run=null;
    one(t,'XJ-2');assert.equal((await laneOf(t)).terminal,null,'nobody knows its address');
    t.issue.children[0].state={type:'canceled'};t.chain.forget();
    await t.chain.tick(M);
    one(t,'XJ-3','the dev made behind the lost answer is killed, then XJ-3 starts');
    assert.equal(t.core.terminals.find(x=>x.labels['fabrique-console.ticket']==='XJ-2').reason,'killed');
  }finally{await t.cleanup();}
});

test('R5 — an old tab still listed by the window does not vouch for a new launch: the launch number of the terminal does', async()=>{
  const {t}=await serie();
  try{
    await t.chain.launch(from({tickets:[FG2]}));await t.chain.tick(M);
    const old=alive(t)[0];t.core.end(old);
    // The window still lists the tab of the first launch, long after; the second launch never reaches the core.
    const stale={address:old.address,space:'sp',tab:old.tab,tab_name:'XJ-2 · dev',status:'working'};
    t.agents.push(stale);const chain=t.make();
    t.core.faults.run='mute';
    assert.equal((await chain.launch(from({resume:true,tickets:[FG2]}))).launched[0].launched,false);t.core.faults.run=null;
    await chain.tick(M);await chain.tick(M);
    assert.deepEqual(await laneOf(t),{ticket:'XJ-2',launch:2,tab:'asked',terminal:null},'not seen: the core shows no terminal of launch 2');
    assert.equal((await inboxOf(t)).filter(i=>i.cause==='dev'&&i.ticket==='XJ-2').length,1,'a doubt, said');
    one(t,null);
    // The gesture of the user makes the one dev.
    assert.deepEqual((await chain.launch(from({resume:true,tickets:[FG2]}))).launched,[{identifier:'XJ-2',launched:true}]);
    one(t,'XJ-2');assert.equal(alive(t)[0].labels['fabrique-console.launch'],'2');
  }finally{await t.cleanup();}
});

test('R5 — the series is decided under the lock: a ticket opened again and resumed while the next one prepares does not start beside it', {timeout:60000}, async()=>{
  const d=door(),{t}=await serie();
  try{
    await t.chain.launch(from({tickets:[FG2]}));
    t.issue.children[0].state={type:'canceled'};t.chain.forget();
    // XJ-2 canceled and stopped; XJ-3 takes the lane and prepares its folder for a long time.
    const run=t.make({ticketBranch:async({ticket})=>{if(ticket==='XJ-3')await d.through();return {path:'/wt-'+ticket,branch:'b',issueBranch:'xj-1'};}});
    const pass=run.tick(M);
    await d.there;one(t,null);
    t.issue.children[0].state={type:'unstarted'};t.chain.forget();
    await assert.rejects(()=>t.make().launch(from({resume:true,tickets:[FG2]})),e=>e.code==='DEV_LANE_BUSY');
    d.open();await pass;
    one(t,'XJ-3');
    assert.deepEqual((await t.chain.launch(from({resume:true,tickets:[FG2]}))).launched,[{identifier:'XJ-2',launched:false,reason:'serial'}]);
    one(t,'XJ-3');
  }finally{await t.cleanup();}
});

test('R6 — a stop is seen in the core, on the terminal of the lane, never in a list of the window: an empty window frees nothing', async()=>{
  const {t,at}=await serie();
  try{
    await t.chain.launch(from({tickets:[FG2]}));
    t.issue.children[0].state={type:'canceled'};t.chain.forget();
    // The window shows no dev at all, and the kill leaves the terminal alive (a supposition of the test).
    t.core.faults.hidden=a=>a.tab!=='po';
    const chain=t.make();
    t.core.faults.kill='stays';at.now+=5*MIN;
    await chain.tick(M);await chain.tick(M);
    one(t,'XJ-2','still alive in the core: nothing starts');
    assert.equal((await laneOf(t)).ticket,'XJ-2');assert.equal(await state(t,'XJ-2'),'dev','not said canceled before its dev is seen stopped');
    assert.deepEqual((await chain.launch(from({tickets:[FG3]}))).launched,[{identifier:'XJ-3',launched:false,reason:'serial'}]);
    t.core.faults.kill=null;await chain.tick(M);
    one(t,'XJ-3');
  }finally{await t.cleanup();}
});

test('R6 — a launch suspended right before it asks the core holds the lane for as long: nobody decides between its decision and its request', {timeout:60000}, async()=>{
  const d=door(),{t,at}=await serie();
  try{
    const slow=t.make({invoke:async(file,args)=>{if(args[0]==='run')await d.through();return t.core.invoke(file,args);}});
    const first=slow.launch(from({tickets:[FG2]}));
    await d.there;at.now+=2*HOUR;
    assert.deepEqual(await laneOf(t),{ticket:'XJ-2',launch:1,tab:'asked',terminal:null},'noted before the core is asked');
    await assert.rejects(()=>t.make().launch(from({resume:true,tickets:[FG2]})),e=>e.code==='DEV_LANE_BUSY');
    await assert.rejects(()=>t.make().launch(from({tickets:[FG3]})),e=>e.code==='DEV_LANE_BUSY');
    one(t,null);
    d.open();
    assert.deepEqual((await first).launched,[{identifier:'XJ-2',launched:true}]);
    one(t,'XJ-2');assert.equal(t.calls.filter(([c])=>c==='hc.run').length,1);
  }finally{await t.cleanup();}
});

// ---- The three rules of the owner (decision 48).
test('rule 1 — a dev asked for and not seen at the next pass: the tool stops and says it once, tries nothing on its own, and the user launches it again', async()=>{
  const {t,at}=await serie();
  try{
    t.core.faults.run='mute';
    assert.equal((await t.chain.launch(from({tickets:[FG2]}))).launched[0].launched,false);t.core.faults.run=null;
    for(let i=0;i<5;i++){at.now+=HOUR;await t.chain.tick(M);}
    assert.equal(t.calls.filter(([c])=>c==='hc.run').length,0,'no try of its own, however long');
    one(t,null);assert.deepEqual(await laneOf(t),{ticket:'XJ-2',launch:1,tab:'asked',terminal:null});
    const said=(await inboxOf(t)).filter(i=>i.type==='stuck'&&i.cause==='dev');
    assert.equal(said.length,1);assert.equal(said[0].ticket,'XJ-2');assert.deepEqual(said[0].blocked,['XJ-2']);
    assert.equal(t.notified.filter(([,text])=>/XJ-2/.test(text)).length,1,'said once');
    assert.deepEqual((await t.chain.launch(from({tickets:[FG3]}))).launched,[{identifier:'XJ-3',launched:false,reason:'serial'}],'the series stands still');
    // The gesture of the user: the same launch, asked again.
    assert.deepEqual((await t.chain.launch(from({tickets:[FG2]}))).launched,[{identifier:'XJ-2',launched:true}]);
    await t.chain.tick(M);
    one(t,'XJ-2');assert.equal((await laneOf(t)).tab,'seen');
    assert.deepEqual((await inboxOf(t)).filter(i=>i.cause==='dev'),[],'seen: the doubt is settled');
  }finally{await t.cleanup();}
});

test('rule 1 — a dev asked for and never seen, its ticket canceled: the lane stays held and said, the next one waits, and the dev that appears late is stopped first', async()=>{
  const {t}=await serie();
  try{
    // The request is on its way to the core: nobody knows its address, and nothing lives yet.
    t.core.faults.run='late';
    assert.equal((await t.chain.launch(from({tickets:[FG2]}))).launched[0].launched,false);t.core.faults.run=null;
    await t.chain.tick(M);
    assert.equal((await inboxOf(t)).find(i=>i.cause==='dev'&&i.ticket==='XJ-2').recommendation,'Launch its dev again.','open, its dev is launched again');
    t.issue.children[0].state={type:'canceled'};t.chain.forget();
    for(let i=0;i<4;i++)await t.chain.tick(M);
    one(t,null,'no dev alive, and XJ-3 not started');assert.deepEqual(await laneOf(t),{ticket:'XJ-2',launch:1,tab:'asked',terminal:null},'absences free nothing');
    assert.equal(devRuns(t.calls,'XJ-3'),0,'XJ-3 does not start');
    assert.equal(news(t.calls).filter(name=>name==='QA · XJ-1').length,0,'nor the Validation');
    const held=(await inboxOf(t)).filter(i=>i.type==='stuck'&&i.cause==='dev'&&i.ticket==='XJ-2');
    assert.equal(held.length,1,'held, and said');
    assert.equal(held[0].recommendation,'To skip this canceled ticket, reopen it in the tracker, launch its dev again, then cancel it again. The series will continue once its dev is confirmed stopped.','a canceled ticket is not launched again as it is: the way out is said');
    assert.equal(t.notified.filter(([,text])=>/XJ-2/.test(text)).length,1,'said once: the way out replaces what was said, without a second notification');
    // The dev of XJ-2 appears at last: it is the dev of the lane, never a dev beside a free lane.
    t.core.arrive();
    one(t,'XJ-2');assert.equal((await laneOf(t)).ticket,'XJ-2');
    await twice(t);
    assert.equal(t.core.terminals.find(x=>x.labels['fabrique-console.ticket']==='XJ-2').reason,'killed');
    one(t,'XJ-3','its stop seen, XJ-3 starts');
    assert.deepEqual((await inboxOf(t)).filter(i=>i.cause==='dev'),[],'the doubt is settled');
    accept(t,'XJ-3','b','11');await twice(t);
    one(t,null);assert.equal(news(t.calls).filter(name=>name==='QA · XJ-1').length,1);
  }finally{await t.cleanup();}
});

test('rule 2 — a ticket sent back for corrections, canceled then opened again, takes its place by its rank once the lane is free, and the next ones follow', async()=>{
  const {t}=await serie({},[planTicket('XJ-2',1),planTicket('XJ-3',2),planTicket('XJ-4',3)]);
  try{
    await t.chain.launch(from({tickets:[FG2]}));await t.chain.tick(M);
    const first=alive(t)[0].address;
    t.reports.push({ticket:'XJ-2',kind:'dev',commit:sha('a'),repo:'admin',summary:'fait',at:'2026-11-09T10:00:00.000Z'},{ticket:'XJ-2',kind:'review-1',commit:sha('a'),verdict:'changes_requested',summary:'bug X',at:'2026-11-09T10:30:00.000Z'});
    await twice(t);
    assert.equal(t.sent.filter(x=>x.terminal===first&&/XJ-2\.review-1\.json/.test(x.text)).length,1,'the corrections went to its dev');
    t.issue.children[0].state={type:'canceled'};t.chain.forget();await twice(t);
    one(t,'XJ-3');
    t.issue.children[0].state={type:'unstarted'};t.chain.forget();await twice(t);
    one(t,'XJ-3');
    accept(t,'XJ-3','b','11');
    for(let i=0;i<4;i++)await t.chain.tick(M);
    one(t,'XJ-2','XJ-2 takes its place again, before XJ-4');
    const second=alive(t)[0].address;assert.notEqual(second,first);
    assert.equal(t.sent.filter(x=>x.terminal===second&&/XJ-2\.review-1\.json/.test(x.text)).length,1,'its new dev is told the corrections asked, once');
    assert.equal(devRuns(t.calls,'XJ-4'),0);
    t.reports.push({ticket:'XJ-2',kind:'dev',commit:sha('c'),repo:'admin',summary:'corrigé',at:'2026-11-09T12:00:00.000Z'},{ticket:'XJ-2',kind:'review-1',commit:sha('c'),verdict:'accepted',summary:'ok',at:'2026-11-09T12:30:00.000Z'});
    await twice(t);
    one(t,'XJ-4','and the next ones are not held');
  }finally{await t.cleanup();}
});

test('rule 2 — a ticket sent back for corrections, canceled then opened again, whose new dev starts while the answer of its launch is lost: found at the next pass, it is told the corrections, once', async()=>{
  const {t}=await serie({},[planTicket('XJ-2',1),planTicket('XJ-3',2),planTicket('XJ-4',3)]);
  try{
    await t.chain.launch(from({tickets:[FG2]}));await t.chain.tick(M);
    const first=alive(t)[0].address;
    t.reports.push({ticket:'XJ-2',kind:'dev',commit:sha('a'),repo:'admin',summary:'fait',at:'2026-11-09T10:00:00.000Z'},{ticket:'XJ-2',kind:'review-1',commit:sha('a'),verdict:'changes_requested',summary:'bug X',at:'2026-11-09T10:30:00.000Z'});
    await twice(t);
    assert.equal(t.sent.filter(x=>x.terminal===first&&/XJ-2\.review-1\.json/.test(x.text)).length,1,'the corrections went to its dev');
    t.issue.children[0].state={type:'canceled'};t.chain.forget();await twice(t);
    t.issue.children[0].state={type:'unstarted'};t.chain.forget();await twice(t);
    one(t,'XJ-3');
    // The lane freed, XJ-2 is asked for again: its terminal is made, and the answer of the core never comes back.
    accept(t,'XJ-3','b','11');t.core.faults.run='lost';
    for(let i=0;i<4&&!alive(t).some(x=>x.labels['fabrique-console.ticket']==='XJ-2');i++)await t.chain.tick(M);
    t.core.faults.run=null;
    one(t,'XJ-2','its new dev lives, whatever became of the answer');
    const second=alive(t)[0].address;assert.notEqual(second,first);
    assert.equal(t.sent.filter(x=>x.terminal===second).length,0,'nothing was sent to it yet');
    for(let i=0;i<4;i++)await t.chain.tick(M);
    assert.equal((await laneOf(t)).tab,'seen','found at the next pass');
    assert.equal(t.sent.filter(x=>x.terminal===second&&/XJ-2\.review-1\.json/.test(x.text)).length,1,'the dev found is told the corrections asked, once');
    assert.equal(t.sent.filter(x=>x.terminal===first&&/XJ-2\.review-1\.json/.test(x.text)).length,1,'and its dev of before was told them once');
    one(t,'XJ-2');assert.equal(devRuns(t.calls,'XJ-4'),0);
  }finally{await t.cleanup();}
});

test('rule 2 — a ticket canceled then opened again takes its place on its own, by its rank, once the lane is free, and never interrupts its holder', async()=>{
  const {t}=await serie({},[planTicket('XJ-2',1),planTicket('XJ-3',2),planTicket('XJ-4',3)]);
  try{
    await t.chain.launch(from({tickets:[FG2]}));
    t.issue.children[0].state={type:'canceled'};t.chain.forget();await twice(t);
    one(t,'XJ-3');const holder=alive(t)[0].address;
    t.issue.children[0].state={type:'unstarted'};t.chain.forget();
    for(let i=0;i<4;i++)await t.chain.tick(M);
    one(t,'XJ-3');assert.equal(alive(t)[0].address,holder,'its holder was not interrupted');
    assert.equal(await state(t,'XJ-2'),'dev','no longer said canceled');
    accept(t,'XJ-3','b','11');await twice(t);
    one(t,'XJ-2','XJ-2 before XJ-4: by its rank');
    assert.equal(alive(t)[0].labels['fabrique-console.launch'],'3');
    assert.deepEqual(devs(t.calls),['XJ-2 · dev','XJ-3 · dev','XJ-2 · dev']);
    accept(t,'XJ-2','a','12');await twice(t);
    one(t,'XJ-4');
  }finally{await t.cleanup();}
});

test('rule 3 — a ticket accepted and merged whose dev still works: its dev is stopped at once, seen stopped, then the next one starts', async()=>{
  const merges=[],{t}=await serie({ticketBranch:async({ticket})=>({path:'/wt-'+ticket,branch:'b',issueBranch:'xj-1'}),ticketMerge:async({ticket})=>{merges.push(ticket);return {status:'merged',merged:[{repo:'.'}]};}});
  try{
    await t.chain.launch(from({tickets:[FG2]}));await t.chain.tick(M);
    const dev=alive(t)[0];dev.status='working';
    accept(t,'XJ-2','a','10');
    await t.chain.tick(M);
    assert.deepEqual(merges,['XJ-2']);
    assert.equal(dev.state,'finished');assert.equal(dev.reason,'killed','working, and stopped all the same');
    one(t,'XJ-3','in the same pass');
    assert.deepEqual(await laneOf(t),{ticket:'XJ-3',launch:2,tab:'asked',terminal:alive(t)[0].address});
  }finally{await t.cleanup();}
});

// ---- Stops after a merge.
test('after a merge, a kill that fails holds the lane: the next ticket does not start, and the kill is asked again at each pass', async()=>{
  const {t}=await serie();
  try{
    await t.chain.launch(from({tickets:[FG2]}));await t.chain.tick(M);
    accept(t,'XJ-2','a','10');t.core.faults.kill='fail';
    await assert.rejects(()=>t.chain.tick(M));
    assert.deepEqual((await t.chain.tickAll()).missions.map(x=>Object.keys(x).sort()),[['error','mission']],'said by the pass');
    one(t,'XJ-2');assert.equal((await laneOf(t)).ticket,'XJ-2');
    assert.deepEqual((await t.chain.launch(from({tickets:[FG3]}))).launched,[{identifier:'XJ-3',launched:false,reason:'serial'}]);
    t.core.faults.kill=null;await t.chain.tick(M);
    one(t,'XJ-3');
  }finally{await t.cleanup();}
});

test('after a merge, a terminal still alive when the core is read again holds the lane', async()=>{
  const {t}=await serie();
  try{
    await t.chain.launch(from({tickets:[FG2]}));await t.chain.tick(M);
    accept(t,'XJ-2','a','10');t.core.faults.kill='stays';
    await twice(t);await twice(t);
    one(t,'XJ-2');assert.deepEqual(devs(t.calls),['XJ-2 · dev']);
    assert.equal(news(t.calls).includes('QA · XJ-1'),false);
    t.core.faults.kill=null;await t.chain.tick(M);
    one(t,'XJ-3');
  }finally{await t.cleanup();}
});

test('the last ticket merged: its dev is stopped before the QA agent starts', async()=>{
  const {t}=await serie({},[planTicket('XJ-2',1)]);
  try{
    await t.chain.launch(from({tickets:[FG2]}));await t.chain.tick(M);
    accept(t,'XJ-2','a','10');t.core.faults.kill='stays';await twice(t);
    assert.equal(news(t.calls).includes('QA · XJ-1'),false,'its dev alive, the delivery is not over');
    t.core.faults.kill=null;await twice(t);
    one(t,null);assert.equal(await laneOf(t),null);
    assert.equal(news(t.calls).filter(name=>name==='QA · XJ-1').length,1);
  }finally{await t.cleanup();}
});

// ---- Table of the approach, the lines a chain plays.
test('table 2 — free, a launch out of rank or of a ticket that waits: the lane stays free, nothing is made', async()=>{
  const {t}=await serie({},[planTicket('XJ-2',1),planTicket('XJ-3',2),planTicket('XJ-4',3,{deps:['XJ-2']})]);
  try{
    assert.deepEqual((await t.chain.launch(from({tickets:[FG3,FG4]}))).launched,[{identifier:'XJ-3',launched:false,reason:'rank'},{identifier:'XJ-4',launched:false,reason:'waits'}]);
    assert.equal((await stateOf(t)).lane,null);assert.equal(t.core.terminals.length,0);
  }finally{await t.cleanup();}
});

test('table 11 — free, a dev alive under the name of the mission that the lane does not know: blocked and said once, nothing is made nor killed', async()=>{
  const {t}=await serie();
  try{
    await t.core.invoke('hc',['run','--name',devName('M-1'),'--cwd','/wt','--label','fabrique-console.mission=M-1','--label','fabrique-console.ticket=XJ-9','--label','fabrique-console.launch=4','--','sleep','600']);
    assert.deepEqual((await t.chain.launch(from({tickets:[FG2]}))).launched,[{identifier:'XJ-2',launched:false,reason:'blocked'}]);
    await twice(t);await twice(t);
    one(t,'XJ-9');assert.equal(t.core.terminals.length,1);assert.equal((await stateOf(t)).lane,null);
    assert.equal((await inboxOf(t)).filter(i=>i.type==='stuck'&&i.cause==='lane').length,1);
    // It ends: the block is settled, and the series starts by its rank.
    t.core.end(t.core.terminals[0]);await twice(t);
    one(t,'XJ-2');assert.deepEqual((await inboxOf(t)).filter(i=>i.cause==='lane'),[]);
  }finally{await t.cleanup();}
});

test('table 12 — the file of the chain, the core or the tracker cannot be read: nothing changes, nothing is made, and it is said', async()=>{
  const {t}=await serie();
  try{
    await t.chain.launch(from({tickets:[FG2]}));await t.chain.tick(M);
    accept(t,'XJ-2','a','10');
    // The core does not answer: XJ-2 is over, and still nothing is freed nor launched.
    t.core.faults.get='mute';
    await assert.rejects(()=>t.chain.tick(M),e=>e.code==='HC_UNAVAILABLE');
    assert.match((await t.chain.tickAll()).missions[0].error,/./);
    await assert.rejects(()=>t.chain.launch(from({tickets:[FG3]})));
    t.core.faults.get=null;
    assert.equal((await laneOf(t)).ticket,'XJ-2');one(t,'XJ-2');
    // The tracker does not answer.
    const deaf=t.make({detail:async()=>{throw new Error('tracker down');}});
    await assert.rejects(()=>deaf.tick(M));
    assert.equal((await laneOf(t)).ticket,'XJ-2');one(t,'XJ-2');
    // The file of the chain is not what the chain wrote: nothing is read as an empty state any more.
    const good=await readFile(chainFile(t),'utf8');
    for(const bad of ['{"on":true,"done":','[]','{"on":true,"done":{},"lane":{"ticket":"XJ-2"}}','{"on":true,"done":{},"lane":"XJ-2"}','']){
      await writeFile(chainFile(t),bad);
      await assert.rejects(()=>t.make().tick(M),e=>e.code==='INVALID_DATA',bad);
      await assert.rejects(()=>t.make().launch(from({tickets:[FG3]})),e=>e.code==='INVALID_DATA',bad);
      assert.match((await t.make().tickAll()).missions[0].error,/./);
      assert.equal(await readFile(chainFile(t),'utf8'),bad,'left as it is');
    }
    one(t,'XJ-2');assert.equal(t.calls.filter(([c])=>c==='hc.run').length,1);
    await writeFile(chainFile(t),good);await t.chain.tick(M);
    one(t,'XJ-3');
  }finally{await t.cleanup();}
});

// ---- Resumes nobody is sure of.
test('the process died after the note and before the run: the pass finds the lane asked and no terminal, a doubt', async()=>{
  const {t}=await serie();
  try{
    await mkdir(join(t.root,'state'),{recursive:true});
    await writeFile(chainFile(t),JSON.stringify({on:true,done:{'dev|XJ-2':T0},log:[],seen:{},paths:{},bases:{},digest:[],digestAt:0,settled:false,lane:{ticket:'XJ-2',launch:1,tab:'asked',terminal:null},laneSeq:1}));
    await twice(t);
    one(t,null);assert.equal((await laneOf(t)).tab,'asked');
    assert.equal((await inboxOf(t)).filter(i=>i.cause==='dev'&&i.ticket==='XJ-2').length,1);
    assert.equal(t.calls.filter(([c])=>c==='hc.run').length,0);
  }finally{await t.cleanup();}
});

test('the process died after the run and before its answer was kept: the pass finds the terminal by the name of the mission and its labels', async()=>{
  const {t}=await serie();
  try{
    await mkdir(join(t.root,'state'),{recursive:true});
    await writeFile(chainFile(t),JSON.stringify({on:true,done:{'dev|XJ-2':T0},log:[],seen:{},paths:{},bases:{},digest:[],digestAt:0,settled:false,lane:{ticket:'XJ-2',launch:1,tab:'asked',terminal:null},laneSeq:1}));
    await t.core.invoke('hc',['run','--name',devName('M-1'),'--cwd','/wt','--label','fabrique-console.mission=M-1','--label','fabrique-console.ticket=XJ-2','--label','fabrique-console.launch=1','--label','herdr.space=sp','--label','herdr.tab=mc-dev-xj-2-1','--','sleep','600']);
    await t.chain.tick(M);
    assert.deepEqual(await laneOf(t),{ticket:'XJ-2',launch:1,tab:'seen',terminal:alive(t)[0].address});
    assert.deepEqual(await inboxOf(t),[]);assert.equal(t.calls.filter(([c])=>c==='hc.run').length,1,'the one of the test: none asked again');
    assert.equal(t.tab('XJ-2 · dev')?.address,alive(t)[0].address,'and its tab gets its name');
  }finally{await t.cleanup();}
});

// A mission whose devs were launched by the mechanism of before (its file has no lane): never rebuilt from its marks.
const OLD=[
  ['a launch of before still in flight (preparing)',{on:true,done:{'dev|XJ-2':1,'preparing|XJ-2':1}}],
  ['a tab asked for and never shown (asked without shown)',{on:true,done:{'dev|XJ-2':1,'asked|XJ-2':2}}],
  ['one ticket launched, its tab shown',{on:true,done:{'dev|XJ-2':1,'asked|XJ-2':2,'shown|XJ-2':3}}],
  ['two tickets launched and none over',{on:true,done:{'dev|XJ-2':1,'dev|XJ-3':2}}],
  ['a canceled ticket said stopped by a mark',{on:true,done:{'dev|XJ-2':1,'stopped|XJ-2|1':5}}],
  ['a chain set on, with no mark',{on:true,done:{}}],
];
for(const [name,chain] of OLD)test('a mission launched with the mechanism of before is blocked, not guessed — '+name, async()=>{
  const {t}=await serie();
  try{
    await mkdir(join(t.root,'state'),{recursive:true});
    const written=JSON.stringify({...chain,log:[],seen:{},paths:{},digest:[],digestAt:0});
    await writeFile(chainFile(t),written);
    // A dev of before may live in the window, under a name of before.
    t.agents.push({address:'told',space:'sp',tab:'old',tab_name:'XJ-2 · dev',status:'working'});
    assert.deepEqual(await t.chain.tick(M),{ran:false,refused:'DEV_LANE_OLD'});
    assert.deepEqual((await t.chain.tickAll()).missions,[{mission:'M-1',ran:false,refused:'DEV_LANE_OLD'}]);
    await assert.rejects(()=>t.chain.launch(from({tickets:[FG2]})),e=>e.code==='DEV_LANE_OLD');
    await assert.rejects(()=>t.chain.launch(from({resume:true,tickets:[FG3]})),e=>e.code==='DEV_LANE_OLD');
    assert.equal(await readFile(chainFile(t),'utf8'),written,'not a byte of its chain changed');
    assert.equal(t.core.terminals.length,0);assert.deepEqual(t.calls,[],'nothing made, closed or sent');
    const said=(await inboxOf(t)).filter(i=>i.type==='stuck'&&i.cause==='lane-old');
    assert.equal(said.length,1,'said once, with what to do by hand');assert.match(said[0].recommendation,/by hand/i);assert.doesNotMatch(JSON.stringify(said[0]),/reset/i);
    assert.equal((await t.chain.read(M)).on,true,'still read by the page');
  }finally{await t.cleanup();}
});

test('no command resets a mission of before: it stays blocked, whatever is asked', async()=>{
  const {t}=await serie();
  try{
    assert.equal(t.chain.laneReset,undefined);
    for(const path of ['src/backend.mjs','src/dev-chain.mjs','src/dev-lane.mjs','roles/lead.md','docs/backend-interface.json'])assert.doesNotMatch(await readFile(new URL('../'+path,import.meta.url),'utf8'),/dev-lane-reset|laneReset|DEV_LANE_BUSY_DEV/,path);
  }finally{await t.cleanup();}
});

test('a chain that was never set on and carries no launch is not of before: its first launch gives it its lane', async()=>{
  const {t}=await serie();
  try{
    await mkdir(join(t.root,'state'),{recursive:true});
    await writeFile(chainFile(t),JSON.stringify({on:false,done:{'answered|Q-1':1},log:[],seen:{},paths:{},digest:[],digestAt:0}));
    assert.deepEqual((await t.chain.launch(from({tickets:[FG2]}))).launched,[{identifier:'XJ-2',launched:true}]);
    assert.equal((await laneOf(t)).ticket,'XJ-2');
  }finally{await t.cleanup();}
});

// ---- Every interleaving a seed can draw.
// Each thing a chain depends on (the window, the core, the tracker, the reports, the folders, the wait of the lock) is
// a stop the test drives: one operation moves at a time, to its next stop, and the seed picks which. The core is the
// fake one: it refuses a name alive, may make a terminal and lose its answer, say nothing, or (a supposition) leave a
// terminal alive after a kill. After every step: one dev
// alive at most, whatever its name; none while the lane is free; the one alive is the one of the lane; and no request
// ever reached the core outside the lock of the mission, for another ticket than the one of the lane, or with a dev
// alive; and the watcher never asked again for a launch already asked. Bounded: two operations in every order under several seeds, three under as many seeds as FABRIQUE_CONSOLE_LANE_DRAWS
// says. Not a proof; the reason the invariant holds is the table of the approach, played line by line.
const OPS=['launch','relaunch','watcher','merge','cancel','reopen','lost','deaf','crash'];
const rng=seed=>()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/2**32;};
async function play(seed,ops,note) {
  const rand=rng(seed),pick=list=>list[Math.floor(rand()*list.length)];
  const at={now:T0},locks=new Map(),waiting=new Map(),dead=new Set(),problems=[],askedOnce=new Set();let wake=null,running=null;
  const t=await setup({now:()=>at.now++},LEAD,{plan:[planTicket('XJ-2',1),planTicket('XJ-3',2)]});
  t.issue.children=[t.kid('XJ-2','u2'),t.kid('XJ-3','u3')];
  const check=(ok,text)=>{if(!ok)problems.push(text);};
  const laneNow=async()=>{try{return JSON.parse(await readFile(chainFile(t),'utf8')).lane??null;}catch(e){if(e.code==='ENOENT')return null;throw e;}};
  // One caller: its own chain, each of its dependencies a stop, its locks its own (they fall if it dies).
  function caller(id) {
    const stop=()=>new Promise(go=>{if(dead.has(id))return;waiting.set(id,go);wake?.();});
    const lock=async(dir,task)=>{if(locks.has(dir))throw new AppError('BUSY','Another local operation is in progress.');locks.set(dir,id);try{return await task();}finally{if(locks.get(dir)===id)locks.delete(dir);}};
    const gated=fn=>async(...args)=>{await stop();return fn(...args);};
    const invoke=async(file,args)=>{
      await stop();
      if(args[0]==='run'){
        const labels=Object.fromEntries(args.flatMap((a,i)=>a==='--label'?[args[i+1].split(/=(.*)/s).slice(0,2)]:[])),ticket=labels['fabrique-console.ticket'],launch=labels['fabrique-console.launch'],lane=await laneNow();
        check([...locks.entries()].some(([dir,who])=>who===id&&dir.includes('devlane')),'a dev was asked of the core outside the lock of the mission');
        check(lane&&lane.ticket===ticket&&String(lane.launch)===launch&&lane.tab==='asked','a dev was asked of the core for '+ticket+'#'+launch+' while the lane was '+JSON.stringify(lane));
        check(alive(t).length===0,'a dev was asked of the core while '+alive(t).map(x=>x.labels['fabrique-console.ticket']).join(',')+' was alive');
        check(!(askedOnce.has(ticket+'#'+launch)&&id.startsWith('watcher')||askedOnce.has(ticket+'#'+launch)&&id.startsWith('settle')),'the watcher asked again for '+ticket+'#'+launch+', asked before and not seen');
        askedOnce.add(ticket+'#'+launch);
      }
      return t.core.invoke(file,args);
    };
    const chain=t.make({lock,wait:async()=>{at.now+=1000;await stop();},invoke,herdr:t.core.through(invoke),detail:gated(async()=>({issue:t.issue})),
      reports:gated(async()=>({reports:t.reports.map(r=>({...r})),command:"'node' '/r.mjs'"})),ensureWorktree:gated(async()=>({path:'/wt',branch:'xj-1',base:'release/x',created:[],rebased:[],command:"'node' '/r.mjs'"})),
      ticketBranch:gated(async({ticket})=>({path:'/wt-'+ticket,branch:'b',issueBranch:'xj-1'})),ticketMerge:gated(async()=>({status:'merged',merged:[{repo:'.'}]}))});
    return {id,chain,stop};
  }
  const tasks=[];
  const start=(id,work)=>{const c=caller(id),task={id,done:false};task.promise=(async()=>{await c.stop();return work(c.chain);})().then(()=>{},e=>{task.error=e;}).finally(()=>{task.done=true;if(running===id)wake?.();});tasks.push(task);};
  const events=[];let n=0;
  const add=op=>{
    const id=op+'#'+(++n);
    if(op==='launch')start(id,c=>c.launch(from({tickets:[FG2,FG3]})));
    else if(op==='relaunch')start(id,c=>c.launch(from({resume:true,tickets:[pick([FG2,FG3])]})));
    else if(op==='watcher')start(id,c=>c.tickAll());
    else events.push(op);
  };
  const fire=op=>{
    if(op==='merge'){const held=alive(t)[0]?.labels['fabrique-console.ticket']||pick(['XJ-2','XJ-3']);if(!t.reports.some(r=>r.ticket===held))accept(t,held,held==='XJ-2'?'a':'b','10');}
    else if(op==='cancel')t.issue.children[0].state={type:'canceled'};
    else if(op==='reopen')t.issue.children[0].state={type:'unstarted'};
    else if(op==='lost'){let once=true;t.core.faults.run=()=>{if(!once)return null;once=false;return pick(['lost','mute']);};}
    else if(op==='deaf'){let left=2;t.core.faults.kill=()=>left-->0?'stays':null;}
    else if(op==='crash'){const live=tasks.filter(x=>!x.done&&!dead.has(x.id)&&waiting.has(x.id));if(live.length){const victim=pick(live).id;dead.add(victim);waiting.delete(victim);for(const [dir,who] of locks)if(who===victim)locks.delete(dir);}}
  };
  const invariants=async step=>{
    const devsNow=alive(t),lane=await laneNow();
    check(devsNow.length<=1,'two devs alive: '+devsNow.map(x=>x.labels['fabrique-console.ticket']+'#'+x.labels['fabrique-console.launch']).join(', '));
    if(devsNow.length){check(lane!==null,'a dev alive ('+devsNow[0].labels['fabrique-console.ticket']+') while the lane is free');check(!lane||lane.ticket===devsNow[0].labels['fabrique-console.ticket'],'the dev alive is '+devsNow[0].labels['fabrique-console.ticket']+', the lane is '+lane?.ticket);}
    if(problems.length)assert.fail(note+' seed '+seed+' ops '+ops.join(',')+' step '+step+': '+problems.join(' ; '));
  };
  try{
    // A start drawn too: nothing launched, a dev at work and seen, or a dev dead.
    const before=pick(['fresh','working','dead']);
    if(before!=='fresh'){await t.chain.launch(from({tickets:[FG2]}));await t.chain.tick(M);if(before==='dead')t.core.end(alive(t)[0]);}
    for(const op of ops)add(op);
    let step=0;
    for(;;){
      const ready=[...waiting.keys()],choices=[...ready.map(id=>['go',id]),...events.map((op,i)=>['event',i])];
      if(!choices.length)break;
      if(++step>4000)assert.fail(note+' seed '+seed+': no end');
      const [kind,what]=pick(choices);
      if(kind==='event')fire(events.splice(what,1)[0]);
      else{const go=waiting.get(what);waiting.delete(what);running=what;const reached=new Promise(done=>{wake=done;});go();await reached;wake=null;running=null;}
      await invariants(step);
    }
    // The passes that follow, one after the other: the invariant holds to the end.
    for(let i=0;i<3;i++){start('settle#'+i,c=>c.tickAll());for(;;){const [id]=[...waiting.keys()];if(!id)break;const go=waiting.get(id);waiting.delete(id);running=id;const reached=new Promise(done=>{wake=done;});go();await reached;wake=null;running=null;await invariants('settle');}}
    return {ops,alive:alive(t).length};
  }finally{await t.cleanup();}
}

test('interleavings — every pair of operations, in both orders, under several seeds: one dev alive at most, and never one asked outside the rules', async()=>{
  const seeds=Number(process.env.FABRIQUE_CONSOLE_LANE_PAIR_SEEDS||2);let runs=0;
  for(const a of OPS)for(const b of OPS)for(let s=1;s<=seeds;s++){await play(1000*s+OPS.indexOf(a)*8+OPS.indexOf(b),[a,b],'pair');runs++;}
  assert.equal(runs,OPS.length*OPS.length*seeds);
});

test('interleavings — three operations drawn by a seed that is shown, as many times as FABRIQUE_CONSOLE_LANE_DRAWS says', async t=>{
  const draws=Number(process.env.FABRIQUE_CONSOLE_LANE_DRAWS||60),base=Number(process.env.FABRIQUE_CONSOLE_LANE_SEED||20261113);
  t.diagnostic('seed '+base+', '+draws+' draws');
  const rand=rng(base);
  for(let i=0;i<draws;i++){
    const seed=Math.floor(rand()*2**31),ops=[0,1,2].map(()=>OPS[Math.floor(rand()*OPS.length)]);
    await play(seed,ops,'draw '+i+' of base '+base);
  }
});
