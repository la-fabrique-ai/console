// The old Development screen loaded as it runs in Herdr (vm modules), its pure rules and the drawing of the box real, only
// the rest of its drawing and its transport faked (decision 78): its approval button opens the confirmation of screen 06,
// « Cancel » closes it and sends nothing, « Approve and start » alone approves. Run by tests/v4-devs-confirm.test.mjs.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {SourceTextModule,SyntheticModule} from 'node:vm';

const root=process.argv[2]??process.cwd(),dir=resolve(root,'mods/fabrique-console-v4-devs');
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
const calls=[],shared=new Map();
const real=async name=>import(pathToFileURL(resolve(dir,name)).href);
const source=await readFile(resolve(dir,'main.js'),'utf8');
// The drawing kit of the screens, faked: every name main.js takes from look.js draws an element.
const lookNames=/import\s*\{([^}]*)\}\s*from\s*'\.\/look\.js'/.exec(source)[1].split(',').map(s=>s.trim()).filter(Boolean);
const colours=new Proxy({},{get:()=>'#000000'});
const look=Object.fromEntries(lookNames.map(n=>[n,['C','AGENT_COLORS'].includes(n)?colours:n==='MONO'?'mono':n==='alertToast'?message=>calls.push({toast:String(message)}):()=>element()]));
const gpui={'gpui-kit':{View:class{},div:()=>element(),svg:()=>element('svg'),image:()=>element('image')},'gpui-base':{v_flex:()=>element(),h_flex:()=>element(),InputState:null}};
const exports={
  ...gpui,
  herdr:{shared:k=>shared.get(k),setShared:(k,v)=>shared.set(k,v),run:()=>{},exec:async()=>{},agents:()=>[]},
  './kit.js':{snapshot:()=>({projects:[],sessions:[]}),api:async(_mod,action,input)=>{calls.push({action,input});return {};}},
  './common.js':{FEED_MY_ISSUES:'feed'},
  './look.js':look,
};
for(const name of ['model.js','view.js','words.js','texts.js','nav.js','blocks.js'])exports['./'+name]=await real(name);
const synthetic=values=>new SyntheticModule(Object.keys(values),function(){for(const [k,v]of Object.entries(values))this.setExport(k,v);});
// The box itself is drawn by the real shared file, as on the page of a ticket.
const dialog=new SourceTextModule(await readFile(resolve(dir,'dialog.js'),'utf8'));
await dialog.link(name=>{assert.ok(gpui[name],name);return synthetic(gpui[name]);});
const module=new SourceTextModule(source);
await module.link(name=>{if(name==='./dialog.js')return dialog;const values=exports[name];assert.ok(values,name);return synthetic(values);});
await module.evaluate();
const {pageConfirm}=exports['./blocks.js'];
const page=new module.namespace.default();
const cx={notify(){},timer:{every(){}},spawn(fn){return fn(cx);},stop_propagation(){}};
page.poll=()=>{};page.init(null,cx);
const ticket=(id,n)=>({id,n,state:'todo',title:'Titre '+id,dev:'claude',model:'claude-opus-5-5',effort:'high',deps:[]});
const m={id:'M-1',project:'beta',step:'analysing',issue:{identifier:'PRB-41'},branch:'prb-41',tickets:[ticket('PRB-142',1),ticket('PRB-144',2)],plan:{revision:3,tickets:[]},lead:{sessionId:'s1'}};
const lead={address:'t1',status:'idle'};
const model=pageConfirm({mission:m,lead});assert.ok(model,'the box can be drawn');

// Its approval button opens the box: nothing is sent.
page.launchDevs(m,cx);
assert.equal(page.confirm,m.id,'the box is open');assert.deepEqual(calls,[],'opening sends nothing');
let box=page.confirmBox(m,model);
assert.ok(texts(box).includes('Approve the plan and start the devs?'));
assert.ok(texts(box).includes('Approve and start')&&texts(box).includes('Cancel'));
// « Cancel »: closed, nothing sent.
find(box,'confirm-cancel').click(null,cx);
assert.equal(page.confirm,null,'cancel closes');assert.deepEqual(calls,[],'cancel writes nothing');
// Opened again, « Approve and start » approves: the one command, with the revision of the plan drawn.
page.launchDevs(m,cx);box=page.confirmBox(m,model);
find(box,'confirm-go').click(null,cx);await new Promise(r=>setImmediate(r));
assert.equal(page.confirm,null,'the box closes on approval');
assert.deepEqual(calls,[{action:'mission-launch',input:{mission:'M-1',seen:3}}]);
// The veil has no click (the mockup has no action there).
page.launchDevs(m,cx);box=page.confirmBox(m,model);
assert.equal(find(box,'confirm-veil')?.click??null,null,'the veil has no click');
console.log('devs: open sends nothing, cancel writes nothing, only the confirmation approves');
