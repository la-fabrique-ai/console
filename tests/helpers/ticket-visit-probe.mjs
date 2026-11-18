// Ticket M14, review 2: the page of a ticket run as in Herdr (vm modules), its loop real (init, the tick of 2 s that
// reads, the render, the acknowledgement), the real engine behind its transport (tests/helpers/m14-night.mjs), only
// its drawing and the window faked: window().active says whether the window has the focus. Run by
// tests/m14-since-visit.test.mjs with a scenario: first | inactive | absent.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {SourceTextModule,SyntheticModule} from 'node:vm';
import {night,T0,HOUR,MIN} from './m14-night.mjs';
void HOUR;

const root=process.argv[2]??process.cwd(),scenario=process.argv[3],dir=resolve(root,'mods/fabrique-console-v4-ticket');
const cleanups=[];
function element(kind='element'){
  const data={kind,key:null,kids:[]};let proxy;
  proxy=new Proxy(data,{get(t,k){
    if(k==='child')return x=>{if(x!=null)t.kids.push(x);return proxy;};
    if(k==='children')return xs=>{t.kids.push(...xs.filter(x=>x!=null));return proxy;};
    if(k==='when')return (yes,fn)=>yes?fn(proxy):proxy;
    if(k==='id')return x=>{t.key=x;return proxy;};
    if(k in t)return t[k];return ()=>proxy;
  }});return proxy;
}
// The gpui window of the page draws its paths (the heads of the line): drawn as nothing here.
globalThis.window={paint_path:()=>element('path')};
const chain=new Proxy(function(){},{get:()=>chain,apply:()=>chain});
const find=(e,id)=>!e||typeof e!=='object'?null:e.key===id?e:(e.kids??[]).reduce((hit,c)=>hit||find(c,id),null);
const texts=e=>typeof e==='string'?[e]:!e||typeof e!=='object'?[]:(e.kids??[]).flatMap(texts);

const world=await night(fn=>cleanups.push(fn));
const {c,engine,accept}=world;
// The window: { active } as herdr window() gives it; `null` for a window that says nothing; 'throw' when it fails.
let win={active:true};const acks=[],shared=new Map([['fabrique-console.v4.mission','M-1'],['layout','fabrique-console-v4-ticket']]);
const api=async(_mod,action,input)=>{
  const actions=engine();
  if(action==='mission-read')return actions.read(input);
  if(action==='mission-visit-seen'){acks.push(input);return actions.visitSeen(input);}
  return {};
};
const real=async name=>import(pathToFileURL(resolve(dir,name)).href);
const exports={
  'gpui-base':{ScrollHandle:null,Input:null},
  'gpui-kit':{View:class{},div:()=>element(),svg:()=>element('svg'),image:()=>element('image'),PathBuilder:chain,Background:chain},
  herdr:{shared:k=>shared.get(k),setShared:(k,v)=>shared.set(k,v),run:()=>{},exec:async()=>{},agents:()=>[],window:()=>{if(win==='throw')throw new Error('no window');return win;}},
  './kit.js':{snapshot:()=>({projects:[],sessions:[]}),api},
  './look.js':{v_flex:()=>element(),h_flex:()=>element(),MONO:'mono',goPilot:()=>{},goLead:()=>{},leadOfMission:()=>null,openRequest:()=>{},answerRequest:()=>{},delegateRequest:()=>{},pickMockup:()=>{},openMockup:()=>{},openQa:()=>{},qaSurface:()=>null,alertToast:()=>{},alertOnce:()=>{},textBlocks:()=>element()},
  './card.js':{ticketCard:()=>element(),cardRings:()=>element(),tagChip:()=>element(),badgeChip:()=>element(),devBadge:()=>element(),reviewerTag:()=>element()},
};
for(const name of ['words.js','nav.js','page.js','line.js','board.js','blocks.js','answers.js'])exports['./'+name]=await real(name);
const synthetic=values=>new SyntheticModule(Object.keys(values),function(){for(const [k,v]of Object.entries(values))this.setExport(k,v);});
const gpui={'gpui-kit':exports['gpui-kit'],'gpui-base':{v_flex:()=>element(),h_flex:()=>element(),InputState:null}};
const dialog=new SourceTextModule(await readFile(resolve(dir,'dialog.js'),'utf8'));
await dialog.link(name=>{assert.ok(gpui[name],name);return synthetic(gpui[name]);});
const module=new SourceTextModule(await readFile(resolve(dir,'main.js'),'utf8'));
await module.link(name=>{if(name==='./dialog.js')return dialog;const values=exports[name];assert.ok(values,name);return synthetic(values);});
await module.evaluate();
const Ticket=module.namespace.default;

