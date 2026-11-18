import {View,div,svg} from 'gpui-kit';
import {run,shared,setShared,readTextFile,props,agents} from 'herdr';
import {snapshot,feed,FEED_ERRORS} from './kit.js';
import {stateDirOf,FEED_MY_ISSUES} from './common.js';
import {projectLook} from './model.js';
import {mergeMyIssues,clockOf,waitingAgents} from './view.js';
import {projectTile,v_flex,h_flex,C,dot,fault} from './look.js';
import {W} from './words.js';
import {KEYS,SCREENS,navModel,glyphOf,missionsOf,onMachine,openCounts,watcherOf,feedLines} from './nav.js';
const MOD='fabrique-console-v4-bar',WIDE=228,NARROW=64,icon=(name,size=17)=>svg('mods/'+MOD+'/icons/'+name+'.svg').w(size).h(size).flex_none();
// The column: the logo, the general menu, the projects, the watcher. It also runs the feed for every other mod: the
// watcher's files, shared when they change (see ui/common.js).
export default class Bar extends View {
 init(_p,cx) {this.watcher=null;this.width=null;this.counted=undefined;this.counts={};feed(cx,MOD,{merge:mergeMyIssues});this.beat(cx);cx.timer.every(5000,cx=>this.beat(cx));}
 // The last beat of the watcher, from its own file: the time it shows has to move even when nothing else does.
 beat(cx) {cx.spawn(async cx=>{try{const raw=await readTextFile((await stateDirOf(MOD))+'/watcher.json');this.watcher=raw?JSON.parse(raw):null;}catch{this.watcher=null;}cx.notify();});}
 countsOf() {const kept=shared(FEED_MY_ISSUES);if(kept?.at!==this.counted){this.counted=kept?.at;this.counts=openCounts(kept?.data);}return this.counts;}
 // Folded, the column keeps its icons and the pictos of the projects. Every screen has its own column: each one takes
 // the width the user chose, once it knows its own.
 folded() {return shared(KEYS.barCollapsed)===true;}
 fit() {const want=this.folded()?NARROW:WIDE;if(this.width!=null&&Math.abs(this.width-want)>8)run('layout.resize',{id:'fabrique-console-v4-bar',px:want});}
 fold(cx) {setShared(KEYS.barCollapsed,!this.folded());this.fit();cx.notify();}
 general(name) {setShared(KEYS.mission,null);setShared(KEYS.project,null);run('layout.switch',{name});}
 openMission(id) {setShared(KEYS.project,null);setShared(KEYS.mission,id);run('layout.switch',{name:SCREENS.ticket});}
 project(key) {setShared(KEYS.project,key);run('layout.switch',{name:SCREENS.project});}
 sub(project,key) {setShared(KEYS.mission,null);setShared(KEYS.project,project);run('layout.switch',{name:key==='issues'?SCREENS.issues:SCREENS.devs});}
 entry(id,name,label,{on,count=0,fn}) {
  const folded=this.folded();
  let el=h_flex().id(id).flex_none().w_full().items_center().gap(10).py(9).rounded(10).border_1().border_color(on?C.acc:C.clear).text_size(14).font_weight(600).text_color(on?C.title:C.txt).cursor_pointer().when(on,e=>e.bg(C.acc2)).when(!on,e=>e.hover(s=>s.bg(C.card))).on_click(fn);
  el=folded?el.justify_center().relative():el.px(10);
  return el.child(icon(name))
   .when(!folded,e=>e.child(div().flex_1().min_w(0).whitespace_nowrap().child(label)))
   .when(count>0&&!folded,e=>e.child(h_flex().flex_none().min_w(20).h(20).rounded(10).bg(C.red).text_color('#FFFFFF').text_size(11).font_weight(700).items_center().justify_center().px(6).child(String(count))))
   .when(count>0&&folded,e=>e.child(div().absolute().top(5).right(7).w(8).h(8).rounded(4).bg(C.red)));
 }

