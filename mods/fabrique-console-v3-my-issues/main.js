import {View,div} from 'gpui-kit';
import {Scrollbar,v_virtual_list} from 'gpui-base';
import {exec} from 'herdr';
import {shared,setShared,run} from 'herdr';
import {v_flex,h_flex,C,page,h2,meta,card,header,btn,errorBox,note,chip,labelChip,sq,icons,segment,api,task,snapshot,FEED_ERRORS} from './kit.js';
import {T} from './texts.js';
import {projectLook} from './model.js';
import {myIssueGroups,issueFilterOf,dayOf,myTabOf,activityGroups,mergeMyIssues,unreadTeams,clockOf,poOf,poStatus,ISSUE_SCREEN} from './view.js';
const MOD='fabrique-console-v3-my-issues',KEPT='fabrique-console.v3.my-issues',FILTER='fabrique-console.v3.my-issues-filter',ROW=44,HEAD=36;
// "My issues", two tabs: Issues (the issues of every team as a team's Issues page lists them in Tracker: Active,
// Backlog or All issues, grouped by state) and Activity (every issue of every team by its last update, grouped by day).
export default class MyIssues extends View {
 // The answer comes from the feed (the watcher reads My issues every minute and shares it): the page shows the
 // shared answer, and reads Tracker itself only on Actualiser. A page opened before the first feed reads once.
 init(_p,cx){this.busy=false;this.error='';this.launching=null;this.take();if(!this.tracker)this.load(cx,false);cx.timer.every(2000,cx=>{this.take();cx.notify();});}
 // The shared answer, when newer than the one shown.
 take(){const kept=shared(KEPT);if(kept&&kept.at!==this.at){this.tracker=kept.data;this.at=kept.at;}}
 labels(i){return h_flex().flex_none().items_center().gap(4).children((i.labels||[]).map(l=>labelChip(l)));}
 activityRow(i){
  return h_flex().id('activity-'+i.team.key+'/'+i.id).flex_none().min_h(40).px(12).py(6).gap(10).items_center().border_t_1().border_color(C.rowBorder)
   .child(h_flex().w(110).flex_none().items_center().gap(7).min_w(0).text_color(C.projectName).font_weight(500).child(sq(projectLook(snapshot().projects?.find(x=>x.key===i.team.key)).color)).child(div().min_w(0).truncate().child(String(i.team.name||i.team.key))))
   .child(div().w(64).flex_none().text_size(12.5).font_weight(600).text_color(C.secondary).whitespace_nowrap().child(String(i.identifier??'—')))
   .child(div().flex_1().min_w(0).truncate().text_size(13).text_color(C.title).child(String(i.title??'—')))
   .child(this.labels(i))
   .when(Boolean(i.project),e=>e.child(chip(i.project.name)))
   .child(chip(i.state?.name||'—'))
   .when(/^https:\/\/[^\s/@]+\//.test(i.url||''),e=>e.child(btn('open-activity-'+i.id,T.issue.open,(_e,cx)=>{cx.spawn(async()=>{await exec('open',[i.url]);});},{small:true})));
 }
 activity(){
  const issues=this.tracker?.activity||[],groups=activityGroups(issues);
  return v_flex().flex_1().min_h(0).gap(10)
   .child(header(8).child(h_flex().items_baseline().gap(8).child(h2(T.myIssues.tabs.activity)).child(meta(T.myIssues.issueCount(issues.length))))
    .child(h_flex().flex_none().items_center().gap(8).child(this.readMeta()).child(btn('refresh-activity',T.myIssues.refresh,(_e,cx)=>this.load(cx,true),{small:true}))))
   .children(this.unread())
   .when(groups.length>0,e=>e.child(v_flex().id('activity-scroll').flex_1().min_h(0).overflow_y_scrollbar().gap(14).children(groups.map(g=>v_flex().flex_none().gap(6)
    .child(h_flex().items_baseline().gap(8).child(div().text_size(13).font_weight(600).text_color(C.title).child(g.label)).child(meta(String(g.issues.length))))
    .child(card().flex_none().overflow_hidden().children(g.issues.map(i=>this.activityRow(i))))))))
   .when(!groups.length&&!this.busy,e=>e.child(card().flex_none().py(24).px(24).items_center().child(div().text_size(13.5).text_color(C.tertiary).child(T.myIssues.noActivity))));
 }
 // A team the reread could not read keeps what it showed before, dated: see mergeMyIssues.
 load(cx,refresh){task(this,cx,MOD,'ticket-my-issues',{refresh},data=>{const merged=mergeMyIssues(shared(KEPT)||(this.tracker?{data:this.tracker,at:this.at}:null),data,Date.now());this.tracker=merged.data;this.at=merged.at;setShared(KEPT,merged);});}
 // The time of the read, then one line per team that could not be read: its error, and the time of the data shown for it.
 readMeta(){return meta(this.busy?T.myIssues.loading:this.at?T.myIssues.readAt(clockOf(this.at)):'');}
 unread(){return unreadTeams(this.tracker?.teams).map(t=>div().text_size(12).text_color(C.danger).child(T.myIssues.teamError+t.name+' · '+(t.error.message||t.error.code)+(t.keptAt?' · '+T.myIssues.keptFrom(clockOf(t.keptAt)):'')));}
 // One issue, as Tracker lists it: team, identifier, title, labels, project, state, the day of its last update;
 // what it blocks or is blocked by, and its sub-issues done/all. A sub-issue is drawn under its parent, indented.
 // Launches the PO of an issue in its team (or shows the one that lives), then opens the Issue page: as the Issues page does.
 launch(cx,r){
  const i=r.issue;if(this.launching)return;
  this.launching=i.id;this.error='';cx.notify();
  cx.spawn(async cx=>{
   try{
    const data=await api(MOD,'po-launch',{key:r.team.key,issueId:i.id,confirmed:true});
    setShared('fabrique-console.project',r.team.key);setShared('fabrique-console.issue',i.id);setShared('fabrique-console.session',data.session?.id||null);
    run('layout.switch',{name:ISSUE_SCREEN});
   }catch(e){this.error=String(e.message||e);}
   finally{this.launching=null;cx.notify();}
  });
 }
 // One issue, as Tracker lists it: team, identifier, title, labels, project, state, the day of its last update;
 // what it blocks or is blocked by, and its sub-issues done/all; at the right, what a click does (Lancer the PO,
 // or Ouvrir the one that lives). The rows are drawn by a virtual list: only the visible ones cost anything, and
 // the click is the list's (on_item_click), never a button of the row.
 issueRow(r){
  const i=r.issue,look=projectLook(snapshot().projects?.find(x=>x.key===r.team.key)),po=poOf(snapshot().sessions||[],i.id),live=po&&po.status!=='historical',launching=this.launching===i.id;
  return h_flex().id('my-issue-'+r.team.key+'/'+i.id).h(ROW).px(12).gap(10).items_center().border_t_1().border_color(C.rowBorder).cursor_pointer().hover(s=>s.bg(C.rowSelected))
   .child(h_flex().w(110).flex_none().items_center().gap(7).min_w(0).text_color(C.projectName).font_weight(500).child(sq(look.color)).child(div().min_w(0).truncate().child(String(r.team.name||r.team.key))))
   .child(div().w(64).flex_none().text_size(12.5).font_weight(600).text_color(C.secondary).whitespace_nowrap().child(String(i.identifier??'—')))
   .child(div().flex_1().min_w(0).truncate().text_size(13).text_color(C.title).child(String(i.title??'—')))
   .when(Boolean(live),e=>e.child(note(T.issues.po(poStatus(po)))))
   .when(r.total>0,e=>e.child(note(T.myIssues.subIssues(r.done,r.total))))
   .when(i.blocks>0,e=>e.child(chip(T.myIssues.blocks(i.blocks))))
   .when(i.blockedBy>0,e=>e.child(chip(T.myIssues.blockedBy(i.blockedBy))))
   .child(this.labels(i))
   .when(Boolean(r.project),e=>e.child(chip(r.project.name)))
   .child(chip(i.state?.name||'—'))
   .child(div().w(52).flex_none().text_size(12).text_color(C.tertiary).whitespace_nowrap().child(dayOf(i.updatedAt)))
   .child(div().flex_none().text_size(12.5).font_weight(600).text_color(live?C.secondary:C.title).whitespace_nowrap().child(launching?T.issues.launching:live?T.issues.open:T.issues.launch));
 }
 // The head of one state, as Tracker groups a team's issues: its name, its count.
 groupHead(g){return h_flex().id('my-issues-'+g.key).h(HEAD).items_center().gap(8).pt(8).child(div().text_size(13).font_weight(600).text_color(C.title).child(String(g.name))).child(meta(String(g.issues.length)));}
 // The items of the list: the head of each group, then its rows; one height each.
 items(groups){return groups.flatMap(g=>[{key:'group:'+g.key,size:HEAD,group:g},...g.issues.map(r=>({key:'row:'+r.team.key+'/'+r.issue.id,size:ROW,row:r}))]);}
 body(){
  const filter=issueFilterOf(shared(FILTER)),groups=myIssueGroups(this.tracker,filter),items=this.items(groups.groups);
  const byKey=new Map(items.map(it=>[it.key,it]));
  return v_flex().flex_1().min_h(0).gap(10)
   .child(header(8).child(h_flex().items_center().gap(12).child(segment('my-issues-filter',Object.entries(T.myIssues.filters),filter,(key,_e,cx)=>{setShared(FILTER,key);cx.notify();})).child(meta(T.myIssues.issueCount(groups.count))))
    .child(h_flex().flex_none().items_center().gap(8).child(this.readMeta()).child(btn('refresh-issues',T.myIssues.refresh,(_e,cx)=>this.load(cx,true),{small:true}))))
   .children(this.unread())
   // Zeros of blocking are measured only on a full read of the relations: otherwise it is said, once.
   .when(Boolean(this.tracker)&&groups.relations!=='full',e=>e.child(note(T.myIssues.noRelations)))
   .when(items.length>0,e=>e.child(v_flex().relative().flex_1().min_h(0)
    .child(v_virtual_list('my-issues-list',items.length,items.map(it=>it.size),index=>items[index].key,range=>items.slice(range.start,range.end).map(it=>it.group?this.groupHead(it.group):this.issueRow(it.row)))
     .on_item_click((key,cx)=>{const it=byKey.get(key);if(it?.row)this.launch(cx,it.row);}))
    .child(Scrollbar.vertical('my-issues-list').absolute().inset_0())))
   .when(!items.length&&!this.busy,e=>e.child(card().flex_none().py(24).px(24).items_center().child(div().text_size(13.5).text_color(C.tertiary).child(T.myIssues.empty[filter]))));
 }
 // An error of the feed is shown while the feed carries it, and goes with the next good read; an error of an
 // action of this page stays until the next action.
 render(){this.take();const fed=(shared(FEED_ERRORS)||{})['my-issues.json'];return page().id('my-issues').child(errorBox({error:this.error||(fed?String(fed):'')})).child(myTabOf(shared('fabrique-console.v3.my-issues-tab'))==='activity'?this.activity():this.body());}
}