// A page as Herdr runs it: init, then every 2 s its tick (read, acknowledge) and a render after each notify.
function open(){
  const page=new Ticket(),pending=[],every={};
  const cx={notify(){},timer:{every(ms,fn){(every[ms]??=[]).push(fn);}},spawn(fn){const p=Promise.resolve().then(()=>fn(cx));pending.push(p);return p;},stop_propagation(){}};
  const settle=async()=>{while(pending.length)await pending.shift();};
  let tree=null;
  const frame=async()=>{await settle();tree=page.render(null,cx);await settle();};
  const tick=async(n=1)=>{for(let k=0;k<n;k++){c.t+=2000;for(const fn of every[2000]||[])fn(cx);await frame();}};
  page.init(null,cx);
  return {page,frame,tick,since:()=>texts(find(tree,'page-since'))};
}
const factAt=async()=>{const read=await engine().read({mission:'M-1'});return read.overnight?.events.map(e=>[e.ticket,e.at])||[];};

if(scenario==='first'){
  // A first visit, nothing accepted yet: nothing drawn, nothing acknowledged, however many ticks.
  c.at(T0+20*MIN);win={active:true};
  const p=open();await p.frame();await p.tick(6);
  assert.deepEqual(p.since(),[],'nothing to draw');
  assert.deepEqual(acks,[],'a first visit that drew no line acknowledges nothing');
  // XJ-2 is accepted while the page stays open and focused: a regular reading draws it, then the page acknowledges
  // it, up to the instant of that fact.
  await accept();c.at(T0+3*HOUR+MIN);
  const facts=await factAt();assert.deepEqual(facts.map(f=>f[0]),['XJ-2']);
  await p.tick(4);
  assert.ok(p.since().includes('XJ-2 accepted'),'drawn: '+p.since().join(' | '));
  assert.deepEqual(acks,[{mission:'M-1',upTo:facts[0][1]}],'one acknowledgement, up to the instant of the fact drawn');
  await p.tick(3);assert.equal(acks.length,1,'acknowledged once');
  assert.deepEqual(await factAt(),[],'nothing left to show');
  console.log('first: nothing drawn, nothing acknowledged; a fact drawn later is acknowledged up to its instant');
}
else if(scenario==='inactive'||scenario==='absent'){
  // A visit in the evening acknowledged what it drew (the cursor at T0); XJ-2 is accepted during the night.
  c.at(T0+20*MIN);await engine().visitSeen({mission:'M-1',upTo:new Date(T0).toISOString()});await accept();
  c.at(T0+14*HOUR);
  const facts=await factAt();
  assert.deepEqual(facts.map(f=>f[0]),['XJ-2'],'XJ-2 is to show');
  // The page of the ticket shown, but in a window without the focus (or one that says nothing): the line is drawn,
  // the regular readings go on, nothing is acknowledged.
  win=scenario==='inactive'?{active:false}:'throw';
  const p=open();await p.frame();await p.tick(6);
  assert.ok(p.since().includes('XJ-2 accepted'),'drawn: '+p.since().join(' | '));
  assert.deepEqual(acks,[],'no acknowledgement while the window is not active');
  if(scenario==='absent'){win={};await p.tick(4);assert.deepEqual(acks,[],'a window without `active` is not visible');win=null;await p.tick(4);assert.deepEqual(acks,[],'no window: not visible');}
  assert.deepEqual(await factAt(),facts,'the fact is still to show');
  // The window takes the focus: a new visit, read again, drawn, then acknowledged once, up to the fact drawn.
  win={active:true};await p.tick(6);
  assert.ok(p.since().includes('XJ-2 accepted'));
  assert.deepEqual(acks,[{mission:'M-1',upTo:facts[0][1]}],'acknowledged once, up to the fact drawn');
  // It loses the focus again: still nothing more.
  win={active:false};await p.tick(4);assert.equal(acks.length,1);
  assert.deepEqual(await factAt(),[],'seen: not shown again');
  console.log(scenario+': drawn but not acknowledged without the focus; acknowledged once with it');
}
else throw new Error('scenario? '+scenario);
for(const fn of cleanups.reverse())await fn();
