// The page of a ticket loaded as it runs in Herdr (vm modules), its pure rules real, only its drawing and its transport
// faked: the banner's « Approve and start the dev » opens the confirmation of screen 06, « Cancel » closes it and sends
// nothing, « Approve and start » alone approves. Run by tests/v4-confirm.test.mjs.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {SourceTextModule,SyntheticModule} from 'node:vm';

const root=process.argv[2]??process.cwd(),dir=resolve(root,'mods/fabrique-console-v4-ticket');
function element(kind='element'){
  const data={kind,key:null,click:null,kids:[]};let proxy;
  proxy=new Proxy(data,{get(t,k){
    if(k==='child')return x=>{if(x!=null)t.kids.push(x);return proxy;};
    if(k==='children')return xs=>{t.kids.push(...xs.filter(x=>x!=null));return proxy;};
    if(k==='when')return (yes,fn)=>yes?fn(proxy):proxy;
    if(k==='id')return x=>{t.key=x;return proxy;};
    if(k==='on_click')return fn=>{t.click=fn;return proxy;};
    if(k in t)return t[k];return ()=>proxy;
  }});return proxy;
}
const find=(e,id)=>!e||typeof e!=='object'?null:e.key===id?e:(e.kids??[]).reduce((hit,c)=>hit||find(c,id),null);
const texts=e=>typeof e==='string'?[e]:!e||typeof e!=='object'?[]:(e.kids??[]).flatMap(texts);
const calls=[],shared=new Map([['fabrique-console.mission','M-1']]);
const real=async name=>import(pathToFileURL(resolve(dir,name)).href);
const exports={
  'gpui-base':{ScrollHandle:null,Input:null},
  'gpui-kit':{View:class{},div:()=>element(),svg:()=>element('svg'),image:()=>element('image'),PathBuilder:class{},Background:{}},
  herdr:{shared:k=>shared.get(k),setShared:(k,v)=>shared.set(k,v),run:()=>{},exec:async()=>{},agents:()=>[],window:()=>({active:true})},
  './kit.js':{snapshot:()=>({projects:[],sessions:[]}),api:async(_mod,action,input)=>{calls.push({action,input});return {};}},
  './look.js':{v_flex:()=>element(),h_flex:()=>element(),MONO:'mono',goPilot:()=>{},goLead:()=>{},leadOfMission:()=>null,openRequest:()=>{},answerRequest:()=>{},delegateRequest:()=>{},pickMockup:()=>{},openMockup:()=>{},openQa:()=>{},qaSurface:()=>null,
    alertToast:message=>calls.push({toast:String(message)}),alertOnce:()=>{},textBlocks:()=>element()},
  './card.js':{ticketCard:()=>element(),cardRings:()=>element(),tagChip:()=>element(),badgeChip:()=>element(),devBadge:()=>element(),reviewerTag:()=>element()},
};
for(const name of ['words.js','nav.js','page.js','line.js','board.js','blocks.js','answers.js'])exports['./'+name]=await real(name);
const synthetic=values=>new SyntheticModule(Object.keys(values),function(){for(const [k,v]of Object.entries(values))this.setExport(k,v);});
// The box is drawn by the real shared file (decision 78: the same box on the old Development screen).
const gpui={'gpui-kit':exports['gpui-kit'],'gpui-base':{v_flex:()=>element(),h_flex:()=>element(),InputState:null}};
const dialog=new SourceTextModule(await readFile(resolve(dir,'dialog.js'),'utf8'));
await dialog.link(name=>{assert.ok(gpui[name],name);return synthetic(gpui[name]);});
const module=new SourceTextModule(await readFile(resolve(dir,'main.js'),'utf8'));
await module.link(name=>{if(name==='./dialog.js')return dialog;const values=exports[name];assert.ok(values,name);return synthetic(values);});
await module.evaluate();
const {pageConfirm}=exports['./blocks.js'],{pageBand}=exports['./page.js'];
const page=new module.namespace.default();
const cx={notify(){},timer:{every(){}},spawn(fn){return fn(cx);},stop_propagation(){}};
page.poll=()=>{};page.init(null,cx);
const ticket=(id,n)=>({id,n,state:'todo',title:'Titre '+id,dev:'claude',model:'claude-opus-5-5',effort:'high',deps:[]});
const m={id:'M-1',project:'beta',step:'analysing',issue:{identifier:'PRB-41'},branch:'prb-41',tickets:[ticket('PRB-142',1),ticket('PRB-144',2)],plan:{revision:3,tickets:[]},lead:{sessionId:'s1'}};
const lead={address:'t1',status:'idle'},band=pageBand({mission:m,lead});
assert.equal(band.button?.key,'approve','the banner offers the approval');

