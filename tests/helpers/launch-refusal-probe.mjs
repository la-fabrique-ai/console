// The page of a ticket loaded as it runs in Herdr (vm modules), its drawing faked, its transport the real engine:
// « Approve and start the dev » on a mission whose project declares an environment never checked. The engine refuses
// (ENVIRONMENT_NOT_READY, decision 111) and the page says its words. Run by tests/m6b-launch-refusal.test.mjs.
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,readFileSync,realpathSync,rmSync,writeFileSync} from 'node:fs';
import {readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {SourceTextModule,SyntheticModule} from 'node:vm';

const root=process.argv[2]??process.cwd(),dir=resolve(root,'mods/fabrique-console-v4-ticket');
const engine=name=>import(pathToFileURL(resolve(root,name)).href);
const {createMissionActions,createMissionRegistry,APPROVAL}=await engine('src/mission.mjs');
const {createQuestionRegistry}=await engine('src/questions.mjs');
const {createRequestRegistry}=await engine('src/requests.mjs');
const {createEnvironmentView}=await engine('src/environment-view.mjs');
const {planOf}=await engine('src/plan.mjs');
const {AppError}=await engine('src/common.mjs');
const {configV2}=await engine('tests/helpers/config-v2-fixture.mjs');
const {sampleEnvironment}=await engine('tests/helpers/environment-sample.mjs');
const {fakeHerdr}=await engine('tests/helpers/fake-herdr.mjs');

// The state of the engine: a project declaring an environment, never checked; a mission of it, its plan recorded, its
// Lead alive and idle.
const home=realpathSync(mkdtempSync(join(tmpdir(),'mc-launch-refusal-')));
try {
  const state=join(home,'state');mkdirSync(state);
  const config=configV2();config.projects[0].repos.splice(1);config.projects[0].repos[0].path=join(home,'repo');config.projects[0].environment=sampleEnvironment();
  writeFileSync(join(state,'config.json'),JSON.stringify(config));
  const view=createEnvironmentView({root:state,loadConfig:async()=>JSON.parse(readFileSync(join(state,'config.json'),'utf8')),check:async()=>{throw new Error('never run');}});
  const missions=createMissionRegistry({root:home}),questions=createQuestionRegistry({root:home});
  const {window}=fakeHerdr({agents:[{address:'t7',space:'sp1',tab:'x7',tab_name:'XJ-1 · Lead',status:'idle'}]}).herdr;
  const sent=[];
  const actions=createMissionActions({root:home,registry:missions,questions,inbox:createRequestRegistry({root:home,questions,missions,notify:async()=>{}}),
    loadState:async()=>({sessions:[{id:'s1',terminalId:'t7'}]}),window,send:async x=>{sent.push(x);return {sent:true};},environment:view.read});
  const {mission}=await missions.create({project:'example',issue:{id:'i1',identifier:'XJ-1',title:'Paiement',url:'u'},request:'Payer',lead:{sessionId:'s1',lastSeen:null}});
  await missions.update(mission.id,m=>{m.plan={...planOf({tickets:[{id:'XJ-2',rank:1,title:'Lot',result:'R',difficulty:'standard',agent:'claude',model:'claude-sonnet-5-5',effort:'high'}]}),revision:1,savedAt:'2026-11-16T08:00:00.000Z',tracker:{verified:true}};});

  // The transport of the page, as ui/common.js gives it: the answer of the engine, a refusal thrown with its words and code.
  const calls=[],toasts=[];
  const api=async(_mod,action,input)=>{
    calls.push(action);
    if(action!=='mission-launch')return {};
    try{return await actions.launch(input);}
    catch(error){if(!(error instanceof AppError))throw error;const failure=new Error(error.message);failure.code=error.code;throw failure;}
  };
  function element(){
    const data={key:null,kids:[]};let proxy;
    proxy=new Proxy(data,{get(t,k){if(k==='child')return x=>{if(x!=null)t.kids.push(x);return proxy;};if(k==='children')return xs=>{t.kids.push(...xs.filter(x=>x!=null));return proxy;};if(k==='when')return (yes,fn)=>yes?fn(proxy):proxy;if(k in t)return t[k];return ()=>proxy;}});
    return proxy;
  }
  const shared=new Map([['fabrique-console.mission',mission.id]]);
  const real=async name=>import(pathToFileURL(resolve(dir,name)).href);
  const exports={
    'gpui-base':{ScrollHandle:null,Input:null},
    'gpui-kit':{View:class{},div:()=>element(),svg:()=>element(),image:()=>element(),PathBuilder:class{},Background:{}},
    herdr:{shared:k=>shared.get(k),setShared:(k,v)=>shared.set(k,v),run:()=>{},exec:async()=>{},agents:()=>[],window:()=>({active:true})},
    './kit.js':{snapshot:()=>({projects:[],sessions:[]}),api},
    './look.js':{v_flex:()=>element(),h_flex:()=>element(),MONO:'mono',goPilot:()=>{},goLead:()=>{},leadOfMission:()=>null,openRequest:()=>{},answerRequest:()=>{},delegateRequest:()=>{},pickMockup:()=>{},openMockup:()=>{},openQa:()=>{},qaSurface:()=>null,
      alertToast:message=>toasts.push(String(message)),alertOnce:()=>{},textBlocks:()=>element()},
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
  const page=new module.namespace.default();
  const cx={notify(){},timer:{every(){}},spawn(fn){return fn(cx);},stop_propagation(){}};
  page.poll=()=>{};page.init(null,cx);

  const before=readFileSync(join(home,'state','missions',mission.id+'.json'),'utf8');
  page.approve(await missions.read(mission.id),cx);
  // The click runs in the background of the page (cx.spawn): its end is the button free again.
  for(const end=Date.now()+15000;page.launching;){assert.ok(Date.now()<end,'the click never ends');await new Promise(r=>setTimeout(r,10));}
  assert.deepEqual(calls,['mission-launch']);
  assert.deepEqual(toasts,[APPROVAL.environment],'the page says the words of the refusal');
  assert.equal(page.launching,false,'the button is free again');
  assert.deepEqual(sent,[],'nothing asked of the Lead');
  assert.equal(readFileSync(join(home,'state','missions',mission.id+'.json'),'utf8'),before,'nothing written');
  console.log('launch: refused on the page, in the words of the engine');
}finally{rmSync(home,{recursive:true,force:true});}
