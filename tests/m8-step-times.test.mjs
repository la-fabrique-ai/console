import test from 'node:test';
import assert from 'node:assert/strict';
import { timingsOf } from '../src/dev-chain.mjs';
import { createMissionActions } from '../src/mission.mjs';
import { setup, FG2 } from './helpers/dev-chain-setup.mjs';
import { desk } from './helpers/requests.mjs';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeDevReport } from '../src/dev-report.mjs';
import { createDevFlow } from '../src/dev-flow.mjs';

// Ticket M8: the time of each step of a ticket (dev, review, fix, review again), measured by the chain from the marks
// it keeps for good (src/dev-chain.mjs), read by the page through mission-read (`timings`, simulation/CONTRAT.md § 2).
// A step whose start or end nobody knows has no time; a watcher started again keeps the start of a step and counts it
// once.

const MIN=60000,T0=Date.parse('2026-11-14T09:00:00.000Z'),A='a'.repeat(40),B='b'.repeat(40);
const dev=(commit,at)=>({ticket:'XJ-2',kind:'dev',commit,repo:'admin',summary:'fait',at});
const review=(n,commit,verdict,at)=>({ticket:'XJ-2',kind:'review-'+n,commit,verdict,summary:'x',at});
// The steps alone, without the delivery each one belongs to (decision 90, tested on its own below).
const bare=list=>list.map(({step,minutes})=>({step,minutes}));

test('the steps of a ticket and their times, from the marks of the chain: dev, review 1, fix, review 1 again',()=>{
  const d1='2026-11-14T09:38:00.000Z',d2='2026-11-14T10:00:00.000Z';
  const done={'dev|XJ-2':T0,['done|XJ-2|'+A+'|'+d1]:T0+38*MIN,['rev|XJ-2|'+A+'|'+d1+'|1']:T0+38*MIN,['verdict|XJ-2|'+A+'|'+d1+'|1']:T0+44*MIN,['fix|XJ-2|'+A+'|'+d1]:T0+44*MIN,
    ['done|XJ-2|'+B+'|'+d2]:T0+56*MIN,['rev|XJ-2|'+B+'|'+d2+'|1']:T0+56*MIN,['verdict|XJ-2|'+B+'|'+d2+'|1']:T0+61*MIN,['ok|XJ-2|'+B]:T0+61*MIN};
  const reports=[dev(A,d1),review(1,A,'changes_requested','2026-11-14T09:44:00.000Z'),dev(B,d2),review(1,B,'accepted','2026-11-14T10:05:00.000Z')];
  assert.deepEqual(bare(timingsOf(done,reports,{now:T0+90*MIN})['XJ-2']),[{step:'dev',minutes:38},{step:'review-1',minutes:6},{step:'fix',minutes:12},{step:'review-1',minutes:5}]);
});

