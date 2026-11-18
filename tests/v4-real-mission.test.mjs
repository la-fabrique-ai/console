import test from 'node:test';
import assert from 'node:assert/strict';
import {planOf} from '../src/plan.mjs';
import {pageBlocks,pageSheet,pageStrip,coverageOf} from '../mods/fabrique-console-v4-ticket/blocks.js';
import {pageBand} from '../mods/fabrique-console-v4-ticket/page.js';
import {lineTickets} from '../mods/fabrique-console-v4-ticket/line.js';

// Ticket M1: the page on a real mission. The plan is the one the engine keeps (planOf of src/plan.mjs, what lead-plan
// records), not a hand-made one. Since ticket M3 its requests carry the words of the contract (short, full) and the
// tickets that cover them; a plan kept before (requests {id, text}) is still read without inventing anything.
const RAW={phases:[{id:'core',title:'Writer'},{id:'ui',title:'Button'}],
  requests:[{id:'r1',short:'Export as CSV',full:'Export every row as CSV'},{id:'r2',short:'Export button',full:'A button on the list'}],
  tickets:[
    {id:'DEMO-2',rank:1,title:'Add the CSV writer',result:'A function turns the rows into CSV text.',difficulty:'standard',agent:'codex',model:'gpt-5.5',effort:'medium',phase:'core',covers:['r1']},
    {id:'DEMO-3',rank:2,title:'Add the Export button',result:'The list has an Export button.',difficulty:'light',agent:'codex',model:'gpt-5.5',effort:'low',deps:['DEMO-2'],phase:'ui',covers:['r2'],texts:['Export button label']}]};
const row=(t,state)=>({id:t.id,uid:'uid-'+t.id,n:t.rank,title:t.title,level:t.difficulty==='light'?'léger':'standard',dev:t.agent,model:t.model,effort:t.effort,deps:t.deps,kind:t.kind,delivery:t.delivery,integratedBy:null,state,tracker:'unstarted',rounds:0,waitingAnswer:null});
const mission=(step,states={})=>{const plan={...planOf(RAW),revision:1,savedAt:'2026-11-13T21:29:44.091Z',tracker:{verified:true}};
  return {id:'M-1',project:'demo',step,issue:{id:'uid-DEMO-1',identifier:'DEMO-1',title:'Export the list as CSV',url:'https://tracker.invalid/DEMO-1'},lead:{sessionId:'s1'},branch:step==='building'?'demo-1':null,tickets:plan.tickets.map(t=>row(t,states[t.id]||'todo')),plan,decisions:[],questions:[],log:[]};};
const IDLE={address:'t2',status:'idle'},WORKING={address:'t2',status:'working'};

// A plan kept before ticket M3: its requests are {id, text}.
const before=(step,states)=>{const m=mission(step,states);m.plan.requests=[{id:'r1',text:'Export every row as CSV'},{id:'r2',text:'A button on the list'}];return m;};
test('a request kept before the words of the contract, is not drawn: no count, no row, no sheet (Prepare)',()=>{
  for(const lead of [IDLE,WORKING]){
    const mid=pageBlocks({mission:before('delegated'),lead,story:{}})[1];
    assert.deepEqual([mid.title,mid.count,mid.rows],['Issue coverage','',[]],'neither « 0 of 2 » nor « not covered »: what covers them is not read yet (ticket M3)');
  }
  assert.deepEqual(coverageOf(before('delegated'),IDLE),{list:[],total:0,covered:0,postponed:0});
  assert.equal(pageSheet({mission:before('delegated'),tickets:lineTickets(before('delegated')),lead:IDLE,story:{},open:{t:'request',id:'r1'}}),null);
  const mid=pageBlocks({mission:before('building',{'DEMO-2':'dev'}),lead:IDLE,story:{}})[1];
  assert.deepEqual([mid.title,mid.count,mid.rows],['Drift from approved plan','',[]],'nor a line in Develop');
});

test('the requests the engine keeps since ticket M3 are drawn with what covers them, in Prepare and in Develop',()=>{
  const mid=pageBlocks({mission:mission('delegated'),lead:IDLE,story:{}})[1];
  assert.deepEqual([mid.count,mid.rows.map(r=>[r.text,r.right])],['2 of 2',[['Export as CSV','2'],['Export button','3']]]);
  const dev=pageBlocks({mission:mission('building',{'DEMO-2':'dev'}),lead:IDLE,story:{}})[1];
  assert.deepEqual(dev.rows.map(r=>[r.text,r.sub]),[['Issue coverage','2 of 2 requests']]);
});

test('a request that carries the words of the contract is still drawn, next to one that does not',()=>{
  const m=mission('delegated');m.plan.requests=[{id:'r1',text:'Export every row as CSV'},{id:'r2',short:'Button',full:'A button on the list',tickets:['DEMO-3']}];
  const mid=pageBlocks({mission:m,lead:IDLE,story:{}})[1];
  assert.deepEqual([mid.count,mid.rows.map(r=>r.text)],['1 of 1',['Button']]);
});

test('what the rest of the page reads of a real mission is what the engine gives, and nothing more',()=>{
  const ready=mission('delegated'),dev=mission('building',{'DEMO-2':'dev'});
  const band=pageBand({mission:ready,lead:IDLE,items:[],qa:null,on:false,environment:null,overnight:null,pause:null});
  assert.deepEqual([band.big,band.det,band.button?.key],['The plan is ready: 2 tickets','No open question · first ticket DEMO-2 with Dev 1','approve']);
  const s=pageStrip({mission:ready,tickets:lineTickets(ready),lead:IDLE,items:[],reports:[],story:{},span:''});
  assert.deepEqual([s.title,s.text,s.button,s.facts.map(f=>f[0])],['','',null,['Execution','Heavy tickets']],'no approach, no migration: neither is drawn');
  const right=pageBlocks({mission:ready,lead:IDLE,story:{}})[2];
  assert.deepEqual(right.rows.map(r=>r.key),['copy','mockups'],'a plan without toPlan has neither manual steps, risks nor accounts');
  const run=pageBand({mission:dev,lead:IDLE,items:[],qa:null,on:true,environment:null,overnight:null,pause:null});
  assert.deepEqual([run.big,run.button],['On track: DEMO-2 in dev',undefined],'no pause from the engine: no « Pause »');
});
