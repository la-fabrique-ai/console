import {View,div} from 'gpui-kit';
import {TextView} from 'gpui-base';
import {shared,setShared,run,agents,exec} from 'herdr';
import {v_flex,h_flex,C,page,h2,card,card as card_,header,btn,errorBox,note,chip,labelChip,pill,icons,api,snapshot,reloadSnapshot} from './kit.js';
import {T} from './texts.js';
import {poOf,poTab,poStatus,ISSUE_STEPS,stepOf,mdSection,questionStale,questionAnswerable,clarificationOf,partShown,plainMentions,ownValue,GATE_STEPS,splitRows,devRows,progressOf,reviewLines,workspaceOf,serverOf,devFlow,waitsMet,reviewerFor,serverOfPlan,modelShort,withoutSections,mdTable,dayOf,stateTone,priorityName} from './view.js';
const MOD='fabrique-console-v3-issue',ICONS=icons(MOD);
const AGENT_COLORS={claude:'#D8A27E',codex:'#8FB4FF'};
const RUN_COLORS=()=>({rev:C.running,ok:C.done,dec:C.amber,inc:C.danger,unk:C.tertiary});
const TONE={working:'rev',blocked:'dec',error:'inc',done:'ok',idle:'unk',unknown:'unk',historical:'unk'};
// The right side of the Issue page: the Tracker issue the PO works on, and the PO session itself.
// The terminal of the PO is the active tab on the left: this mod selects it when the page opens.
// The issue asked for is kept apart from the one read: a read in flight never loses the next one.
export default class Issue extends View {
 init(_p,cx){this.busy=false;this.error='';this.warning='';this.issue=null;this.wanted=null;this.reading=false;this.shown=null;this.named=new Set();this.launching=false;this.toggled=new Set();this.answering=false;this.openRows=new Set();this.details=new Map();this.devLaunched=new Set();this.devRun=null;this.devBusy=false;this.logs=shared('fabrique-console.v3.devlog')||{};this.reports=[];this.flowDone=shared('fabrique-console.v3.devflow')||{};this.ticks=0;this.valTicks=0;this.valData=null;this.tick(cx);cx.timer.every(2000,cx=>this.tick(cx));}
 // `question` names the question a fresh read is for: its answers are offered only once that read succeeded, so
 // the user never validates a proposal the page read before the PO asked (or could not read again).
 load(cx,id,refresh=false,question=null){
  if(this.wanted?.id!==id){this.issue=null;this.error='';this.picked=null;}
  // A new fresh read takes back the former one: until it succeeds, nothing is offered (it may fail, the text may change).
  if(refresh)this.freshFor=null;
  this.wanted={id,refresh,question};
  if(!this.reading)this.read(cx,this.wanted);
 }
 asked(po){const q=po?.question;return q?q.id+'@'+q.askedAt:null;}
 fresh(id,po){const asked=this.asked(po);return Boolean(asked)&&!this.reading&&this.freshFor===id+'|'+asked;}
 read(cx,want){
  this.reading=true;cx.notify();
  cx.spawn(async cx=>{
   try{
    const data=await api(MOD,'ticket-detail',{id:want.id,refresh:want.refresh});
    // A read another one waits behind is outdated: it shows the text, but never offers the answers.
    if(this.wanted?.id===want.id){this.issue=data.issue;this.error='';{const d=new Date();this.readAt=String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0');}if(want.refresh&&want.question&&this.wanted===want)this.freshFor=want.id+'|'+want.question;setShared('fabrique-console.v3.issue-head',{id:data.issue.id,identifier:data.issue.identifier,state:data.issue.state||null});}
   }catch(e){if(this.wanted?.id===want.id)this.error=String(e.message||e);}
   finally{this.reading=false;if(this.wanted&&this.wanted!==want)this.read(cx,this.wanted);else cx.notify();}
  });
 }
 po(){const id=shared('fabrique-console.issue');return id?poOf(snapshot().sessions||[],id,shared('fabrique-console.session')):null;}
 // Every two seconds: the PO terminal is shown and its tab named once Herdr lists it; the statuses are redrawn.
 tick(cx){
  const id=shared('fabrique-console.issue');if(id&&id!==this.wanted?.id)this.load(cx,id);
  const po=this.po(),tab=po?.terminalId?poTab(agents(),po.terminalId):null;
  // The page follows the work: a new step shows itself; a new question that closes a step opens that step and reads
  // the issue again (the PO wrote what the user is asked to validate), so he lands where he validates. A step he
  // clicked stays until one of these happens.
  // Every question shown, the first one included, is read fresh from Tracker before its answers are offered.
  const step=stepOf(po),q=po?.question,asked=this.asked(po);
  if(step!==this.seenStep){if(this.seenStep!==undefined)this.picked=null;this.seenStep=step;}
  if(asked!==this.seenQuestion){
   this.seenQuestion=asked;
   if(q&&ownValue(GATE_STEPS,q.gate))this.picked=GATE_STEPS[q.gate];
   if(q&&id)this.load(cx,id,true,asked);
  }
  if(tab&&this.shown!==po.terminalId){this.shown=po.terminalId;run('space.select',{id:tab.space});run('tab.select',{id:tab.tab});}
  // The tab says its ticket ("PO · XJ-613"): each PO has its own space since then, but POs launched before shared the
  // space of their team. A tab still named "PO" alone is renamed too.
  if(tab&&(tab.unnamed||tab.name===T.issue.poTabOld)&&!this.named.has(tab.tab)){this.named.add(tab.tab);run('tab.rename',{id:tab.tab,name:T.issue.poTab(po.identifier)});}
  this.flowTick(cx,po);
  this.valTick(cx,po);
  cx.notify();
 }
 show(){const po=this.po(),tab=po?.terminalId?poTab(agents(),po.terminalId):null;if(tab){run('space.select',{id:tab.space});run('tab.select',{id:tab.tab});}}
 // "Relaunch the PO": the same session when its terminal is gone. "Close and relaunch": the session whose terminal
 // never received the role is stopped first, and a new PO starts.
 relaunch(cx,stopFirst=null){
  const id=shared('fabrique-console.issue'),key=shared('fabrique-console.project');if(!id||!key||this.launching)return;
  this.launching=true;this.error='';this.warning='';cx.notify();
  cx.spawn(async cx=>{
   try{
    if(stopFirst)await api(MOD,'stop',{sessionId:stopFirst,confirmed:true});
    const data=await api(MOD,'po-launch',{key,issueId:id,confirmed:true});
    setShared('fabrique-console.session',data.session?.id||null);this.shown=null;this.warning=data.warning||'';
    await reloadSnapshot(MOD);
   }
   catch(e){this.error=String(e.message||e);}
   finally{this.launching=false;cx.notify();}
  });
 }
 // A card and its title, with a count when it lists things.
 block(title,count=null,tone=C.tertiary){
  return card().flex_none().p(12).gap(8).child(h_flex().items_center().gap(8).child(div().text_size(12).font_weight(600).text_color(tone).child(String(title??'—')))
   .when(count!==null,e=>e.child(div().text_size(11).px(6).rounded(9).border_1().border_color(C.strong).bg(C.control).text_color(C.tertiary).child(String(count)))));
 }
 // A card that folds: its title opens or closes it; `open` is how it starts, a click flips it for this page.
 fold(key,title,content,open){
  const on=this.toggled.has(key)?!open:open;
  return card().flex_none().p(12).gap(8)
   .child(h_flex().id('fold-'+key).cursor_pointer().items_center().gap(6).on_click((_e,cx)=>{if(this.toggled.has(key))this.toggled.delete(key);else this.toggled.add(key);cx.notify();})
    .child(div().w(10).text_size(11).text_color(C.tertiary).child(on?'▾':'▸')).child(div().text_size(12).font_weight(600).text_color(C.tertiary).child(String(title??'—'))))
   .when(on,e=>e.child(content()));
 }
 md(id,text){return TextView.markdown(id,plainMentions(text||''));}
 // The head of the issue: its title, then its state, priority, assignee, project and labels as chips.
 titleBlock(i){
  return v_flex().flex_none().gap(6)
   .child(div().text_size(16).font_weight(600).text_color(C.title).child(String(i.title??'—')))
   .child(h_flex().w_full().min_w(0).flex_wrap().gap(6)
    .child(chip(i.state?.name||'—')).child(chip(priorityName(i.priority))).child(chip(i.assignee?.name||T.unassigned)).child(chip(i.project?.name||T.issue.noProject))
    .children((i.labels||[]).map(l=>labelChip(l))));
 }
 comments(i){return this.block(T.issue.comments,i.comments.length).children(i.comments.map((c,n)=>v_flex().gap(4).child(note(c.user?.name||T.issue.author)).child(this.md('comment-'+n,c.body))));}
 // What waits for an answer, first, on an amber card: one row per question.
 openCard(open){
  return this.block(open.title||T.issue.toDecide,open.items.length,C.amber).border_color('#6B5218').bg('#2A2112')
   .when(Boolean(open.lead),e=>e.child(this.md('open-lead',open.lead)))
   .children(open.items.map((q,n)=>h_flex().w_full().items_start().gap(10).pt(n?8:0).when(n>0,e=>e.border_t_1().border_color('#4A3A16'))
    .child(div().w(10).flex_none().font_weight(700).text_color(C.amber).child('?')).child(v_flex().flex_1().min_w(0).child(this.md('open-'+n,q)))))
   .when(Boolean(open.rest),e=>e.child(this.md('open-rest',open.rest)));
 }
 // What is decided: one row per decision, a check, its text, then who decided, when, and the words quoted.
 decidedCard(decided){
  return this.block(decided.title||T.issue.decided,decided.items.length)
   .when(Boolean(decided.lead),e=>e.child(this.md('decided-lead',decided.lead)))
   .children(decided.items.map((d,n)=>h_flex().w_full().items_start().gap(10).pt(n?8:0).when(n>0,e=>e.border_t_1().border_color(C.rowBorder))
    .child(div().w(10).flex_none().font_weight(700).text_color(C.done).child('✓'))
    .child(v_flex().flex_1().min_w(0).gap(2).child(this.md('decided-'+n,d.text))
     .when(Boolean(d.who||d.date),e=>e.child(h_flex().flex_wrap().gap(8).text_size(12).text_color(C.tertiary)
      .when(Boolean(d.who),e=>e.child(div().font_weight(500).text_color(C.secondary).child(d.who)))
      .when(Boolean(d.date),e=>e.child(div().child(dayOf(d.date+'T12:00:00')||d.date)))
      .when(Boolean(d.quote),e=>e.child(div().min_w(0).child(d.quote))))))))
   .when(Boolean(decided.rest),e=>e.child(this.md('decided-rest',decided.rest)));
 }
 // The question of the PO on the step it closes (a question without gate on the current step), with its answers:
 // buttons while the PO waits idle, the answers to type in its terminal otherwise. The first answer is the validation.
 questionBlock(po,step,current){
  // A session stopped on purpose takes no answer, whatever its terminal still reports.
  const q=po?.question;if(!q||po.stoppedAt||questionStale(po))return null;
  const at=ownValue(GATE_STEPS,q.gate)||current;if(at!==step)return null;
  // Answers are offered once the issue was read again for this very question: never on a proposal read before.
  const id=shared('fabrique-console.issue'),waiting=questionAnswerable(po),fresh=this.fresh(id,po),live=waiting&&fresh&&!this.answering;
  const why=this.answering?T.issue.answering:!waiting?T.issue.answerInTerminal:this.reading?T.issue.reading:T.issue.notRead;
  return this.block(T.issue.questions,null,C.amber).border_color('#6B5218')
   .child(div().text_color(C.text).child(String(q.text??'')))
   .when(Boolean(q.options?.length),e=>e.child(h_flex().flex_wrap().gap(6).children(q.options.map((o,n)=>live?btn('answer-'+n,o,(_e,cx)=>this.answerWith(cx,po,o,n),{small:true,primary:n===0}):chip(o)))))
   .when(!live,e=>e.child(note(why)));
 }
 // A button names its answer by its place: the first is the validation that moves the step (optionIndex 0).
 answerWith(cx,po,text,optionIndex){
  const q=po.question;if(this.answering||!q||!this.fresh(shared('fabrique-console.issue'),po))return;
  this.answering=true;this.error='';cx.notify();
  cx.spawn(async cx=>{
   try{await api(MOD,'po-answer',{sessionId:po.id,id:q.id,askedAt:q.askedAt,text,source:'issue-page',...(Number.isInteger(optionIndex)?{optionIndex}:{})});await reloadSnapshot(MOD);}
   catch(e){this.error=String(e.message||e);}
   finally{this.answering=false;cx.notify();}
  });
 }
 // Plan: the issue, the clarification (what waits, what is decided, the facts folded) and the plan. The text of the
 // ticket opens folded once a clarification exists.
 planContent(i,box){
  const c=clarificationOf(i.description),plan=mdSection(i.description,'Plan'),rest=withoutSections(i.description,['Clarification','Plan','Découpage','Validation']);
  box=box.child(this.titleBlock(i));
  if(partShown(c?.open))box=box.child(this.openCard(c.open));
  if(partShown(c?.decided))box=box.child(this.decidedCard(c.decided));
  if(plan)box=box.child(this.block(T.issue.plan).child(this.md('step-plan',plan)));
  if(c?.facts)box=box.child(this.fold('facts',c.facts.title||T.issue.facts,()=>v_flex().gap(6).when(Boolean(c.facts.lead),e=>e.child(this.md('facts-lead',c.facts.lead))).child(this.md('facts',c.facts.items.map(x=>'- '+x.replace(/\n/g,'\n  ')).join('\n'))).when(Boolean(c.facts.rest),e=>e.child(this.md('facts-rest',c.facts.rest))),false));
  for(const [n,o] of (c?.others||[]).entries())box=box.child(this.block(o.title).child(this.md('other-'+n,o.body)));
  box=box.child(this.fold('context',T.issue.context,()=>this.md('issue-description',rest||T.issue.noDescription),!c));
  return box.when(Boolean(i.comments?.length),e=>e.child(this.comments(i)));
 }
 // Découpage (variant A, the user 2026-11-07): one line per ticket in aligned columns — number, ticket, content, level
 // (a coloured dot), agent, model with its effort in bars, what it waits for — under a line that counts them; the
 // notes of the PO fold below. A table the page does not know is shown as written.
 splitContent(i,box,empty){
  const section=mdSection(i.description,'Découpage');if(!section)return box.child(empty);
  const t=mdTable(section),split=splitRows(t);
  if(!split)return box.child(this.block(T.issue.split).child(this.md('split',section)));
  const s=split.summary,notes=[t.before,t.after].filter(Boolean).join('\n\n');
  const LEVEL={léger:C.done,standard:C.running,fort:C.danger};
  const level=r=>h_flex().items_center().gap(5).text_size(12).text_color(C.secondary).when(Boolean(ownValue(LEVEL,r.level)),e=>e.child(div().w(7).h(7).rounded(4).flex_none().bg(ownValue(LEVEL,r.level)))).child(r.level||'—');
  return box.child(this.block(T.issue.split,s.total)
   .child(div().text_size(12).text_color(C.tertiary).child(T.issue.splitSummary(s)))
   .child(this.ticketTable(split.rows,T.issue.ticketCols.level,level,{key:'split',detail:r=>this.splitDetail(r)}))
   .when(Boolean(notes),e=>e.child(this.fold('split-notes',T.issue.splitNotes,()=>this.md('split-notes',notes),false))));
 }
 // A row of the split unfolded: its whole content (the line cuts it) and what it waits for.
 splitDetail(r){
  return v_flex().gap(4).child(this.md('split-detail-'+r.n,r.content||'—'))
   .when(r.waits.length>0,e=>e.child(note(T.issue.waits(r.waits.join(', ')))));
 }
 // A ticket of the Réalisation unfolded: its description as Tracker has it, read when the row opens, and its page.
 devDetail(r){
  const d=this.details.get(r.id);
  if(!d||d.loading)return note(T.issue.ticketLoading);
  if(d.error)return div().text_size(12).text_color(C.danger).child(d.error);
  const url=String(d.issue?.url||'');
  // The terminals of the ticket (its dev, then each reviewer), when the window still shows them.
  const terms=r.run?[[r.run.terminalId,T.issue.run.devTerminal],...(r.run.reviews||[]).map((v,n)=>[v?.terminalId,T.issue.run.reviewTerminal(n+1)])]
   .map(([t,label],n)=>({tab:t?poTab(agents(),t):null,label,n})).filter(x=>x.tab):[];
  const sha=/^[0-9a-f]{7,40}$/.test(String(r.run?.commit||''))?r.run.commit.slice(0,8):'';
  return v_flex().gap(6).child(this.md('ticket-'+r.id,d.issue?.description||T.issue.noDescription))
   .child(h_flex().gap(6).items_center()
    .when(/^https:\/\/[^\s/@]+\//.test(url),e=>e.child(btn('ticket-open-'+r.id,T.issue.open,(_e,cx)=>{cx.spawn(async()=>{await exec('open',[url]);});},{small:true})))
    .children(terms.map(x=>btn('ticket-term-'+r.id+'-'+x.n,x.label,()=>{run('space.select',{id:x.tab.space});run('tab.select',{id:x.tab.tab});},{small:true})))
    .when(Boolean(sha),e=>e.child(div().font_family('JetBrains Mono').text_size(11.5).text_color(C.tertiary).child(T.issue.run.commit(sha)))));
 }
 loadTicket(cx,id){
  if(!id||this.details.get(id)?.issue)return;
  this.details.set(id,{loading:true});cx.notify();
  cx.spawn(async cx=>{
   try{const data=await api(MOD,'ticket-detail',{id});this.details.set(id,{issue:data.issue});}
   catch(e){this.details.set(id,{error:String(e.message||e)});}
   finally{cx.notify();}
  });
 }
 // The table of tickets shared by Découpage and Réalisation (variant A): number, ticket, content, one column of the
 // step (level, or state), agent, model with its effort in bars, what it waits for. Every row has the same widths.
 // A click on a row unfolds its detail under it (`detail`, `open` to read what it needs); `sub` adds a line under a
 // row whatever its state (the reviewer at work).
 ticketTable(rows,thirdTitle,third,{key='t',detail=null,open=null,sub=null}={}){
  const AGENT={claude:'#D8A27E',codex:'#8FB4FF'},W=[24,66,0,92,58,124,76];
  const cellBox=(n,child)=>(W[n]?div().w(W[n]).flex_none():div().flex_1()).min_w(0).truncate().child(child);
  const head=h_flex().w_full().gap(8).pb(6).border_b_1().border_color(C.barBorder).text_size(11).font_weight(600).text_color(C.tertiary)
   .children(['#',T.issue.ticketCols.ticket,T.issue.ticketCols.content,thirdTitle,T.issue.ticketCols.agent,T.issue.ticketCols.model,T.issue.ticketCols.waits].map((h,n)=>cellBox(n,h)));
  const bars=e=>h_flex().gap(2).children([1,2,3].map(k=>div().w(4).h(10).rounded(1).bg(k<=e?C.secondary:C.strong)));
  const mono=v=>div().font_family('JetBrains Mono').text_size(12).text_color(C.tertiary).child(v);
  const row=(r,n)=>{
   const rowKey=key+'|'+(r.id||r.n),on=this.openRows.has(rowKey),below=sub?sub(r):null;
   return v_flex().w_full().py(6).when(n>0,e=>e.border_t_1().border_color(C.rowBorder))
   .child(h_flex().id('row-'+rowKey).w_full().items_center().gap(8).rounded(4).when(Boolean(detail),e=>e.cursor_pointer().hover(s=>s.bg(C.rowSelected))
     .on_click((_e,cx)=>{if(this.openRows.has(rowKey))this.openRows.delete(rowKey);else{this.openRows.add(rowKey);if(open)open(cx,r);}cx.notify();}))
    .child(cellBox(0,mono(r.n===null?'—':String(r.n))))
    .child(cellBox(1,mono(r.id||'—')))
    .child(cellBox(2,div().truncate().text_color(C.text).child(r.content||'—')))
    .child(cellBox(3,third(r)))
    .child(cellBox(4,div().text_size(12).font_weight(600).text_color(ownValue(AGENT,r.agent)||C.secondary).child(ownValue(T.issue.agentName,r.agent)||r.agent||'—')))
    .child(cellBox(5,h_flex().items_center().gap(6).text_size(12).text_color(C.secondary).child(div().min_w(0).truncate().child(modelShort(r.model)||'—')).when(r.effort>0,e=>e.child(bars(r.effort)))))
    .child(cellBox(6,div().text_size(12).text_color(r.waits.length?C.tertiary:C.done).child(r.waits.length?'← '+r.waits.join(', '):T.issue.free))))
   .when(Boolean(r.modelIssue),e=>e.child(div().pl(106).text_size(12).text_color(C.danger).child(String(r.modelIssue))))
   .when(Boolean(below),e=>e.child(div().pl(106).pt(4).child(below)))
   .when(on&&Boolean(detail),e=>e.child(div().ml(106).mt(6).p(10).rounded(5).bg(C.window).border_1().border_color(C.rowBorder).child(detail(r))));
  };
  return v_flex().w_full().child(head).children(rows.map(row));
 }
 // Réalisation: the sub-issues of the issue as Tracker has them now, in the table of the split validated.
 devContent(i,box,empty,po){
  const kids=Array.isArray(i.children)?i.children:[],partial=i.childrenComplete===false;
  // A list Tracker could not give (or gave cut) is said as such: an empty list unread is never shown as no ticket.
  const why=note(ownValue(T.issue.childrenWhy,i.childrenReason)||T.issue.more);
  if(!kids.length)return box.child(partial?why:empty);
  const dev=devRows(kids,splitRows(mdTable(mdSection(i.description,'Découpage'))),po?.tickets),s=dev.summary;
  const flow=devFlow(dev.rows,this.reports);
  const devTab=id=>agents().find(a=>a.tab_name===T.issue.devTabName(id))||null;
  const dot=(tone,size=7)=>div().w(size).h(size).rounded(4).flex_none().bg(ownValue(RUN_COLORS(),tone)||C.tertiary);
  // The column of the step: where the ticket stands (its stage once launched, its Tracker state before).
  // A ticket whose dev tab runs shows that tab's state (working, waiting for the user, finished), else its Tracker state.
  const DEV_TONE={working:'rev',blocked:'dec',done:'ok',idle:'ok'};
  const FLOW_TONE={review:'rev',fix:'dec',accepted:'ok'};
  const state=r=>{const f=flow[r.id]?.stage;if(f)return h_flex().items_center().gap(5).text_size(12).text_color(C.text).child(dot(FLOW_TONE[f])).child(div().min_w(0).truncate().child(T.issue.flowStage[f]));
   const t=devTab(r.id);if(t)return h_flex().items_center().gap(5).text_size(12).text_color(C.text).child(dot(ownValue(DEV_TONE,t.status)||'unk')).child(div().min_w(0).truncate().child(ownValue(T.issue.devStatus,t.status)||'—'));
   const p=progressOf(r);return h_flex().items_center().gap(5).text_size(12).text_color(p.run?C.text:C.secondary).child(dot(p.tone)).child(div().min_w(0).truncate().child(p.text));};
  // Under a ticket, one small line per reviewer: who, with which model, where the review stands.
  // A dev that waits for the user: a line under its ticket, with a button that opens its tab where it asks.
  const asks=r=>{const t=devTab(r.id);if(!t)return null;const ask=t.status==='blocked';
   return h_flex().items_center().gap(8).text_size(12).text_color(ask?C.amber:C.tertiary)
    .child(div().child('↳ '+(ownValue(T.issue.agentName,r.agent)||r.agent||'Dev')+' · '+(ask?T.issue.devAsks(r.id):(ownValue(T.issue.devStatus,t.status)||'—'))))
    .child(btn('dev-open-'+r.id,T.issue.devOpenTab,()=>{run('space.select',{id:t.space});run('tab.select',{id:t.tab});},{small:true,primary:ask}));};
  const sub=r=>{const ask=asks(r),rev=reviews(r);return ask&&rev?v_flex().gap(4).child(ask).child(rev):ask||rev;};
  const reviews=r=>{const lines=reviewLines(r.run);return lines.length?v_flex().gap(2).children(lines.map(l=>h_flex().items_center().gap(6).text_size(11.5).text_color(C.tertiary)
   .child(div().child('↳ '+T.issue.run.review)).child(div().font_weight(600).text_color(ownValue(AGENT_COLORS,l.agent)||C.secondary).child(ownValue(T.issue.agentName,l.agent)||l.agent||'—'))
   .child(div().child(modelShort(l.model)||'—')).child(dot(l.tone,6)).child(div().text_color(C.secondary).child(l.text)).when(Boolean(l.since),e=>e.child(div().child('· '+l.since))))):null;};
  // "Lancer les devs": one agent per ticket free to start (nothing it waits for, not started in Tracker, not launched
  // from this page yet), with its agent, model and effort.
  const EFF=['','low','medium','high'];
  const free=dev.rows.filter(r=>waitsMet(r,dev.rows,flow)&&!flow[r.id]?.stage&&!r.run&&!['started','completed','canceled'].includes(r.state?.type)&&!this.devLaunched.has(r.id)&&!devTab(r.id)&&['claude','codex'].includes(r.agent)&&r.model&&EFF[r.effort]);
  // On top, an amber card like the question of the plan: what can start now, what waits, and the button.
  const waiting=dev.rows.filter(r=>!waitsMet(r,dev.rows,flow)&&!r.run&&!['completed','canceled'].includes(r.state?.type)).length;
  const panel=po?this.followPanel(po,dev.rows,free,waiting,devTab,EFF):null;
  // The panel stays fixed above the part that scrolls: render takes it from here.
  this.fixedPanel=panel;
  return box
   .child(this.ticketCards(dev.rows,flow,devTab))

   .child(this.workspaceBlock(po));
 }
 // Launches the devs one after the other; a ticket launched is not offered again from this page.
 // The follow-up of the Réalisation, always shown: a bar of stages (worktree, launch, development, review,
 // validation), what each dev does right now, the tickets that can start with their button, and the story of what
 // happened, step after step, with its time. It reads the dev tabs every two seconds (tick).
 // The tickets of the Réalisation, one block of two lines each (the user, 2026-11-08: "plus clair, plus simple"):
 // the ticket, its title and where it stands in a coloured pill, with one button to the tab that works on it now
 // (its reviewer while in review, else its dev); below, who works on it and what it waits for. A click on a ticket
 // unfolds its Tracker description.
 ticketCards(rows,flow,devTab){
  // The tickets (design of the user, 2026-11-08): the identifier on the left; the title, then small chips (agent, model,
  // level) and what it waits for; its state in a pill with its sign; Ouvrir (the tab at work) and a Tracker link. Seven
  // tickets show; the rest unfolds with "Tout afficher".
  const I=T.issue,P=I.pill,tabByName=n=>agents().find(a=>a.tab_name===n)||null,name=id=>rows.find(x=>String(x.n)===String(id))?.id||String(id);
  const url=r=>String((this.issue?.children||[]).find(k=>k.identifier===r.id)?.url||'');
  const reviewChips=r=>{const f=flow[r.id];if(!f?.dev)return [];
   return Array.from({length:f.need},(_,k)=>k+1).map(n=>{
    const v=f.reviews[n-1],t=tabByName(I.reviewTabName(r.id,n)),who=ownValue(I.agentName,reviewerFor(r.agent,n).tool)||'';
    const [kind,xj,bg,border,sign]=v?.verdict==='accepted'?['ok',C.done,'#163322','#2E6B45','✓']:v?.verdict==='changes_requested'?['fix',C.amber,'#3A2D14','#6B5218','↺']:t&&t.status==='blocked'?['ask',C.amber,'#3A2D14','#6B5218','⌛']:t?['run','#C4A7FF','#2C2244','#5B4A8A','◉']:['todo',C.tertiary,C.window,C.strong,'○'];
    return h_flex().id('rev-'+r.id+'-'+n).flex_none().items_center().gap(5)
     .when(Boolean(t),e=>e.cursor_pointer().on_click(()=>{run('space.select',{id:t.space});run('tab.select',{id:t.tab});}))
     .child(div().text_size(12).font_weight(700).text_color(xj).child(sign))
     .child(div().text_size(12).text_color(C.secondary).border_b_1().border_color(C.strong).hover(e=>e.text_color(C.title)).child(I.reviewChip(n,kind)+' · '+who));
   });};
  const TONES={dev:[C.running,'#16304F','#2F5A9E','◉'],ask:[C.amber,'#3A2D14','#6B5218','⌛'],review:['#C4A7FF','#2C2244','#5B4A8A','◉'],fix:[C.amber,'#3A2D14','#6B5218','↺'],ok:[C.done,'#163322','#2E6B45','✓'],todo:[C.secondary,C.control,C.strong,'○'],wait:[C.tertiary,C.window,C.strong,'⌛']};
  const statusOf=r=>{
   const f=flow[r.id],d=devTab(r.id),rv=tabByName(I.reviewTabName(r.id,1));
   if(f?.stage==='accepted')return {k:'ok',text:P.accepted,tab:d};
   if(f?.stage==='fix')return {k:'fix',text:d&&d.status==='working'?P.fixing:P.fix,tab:d};
   if(f?.stage==='review')return rv&&rv.status==='blocked'?{k:'ask',text:P.reviewAsks,tab:rv}:{k:'review',text:P.review,tab:rv||d};
   if(d)return d.status==='blocked'?{k:'ask',text:P.asks,tab:d}:d.status==='working'?{k:'dev',text:P.dev,tab:d}:{k:'review',text:P.devDone,tab:d};
   if(!waitsMet(r,rows,flow))return {k:'wait',text:P.waits(r.waits.map(name).join(', ')),tab:null};
   if(r.state?.type==='completed')return {k:'ok',text:P.done,tab:null};
   return {k:'todo',text:P.todo,tab:null};
  };
  const st=rows.map(r=>({r,s:statusOf(r)})),count=k=>st.filter(x=>x.s.k===k).length;
  this.devCount=I.stepCount(count('ok'),rows.length);
  const chip_=(text,color=C.secondary)=>div().flex_none().px(6).py(1).rounded(4).border_1().border_color(C.strong).bg(C.control).text_size(11.5).text_color(color).child(text);
  const LEVEL={léger:I.levels.light,standard:I.levels.standard,fort:I.levels.strong};
  // A ticket (design of the user, 2026-11-08): a thin bar of its state's colour on the left; its identifier and title,
  // its state on the right in coloured text; its chips (agent, model, level, tinted) and what it waits for; its reviews
  // as links; Ouvrir (its dev) and Tracker as small grey links at the bottom right.
  const tint=(text,color)=>div().flex_none().px(6).py(1).rounded(4).border_1().border_color(C.strong).bg(C.control).text_size(11.5).text_color(color).child(text);
  const link=(id,text,click)=>div().id(id).flex_none().cursor_pointer().text_size(12).text_color(C.tertiary).hover(e=>e.text_color(C.title)).on_click(click).child(text);
  const card=({r,s},n)=>{
   const [xj,,,sign]=TONES[s.k],u=url(r),d=devTab(r.id);
   // A very light background tinted by the state: green done, blue in dev, purple in review, amber to fix or asking.
   const SOFT={ok:'#1D2924',dev:'#1D2533',review:'#24222F',fix:'#2A2620',ask:'#2A2620',todo:'#21252B',wait:'#21252B'};
   return h_flex().w_full().min_w(0).items_stretch().rounded(6).bg(SOFT[s.k]||'#21252B').px(10).when(n>0,e=>e.mt(6))
    .child(v_flex().flex_1().min_w(0).gap(5).py(8)
     .child(h_flex().w_full().min_w(0).items_center().gap(8)
      .child(div().flex_none().font_family('JetBrains Mono').text_size(12).text_color(C.tertiary).child(r.id))
      .child(div().flex_1().min_w(0).truncate().text_size(13).font_weight(600).text_color(C.title).child(r.content||'—'))
      .child(div().flex_none().text_size(12.5).font_weight(700).text_color(xj).child(sign+' '+s.text)))
     .child(h_flex().flex_wrap().items_center().gap(6)
      .child(tint(ownValue(I.agentName,r.agent)||r.agent||'—',ownValue(AGENT_COLORS,r.agent)||C.secondary))
      .child(tint(modelShort(r.model)||'—',C.secondary).font_family('JetBrains Mono'))
      .when(Boolean(ownValue(LEVEL,r.level)),e=>e.child(tint(ownValue(LEVEL,r.level),ownValue({léger:C.done,standard:C.running,fort:C.danger},r.level)||C.secondary)))
      .child(div().text_size(11.5).text_color(C.tertiary).child(r.waits.length?I.after(r.waits.map(name).join(', ')):I.free2))
      // What the ticket took, once its dev reported (lot 6): dev time, rounds of review, review time.
      .when(Boolean(I.metrics(this.metrics?.[r.id])),e=>e.child(div().flex_1().min_w(0).truncate().text_right().text_size(11.5).text_color(C.tertiary).child(I.metrics(this.metrics?.[r.id])))))
     .child(h_flex().w_full().min_w(0).items_center().gap(14)
      // One link per review of the current commit: its verdict and its reviewer; a click opens the reviewer's tab.
      .child(h_flex().flex_1().min_w(0).flex_wrap().gap(18).children(flow[r.id]?.dev?reviewChips(r):[]))
      .when(Boolean(d),e=>e.child(link('card-d-'+r.id,I.devOpen,()=>{run('space.select',{id:d.space});run('tab.select',{id:d.tab});})))
      .when(/^https:\/\/[^\s/@]+\//.test(u),e=>e.child(link('card-tracker-'+r.id,I.tracker,(_e,cx)=>{cx.spawn(async()=>{await exec('open',[u]);});})))));
  };
  // Just the tickets, one under the other (the user, 2026-11-08): no frame, no head, all of them.
  return v_flex().w_full().children(st.map(card));
 }
 // The Validation (the user, 2026-11-09): the test server and the app to open; what the QA agent found; the test plan,
 // step by step, each with OK or Problème. A problem goes to the PO, who makes a ticket of it with the user.
 validationPanel(i,po){
  const V=T.issue.val,d=this.valData,qa=d?.qa,marks=d?.marks||{},home=po.terminalId?poTab(agents(),po.terminalId):null;
  const tab=name=>agents().find(a=>a.tab_name===name)||null,srv=serverOfPlan(i.description),srvTab=tab(V.serverTab(po.identifier)),qaTab=tab(T.issue.qaTabName(po.identifier));
  const open=t=>()=>{run('space.select',{id:t.space});run('tab.select',{id:t.tab});};
  const startServer=()=>{if(!srv||!po.worktree||!home)return;run('tab.new',{name:V.serverTab(po.identifier),space:home.space,folder:po.worktree+(srv.dir?'/'+srv.dir:''),argv:srv.argv});run('space.select',{id:home.space});run('tab.select',{id:home.tab});this.logEvent(po.issueId,V.serverStarted,'run');};
  const tests=qa?.tests||[],ok=tests.filter(t=>marks[t.id]?.result==='ok').length,ko=tests.filter(t=>marks[t.id]?.result==='ko').length;
  const markAs=(cx,t,result)=>{cx.spawn(async cx=>{try{const r=await api(MOD,'validation-mark',{sessionId:po.id,step:t.id,result});this.valData={...(this.valData||{}),marks:r.marks};
    if(result==='ko'&&po.terminalId)await api(MOD,'dev-send',{sessionId:po.id,terminal:po.terminalId,text:V.problemToPo(t.id,t.title)});}catch(e){this.error=String(e.message||e);}finally{cx.notify();}});};
  const head=h_flex().w_full().min_w(0).items_center().gap(10)
   .child(div().flex_none().text_size(13).font_weight(700).text_color(C.title).child(V.title))
   .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(C.tertiary).child(tests.length?V.progress(ok,ko,tests.length):qa?'':V.qaRunning))
   .when(Boolean(srv)&&!srvTab,e=>e.child(btn('val-server',V.startServer,()=>startServer(),{small:true,primary:true})))
   .when(Boolean(srvTab),e=>e.child(div().id('val-server-tab').flex_none().cursor_pointer().text_size(12).text_color(C.tertiary).hover(e=>e.text_color(C.title)).on_click(open(srvTab)).child(V.serverRuns)))
   .when(Boolean(srv?.url),e=>e.child(btn('val-open-app',V.openApp,(_e,cx)=>{const u=srv.url;cx.spawn(async()=>{await exec('open',[u]);});},{small:true})))
   .when(!srv,e=>e.child(div().flex_none().text_size(11.5).text_color(C.tertiary).child(V.noServer)));
  const qaBlock=qa?v_flex().gap(4)
    .child(h_flex().items_center().gap(8).child(div().text_size(12).font_weight(700).text_color(qa.verdict==='ok'?C.done:C.amber).child((qa.verdict==='ok'?'✓ ':'⚠ ')+V.qaTitle))
     .when(Boolean(qaTab),e=>e.child(div().id('val-qa-tab').cursor_pointer().text_size(12).text_color(C.tertiary).hover(e=>e.text_color(C.title)).on_click(open(qaTab)).child(V.openQa))))
    .child(this.md('val-qa-summary',qa.summary||'—'))
   :h_flex().items_center().gap(8).child(div().text_size(12.5).text_color(C.secondary).child(qaTab?V.qaRunning:V.qaWaits))
    .when(Boolean(qaTab),e=>e.child(div().id('val-qa-tab2').cursor_pointer().text_size(12).text_color(C.tertiary).hover(e=>e.text_color(C.title)).on_click(open(qaTab)).child(V.openQa)));
  const row=(t,n)=>{const m=marks[t.id]?.result,bg=m==='ok'?'#1D2924':m==='ko'?'#2A2620':'#21252B';
   return h_flex().w_full().min_w(0).items_start().gap(10).p(10).rounded(6).bg(bg).when(n>0,e=>e.mt(6))
    .child(div().flex_none().w(22).font_family('JetBrains Mono').text_size(12).text_color(C.tertiary).child(String(t.id)))
    .child(v_flex().flex_1().min_w(0).gap(3)
     .child(div().text_size(13).font_weight(600).text_color(C.title).child(t.title||'—'))
     .when(Boolean(t.steps),e=>e.child(div().text_size(12).text_color(C.secondary).child(t.steps)))
     .when(Boolean(t.expected),e=>e.child(div().text_size(12).text_color(C.tertiary).child(V.expected(t.expected))))
     // What the QA agent found when it played the step in a browser, and its screenshot (lot 8).
     .when(Boolean(t.auto),e=>e.child(h_flex().min_w(0).items_center().gap(8)
      .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(t.auto==='ok'?C.done:t.auto==='ko'?C.danger:C.tertiary).child(V.auto(t.auto,t.note)))
      .when(Boolean(t.shot),e=>e.child(div().id('shot-'+t.id).flex_none().cursor_pointer().text_size(12).text_color(C.tertiary).hover(e=>e.text_color(C.title)).on_click((_e,cx)=>{cx.spawn(async()=>{await exec('open',[t.shot]);});}).child(V.shot))))))
    .child(h_flex().flex_none().gap(6)
     .child(btn('val-ok-'+t.id,m==='ok'?'✓ '+V.ok:V.ok,(_e,cx)=>markAs(cx,t,m==='ok'?null:'ok'),{small:true,primary:m==='ok'}))
     .child(btn('val-ko-'+t.id,m==='ko'?'✗ '+V.ko:V.ko,(_e,cx)=>markAs(cx,t,m==='ko'?null:'ko'),{small:true})));};
  // The non-blocking notes of the reviews, gathered ticket by ticket: what the reviewers left for the Validation.
  const notes=(this.reports||[]).filter(x=>/^review-/.test(x.kind)&&Array.isArray(x.notes)&&x.notes.length).map(x=>({ticket:x.ticket,notes:x.notes.slice(0,8)}));
  const notesBlock=notes.length?this.fold('val-notes',V.notes(notes.reduce((n,x)=>n+x.notes.length,0)),()=>v_flex().gap(6).children(notes.map(x=>v_flex().gap(2)
    .child(div().font_family('JetBrains Mono').text_size(12).text_color(C.tertiary).child(x.ticket))
    .children(x.notes.map(t=>div().text_size(12.5).text_color(C.secondary).child('· '+String(t).slice(0,400)))))),false):null;
  return v_flex().gap(10)
   .child(v_flex().gap(8).px(14).py(10).rounded(6).border_1().border_color('#6B5218').bg('#2A2112').child(head).child(qaBlock))
   .when(Boolean(notesBlock),e=>e.child(notesBlock))
   .when(tests.length>0,e=>e.child(v_flex().w_full().children(tests.map(row))));
 }
 // The Validation reads the QA report and the marks every six seconds while it shows.
 valTick(cx,po){
  if((this.picked||stepOf(po))!=='check'||!po?.worktree||this.valReading||++this.valTicks%3)return;
  this.valReading=true;
  cx.spawn(async cx=>{try{this.valData=await api(MOD,'validation-read',{sessionId:po.id});}catch{}finally{this.valReading=false;cx.notify();}});
 }
 followPanel(po,rows,free,waiting,devTab,EFF){
  // "À vérifier" (design of the user, 2026-11-08): what waits for him — a dev or a reviewer that asks, a dev that
  // finished its turn — one line each with Ouvrir; a badge counts them, the launch figures stand on the right. The
  // rest (the story of the launch) unfolds with "Tout afficher". Three lines at most otherwise.
  const F=T.issue.follow,tabs=rows.map(r=>({r,t:devTab(r.id)})).filter(x=>x.t);
  const open=t=>()=>{run('space.select',{id:t.space});run('tab.select',{id:t.tab});};
  const flow=devFlow(rows,this.reports),short=t=>String(t||'').replace(/\s+/g,' ').slice(0,110);
  // What needs a look: an agent that asks; a ticket whose review asks for changes (what it says, and whether the dev is
  // fixing it); a dev that ended its turn without its report. A ticket accepted or in review is not a matter for the user.
  const fixes=rows.filter(r=>flow[r.id]?.stage==='fix').map(r=>{const d=devTab(r.id),v=flow[r.id].reviews.find(x=>x&&x.verdict==='changes_requested');
   return {id:r.id,text:(d&&d.status==='working'?F.fixing:F.toFix)+' — '+short(v?.summary),open:d?open(d):null,ask:true};});
  const asks=[...fixes,...tabs.filter(x=>x.t.status==='blocked').map(({r,t})=>({id:r.id,text:F.asks,open:open(t),ask:true})),
   ...agents().filter(a=>/ · revue( \d)?$/.test(String(a.tab_name||''))&&a.status==='blocked').map(a=>({id:String(a.tab_name).split(' · ')[0],text:F.reviewAsks,open:open(a),ask:true}))];
  const dones=tabs.filter(x=>['done','idle'].includes(x.t.status)&&!flow[x.r.id]?.dev).map(({r,t})=>({id:r.id,text:F.noReport,open:open(t)}));
  const events=this.devLog(po.issueId).slice().reverse().map(ev=>({id:ev.at,text:ev.text+(ev.detail?' — '+ev.detail:''),event:true}));
  const all=[...asks,...dones,...events],showAll=this.toggled.has('follow-all'),shown=showAll?all.slice(0,40):all.slice(0,3);
  const working=tabs.filter(x=>x.t.status==='working').length,waitN=asks.length+dones.length;
  const launchBtn=free.length&&!this.devBusy?btn('launch-devs',T.issue.launchDevs(free.length),(_e,cx)=>this.launchDevs(cx,po,free.map(r=>({identifier:r.id,tool:r.agent,model:r.model,effort:EFF[r.effort]}))),{small:true,primary:true}):null;
  const row=it=>h_flex().w_full().min_w(0).items_center().gap(10).py(6).border_t_1().border_color('#4A3A16')
   .child(div().flex_none().w(58).font_family('JetBrains Mono').text_size(11.5).text_color(C.tertiary).child(it.id))
   .child(div().flex_1().min_w(0).truncate().text_size(12.5).font_weight(it.event?400:600).text_color(it.event?C.secondary:it.ask?C.amber:C.text).child(it.text))
   .when(Boolean(it.open),e=>e.child(div().flex_none().child(btn('follow-'+it.id+'-'+it.text.length,T.issue.devOpen,it.open,{small:true,primary:Boolean(it.ask)}))));
  return v_flex().when(showAll,e=>e.flex_1().min_h(0)).when(!showAll,e=>e.flex_none()).gap(2).px(14).py(10).rounded(6).border_1().border_color('#6B5218').bg('#2A2112')
   .child(h_flex().w_full().min_w(0).items_center().gap(10).pb(4)
    .child(div().flex_none().text_size(13).font_weight(700).text_color(C.title).child(F.title))
    .when(waitN>0,e=>e.child(div().flex_none().px(7).py(1).rounded(5).border_1().border_color('#6B5218').bg('#3A2D14').text_size(11.5).font_weight(600).text_color(C.amber).child('⌛ '+F.waitingYou(waitN))))
    .child(div().flex_1().min_w(0).truncate().text_right().text_size(11.5).text_color(C.tertiary).child(tabs.length?F.running(working,tabs.length):free.length?T.issue.devReadyText(free.map(r=>r.id),waiting):F.nobody))
    .when(Boolean(launchBtn),e=>e.child(div().flex_none().child(launchBtn)))
    // Tout afficher / Réduire stays in the head, so the panel always closes, however long the list.
    .when(all.length>3,e=>e.child(div().id('follow-all').flex_none().cursor_pointer().text_size(11.5).text_color(C.secondary).hover(e=>e.text_color(C.title))
     .on_click((_e,cx)=>{if(showAll)this.toggled.delete('follow-all');else this.toggled.add('follow-all');cx.notify();}).child(showAll?F.less:F.showAll))))
   // Unfolded, the list scrolls inside a bounded height; folded, three lines and what is left.
   .when(showAll,e=>e.child(v_flex().id('follow-list').flex_1().min_h(0).overflow_y_scrollbar().children(shown.map(row))))
   .when(!showAll,e=>e.children(shown.map(row)).when(all.length>3,e=>e.child(div().pt(4).text_size(11.5).text_color(C.tertiary).child(F.more(all.length-3)))));
 }
 // The story of the devs of an issue: kept in memory and in the shared store, so the page finds it again.
 devLog(issueId){const c=this.chainLogs?.[issueId];return Array.isArray(c)?c:Array.isArray(this.logs?.[issueId])?this.logs[issueId]:[];}
 logEvent(issueId,text,tone='ok',detail=''){
  const d=new Date(),at=String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0');
  this.logs={...(this.logs||{}),[issueId]:[...this.devLog(issueId),{at,text,tone,detail}].slice(-40)};
  setShared('fabrique-console.v3.devlog',this.logs);
 }
 // The chain runs in the watcher (src/dev-chain.mjs), page open or not: the page reads, every six seconds, the reports
 // of the agents and the story the chain keeps, and shows them.
 flowTick(cx,po){
  if(++this.ticks%3||this.flowReading||!po?.worktree||!this.issue||this.issue.id!==po.issueId)return;
  this.flowReading=true;
  cx.spawn(async cx=>{
   try{const d=await api(MOD,'dev-chain-read',{sessionId:po.id});this.reports=Array.isArray(d?.reports)?d.reports:[];if(d?.on)this.chainLogs={...(this.chainLogs||{}),[po.issueId]:Array.isArray(d.log)?d.log:[]};this.metrics=d?.metrics&&typeof d.metrics==='object'?d.metrics:{};}
   catch{}
   finally{this.flowReading=false;cx.notify();}
  });
 }
 // Launches the devs through the backend: the worktree of the issue, then one tab per ticket beside the PO, then the
 // PO tab shown again. The chain takes over from there. A ticket launched is not offered again.
 launchDevs(cx,po,tickets){
  if(this.devBusy||!tickets.length||!po)return;
  const L=T.issue.devSteps;
  const run={done:false,steps:[{key:'wt',text:L.worktree,state:'run',detail:''},...tickets.map(t=>({key:t.identifier,text:L.dev(t.identifier,ownValue(T.issue.agentName,t.tool)||t.tool,t.model),state:'wait',detail:''}))]};
  const step=k=>run.steps.find(x=>x.key===k);
  this.devRun=run;this.devBusy=true;cx.notify();
  cx.spawn(async cx=>{
   try{
    const r=await api(MOD,'dev-launch',{sessionId:po.id,tickets});
    const w=step('wt');w.state='ok';w.text=r.worktree?.created?.length?L.worktreeMade:L.worktreeFound;w.detail=(r.worktree?.path||'')+' · '+(r.worktree?.branch||'');
    for(const x of r.launched||[]){const st=step(x.identifier);if(!st)continue;st.state=x.launched?'ok':'fail';st.detail=x.launched?L.tab(T.issue.devTabName(x.identifier)):String(x.reason||'');if(x.launched)this.devLaunched.add(x.identifier);}
   }catch(e){const w=step('wt');w.state='fail';w.detail=String(e.message||e);for(const t of tickets)step(t.identifier).detail=L.notLaunched;}
   finally{run.done=true;this.devBusy=false;this.ticks=2;cx.notify();}
  });
 }
 // The worktree of the issue and its test server, where the user runs his own tests. Nothing before a PO has a
 // worktree; the server shows only when the repository has one set.
 workspaceBlock(po){
  if(!po||(!po.workspace&&!po.server))return div();
  const ws=workspaceOf(po.workspace),srv=serverOf(po.server),busy=this.serverBusy;
  const act=(cx,action)=>{if(this.serverBusy)return;this.serverBusy=true;this.serverError=null;cx.notify();
   cx.spawn(async cx=>{try{await api(MOD,action,{sessionId:po.id,confirmed:true});await reloadSnapshot(MOD);}catch(e){this.serverError=String(e.message||e);}finally{this.serverBusy=false;cx.notify();}});};
  return this.block(T.issue.ws.title)
   .child(ws?v_flex().gap(3)
     .child(div().font_family('JetBrains Mono').text_size(11.5).text_color(C.secondary).truncate().child(ws.path))
     .child(div().text_size(12).text_color(C.tertiary).child(ws.facts.join(' · ')))
     .when(Boolean(ws.warning),e=>e.child(div().text_size(12).text_color(C.amber).child(ws.warning)))
    :note(T.issue.ws.none))
   .child(h_flex().w_full().items_center().gap(8).pt(4)
    .child(div().text_size(12).font_weight(600).text_color(C.secondary).child(T.issue.srv.title))
    .when(!srv.configured,e=>e.child(note(T.issue.srv.none)))
    .when(srv.configured,e=>e.child(div().flex_1().min_w(0).truncate().text_size(12).text_color(srv.alive?C.done:C.tertiary).child(srv.text+(srv.url?' · '+srv.url:'')))
     .when(Boolean(srv.url),e=>e.child(btn('server-open',T.issue.srv.open,(_e,cx)=>{cx.spawn(async()=>{await exec('open',[srv.url]);});},{small:true})))
     .when(srv.stopped&&Boolean(ws),e=>e.child(btn('server-start',busy?T.issue.srv.busy:T.issue.srv.start,(_e,cx)=>act(cx,'po-server-start'),{small:true,primary:true})))
     .when(srv.alive||srv.uncertain,e=>e.child(btn('server-stop',busy?T.issue.srv.busy:T.issue.srv.stop,(_e,cx)=>act(cx,'po-server-stop'),{small:true})))))
   .when(Boolean(this.serverError),e=>e.child(div().text_size(12).text_color(C.danger).child(this.serverError)));
 }
 // The bar of the steps: one segment per step (a click shows that step below), then a thin bar in five pieces.
 // The step is the current one of the method; a step clicked is only looked at. The state of the PO is in the foot.
 stepBar(current,shown){
  const at=ISSUE_STEPS.indexOf(current);
  const tone=n=>n<at?C.done:n===at?C.running:C.strong;
  return v_flex().flex_none().gap(4).pb(8).border_b_1().border_color(C.barBorder)
   .child(h_flex().w_full().p(2).gap(2).rounded(7).bg(C.window).children(ISSUE_STEPS.map((k,n)=>{
    const on=k===shown;
    return div().id('step-'+k).flex_1().min_w(0).py(3).rounded(5).cursor_pointer().text_center().truncate().text_size(12)
     .font_weight(n===at?600:500).text_color(n<at?C.doneText:n===at?C.title:C.tertiary)
     .when(on,e=>e.bg(C.selected)).hover(e=>e.bg(C.rowSelected))
     .on_click((_e,cx)=>{this.picked=k;cx.notify();}).child((n<at?'✓ ':n===at?'◉ ':'')+T.issue.steps[k]+(k==='dev'&&this.devCount?'  '+this.devCount:''));
   })))
   .child(h_flex().w_full().h(3).gap(3).children(ISSUE_STEPS.map((_k,n)=>div().flex_1().h(3).rounded(2).bg(tone(n)))));
 }
 // What a step shows, then the question of the PO that closes it. A step not reached yet says so while it has
 // nothing to show.
 stepContent(step,i,po,current){
  const later=ISSUE_STEPS.indexOf(step)>ISSUE_STEPS.indexOf(current);
  const empty=note(later?T.issue.later(T.issue.steps[current]):T.issue.empty[step]);
  let box=v_flex().gap(10);
  const question=this.questionBlock(po,step,current);if(question)box=box.child(question);
  if(step==='plan')return this.planContent(i,box);
  if(step==='split')return this.splitContent(i,box,empty);
  if(step==='dev')return this.devContent(i,box,empty,po);
  if(step==='check'){const v=mdSection(i.description,'Validation');return box.when(Boolean(po),e=>e.child(this.validationPanel(i,po))).when(Boolean(v),e=>e.child(this.fold('check-notes',T.issue.val.poNotes,()=>this.md('step-check',v),false)));}
  return box.child(note(po?.readyAt?T.issue.ready:T.issue.empty.close));
 }
 // The foot: the state of the PO and its folder, what can be done with its terminal, and a new terminal opened in
 // the folder the work happens in.
 footer(po,folder){
  // A session stopped on purpose is over, whatever its terminal still reports: it is relaunched, not shown.
  const live=po&&po.status!=='historical'&&!po.stoppedAt,undelivered=Boolean(po&&po.firstMessageSent===false&&!po.stoppedAt);
  return v_flex().flex_none().gap(6).pt(10).border_t_1().border_color(C.barBorder)
   .when(undelivered,e=>e.child(div().text_size(12).text_color(C.danger).child(T.issue.undelivered)))
   .when(Boolean(this.warning)&&!undelivered,e=>e.child(div().text_size(12).text_color(C.danger).child(this.warning)))
   .child(h_flex().w_full().min_w(0).items_center().gap(8)
    .when(Boolean(po),e=>e.child(pill(ICONS,ownValue(TONE,po.status)||'unk',poStatus(po))))
    .when(!po,e=>e.child(note(T.issue.poNone)))
    .child(div().flex_1().min_w(0).truncate().font_family('JetBrains Mono').text_size(11.5).text_color(C.tertiary).child(String(folder||'')))
    .when(live&&!undelivered,e=>e.child(btn('show-terminal',T.issue.showTerminal,()=>this.show(),{small:true})))
    .when(undelivered,e=>e.child(btn('close-relaunch',this.launching?T.issue.relaunching:T.issue.closeRelaunch,(_e,cx)=>this.relaunch(cx,po.id),{small:true,primary:true})))
    .when(!po,e=>e.child(btn('launch',this.launching?T.issue.relaunching:T.issue.launch,(_e,cx)=>this.relaunch(cx),{small:true,primary:true})))
    .when(Boolean(po)&&!live&&!undelivered,e=>e.child(btn('relaunch',this.launching?T.issue.relaunching:T.issue.relaunch,(_e,cx)=>this.relaunch(cx),{small:true,primary:true})))
    .when(Boolean(folder),e=>e.child(btn('open-terminal',T.issue.openTerminal,()=>run('terminal.open',{folder,place:'tab'}),{small:true}))));
 }
 render(){
  const id=shared('fabrique-console.issue'),i=id&&this.issue?.id===id?this.issue:null,po=this.po();
  const current=stepOf(po),shown=this.picked||current;
  const folder=po?.repo||(snapshot().projects||[]).find(p=>p.key===shared('fabrique-console.project'))?.repo||null;
  // The content of the step first: the Réalisation leaves its follow-up panel, drawn fixed above what scrolls.
  this.fixedPanel=null;
  const content=i?this.stepContent(shown,i,po,current):null,fixed=shown==='dev'?this.fixedPanel:null,unfolded=this.toggled.has('follow-all');
  return page().id('issue').px(16).gap(10)
   .child(header()
    .child(h_flex().flex_1().min_w(0).items_center().gap(10)
     .child(h2(i?.identifier||T.issue.title))
     .when(Boolean(i?.title),e=>e.child(div().flex_1().min_w(0).truncate().text_size(13).text_color(C.secondary).child(String(i.title))))
     .when(Boolean(id),e=>e.child(div().flex_none().px(8).py(2).rounded(6).border_1().border_color('#2F5A9E').bg('#16304F').text_size(12).font_weight(600).text_color(C.running).child('◉ '+T.issue.steps[current]))))
    .child(h_flex().flex_none().items_center().gap(6)
     .when(Boolean(i&&/^https:\/\/[^\s/@]+\//.test(i.url||'')),e=>e.child(btn('open-issue',T.issue.open,(_e,cx)=>{cx.spawn(async()=>{await exec('open',[i.url]);});},{small:true})))
     .child(btn('refresh',T.issue.refresh+(this.readAt?' · '+this.readAt:''),(_e,cx)=>{if(id)this.load(cx,id,true,this.asked(this.po()));},{small:true}))))
   .when(Boolean(id),e=>e.child(this.stepBar(current,shown)))
   .child(errorBox(this))
   .when(Boolean(fixed)&&!unfolded,e=>e.child(div().flex_none().child(fixed)))
   // Unfolded, the follow-up takes the height of the page and scrolls inside; Réduire brings the tickets back.
   .when(Boolean(fixed)&&unfolded,e=>e.child(v_flex().flex_1().min_h(0).child(fixed)))
   .when(!(fixed&&unfolded),e=>e.child(v_flex().id('issue-body').flex_1().min_h(0).overflow_y_scrollbar().gap(10)
    .when(!id,e=>e.child(note(T.issue.pick)))
    .when(Boolean(id&&!i&&!this.error),e=>e.child(note(T.issue.loading)))
    .when(Boolean(content),e=>e.child(content))))
   .when(Boolean(id),e=>e.child(this.footer(po,folder)));
 }
}