// The banner's button opens the box: nothing is sent.
find(page.band(m,lead,band,cx),'band-main').click(null,cx);
assert.equal(page.confirm,true,'the box is open');assert.deepEqual(calls,[],'opening sends nothing');
const model=pageConfirm({mission:m,lead});
let box=page.confirmBox(m,model);
assert.ok(texts(box).includes('Approve the plan and start the devs?'));
// « Cancel »: closed, nothing sent.
find(box,'confirm-cancel').click(null,cx);
assert.equal(page.confirm,false,'cancel closes');assert.deepEqual(calls,[],'cancel writes nothing');
// Opened again, « Approve and start » approves: the one command, with the revision of the plan drawn.
find(page.band(m,lead,band,cx),'band-main').click(null,cx);box=page.confirmBox(m,model);
find(box,'confirm-go').click(null,cx);await new Promise(r=>setImmediate(r));
assert.equal(page.confirm,false,'the box closes on approval');
assert.deepEqual(calls,[{action:'mission-launch',input:{mission:'M-1',seen:3}}]);
// A click on the veil does nothing (the mockup has no action there): the box stays, nothing sent.
calls.length=0;find(page.band(m,lead,band,cx),'band-main').click(null,cx);box=page.confirmBox(m,model);
assert.equal(find(box,'confirm-veil')?.click??null,null,'the veil has no click');
console.log('confirm: open sends nothing, cancel writes nothing, only the confirmation approves');
// M7, decision 81: « Approve these changes » at the foot of the sheet « Drift from approved plan », as the page draws
// it, on a drift and a version the real engine computes: the button opens the same box as « Approve and start the dev »
// and sends nothing; the box shows what is approved; « Cancel » writes nothing; its main button alone sends the one
// command, with the version the box drew.
const engine=await import(pathToFileURL(resolve(root,'src/mission.mjs')).href);
const {pageSheet,pageReconfirm}=exports['./blocks.js'];
const planned=(id,rank,more={})=>({id,rank,title:'Titre '+id,result:'R',difficulty:'standard',agent:'claude',model:'claude-sonnet-5-5',effort:'high',deps:[],kind:'work',delivery:'included',...more});
const copy=[planned('PRB-142',1),planned('PRB-144',2)];
const dm={...m,step:'building',approval:{at:'2026-11-12T15:02:00.000Z',branch:'prb-41',plan:{format:2,tickets:copy,phases:[],requests:[]}},plan:{format:2,revision:4,tickets:[copy[0],{...copy[1],model:'claude-opus-5-5'}],phases:[],requests:[],migrations:['0025']}};
const story={approval:dm.approval,drift:engine.driftOf(dm),driftSeen:engine.driftSeenOf(dm)};
assert.match(story.driftSeen,/^[0-9a-f]{16}$/,'the engine names the version');
calls.length=0;
const drawn=pageSheet({mission:dm,tickets:[],open:{t:'list',id:'drift'},story});
let sheet=page.sheet(dm,drawn);
const at=drawn.parts.findIndex(p=>p.kind==='action');
assert.ok(at>=0,'the sheet has the button');
const button=find(sheet,'sheet-action-go-'+at);
assert.ok(button?.click,'the button is drawn and clickable');
assert.ok(texts(button).includes('Approve these changes'));
button.click(null,cx);await new Promise(r=>setImmediate(r));
assert.deepEqual(calls,[],'the button sends nothing');assert.equal(page.reconfirm,story.driftSeen,'it opens the box on the version drawn');
const reModel=pageReconfirm({story});
let reBox=page.reconfirmBox(dm,reModel);
const said=texts(reBox);
assert.ok(said.includes('Approve these changes?'),said.join(' | '));
assert.ok(said.some(t=>/PRB-144/.test(t))&&said.some(t=>/opus 5\.5/.test(t)&&/high effort/.test(t)&&/Standard/.test(t)),'the values approved: '+said.join(' | '));
assert.ok(said.includes('Migrations'),'a part of the plan too');
find(reBox,'confirm-cancel').click(null,cx);
assert.equal(page.reconfirm,null,'cancel closes');assert.deepEqual(calls,[],'cancel writes nothing');
sheet=page.sheet(dm,drawn);find(sheet,'sheet-action-go-'+at).click(null,cx);reBox=page.reconfirmBox(dm,pageReconfirm({story}));
find(reBox,'confirm-go').click(null,cx);await new Promise(r=>setImmediate(r));
assert.equal(page.reconfirm,null,'the box closes on approval');
assert.deepEqual(calls,[{action:'mission-reapprove',input:{mission:'M-1',seen:story.driftSeen}}]);
console.log('reapprove: the button opens the box, cancel writes nothing, only the box sends the version the engine gave');