test('the steps survive the reports being replaced: only the last delivery and its last verdicts are on disk (M8 review)',()=>{
  // As the agents write them (src/dev-report.mjs): one <ticket>.dev.json and one <ticket>.review-1.json, each replaced
  // at every round. The steps of the rounds before come from the marks of the chain alone.
  const d1='2026-11-14T09:38:00.000Z',d2='2026-11-14T10:00:00.000Z';
  const done={'dev|XJ-2':T0,['done|XJ-2|'+A+'|'+d1]:T0+38*MIN,['rev|XJ-2|'+A+'|'+d1+'|1']:T0+38*MIN,['verdict|XJ-2|'+A+'|'+d1+'|1']:T0+44*MIN,['fix|XJ-2|'+A+'|'+d1]:T0+44*MIN,
    ['done|XJ-2|'+B+'|'+d2]:T0+56*MIN,['rev|XJ-2|'+B+'|'+d2+'|1']:T0+56*MIN,['verdict|XJ-2|'+B+'|'+d2+'|1']:T0+61*MIN,['ok|XJ-2|'+B]:T0+61*MIN};
  assert.deepEqual(bare(timingsOf(done,[dev(B,d2),review(1,B,'accepted','2026-11-14T10:05:00.000Z')],{now:T0+90*MIN})['XJ-2']),[{step:'dev',minutes:38},{step:'review-1',minutes:6},{step:'fix',minutes:12},{step:'review-1',minutes:5}]);
  // Round 2 under review: the file of review 1 still holds the verdict of round 1, the dev file the second delivery.
  const reading={...done};delete reading['verdict|XJ-2|'+B+'|'+d2+'|1'];delete reading['ok|XJ-2|'+B];
  assert.deepEqual(bare(timingsOf(reading,[dev(B,d2),review(1,A,'changes_requested','2026-11-14T09:44:00.000Z')],{now:T0+60*MIN})['XJ-2']),[{step:'dev',minutes:38},{step:'review-1',minutes:6},{step:'fix',minutes:12},{step:'review-1',minutes:4}]);
  // The corrections never sent (the message failed, its marks put back), then a new delivery all the same: the fix
  // happened, nobody knows from when.
  const failed={'dev|XJ-2':T0,['done|XJ-2|'+A+'|'+d1]:T0+38*MIN,['rev|XJ-2|'+A+'|'+d1+'|1']:T0+38*MIN,['verdict|XJ-2|'+A+'|'+d1+'|1']:T0+44*MIN,['done|XJ-2|'+B+'|'+d2]:T0+56*MIN,['rev|XJ-2|'+B+'|'+d2+'|1']:T0+56*MIN};
  assert.deepEqual(bare(timingsOf(failed,[dev(B,d2),review(1,A,'changes_requested','2026-11-14T09:44:00.000Z')],{now:T0+60*MIN})['XJ-2']),[{step:'dev',minutes:38},{step:'review-1',minutes:6},{step:'fix',minutes:null},{step:'review-1',minutes:4}]);
});

test('a step under way runs to now; a review not judged yet comes last, and only for the last delivery',()=>{
  assert.deepEqual(bare(timingsOf({'dev|XJ-2':T0},[],{now:T0+12*MIN+30000})['XJ-2']),[{step:'dev',minutes:12}],'in dev for 12 min (screen 38)');
  const d1='2026-11-14T09:38:00.000Z';
  const done={'dev|XJ-2':T0,['done|XJ-2|'+A+'|'+d1]:T0+38*MIN,['rev|XJ-2|'+A+'|'+d1+'|1']:T0+38*MIN,['verdict|XJ-2|'+A+'|'+d1+'|1']:T0+44*MIN,['fix|XJ-2|'+A+'|'+d1]:T0+44*MIN};
  assert.deepEqual(bare(timingsOf(done,[dev(A,d1),review(1,A,'changes_requested','2026-11-14T09:44:00.000Z')],{now:T0+50*MIN})['XJ-2']),[{step:'dev',minutes:38},{step:'review-1',minutes:6},{step:'fix',minutes:6}],'fixing for 6 min');
  // A review launched on a delivery the dev replaced before its verdict: no step (the page draws none either).
  const d2='2026-11-14T09:40:00.000Z',again={'dev|XJ-2':T0,['done|XJ-2|'+A+'|'+d1]:T0+38*MIN,['rev|XJ-2|'+A+'|'+d1+'|1']:T0+38*MIN,['done|XJ-2|'+B+'|'+d2]:T0+40*MIN,['rev|XJ-2|'+B+'|'+d2+'|1']:T0+40*MIN};
  assert.deepEqual(bare(timingsOf(again,[dev(A,d1),dev(B,d2)],{now:T0+47*MIN})['XJ-2']),[{step:'dev',minutes:38},{step:'review-1',minutes:7}]);
});

