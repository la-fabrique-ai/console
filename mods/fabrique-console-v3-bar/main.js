import {View,div} from 'gpui-kit';
import {run,shared,setShared,props,window} from 'herdr';
import {h_flex,v_flex,C,sq,snapshot,feed,LINE,FEED_ERRORS} from './kit.js';
import {T} from './texts.js';
import {projectLook} from './model.js';
import {navModel,toggleUnfolded,openedUnfolded,knownProject,mergeMyIssues,feedErrorLines,INBOX_SCREEN,MY_ISSUES_SCREEN,AGENT_SCREEN,ISSUES_SCREEN} from './view.js';
const MOD='fabrique-console-v3-bar',UNFOLDED='fabrique-console.v3.unfolded';
// The side bar of the V3: the brand, the Inbox, then the teams; each team unfolds its Issues and Projects on its
// own chevron (the open team always is), so several can stay open.
// It also runs the feed for every other mod: the watcher's files, shared when they change (see ui/common.js).
export default class Bar extends View {
 init(_p,cx){this.busy=false;this.error='';feed(cx,MOD,{merge:mergeMyIssues});}
 go(key){const projects=snapshot().projects||[];setShared(UNFOLDED,openedUnfolded(shared(UNFOLDED),knownProject(projects,shared('fabrique-console.project')),key));setShared('fabrique-console.project',key);setShared('fabrique-console.issue',null);setShared('fabrique-console.session',null);run('layout.switch',{name:ISSUES_SCREEN});}
 global(name){setShared('fabrique-console.issue',null);setShared('fabrique-console.session',null);run('layout.switch',{name});}
 // One entry of the bar: its label, its count at the right; marked when its page is shown, dimmed when it has none yet.
 entry(id,label,{on=false,count=null,sub=false,soon=false,fn=null,color=null,chevron=null}={}){
  let el=h_flex().id(id).flex_none().w_full().h(sub?28:30).pl(sub?30:chevron?4:10).pr(10).gap(8).items_center().rounded(5).whitespace_nowrap().text_size(sub?13:13.5).font_weight(on?600:500).text_color(on?C.title:soon?C.tertiary:C.tab);
  // A team row: its chevron folds or unfolds it, and only it; the rest of the row opens its Issues.
  if(chevron)el=el.child(h_flex().id(id+'-chevron').flex_none().w(20).h_full().items_center().justify_center().text_size(10).text_color(C.tertiary).cursor_pointer().on_click(chevron.fn).child(chevron.open?'▾':'▸'));
  let body=chevron?h_flex().id(id+'-body').flex_1().min_w(0).h_full().gap(8).items_center():el;
  if(color)body=body.child(sq(color));
  body=body.child(div().flex_1().min_w(0).truncate().child(String(label)));
  if(count!==null&&count!==undefined)body=body.child(div().flex_none().text_size(12).text_color(C.tertiary).child(String(count)));
  if(soon)return chevron?el.child(body):body;
  if(chevron)el=el.child(body.cursor_pointer().on_click(fn));else el=body.cursor_pointer().on_click(fn);
  return on?el.bg(C.selected):el.hover(s=>s.bg(C.selected));
 }
 section(text){return div().flex_none().pt(10).pb(3).pl(10).pr(10).text_size(11).font_weight(500).text_color(C.tertiary).whitespace_nowrap().child(String(text).toUpperCase());}
 render(){
  const data=snapshot(),projects=data.projects||[];
  const unfolded=shared(UNFOLDED)||[];
  const nav=navModel({projects,chosen:knownProject(projects,shared('fabrique-console.project')),page:props()?.page,sessions:data.sessions||[],backlog:shared('fabrique-console.v3.backlog-count'),unfolded});
  // The brand row is as high as the top bar beside it; the Inbox and the teams start right under it. The layout
  // draws no system title bar: on macOS, out of full screen, the window buttons sit left of the brand.
  const w=window(),lights=w?.platform==='macos'&&w.titlebar==='none'&&!w.fullscreen;
  return v_flex().id('nav-root').size_full().min_h(0).min_w(0).pb(10).px(8).gap(1).bg(C.bar).border_r_1().border_color(C.barBorder).text_color(C.text).text_size(13).line_height(LINE)
   .child(h_flex().flex_none().w_full().h(44).pl(lights?70:10).pr(10).items_center().child(div().text_size(14).font_weight(700).text_color(C.title).child(T.brand)))
   .child(this.entry('nav-inbox',T.nav.pages.inbox,{on:nav.inbox.on,count:nav.inbox.count,fn:()=>this.global(INBOX_SCREEN)}))
   .child(this.entry('nav-my-issues',T.nav.pages.myIssues,{on:nav.myIssues.on,fn:()=>this.global(MY_ISSUES_SCREEN)}))
   .child(this.entry('nav-agent',T.nav.pages.agent,{on:nav.agent.on,fn:()=>this.global(AGENT_SCREEN)}))
   .child(this.section(T.nav.teams))
   .child(v_flex().id('nav-scroll').flex_1().min_h(0).w_full().gap(1).overflow_y_scrollbar()
    .children(nav.teams.flatMap(t=>[
     this.entry('nav-team-'+t.key,t.name,{count:t.count||null,fn:()=>this.go(t.key),color:projectLook(projects.find(p=>p.key===t.key)).color,chevron:{open:t.open,fn:(_e,cx)=>{setShared(UNFOLDED,toggleUnfolded(unfolded,t.key));cx.notify();}}}),
     ...t.pages.map(p=>this.entry('nav-'+t.key+'-'+p.key,T.nav.pages[p.key],{on:p.on,count:p.count,sub:true,soon:p.soon,fn:()=>this.go(t.key)})),
    ]))
    .when(!nav.teams.length&&!!shared('fabrique-console.snapshot-at'),e=>e.child(div().px(10).text_size(12).text_color(C.tertiary).child(T.nav.noTeam))))
   // What the feed could not read is said here, with the time of the data still shown: an old state is never
   // passed off as a fresh observation.
   .children(feedErrorLines(shared(FEED_ERRORS),shared('fabrique-console.snapshot-at')).map((text,n)=>div().id('feed-error-'+n).flex_none().px(10).py(4).text_size(11).text_color(C.danger).child(text)))
   .when(Boolean(this.error||shared('fabrique-console.v3.watch-error')),e=>e.child(div().flex_none().px(10).py(6).text_size(11).text_color(C.danger).child(String(this.error||shared('fabrique-console.v3.watch-error')))));
 }
}
