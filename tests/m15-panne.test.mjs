import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createTicketWorktrees } from '../src/ticket-worktree.mjs';
import { createMissionRegistry } from '../src/mission.mjs';
import { createQuestionRegistry } from '../src/questions.mjs';
import { createRequestRegistry } from '../src/requests.mjs';
import { setup, planTicket, devRun, devRuns, news, FG2 } from './helpers/dev-chain-setup.mjs';

const command=promisify(execFile),M={mission:'M-1'},MIN=60000;
const git=async(path,args)=>(await command('git',['-C',path,...args],{shell:false})).stdout.trimEnd();

// The same fake core as dev-series; real files, commits and ticket-worktree preparation.
// Restarting makes a new chain backend, with the same durable root, never a reset/forget of the old instance.
async function fixture(){
  let t,worktrees;
  const clock={now:Date.parse('2026-11-17T09:00:00Z')};
  t=await setup({now:()=>clock.now++,ticketBranch:input=>worktrees.prepare(input),
    ensureWorktree:async()=>({path:t.session.worktree,branch:'xj-1',created:[],rebased:[],command:"'node' '/r.mjs'"})},
  {role:'lead'},{plan:[planTicket('XJ-2',1)]});
  const issue=join(t.root,'XJ-1');await mkdir(issue);
  await git(issue,['init','-b','xj-1']);
  await git(issue,['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','--allow-empty','-m','base']);
  Object.assign(t.session,{worktree:issue,branch:'xj-1'});
  worktrees=createTicketWorktrees({root:t.root,invoke:(file,args,options)=>command(file,args,{...options,shell:false}),loadState:async()=>({sessions:[t.session]})});
  const requests=createRequestRegistry({root:t.root,questions:createQuestionRegistry({root:t.root}),missions:createMissionRegistry({root:t.root})});
  const inbox=()=>requests.list(M);
  const check=async()=>{
    assert.ok(t.core.live().length<=1,'at most one live dev');
    assert.ok(t.agents.filter(a=>a.tab_name==='XJ-2 · revue'&&a.status!==null).length<=1,'at most one live reviewer');
    const messages=t.sent.map(x=>JSON.stringify([x.terminal,x.text]));
    assert.equal(new Set(messages).size,messages.length,'no message delivered twice');
    const cards=await inbox();
    assert.equal(new Set(cards.map(c=>[c.type,c.cause,c.ticket,c.question].join('|'))).size,cards.length,'no duplicate Inbox card');
    const mission=await createMissionRegistry({root:t.root}).read('M-1');
    assert.equal(new Set((mission.tickets||[]).map(x=>x.id)).size,(mission.tickets||[]).length,'no duplicate ticket card');
  };
  const pass=async()=>{assert.deepEqual(await t.chain.tickAll(),{missions:[{mission:'M-1',ran:true}]});await check();};
  const restart=()=>{t.chain=t.make();};
  await t.chain.launch({...M,fresh:false,tickets:[FG2]});await pass();
  const path=devRun(t.calls,'XJ-2').cwd;
  await writeFile(join(path,'work.txt'),'committed work\n');await git(path,['add','work.txt']);
  await git(path,['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-m','work before interruption']);
  const commit=await git(path,['rev-parse','HEAD']);
  await writeFile(join(path,'work.txt'),'pending tracked work\n');
  await writeFile(join(path,'draft.txt'),'untracked draft\n');
  const preserved=async()=>{
    assert.equal(await git(path,['rev-parse','HEAD']),commit,'the interrupted dev keeps its commit');
    assert.equal(await git(path,['show','HEAD:work.txt']),'committed work');
    assert.equal(await readFile(join(path,'work.txt'),'utf8'),'pending tracked work\n');
    assert.equal(await readFile(join(path,'draft.txt'),'utf8'),'untracked draft\n');
    assert.equal(devRun(t.calls,'XJ-2').cwd,path,'resume uses the original worktree');
  };
  const report=()=>t.reports.push({ticket:'XJ-2',kind:'dev',commit,repo:'.',summary:'fait',at:new Date(clock.now).toISOString()});
  return {t,clock,pass,restart,inbox,preserved,report,commit};
}

for(const phase of ['dev','review'])test('M15 — killed '+phase+', watcher restart and automatic recovery, three consecutive runs',async()=>{
  for(let run=1;run<=3;run++){
    const f=await fixture(),{t}=f;
    try{
      let victim;
      if(phase==='dev')victim=t.core.live()[0];
      else{f.report();await f.pass();await f.pass();victim=t.tab('XJ-2 · revue');}
      assert.equal(victim.status,'working');
      if(phase==='dev')await t.core.invoke('hc',['kill',victim.address,'--json']);
      else await t.core.herdr.window.run('tab.close',{id:victim.tab,confirmed:true});
      f.restart();f.clock.now+=2*MIN;
      await f.pass();await f.pass();await f.preserved();
      if(phase==='dev'){
        assert.equal(devRuns(t.calls,'XJ-2'),2,'run '+run+': one automatic resume after the proven stop');
        assert.notEqual(t.core.live()[0]?.address,victim.address);
        f.report();await f.pass();await f.pass();
      }else{
        assert.equal(news(t.calls).filter(n=>n==='XJ-2 · revue').length,2,'run '+run+': one replacement reviewer');
        assert.notEqual(t.tab('XJ-2 · revue')?.address,victim.address);
        assert.equal(devRuns(t.calls,'XJ-2'),1,'review interruption never restarts the dev');
      }
      // A delivered finding survives another restart and is sent to the dev only once.
      t.reports.push({ticket:'XJ-2',kind:'review-1',commit:f.commit,verdict:'changes_requested',summary:'corriger X',at:new Date(f.clock.now).toISOString()});
      await f.pass();f.restart();await f.pass();await f.pass();
      assert.equal(t.sent.filter(x=>/XJ-2\.review-1\.json/.test(x.text)).length,1);
      await f.preserved();assert.deepEqual(await f.inbox(),[]);
    }finally{await t.cleanup();}
  }
});