 row(p,project) {
  // Folded: the picto of the project, a red dot when something waits for the user.
  if(this.folded())return [h_flex().id('project-'+p.key).flex_none().w_full().justify_center().py(5).rounded(10).relative().cursor_pointer().when(p.on,e=>e.bg(C.acc2)).when(!p.on,e=>e.hover(s=>s.bg(C.card))).on_click(()=>this.project(p.key)).child(projectTile(project)).when(Boolean(p.hot),e=>e.child(div().absolute().top(2).right(8).w(10).h(10).rounded(5).bg(C.red)))];
  return [h_flex().id('project-'+p.key).flex_none().w_full().items_center().gap(10).px(10).py(8).rounded(10).border_1().border_color(p.on?C.acc:C.clear).cursor_pointer().when(p.on,e=>e.bg(C.acc2)).when(!p.on,e=>e.hover(s=>s.bg(C.card))).on_click(()=>this.project(p.key))
    .child(projectTile(project))
    .child(v_flex().flex_1().min_w(0).child(div().truncate().text_size(13.5).font_weight(600).text_color(C.title).child(p.name)).child(div().truncate().text_size(11.5).text_color(C.dim).child(p.summary)))
    .child(h_flex().flex_none().min_w(22).h(22).rounded(11).px(6).bg(p.hot?C.red:C.chip).text_color(p.hot?'#FFFFFF':C.title).text_size(11.5).font_weight(700).items_center().justify_center().child(String(p.count))),
   ...p.missions.map(m=>h_flex().id('mission-'+p.key+'-'+m.id).flex_none().items_center().gap(6).py(4).pr(10).pl(48).rounded(8).text_size(12).text_color(C.sec).cursor_pointer().hover(s=>s.bg(C.rowOn)).on_click(()=>this.openMission(m.mission)).child(div().flex_none().child(m.id)).child(div().flex_1()).child(div().truncate().text_size(11).text_color(C.dim).child(m.phase))),
   ...(p.sub?[v_flex().flex_none().gap(1).pt(2).pb(8).pl(22).children(p.sub.map(s=>h_flex().id('sub-'+p.key+'-'+s.key).flex_none().items_center().gap(8).py(5).px(10).rounded(8).text_size(13).font_weight(s.on?600:400).text_color(s.on?C.title:C.sec).cursor_pointer().when(s.on,e=>e.bg(C.rowOn)).when(!s.on,e=>e.hover(x=>x.bg(C.rowOn))).on_click(()=>this.sub(p.key,s.key))
    .child(div().flex_1().whitespace_nowrap().child(W.glyph[s.key]+' '+W.nav[s.key])).child(div().flex_none().text_size(12).text_color(C.dim).child(String(s.count)))))]:[])];
 }
 render() {
  const data=snapshot(),machine=shared(KEYS.machine)??null,all=data.projects||[],projects=all.filter(p=>onMachine(p.machine,machine)),missions=missionsOf(shared(KEYS.missions),{machine}),items=shared(KEYS.inbox)||[];
  const nav=navModel({page:props()?.page,project:shared(KEYS.project),projects,missions,items,counts:this.countsOf(),waiting:waitingAgents(agents()).length}),byKey=new Map(all.map(p=>[p.key,p]));
  const watch=watcherOf(this.watcher,Date.now()),clock=watch.at?clockOf(watch.at):'';
  const folded=this.folded(),toggle=div().id('bar-fold').flex_none().cursor_pointer().text_color(C.dim).hover(s=>s.text_color(C.title)).on_click((_e,cx)=>this.fold(cx)).child(icon(folded?'expand':'collapse',18));
  return v_flex().id('column').on_size_change((size,_cx)=>{this.width=size.width;this.fit();}).size_full().min_h(0).min_w(0).bg(C.panel).border_r_1().border_color(C.line).text_color(C.txt).text_size(13.5).line_height(1.5)
   .child(h_flex().flex_none().w_full().h(44).gap(10).items_center().border_b_1().border_color(C.line).text_color(C.title).font_weight(600).when(folded,e=>e.justify_center()).when(!folded,e=>e.px(16).child(div().flex_1().whitespace_nowrap().child(W.brand))).child(toggle))
   .child(v_flex().flex_1().min_h(0).w_full().pt(12).pb(12).px(folded?8:10).gap(4)
    .child(v_flex().flex_none().w_full().gap(2).mb(10).pb(10).border_b_1().border_color(C.line)
     .child(this.entry('nav-inbox','inbox',W.nav.inbox,{on:nav.inbox.on,count:nav.inbox.count,fn:()=>this.general(SCREENS.inbox)}))
     .child(this.entry('nav-issues','issues',W.nav.issues,{on:nav.issues.on,fn:()=>this.general(SCREENS.issues)}))
     .child(this.entry('nav-devs','devs',W.nav.devs,{on:nav.devs.on,fn:()=>this.general(SCREENS.devs)})))
    .when(!folded,e=>e.child(h_flex().flex_none().items_center().gap(8).pt(4).pb(8).px(6).text_size(14).font_weight(600).text_color(C.title).child(icon('projects',16)).child(div().child(W.nav.projects))))
    .child(v_flex().id('projects').flex_1().min_h(0).w_full().gap(4).overflow_y_scrollbar().children(nav.projects.flatMap(p=>this.row(p,byKey.get(p.key)))))
    .children(feedLines(shared(FEED_ERRORS),shared('fabrique-console.snapshot-at')).map((text,n)=>fault(text).id('feed-error-'+n)))
    .when(Boolean(shared('fabrique-console.v3.watch-error')),e=>e.child(fault(shared('fabrique-console.v3.watch-error'))))
    .when(folded,e=>e.child(h_flex().id('watcher').flex_none().w_full().mt(4).justify_center().py(10).child(dot(watch.running?'ok':'off',10))))
    .when(!folded,e=>e.child(h_flex().id('watcher').flex_none().w_full().mt(4).items_center().gap(10).py(10).px(12).rounded(10).bg(C.card).border_1().border_color(C.line)
     .child(v_flex().flex_1().min_w(0)
      .child(h_flex().items_center().gap(6).text_size(13).font_weight(600).text_color(C.title).child(dot(watch.running?'ok':'off')).child(watch.running?W.watcher.on:W.watcher.off))
      .child(div().truncate().text_size(11.5).text_color(C.dim).child(watch.running?W.watcher.watching(clock):W.watcher.last(clock)))))));
 }
}
