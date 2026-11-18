import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, appendFile, readdir, rm, utimes } from 'node:fs/promises';
import { writeFileSync, appendFileSync } from 'node:fs';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { createTraces, claudeProjectFolder, tracedHerdr, noteAgentSession, TRACE_MARK } from '../src/traces.mjs';
import { createTicketTokens } from '../src/ticket-tokens.mjs';
import { createMissionActions } from '../src/mission.mjs';
import { desk } from './helpers/requests.mjs';
import { setup, FG2, devRun } from './helpers/dev-chain-setup.mjs';

// M13 (decisions 68, 85, 99; rule 7 of the inventory of usage): the tokens of each ticket and of each agent (role, tool,
// turn), read from the sessions the traces of M12 link, and given by mission-read. The sessions here are fakes, in the
// format the installed programs write (Claude Code 2.1.325: an `assistant` line per answer, written again while it
// streams, with message.id and message.usage {input_tokens, cache_creation_input_tokens, cache_read_input_tokens,
// output_tokens}, its sub-agents under <session>/subagents/agent-<id>.jsonl; Codex 0.167.2: `event_msg` lines of type
// `token_count` whose info.total_token_usage {input_tokens, cached_input_tokens, output_tokens, …} is the running total
// of the session). No real session is read: every home is a temporary folder.
const require=createRequire(import.meta.url);
const SECRET='SECRET words of the session, usage included';
const T0=Date.parse('2031-03-04T09:00:00.000Z'),MIN=60000;
const A='019a7c1e-5b2d-7c3e-9f00-0123456789ab',B='019a7c1e-5b2d-7c3e-9f00-0123456789ac';
const pad=n=>String(n).padStart(2,'0');
const stamp=d=>`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;

async function world(t){
  const base=await mkdtemp(join(tmpdir(),'fabrique-console-m13-'));t.after(()=>rm(base,{recursive:true,force:true}));
  const root=join(base,'mc'),claudeHome=join(base,'claude'),codexHome=join(base,'codex'),cwd=join(base,'wt','XJ-1');
  let clock=T0,n=0;
  const uuid=()=>`11111111-2222-4333-8444-${String(++n).padStart(12,'0')}`;
  const traces=createTraces({root,env:{},home:base,claudeHome,codexHome,uuid,now:()=>new Date(clock)});
  const tokens=createTicketTokens({traces,reuseFor:0});
  const at=minutes=>{clock=T0+minutes*MIN;};
  const open=(ticket,role,argv,mission='M-1')=>traces.open({mission,ticket,role,cwd,argv}).then(r=>r.trace);
  const claudeFile=session=>join(claudeHome,'projects',claudeProjectFolder(cwd),session+'.jsonl');
  const rollout=(session,minutes)=>{const d=new Date(T0+minutes*MIN);return join(codexHome,'sessions',String(d.getFullYear()),pad(d.getMonth()+1),pad(d.getDate()),`rollout-${stamp(d)}-${session}.jsonl`);};
  const write=async(file,lines)=>{await mkdir(dirname(file),{recursive:true});await appendFile(file,lines.join('\n')+'\n');};
  return {base,root,traces,tokens,at,open,claudeFile,rollout,write,read:()=>tokens.read({mission:'M-1'})};
}
// An answer of Claude, as it is written (several times while it streams), and the lines around it.
const answer=(id,minutes,[input,cacheWrite,cacheRead,output],session='s')=>JSON.stringify({parentUuid:null,isSidechain:false,type:'assistant',sessionId:session,cwd:'/wt',timestamp:new Date(T0+minutes*MIN).toISOString(),
  message:{id,type:'message',role:'assistant',model:'claude-opus-5-5',content:[{type:'text',text:SECRET}],usage:{input_tokens:input,cache_creation_input_tokens:cacheWrite,cache_read_input_tokens:cacheRead,output_tokens:output,service_tier:'standard'}}});
const prompt=minutes=>JSON.stringify({type:'user',timestamp:new Date(T0+minutes*MIN).toISOString(),message:{role:'user',content:SECRET}});
// A running total of Codex, and the lines around it.
const count=(minutes,[input,cached,output])=>JSON.stringify({timestamp:new Date(T0+minutes*MIN).toISOString(),type:'event_msg',payload:{type:'token_count',
  info:{total_token_usage:{input_tokens:input,cached_input_tokens:cached,output_tokens:output,reasoning_output_tokens:0,total_tokens:input+output},last_token_usage:{input_tokens:1,cached_input_tokens:0,output_tokens:1,reasoning_output_tokens:0,total_tokens:2},model_context_window:272000},
  rate_limits:{primary:{used_percent:3,window_minutes:300}}}});
const said=minutes=>JSON.stringify({timestamp:new Date(T0+minutes*MIN).toISOString(),type:'response_item',payload:{type:'message',role:'assistant',content:[{type:'output_text',text:SECRET+' token_count'}]}});
const claudeSums=(input,cacheWrite,cacheRead,output)=>({in:input+cacheWrite+cacheRead,out:output,input,cacheRead,cacheWrite});

test('two tickets done one after the other each have their own count, by agent (role, tool, turn), cache told apart',async t=>{
  const w=await world(t);
  w.at(0);const dev2=await w.open('XJ-2','dev',['claude','go']);
  await w.write(w.claudeFile(dev2.key),[prompt(1),answer('m1',1,[10,0,0,1]),answer('m1',1,[10,200,0,5]),prompt(2),answer('m2',2,[3,0,200,7])]);
  w.at(10);const rev2=await w.open('XJ-2','review-1',['codex','review']);await w.traces.link({key:rev2.key,session:A});
  await w.write(w.rollout(A,10),[said(11),count(11,[1000,800,50]),count(11,[1000,800,50]),said(12),count(12,[2500,2000,90])]);
  // The next ticket, its own dev and its own reviewer.
  w.at(20);const dev3=await w.open('XJ-3','dev',['claude','go']);
  await w.write(w.claudeFile(dev3.key),[answer('m3',21,[4,40,400,9])]);
  w.at(30);const rev3=await w.open('XJ-3','review-1',['codex','review']);await w.traces.link({key:rev3.key,session:B});
  await w.write(w.rollout(B,30),[count(31,[300,100,30])]);
  const tokens=await w.read();
  assert.deepEqual(tokens.tickets['XJ-2'],{...claudeSums(13,200,200,12),in:413+2500,out:12+90,input:13+500,cacheRead:200+2000,cacheWrite:null,unknown:0,agents:[
    {role:'dev',tool:'claude',turn:1,state:'counted',...claudeSums(13,200,200,12)},
    {role:'review-1',tool:'codex',turn:1,state:'counted',in:2500,out:90,input:500,cacheRead:2000,cacheWrite:null}]});
  assert.deepEqual(tokens.tickets['XJ-3'],{in:444+300,out:9+30,input:4+200,cacheRead:400+100,cacheWrite:null,unknown:0,agents:[
    {role:'dev',tool:'claude',turn:1,state:'counted',...claudeSums(4,40,400,9)},
    {role:'review-1',tool:'codex',turn:1,state:'counted',in:300,out:30,input:200,cacheRead:100,cacheWrite:null}]});
  // The issue, agent by agent (simulation/CONTRAT.md, tokens.agents): all the reviewers together.
  assert.deepEqual(tokens.agents,[
    {role:'dev',tool:'claude',in:413+444,out:21,input:17,cacheRead:600,cacheWrite:240},
    {role:'reviewer',tool:'codex',in:2800,out:120,input:700,cacheRead:2100,cacheWrite:null}]);
  // Counters only: nothing of a session is kept or given, and nothing is written beside the traces.
  assert.equal(JSON.stringify(tokens).includes('SECRET'),false);
  assert.deepEqual((await readdir(join(w.root,'state'))).sort(),['traces']);
});

test('an answer found twice in the files of a launch is counted once, a Codex total once, read after read',async t=>{
  const w=await world(t);
  w.at(0);const first=await w.open('XJ-2','dev',['claude','go']);
  await w.write(w.claudeFile(first.key),[answer('m1',1,[10,0,0,5]),answer('m2',31,[20,0,0,6])]);
  // The same answers copied into another file of the session (a sub-agent): still once.
  await w.write(join(dirname(w.claudeFile(first.key)),first.key,'subagents','agent-x.jsonl'),[answer('m1',1,[10,0,0,5]),answer('m9',32,[1,0,0,1])]);
  assert.deepEqual([(await w.read()).tickets['XJ-2'].in,(await w.read()).tickets['XJ-2'].out],[31,12]);
  // Codex: a total written twice counts once; a total that starts again counts from zero.
  w.at(40);const rev=await w.open('XJ-3','review-1',['codex','review']);await w.traces.link({key:rev.key,session:A});
  await w.write(w.rollout(A,40),[count(41,[100,0,10]),count(41,[100,0,10]),count(42,[150,50,20]),count(52,[30,0,3])]);
  assert.deepEqual((await w.read()).tickets['XJ-3'].agents.map(a=>[a.in,a.out,a.cacheRead]),[[180,23,50]]);
  // Read again after the file grew: nothing counted twice.
  await w.write(w.claudeFile(first.key),[answer('m2',31,[20,0,0,6]),answer('m3',33,[2,0,0,2])]);
  assert.equal((await w.read()).tickets['XJ-2'].in,33);
});

test('breakdown: a dev cut then launched again on its ticket adds its two sessions, without a double',async t=>{
  const w=await world(t);
  w.at(0);const first=await w.open('XJ-2','dev',['claude','go']);
  await w.write(w.claudeFile(first.key),[answer('m1',1,[10,100,0,5]),answer('m2',2,[1,0,100,1])]);
  // The dev is gone; the chain starts a new one (src/dev-chain.mjs: devArgv never resumes): a new session.
  w.at(20);const second=await w.open('XJ-2','dev',['claude','go']);
  assert.notEqual(second.session,first.session);
  await w.write(w.claudeFile(second.key),[answer('n1',21,[7,70,0,3])]);
  const ticket=(await w.read()).tickets['XJ-2'];
  assert.deepEqual(ticket.agents.map(a=>[a.role,a.turn,a.state,a.in,a.out]),[['dev',1,'counted',211,6],['dev',2,'counted',77,3]]);
  assert.deepEqual([ticket.in,ticket.out,ticket.input,ticket.cacheWrite,ticket.cacheRead],[288,9,18,170,100]);
});

test('an unknown number stays unknown, never estimated: trace unknown, session not found, session unreadable',async t=>{
  const w=await world(t);
  w.at(0);const dev=await w.open('XJ-2','dev',['claude','go']);
  await w.write(w.claudeFile(dev.key),[answer('m1',1,[10,0,0,5])]);
  // A Codex reviewer that never said its session: its trace is unknown.
  w.at(10);await w.open('XJ-2','review-1',['codex','review']);
  let tokens=await w.read();
  assert.deepEqual(tokens.tickets['XJ-2'].agents[1],{role:'review-1',tool:'codex',turn:1,state:'unknown',reason:'trace',in:null,out:null,input:null,cacheRead:null,cacheWrite:null});
  assert.deepEqual([tokens.tickets['XJ-2'].in,tokens.tickets['XJ-2'].out,tokens.tickets['XJ-2'].unknown],[null,null,1],'the total of a ticket with an unknown agent is unknown');
  assert.deepEqual(tokens.agents.find(a=>a.role==='reviewer'),{role:'reviewer',tool:'codex',in:null,out:null,input:null,cacheRead:null,cacheWrite:null});
  assert.equal(tokens.agents.find(a=>a.role==='dev').in,10,'the known agents keep their numbers');
  // More than one Codex claiming the trace (decision 85, rule 3): unknown as well.
  w.at(20);const two=await w.open('XJ-3','review-1',['codex','review']);
  await w.traces.link({key:two.key,session:A});await w.traces.link({key:two.key,session:B});
  await w.write(w.rollout(A,20),[count(21,[100,0,10])]);
  // A session said, but its file not found; a file whose counter cannot be read.
  w.at(30);await w.open('XJ-4','dev',['claude','go']);
  w.at(40);const broken=await w.open('XJ-5','dev',['claude','go']);
  await w.write(w.claudeFile(broken.key),[answer('b1',41,[10,0,0,5]),'{"type":"assistant","message":{"usage":{"input_tok']);
  await w.write(w.claudeFile(broken.key),[answer('b2',42,[1,0,0,1])]);
  tokens=await w.read();
  assert.deepEqual(['XJ-3','XJ-4','XJ-5'].map(k=>[tokens.tickets[k].agents[0].state,tokens.tickets[k].agents[0].reason,tokens.tickets[k].in]),
    [['unknown','trace',null],['unknown','session',null],['unknown','unreadable',null]]);
  // A session with nothing counted yet is known: zero.
  w.at(50);const quiet=await w.open('XJ-6','dev',['claude','go']);
  await w.write(w.claudeFile(quiet.key),[prompt(51)]);
  assert.deepEqual((await w.read()).tickets['XJ-6'].agents[0],{role:'dev',tool:'claude',turn:1,state:'counted',in:0,out:0,input:0,cacheRead:0,cacheWrite:0});
});

test('only the agents of the mission are counted, a session started before its launch keeps what it did before',async t=>{
  const w=await world(t);
  w.at(0);await w.open('XJ-2','dev',['claude','go'],'M-2');
  // A Lead resuming an older session: what that session did before the launch is not this mission's.
  w.at(30);const lead=await w.open(null,'lead',['claude','--resume','22222222-2222-4222-8222-222222222222']);
  await w.write(w.claudeFile('22222222-2222-4222-8222-222222222222'),[answer('old',5,[1000,0,0,100]),answer('new',31,[5,0,0,2])]);
  w.at(35);await w.open('XJ-1','qa',['claude','go']);
  const tokens=await w.read();
  assert.equal(lead.session,'22222222-2222-4222-8222-222222222222');
  assert.deepEqual(Object.keys(tokens.tickets),[],'neither the Lead nor the QA is a ticket of the plan');
  assert.deepEqual(tokens.agents.map(a=>[a.role,a.tool,a.in,a.out]),[['lead','claude',5,2],['qa','claude',null,null]]);
  assert.equal(await w.tokens.read({mission:'M-9'}),null,'a mission without a traced agent: nothing');
});

test('mission-read gives the tokens to the page, and nothing when the engine has none',async t=>{
  const f=await desk(t),tokens={tickets:{'XJ-2':{in:5,out:1}},agents:[]};
  const read=more=>createMissionActions({root:f.root,now:f.now,registry:f.missions,inbox:f.inbox,questions:f.questions,loadState:async()=>({sessions:f.sessions}),chain:{read:async()=>({on:false,log:[],metrics:{},reports:[]})},...more}).read({mission:'M-1'});
  const asked=[];
  assert.deepEqual((await read({tokens:async input=>{asked.push(input);return tokens;}})).tokens,tokens);
  assert.deepEqual(asked,[{mission:'M-1'}]);
  assert.equal(Object.hasOwn(await read({tokens:async()=>null}),'tokens'),false);
  assert.equal(Object.hasOwn(await read({tokens:async()=>{throw new Error('unreadable');}}),'tokens'),false,'a reading that fails is no number');
  assert.equal(Object.hasOwn(await read({}),'tokens'),false);
});

test('from the traces the chain writes (M12): its dev and its reviewers, turn by turn, a turn still unknown',async()=>{
  const t=await setup(),base=await mkdtemp(join(tmpdir(),'fabrique-console-m13-chain-')),claudeHome=join(base,'claude'),codexHome=join(base,'codex');
  try{
    let tick=0;const now=()=>new Date(Date.parse('2031-02-27T23:30:00.000Z')+1000*tick++);
    const traces=createTraces({root:t.root,env:{},home:base,claudeHome,codexHome,now}),tokens=createTicketTokens({traces});
    const chain=t.make({herdr:tracedHerdr(t.core.herdr,traces)});
    await chain.launch({sessionId:'s1',tickets:[FG2]});
    const dev=devRun(t.calls,'XJ-2'),id=dev.argv[dev.argv.indexOf('--session-id')+1],later=Date.parse('2031-02-28T01:00:00.000Z');
    const write=async(file,lines)=>{await mkdir(dirname(file),{recursive:true});await appendFile(file,lines.join('\n')+'\n');};
    await write(join(claudeHome,'projects',claudeProjectFolder(dev.cwd),id+'.jsonl'),[answer('m1',(later-T0)/MIN,[10,100,1000,20])]);
    t.reports.push({ticket:'XJ-2',kind:'dev',commit:'a'.repeat(40),repo:'admin',summary:'fait',at:'2026-11-09T10:00:00.000Z'});
    await chain.tick({sessionId:'s1'});await chain.tick({sessionId:'s1'});
    const reviews=()=>t.calls.filter(([c,a])=>c==='tab.new'&&a.name==='XJ-2 · revue').map(([,a])=>a);
    const keyOf=argv=>argv.find(a=>a.startsWith(`shell_environment_policy.set.${TRACE_MARK}=`)).split('"')[1];
    await noteAgentSession({env:{[TRACE_MARK]:keyOf(reviews()[0].argv),CODEX_THREAD_ID:A,CODEX_HOME:codexHome},root:t.root});
    const reviewAt=new Date(Date.parse((await traces.list({mission:'M-1',ticket:'XJ-2',role:'review-1'}))[0].at)+5000);
    await write(join(codexHome,'sessions',String(reviewAt.getFullYear()),pad(reviewAt.getMonth()+1),pad(reviewAt.getDate()),`rollout-${stamp(reviewAt)}-${A}.jsonl`),[count((later-T0)/MIN,[500,400,30])]);
    t.reports.push({ticket:'XJ-2',kind:'review-1',commit:'a'.repeat(40),verdict:'changes_requested',summary:'bug',at:'2026-11-09T10:05:00.000Z'});
    await chain.tick({sessionId:'s1'});
    t.reports.push({ticket:'XJ-2',kind:'dev',commit:'b'.repeat(40),repo:'admin',summary:'corrigé',at:'2026-11-09T10:10:00.000Z'});
    await chain.tick({sessionId:'s1'});
    assert.equal(reviews().length,2);
    const ticket=(await tokens.read({mission:'M-1'})).tickets['XJ-2'];
    assert.deepEqual(ticket.agents.map(a=>[a.role,a.tool,a.turn,a.state,a.in,a.out]),
      [['dev','claude',1,'counted',1110,20],['review-1','codex',1,'counted',500,30],['review-1','codex',2,'unknown',null,null]]);
    assert.deepEqual([ticket.in,ticket.out,ticket.unknown],[null,null,1]);
  }finally{await t.cleanup();await rm(base,{recursive:true,force:true});}
});

// M13 review, P1: the real output of the CLI. `clean` masks every field that reads like a secret; `tokens`, which holds
// only counters, crosses it as it is, and anything else under that name is still masked.
test('the real CLI prints the tokens of mission-read, and still masks a field named like a token that is not counters',async t=>{
  const base=await mkdtemp(join(tmpdir(),'fabrique-console-m13-cli-'));t.after(()=>rm(base,{recursive:true,force:true}));
  const root=join(base,'mc'),claudeHome=join(base,'claude'),codexHome=join(base,'codex'),cwd=join(base,'wt','XJ-2');
  const {createMissionRegistry}=await import('../src/mission.mjs'),{clean}=await import('../src/common.mjs');
  const {execFile}=await import('node:child_process'),{promisify}=await import('node:util'),{fileURLToPath}=await import('node:url');
  const made=await createMissionRegistry({root}).create({project:'example',issue:null,request:'Payer'});
  const traces=createTraces({root,env:{},home:base,claudeHome,codexHome});
  const {trace}=await traces.open({mission:made.mission.id,ticket:'XJ-2',role:'dev',cwd,argv:['claude','go']});
  const file=join(claudeHome,'projects',claudeProjectFolder(cwd),trace.key+'.jsonl');
  await mkdir(dirname(file),{recursive:true});
  await writeFile(file,[prompt(1),answer('m1',(Date.now()-T0)/MIN,[10,20,30,4])].join('\n')+'\n');
  const env={PATH:process.env.PATH,HOME:base,FABRIQUE_CONSOLE_HOME:root,CLAUDE_CONFIG_DIR:claudeHome,CODEX_HOME:codexHome};
  const {stdout}=await promisify(execFile)(process.execPath,[fileURLToPath(new URL('../src/cli.mjs',import.meta.url)),'mission-read',JSON.stringify({mission:made.mission.id})],{env});
  const printed=JSON.parse(stdout);
  assert.equal(printed.ok,true);
  assert.deepEqual(printed.data.tokens.tickets['XJ-2'],{...claudeSums(10,20,30,4),unknown:0,agents:[{role:'dev',tool:'claude',turn:1,state:'counted',...claudeSums(10,20,30,4)}]});
  assert.deepEqual(printed.data.tokens.agents,[{role:'dev',tool:'claude',...claudeSums(10,20,30,4)}]);
  assert.equal(printed.data.tokens.estimate,true);
  assert.doesNotMatch(stdout,/SECRET/);
  // Positive controls: under `tokens`, anything that is not the counters of mission-read is masked as before.
  const counts={tickets:{'XJ-2':{in:1,out:2,input:1,cacheRead:0,cacheWrite:null,unknown:0,agents:[{role:'review-1',tool:'codex',turn:1,state:'unknown',reason:'too-large',in:null,out:null,input:null,cacheRead:null,cacheWrite:null}]}},agents:[{role:'dev',tool:'claude',in:1,out:2,input:1,cacheRead:0,cacheWrite:0}]};
  assert.deepEqual(clean({tokens:counts}),{tokens:counts});
  // The estimate, a partial launch and a shared one cross as well (decision 106).
  const estimated={estimate:true,tickets:{'XJ-2':{...counts.tickets['XJ-2'],agents:[{...counts.tickets['XJ-2'].agents[0],reason:'shared'},{role:'dev',tool:'claude',turn:1,state:'counted',partial:true,in:1,out:2,input:1,cacheRead:0,cacheWrite:0}]}},agents:counts.agents};
  assert.deepEqual(clean({tokens:estimated}),{tokens:estimated});
  for(const masked of [{...estimated,estimate:'yes'},{...estimated,tickets:{'XJ-2':{...estimated.tickets['XJ-2'],agents:[{...estimated.tickets['XJ-2'].agents[1],partial:'x'}]}}}])
    assert.deepEqual(clean({tokens:masked}),{tokens:'[redacted]'},JSON.stringify(masked));
  for(const masked of ['ghp_abc',{access:'x'},{tickets:{},agents:[],access:'x'},{tickets:{'XJ-2':{...counts.tickets['XJ-2'],in:'lin_key'}},agents:[]},
    {tickets:{},agents:[{role:'dev',tool:'claude',in:1,out:1,input:1,cacheRead:0,cacheWrite:0,note:'x'}]},{tickets:{},agents:[{role:['Bearer','fixture-role'].join(' '),tool:'claude',in:1,out:1,input:1,cacheRead:0,cacheWrite:0}]},
    {tickets:{'a b':{...counts.tickets['XJ-2']}},agents:[]},{tickets:{'XJ-2':{...counts.tickets['XJ-2'],agents:[{...counts.tickets['XJ-2'].agents[0],reason:'secret'}]}},agents:[]},[1,2]])
    assert.deepEqual(clean({tokens:masked}),{tokens:'[redacted]'},JSON.stringify(masked));
  assert.deepEqual(clean({apiToken:'x',accessToken:{in:1}}),{apiToken:'[redacted]',accessToken:'[redacted]'});
});

// M13 review, P2: a counter that is absent or not a whole number is unknown, never zero, for Claude as for Codex.
test('a counter absent or not a whole number makes its agent unknown (unreadable) and every total it is part of',async t=>{
  const usage=(input,cacheWrite,cacheRead,output)=>({input_tokens:input,cache_creation_input_tokens:cacheWrite,cache_read_input_tokens:cacheRead,output_tokens:output});
  const claudeWith=(id,minutes,u)=>{const e=JSON.parse(answer(id,minutes,[0,0,0,0]));e.message.usage=u;return JSON.stringify(e);};
  const codexWith=(minutes,total)=>{const e=JSON.parse(count(minutes,[0,0,0]));e.payload.info.total_token_usage=total;return JSON.stringify(e);};
  const bad=['unreadable',-1,1.5,null,undefined,'12'];
  for(const value of bad){
    const w=await world(t);
    w.at(0);const dev=await w.open('XJ-2','dev',['claude','go']);
    await w.write(w.claudeFile(dev.key),[answer('m1',1,[10,0,0,5]),claudeWith('m2',2,usage(value,0,0,1))]);
    w.at(10);const rev=await w.open('XJ-2','review-1',['codex','review']);await w.traces.link({key:rev.key,session:A});
    await w.write(w.rollout(A,10),[count(11,[100,0,10]),codexWith(12,{input_tokens:200,cached_input_tokens:value,output_tokens:20})]);
    w.at(20);const other=await w.open('XJ-3','dev',['claude','go']);
    await w.write(w.claudeFile(other.key),[claudeWith('o1',21,usage(1,2,3,value))]);
    const tokens=await w.read(),ticket=tokens.tickets['XJ-2'];
    assert.deepEqual(ticket.agents.map(a=>[a.role,a.state,a.reason,a.in,a.out]),[['dev','unknown','unreadable',null,null],['review-1','unknown','unreadable',null,null]],String(value));
    assert.deepEqual([ticket.in,ticket.out,ticket.input,ticket.cacheRead,ticket.cacheWrite,ticket.unknown],[null,null,null,null,null,2]);
    assert.deepEqual([tokens.tickets['XJ-3'].agents[0].reason,tokens.tickets['XJ-3'].out],['unreadable',null]);
    assert.ok(tokens.agents.every(a=>a.in===null&&a.out===null),'the totals by role and tool are unknown too');
  }
  // A counter of zero is known.
  const w=await world(t);
  w.at(0);const dev=await w.open('XJ-2','dev',['claude','go']);
  await w.write(w.claudeFile(dev.key),[claudeWith('z1',1,usage(0,0,0,0))]);
  assert.deepEqual((await w.read()).tickets['XJ-2'].agents[0].state,'counted');
});

// M13 review, P2: the reading and the memory are bounded. Beyond a limit the session is unknown, with its reason,
// never a part of it shown as the whole.
test('a line or a file beyond its limit makes the session unknown (too-large); a long line with no counter is passed over',async t=>{
  const w=await world(t),limits={line:600,file:4000};
  const tokens=createTicketTokens({traces:w.traces,limits,reuseFor:0}),read=()=>tokens.read({mission:'M-1'});
  const long=minutes=>JSON.stringify({type:'user',timestamp:new Date(T0+minutes*MIN).toISOString(),message:{role:'user',content:'x'.repeat(2000)}});
  const longAnswer=(id,minutes)=>{const e=JSON.parse(answer(id,minutes,[1,0,0,1]));e.message.content[0].text='y'.repeat(2000);return JSON.stringify(e);};
  w.at(0);const quiet=await w.open('XJ-2','dev',['claude','go']);
  await w.write(w.claudeFile(quiet.key),[long(1),answer('m1',1,[10,0,0,5])]);
  w.at(10);const wide=await w.open('XJ-3','dev',['claude','go']);
  await w.write(w.claudeFile(wide.key),[answer('w1',11,[10,0,0,5]),longAnswer('w2',12)]);
  w.at(20);const big=await w.open('XJ-4','dev',['claude','go']);
  await w.write(w.claudeFile(big.key),[answer('b0',21,[1,0,0,1]),long(21),long(22),long(23)]);
  w.at(40);const rev=await w.open('XJ-6','review-1',['codex','review']);await w.traces.link({key:rev.key,session:A});
  const longCount=JSON.parse(count(41,[100,0,10]));longCount.payload.rate_limits.note='z'.repeat(2000);
  await w.write(w.rollout(A,40),[count(41,[50,0,5]),JSON.stringify(longCount)]);
  let found=await read();
  assert.deepEqual([found.tickets['XJ-2'].agents[0].state,found.tickets['XJ-2'].in],['counted',10],'a long line that carries no counter is passed over');
  for(const k of ['XJ-3','XJ-4','XJ-6'])assert.deepEqual([found.tickets[k].agents[0].state,found.tickets[k].agents[0].reason,found.tickets[k].in],['unknown','too-large',null],k);
  // The file replaced by a smaller one: counted again.
  await rm(w.claudeFile(big.key));await w.write(w.claudeFile(big.key),[answer('b0',21,[1,0,0,1])]);
  found=await read();
  assert.deepEqual([found.tickets['XJ-4'].agents[0].state,found.tickets['XJ-4'].in],['counted',1]);
});

test('a line still being written is read once it is whole; a rewrite of the same size is seen',async t=>{
  const w=await world(t);
  w.at(0);const dev=await w.open('XJ-2','dev',['claude','go']);
  const whole=answer('m2',2,[7,0,0,3]);
  await w.write(w.claudeFile(dev.key),[answer('m1',1,[10,0,0,5])]);
  await appendFile(w.claudeFile(dev.key),whole.slice(0,-10));
  assert.deepEqual([(await w.read()).tickets['XJ-2'].agents[0].state,(await w.read()).tickets['XJ-2'].in],['counted',10]);
  await appendFile(w.claudeFile(dev.key),whole.slice(-10)+'\n');
  assert.equal((await w.read()).tickets['XJ-2'].in,17);
  // The same size, other numbers (a rewrite in place): read again from its start.
  const {utimes}=await import('node:fs/promises');
  await writeFile(w.claudeFile(dev.key),[answer('m1',1,[20,0,0,5]),answer('m2',2,[8,0,0,3])].join('\n')+'\n');
  await utimes(w.claudeFile(dev.key),new Date(T0+99*MIN),new Date(T0+99*MIN));
  assert.equal((await w.read()).tickets['XJ-2'].in,28);
});

// M13 review 2, P3: a running total of Codex that is null, absent or not an object cannot be read, before or after a
// valid one; only a token_count with no info at all (Codex writes it before any usage, rate limits only) is passed over.
test('a Codex total null, absent or not an object makes the reviewer unknown (unreadable); no info at all is passed over',async t=>{
  const codexWith=(minutes,info)=>{const e=JSON.parse(count(minutes,[0,0,0]));if(info===undefined)delete e.payload.info;else e.payload.info=info;return JSON.stringify(e);};
  const totalOf=total=>{const e=JSON.parse(count(0,[0,0,0])).payload.info;if(total===undefined)delete e.total_token_usage;else e.total_token_usage=total;return e;};
  for(const [label,info] of [['null',totalOf(null)],['absent',totalOf(undefined)],['text',totalOf('12')],['number',totalOf(5)],['info text',' ']]){
    for(const before of [true,false]){
      const w=await world(t);
      w.at(10);const rev=await w.open('XJ-2','review-1',['codex','review']);await w.traces.link({key:rev.key,session:A});
      await w.write(w.rollout(A,10),before?[count(11,[100,0,10]),codexWith(12,info)]:[codexWith(11,info),count(12,[100,0,10])]);
      const tokens=await w.read(),ticket=tokens.tickets['XJ-2'];
      assert.deepEqual([ticket.agents[0].state,ticket.agents[0].reason,ticket.in,ticket.out,ticket.input,ticket.cacheRead],['unknown','unreadable',null,null,null,null],`${label}, ${before?'after':'before'} a valid total`);
      assert.deepEqual([tokens.agents[0].in,tokens.agents[0].out],[null,null]);
    }
  }
  for(const info of [null,undefined]){
    const w=await world(t);
    w.at(10);const rev=await w.open('XJ-2','review-1',['codex','review']);await w.traces.link({key:rev.key,session:A});
    await w.write(w.rollout(A,10),[codexWith(11,info),count(12,[100,0,10]),codexWith(13,info)]);
    assert.deepEqual((await w.read()).tickets['XJ-2'].agents[0].state,'counted',String(info));
  }
});

// A session file whose reading runs `during` once its first chunk is read (an agent writing while it is read).
function duringRead(t,file,during){
  const promises=require('node:fs/promises'),open=promises.open;
  const restore=()=>{promises.open=open;syncBuiltinESMExports();};
  t.after(restore);
  promises.open=async(...args)=>{
    const handle=await open(...args);
    if(args[0]!==file)return handle;
    const read=handle.read.bind(handle);let done=false;
    handle.read=async(...more)=>{const got=await read(...more);if(!done){done=true;during();}return got;};
    return handle;
  };
  syncBuiltinESMExports();
  return restore;
}

// M13 review 4 and decision 106: every reading reads the sessions in full; a session that moves while it is read (an
// agent at work) gives an estimate from what was read, never unknown.
test('review 5: a session that grows while it is read gives an estimated number (partial), then the whole',async t=>{
  const w=await world(t);
  w.at(0);const dev=await w.open('XJ-2','dev',['claude','go']);
  const file=w.claudeFile(dev.key),filler=JSON.stringify({type:'user',message:{content:'x'.repeat(70000)}});
  await w.write(file,[answer('m1',1,[10,0,0,1]),filler,answer('m2',2,[30,0,0,1])]);
  const restore=duringRead(t,file,()=>appendFileSync(file,answer('m3',3,[5,0,0,1])+'\n'));
  const found=await w.read();
  assert.equal(found.estimate,true,'the numbers are an estimate');
  assert.deepEqual(found.tickets['XJ-2'].agents[0],{role:'dev',tool:'claude',turn:1,state:'counted',partial:true,...claudeSums(40,0,0,2)});
  assert.deepEqual([found.tickets['XJ-2'].in,found.tickets['XJ-2'].unknown,found.agents[0].in],[40,0,40]);
  restore();
  assert.deepEqual([(await w.read()).tickets['XJ-2'].in,Object.hasOwn((await w.read()).tickets['XJ-2'].agents[0],'partial')],[45,false],'the next reading reads it in full');
});

test('review 5: a session rewritten while it is read gives an estimate from what was read, then the whole',async t=>{
  const w=await world(t);
  w.at(0);const dev=await w.open('XJ-2','dev',['claude','go']);
  const file=w.claudeFile(dev.key),filler=JSON.stringify({type:'user',message:{content:'x'.repeat(70000)}});
  await w.write(file,[answer('m1',1,[10,0,0,1]),filler,answer('m2',2,[30,0,0,1])]);
  const rewritten=[answer('m1',1,[90,0,0,1]),filler,answer('m2',2,[20,0,0,1]),answer('m3',3,[0,0,0,1])].join('\n')+'\n';
  const restore=duringRead(t,file,()=>writeFileSync(file,rewritten));
  const found=(await w.read()).tickets['XJ-2'];
  assert.deepEqual([found.agents[0].state,found.agents[0].partial,found.in],['counted',true,30]);
  restore();
  assert.equal((await w.read()).tickets['XJ-2'].in,110,'the next reading reads it in full');
});

// M13 review 5, P2 1: a launch whose reading fails still names the answers it had read; the launch that shares one of
// them is unknown (shared), whichever is read first (the launches are read by their start: M13 review 6, P3).
test('review 5: an answer read before a reading fails is not counted for another launch as its own',async t=>{
  for(const failedFirst of [false,true]){
    const w=await world(t);
    const counted=async(minutes,ticket)=>{w.at(minutes);const l=await w.open(ticket,'dev',['claude','go']);await w.write(w.claudeFile(l.key),[answer('a1',minutes+1,[10,0,0,1]),answer('s1',minutes+2,[20,0,0,1])]);};
    const failing=async(minutes,ticket)=>{w.at(minutes);const l=await w.open(ticket,'dev',['claude','go']);await w.write(w.claudeFile(l.key),[answer('b1',minutes+1,[1,0,0,1]),answer('s1',minutes+2,[20,0,0,1]),'{"type":"assistant","message":{"usage":{"input_tok']);};
    if(failedFirst){await failing(0,'XJ-3');await counted(10,'XJ-2');}else{await counted(0,'XJ-2');await failing(10,'XJ-3');}
    const order=(await w.traces.ofMission('M-1')).map(trace=>trace.ticket);
    assert.deepEqual(order,failedFirst?['XJ-3','XJ-2']:['XJ-2','XJ-3'],'the failed launch is read first, then second');
    const found=await w.read();
    assert.deepEqual(['XJ-2','XJ-3'].map(k=>[found.tickets[k].agents[0].state,found.tickets[k].agents[0].reason,found.tickets[k].in]),
      [['unknown','shared',null],['unknown','unreadable',null]],`failed first: ${failedFirst}`);
  }
  // Nothing in common: the launch that was read keeps its number.
  const w=await world(t);
  w.at(0);const ok=await w.open('XJ-2','dev',['claude','go']);await w.write(w.claudeFile(ok.key),[answer('a1',1,[10,0,0,1])]);
  w.at(10);const bad=await w.open('XJ-3','dev',['claude','go']);await w.write(w.claudeFile(bad.key),[answer('b1',11,[1,0,0,1]),'{"type":"assistant","message":{"usage":{"input_tok']);
  const found=await w.read();
  assert.deepEqual(['XJ-2','XJ-3'].map(k=>[found.tickets[k].agents[0].reason??'counted',found.tickets[k].in]),[['counted',10],['unreadable',null]]);
});

// M13 review 6, P2: the answers kept after failed readings take their place in the entries; beyond, the launch
// concerned is unknown (too-large), and so is every Claude launch: none is ever counted wrong.
test('review 6: failed readings one after the other never keep more answers than the limit',async t=>{
  const w=await world(t);
  for(let k=0;k<4;k++){
    w.at(k*10);const l=await w.open('XJ-'+(k+2),'dev',['claude','go']);
    await w.write(w.claudeFile(l.key),[answer(`f${k}a`,k*10+1,[1,0,0,1]),answer(`f${k}b`,k*10+2,[1,0,0,1]),'{"type":"assistant","message":{"usage":{"input_tok']);
  }
  w.at(50);const ok=await w.open('XJ-9','dev',['claude','go']);
  await w.write(w.claudeFile(ok.key),[answer('f3a',51,[1,0,0,1]),answer('o1',52,[5,0,0,1])]);
  // The answers kept: the only Map of the reading whose values are launches.
  let most=0;const set=Map.prototype.set;
  Map.prototype.set=function(key,value){const r=set.call(this,key,value);if(value&&typeof value==='object'&&!Array.isArray(value)&&'trace' in value)most=Math.max(most,this.size);return r;};
  let found;
  try{found=await createTicketTokens({traces:w.traces,limits:{entries:2},reuseFor:0}).read({mission:'M-1'});}
  finally{Map.prototype.set=set;}
  assert.ok(most<=2,`answers kept: ${most}, limit 2`);
  assert.deepEqual(['XJ-2','XJ-3','XJ-4','XJ-5','XJ-9'].map(k=>[found.tickets[k].agents[0].reason,found.tickets[k].in]),
    [['unreadable',null],['too-large',null],['too-large',null],['too-large',null],['too-large',null]]);
});

test('review 4: a rewrite of the same size and the same time is counted from its new content',async t=>{
  const w=await world(t);
  w.at(0);const dev=await w.open('XJ-2','dev',['claude','go']);
  const file=w.claudeFile(dev.key),when=new Date(T0+5*MIN);
  await w.write(file,[answer('m1',1,[30,0,0,1])]);await utimes(file,when,when);
  assert.equal((await w.read()).tickets['XJ-2'].in,30);
  await writeFile(file,answer('m1',1,[90,0,0,1])+'\n');await utimes(file,when,when);
  assert.equal((await w.read()).tickets['XJ-2'].in,90);
});

test('review 4: a session shared by several launches is unknown (shared) for each of them, Claude and Codex',async t=>{
  const w=await world(t);
  w.at(0);const dev=await w.open('XJ-2','dev',['claude','go']);
  await w.write(w.claudeFile(dev.key),[answer('m1',1,[10,0,0,1]),answer('m2',12,[20,0,0,1]),answer('m3',22,[5,0,0,1])]);
  w.at(10);await w.open('XJ-2','dev',['claude','--resume',dev.key,'go']);
  w.at(20);await w.open('XJ-2','dev',['claude','--resume',dev.key,'go']);
  w.at(30);const rev=await w.open('XJ-3','review-1',['codex','review']);await w.traces.link({key:rev.key,session:A});
  await w.write(w.rollout(A,30),[count(31,[100,0,10]),count(42,[150,0,20]),count(52,[160,0,25])]);
  w.at(40);await w.open('XJ-3','review-1',['codex','resume',A,'again']);
  w.at(50);await w.open('XJ-3','review-1',['codex','resume',A,'again']);
  w.at(60);const alone=await w.open('XJ-4','dev',['claude','go']);
  await w.write(w.claudeFile(alone.key),[answer('a1',61,[7,0,0,1])]);
  const found=await w.read();
  for(const k of ['XJ-2','XJ-3']){
    assert.deepEqual(found.tickets[k].agents.map(a=>[a.state,a.reason,a.in]),Array(3).fill(['unknown','shared',null]),k);
    assert.equal(found.tickets[k].in,null);
  }
  assert.equal(found.tickets['XJ-4'].in,7,'a session of one launch is counted');
});

test('review 4: an agent beyond the limit gives nothing to another: answers shared between sessions are unknown',async t=>{
  const w=await world(t);
  w.at(0);const first=await w.open('XJ-2','dev',['claude','go']);
  await w.write(w.claudeFile(first.key),[answer('y1',1,[10,0,0,1]),answer('s1',12,[20,0,0,1])]);
  w.at(10);const second=await w.open('XJ-3','dev',['claude','go']);
  await w.write(w.claudeFile(second.key),[answer('x1',11,[1,0,0,1])]);
  await w.write(join(dirname(w.claudeFile(second.key)),second.key,'subagents','agent-a.jsonl'),[answer('s1',12,[20,0,0,1]),answer('x2',13,[2,0,0,1])]);
  // Read in full: the answer found in the files of two launches belongs to neither for sure.
  let found=await w.read();
  assert.deepEqual(['XJ-2','XJ-3'].map(k=>[found.tickets[k].agents[0].reason,found.tickets[k].in]),[['shared',null],['shared',null]]);
  // Beyond the limit: the launch concerned is unknown and nothing of it goes to another.
  found=await createTicketTokens({traces:w.traces,limits:{entries:4},reuseFor:0}).read({mission:'M-1'});
  assert.deepEqual(['XJ-2','XJ-3'].map(k=>[found.tickets[k].agents[0].state,found.tickets[k].in]),[['unknown',null],['unknown',null]]);
  assert.equal(found.tickets['XJ-3'].agents[0].reason,'too-large');
});

test('the entries of a reading are bounded, unique ones only: beyond, Claude launches are all unknown, a Codex launch alone',async t=>{
  const w=await world(t),read=limits=>createTicketTokens({traces:w.traces,limits,reuseFor:0}).read({mission:'M-1'});
  w.at(0);const rev=await w.open('XJ-2','review-1',['codex','review']);await w.traces.link({key:rev.key,session:A});
  // Three copies of one total take one place.
  await w.write(w.rollout(A,0),[count(1,[100,0,10]),count(1,[100,0,10]),count(1,[100,0,10])]);
  w.at(10);const other=await w.open('XJ-3','review-1',['codex','review']);await w.traces.link({key:other.key,session:B});
  await w.write(w.rollout(B,10),[count(11,[50,0,5]),count(12,[60,0,6])]);
  let found=await read({entries:2});
  assert.deepEqual(['XJ-2','XJ-3'].map(k=>[found.tickets[k].agents[0].reason??'counted',found.tickets[k].in]),[['counted',100],['too-large',null]]);
  w.at(20);const dev=await w.open('XJ-4','dev',['claude','go']);
  await w.write(w.claudeFile(dev.key),[answer('m1',21,[1,0,0,1])]);
  w.at(30);const big=await w.open('XJ-5','dev',['claude','go']);
  await w.write(w.claudeFile(big.key),[answer('n1',31,[1,0,0,1]),answer('n2',32,[1,0,0,1])]);
  found=await read({entries:4});
  assert.deepEqual(['XJ-2','XJ-3','XJ-4','XJ-5'].map(k=>found.tickets[k].in),[100,60,null,null]);
  assert.deepEqual(['XJ-4','XJ-5'].map(k=>found.tickets[k].agents[0].reason),['too-large','too-large']);
});

test('the launches of a mission and the sub-agents of a session are bounded, beyond them unknown (too-large)',async t=>{
  const w=await world(t),read=limits=>createTicketTokens({traces:w.traces,limits,reuseFor:0}).read({mission:'M-1'});
  w.at(0);const dev=await w.open('XJ-2','dev',['claude','go']);
  await w.write(w.claudeFile(dev.key),[answer('m1',1,[1,0,0,1])]);
  for(const n of ['a','b'])await w.write(join(dirname(w.claudeFile(dev.key)),dev.key,'subagents','deep',`agent-${n}.jsonl`),[answer('s'+n,2,[1,0,0,1])]);
  w.at(10);await w.open('XJ-3','qa',['claude','go']);
  assert.equal((await read({})).tickets['XJ-2'].in,3);
  assert.deepEqual((await read({subagents:1})).tickets['XJ-2'].agents[0].reason,'too-large');
  assert.ok((await read({agents:1})).tickets['XJ-2'].agents.every(a=>a.reason==='too-large'));
});

test('a whole result is given again as it is for at most a minute, then read again',async t=>{
  const w=await world(t);let clock=0;
  const tokens=createTicketTokens({traces:w.traces,now:()=>clock}),read=()=>tokens.read({mission:'M-1'});
  w.at(0);const dev=await w.open('XJ-2','dev',['claude','go']);
  await w.write(w.claudeFile(dev.key),[answer('m1',1,[10,0,0,1])]);
  const first=await read();
  await w.write(w.claudeFile(dev.key),[answer('m2',2,[5,0,0,1])]);
  clock=59999;assert.equal(await read(),first,'the same result, not completed');
  clock=60000;assert.equal((await read()).tickets['XJ-2'].in,15);
});
