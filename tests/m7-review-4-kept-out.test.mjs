import test from 'node:test';
import assert from 'node:assert/strict';
import { TWO, setup, leadMission, devRuns, news, FG2 } from './helpers/dev-chain-setup.mjs';
import { asScreen } from './helpers/versions.mjs';
import { createMissionActions } from '../src/mission.mjs';
import { createMissionRegistry } from '../src/mission.mjs';
import { createQuestionRegistry, createQuestionActions } from '../src/questions.mjs';
import { createRequestRegistry } from '../src/requests.mjs';

// The fifth round of M7 (decision 86, rule 1): the dev of a ticket kept out is stopped only on a turn proven over
// (idle, done, blocked) or a terminal gone; its status is read again right before the stop, after every answer the
// conversation delivered; unknown, error, or a status read before an answer was delivered: it waits.
const T0=Date.parse('2026-11-14T10:00:00Z');
const screenOf=t=>{
  const questions=createQuestionRegistry({root:t.root}),inbox=createRequestRegistry({root:t.root,questions,missions:t.registry});
  return createMissionActions({root:t.root,now:()=>T0,registry:t.registry,questions,chain:t.chain,inbox,loadState:async()=>({sessions:[t.session]}),window:t.core.herdr.window,loadConfig:async()=>({}),send:async()=>({sent:true})});
};
const report=(t,ticket,kind,c,hour,more={})=>t.reports.push({ticket,kind,commit:c.repeat(40),repo:'admin',summary:'fait',at:'2026-11-09T'+hour+':00:00.000Z',...more});
const devStatus=(t,ticket,status)=>{for(const a of t.agents)if(String(a.tab_name).startsWith(ticket))a.status=status;};
const devOf=(t,ticket)=>t.agents.find(a=>String(a.tab_name).startsWith(ticket+' ·'))||null;
const ticks=async(t,n=3)=>{for(let i=0;i<n;i++)await t.chain.tick({sessionId:'s1'});};
const qa=t=>news(t.calls).filter(x=>x==='QA · XJ-1').length;

// XJ-2 accepted and merged, XJ-3 launched and working; `before` runs before XJ-3 is removed from the plan; then the
// plan is saved without XJ-3 and reapproved: XJ-3 is kept out, its dev still running.
const keptOut=async(t,{before=async()=>{}}={})=>{
  t.registry=(await leadMission(t.root)).missions;
  const screen=screenOf(t);
  assert.ok((await t.chain.launch({mission:'M-1',fresh:false,tickets:[FG2]})).launched[0].launched);
  report(t,'XJ-2','dev','a','10');report(t,'XJ-2','review-1','a','10',{verdict:'accepted',summary:'ok'});devStatus(t,'XJ-2','idle');
  await ticks(t);
  assert.equal(devRuns(t.calls,'XJ-3'),1,'XJ-3 was launched');
  devStatus(t,'XJ-3','working');
  await ticks(t,1);
  await before();
  await screen.savePlan({mission:'M-1',plan:{tickets:[TWO[0]]}});
  await ticks(t,1);
  const seen=await screen.read({mission:'M-1'});
  await screen.reapprove({mission:'M-1',seen:seen.driftSeen});
  assert.ok((await t.registry.read('M-1')).approval.outside.includes('XJ-3'));
};
// Its turn proven over afterwards: it is stopped and the QA starts once (the waiting above was not a lock).
const thenStopped=async t=>{
  devStatus(t,'XJ-3','idle');
  await ticks(t,4);
  assert.equal(devOf(t,'XJ-3'),null,'stopped once its turn is proven over');
  assert.equal(qa(t),1,'the QA starts once its dev stopped');
  assert.equal(devRuns(t.calls,'XJ-3'),1,'never launched again');
};

for(const [status,said] of [[null,'unknown'],['error','error']])test('decision 86: the dev of a ticket kept out whose status is '+said+' is never stopped, the delivery waits',async()=>{
  const t=await setup({ticketMerge:async()=>({status:'merged'})});
  try{
    await keptOut(t);
    devStatus(t,'XJ-3',status);
    await ticks(t,4);
    assert.ok(devOf(t,'XJ-3'),'a status '+said+' is no proof that its turn ended: its dev keeps running');
    assert.equal(qa(t),0,'no QA while its dev may still work');
    assert.notEqual((await t.registry.read('M-1')).step,'validating');
    await thenStopped(t);
  }finally{await t.cleanup();}
});

test('decision 86: an answer delivered to the dev of a ticket kept out between the reading of its status and the stop: it waits',async()=>{
  // A real dev starts working on the answer it is given: the fake core does as much.
  const t=await setup({ticketMerge:async()=>({status:'merged'}),send:async x=>{t.sent.push(x);const d=devOf(t,'XJ-3');if(d&&x.terminal===d.address)d.status='working';return {sent:true};}});
  const questions=createQuestionRegistry({root:t.root}),inbox=createRequestRegistry({root:t.root,questions,missions:createMissionRegistry({root:t.root})});
  const actions=asScreen(createQuestionActions({questions,inbox,missions:createMissionRegistry({root:t.root}),launch:t.chain.launch}),inbox);
  try{
    // XJ-3 asks a question and waits for its answer (blocked); the question goes to the Lead.
    await keptOut(t,{before:async()=>{
      t.reports.push({name:'XJ-3.ask-1794000000000.json',ticket:'XJ-3',kind:'ask',at:'2026-11-10T10:00:00.000Z',question:'Quel rôle ?',options:['Garder','Fusionner'],from:'dev'});
      devStatus(t,'XJ-3','blocked');
      await ticks(t,1);
      assert.equal((await questions.list({mission:'M-1'})).length,1,'its question is open');
    }});
    // Kept out, still blocked: the Lead answers; the next pass reads it blocked, then delivers the answer, which the dev
    // takes up: read again right before the stop, it works, and it is not stopped.
    await actions.answer({question:'Q-1',text:'Garde roles.ts'});
    devStatus(t,'XJ-3','blocked');
    const d=devOf(t,'XJ-3');
    await ticks(t,1);
    assert.equal((await questions.read('Q-1')).state,'delivered','the answer reached its dev');
    assert.ok(t.sent.some(x=>x.terminal===d.address),'sent to its terminal');
    assert.ok(devOf(t,'XJ-3'),'a status read before the answer was delivered stops nothing');
    await ticks(t,2);
    assert.ok(devOf(t,'XJ-3'),'working on its answer: never interrupted');
    assert.equal(qa(t),0,'no QA while its dev works');
    await thenStopped(t);
  }finally{await t.cleanup();}
});

test('decision 86: a dev kept out is still stopped on done, on blocked, and when its terminal is gone',async()=>{
  for(const status of ['done','blocked']){
    const t=await setup({ticketMerge:async()=>({status:'merged'})});
    try{
      await keptOut(t);
      devStatus(t,'XJ-3',status);
      await ticks(t,4);
      assert.equal(devOf(t,'XJ-3'),null,status+' is a turn proven over');
      assert.equal(qa(t),1);
    }finally{await t.cleanup();}
  }
  const t=await setup({ticketMerge:async()=>({status:'merged'})});
  try{
    await keptOut(t);
    devStatus(t,'XJ-3','working');
    const dev=t.core.terminals.find(x=>x.labels['fabrique-console.ticket']==='XJ-3'&&x.state==='live');
    t.core.end(dev);
    await ticks(t,4);
    assert.equal(qa(t),1,'a terminal gone frees the lane, and the QA starts');
  }finally{await t.cleanup();}
});
