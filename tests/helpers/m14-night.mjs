// Ticket M14: a mission whose chain accepts XJ-2 during the night (real chain, reports and git), shared by
// tests/m14-since-visit.test.mjs and the page probe (tests/helpers/ticket-visit-probe.mjs). `after` registers a cleanup.
// `engine()` builds the mission actions afresh on the same folder: the tool started again.
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createMissionActions } from '../../src/mission.mjs';
import { createQuestionRegistry } from '../../src/questions.mjs';
import { createRequestRegistry } from '../../src/requests.mjs';
import { writeDevReport } from '../../src/dev-report.mjs';
import { createDevFlow } from '../../src/dev-flow.mjs';
import { setup, leadMission, FG2 } from './dev-chain-setup.mjs';

export const MIN=60000,HOUR=60*MIN,T0=Date.parse('2026-11-14T18:00:00.000Z'),iso=ms=>new Date(ms).toISOString();
export const clockOf=start=>{const c={t:start,step:1000};c.now=()=>(c.t+=c.step);c.at=ms=>{c.t=ms;};return c;};

async function reportFolder(after){
  const path=await realpath(await mkdtemp(join(tmpdir(),'fabrique-console-m14-')));after(()=>rm(path,{recursive:true,force:true}));
  const git=async args=>(await promisify(execFile)('git',['-C',path,...args],{encoding:'utf8',shell:false})).stdout.trim();
  await git(['init','-b','xj-1']);await git(['config','user.name','Fixture']);await git(['config','user.email','fixture@example.invalid']);
  const commit=async message=>{await git(['commit','--allow-empty','-m',message]);return git(['rev-parse','HEAD']);};
  const write=(...args)=>writeDevReport([...args,'--worktree',path,'--ticket','XJ-2','--summary','x']);
  return {path,commit,dev:sha=>write('dev','--commit',sha),review:(n,sha,verdict)=>write('review','--n',String(n),'--commit',sha,'--verdict',verdict)};
}
export async function night(after){
  const f=await reportFolder(after);let flow;
  const c=clockOf(T0),t=await setup({now:()=>c.now(),reports:input=>flow.reports(input)},{worktree:f.path});
  flow=createDevFlow({loadState:async()=>({sessions:[t.session]})});
  after(()=>t.cleanup());
  const {missions}=await leadMission(t.root);
  const engine=()=>{const questions=createQuestionRegistry({root:t.root});return createMissionActions({root:t.root,now:()=>c.t,registry:missions,questions,chain:t.chain,inbox:createRequestRegistry({root:t.root,questions,missions}),loadState:async()=>({sessions:[t.session]}),window:t.core.herdr.window,loadConfig:async()=>({})});};
  const accept=async()=>{
    c.at(T0+HOUR);await t.chain.launch({sessionId:'s1',tickets:[FG2]});
    const a=await f.commit('one');
    c.at(T0+2*HOUR);await f.dev(a);await t.chain.tick({sessionId:'s1'});
    c.at(T0+3*HOUR);await f.review(1,a,'accepted');await t.chain.tick({sessionId:'s1'});
  };
  return {t,c,engine,accept,missions};
}
