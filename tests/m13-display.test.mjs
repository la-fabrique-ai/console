import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, appendFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { createTraces, claudeProjectFolder } from '../src/traces.mjs';
import { createTicketTokens } from '../src/ticket-tokens.mjs';
import { pageStrip, pageTokens, tokensText } from '../mods/fabrique-console-v4-ticket/blocks.js';
import { lineTickets, lineDetail } from '../mods/fabrique-console-v4-ticket/line.js';

// M13 display (decisions 101, 106 and 109): the tokens the engine gives in mission-read (`tokens`, docs/backend-interface.md)
// as the page draws them, from the code of the page itself (the copies the mods load). A number counted is an estimate
// (« ≈ 490k »), an agent or a total the engine does not know is « Unknown », never 0, a partial count stays an estimate.
// Texts provisional until the user validates them (proposals of Codex, workflow-v2-wording-M10-M14-propositions.md).
const IDS=['XJ-2','XJ-3'];
const row=(id,n,state)=>({id,n,title:'Titre '+id,level:'fort',dev:'claude',model:'claude-opus-5-5',deps:[],kind:'work',delivery:'included',state,rounds:0});
const plan={format:2,tickets:IDS.map((id,i)=>({id,rank:i+1,title:'Titre '+id,result:'Résultat '+id,difficulty:'heavy',kind:'work',delivery:'included',deps:[],phase:'p1',texts:[],mockups:[]})),phases:[{id:'p1',title:'Phase'}]};
const mission={id:'M-1',project:'beta',step:'building',issue:{identifier:'XJ-1'},branch:'xj-1',tickets:[row('XJ-2',1,'dev'),row('XJ-3',2,'todo')],plan};
const tickets=lineTickets(mission);
const counted=(role,tool,inn,out,more={})=>({role,tool,turn:1,state:'counted',in:inn,out,input:0,cacheRead:0,cacheWrite:0,...more});
const unknown=(role,tool,reason='trace')=>({role,tool,turn:1,state:'unknown',reason,in:null,out:null,input:null,cacheRead:null,cacheWrite:null});
const ticketOf=agents=>{const known=agents.every(a=>a.state==='counted'),sum=k=>agents.reduce((n,a)=>n+a[k],0);
  return {in:known?sum('in'):null,out:known?sum('out'):null,input:known?0:null,cacheRead:known?0:null,cacheWrite:known?0:null,unknown:agents.filter(a=>a.state!=='counted').length,agents};};
const facts=tokens=>pageStrip({mission,tickets,story:{tokens}}).facts.filter(([name])=>name.startsWith('Tokens'));
const detail=tokens=>lineDetail({mission,tickets,id:'XJ-2',story:{tokens}}).timeline.tokens;

test('a number counted reads as an estimate everywhere: band, column, details (≈ 120k)',()=>{
  const fg2=ticketOf([counted('dev','claude',374000,30000),counted('review-1','codex',146000,11000)]);
  const tokens={estimate:true,tickets:{'XJ-2':fg2},agents:[{role:'lead',tool:'claude',in:236000,out:24400},{role:'dev',tool:'claude',in:1300000,out:106000},{role:'reviewer',tool:'codex',in:518000,out:25900}]};
  assert.deepEqual(facts(tokens),[['Tokens in','≈ 520k'],['Tokens out','≈ 41k']],'the band of the ticket in hand (screen 08)');
  const column=pageTokens({story:{tokens},tickets});
  assert.deepEqual([column.title,column.in,column.inWord,column.out,column.outWord],['Token usage · this issue','≈ 2.1M','in','≈ 156k','out']);
  assert.deepEqual(column.rows.map(r=>[r.name,r.in,r.out,r.part]),[['Lead','≈ 236k in','≈ 24k out',236000/1300000],['Dev 1','≈ 1.3M in','≈ 106k out',1],['Reviewers','≈ 518k in','≈ 26k out',518000/1300000]]);
  assert.deepEqual(detail(tokens),{title:'Token usage · this ticket',text:'≈ 520k in · ≈ 41k out · dev ≈ 374k in, review ≈ 146k in'},'the timeline of the ticket (screen 10)');
});

test('an agent the engine does not know is « Unknown », never 0, and so is every total it is part of',()=>{
  const fg2=ticketOf([counted('dev','claude',374000,30000),unknown('review-1','codex')]);
  const tokens={estimate:true,tickets:{'XJ-2':fg2},agents:[{role:'lead',tool:'claude',in:236000,out:24400},{role:'dev',tool:'claude',in:374000,out:30000},{role:'reviewer',tool:'codex',in:null,out:null}]};
  assert.deepEqual(facts(tokens),[['Tokens in','Unknown'],['Tokens out','Unknown']],'the total of the ticket');
  const column=pageTokens({story:{tokens},tickets});
  assert.deepEqual([column.in,column.out],['Unknown','Unknown'],'the total of the issue: never the sum of the known lines');
  assert.deepEqual(column.rows.map(r=>[r.name,r.in,r.out,r.part]),[['Lead','≈ 236k in','≈ 24k out',236000/374000],['Dev 1','≈ 374k in','≈ 30k out',1],['Reviewers','Unknown in','Unknown out',null]],'its line stays, without a bar');
  assert.deepEqual(detail(tokens).text,'Unknown in · Unknown out · dev ≈ 374k in, review Unknown in','the known part keeps its estimate');
  // Every reason of the engine is unknown alike; the dev unknown too.
  for(const reason of ['trace','session','unreadable','too-large','shared'])
    assert.equal(detail({estimate:true,tickets:{'XJ-2':ticketOf([unknown('dev','claude',reason)])},agents:[]}).text,'Unknown in · Unknown out · dev Unknown in',reason);
  for(const shown of [facts(tokens),pageTokens({story:{tokens},tickets}),detail(tokens)])assert.doesNotMatch(JSON.stringify(shown),/(^|[^\d.])0k|≈ 0\b/,'nothing unknown reads as zero');
});

