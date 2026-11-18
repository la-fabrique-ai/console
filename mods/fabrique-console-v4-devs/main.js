import {View,div} from 'gpui-kit';
import {shared,setShared,run,exec,agents} from 'herdr';
import {snapshot,api} from './kit.js';
import {FEED_MY_ISSUES} from './common.js';
import {projectLook} from './model.js';
import {clockOf,modelShort} from './view.js';
import {openQa,qaSurface,openSimulator,openMockup,projectTile,textBlocks,v_flex,h_flex,C,MONO,screen,h1,h2,hd,dim,list,box,mono,pill,btn,empty,dot,fault,missionRow,tag,AGENT_COLORS,goPilot,goLead,goAgent,leadOfMission,leadToTell,requestInPlace,alertToast,alertOnce} from './look.js';
import {W} from './words.js';
import {T} from './texts.js';
import {pageConfirm} from './blocks.js';
import {confirmDialog} from './dialog.js';
import {KEYS,SCREENS,ticketLook,askingTicket,glyphOf,missionsOf,phaseOf,machineWord,ticketPill,ticketTitles,missionProgress,stepsOf,ticketStory,storyLines,reviewTone,reportDigest,waitingOn,codeSummary,qaBrief,testRanges,launchState,launchOffered,launchBanner,closeState,mockupsFor,agentDot,dayOf,missionRequests,qaAgentOf} from './nav.js';
const MOD='fabrique-console-v4-devs',LINE={ok:'#4DD4AE',run:C.title,fail:'#F1C25B',wait:'#F1C25B',dec:'#F1C25B'},DONE='#4DD4AE',BAR=290,READ_EVERY=3,DESK_EVERY=10,PLAN_EVERY=10,EARLY=['requested','delegated','analysing'];
// Développements: what is under way, as the watcher reports it. A click opens a development: where it stands, who did
// what. To look at, not to act on: the Lead carries it, and its terminal is one click away for whoever wants to talk to it.
export default class Devs extends View {
 init(_p,cx) {this.confirm=null;this.titles=new Map();this.titled=undefined;this.story=null;this.storyOf=null;this.reading=false;this.ticks=0;this.error='';this.unfolded=new Set();this.raw=new Set();this.opening=false;this.desk=null;this.deskOf=null;this.deskTicks=0;this.testAt=null;this.launching=false;this.closing=false;this.plans={};this.planOf=null;this.planTicks=0;this.sent={};this.answering=null;this.talking=false;this.servers={};this.apps={};this.serverBusy=new Set();cx.timer.every(2000,cx=>this.poll(cx));}
 titlesOf() {const kept=shared(FEED_MY_ISSUES);if(kept?.at!==this.titled){this.titled=kept?.at;this.titles=ticketTitles(kept?.data);}return this.titles;}
 // What the agents wrote, read while a development is open: every six seconds, and at once when it opens.
 poll(cx) {
  const id=shared(KEYS.mission);if(!id||this.reading)return;
  if(this.storyOf===id&&++this.ticks%READ_EVERY)return;
  this.reading=true;
  cx.spawn(async cx=>{
   try{
    try{
     this.story=await api(MOD,'mission-read',{mission:id});
     // Another development opened, from here or from the column: it starts at its own first test, its tickets folded.
     if(this.storyOf!==id){this.testAt=null;this.unfolded=new Set();this.raw=new Set();}
     this.storyOf=id;this.error='';alertOnce(this,'read',null);this.relayDecisions(this.story,cx);
    }catch(e){alertOnce(this,'read',String(e.message||e));return;}
    // The plan of its issue, read again once a minute: Tracker is not asked every six seconds.
    if(this.planOf!==id||++this.planTicks%PLAN_EVERY===0){
     try{this.plans[id]=await api(MOD,'mission-plan',{mission:id});this.planOf=id;alertOnce(this,'plan',null);}catch(e){alertOnce(this,'plan',String(e.message||e));}
    }
    // Only for what is being validated; GitHub is asked once a minute at most. Each read keeps its own alert, forgotten
    // only when that very read works again: a read skipped this time proves nothing.
    if(this.story?.mission?.worktree||this.story?.qa||['qa','validating'].includes(this.story?.mission?.step)) {
     try{this.servers[id]=await api(MOD,'mission-server',{mission:id,command:'status'});alertOnce(this,'server',null);}catch(e){alertOnce(this,'server',String(e.message||e));}
     if(this.deskOf!==id||++this.deskTicks%DESK_EVERY===0){try{this.desk=await api(MOD,'mission-delivery',{mission:id});this.deskOf=id;alertOnce(this,'delivery',null);}catch(e){alertOnce(this,'delivery',String(e.message||e));}}
     if(this.desk?.app){try{this.apps[id]=await api(MOD,'mission-server',{mission:id,command:'status',target:'app'});alertOnce(this,'app',null);}catch(e){alertOnce(this,'app',String(e.message||e));}}
    }
   }
   finally{this.reading=false;cx.notify();}
  });
 }
 serverCommand(m,command,cx,target='server') {
  const key=m.id+':'+target;
  if(this.serverBusy.has(key))return;
  this.serverBusy.add(key);this.error='';cx.notify();
  cx.spawn(async cx=>{
   try{const state=await api(MOD,'mission-server',{mission:m.id,command,...(target==='app'?{target}:{})});(target==='app'?this.apps:this.servers)[m.id]=state;if(target==='app'&&command==='start'&&state.running)openSimulator(state,m.issue?.identifier||m.id);}
   catch(e){alertToast(e.message||e);}
   finally{this.serverBusy.delete(key);cx.notify();}
  });
 }
 // A test marked by the user, kept with the development. A problem goes to the Lead, who makes a ticket of it.
 // A development opens on its page (v2); this screen keeps its detail for what the page does not carry yet.
 open(id) {setShared(KEYS.ticket,null);setShared(KEYS.mission,id);run('layout.switch',{name:SCREENS.ticket});}
 close(cx) {setShared(KEYS.mission,null);this.error='';cx.notify();}
 // « Approve » opens the confirmation of screen 06, the box of the page of a ticket (decision 78): nothing is sent.
 launchDevs(m,cx) {
  if(this.launching)return;
  this.confirm=m.id;cx.notify();
 }
 // The box: « Cancel » closes it and writes nothing; « Approve and start », the only one that approves.
 confirmBox(m,c) {
  return confirmDialog(c,{cancel:(_e,cx)=>{this.confirm=null;cx.notify();},go:(_e,cx)=>{this.confirm=null;this.approve(m,cx);}});
 }
 // The plan this screen shows (its revision) is approved, then the launch is asked of the Lead (ticket M5).
 approve(m,cx) {
  if(this.launching)return;
  this.launching=true;this.error='';cx.notify();
  cx.spawn(async cx=>{
   try{await api(MOD,'mission-launch',{mission:m.id,seen:m.plan?.revision});}
   catch(e){alertToast(e.message||e);}
   finally{this.launching=false;cx.notify();}
  });
 }
 // The user asks for the closure from the Validation: the Lead checks the merge, Tracker and the summary, then closes.
 closeMission(m,cx) {
  if(this.closing)return;
  this.closing=true;cx.notify();
  cx.spawn(async cx=>{
   try{await api(MOD,'mission-close',{mission:m.id});this.ticks=0;this.poll(cx);}
   catch(e){alertToast(e.message||e);}
   finally{this.closing=false;cx.notify();}
  });
 }
 // Pilot on this development, with all it needs to speak about it. The page of Pilot is told one is on its way.
 openPilot(m,cx) {
  if(this.opening)return;
  this.opening=true;this.error='';setShared(KEYS.pilotAsked,new Date().toISOString());cx.notify();
  cx.spawn(async cx=>{
   try{await api(MOD,'pilot-launch',{context:'mission',mission:m.id});goPilot();}
   catch(e){alertToast(e.message||e);setShared(KEYS.pilotAsked,null);}
   finally{this.opening=false;cx.notify();}
  });
 }
 steps(m) {
  const circle=(s,n)=>h_flex().flex_none().w(20).h(20).rounded(10).items_center().justify_center().text_size(11).font_weight(700).bg(s.state==='done'?DONE:s.state==='now'?C.acc:C.chip).text_color(s.state==='done'?C.ink:s.state==='now'?'#FFFFFF':C.dim).child(s.state==='done'?'✓':String(n+1));
  const node=(s,n)=>h_flex().flex_none().items_center().gap(6).child(circle(s,n)).child(div().whitespace_nowrap().text_size(12.5).font_weight(s.state==='now'?600:500).text_color(s.state==='todo'?C.dim:C.title).child(s.label));
  return h_flex().flex_none().w_full().items_center().gap(8).py(4).children(stepsOf(m).flatMap((s,n,all)=>n<all.length-1?[node(s,n),div().flex_1().min_w(8).h(2).rounded(1).bg(s.state==='done'?DONE:C.strong)]:[node(s,n)]));
 }
 now(lead,items,waitsStart=false) {
  return h_flex().flex_none().items_center().gap(14).px(14).py(10).bg(C.card).border_1().border_color(C.line).rounded(12)
   .child(h_flex().flex_none().items_center().gap(8).child(dot(!lead?'off':items.length?'blocked':agentDot(lead.status))).child(div().font_weight(600).text_color(C.title).child(W.detail.lead)).child(div().text_color(C.dim).child(!lead?W.detail.noLead:items.length?W.detail.status.blocked:waitsStart&&lead.status!=='working'?W.detail.waitingStart:W.detail.status[lead.status]||'—')))
   .when(items.length>0,e=>e.child(div().w(1).h(16).bg(C.strong)).child(pill('dec',W.detail.waiting(items.length))));
 }
 // The QA agent under the Lead, from its launch to its report: where it stands, how far it has got, the way to its tab.
 qaNow(qa) {
  const done=qa.state==='done',facts=[qa.since?W.detail.qaStarted(qa.since):null,qa.tests?W.detail.qaTests(qa.tests):done?null:W.detail.qaNoShot,done?(qa.report?W.detail.qaReport(qa.report):null):qa.last?W.detail.qaLast(qa.last):null].filter(Boolean).join(' · ');
  return h_flex().id('detail-qa-agent').flex_none().items_center().gap(14).px(14).py(10).bg(C.card).border_1().border_color(C.line).rounded(12)
   .child(h_flex().flex_none().items_center().gap(8).child(dot(qa.dot)).child(div().font_weight(600).text_color(C.title).child(W.detail.qaAgent)).child(div().text_color(C.dim).child(W.detail.qaState[qa.state]||'—')))
   .child(div().flex_1().min_w(0).truncate().text_size(12.5).text_color(C.faint).child(facts))
   .when(Boolean(qa.agent),e=>e.child(btn('go-qa',W.devs.goQa,()=>goAgent(qa.agent),{tone:'plain'})));
 }
 // Every test marked and every ticket accepted: the close, with Go to Lead just before it for a fix first.
 closeBox(m,lead,state,ko) {
  const go=state==='asked'?pill('rev',W.close.asked):btn('close-mission',this.closing?W.close.closing:W.close.button,(_e,cx)=>this.closeMission(m,cx),{tone:'ok'});
  return h_flex().id('detail-close').flex_none().w_full().items_center().gap(12).px(16).py(12).rounded(12).bg('#10271F').border_1().border_color('#1F5C49')
   .child(v_flex().flex_1().min_w(0).gap(2).child(div().font_weight(600).text_color(C.title).child(W.close.ready)).child(div().text_size(13).text_color(C.sec).child(ko?W.close.problems(ko):W.close.line)))
   .child(h_flex().flex_none().items_center().gap(6).when(Boolean(lead),e=>e.child(btn('close-lead',W.devs.goLead,()=>goLead(m,lead),{tone:'lead'}))).child(go));
 }
 // The plan of the development as its issue says it, prepared with Pilot: in full while it is prepared, folded once the
 // devs run (a click unfolds it). What Tracker holds is shown as text.
 planBox(m,early) {
  const p=this.plans[m.id],key='plan:'+m.id,on=early||this.unfolded.has(key);
  return box().id('detail-plan').gap(8)
   .child(h_flex().flex_none().items_center().gap(8).child(h2(W.plan.title)).child(dim(W.plan.origin)).child(div().flex_1())
    .when(!early,e=>e.child(div().id('plan-fold').flex_none().cursor_pointer().text_size(12.5).text_color(C.dim).hover(s=>s.text_color(C.title)).on_click((_e,cx)=>{if(this.unfolded.has(key))this.unfolded.delete(key);else this.unfolded.add(key);cx.notify();}).child((on?'▴ ':'▾ ')+(on?W.plan.hide:W.plan.show)))))
   .when(on,e=>e.child(p?.plan?textBlocks(p.plan,13.5,true):div().text_size(13).text_color(C.faint).child(p?.unavailable?W.plan.unavailable:W.plan.none))
    .when(Boolean(p?.decided),x=>x.child(this.part(W.plan.decided,textBlocks(p.decided,13,false)))));
 }
 // The links of the issue and the mockups of the development, beside the plan while it is prepared.
 planSide(m) {
  const links=this.plans[m.id]?.links||[],kits=m.mockups||[];
  return v_flex().flex_none().gap(10)
   .when(links.length>0,e=>e.child(box().id('plan-links').gap(6).child(h2(W.plan.links)).children(links.map((l,n)=>div().id('plan-link-'+n).truncate().cursor_pointer().text_size(13).text_color(C.sec).hover(s=>s.text_color(C.title)).on_click((_e,cx)=>{cx.spawn(async()=>{await exec('open',[l.url]);});}).child(String(l.text))))))
   .when(kits.length>0,e=>e.child(box().id('plan-mockups').gap(6).child(h2(W.plan.mockups)).children(kits.map(k=>h_flex().flex_none().items_center().gap(8).child(div().flex_1().min_w(0).truncate().text_size(13).text_color(C.title).child(String(k.title||k.id))).child(btn('plan-mockup-'+k.id,W.mockup.open,()=>openMockup(m,k),{tone:'mockup'}))))));
 }
 // Before any dev runs: the Lead preparing, or its tickets ready. Launching stays the user's, now or later; Go to Lead
 // just before it, for a change to ask of the Lead first.
 launchBox(m,lead,b) {
  const ready=b.kind==='ready',line=ready?W.detail.readyStart(b.first,b.total):'';
  // Decision 49: no launch is offered while the Lead is working, even with tickets already written.
  // Offered where the box of screen 06 can be drawn, as on the page of a ticket: only its confirmation approves.
  const confirmable=Boolean(pageConfirm({mission:m,lead}));
  const go=b.state==='asked'?pill('rev',W.detail.launchAsked):!launchOffered(b.state,lead)||!confirmable?null:btn('launch-devs',this.launching?W.detail.launching:ready?W.detail.launch:W.detail.launchWhenReady,(_e,cx)=>this.launchDevs(m,cx),{tone:'ok'});
  return h_flex().id('detail-launch').flex_none().w_full().items_center().gap(12).px(16).py(12).rounded(12).bg(ready?'#10271F':C.card).border_1().border_color(ready?'#1F5C49':C.line)
   .child(v_flex().flex_1().min_w(0).gap(2).child(div().font_weight(600).text_color(C.title).child(ready?W.detail.ready(b.total):W.detail.preparing)).when(Boolean(line),e=>e.child(div().text_size(13).text_color(C.sec).child(line))))
   .child(h_flex().flex_none().items_center().gap(6).when(Boolean(lead),e=>e.child(btn('launch-lead',W.devs.goLead,()=>goLead(m,lead),{tone:'lead'}))).when(Boolean(go),e=>e.child(go)));
 }
 entry(title,facts,text) {
  return v_flex().gap(2)
   .child(h_flex().flex_wrap().items_center().gap(8).child(div().text_size(12).font_weight(600).text_color(C.sec).child(title)).when(facts.length>0,e=>e.child(div().font_family(MONO).text_size(11.5).text_color(C.faint).child(facts.join(' · ')))))
   .when(Boolean(text),e=>e.child(this.laidOut(text)));
 }
 // What an agent wrote in full, in paragraphs and lists; its first sentence is its conclusion.
 laidOut(text) {return textBlocks(text);}
 ticket(m,t,first,titles,reports,tldr,asks=[]) {
  // Its agent stopped on a question of its terminal: nothing else says so.
  const state=ticketLook(t,askingTicket(agents(),t.id)),story=ticketStory(t,reports),focus=shared(KEYS.ticket),on=this.unfolded.has(t.id)||focus===t.id;
  let row=v_flex().flex_none().py(8).gap(8);
  if(!first)row=row.border_t_1().border_color(C.row);
  return row.child(h_flex().id('ticket-'+t.id).items_center().gap(10).cursor_pointer().on_click((_e,cx)=>{if(focus===t.id){setShared(KEYS.ticket,null);this.unfolded.delete(t.id);}else if(this.unfolded.has(t.id))this.unfolded.delete(t.id);else this.unfolded.add(t.id);cx.notify();})
    .child(div().w(10).flex_none().text_size(11).text_color(C.dim).child(on?'▾':'▸'))
    .child(div().w(58).flex_none().child(mono(t.id)))
    .child(v_flex().flex_1().min_w(0).gap(5).child(div().truncate().font_weight(500).text_color(C.title).child(String(t.title||titles.get(t.id)||'—')))
     .child(h_flex().flex_wrap().items_center().gap(6)
      .when(Boolean(W.tools[t.dev]),e=>e.child(tag(W.tools[t.dev],AGENT_COLORS[t.dev])))
      .when(Boolean(t.model),e=>e.child(tag(modelShort(t.model)||t.model,C.sec,MONO)))
      .when(t.level==='fort',e=>e.child(tag(W.strong,C.danger)))
      .children(mockupsFor(m,{ticket:t.id}).map(k=>div().id('mockup-'+t.id+'-'+k.id).flex_none().cursor_pointer().on_click((_e,cx)=>{cx.stop_propagation();openMockup(m,k);}).child(tag(W.mockup.open,'#22D3EE'))))
      .when(Boolean(this.deskOf===m.id&&this.desk?.flutter&&t.worktree),e=>e.child(div().id('run-'+t.id).flex_none().cursor_pointer().on_click((_e,cx)=>{cx.stop_propagation();this.runApp(m,t,cx);}).child(tag(this.serverBusy.has(m.id+':'+t.id)?W.sim.starting:W.sim.run,'#4DD4AE')))))
     .when(Boolean(tldr)&&!on,e=>e.child(div().text_size(12.5).text_color(C.dim).child(String(tldr)))))
    .child(h_flex().flex_none().gap(4).children(story.reviews.map(r=>pill(reviewTone(r.verdict),W.detail.review(r.n)))))
    .child(pill(state.tone,state.label)))
   // What the user is asked about this ticket, answered here as in the Inbox.
   .children(asks.filter(i=>i.ticket===t.id).map(i=>requestInPlace(this,MOD,i,m)))
   .when(on,e=>e.child(this.told(t,story,tldr)));
 }
 // Validation: the server and the code in a line each, then the tests one by one.
 serverLine(m,plan,server) {
  if(!plan)return h_flex().flex_none().min_h(30).items_center().text_size(12.5).text_color(C.faint).child(W.check.none);
  // Running only once its address answers; alive and not answering yet, it is starting, and can be stopped.
  const running=Boolean(server?.running),starting=!running&&Boolean(server?.starting),url=server?.url||plan.url||null,port=/:(\d+)/.exec(url||'')?.[1];
  return h_flex().flex_none().min_h(30).items_center().gap(8).text_size(12.5)
   .child(dot(running?'ok':starting?'work':'off')).child(div().flex_none().font_weight(600).text_color(C.title).child(running?W.check.running:starting?W.qa.starting:W.check.stopped))
   .when(running&&Boolean(url),e=>e.child(div().id('server-url').flex_none().cursor_pointer().font_family(MONO).text_size(12.5).text_color('#7DB8FF').hover(s=>s.text_color(C.title)).on_click((_e,cx)=>{cx.spawn(async()=>{await exec('open',[url]);});}).child(url)).when(Boolean(port),x=>x.child(div().flex_none().text_color(C.dim).child(W.check.port(port)))))
   .child(div().flex_1().min_w(0).truncate().text_color(C.danger).child(!running&&server?.reason?String(server.reason):''))
   .child(running||starting?btn('server-stop',W.check.stop,(_e,cx)=>this.serverCommand(m,'stop',cx),{tone:'danger'}):btn('server-start',W.check.start,(_e,cx)=>this.serverCommand(m,'start',cx),{tone:'ok'}));
 }
 // The app of a ticket, from its own worktree, on the simulator page.
 runApp(m,t,cx) {
  const key=m.id+':'+t.id;
  if(this.serverBusy.has(key))return;
  this.serverBusy.add(key);this.error='';cx.notify();
  cx.spawn(async cx=>{
   try{const state=await api(MOD,'mission-server',{mission:m.id,command:'start',target:'app',ticket:t.id});if(state.running)openSimulator(state,t.id);}
   catch(e){alertToast(e.message||e);}
   finally{this.serverBusy.delete(key);cx.notify();}
  });
 }
 // The Flutter app of a development, when it changed one.
 appLine(m,state) {
  const running=Boolean(state?.running);
  return h_flex().flex_none().min_h(30).items_center().gap(8).text_size(12.5)
   .child(dot(running?'ok':'off')).child(div().flex_none().font_weight(600).text_color(C.title).child(running?W.check.appRunning:W.check.appStopped))
   .child(div().flex_1().min_w(0).truncate().text_color(C.danger).child(!running&&state?.reason?String(state.reason):''))
   .when(running&&Boolean(state?.device),e=>e.child(btn('app-sim',W.sim.open,()=>openSimulator(state,m.issue?.identifier||m.id),{tone:'mockup'})))
   .child(running?btn('app-stop',W.check.stop,(_e,cx)=>this.serverCommand(m,'stop',cx,'app'),{tone:'danger'}):btn('app-start',W.check.start,(_e,cx)=>this.serverCommand(m,'start',cx,'app'),{tone:'ok'}));
 }
 codeLine(c) {
  const facts=[c.branch,W.check.repositories(c.count),c.pushed==='all'?W.check.pushed:c.pushed==='some'?W.check.somePushed:W.check.notPushed,...(c.prs.length?[]:[c.unknown?W.check.prUnknown:W.check.noPr])].join(' · ');
  return h_flex().flex_none().min_h(30).flex_wrap().items_center().gap(8).text_size(12.5)
   .child(div().flex_none().font_weight(600).text_color(C.title).child(W.check.code)).child(div().text_color(C.dim).child(facts))
   .children(c.prs.map(p=>btn('pr-'+p.repo,p.repo+' · '+W.check.pr(p.number),(_e,cx)=>{const u=p.url;cx.spawn(async()=>{await exec('open',[u]);});},{tone:'plain'})));
 }
 // What the user has in mind before his QA: what the QA found, what to check first (a click opens the QA on that test),
 // the risks folded, the whole report one click away. The steps themselves are in the QA window.
 brief(m,qa,plan) {
  const b=qaBrief(qa),risks=this.raw.has('risks'),full=this.raw.has('qa');
  const start=at=>{setShared(KEYS.qa,{mission:m.id,...(at>=0?{at}:{})});openQa(m.id,qaSurface(m.id),{force:true});};
  const say=i=>i.kind==='notPlayed'?W.check.notPlayedYet(Number(i.text)):i.kind==='problem'?W.check.qaProblem(i.text):i.text;
  const fold=(id,open,label,key)=>div().id(id).flex_none().cursor_pointer().text_size(12.5).text_color(C.dim).hover(s=>s.text_color(C.title)).on_click((_e,cx)=>{if(open)this.raw.delete(key);else this.raw.add(key);cx.notify();}).child((open?'▾ ':'▸ ')+label);
  return v_flex().flex_none().gap(12)
   .child(h_flex().flex_none().min_h(30).items_center().gap(8).text_size(12.5)
    .child(div().flex_none().font_weight(600).text_color(C.title).child(W.check.qa))
    .child(pill(qa.verdict==='ok'?'ok':'dec',qa.verdict==='ok'?W.check.qaClean:W.check.qaFound))
    .child(div().flex_1().min_w(0).truncate().text_color(C.dim).child(plan.length?W.check.playedBy(b.played,plan.length,b.forYou):'')))
   .when(b.found.length>0,e=>e.child(this.part(W.check.found,v_flex().gap(4).p(12).rounded(10).bg(C.bg).border_1().border_color(C.row).text_color(C.title).children(b.found.map(line=>div().child(line))))))
   .when(b.checkFirst.length>0,e=>e.child(this.part(W.check.checkFirst,v_flex().gap(6).children(b.checkFirst.map((i,n)=>{
    const at=i.tests.length?plan.findIndex(t=>t.id===i.tests[0]):-1;
    return h_flex().id('check-first-'+n).items_start().gap(10).p(10).rounded(10).bg(C.bg).border_1().border_color(C.row)
     .when(at>=0,x=>x.cursor_pointer().hover(s=>s.border_color(C.acc)).on_click(()=>start(at)))
     .child(h_flex().flex_none().w(22).h(22).rounded(11).items_center().justify_center().bg(C.chip).text_size(12).font_weight(600).text_color(C.title).child(String(n+1)))
     .child(div().flex_1().min_w(0).text_color(C.title).child(say(i)))
     .when(i.decision,x=>x.child(pill('dec',W.check.decision)))
     .when(i.tests.length>0,x=>x.child(div().flex_none().text_size(12.5).text_color(C.dim).child(W.check.testsLabel(new Set(i.tests).size,testRanges(i.tests)))));
   })))))
   .when(this.decisionsState(m,qa,b)==='uncertain',e=>e.child(h_flex().flex_none().items_center().gap(10).text_size(12.5).child(div().flex_1().min_w(0).text_color(C.danger).child(W.check.decisionsUncertain)).child(btn('qa-decisions-again',W.check.sendAgain,(_e,cx)=>this.relayDecisions(this.story,cx,true),{tone:'lead'}))))
   .when(b.risks.length>0,e=>e.child(v_flex().flex_none().gap(4).child(fold('qa-risks',risks,W.check.risks(b.risks.length),'risks')).when(risks,x=>x.children(b.risks.map(r=>div().pl(14).text_color(C.sec).child('· '+r))))))
   .when(Boolean(qa.summary),e=>e.child(fold('qa-report',full,W.check.fullReport,'qa')))
   .when(full&&Boolean(qa.summary),e=>e.child(this.laidOut(qa.summary)));
 }
 decisionsState(m,qa,b) {return b.checkFirst.some(i=>i.decision)?(shared(KEYS.qaDecisions)||{})[m.id+'@'+qa.at]||null:null;}
 // A decision the QA leaves to the user goes up to his Inbox: the Lead asks it there with po-ask, once per QA report.
 // A send whose answer is lost may have arrived: it stays uncertain, and only the user sends it again.
 relayDecisions(story,cx,again=false) {
  const m=story?.mission,qa=story?.qa,decisions=qa?qaBrief(qa).checkFirst.filter(i=>i.decision):[];
  if(!m||!decisions.length)return;
  const key=m.id+'@'+qa.at,sent=shared(KEYS.qaDecisions)||{};
  if(sent[key]&&!(again&&sent[key]==='uncertain'))return;
  const lead=leadToTell(m);
  if(!lead||!m.lead?.sessionId)return;
  const mark=state=>setShared(KEYS.qaDecisions,{...(shared(KEYS.qaDecisions)||{}),[key]:state});
  mark('sending');
  cx.spawn(async cx=>{
   try{await api(MOD,'dev-send',{sessionId:m.lead.sessionId,terminal:lead.address,text:T.issue.val.qaDecisions(m.issue?.identifier||m.id,decisions.map(i=>i.text))});mark('sent');}
   catch{mark('uncertain');}
   cx.notify();
  });
 }
 validation(m,lead,story) {
  const qa=story?.qa,plan=qa?.plan||[],marks=qa?.marks||{},ok=plan.filter(t=>marks[t.id]?.result==='ok').length,ko=plan.filter(t=>marks[t.id]?.result==='ko').length,desk=this.deskOf===m.id?this.desk:null,code=codeSummary(desk?.repositories);
  return box().id('detail-validation').gap(10)
   .child(hd(h_flex().flex_none().items_center().gap(10).child(h2(W.check.title)).child(dim(plan.length?W.check.progress(ok,ko,plan.length):'')),plan.length?btn('qa-start',W.qa.start,()=>{setShared(KEYS.qa,{mission:m.id});openQa(m.id,qaSurface(m.id),{force:true});},{tone:'ok'}):div()))
   .when(plan.length>0,e=>e.child(h_flex().flex_none().w_full().h(16).gap(3).children(plan.map((t,n)=>h_flex().id('qa-progress-'+n).flex_1().h_full().items_center().cursor_pointer()
    .on_click(()=>{setShared(KEYS.qa,{mission:m.id,at:n});openQa(m.id,qaSurface(m.id),{force:true});})
    .child(div().w_full().h(8).rounded(2).bg(marks[t.id]?.result==='ok'?DONE:marks[t.id]?.result==='ko'?C.danger:C.chip))))))
   .when(Boolean(closeState(m,qa,lead)),e=>e.child(this.closeBox(m,lead,closeState(m,qa,lead),ko)))
   .when(Boolean(qa),e=>e.child(this.brief(m,qa,plan)))
   .when(Boolean(desk?.server)||!desk?.app,e=>e.child(this.serverLine(m,desk?.server||null,this.servers[m.id]||null)))
   .when(Boolean(desk?.app),e=>e.child(this.appLine(m,this.apps[m.id]||null)))
   .when(Boolean(code),e=>e.child(this.codeLine(code)))
   .when((m.mockups||[]).length>0,e=>e.child(h_flex().flex_none().min_h(30).flex_wrap().items_center().gap(8).text_size(12.5).child(div().flex_none().font_weight(600).text_color(C.title).child(W.mockup.title)).children(m.mockups.map(k=>btn('check-mockup-'+k.id,k.title,()=>openMockup(m,k),{tone:'mockup'})))))
   .when(!plan.length,e=>e.child(div().text_size(12.5).text_color(C.faint).child(W.check.noPlan)));
 }

