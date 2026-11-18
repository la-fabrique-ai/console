// The geometry of the confirmation box (dialog.js), drawn by the real file with its styles recorded, then laid out by a
// small model of the flex boxes it uses: a column grows with its children, a fixed height or a maximum bounds it, and a
// child that may shrink (min_h(0)) gives room up to its whole height. Prints the box, its rows and its buttons for the
// window heights and the numbers of rows asked. Run by tests/v4-confirm.test.mjs.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {SourceTextModule,SyntheticModule} from 'node:vm';

const root=process.argv[2]??process.cwd(),cases=JSON.parse(process.argv[3]??'[]');
function element(kind){
  const data={kind,key:null,kids:[],styles:new Map(),click:null};let proxy;
  proxy=new Proxy(data,{get(t,k){
    if(k==='child')return x=>{if(x!=null)t.kids.push(x);return proxy;};
    if(k==='children')return xs=>{t.kids.push(...xs.filter(x=>x!=null));return proxy;};
    if(k==='id')return x=>{t.key=x;return proxy;};
    if(k==='on_click')return fn=>{t.click=fn;return proxy;};
    if(k in t)return t[k];
    return (...args)=>{t.styles.set(k,args);return proxy;};
  }});return proxy;
}
const synthetic=values=>new SyntheticModule(Object.keys(values),function(){for(const [k,v]of Object.entries(values))this.setExport(k,v);});
const gpui={'gpui-kit':{div:()=>element('div')},'gpui-base':{v_flex:()=>element('column'),h_flex:()=>element('row'),InputState:null}};
const dialog=new SourceTextModule(await readFile(resolve(root,'mods/fabrique-console-v4-ticket/dialog.js'),'utf8'));
await dialog.link(name=>{assert.ok(gpui[name],name);return synthetic(gpui[name]);});
await dialog.evaluate();
const {confirmDialog}=dialog.namespace;

const style=(e,name)=>e.styles.get(name)?.[0];
const has=(e,name)=>e.styles.has(name);
const px=(v,of)=>typeof v==='number'?v:typeof v==='string'&&v.endsWith('%')?of*Number(v.slice(0,-1))/100:typeof v==='string'&&v.endsWith('px')?Number(v.slice(0,-2)):null;
const LINE=1.4,CHAR=0.52;
// The text size an element draws with: its own, else its parent's (14 by default).
const sizeOf=(e,inherited)=>style(e,'text_size')??inherited;
const padY=e=>(style(e,'py')??style(e,'p')??0)*2+(style(e,'pt')??0)+(style(e,'pb')??0);
const padX=e=>(style(e,'px')??style(e,'p')??0)*2;
// The natural height of an element at a width: a text by its lines, a row by its tallest child, a column by the sum.
function natural(e,width,size=14) {
  if(typeof e==='string'){const lines=Math.max(1,Math.ceil(e.length*CHAR*size/Math.max(1,width)));return lines*size*LINE;}
  if(px(style(e,'h'))!=null)return px(style(e,'h'));
  const s=sizeOf(e,size),inner=width-padX(e),kids=e.kids;
  if(e.kind==='row'){
    const fixed=kids.reduce((n,k)=>n+(typeof k!=='string'&&px(style(k,'w'))!=null?px(style(k,'w')):0),0),flexible=kids.filter(k=>typeof k==='string'||px(style(k,'w'))==null).length||1;
    const gap=(style(e,'gap')??0)*Math.max(0,kids.length-1),free=Math.max(1,(inner-fixed-gap)/flexible);
    return padY(e)+Math.max(0,...kids.map(k=>natural(k,typeof k!=='string'&&px(style(k,'w'))!=null?px(style(k,'w')):free,s)));
  }
  return padY(e)+kids.reduce((n,k)=>n+natural(k,inner,s)+(typeof k==='string'?0:style(k,'mt')??0),0)+(style(e,'gap')??0)*Math.max(0,kids.length-1);
}
// The box laid out in the veil of a window `height` high: its height, then each child's top and height inside it.
function layout(box,height) {
  const width=px(style(box,'w')),size=sizeOf(box,14),inner=width-padX(box);
  const kids=box.kids.map(k=>({k,h:natural(k,inner,size),mt:typeof k==='string'?0:style(k,'mt')??0}));
  const content=padY(box)+kids.reduce((n,x)=>n+x.h+x.mt,0)+(style(box,'gap')??0)*Math.max(0,kids.length-1);
  const max=px(style(box,'max_h'),height),boxH=max==null?content:Math.min(content,max);
  let over=content-boxH;
  for(const x of kids)if(over>0&&typeof x.k!=='string'&&style(x.k,'min_h')===0&&!has(x.k,'flex_none')){const give=Math.min(over,x.h);x.h-=give;over-=give;}
  const top=(height-boxH)/2;let y=top+(style(box,'py')??style(box,'p')??0)+(style(box,'pt')??0);
  const placed=kids.map(x=>{y+=x.mt;const at={key:x.k.key??null,top:y,height:x.h,natural:natural(x.k,inner,size),scrolls:typeof x.k!=='string'&&['overflow_y_scroll','overflow_y_scrollbar','overflow_scrollbar'].some(n=>has(x.k,n))};y+=x.h;return at;});
  return {top,height:boxH,content,kids:placed};
}
const out=[];
for(const {rows=0,checklist=0,height} of cases) {
  const model={title:'Approve these changes?',rows:[...Array.from({length:rows},(_,n)=>({key:'drift-PRB-'+(100+n),label:'PRB-'+(100+n),text:'model: sonnet 5.5 → opus 5.5; dependencies: PRB-1 → PRB-1, PRB-2 · starts with Claude Code · opus 5.5 · high effort · Standard'})),{key:'frozen',label:'Frozen copy',text:'the preparation as you see it, dated today'}],cancel:'Cancel',go:'Approve these changes'};
  // The closure box (screen 06 of « pre-close »): a computed checklist of `checklist` rows, then the line of what it triggers.
  const closing=checklist?{title:'Close PRB-41?',checkTitle:'Checklist, computed',checklist:Array.from({length:checklist},(_,n)=>({key:'/r/app'+n+':checks',ok:true,label:'PR checks green',detail:'app'+n+': 12 of 12'})),rows:[{key:'triggers',label:'Your one approval triggers',text:'push of the branch, pull request, merge into main, closing of the ticket'}],cancel:'Cancel',go:'Approve and close'}:null;
  const veil=confirmDialog(closing||model,{cancel:()=>{},go:()=>{}}),box=veil.kids[0];
  assert.equal(box.key,'confirm-box');
  const l=layout(box,height),list=l.kids.find(k=>k.key==='confirm-rows'),buttons=l.kids.at(-1);
  out.push({rows,height,box:{top:l.top,height:l.height,content:l.content},list:{top:list.top,height:list.height,natural:list.natural,scrolls:list.scrolls},buttons:{top:buttons.top,bottom:buttons.top+buttons.height}});
}
console.log(JSON.stringify(out));
