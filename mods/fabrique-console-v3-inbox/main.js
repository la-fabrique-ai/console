import {View,div} from 'gpui-kit';
import {InputState,Input} from 'gpui-base';
import {setShared,run,agents} from 'herdr';
import {v_flex,h_flex,C,page,h2,meta,card,header,btn,note,pill,sq,icons,field,api,snapshot} from './kit.js';
import {T} from './texts.js';
import {projectLook} from './model.js';
import {inboxRows,toCloseRows,sinceText,clockOf,ISSUE_SCREEN,poStatus,waitingAgents} from './view.js';
const MOD='fabrique-console-v3-inbox',ICONS=icons(MOD);
const TONE={blocked:'dec',error:'inc'};
// The Inbox of this tool, on Tracker's model: only what is addressed to the user. "Vous attend": one card per PO
// session at that stage — a question of the PO with its exact answers, answered from here into its terminal, or
// a terminal stopped or in error; "À clôturer": the sessions whose PO said everything is validated. "Open" leads
// to the issue. The Tracker facts (issues to validate, reviews to read) join at the next step.
export default class Inbox extends View {
 init(_p,cx){this.error='';this.replying=null;this.sending=null;this.answer=InputState.new({value:'',placeholder:T.inbox.yourAnswer});this.answer.on('submit',(_e,cx)=>this.send(cx));cx.timer.every(5000,cx=>cx.notify());}
 open(r){const s=r.session;setShared('fabrique-console.project',s.projectKey);setShared('fabrique-console.issue',s.issueId);setShared('fabrique-console.session',s.id);run('layout.switch',{name:ISSUE_SCREEN});}
 // Sends an answer to the question of a session: one of its answers, or the text written. The card keeps the
 // question until the next snapshot says it is gone; a refused send is said on the page.
 // A button names its answer by its place (optionIndex): the first validates the step it closes. A typed answer has none.
 reply(cx,r,text,optionIndex){
  const s=r.session,q=r.question;if(!q||this.sending)return;
  this.sending=s.id;this.error='';cx.notify();
  cx.spawn(async cx=>{
   try{await api(MOD,'po-answer',{sessionId:s.id,id:q.id,askedAt:q.askedAt,text,source:'inbox',...(Number.isInteger(optionIndex)?{optionIndex}:{})});if(this.isReplying(r)){this.replying=null;this.answer.set_value('');}}
   catch(e){this.error=String(e.message||e);}
   finally{this.sending=null;cx.notify();}
  });
 }
 // The answer written belongs to the question shown when it was opened (session, id, time asked): if the PO asked
 // another one meanwhile, the draft is never sent to it, and the field closes.
 isReplying(r){const w=this.replying,q=r.question;return Boolean(w&&q&&w.session===r.session.id&&w.id===q.id&&w.askedAt===q.askedAt);}
 send(cx){
  const r=this.rows().find(r=>this.isReplying(r)),text=this.answer.value().trim();
  if(!r||!r.answerable){this.replying=null;cx.notify();return;}
  if(text)this.reply(cx,r,text);
 }
 rows(){const data=snapshot();return inboxRows(data.sessions||[],data.projects||[]);}
 team(r){return h_flex().flex_none().items_center().gap(7).min_w(0).text_color(C.projectName).font_weight(500).child(sq(projectLook(r.project).color)).child(div().min_w(0).truncate().child(String(r.project?.name||r.session.projectKey||'—')));}
 // The head of a card: team · identifier, the title, since when.
 head(r,since){
  const s=r.session;
  return v_flex().flex_none().gap(2)
   .child(h_flex().items_center().gap(8).child(this.team(r)).child(div().text_size(12.5).font_weight(600).text_color(C.secondary).whitespace_nowrap().child(String(s.identifier??'—'))))
   .child(div().w_full().min_w(0).truncate().text_size(13.5).font_weight(500).text_color(C.title).child(String(s.title??'—')))
   .when(Boolean(since),e=>e.child(note(since)));
 }
 // A card of "Vous attend": the question and its answers, or the state of the terminal.
 waiting(r){
  const s=r.session,q=r.question,sending=this.sending===s.id,replying=this.isReplying(r);
  let el=v_flex().id('inbox-'+s.id).flex_none().px(14).py(12).gap(10).border_t_1().border_color(C.rowBorder)
   .child(h_flex().items_start().gap(12).child(this.head(r,q?sinceText(q.askedAt):'').flex_1().min_w(0))
    .when(!q||(!r.answerable&&!r.stale),e=>e.child(pill(ICONS,TONE[s.status]||'unk',poStatus(s))))
    .child(btn('open-'+s.id,T.inbox.open,()=>this.open(r),{small:true,primary:!q})));
  if(!q)return el;
  el=el.child(div().text_size(13.5).text_color(C.text).child(String(q.text)));
  if(r.stale)return el.child(h_flex().items_center().gap(8).child(note(T.inbox.resumed)).child(btn('terminal-'+s.id,T.inbox.openTerminal,()=>this.open(r),{small:true})));
  // A terminal stopped on a dialog, in error, unread or gone takes no answer: its state is said, Ouvrir leads to it.
  if(!r.answerable)return el;
  el=el.child(h_flex().flex_none().flex_wrap().items_center().gap(8)
   .children((q.options||[]).map((option,n)=>btn('answer-'+s.id+'-'+n,sending?T.inbox.sending:option,(_e,cx)=>this.reply(cx,r,option,n),{small:true,primary:true})))
   .child(btn('reply-'+s.id,T.inbox.reply,(_e,cx)=>{this.replying=replying?null:{session:s.id,id:q.id,askedAt:q.askedAt};this.answer.set_value('');cx.notify();},{small:true})));
  if(replying)el=el.child(h_flex().flex_none().gap(8).items_center().child(field(Input.new(this.answer)).flex_1()).child(btn('send-'+s.id,sending?T.inbox.sending:T.inbox.send,(_e,cx)=>this.send(cx),{small:true,primary:true})));
  return el;
 }
 // A row of "À clôturer": the session, validated at that time; Open leads to the issue, where the closure is.
 toClose(r){
  const s=r.session;
  return h_flex().id('close-'+s.id).flex_none().min_h(44).px(14).py(8).gap(12).items_center().border_t_1().border_color(C.rowBorder)
   .child(this.head(r,s.readyAt?T.inbox.readyAt(clockOf(s.readyAt)):'').flex_1().min_w(0))
   .child(btn('open-close-'+s.id,T.inbox.open,()=>this.open(r),{small:true,primary:true}));
 }
 section(title,rows,emptyText,draw){
  return v_flex().flex_none().gap(10)
   .child(header(8).child(h_flex().items_baseline().gap(8).child(h2(title)).child(meta(String(rows.length)))))
   .when(rows.length>0,e=>e.child(card().flex_none().overflow_hidden().children(rows.map(draw))))
   .when(!rows.length&&Boolean(emptyText),e=>e.child(card().flex_none().py(24).px(24).items_center().child(div().text_size(13.5).text_color(C.tertiary).child(emptyText))));
 }
 render(){
  const data=snapshot(),sessions=data.sessions||[],projects=data.projects||[],waiting=inboxRows(sessions,projects),closing=toCloseRows(sessions,projects);
  return page().id('inbox')
   .when(Boolean(this.error),e=>e.child(div().flex_none().p(8).rounded(6).border_1().border_color(C.dangerBorder).bg(C.dangerBg).text_color(C.danger).child(this.error)))
   .child(v_flex().id('inbox-scroll').flex_1().min_h(0).overflow_y_scrollbar().gap(18)
    // The agents of an issue that wait for the user (a dev, a reviewer, QA): one line each, Ouvrir shows its tab.
    .when(waitingAgents(agents()).length>0,e=>e.child(this.section(T.inbox.agentsWaiting,waitingAgents(agents()),'',a=>v_flex().px(14).py(10)
     .child(h_flex().w_full().min_w(0).items_center().gap(10)
      .child(div().flex_1().min_w(0).truncate().text_size(13).font_weight(600).text_color(C.amber).child('⌛ '+a.name+' · '+T.inbox.agentWaits))
      .child(btn('agent-open-'+a.tab,T.inbox.open,()=>{run('space.select',{id:a.space});run('tab.select',{id:a.tab});},{small:true,primary:true}))))))
    .child(this.section(T.inbox.waiting,waiting,T.inbox.empty,r=>this.waiting(r)))
    .when(closing.length>0,e=>e.child(this.section(T.inbox.toClose,closing,'',r=>this.toClose(r)))));
 }
}