test('a partial count stays an estimate; a real zero reads « ≈ 0 »; an absent ticket draws nothing',()=>{
  const fg2=ticketOf([counted('dev','claude',40000,2000,{partial:true})]);
  const tokens={estimate:true,tickets:{'XJ-2':fg2},agents:[{role:'dev',tool:'claude',in:40000,out:2000},{role:'qa',tool:'claude',in:0,out:0}]};
  assert.deepEqual(facts(tokens),[['Tokens in','≈ 40k'],['Tokens out','≈ 2k']]);
  assert.equal(detail(tokens).text,'≈ 40k in · ≈ 2k out · dev ≈ 40k in');
  assert.deepEqual(pageTokens({story:{tokens},tickets}).rows.map(r=>[r.name,r.in,r.out]),[['Dev 1','≈ 40k in','≈ 2k out'],['QA agent','≈ 0 in','≈ 0 out']]);
  // No count for the ticket yet: neither band facts nor a line in its timeline (nothing is said, nothing made up).
  assert.deepEqual(facts({estimate:true,tickets:{},agents:[]}),[]);
  assert.equal(detail({estimate:true,tickets:{},agents:[]}),null);
  assert.equal(lineDetail({mission,tickets,id:'XJ-2',story:null}).timeline.tokens,null);
  assert.equal(pageTokens({story:{tokens:{estimate:true,tickets:{},agents:[]}},tickets}),null);
});

test('the reviewers are one line, whatever their tools: unknown when one of them is',()=>{
  const agents=[{role:'dev',tool:'claude',in:300000,out:20000},{role:'reviewer',tool:'claude',in:100000,out:5000},{role:'reviewer',tool:'codex',in:46000,out:6000}];
  assert.deepEqual(pageTokens({story:{tokens:{estimate:true,agents}},tickets}).rows.map(r=>[r.name,r.in,r.out]),[['Dev 1','≈ 300k in','≈ 20k out'],['Reviewers','≈ 146k in','≈ 11k out']]);
  const one=pageTokens({story:{tokens:{estimate:true,agents:[...agents.slice(0,2),{role:'reviewer',tool:'codex',in:null,out:null}]}},tickets});
  assert.deepEqual([one.in,one.rows.map(r=>[r.name,r.in])],['Unknown',[['Dev 1','≈ 300k in'],['Reviewers','Unknown in']]]);
});

test('without the mark of an estimate (the simulation, the mockup), the numbers read as before',()=>{
  const tokens={tickets:{'XJ-2':{in:490000,out:38000}},agents:[{role:'dev',tool:'claude',in:490000,out:38000}]};
  assert.deepEqual(facts(tokens),[['Tokens in','490k'],['Tokens out','38k']]);
  assert.equal(pageTokens({story:{tokens},tickets}).in,'490k');
  assert.deepEqual([0,400,999499,999500,1000000].map(tokensText),['0','400','999k','1M','1M']);
});

// The real engine, then the page: a Claude dev counted from its session, a Codex reviewer that never said its session.
test('from the engine to the page: what createTicketTokens counts is drawn as an estimate, what it cannot read as « Unknown »',async t=>{
  const base=await mkdtemp(join(tmpdir(),'fabrique-console-m13-display-'));t.after(()=>rm(base,{recursive:true,force:true}));
  const T0=Date.parse('2031-03-04T09:00:00.000Z');let clock=T0,n=0;
  const claudeHome=join(base,'claude'),cwd=join(base,'wt','XJ-2');
  const traces=createTraces({root:join(base,'mc'),env:{},home:base,claudeHome,codexHome:join(base,'codex'),uuid:()=>`11111111-2222-4333-8444-${String(++n).padStart(12,'0')}`,now:()=>new Date(clock)});
  const engine=createTicketTokens({traces,reuseFor:0});
  const dev=(await traces.open({mission:'M-1',ticket:'XJ-2',role:'dev',cwd,argv:['claude','go']})).trace;
  const file=join(claudeHome,'projects',claudeProjectFolder(cwd),dev.key+'.jsonl');
  await mkdir(dirname(file),{recursive:true});
  await appendFile(file,JSON.stringify({type:'assistant',sessionId:'s',timestamp:new Date(T0+60000).toISOString(),message:{id:'m1',type:'message',role:'assistant',model:'claude-opus-5-5',content:[],usage:{input_tokens:2000,cache_creation_input_tokens:100000,cache_read_input_tokens:272000,output_tokens:30000}}})+'\n');
  const known=await engine.read({mission:'M-1'});
  assert.equal(known.estimate,true);
  assert.deepEqual(facts(known),[['Tokens in','≈ 374k'],['Tokens out','≈ 30k']]);
  assert.equal(detail(known).text,'≈ 374k in · ≈ 30k out · dev ≈ 374k in');
  clock=T0+10*60000;await traces.open({mission:'M-1',ticket:'XJ-2',role:'review-1',cwd,argv:['codex','review']});
  const read=await engine.read({mission:'M-1'});
  assert.deepEqual(facts(read),[['Tokens in','Unknown'],['Tokens out','Unknown']]);
  assert.equal(detail(read).text,'Unknown in · Unknown out · dev ≈ 374k in, review Unknown in');
  const column=pageTokens({story:{tokens:read},tickets});
  assert.deepEqual([column.in,column.out,column.rows.map(r=>[r.name,r.in,r.out])],['Unknown','Unknown',[['Dev 1','≈ 374k in','≈ 30k out'],['Reviewers','Unknown in','Unknown out']]]);
});