test('a step whose start or end nobody knows has no time: nothing is invented',()=>{
  // Work taken up from its reports (marks without a time): the steps are there, none has a time.
  const d1='2026-11-14T09:38:00.000Z';
  const taken={'dev|XJ-2':true,['done|XJ-2|'+A+'|'+d1]:true,['rev|XJ-2|'+A+'|'+d1+'|1']:true};
  assert.deepEqual(bare(timingsOf(taken,[dev(A,d1)],{now:T0})['XJ-2']),[{step:'dev',minutes:null},{step:'review-1',minutes:null}]);
  // A review judged with no mark of its launch, a fix never sent: no time for them; the dev keeps its own.
  const done={'dev|XJ-2':T0,['done|XJ-2|'+A+'|'+d1]:T0+38*MIN};
  assert.deepEqual(bare(timingsOf(done,[dev(A,d1),review(1,A,'changes_requested','2026-11-14T09:44:00.000Z')],{now:T0+50*MIN})['XJ-2']),[{step:'dev',minutes:38},{step:'review-1',minutes:null},{step:'fix',minutes:null}]);
  // A ticket never launched, with no report: no line at all. A time that goes back gives none.
  assert.deepEqual(timingsOf({},[],{now:T0}),{});
  assert.deepEqual(bare(timingsOf({'dev|XJ-2':T0+5*MIN},[],{now:T0})['XJ-2']),[{step:'dev',minutes:null}]);
});

test('a strong ticket: its two reviews, each with its own end',()=>{
  const d1='2026-11-14T09:30:00.000Z';
  const done={'dev|XJ-2':T0,['done|XJ-2|'+A+'|'+d1]:T0+30*MIN,['rev|XJ-2|'+A+'|'+d1+'|1']:T0+30*MIN,['rev|XJ-2|'+A+'|'+d1+'|2']:T0+30*MIN,
    ['verdict|XJ-2|'+A+'|'+d1+'|1']:T0+36*MIN,['verdict|XJ-2|'+A+'|'+d1+'|2']:T0+45*MIN,['ok|XJ-2|'+A]:T0+45*MIN};
  const reports=[dev(A,d1),review(1,A,'accepted','2026-11-14T09:36:00.000Z'),review(2,A,'accepted','2026-11-14T09:45:00.000Z')];
  assert.deepEqual(bare(timingsOf(done,reports,{now:T0+60*MIN})['XJ-2']),[{step:'dev',minutes:30},{step:'review-1',minutes:6},{step:'review-2',minutes:15}]);
  // Review 2 still reading: review 1 judged, review 2 under way, last.
  const reading={...done};delete reading['verdict|XJ-2|'+A+'|'+d1+'|2'];delete reading['ok|XJ-2|'+A];
  assert.deepEqual(bare(timingsOf(reading,reports.slice(0,2),{now:T0+40*MIN})['XJ-2']),[{step:'dev',minutes:30},{step:'review-1',minutes:6},{step:'review-2',minutes:10}]);
});

// The clock of a test: each reading moves it on by a second (the chain reads it many times in a pass), `at` sets it.
const clockOf=start=>{const c={t:start,step:1000};c.now=()=>(c.t+=c.step);c.at=ms=>{c.t=ms;};return c;};
// The minutes between two lines of the journal, as the page writes them (HH:MM).
const hm=s=>{const [h,m]=s.split(':').map(Number);return h*60+m;};
const between=(log,from,to)=>{const a=log.find(l=>from.test(l.text)),b=log.find(l=>to.test(l.text)&&log.indexOf(l)>log.indexOf(a));return (hm(b.at)-hm(a.at)+1440)%1440;};
const lines=(log,re)=>log.filter(l=>re.test(l.text));

