import {View,div} from 'gpui-kit';
import {InputState,Input,Scrollbar,v_virtual_list} from 'gpui-base';
import {shared,setShared,run} from 'herdr';
import {v_flex,h_flex,C,page,h2,meta,card,header,btn,errorBox,note,chip,field,labelChip,api,task,snapshot,readTeamIssues,segment} from './kit.js';
import {T} from './texts.js';
import {fixProject,teamIssueGroups,issueFilterOf,backlogCount,canceledState,priorityName,syncText,poStatus,poOf,dayOf,ISSUE_SCREEN} from './view.js';
const MOD='fabrique-console-v3-issues',FILTER='fabrique-console.v3.issues-filter',ROW=44,HEAD=36;
const uuid=()=>'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,c=>{const r=Math.random()*16|0;return (c==='x'?r:(r&3|8)).toString(16);});
// The Issues page of a team, as Tracker's: every issue of the team (with or without project), Active, Backlog or
// All issues, grouped by state. A field to write one; a click on a row hands it to its PO (Lancer), or shows
// the PO that lives (Ouvrir); a secondary click asks to remove it. The list comes from the feed (the watcher
// reads it every minute, and only this page reads it); the page reads Tracker itself only on Actualiser, or before
// the first feed.
export default class Issues extends View {
 init(_p,cx){
  this.busy=false;this.error='';this.pending=null;this.issues=[];this.ctx=null;this.raw=null;this.fedError=null;this.feeding=false;this.fileChecked=false;this.tried=false;this.reading=false;this.removing=null;this.launching=null;this.cached=null;this.updatedAt=null;this.op=null;
  this.input=InputState.new({value:'',placeholder:T.issues.placeholder});this.input.on('submit',(_e,cx)=>this.create(cx));
  this.tick(cx);cx.timer.every(2000,cx=>this.tick(cx));
 }
 project(){const projects=snapshot().projects||[];return projects.find(p=>p.key===fixProject(projects,shared('fabrique-console.project')))||null;}
 // The context of the list: the team key and its Tracker team. Every read and every action carries the context it
 // started in, and is dropped when the page shows another one.
 here(){const p=this.project();return p?{key:p.key,teamId:p.teamId||null}:null;}
 same(a,b=this.here()){return Boolean(a&&b&&a.key===b.key&&a.teamId===b.teamId);}
 // The team of the page: the chosen one, else the first configured one; its list is read again when it changes.
 tick(cx){
  const p=this.project();if(!p)return;
  if(shared('fabrique-console.project')!==p.key)setShared('fabrique-console.project',p.key);
  const ctx=this.here();
  if(!this.same(this.ctx,ctx)){this.ctx=ctx;this.issues=[];this.updatedAt=null;this.cached=null;this.raw=null;this.fedError=null;this.fileChecked=false;this.tried=false;this.removing=null;this.pending=null;}
  if(ctx.teamId){this.takeFed(cx,ctx);this.firstRead(cx);}
  cx.notify();
 }
 // The issues of the team as the watcher wrote them, read by this page alone.
 takeFed(cx,ctx){
  if(this.feeding)return;this.feeding=true;
  cx.spawn(async cx=>{
   try{
    const fed=await readTeamIssues(MOD,ctx.key,this.raw);
    if(!this.same(ctx,this.ctx))return;
    this.fileChecked=true;
    if(fed){this.raw=fed.raw;this.fedError=fed.error;if(fed.data)this.show(ctx,fed.data);}
   }catch(e){if(this.same(ctx,this.ctx))this.fedError=String(e.message||e);}
   finally{this.feeding=false;this.firstRead(cx);cx.notify();}
  });
 }
 // A team the watcher has not written yet is read once from Tracker: as soon as the request can start (another
 // one may hold the slot; the next tick asks again).
 firstRead(cx){if(this.fileChecked&&this.updatedAt===null&&!this.tried&&!this.reading&&this.ctx?.teamId)this.load(cx,false);}
 // A list is shown only for the context it was read for (key and Tracker team), and only when it is not older
 // than the one shown: an old answer never replaces a newer list.
 show(ctx,data){
  if(!this.same(ctx,this.ctx)||(data?.teamId&&data.teamId!==ctx.teamId))return;
  if(this.updatedAt&&data?.updatedAt&&String(data.updatedAt)<String(this.updatedAt))return;
  this.issues=data?.issues||[];this.cached=data?.cached??null;this.updatedAt=data?.updatedAt??null;this.error='';this.count();
 }
 // Actualiser, or the first read before the feed: one request at a time, for the context it started in.
 load(cx,refresh){
  const ctx=this.ctx;if(!ctx||!ctx.teamId||this.reading||!this.same(ctx))return;
  this.reading=true;this.tried=true;this.error='';cx.notify();
  cx.spawn(async cx=>{
   try{const data=await api(MOD,'ticket-backlog',{key:ctx.key,all:true,refresh});this.show(ctx,data);}
   catch(e){if(this.same(ctx,this.ctx))this.error=String(e.message||e);}
   finally{this.reading=false;cx.notify();}
  });
 }
 // The bar shows how many issues the Backlog of the team holds.
 count(){if(this.ctx)setShared('fabrique-console.v3.backlog-count',{key:this.ctx.key,count:backlogCount(this.issues)});}
 // The title typed, then Enter or "Create": the issue is created in the Backlog of the team and listed.
 // One operation id per submission, kept while the same title is retried: a lost answer is reconciled, not redone.
 // When an identical creation left by an earlier screen is still uncertain, the backend says so instead of
 // creating: the user resumes it, or creates another issue on purpose.
 create(cx,{resume=null,another=false,title:given=null}={}){
  // The creation keeps the context it was submitted in (key and Tracker team): its result is listed, and its draft
  // cleared, only while the page still shows that context.
  const ctx=this.ctx,p=this.project(),title=(given??this.input.value()).trim();if(!p||!title||this.busy||!this.same(ctx))return;
  if(resume)this.op={id:resume,title,ctx};
  else if(!this.op||this.op.title!==title||!this.same(this.op.ctx,ctx))this.op={id:uuid(),title,ctx};
  const op=this.op;this.pending=null;
  task(this,cx,MOD,'ticket-create',{key:ctx.key,title,operationId:op.id,confirmed:true,...(another?{another:true}:{})},data=>{
   if(data.pending){this.pending={...data.pending,ctx,newId:op.id};return;}
   if(this.op===op)this.op=null;
   if(!this.same(ctx,this.ctx)||!this.same(ctx))return;
   if(this.input.value().trim()===title)this.input.set_value('');
   if(data.issue&&!this.issues.some(i=>i.id===data.issue.id)){this.issues=[data.issue,...this.issues];this.count();}
  });
 }
 // The offer carries the payload it announces; it goes once the draft is edited.
 pendingBox(){
  const pending=this.pending;if(!pending||!this.same(pending.ctx,this.ctx)||!this.same(pending.ctx)||this.input.value().trim()!==pending.title)return div().h(0);
  return h_flex().flex_none().flex_wrap().items_center().gap(8).p(8).rounded(6).border_1().border_color(C.dangerBorder).bg(C.dangerBg)
   .child(div().flex_1().min_w(0).text_size(12.5).text_color(C.danger).child(T.issues.pending+' « '+String(pending.title)+' »'))
   .child(btn('resume-create',T.issues.resume,(_e,cx)=>this.create(cx,{resume:pending.operationId,title:pending.title}),{small:true,primary:true}))
   .child(btn('another-create',T.issues.another,(_e,cx)=>{this.op={id:pending.newId,title:pending.title,ctx:pending.ctx};this.create(cx,{another:true,title:pending.title});},{small:true}));
 }
 // A click on a row: the PO of the issue starts (or is found again), and the Issue page shows its terminal.
 launch(cx,i){
  const ctx=this.ctx,p=this.project();if(!p||this.launching||!this.same(ctx))return;
  this.launching=i.id;this.error='';cx.notify();
  cx.spawn(async cx=>{
   try{
    const data=await api(MOD,'po-launch',{key:p.key,issueId:i.id,confirmed:true});
    setShared('fabrique-console.project',p.key);setShared('fabrique-console.issue',i.id);setShared('fabrique-console.session',data.session?.id||null);
    run('layout.switch',{name:ISSUE_SCREEN});
   }catch(e){this.error=String(e.message||e);}
   finally{this.launching=null;cx.notify();}
  });
 }
 // "Oui" under the question: the issue goes to the canceled state of its team, and leaves the list.
 cancel(cx,i){
  const ctx=this.ctx;if(this.busy||!this.same(ctx))return;
  this.busy=true;this.error='';cx.notify();
  cx.spawn(async cx=>{
   try{
    const metaData=await api(MOD,'ticket-meta',{});
    const state=canceledState(metaData.states,ctx.teamId);
    if(!state)throw new Error(T.issues.noCanceled);
    const payload={issueId:i.id,stateId:state.id};
    await api(MOD,'ticket-mutate',{payload,confirmedPayload:payload,confirmed:true});
    if(this.same(ctx,this.ctx)){this.issues=this.issues.filter(x=>x.id!==i.id);this.count();}
   }catch(e){this.error=String(e.message||e);}
   finally{this.busy=false;this.removing=null;cx.notify();}
  });
 }
 // The question asked by a secondary click on a row: remove this issue? It stands above the list, since a row of
 // a virtual list carries no button of its own.
 removeBox(){
  const i=this.issues.find(x=>x.id===this.removing);if(!i)return div().h(0);
  return h_flex().flex_none().items_center().gap(8).p(8).rounded(6).border_1().border_color(C.dangerBorder).bg(C.dangerBg)
   .child(div().flex_1().min_w(0).truncate().text_size(12.5).text_color(C.danger).child(T.issues.confirmRemove(String(i.identifier??'—'))+' '+String(i.title??'')))
   .child(btn('yes-'+i.id,T.issues.yes,(_e,cx)=>this.cancel(cx,i),{small:true,danger:true}))
   .child(btn('no-'+i.id,T.issues.no,(_e,cx)=>{this.removing=null;cx.notify();},{small:true}));
 }
 // One issue, as Tracker lists it: identifier, title, its PO, its sub-issues done/all, what it blocks or is blocked
 // by, labels, project, priority, the day of its last update; at the right, what a click does (Lancer, or Ouvrir
 // the PO that lives). Drawn by a virtual list: the click is the list's, never a button of the row.
 row(r){
  const i=r.issue,po=poOf(snapshot().sessions||[],i.id),live=po&&po.status!=='historical',launching=this.launching===i.id,asked=this.removing===i.id;
  return h_flex().id('issue-'+i.id).h(ROW).px(12).gap(10).items_center().border_t_1().border_color(C.rowBorder).cursor_pointer().when(asked,e=>e.bg(C.rowSelected)).hover(s=>s.bg(C.rowSelected))
   .child(div().w(64).flex_none().text_size(12.5).font_weight(600).text_color(C.secondary).whitespace_nowrap().child(String(i.identifier??'—')))
   .child(div().flex_1().min_w(0).truncate().text_size(13.5).font_weight(500).text_color(C.title).child(String(i.title??'—')))
   .when(Boolean(live),e=>e.child(note(T.issues.po(poStatus(po)))))
   .when(r.total>0,e=>e.child(note(T.myIssues.subIssues(r.done,r.total))))
   .when(i.blocks>0,e=>e.child(chip(T.myIssues.blocks(i.blocks))))
   .when(i.blockedBy>0,e=>e.child(chip(T.myIssues.blockedBy(i.blockedBy))))
   .child(h_flex().flex_none().items_center().gap(4).children((i.labels||[]).map(l=>labelChip(l))))
   .when(Boolean(r.project),e=>e.child(chip(r.project.name)))
   .child(div().flex_none().text_size(12).text_color(C.tertiary).whitespace_nowrap().child(priorityName(i.priority)))
   .child(div().w(52).flex_none().text_size(12).text_color(C.tertiary).whitespace_nowrap().child(dayOf(i.updatedAt)))
   .child(div().flex_none().text_size(12.5).font_weight(600).text_color(live?C.secondary:C.title).whitespace_nowrap().child(launching?T.issues.launching:live?T.issues.open:T.issues.launch));
 }
 // The head of one state, as Tracker groups a team's issues: its name, its count.
 groupHead(g){return h_flex().id('issues-'+g.key).h(HEAD).items_center().gap(8).pt(8).child(div().text_size(13).font_weight(600).text_color(C.title).child(String(g.name))).child(meta(String(g.issues.length)));}
 // The items of the list: the head of each group, then its rows; one height each.
 items(groups){return groups.flatMap(g=>[{key:'group:'+g.key,size:HEAD,group:g},...g.issues.map(r=>({key:'row:'+r.issue.id,size:ROW,row:r}))]);}
 render(){
  // Rows are drawn only for the context they were read for: between a change of team and the next tick, none.
  const p=this.project(),mine=this.same(this.ctx),filter=issueFilterOf(shared(FILTER)),grouped=teamIssueGroups(mine?this.issues:[],p,filter),items=this.items(grouped.groups),byKey=new Map(items.map(it=>[it.key,it]));
  // The list the watcher could not read is said while its file carries the error; the issues shown are then the last read.
  const fed=this.fedError;
  return page().id('issues')
   .child(errorBox({error:this.error||(fed?String(fed):'')}))
   .when(!p,e=>e.child(note(T.issues.noProject)))
   .when(Boolean(p&&!p.teamId),e=>e.child(note(T.issues.noTeam)))
   .when(Boolean(p&&p.teamId),e=>e
    .child(h_flex().flex_none().gap(8).items_center().child(field(Input.new(this.input)).flex_1()).child(btn('create',this.busy?T.issues.creating:T.issues.create,(_e,cx)=>this.create(cx))))
    .child(this.pendingBox())
    .child(this.removeBox())
    .child(header(8)
     // The three lists of Tracker, at the head of the list as on My issues: Active, Backlog, All issues.
     .child(h_flex().items_center().gap(12).child(segment('issues-filter',Object.entries(T.issues.filters),filter,(key,_e,cx)=>{setShared(FILTER,key);cx.notify();})).child(meta(T.myIssues.issueCount(grouped.count))))
     .child(h_flex().flex_none().items_center().gap(8).child(meta(this.reading?T.issues.loading:syncText(this))).child(btn('refresh',T.issues.refresh,(_e,cx)=>this.load(cx,true),{small:true}))))
    .when(items.length>0,e=>e.child(v_flex().relative().flex_1().min_h(0)
     .child(v_virtual_list('issues-list',items.length,items.map(it=>it.size),index=>items[index].key,range=>items.slice(range.start,range.end).map(it=>it.group?this.groupHead(it.group):this.row(it.row)))
      .on_item_click((key,cx)=>{const it=byKey.get(key);if(it?.row)this.launch(cx,it.row.issue);})
      .on_item_secondary_click((key,_e,cx)=>{const it=byKey.get(key);if(it?.row){this.removing=this.removing===it.row.issue.id?null:it.row.issue.id;cx.notify();}}))
     .child(Scrollbar.vertical('issues-list').absolute().inset_0())))
    // Before the first list known for this team, it is being read, not empty.
    .when(!items.length&&(this.reading||!mine||(this.updatedAt===null&&!this.error&&!fed)),e=>e.child(note(T.issues.loading)))
    .when(!items.length&&!this.reading&&mine&&!(this.updatedAt===null&&!this.error&&!fed),e=>e.child(card().flex_none().py(40).px(24).items_center().child(div().text_size(13.5).text_color(C.tertiary).child(T.issues.empty[filter])))));
 }
}