for(const phase of ['dev','review'])test('M15 — '+phase+' launch not yet observed: restart signals doubt once and never duplicates work, three consecutive runs',async()=>{
  for(let run=1;run<=3;run++){
    const f=await fixture(),{t}=f;
    try{
      // A killed agent's replacement may have been created, with its answer lost. Until seen, never retry blindly.
      if(phase==='dev'){
        await t.core.invoke('hc',['kill',t.core.live()[0].address,'--json']);
        t.core.faults.run='late';
        await t.chain.launch({...M,fresh:false,resume:true,tickets:[FG2]});
        t.core.faults.run=null;
        // The request can still reach the core: its absent terminal proves no stop.
        f.restart();f.clock.now+=6*MIN;
        for(let i=0;i<3;i++){
          await f.pass();
          assert.equal(devRuns(t.calls,'XJ-2'),1);await f.preserved();
        }
        const cards=(await f.inbox()).filter(c=>c.cause==='dev');
        assert.equal(cards.length,1,'run '+run+': one card explains the uncertain dev');
        assert.equal(cards[0].ticket,'XJ-2');assert.ok(cards[0].text);assert.ok(cards[0].recommendation);
        t.core.arrive();await f.pass();await f.pass();
        assert.equal(devRuns(t.calls,'XJ-2'),2);
        assert.equal((await f.inbox()).filter(c=>c.cause==='dev'&&c.state!=='resolved').length,0);
      }else{
        f.report();t.core.faults.do=cmd=>cmd==='tab.new'?'lost':null;
        await f.pass();t.core.faults.do=null;
        t.core.faults.hidden=a=>a.tab_name==='XJ-2 · revue';
        f.restart();f.clock.now+=6*MIN;
        for(let i=0;i<3;i++)await f.pass();
        const cards=(await f.inbox()).filter(c=>c.cause==='reviewer');
        assert.equal(cards.length,1,'run '+run+': one card explains the uncertain reviewer');
        assert.equal(cards[0].ticket,'XJ-2');assert.ok(cards[0].text);assert.ok(cards[0].recommendation);
        assert.equal(news(t.calls).filter(n=>n==='XJ-2 · revue').length,1);
        t.core.faults.hidden=null;await f.pass();await f.pass();
        assert.equal((await f.inbox()).filter(c=>c.cause==='reviewer'&&c.state!=='resolved').length,0);
      }
      await f.preserved();
    }finally{await t.cleanup();}
  }
});

// A process stop does not answer a question, lift a block or bypass a review.
for(const hold of ['pause','question','block','review'])test('M15 — a proven dev stop still respects '+hold,async()=>{
  const f=await fixture(),{t}=f;
  try{
    if(hold==='pause')await t.chain.pause(M);
    if(hold==='question')t.reports.push({ticket:'XJ-2',kind:'ask',name:'XJ-2.ask-1.json',from:'dev',question:'Quelle règle appliquer ?',at:new Date(f.clock.now).toISOString()});
    if(hold==='block')t.reports.push({ticket:'XJ-2',kind:'block',name:'XJ-2.block-1.json',reason:'Donnée attendue',at:new Date(f.clock.now).toISOString()});
    if(hold==='review'){f.report();await f.pass();await f.pass();}
    await t.core.invoke('hc',['kill',t.core.live()[0].address,'--json']);
    f.restart();f.clock.now+=2*MIN;
    await f.pass();await f.pass();await f.preserved();
    assert.equal(devRuns(t.calls,'XJ-2'),1,'the outstanding '+hold+' prevents automatic dev recovery');
  }finally{await t.cleanup();}
});

// M15 review: a dev that dies again after its automatic resume is not resumed a second time; the journal says so once.
test('M15 — a dev that stops again after its automatic resume waits for the user, said once',async()=>{
  const f=await fixture(),{t}=f;
  try{
    for(let death=1;death<=3;death++){
      if(t.core.live()[0])await t.core.invoke('hc',['kill',t.core.live()[0].address,'--json']);
      f.clock.now+=2*MIN;await f.pass();await f.pass();
    }
    assert.equal(devRuns(t.calls,'XJ-2'),2,'one automatic resume only');
    assert.equal(t.core.live().length,0,'nothing relaunched after the second stop');
    const log=(await t.chain.read(M)).log.filter(e=>/plus relancé/.test(e.text));
    assert.equal(log.length,1,'said once');
  }finally{await t.cleanup?.();}
});

// M15 review 2: an automatic resume that asks nothing of the core (here, its worktree fails) does not use up the resume.
test('M15 — a resume that never reached the core does not use up the automatic resume',async()=>{
  const f=await fixture(),{t}=f;
  try{
    let fail=true;
    await t.core.invoke('hc',['kill',t.core.live()[0].address,'--json']);
    const real=t.chain;t.chain=t.make({ticketBranch:async()=>{if(fail)throw Object.assign(new Error('worktree busy'),{code:'WORKTREE_FAILED'});}});
    f.clock.now+=2*MIN;await t.chain.tickAll();
    assert.equal(devRuns(t.calls,'XJ-2'),1,'nothing launched while the worktree fails');
    t.chain=real;fail=false;f.clock.now+=2*MIN;await f.pass();
    assert.equal(devRuns(t.calls,'XJ-2'),2,'the automatic resume is still there');
  }finally{await t.cleanup?.();}
});