// A worktree of the issue with its own git, where the reports are written by the command of the agents
// (src/dev-report.mjs, each file replaced at every round) and read back as the backend reads them (src/dev-flow.mjs).
async function reportFolder(t){
  const path=await realpath(await mkdtemp(join(tmpdir(),'fabrique-console-m8-')));t.after(()=>rm(path,{recursive:true,force:true}));
  const git=async args=>(await promisify(execFile)('git',['-C',path,...args],{encoding:'utf8',shell:false})).stdout.trim();
  await git(['init','-b','xj-1']);await git(['config','user.name','Fixture']);await git(['config','user.email','fixture@example.invalid']);
  const commit=async message=>{await git(['commit','--allow-empty','-m',message]);return git(['rev-parse','HEAD']);};
  const write=(...args)=>writeDevReport([...args,'--worktree',path,'--ticket','XJ-2','--summary','x']);
  return {path,commit,dev:sha=>write('dev','--commit',sha),review:(n,sha,verdict)=>write('review','--n',String(n),'--commit',sha,'--verdict',verdict)};
}

test('a ticket shows dev, review 1, fix, review 1 again, with times that match the hours of the journal, on reports written as the agents write them',async tt=>{
  // The steps start a few seconds before a minute ends: the journal and the times say the same minutes all the same.
  const f=await reportFolder(tt);let flow;
  const c=clockOf(T0+59000),t=await setup({now:()=>c.now(),reports:input=>flow.reports(input)},{worktree:f.path});
  flow=createDevFlow({loadState:async()=>({sessions:[t.session]})});
  try{
    await t.chain.launch({sessionId:'s1',tickets:[FG2]});
    const a=await f.commit('one');
    c.at(T0+38*MIN+57000);await f.dev(a);
    await t.chain.tick({sessionId:'s1'});
    c.at(T0+44*MIN+58000);await f.review(1,a,'changes_requested');
    await t.chain.tick({sessionId:'s1'});
    const b=await f.commit('two');
    c.at(T0+56*MIN+59000);await f.dev(b);
    await t.chain.tick({sessionId:'s1'});
    c.at(T0+61*MIN+59000);await f.review(1,b,'accepted');
    await t.chain.tick({sessionId:'s1'});
    c.step=0;c.at(T0+90*MIN);
    const read=await t.chain.read({sessionId:'s1'}),log=read.log,steps=read.timings['XJ-2'];
    assert.equal(read.reports.filter(r=>r.ticket==='XJ-2').length,2,'one dev file and one review file: each round replaced them');
    assert.deepEqual(steps.map(s=>s.step),['dev','review-1','fix','review-1']);
    const launched=/^XJ-2 lancé/,reported=/^XJ-2 : dev terminé/,reviewed=/^XJ-2 : revue lancée/,fixed=/^XJ-2 : corrections renvoyées/,accepted=/^XJ-2 : accepté/;
    const want=[between(log,launched,reported),between(log,reviewed,fixed),between(log.slice(log.indexOf(lines(log,fixed)[0])),fixed,reported),between(log.slice(log.indexOf(lines(log,reviewed)[1])),reviewed,accepted)];
    assert.deepEqual(steps.map(s=>s.minutes),want,'each time is the difference of its two lines in the journal');
    // The launch is marked once its pass has gone past 09:01, the first verdict past 09:45: the minutes of the journal.
    assert.deepEqual(want,[37,7,12,5]);
  }finally{await t.cleanup();}
});

test('a watcher started again during a step: the step keeps its start and is counted once',async()=>{
  const c=clockOf(T0),t=await setup({now:()=>c.now()});
  try{
    await t.chain.launch({sessionId:'s1',tickets:[FG2]});
    // In dev: the watcher stops, another one starts ten minutes later on the same files.
    c.at(T0+10*MIN);let again=t.make();await again.tick({sessionId:'s1'});
    c.step=0;c.at(T0+12*MIN);
    let read=await again.read({sessionId:'s1'});
    assert.deepEqual(read.timings['XJ-2'],[{step:'dev',minutes:12}],'the dev step started at the launch, not at the restart');
    assert.equal(lines(read.log,/^XJ-2 lancé/).length,1);
    // In review: started again during the review, one reviewer, one review step, its start kept.
    c.step=1000;c.at(T0+38*MIN);t.reports.push(dev(A,'2026-11-09T10:00:00.000Z'));await again.tick({sessionId:'s1'});
    c.at(T0+41*MIN);again=t.make();await again.tick({sessionId:'s1'});await again.tick({sessionId:'s1'});
    c.step=0;c.at(T0+43*MIN);
    read=await again.read({sessionId:'s1'});
    assert.deepEqual(bare(read.timings['XJ-2']),[{step:'dev',minutes:38},{step:'review-1',minutes:5}]);
    assert.equal(lines(read.log,/^XJ-2 : revue lancée/).length,1,'one reviewer');
    assert.equal(t.calls.filter(([cmd,a])=>cmd==='tab.new'&&a.name==='XJ-2 · revue').length,1);
  }finally{await t.cleanup();}
});

