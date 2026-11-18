import {View,div} from 'gpui-kit';
import {shared,setShared,props,run} from 'herdr';
import {h_flex,v_flex,C,topBar,crumbSep,crumbPart,segment,pill,sq,icons,snapshot,api,reloadSnapshot} from './kit.js';
import {T} from './texts.js';
import {projectLook} from './model.js';
import {crumb,knownProject,stateTone,myTabOf,issueTabs,ISSUE_SCREEN} from './view.js';
const MOD='fabrique-console-v3-top',ICONS=icons(MOD),ASK_MS=4000;
const STAGE_DOT={waiting:'#E2B340',working:'#6C9BE0',toClose:'#5BB974'};
// The top bar of a page: where one is (team › page › issue), then what the page adds at the right:
// the list chosen on Issues (Backlog or every issue), the tab of My issues, the state of the issue on Issue.
export default class Top extends View {
 init(_p,cx){this.asking=null;this.stopping=new Set();this.failed=new Set();this.stopped=new Set();cx.timer.every(2000,cx=>{if(this.asking&&Date.now()-this.asking.at>ASK_MS)this.asking=null;cx.notify();});}
 right(page){
  if(page==='myIssues')return segment('my-issues-tab',Object.entries(T.myIssues.tabs),myTabOf(shared('fabrique-console.v3.my-issues-tab')),(key,_e,cx)=>{setShared('fabrique-console.v3.my-issues-tab',key);cx.notify();});
  if(page==='issue'){const head=shared('fabrique-console.v3.issue-head');return head&&head.id===shared('fabrique-console.issue')&&head.state?pill(ICONS,stateTone(head.state),head.state.name||'—'):div().h(0);}
  return div().h(0);
 }
 // A tab: the issue of a PO session; a click shows its Issue page. The cross stops the PO (its terminal is killed):
 // a first click asks, a second one within four seconds stops; the tab goes once the PO is stopped.
 open(s){setShared('fabrique-console.project',s.projectKey);setShared('fabrique-console.issue',s.issueId);setShared('fabrique-console.session',s.id);run('layout.switch',{name:ISSUE_SCREEN});}
 cross(s,cx){
  if(this.stopping.has(s.id)||this.stopped.has(s.id))return;
  if(this.asking?.id!==s.id||Date.now()-this.asking.at>ASK_MS){this.asking={id:s.id,at:Date.now()};this.failed.delete(s.id);cx.notify();return;}
  this.asking=null;this.stopping.add(s.id);cx.notify();
  cx.spawn(async cx=>{
   // The stop and the read after it are two facts: a stop done whose read failed says so, not that the stop failed.
   let done=false;
   try{await api(MOD,'stop',{sessionId:s.id,confirmed:true});done=true;await reloadSnapshot(MOD);}
   catch{if(done)this.stopped.add(s.id);else this.failed.add(s.id);}
   finally{this.stopping.delete(s.id);cx.notify();}
  });
 }
 tab(t,on){
  const s=t.session,asking=this.asking?.id===s.id,stopping=this.stopping.has(s.id),failed=this.failed.has(s.id),stopped=this.stopped.has(s.id);
  const word=stopping?T.tabs.stopping:stopped?T.tabs.stoppedStale:asking?T.tabs.stopAsk:failed?T.tabs.stopFailed:null;
  return h_flex().id('tab-'+s.id).flex_none().h(26).px(10).gap(7).items_center().rounded(6).cursor_pointer()
   .when(on,e=>e.bg(C.selected)).text_color(on?C.title:C.tertiary).hover(e=>e.bg(C.selected))
   .on_click(()=>this.open(s))
   .child(sq(projectLook(t.project).color))
   .child(div().text_size(12.5).font_weight(on?600:500).whitespace_nowrap().child(String(s.identifier??'—')))
   .child(div().w(7).h(7).rounded(4).bg(STAGE_DOT[t.stage]||C.tertiary))
   .when(Boolean(word),e=>e.child(div().id('tab-stop-'+s.id).flex_none().h(18).px(6).items_center().rounded(4).text_size(11.5).whitespace_nowrap()
    .bg(C.dangerBg).text_color(C.danger).on_click((_e,cx)=>{cx.stop_propagation();this.cross(s,cx);}).child(word)))
   .when((!word||failed)&&!stopped&&!stopping,e=>e.child(div().id('tab-x-'+s.id).flex_none().w(16).h(16).items_center().justify_center().rounded(3).text_size(13).text_color(C.tertiary).hover(e=>e.text_color(C.title))
    .on_click((_e,cx)=>{cx.stop_propagation();this.cross(s,cx);}).child('×')));
 }
 // The band of the tabs, above the bar, on every page: one tab per PO launched.
 band(page){
  const data=snapshot(),tabs=issueTabs(data.sessions||[],data.projects||[]),current=page==='issue'?shared('fabrique-console.session'):null;
  return h_flex().id('tabs').w_full().flex_none().h(34).px(8).gap(2).items_center().bg(C.window).border_b_1().border_color(C.barBorder).overflow_x_scroll()
   .children(tabs.map(t=>this.tab(t,t.session.id===current)));
 }
 render(){
  const page=props()?.page,projects=snapshot().projects||[],chosen=knownProject(projects,shared('fabrique-console.project'));
  const head=shared('fabrique-console.v3.issue-head'),identifier=head&&head.id===shared('fabrique-console.issue')?head.identifier:null;
  const parts=crumb({page,projects,chosen,identifier});
  return v_flex().size_full().min_w(0)
   .child(this.band(page))
   .child(topBar()
    .child(h_flex().flex_1().min_w(0).items_center().gap(8)
     .when(Boolean(parts[0].project),e=>e.child(sq(projectLook(parts[0].project).color)))
     .children(parts.flatMap((x,n)=>n?[crumbSep(),crumbPart(x.text,x.strong)]:[crumbPart(x.text,x.strong)])))
    .child(this.right(page)));
 }
}
