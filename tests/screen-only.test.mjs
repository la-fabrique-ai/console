import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createBackend } from '../src/backend.mjs';
import { hcRunArgs, resumeArgv } from '../src/agents.mjs';
import { decisionPrompt, missionPrompt, issuePrompt, ticketPrompt } from '../src/pilot.mjs';
import { devArgv, devTask, reviewTask, qaTask, AGENT_MARK, SCREEN_ONLY } from '../ui/v3/view.js';
import { withFakeHerdr } from './helpers/fake-herdr.mjs';

// Decision 70: the approval and the answers « by click » are the commands of the screens. The agents Mission Control
// launches (Lead, devs, reviewers, QA, Pilot) are told they may not use them, carry a mark the tool sets when it starts
// them, and the two commands refuse a request that comes from such a session, before anything is read or written.
const SCREEN=['mission-launch','inbox-answer'];
async function home(t){const root=await realpath(await mkdtemp(join(tmpdir(),'fabrique-console-screen-only-')));t.after(()=>rm(root,{recursive:true,force:true}));return root;}
const backendIn=(root,env)=>createBackend(withFakeHerdr({root,env,exec:async()=>{throw new Error('nothing runs');}}));

test('from a session of an agent the tool launched, mission-launch and inbox-answer are refused and write nothing',async t=>{
  const root=await home(t),backend=backendIn(root,{...process.env,[AGENT_MARK]:'1'});
  for(const [action,input] of [['mission-launch',{mission:'M-1',seen:1}],['inbox-answer',{item:'I-1',choice:'Oui',text:'Oui',seen:'v'}]]) {
    await assert.rejects(()=>backend.dispatch(action,input),e=>e.code==='AGENT_SESSION'&&/réservée au propriétaire dans Mission Control/.test(e.message),action);
  }
  assert.deepEqual(await readdir(root),[],'nothing is written');
});
test('outside a session of an agent, the same commands reach their handler; the other commands are not touched',async t=>{
  const root=await home(t),plain=backendIn(root,Object.fromEntries(Object.entries(process.env).filter(([k])=>k!==AGENT_MARK)));
  await assert.rejects(()=>plain.dispatch('mission-launch',{mission:'M-1',seen:1}),e=>e.code!=='AGENT_SESSION');
  await assert.rejects(()=>plain.dispatch('inbox-answer',{}),e=>e.code!=='AGENT_SESSION');
  const marked=backendIn(await home(t),{...process.env,[AGENT_MARK]:'1'});
  await assert.rejects(()=>marked.dispatch('mission-read',{mission:'M-1'}),e=>e.code!=='AGENT_SESSION','an agent still reads');
});

// The mark goes with the agent itself, as an option of its program: argv[0] stays the agent (the trial maps it by name).
const marked=argv=>{
  if(argv[0]==='claude'){const at=argv.indexOf('--settings');return at>0&&JSON.parse(argv[at+1]).env?.[AGENT_MARK]==='1';}
  if(argv[0]==='codex')return argv.some((a,n)=>a==='-c'&&argv[n+1]===`shell_environment_policy.set.${AGENT_MARK}="1"`);
  return false;
};
const program=args=>args.slice(args.indexOf('--')+1);
test('every agent the tool starts carries the mark: the Lead and Pilot (hc run), the devs, reviewers and QA (devArgv), a resume',()=>{
  for(const tool of ['claude','codex']) {
    assert.ok(marked(program(hcRunArgs({tool,cwd:'/w',prompt:'Bonjour'}))),tool+' launched by hc run');
    assert.ok(marked(program(hcRunArgs({tool,cwd:'/w'}))),tool+' without a prompt');
    assert.ok(marked(devArgv(tool,'m','high','Travaille')),tool+' as a dev, a reviewer or the QA');
    assert.ok(marked(resumeArgv(tool,'abc','Reprends')),tool+' resumed');
    assert.equal(program(hcRunArgs({tool,cwd:'/w',prompt:'Bonjour'})).at(-1),'Bonjour','the prompt stays the last argument');
    assert.equal(devArgv(tool,'m','high','Travaille').at(-1),'Travaille');
  }
});

// What they are told: the one sentence, in every text that starts or guides an agent, and nowhere else the names.
test('every agent is told it may not use the two commands, in one sentence that names them',async()=>{
  assert.match(SCREEN_ONLY,/mission-launch/);assert.match(SCREEN_ONLY,/inbox-answer/);
  const tasks=[devTask('XJ-1','XJ-0','/w'),reviewTask('XJ-1','XJ-0','/w',{},1,'claude'),qaTask('XJ-0','/w',['XJ-1'],'main')];
  for(const text of tasks)assert.ok(text.includes(SCREEN_ONLY),text.slice(0,60));
  for(const name of ['../roles/lead.md','../roles/po.md'])assert.ok((await readFile(new URL(name,import.meta.url),'utf8')).includes(SCREEN_ONLY),name);
  const item={id:'I-1',type:'decision',version:'v1'},dossier={request:{id:'I-1',seen:'v1',type:'decision'},mission:{id:'M-1'}};
  const prompts=[decisionPrompt({role:'ROLE',item,dossier,folder:'/f',cli:'/c.mjs',node:'/n'}),missionPrompt({role:'ROLE',mission:{id:'M-1'},dossier:{waiting:[]},folder:'/f',cli:'/c.mjs',node:'/n'}),
    issuePrompt({role:'ROLE',project:'p',issueId:'XJ-1',dossier:{},folder:'/f',cli:'/c.mjs',node:'/n'}),ticketPrompt({role:'ROLE',project:{key:'p'},folder:'/f',cli:'/c.mjs',node:'/n'})];
  for(const p of prompts)assert.ok((typeof p==='string'?p:p.prompt).includes(SCREEN_ONLY),'Pilot');
});
test('the backend names the two commands of the screens once, in the barrier',async()=>{
  const backend=await readFile(new URL('../src/backend.mjs',import.meta.url),'utf8');
  for(const action of SCREEN)assert.ok(backend.includes(`'${action}'`),action);
  assert.match(backend,/SCREEN_COMMANDS/);
});
