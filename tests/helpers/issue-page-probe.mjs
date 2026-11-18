// The Issue page loaded as it runs in Herdr (vm modules), with only its transport and drawing faked: an answer is
// offered only after a fresh read of the issue for that very question succeeded. Run by tests/v3-issue-page.test.mjs.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {SourceTextModule,SyntheticModule} from 'node:vm';

const root=process.argv[2]??process.cwd();
const view=await import(pathToFileURL(resolve(root,'ui/v3/view.js')));
const {T}=await import(pathToFileURL(resolve(root,'ui/v3/texts.js')));
const issue=description=>({id:'i',title:'Issue',description,comments:[],labels:[]});
const q=n=>({id:'q-'+n,askedAt:'2026-11-07T17:00:0'+n+'Z',gate:'plan',text:'Valider ?',options:['Valider']});
const flush=()=>new Promise(r=>setImmediate(r));
function element(kind='element',value){
  const data={kind,value,kids:[]};let proxy;
  proxy=new Proxy(data,{get(t,k){
    if(k==='child')return x=>{t.kids.push(x);return proxy;};
    if(k==='children')return xs=>{t.kids.push(...xs);return proxy;};
    if(k==='when')return (yes,fn)=>yes?fn(proxy):proxy;
    if(k in t)return t[k];return ()=>proxy;
  }});return proxy;
}
const countButtons=e=>!e||typeof e!=='object'?0:(e.kind==='button'?1:0)+(e.kids??[]).reduce((n,c)=>n+countButtons(c),0);
async function fixture(question=null){
  const shared=new Map([['fabrique-console.issue','i']]),po={id:'po',issueId:'i',role:'po',status:'idle',step:'plan',question};
  const calls=[],pending=[];
  const kit={v_flex:()=>element(),h_flex:()=>element(),C:{},page:()=>element(),h2:()=>element(),card:()=>element(),header:()=>element(),
    btn:(_id,text,click)=>{const e=element('button',text);e.click=click;return e;},errorBox:()=>element(),note:x=>element('note',x),chip:x=>element('chip',x),labelChip:()=>element(),pill:()=>element(),icons:()=>'',
    snapshot:()=>({sessions:[po]}),reloadSnapshot:async()=>{},api:async(_mod,action,input)=>{calls.push({action,input});if(action==='ticket-detail')return new Promise((resolve,reject)=>pending.push({input,resolve,reject}));return {sent:true};}};
  const exports={
    'gpui-kit':{View:class{},div:()=>element()},'gpui-base':{TextView:{markdown:(_id,text)=>element('markdown',text)}},
    herdr:{shared:k=>shared.get(k),setShared:(k,v)=>shared.set(k,v),run:()=>{},agents:()=>[],exec:async()=>{}},
    './kit.js':kit,'./texts.js':{T},'./view.js':view,
  };
  const module=new SourceTextModule(await readFile(process.argv[3]??resolve(root,'mods/fabrique-console-v3-issue/main.js'),'utf8'));
  await module.link(name=>{const values=exports[name];assert.ok(values,name);return new SyntheticModule(Object.keys(values),function(){for(const [k,v]of Object.entries(values))this.setExport(k,v);});});
  await module.evaluate();const instance=new module.namespace.default();
  const cx={notify(){},timer:{every(){}},spawn(fn){return fn(cx);}};instance.init(null,cx);
  const settle=async(ok,description)=>{const request=pending.shift();assert.ok(request);if(ok)request.resolve({issue:issue(description)});else request.reject(new Error('synthetic failure'));await flush();};
  return {po,calls,pending,instance,cx,settle,buttons:()=>countButtons(instance.questionBlock(po,'plan','plan'))};
}

const p=await fixture();await p.settle(true,'## Plan\nOLD');p.po.question=q(1);p.instance.tick(p.cx);
assert.equal(p.pending[0].input.refresh,true);assert.equal(p.buttons(),0);
p.instance.answerWith(p.cx,p.po,'Valider',0);assert.equal(p.calls.some(c=>c.action==='po-answer'),false);
await p.settle(false);assert.equal(p.buttons(),0);p.instance.answerWith(p.cx,p.po,'Valider',0);assert.equal(p.calls.some(c=>c.action==='po-answer'),false);
p.instance.load(p.cx,'i',true,p.instance.asked(p.po));await p.settle(true,'## Plan\nNEW');assert.equal(p.buttons(),1);
p.instance.answerWith(p.cx,p.po,'Valider',0);await flush();assert.deepEqual(p.calls.find(c=>c.action==='po-answer').input,{sessionId:'po',id:'q-1',askedAt:q(1).askedAt,text:'Valider',source:'issue-page',optionIndex:0});
console.log('I1: pending/rejected read blocks rendering and direct handler; retry enables exact answer');

const initial=await fixture(q(1));assert.equal(initial.buttons(),0);await initial.settle(true,'cached');
assert.equal(initial.pending[0].input.refresh,true);assert.equal(initial.buttons(),0);await initial.settle(true,'fresh');assert.equal(initial.buttons(),1);
console.log('I1: an initial existing question also requires refresh=true');

const changed=await fixture();await changed.settle(true,'old');changed.po.question=q(1);changed.instance.tick(changed.cx);
changed.po.question=q(2);changed.instance.tick(changed.cx);await changed.settle(true,'answer for q1');assert.equal(changed.buttons(),0);
await changed.settle(false);assert.equal(changed.buttons(),0);
changed.instance.load(changed.cx,'i',true,changed.instance.asked(changed.po));await changed.settle(true,'answer for q2');assert.equal(changed.buttons(),1);
console.log('I1: an older successful read does not authorize the replacement question');

initial.instance.load(initial.cx,'i',true,initial.instance.asked(initial.po));assert.equal(initial.buttons(),0);await initial.settle(false);
assert.equal(initial.buttons(),0,'a failed refresh takes the former read back');
console.log('I1: a failed refresh after a success offers nothing');

const queued=await fixture(q(1));await queued.settle(true,'cached');await queued.settle(true,'fresh');assert.equal(queued.buttons(),1);
const ask=queued.instance.asked(queued.po);queued.instance.load(queued.cx,'i',true,ask);queued.instance.load(queued.cx,'i',true,ask);
await queued.settle(true,'A');assert.equal(queued.buttons(),0,'a read another one waits behind offers nothing');
await queued.settle(false);assert.equal(queued.buttons(),0,'the queued read failed: nothing offered');
queued.instance.answerWith(queued.cx,queued.po,'Valider',0);await flush();assert.equal(queued.calls.some(c=>c.action==='po-answer'),false);
console.log('I1: two refreshes in a row, the first fine and the second failed, offer nothing');