test('a dev stopped then launched again on its ticket keeps one dev step, from its first start',async()=>{
  const c=clockOf(T0),t=await setup({now:()=>c.now()});
  try{
    await t.chain.launch({sessionId:'s1',tickets:[FG2]});
    c.at(T0+20*MIN);t.core.end(t.core.live().find(x=>x.labels['fabrique-console.ticket']==='XJ-2'));
    await t.chain.tick({sessionId:'s1'});
    assert.equal((await t.chain.launch({sessionId:'s1',fresh:false,resume:true,tickets:[FG2]})).launched[0].launched,true);
    c.step=0;c.at(T0+25*MIN);
    assert.deepEqual((await t.chain.read({sessionId:'s1'})).timings['XJ-2'],[{step:'dev',minutes:25}]);
  }finally{await t.cleanup();}
});

test('mission-read gives the times of the chain to the page, and nothing when the chain has none',async t=>{
  const f=await desk(t),timings={'XJ-2':[{step:'dev',minutes:12}]};
  const read=chain=>createMissionActions({root:f.root,now:f.now,registry:f.missions,inbox:f.inbox,questions:f.questions,loadState:async()=>({sessions:f.sessions}),chain}).read({mission:'M-1'});
  assert.deepEqual((await read({read:async()=>({on:true,log:[],metrics:{},reports:[],timings})})).timings,timings);
  assert.equal(Object.hasOwn(await read({read:async()=>({on:false,log:[],metrics:{},reports:[]})}),'timings'),false);
});


test('each review and fix names its delivery (commit and time of delivery), the dev step none: the page ties each time to its own round (decision 90)',()=>{
  // A Heavy ticket: round 1 on A, review 1 asks for changes, review 2 accepts; the fix; round 2 on B, both reviews under way.
  const d1='2026-11-14T09:38:00.000Z',d2='2026-11-14T10:00:00.000Z',k1='XJ-2|'+A+'|'+d1,k2='XJ-2|'+B+'|'+d2;
  const done={'dev|XJ-2':T0,['done|'+k1]:T0+38*MIN,['rev|'+k1+'|1']:T0+38*MIN,['rev|'+k1+'|2']:T0+38*MIN,['verdict|'+k1+'|1']:T0+44*MIN,['verdict|'+k1+'|2']:T0+53*MIN,['fix|'+k1]:T0+53*MIN,
    ['done|'+k2]:T0+60*MIN,['rev|'+k2+'|1']:T0+60*MIN,['rev|'+k2+'|2']:T0+61*MIN};
  const reports=[dev(B,d2),review(1,A,'changes_requested','2026-11-14T09:44:00.000Z'),review(2,A,'accepted','2026-11-14T09:53:00.000Z')];
  assert.deepEqual(timingsOf(done,reports,{now:T0+64*MIN})['XJ-2'],[{step:'dev',minutes:38},
    {step:'review-1',minutes:6,commit:A,delivered:d1,verdict:'changes_requested'},{step:'review-2',minutes:15,commit:A,delivered:d1,verdict:'accepted'},{step:'fix',minutes:7,commit:A,delivered:d1},
    {step:'review-1',minutes:4,commit:B,delivered:d2},{step:'review-2',minutes:3,commit:B,delivered:d2}]);
});