 // A part of what a ticket went through, under its small title.
 part(title,body) {return v_flex().flex_none().gap(6).child(div().text_size(11).font_weight(600).text_color(C.faint).child(String(title).toUpperCase())).child(body);}
 review(r) {
  const {head,remarks}=reportDigest(r.summary);
  return v_flex().flex_none().gap(3)
   .child(h_flex().items_center().gap(8).child(div().text_size(12.5).font_weight(600).text_color(C.sec).child(W.detail.review(r.n))).when(Boolean(r.by),e=>e.child(tag(r.by,AGENT_COLORS[r.tool]))).child(pill(reviewTone(r.verdict),W.detail.verdict[r.verdict]||'—')))
   .child(div().text_size(13).text_color(C.title).child(head))
   .children(remarks.map((text,n)=>h_flex().id('remark-'+r.n+'-'+n).items_start().gap(6).text_size(12.5).text_color(C.dim).child(div().flex_none().child('•')).child(div().flex_1().min_w(0).child(text))));
 }
 // What a ticket went through, to read at a glance; what the agents wrote in full is one click away.
 told(t,story,tldr) {
  const facts=[W.tools[t.dev],story.dev?.repo,story.dev?.commit?.slice(0,8)].filter(Boolean),raw=this.raw.has(t.id);
  if(!story.dev)return v_flex().ml(20).p(12).rounded(8).bg(C.bg).border_1().border_color(C.row).child(div().text_size(12.5).text_color(C.faint).child(W.detail.noReport));
  return v_flex().ml(20).gap(14).p(12).rounded(8).bg(C.bg).border_1().border_color(C.row)
   .child(this.part(W.detail.done,v_flex().gap(2).child(div().text_size(13).text_color(C.title).child(tldr||reportDigest(story.dev.summary).head)).child(div().font_family(MONO).text_size(11.5).text_color(C.faint).child(facts.join(' · ')))))
   .when(story.reviews.length>0,e=>e.child(this.part(W.detail.reviews,v_flex().gap(12).children(story.reviews.map(r=>this.review(r))))))
   .child(div().id('raw-'+t.id).flex_none().cursor_pointer().text_size(12).text_color(C.dim).hover(s=>s.text_color(C.title)).on_click((_e,cx)=>{if(raw)this.raw.delete(t.id);else this.raw.add(t.id);cx.notify();}).child((raw?'▾ ':'▸ ')+(raw?W.detail.hide:W.detail.full)))
   .when(raw,e=>e.child(v_flex().gap(8).child(this.entry(W.detail.dev,facts,story.dev.summary)).children(story.reviews.map(r=>this.entry(W.detail.review(r.n),[r.by].filter(Boolean),r.summary)))));
 }
 fact(label,value,extra=null) {return h_flex().flex_none().items_center().justify_between().gap(8).text_size(12.5).child(div().text_color(C.dim).child(label)).child(h_flex().min_w(0).items_center().gap(6).when(Boolean(extra),e=>e.child(extra)).child(div().truncate().font_family(MONO).text_size(12).text_color(C.sec).child(String(value))));}
 progress(m,qa) {
  const {done,total,ratio}=missionProgress(m);
  return box().id('detail-progress')
   .child(hd(h2(W.detail.progress),dim(done+' / '+total)))
   .child(div().w(BAR).h(6).rounded(3).bg(C.chip).overflow_hidden().child(div().h_full().w(Math.round(BAR*ratio)).bg(DONE)))
   .when(Boolean(m.branch),e=>e.child(this.fact(W.detail.branch,m.branch)))
   .child(this.fact(W.detail.machine,machineWord(m.machine||'local'),dot('ok')))
   .when(Boolean(qa),e=>e.child(this.fact(W.detail.checks,W.detail.tests(qa.tests),pill(qa.verdict==='ok'?'ok':'dec',qa.verdict==='ok'?W.detail.qaPassed:W.detail.qaProblems))));
 }
 activity(lines) {
  return box().id('detail-activity').child(h2(W.detail.activity))
   .children(lines.map((l,n)=>h_flex().id('act-'+n).flex_none().items_start().gap(8).text_size(12.5).child(div().flex_none().w(82).font_family(MONO).text_size(11.5).text_color(C.faint).child(dayOf(l.at)+' '+clockOf(l.at))).child(div().flex_1().min_w(0).text_color(LINE[l.tone]||C.sec).child(l.text))))
   .when(!lines.length,e=>e.child(div().text_size(12.5).text_color(C.faint).child(W.detail.noActivity)));
 }
 journal(m,lines) {
  return box().id('journal').child(h2(W.devs.journal(m.issue?.identifier||m.id)))
   .child(v_flex().font_family(MONO).text_size(12).line_height(1.7).text_color(C.sec)
    .children(lines.map((l,n)=>h_flex().id('line-'+n).gap(8).child(div().flex_none().text_color(C.faint).child(String(l.at||''))).child(div().flex_1().min_w(0).text_color(LINE[l.tone]||C.sec).child(String(l.text||'')))))
    .when(!lines.length,e=>e.child(div().text_color(C.faint).child(W.devs.noJournal))));
 }
 // The head of a development, in the family of those of Pilot and of the Lead: its project, what it is, the ways out.
 head(m,buttons) {
  const project=(snapshot().projects||[]).find(p=>p.key===m.project),facts=[project?.name||m.project,m.issue?.identifier||m.id].filter(Boolean).join(' · ');
  return h_flex().flex_none().min_w(0).items_center().gap(14)
   .child(projectTile(project,48,26))
   .child(v_flex().flex_1().min_w(0)
    .child(div().truncate().text_size(20).line_height(1.25).font_weight(600).text_color(C.title).child(String(m.issue?.title||m.request||'—')))
    .child(div().truncate().text_color(C.dim).child(facts)))
   .child(buttons);
 }
 detail(m) {
  const story=this.storyOf===m.id?this.story:null,reports=story?.reports||[],items=waitingOn(story?.items),tickets=m.tickets||[],titles=this.titlesOf(),lead=leadOfMission(m),url=m.issue?.url,launch=launchState(m,lead);
  const {asks,top}=missionRequests(shared(KEYS.inbox),m,tickets),banner=launchBanner(m,lead,{on:Boolean(m.on||story?.on)}),qa=qaAgentOf(m,story?.qaRun||null,agents(),{space:lead?.space||null});
  // The confirmation of screen 06, for as long as it can be drawn; closed otherwise.
  const confirm=this.confirm===m.id?pageConfirm({mission:m,lead}):null,confirmable=Boolean(confirm||pageConfirm({mission:m,lead}));
  if(this.confirm&&!confirm)this.confirm=null;
  const buttons=h_flex().flex_none().gap(6)
   .child(btn('detail-back',W.detail.back,(_e,cx)=>this.close(cx),{tone:'plain'}))
   .when(/^https:\/\/[^\s/@]+\//.test(url||''),e=>e.child(btn('tracker',W.devs.tracker,(_e,cx)=>{cx.spawn(async()=>{await exec('open',[url]);});},{tone:'plain'})))
   .child(btn('go-pilot',this.opening?W.pilot.starting:W.devs.goPilot,(_e,cx)=>this.openPilot(m,cx)))
   // The action of this page: always the last on the right, in the colour of the Lead it opens.
   .when(Boolean(lead),e=>e.child(btn('go-lead',W.devs.goLead,()=>goLead(m,lead),{tone:'lead'})));
  return screen().id('devs-detail').relative()
   .child(this.head(m,buttons))
   .child(this.steps(m))
   .when(Boolean(this.error),e=>e.child(fault(this.error)))
   .child(h_flex().flex_1().min_h(0).items_start().gap(16)
    .child(v_flex().id('detail-left').flex_1().min_w(0).h_full().gap(10).overflow_y_scrollbar()
     .when(Boolean(m.tldr),e=>e.child(box().id('detail-tldr').child(div().text_size(11).font_weight(600).text_color(C.faint).child(W.detail.tldr.toUpperCase())).child(div().text_size(14).text_color(C.title).child(String(m.tldr)))))
     .child(this.now(lead,items,banner?.kind==='ready'&&banner.state==='offer'))
     .when(Boolean(qa),e=>e.child(this.qaNow(qa)))
     .children(top.map(i=>box().id('request-box-'+i.id).child(requestInPlace(this,MOD,i,m))))
     .when(Boolean(banner),e=>e.child(this.launchBox(m,lead,banner)))
     .when(Boolean(this.plans[m.id]),e=>e.child(this.planBox(m,EARLY.includes(m.step))))
     .when(Boolean(story?.qa)||['qa','validating'].includes(m.step),e=>e.child(this.validation(m,lead,story)))
     .child(box().id('detail-tickets').child(hd(h_flex().flex_none().items_center().gap(8).child(h2(W.detail.tickets)).child(dim(String(tickets.length))),!banner&&launchOffered(launch,lead)&&confirmable?btn('launch-devs',this.launching?W.detail.launching:W.detail.launch,(_e,cx)=>this.launchDevs(m,cx)):!banner&&launch==='asked'?pill('rev',W.detail.launchAsked):div()))
      .children(tickets.map((t,n)=>this.ticket(m,t,n===0,titles,reports,m.tldrs?.[t.id]||null,asks)))
      .when(!tickets.length,e=>e.child(div().text_size(12.5).text_color(C.faint).child(W.devs.noTickets))))
     .child(this.journal(m,story?.journal||m.journal||[])))
    .child(v_flex().id('detail-right').flex_none().w(320).h_full().gap(10).overflow_y_scrollbar()
     .child(this.progress(m,story?.qa))
     .when(EARLY.includes(m.step),e=>e.child(this.planSide(m)))
     .child(this.activity(storyLines(tickets,reports,story?.qa).slice(0,20)))))
   .when(Boolean(confirm),e=>e.child(this.confirmBox(m,confirm)));
 }
 render() {
  const data=snapshot(),all=data.projects||[],machine=shared(KEYS.machine)??null,project=all.some(p=>p.key===shared(KEYS.project))?shared(KEYS.project):null;
  // A development just closed leaves the list of those under way: its page stays, read from the mission itself.
  const missions=missionsOf(shared(KEYS.missions),{machine,project}),opened=missions.find(m=>m.id===shared(KEYS.mission))||(this.storyOf===shared(KEYS.mission)&&this.story?.mission?.step==='closed'?this.story.mission:null);
  if(opened)return this.detail(opened);
  const nameOf=key=>all.find(p=>p.key===key)?.name||key,colorOf=key=>projectLook(all.find(p=>p.key===key)).color;
  const head=[missions.length?W.devs.count(missions.length):W.devs.none,machineWord(machine),...(missions.length?[W.devs.watched]:[])].join(' · ');
  return screen().id('devs')
   .child(hd(h1(W.devs.title),dim(head)))
   .child(!missions.length?empty(W.devs.empty):v_flex().id('devs-list').flex_1().min_h(0).overflow_y_scrollbar()
    .child(list().children(missions.map((m,n)=>missionRow('mission-'+m.id,m,{color:colorOf(m.project),detail:phaseOf(m)+' · '+W.devs.lead(nameOf(m.project)),first:n===0,last:n===missions.length-1,fn:(_e,cx)=>this.open(m.id,cx)})))));
 }
}
