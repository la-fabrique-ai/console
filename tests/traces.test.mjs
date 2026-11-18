import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readdir, readFile, rm, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { agentOf, resumeArgv, hcRunArgs } from '../src/agents.mjs';
import { devArgv, agentMark } from '../ui/v3/view.js';
import { traceArgv, keepTranscript, createTraces, tracedHerdr, noteAgentSession, claudeProjectFolder, TRACE_MARK } from '../src/traces.mjs';
import { setup, FG2, devRun } from './helpers/dev-chain-setup.mjs';
import { fakeHerdr } from './helpers/fake-herdr.mjs';

// M12: the agents the tool starts write their trace, and the tool keeps the link to it (never its content), found again
// from the mission, the ticket, the role and the turn. Facts from the installed programs (2026-11-14, help and binary
// only, no session started): Claude Code 2.1.325 turns its transcript off when it inherits CLAUDE_CODE_CHILD_SESSION,
// unless CLAUDE_CODE_FORCE_SESSION_PERSISTENCE is set, and takes `--session-id <uuid>`; Codex 0.167.2 has no option for
// the id of its session, and gives it to the commands it runs as CODEX_THREAD_ID.
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const THREAD='019a7c1e-5b2d-7c3e-9f00-0123456789ab';
const settingsOf=argv=>JSON.parse(argv[argv.indexOf('--settings')+1]);
const homes=async()=>{
  const base=await mkdtemp(join(tmpdir(),'fabrique-console-traces-'));
  return {base,root:join(base,'mc'),claudeHome:join(base,'claude'),codexHome:join(base,'codex'),done:()=>rm(base,{recursive:true,force:true})};
};
// A session file as the agent would leave it, unreadable: the tool may find it by its name, never open it.
async function sessionFile(path){await mkdir(join(path,'..'),{recursive:true});await writeFile(path,'{"secret":"content of the session"}\n');await chmod(path,0o000);return path;}
// The rollout of a Codex session as Codex names and files it: the local time of its start, to the second (Codex 0.167.2
// takes the local time: « failed to get local time » in its binary).
const pad=n=>String(n).padStart(2,'0');
const stamp=d=>`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
const rolloutOf=(codexHome,d,id)=>join(codexHome,'sessions',String(d.getFullYear()),pad(d.getMonth()+1),pad(d.getDate()),`rollout-${stamp(d)}-${id}.jsonl`);
const reviewer=()=>devArgv('codex','gpt-6.1-sol','high','r');

test('every Claude agent keeps its transcript even when it inherits the marker of a child session; argv[0] stays the agent',async()=>{
  const key='11111111-2222-4333-8444-555555555555',both={FABRIQUE_CONSOLE_AGENT:'1',CLAUDE_CODE_FORCE_SESSION_PERSISTENCE:'1'};
  for(const argv of [agentOf('claude').start('go'),agentOf('claude').start(null),resumeArgv('claude','s-1','go'),devArgv('claude','claude-sonnet-5-5','high','go')]){
    assert.deepEqual(settingsOf(argv).env,{FABRIQUE_CONSOLE_AGENT:'1'},'the mark of the screens is unchanged (ui/v3/view.js)');
    for(const out of [traceArgv(argv,key).argv,keepTranscript(argv)]){
      assert.equal(out[0],'claude');assert.deepEqual(settingsOf(out).env,both);
      assert.equal(out.filter(a=>a==='--settings').length,1,'one settings: its mark and the persistence together');
      if(argv.at(-1)==='go')assert.equal(out.at(-1),'go','the prompt stays the last argument');
    }
  }
  assert.deepEqual(keepTranscript(['claude','go']),['claude','--settings',JSON.stringify({env:{CLAUDE_CODE_FORCE_SESSION_PERSISTENCE:'1'}}),'go']);
  assert.deepEqual(keepTranscript(devArgv('codex','m','high','go')),devArgv('codex','m','high','go'),'Codex has no such marker');
  assert.deepEqual(agentMark('codex'),['-c','shell_environment_policy.set.FABRIQUE_CONSOLE_AGENT="1"']);
  // Through Herdr, store or not, a trace written or not: the transcript is kept.
  const seen=[],core=fakeHerdr({onRun:t=>seen.push(t.argv)});
  await tracedHerdr(core.herdr,null).kernel.run({name:'mc-dev-1',cwd:'/wt',labels:{},argv:devArgv('claude','m','high','go')});
  await tracedHerdr(core.herdr,{open:async()=>{throw new Error('disk full');}}).kernel.run({name:'mc-dev-2',cwd:'/wt',labels:{},argv:devArgv('claude','m','high','go')});
  assert.deepEqual(seen.map(a=>settingsOf(a).env),[both,both]);
  assert.ok(seen.every(a=>!a.includes('--session-id')),'untraced: no id of its own');
});

test('traceArgv: a new Claude session takes the key as its id, a resumed one keeps its own; Codex carries the key for its commands',()=>{
  const key='11111111-2222-4333-8444-555555555555';
  const claude=traceArgv(agentOf('claude').start('go'),key);
  assert.deepEqual(claude.argv,keepTranscript(['claude','--session-id',key,...agentOf('claude').start('go').slice(1)]));
  assert.deepEqual([claude.tool,claude.session],['claude',key]);
  const resumed=traceArgv(resumeArgv('claude','0f1e2d3c-0000-4000-8000-000000000000','go'),key);
  assert.deepEqual(resumed.argv,keepTranscript(resumeArgv('claude','0f1e2d3c-0000-4000-8000-000000000000','go')),'never --session-id with --resume');
  assert.equal(resumed.session,'0f1e2d3c-0000-4000-8000-000000000000');
  const dev=devArgv('codex','gpt-6.1-sol','high','go'),codex=traceArgv(dev,key);
  const at=dev.indexOf('shell_environment_policy.set.FABRIQUE_CONSOLE_AGENT="1"')+1;
  assert.deepEqual(codex.argv,[...dev.slice(0,at),'-c',`shell_environment_policy.set.${TRACE_MARK}="${key}"`,...dev.slice(at)]);
  assert.deepEqual([codex.tool,codex.session],['codex',null],'Codex says the id of its session later');
  assert.equal(codex.argv.at(-1),'go','the prompt stays the last argument');
  const back=traceArgv(resumeArgv('codex','0f1e2d3c','go'),key);
  assert.deepEqual([back.argv.slice(0,4),back.session],[['codex','resume','--no-daemon','0f1e2d3c'],'0f1e2d3c']);
  for(const other of [['hc','x'],['sh','-c','claude'],[]])assert.equal(traceArgv(other,key),null,'only an agent is traced');
});

test('the store: one trace per launch, found by mission, ticket, role and turn; the files are found by name and never read',async()=>{
  const h=await homes();
  try{
    let n=0;const keys=['aaaaaaaa-0000-4000-8000-000000000001','aaaaaaaa-0000-4000-8000-000000000002','aaaaaaaa-0000-4000-8000-000000000003','aaaaaaaa-0000-4000-8000-000000000004'];
    const traces=createTraces({root:h.root,claudeHome:h.claudeHome,codexHome:h.codexHome,uuid:()=>keys[n++],now:()=>new Date('2026-11-14T10:0'+n+':00.000Z')});
    const one=await traces.open({mission:'M-1',ticket:'XJ-2',role:'dev',cwd:'/wt/xj-2',argv:agentOf('claude').start('the whole task, never kept')});
    assert.equal(one.argv[2],keys[0]);
    const two=await traces.open({mission:'M-1',ticket:'XJ-2',role:'dev',cwd:'/wt/xj-2',argv:agentOf('claude').start('again')});
    const review=await traces.open({mission:'M-1',ticket:'XJ-2',role:'review-1',cwd:'/wt/xj-2',argv:devArgv('codex','gpt-6.1-sol','high','REVIEW-PROMPT')});
    await traces.open({mission:'M-2',ticket:'XJ-2',role:'dev',cwd:'/wt/other',argv:agentOf('claude').start('x')});
    // Nothing of the argv is kept: no prompt, no option.
    const kept=await Promise.all((await readdir(join(h.root,'state','traces'))).map(f=>readFile(join(h.root,'state','traces',f),'utf8')));
    assert.equal(kept.length,4);assert.ok(kept.every(k=>!/never kept|again|REVIEW-PROMPT|--settings|gpt-6|FABRIQUE_CONSOLE_AGENT/.test(k)),kept.join('\n'));
    assert.deepEqual((await traces.list({mission:'M-1',ticket:'XJ-2',role:'dev'})).map(t=>[t.turn,t.session]),[[1,keys[0]],[2,keys[1]]]);
    assert.equal(await traces.find({mission:'M-1',ticket:'XJ-2',role:'dev',turn:3}),null);
    // Claude has not written yet: the link is there, the file is not (unknown, never made up).
    const before=await traces.find({mission:'M-1',ticket:'XJ-2',role:'dev',turn:1});
    assert.deepEqual([before.tool,before.session,before.file],['claude',keys[0],null]);
    const path=await sessionFile(join(h.claudeHome,'projects',claudeProjectFolder('/wt/xj-2'),keys[0]+'.jsonl'));
    assert.equal((await traces.find({mission:'M-1',ticket:'XJ-2',role:'dev',turn:1})).file,path);
    // Codex: no id before its first command; linked by the key it carries, then its rollout is found by its name.
    assert.equal(review.trace.session,null);
    assert.equal((await traces.find({mission:'M-1',ticket:'XJ-2',role:'review-1',turn:1})).file,null);
    // The one Codex that says itself is the agent; its file is unknown until its rollout is written.
    assert.equal((await traces.link({key:review.trace.key,session:THREAD})).session,THREAD);
    assert.equal((await traces.find({mission:'M-1',ticket:'XJ-2',role:'review-1',turn:1})).file,null);
    const rollout=await sessionFile(rolloutOf(h.codexHome,new Date(Date.parse(review.trace.at)+2000),THREAD));
    assert.deepEqual(await traces.find({mission:'M-1',ticket:'XJ-2',role:'review-1',turn:1}).then(t=>[t.session,t.file]),[THREAD,rollout]);
    // A second Codex (a child) makes it unknown, never its own (M12 review 3); a Claude trace takes none; an unknown
    // key, a bad id, are nothing.
    await sessionFile(rolloutOf(h.codexHome,new Date(Date.parse(review.trace.at)+60000),'019a7c1e-5b2d-7c3e-9f00-ffffffffffff'));
    assert.equal((await traces.link({key:review.trace.key,session:'019a7c1e-5b2d-7c3e-9f00-ffffffffffff'})).session,null);
    assert.equal(await traces.link({key:two.trace.key,session:THREAD}),null);
    assert.equal(await traces.link({key:'bbbbbbbb-0000-4000-8000-000000000009',session:THREAD}),null);
    assert.equal(await traces.link({key:review.trace.key,session:'../../etc'}),null);
    await assert.rejects(()=>traces.open({mission:'M-1',ticket:'XJ-2',role:'Bad Role',cwd:'/x',argv:agentOf('claude').start(null)}),e=>e.code==='INVALID_ARGUMENT');
  }finally{await h.done();}
});

test('a Claude project folder is named as Claude Code names it: every other character a dash, long paths found by their prefix',async()=>{
  assert.equal(claudeProjectFolder('/Users/n/Developer/worktrees/x/ligne-b'),'-Users-n-Developer-worktrees-x-ligne-b');
  assert.equal(claudeProjectFolder('/a b/é.c_d'),'-a-b---c-d');
  const h=await homes();
  try{
    const cwd='/'+'long-folder/'.repeat(20),key='cccccccc-0000-4000-8000-000000000001';
    const traces=createTraces({root:h.root,claudeHome:h.claudeHome,codexHome:h.codexHome,uuid:()=>key});
    await traces.open({mission:'M-1',ticket:'XJ-2',role:'dev',cwd,argv:agentOf('claude').start(null)});
    const folder=claudeProjectFolder(cwd).slice(0,200)+'-1x2y3z',path=await sessionFile(join(h.claudeHome,'projects',folder,key+'.jsonl'));
    assert.equal((await traces.find({mission:'M-1',ticket:'XJ-2',role:'dev',turn:1})).file,path);
  }finally{await h.done();}
});

test('noteAgentSession: a command run by a Codex agent links its session; nothing else is linked, and it never fails the command',async()=>{
  const h=await homes();
  try{
    const traces=createTraces({root:h.root,claudeHome:h.claudeHome,codexHome:h.codexHome});
    const {trace}=await traces.open({mission:'M-1',ticket:'XJ-2',role:'review-1',cwd:'/wt',argv:devArgv('codex','gpt-6.1-sol','high','r')});
    await sessionFile(rolloutOf(h.codexHome,new Date(Date.parse(trace.at)+1000),THREAD));
    assert.equal(await noteAgentSession({env:{CODEX_THREAD_ID:THREAD},root:h.root}),null,'no key: not an agent of the tool');
    assert.equal(await noteAgentSession({env:{[TRACE_MARK]:'not a key',CODEX_THREAD_ID:THREAD},root:h.root}),null);
    assert.equal(await noteAgentSession({env:{[TRACE_MARK]:trace.key},root:join(h.base,'nowhere')}),null);
    assert.equal((await noteAgentSession({env:{[TRACE_MARK]:trace.key,CODEX_THREAD_ID:THREAD,CODEX_HOME:h.codexHome},root:h.root})).session,THREAD);
  }finally{await h.done();}
});

test('the report command a Codex agent runs links its session, even when the report itself is refused',async()=>{
  const h=await homes();
  try{
    const traces=createTraces({root:h.root,claudeHome:h.claudeHome,codexHome:h.codexHome});
    const {trace}=await traces.open({mission:'M-1',ticket:'XJ-2',role:'dev',cwd:'/wt',argv:devArgv('codex','gpt-6.1-sol','high','r')});
    await sessionFile(rolloutOf(h.codexHome,new Date(Date.parse(trace.at)+1000),THREAD));
    const script=fileURLToPath(new URL('../scripts/fabrique-console-report.mjs',import.meta.url));
    const code=await new Promise((done,failed)=>{
      const child=spawn(process.execPath,[script,'nonsense'],{stdio:'ignore',env:{PATH:process.env.PATH,FABRIQUE_CONSOLE_HOME:h.root,HOME:h.base,CODEX_HOME:h.codexHome,CLAUDE_CONFIG_DIR:h.claudeHome,[TRACE_MARK]:trace.key,CODEX_THREAD_ID:THREAD}});
      child.once('error',failed);child.once('close',done);
    });
    assert.equal(code,1,'the report is refused as before');
    assert.equal((await traces.find({mission:'M-1',ticket:'XJ-2',role:'dev',turn:1})).session,THREAD);
  }finally{await h.done();}
});

test('tracedHerdr: the Lead, a dev and a reviewer go to Herdr traced, with the context of their launch; the trace of a tab never reaches the window',async()=>{
  const h=await homes(),seen=[];
  try{
    const core=fakeHerdr({onDo:(command,args)=>seen.push([command,args]),onRun:t=>seen.push(['hc.run',t])});
    const traces=createTraces({root:h.root,claudeHome:h.claudeHome,codexHome:h.codexHome}),herdr=tracedHerdr(core.herdr,traces);
    await herdr.run(hcRunArgs({tool:'codex',prompt:'lead',cwd:'/repo',labels:{'fabrique-console.app':'fabrique-console','fabrique-console.role':'lead','fabrique-console.mission':'M-1','fabrique-console.session':'s1'}}));
    await herdr.kernel.run({name:'mc-dev-1',cwd:'/wt',labels:{'fabrique-console.mission':'M-1','fabrique-console.ticket':'XJ-2','fabrique-console.launch':'1'},argv:devArgv('claude','claude-sonnet-5-5','high','dev')});
    await herdr.window.run('tab.new',{name:'XJ-2 · revue',folder:'/wt',argv:devArgv('codex','gpt-6.1-sol','high','review'),trace:{mission:'M-1',ticket:'XJ-2',role:'review-1'}}).catch(()=>{});
    const lead=await traces.find({mission:'M-1',ticket:null,role:'lead',turn:1}),dev=await traces.find({mission:'M-1',ticket:'XJ-2',role:'dev',turn:1}),review=await traces.find({mission:'M-1',ticket:'XJ-2',role:'review-1',turn:1});
    assert.deepEqual([lead.tool,lead.cwd,dev.tool,dev.cwd,review.tool,review.cwd],['codex','/repo','claude','/wt','codex','/wt']);
    const run=seen.find(([c,t])=>c==='hc.run'&&t.labels['fabrique-console.ticket']==='XJ-2')[1];
    assert.deepEqual(run.argv.slice(0,3),['claude','--session-id',dev.session]);
    const tab=seen.find(([c])=>c==='tab.new')[1];
    assert.equal(tab.trace,undefined,'the window never sees the trace');
    assert.ok(tab.argv.includes(`shell_environment_policy.set.${TRACE_MARK}="${review.key}"`));
    // What is not an agent goes as it is.
    await herdr.window.run('tab.new',{name:'notes',folder:'/wt',argv:['zsh']}).catch(()=>{});
    assert.deepEqual(seen.filter(([c])=>c==='tab.new').at(-1)[1].argv,['zsh']);
    // Without a store, the trace of a tab is only taken away.
    const bare=tracedHerdr(core.herdr,null);
    await bare.window.run('tab.new',{name:'x',folder:'/wt',argv:['zsh'],trace:{mission:'M-1'}}).catch(()=>{});
    assert.equal(seen.filter(([c])=>c==='tab.new').at(-1)[1].trace,undefined);
  }finally{await h.done();}
});

test('a dev and its reviewers launched by the chain have their session file, found from the mission, the ticket, the role and the turn',async()=>{
  const h=await homes(),t=await setup();
  try{
    // A clock of the test, one second a call: the day the rollout is filed under is the local day of its start, whatever
    // the day the suite runs (half past midnight in Paris, the day before in UTC: both are searched).
    let tick=0;const now=()=>new Date(Date.parse('2031-02-27T23:30:00.000Z')+1000*tick++);
    const traces=createTraces({root:t.root,claudeHome:h.claudeHome,codexHome:h.codexHome,now});
    const chain=t.make({herdr:tracedHerdr(t.core.herdr,traces)});
    assert.deepEqual((await chain.launch({sessionId:'s1',tickets:[FG2]})).launched,[{identifier:'XJ-2',launched:true}]);
    // The fake Claude dev: it writes its transcript where Claude Code writes it, under the id it was given.
    const dev=devRun(t.calls,'XJ-2'),id=dev.argv[dev.argv.indexOf('--session-id')+1];
    assert.match(id,UUID);assert.equal(dev.argv[0],'claude');
    const devFile=await sessionFile(join(h.claudeHome,'projects',claudeProjectFolder(dev.cwd),id+'.jsonl'));
    // Its report, then the review by the other family: a Codex reviewer, which says its session on its first command.
    t.reports.push({ticket:'XJ-2',kind:'dev',commit:'a'.repeat(40),repo:'admin',summary:'fait',at:'2026-11-09T10:00:00.000Z'});
    await chain.tick({sessionId:'s1'});await chain.tick({sessionId:'s1'});
    const reviews=()=>t.calls.filter(([c,a])=>c==='tab.new'&&a.name==='XJ-2 · revue').map(([,a])=>a);
    assert.equal(reviews().length,1);assert.equal(reviews()[0].trace,undefined);
    const keyOf=argv=>argv.find(a=>a.startsWith(`shell_environment_policy.set.${TRACE_MARK}=`)).split('"')[1];
    await noteAgentSession({env:{[TRACE_MARK]:keyOf(reviews()[0].argv),CODEX_THREAD_ID:THREAD,CODEX_HOME:h.codexHome},root:t.root});
    const reviewAt=Date.parse((await traces.list({mission:'M-1',ticket:'XJ-2',role:'review-1'}))[0].at);
    const reviewFile=await sessionFile(rolloutOf(h.codexHome,new Date(reviewAt+5000),THREAD));
    // Changes asked, fixed, reviewed again: the second turn of the reviewer is its own session.
    t.reports.push({ticket:'XJ-2',kind:'review-1',commit:'a'.repeat(40),verdict:'changes_requested',summary:'bug',at:'2026-11-09T10:05:00.000Z'});
    await chain.tick({sessionId:'s1'});
    t.reports.push({ticket:'XJ-2',kind:'dev',commit:'b'.repeat(40),repo:'admin',summary:'corrigé',at:'2026-11-09T10:10:00.000Z'});
    await chain.tick({sessionId:'s1'});
    assert.equal(reviews().length,2);
    assert.deepEqual(await traces.find({mission:'M-1',ticket:'XJ-2',role:'dev',turn:1}).then(x=>[x.session,x.file]),[id,devFile]);
    assert.deepEqual(await traces.find({mission:'M-1',ticket:'XJ-2',role:'review-1',turn:1}).then(x=>[x.tool,x.session,x.file]),['codex',THREAD,reviewFile]);
    const second=await traces.find({mission:'M-1',ticket:'XJ-2',role:'review-1',turn:2});
    assert.deepEqual([second.tool,second.session,second.file,second.key],['codex',null,null,keyOf(reviews()[1].argv)]);
  }finally{await t.cleanup();await h.done();}
});

test('a Codex child that inherits the key of its parent never keeps its trace: once two have said themselves, the trace is unknown, whatever the order of their links (M12 review 3)',async()=>{
  const h=await homes();
  try{
    let n=0;const keys=['dddddddd-0000-4000-8000-000000000001','dddddddd-0000-4000-8000-000000000002','dddddddd-0000-4000-8000-000000000003'];
    const traces=createTraces({root:h.root,claudeHome:h.claudeHome,codexHome:h.codexHome,uuid:()=>keys[n++],now:()=>new Date(2031,1,27,10,0,0)});
    const parent='019a7c1e-0000-7000-8000-00000000000a',child='019a7c1e-0000-7000-8000-00000000000b',grandchild='019a7c1e-0000-7000-8000-00000000000c';
    await sessionFile(rolloutOf(h.codexHome,new Date(2031,1,27,10,0,3),parent));
    await sessionFile(rolloutOf(h.codexHome,new Date(2031,1,27,10,4,0),child));
    await sessionFile(rolloutOf(h.codexHome,new Date(2031,1,27,10,9,0),grandchild));
    const {trace}=await traces.open({mission:'M-1',ticket:'XJ-2',role:'review-1',cwd:'/wt',argv:devArgv('codex','gpt-6.1-sol','high','r')});
    // The parent says itself first: its trace, until a child (a `codex exec` it started, the key in its environment) does.
    assert.equal((await traces.link({key:trace.key,session:parent})).session,parent);
    assert.equal((await traces.link({key:trace.key,session:child})).session,null,'two Codex: unknown, never the child');
    assert.equal((await traces.link({key:trace.key,session:parent})).session,null,'saying itself again changes nothing');
    assert.equal((await traces.link({key:trace.key,session:grandchild})).session,null);
    assert.equal((await traces.find({mission:'M-1',ticket:'XJ-2',role:'review-1',turn:1})).file,null);
    // Through the command the child runs: the same.
    const env=id=>({[TRACE_MARK]:trace.key,CODEX_THREAD_ID:id,CODEX_HOME:h.codexHome});
    assert.equal((await noteAgentSession({env:env(child),root:h.root})).session,null);
    // Links at the same moment lose none: in the end, three Codex linked, unknown (another launch, its own sessions).
    const [p2,c2,g2]=['019a7c1e-0000-7000-8000-0000000002aa','019a7c1e-0000-7000-8000-0000000002bb','019a7c1e-0000-7000-8000-0000000002cc'];
    const other=(await traces.open({mission:'M-1',ticket:'XJ-2',role:'review-1',cwd:'/wt',argv:devArgv('codex','gpt-6.1-sol','high','r')})).trace;
    await Promise.all([g2,c2,p2,c2,g2,p2].map(session=>traces.link({key:other.key,session})));
    assert.deepEqual((await readdir(join(h.root,'state','traces',other.key+'.claims'))).sort(),[p2,c2,g2].map(s=>s+'.json').sort());
    assert.equal((await traces.find({mission:'M-1',ticket:'XJ-2',role:'review-1',turn:2})).session,null);
    // No claim is a session file, and no prompt is kept.
    const kept=await readdir(join(h.root,'state','traces'),{recursive:true});
    assert.ok(kept.every(name=>!name.endsWith('.jsonl')),kept.join(','));
  }finally{await h.done();}
});

test('the PO and the devs of before keep their context: their issue, their role, their ticket when a label gives it; their turns never mix between issues',async()=>{
  const h=await homes();
  try{
    let n=0;const clock=()=>new Date(Date.UTC(2031,1,27,10,n++));
    const core=fakeHerdr();
    const traces=createTraces({root:h.root,claudeHome:h.claudeHome,codexHome:h.codexHome,now:clock}),traced=tracedHerdr(core.herdr,traces);
    // The trace is written before Herdr is asked; what the fake core answers (a name already taken) does not matter here.
    const herdr={run:args=>traced.run(args).catch(()=>{})};
    const po=(issue,session)=>hcRunArgs({tool:'codex',prompt:'po',cwd:'/repo',labels:{'fabrique-console.app':'fabrique-console','fabrique-console.issue':issue,'fabrique-console.session':session,'fabrique-console.role':'po'}});
    await herdr.run(po('issue-1','po-1'));await herdr.run(po('issue-2','po-2'));await herdr.run(po('issue-1','po-1'));
    // A dev launched as before (src/launch.mjs): its issue and its session, no role; it is a dev.
    await herdr.run(hcRunArgs({tool:'claude',prompt:'dev',cwd:'/wt',labels:{'fabrique-console.app':'fabrique-console','fabrique-console.issue':'issue-2','fabrique-console.session':'dev-1'}}));
    // A ticket given by a label is kept.
    await herdr.run(hcRunArgs({tool:'codex',prompt:'po',cwd:'/repo',labels:{'fabrique-console.app':'fabrique-console','fabrique-console.issue':'issue-3','fabrique-console.ticket':'XJ-7','fabrique-console.session':'po-3','fabrique-console.role':'po'}}));
    assert.deepEqual((await traces.list({issue:'issue-1',role:'po'})).map(t=>[t.issue,t.role,t.turn]),[['issue-1','po',1],['issue-1','po',2]]);
    assert.deepEqual((await traces.list({issue:'issue-2',role:'po'})).map(t=>[t.issue,t.turn]),[['issue-2',1]]);
    const dev=await traces.find({issue:'issue-2',role:'dev',turn:1});
    assert.deepEqual([dev.tool,dev.mission,dev.ticket,dev.cwd],['claude',null,null,'/wt']);
    assert.deepEqual(await traces.find({issue:'issue-3',ticket:'XJ-7',role:'po',turn:1}).then(t=>[t.issue,t.ticket]),['issue-3','XJ-7']);
    // Not to be mixed with the traces of a mission: no issue there.
    assert.deepEqual(await traces.list({role:'po'}),[]);
    // An agent with labels of no work at all (the assistants) stays traced, by its role only.
    await herdr.run(hcRunArgs({tool:'claude',prompt:null,cwd:'/repo',labels:{'fabrique-console.app':'fabrique-console','fabrique-console.role':'agent','fabrique-console.tool':'claude'}}));
    assert.equal((await traces.list({role:'agent'})).length,1);
    // A label that is no name leaves its field unknown, never the agent untraced.
    await herdr.run(hcRunArgs({tool:'codex',prompt:'po',cwd:'/repo',labels:{'fabrique-console.issue':'issue 4 / bad','fabrique-console.role':'po'}}));
    assert.equal((await traces.list({role:'po'})).length,1);
  }finally{await h.done();}
});

// M12 review 3 (decision 85, rule 3): nothing a Codex says tells the agent from a child that inherits its key, and the
// starts of the rollouts cannot always order them. So the rule is simple: one Codex linked to a trace is its agent;
// more than one (parent, children, resumed sessions, whatever their hours) and the trace is unknown, never guessed.
const A='019a7c1e-0000-7000-8000-0000000000a1',B='019a7c1e-0000-7000-8000-0000000000b2',C='019a7c1e-0000-7000-8000-0000000000c3';
const ownerOf=async(traces,key)=>(await traces.list({mission:'M-1',ticket:'XJ-2',role:'review-1'})).find(t=>t.key===key).session;

test('one Codex linked to a trace is its agent, whatever the hours of the rollouts, found or not (M12 review 3)',async()=>{
  const h=await homes();
  try{
    const launch=new Date(2031,1,27,12,0,0);
    const traces=createTraces({root:h.root,claudeHome:h.claudeHome,codexHome:h.codexHome,now:()=>launch});
    // No rollout found yet: the one that says itself is the agent, its file unknown until it is written.
    const one=(await traces.open({mission:'M-1',ticket:'XJ-2',role:'review-1',cwd:'/wt',argv:reviewer()})).trace;
    assert.equal((await traces.link({key:one.key,session:A})).session,A);
    assert.equal((await traces.find({mission:'M-1',ticket:'XJ-2',role:'review-1',turn:1})).file,null);
    const file=await sessionFile(rolloutOf(h.codexHome,new Date(launch.getTime()+2000),A));
    assert.equal((await traces.find({mission:'M-1',ticket:'XJ-2',role:'review-1',turn:1})).file,file);
    // Codex sessions of no trace started meanwhile, or the one linked started before the launch: still its agent.
    await sessionFile(rolloutOf(h.codexHome,new Date(launch.getTime()+1000),C));
    await sessionFile(rolloutOf(h.codexHome,new Date(2031,1,27,8,0,0),B));
    const two=(await traces.open({mission:'M-1',ticket:'XJ-2',role:'review-1',cwd:'/wt',argv:reviewer()})).trace;
    assert.equal((await traces.link({key:two.key,session:B})).session,B);
    assert.deepEqual([await ownerOf(traces,one.key),await ownerOf(traces,two.key)],[A,B]);
  }finally{await h.done();}
});

test('a resumed session started before its parent in the same second never keeps the trace once the parent says itself: unknown (M12 review 3)',async()=>{
  const h=await homes();
  try{
    // The trace at 12:00:00.750; B, a session a child resumes, started at 12:00:00.100 (the same second in its name);
    // the parent A at 12:00:03.
    const launch=new Date(2031,1,27,12,0,0,750);
    const traces=createTraces({root:h.root,claudeHome:h.claudeHome,codexHome:h.codexHome,now:()=>launch});
    await sessionFile(rolloutOf(h.codexHome,new Date(2031,1,27,12,0,0,100),B));
    await sessionFile(rolloutOf(h.codexHome,new Date(2031,1,27,12,0,3),A));
    const {trace}=await traces.open({mission:'M-1',ticket:'XJ-2',role:'review-1',cwd:'/wt',argv:reviewer()});
    await traces.link({key:trace.key,session:B});
    assert.equal((await traces.link({key:trace.key,session:A})).session,null,'two Codex linked: unknown');
    assert.equal(await ownerOf(traces,trace.key),null);
    assert.equal((await traces.find({mission:'M-1',ticket:'XJ-2',role:'review-1',turn:1})).file,null);
  }finally{await h.done();}
});

test('a claim made by another trace never takes a candidate from its own: each trace counts only those linked to it (M12 review 3)',async()=>{
  const h=await homes();
  try{
    const launch=new Date(2031,1,27,12,0,0);
    const traces=createTraces({root:h.root,claudeHome:h.claudeHome,codexHome:h.codexHome,now:()=>launch});
    await sessionFile(rolloutOf(h.codexHome,new Date(launch.getTime()+1000),A));
    await sessionFile(rolloutOf(h.codexHome,new Date(launch.getTime()+2000),B));
    const mine=(await traces.open({mission:'M-1',ticket:'XJ-2',role:'review-1',cwd:'/wt',argv:reviewer()})).trace;
    const other=(await traces.open({mission:'M-1',ticket:'XJ-2',role:'review-1',cwd:'/wt',argv:reviewer()})).trace;
    // Another trace claims A (a child resuming it, its key inherited elsewhere); A and its child B both claim mine.
    await traces.link({key:other.key,session:A});
    await traces.link({key:mine.key,session:B});await traces.link({key:mine.key,session:A});
    assert.deepEqual([await ownerOf(traces,mine.key),await ownerOf(traces,other.key)],[null,A]);
    // In any order of the links, the same.
    const third=(await traces.open({mission:'M-1',ticket:'XJ-2',role:'review-1',cwd:'/wt',argv:reviewer()})).trace;
    await traces.link({key:third.key,session:A});await traces.link({key:third.key,session:B});
    assert.equal(await ownerOf(traces,third.key),null);
  }finally{await h.done();}
});

test('more than one Codex linked to a trace leaves it unknown: a child, a resumed session, links at the same moment, whatever their order (M12 review 3)',async()=>{
  for(const order of [[B,A],[A,B],[C,A,B],[A,A,B]]){
    const h=await homes();
    try{
      const launch=new Date(2031,1,27,12,0,0);
      const traces=createTraces({root:h.root,claudeHome:h.claudeHome,codexHome:h.codexHome,now:()=>launch});
      await sessionFile(rolloutOf(h.codexHome,new Date(launch.getTime()+3000),A));await sessionFile(rolloutOf(h.codexHome,new Date(launch.getTime()+3000),B));
      await sessionFile(rolloutOf(h.codexHome,new Date(2031,1,27,8,0,0),C));
      const {trace}=await traces.open({mission:'M-1',ticket:'XJ-2',role:'review-1',cwd:'/wt',argv:reviewer()});
      for(const session of order)await traces.link({key:trace.key,session});
      assert.equal(await ownerOf(traces,trace.key),null,`links ${order.join(' then ')}: unknown`);
    }finally{await h.done();}
  }
});
