import {View,div,svg,image,PathBuilder,Background} from 'gpui-kit';
import {ScrollHandle,Input} from 'gpui-base';
import {shared,setShared,run,exec,agents,window as herdrWindow} from 'herdr';
import {snapshot,api} from './kit.js';
import {v_flex,h_flex,MONO,goPilot,goLead,leadOfMission,openRequest,answerRequest,delegateRequest,pickMockup,openMockup,openQa,qaSurface,alertToast,alertOnce,textBlocks} from './look.js';
import {W} from './words.js';
import {KEYS,SCREENS,missionsOf,workingTabs,readStartedInto,screenOfAgent,codeSummary} from './nav.js';
import {pageHead,pageBand,pageWorkers,pageTabs,pageActivity,pageRefs,pageStory,pageWaits,stageOf,currentTicket,pauseOf,pageCount} from './page.js';
import {LINE,TWO,lineTickets,linePhases,lineFocus,lineActive,lineJump,linePan,lineLayout,lineLanes,lanesPan,lanesLayout,lineDev,lineCard,lineEnds,lineLegend,lineMatches,lineHead,lineDetail,lineStep,lineDrift,lineReviews} from './line.js';
import {BOARD,boardOffered,planView,boardLayout,acceptedTimes} from './board.js';
import {ticketCard,cardRings,tagChip,badgeChip,devBadge,reviewerTag} from './card.js';
import {pageStrip,pageBlocks,pageSheet,pageSince,pageRecap,recapShown,visitAck,pageVisible,pageCurrent,pageTokens,pageSpans,approachLink,handSpan,clipText,stripRoom,pageConfirm,pageReconfirm,pageEnd,pageSummary,pageCloseBox,pageReopenBox,reasonOk,reopenKept} from './blocks.js';
import {pageAsks,withoutSent,withKinds,askShown,askStep,canAnswer,pageAnswer,saidOf} from './answers.js';
import {confirmDialog,reasonField} from './dialog.js';
// The page of a ticket (v2), drawn after Claude Design « page d'un ticket » (2026-11-12) in native components: its head
// (where the ticket stands, Talk to Pilot, the menu), its banner, the plan and the column « Right now ». The plan is the
// line of the tickets (ticket 31): one row that scrolls in its zone, QA and Sign-off at its end, and the details of a
// ticket clicked in the column on the right. Under the line, the band of what happens now (one dev); with two devs, two
// lanes in place of the line and of the band (screens 40 and 41), each dev named before its own; at the bottom, the
// three blocks of Prepare and Develop; a row or a link opens its sheet in the column on the right (decision 40). What
// these zones say comes from the pure rules of blocks.js. What waits for the user is answered in place, in the column on
// the right (answers.js), by the actions the Inbox already has. The screen of before stays one click away, in the menu.
// From Develop on the plan has a second view, the Kanban (screen 09, board.js): the same cards, in columns; the view
// chosen is kept. The banner carries « Pause » and « Resume » when the engine has the pause, and « See what's blocking ».
const MOD='fabrique-console-v4-ticket',P=W.page,READ_EVERY=3,DESK_EVERY=10,SIDE=452,PLAN_H=574,HOST_W=966;
// The colours of the mockup: each one has one meaning.
const K={app:'#12151D',card:'#1B1F2B',line:'#2A2F40',text:'#E6E9F0',sec:'#C9CFDB',dim:'#8C93A6',faint:'#6F7689',white:'#FFFFFF',ctl:'#363C50',sep:'#5C6378',link:'#A9B4FF',
  on:'#8E7CFF',ring:'#8E7CFF40',done:'#3DD6B0',idle:'#4A5063',amber:'#F2C14E',red:'#FF8A80',bar:'#262B3A',fill:'#7B8CFF',seg:'#30364A'};
// The banner: border, background, then the disc of its icon and the colour of the icon.
const BAND={ok:['#2E8F6C','#132823','#163028','#3DD6B0'],you:['#8A6B1F','#2A2416','#3A2E12','#F2C14E'],run:['#4A52A8','#1C2040','#262B5E','#A9B4FF'],stop:['#8A4A4A','#2C1818','#3A1A1A','#FF8A80'],off:['#363C50','#1B1F2B','#262B3A','#C9CFDB']};
// The main button of the banner, in the tone of the banner: background, border, text.
const MAIN={ok:['#163028','#2E8F6C','#5DE3B8'],you:['#3A2E12','#8A6B1F','#F6D27A']};
// The badge of who works: background, border, text; the reviewer is outlined in dashes.
const BADGE={dev:['#262B5E','#7B8CFF','#D6DAFF'],lead:['#2E1A26','#B04A7A','#F0A8C8'],qa:['#163028','#2E8F6C','#5DE3B8'],review:['#1B1F2B','#C9CFDB','#E6E9F0']};
const DOT={working:K.done,blocked:K.amber};
// The line of the plan: a dependency in grey, in blue what the ticket chosen waits for, in green what it unblocks; the
// segments of the progress; the chips of the details and the discs of its steps (background, border or none, text).
const LINK={waits:'#5EA8FF',unblocks:'#3DD6B0'},RAIL='#3A4052',GLYPH='#5C6378',SEG={ok:K.done,run:K.fill,you:K.amber,blk:K.red};
const CHIP={heavy:['#2E2552','#6E5BD6','#D9CCFF'],you:['#2A2112','#6B5218','#F1C25B'],ok:['#163028','#2E8F6C','#5DE3B8'],run:['#1C2040','#4A52A8','#C9D0FF'],bad:['#2C1818','#8A4A4A','#FF8A80']};
const ORD={ok:['#163028','#3DD6B0'],fix:['#3A2416','#FFB36B'],you:['#3A2E12','#F2C14E'],run:['#5563D8','#FFFFFF'],bad:['#3A1A1A','#FF8A80']},MARK={ok:'#3DD6B0',fix:'#FFB36B',dec:'#F2C14E'};
// The band under the line: its border says the situation. The sign of a row of the blocks (background, text); a row that
// calls the user or tells a failure (background, border, the line under its text, what is said at its right).
const STRIP={run:'#4A52A8',you:'#8A6B1F',bad:'#8A4A4A',ok:'#2E8F6C'},STRIP_BG='#161923',STRIP_LINE='#232838',SOFT='#A3AABB';
const SIGN={ok:['#163028','#3DD6B0'],wait:['#262B3A','#8C93A6'],count:['#262B3A','#E6E9F0'],you:['#3A2E12','#F2C14E'],bad:['#3A1A1A','#FF8A80']};
const ROW={you:['#2A2416','#6B5218','#D9C48F','#F6D27A'],bad:['#2C1818','#8A4A4A','#E8B4AE',K.dim]},BLOCKS=[322,388,310];
// What moves, as on the mockup, drawn by the window itself and only while shown (no timer, no redraw of the page): the
// arc of the banner turns while an agent works, and the dot of a tab at work pulses in the menu.
const ARC='mods/'+MOD+'/icons/arc.svg',TURN=2400,PULSE={period:1600,easing:'ease-in-out'};
export default class Ticket extends View {
 init(_p,cx) {this.story=null;this.storyOf=null;this.reading=false;this.force=false;this.ticks=0;this.desk=null;this.deskOf=null;this.deskTicks=0;this.menu=false;this.opening=null;this.launching=false;this.confirm=false;this.reconfirm=null;this.closeBox=null;this.reopenBox=false;this.reason=null;this.started={};this.dating=false;this.error='';
  // The plan: the ticket whose details are open and their tab, where the user moved the line (null: on its ticket in
  // hand), the filter of the legend, the width of the zone as the window gives it, and the reports unfolded.
  this.sel=null;this.tab='summary';this.pan=null;this.panOf=null;this.filter=null;this.hostW=HOST_W;this.full=false;this.boardScroll=ScrollHandle?.new?.()??null;this.boardFocus=null;
  // What a row of the blocks or a link of the band opened in the column on the right ({t, id}), and an action under way.
  this.open=null;this.acting=false;this.checking=false;
  // The answers given from this page: the request being sent, those sent ({request: answer}), the one that failed
  // ({id, message}), the choice clicked ({id, key}), what « Your decisions » says of them until the engine lists them,
  // and the development they belong to.
  this.answering=null;this.sent={};this.failed=null;this.chosen=null;this.said=[];this.sentOf=null;
  // « Since your last visit » (ticket M14): the recap of this showing (pageRecap), the lines drawn from it, the
  // acknowledgement last accepted by the engine, and whether the page was visible at the last tick.
  this.recap=null;this.drawn=null;this.acked=null;this.acking=false;this.shown=false;this.stale=false;
  this.poll(cx);cx.timer.every(2000,cx=>{this.see();this.poll(cx);this.readStarted(cx);this.ack(cx);});cx.timer.every(30000,cx=>cx.notify());}
 // What the agents wrote, read while the page is open: every six seconds, and at once when it opens. The state of the
 // code (pushed, pull request) once a minute at most.
 poll(cx) {
  const id=shared(KEYS.mission);if(!id||this.reading)return;
  if(this.storyOf===id&&!this.force&&++this.ticks%READ_EVERY)return;
  this.reading=true;this.force=false;
  cx.spawn(async cx=>{
   try{
    try{this.story=await api(MOD,'mission-read',{mission:id});this.recap=pageRecap(this.recap,id,this.story);this.stale=false;if(this.storyOf!==id){this.menu=false;this.desk=null;this.deskOf=null;}
    if(this.planOf!==id){this.planOf=id;this.sel=shared(KEYS.ticket)||null;const asked=shared(KEYS.ask);this.open=asked?.mission===id&&asked.item?{t:'ask',id:asked.item}:null;if(asked)setShared(KEYS.ask,null);this.tab='summary';this.pan=null;this.filter=null;this.full=false;}this.storyOf=id;alertOnce(this,'read',null);}
    catch(e){alertOnce(this,'read',String(e.message||e));return;}
    if(this.story?.mission?.worktree&&(this.deskOf!==id||++this.deskTicks%DESK_EVERY===0)){try{this.desk=await api(MOD,'mission-delivery',{mission:id});this.deskOf=id;alertOnce(this,'delivery',null);}catch(e){alertOnce(this,'delivery',String(e.message||e));}}
   }
   finally{this.reading=false;cx.notify();}
  });
 }
 // When the agents at work were launched: read once per terminal.
 readStarted(cx) {
  if(this.dating)return;
  const live=agents();
  if(!workingTabs(live).some(x=>x.a.address&&!(x.a.address in this.started)))return;
  this.dating=true;
  cx.spawn(async cx=>{
   try{await readStartedInto(this.started,live,address=>api(MOD,'agent-started',{terminal:address}));}
   finally{this.dating=false;cx.notify();}
  });
 }
 // The page shown again after it was hidden is a new visit: its recap starts over from a reading made after (the one
 // kept may hold what was already acknowledged), and nothing is acknowledged before that reading is drawn.
 // Visible: the layout of the ticket shown in the window that has the focus (window().active); in doubt, not visible.
 visible() {let win=null;try{win=herdrWindow();}catch{}return pageVisible({layout:shared('layout'),screen:SCREENS.ticket,win});}
 see() {
  const visible=this.visible();
  if(visible&&!this.shown){this.recap=null;this.drawn=null;this.acked=null;this.stale=true;this.force=true;}
  this.shown=visible;
 }
 // « Seen » (mission-visit-seen, a command of the screens): sent after the recap was drawn, only while the page is
 // visible, never for a recap the engine could not read. Lost or refused, it is sent again at the next tick: until the
 // engine has it, the facts stay to show.
 ack(cx) {
  if(this.acking||!this.drawn||this.stale)return;
  const due=visitAck({...this.drawn,acked:this.acked,visible:this.shown&&this.visible()});
  if(!due)return;
  this.acking=true;
  cx.spawn(async()=>{
   try{const done=await api(MOD,'mission-visit-seen',due);if(done?.mission===due.mission)this.acked={mission:due.mission,upTo:due.upTo};}
   catch{}
   finally{this.acking=false;}
  });
 }
 back() {setShared(KEYS.mission,null);run('layout.switch',{name:SCREENS.devs});}
 // The screen of before, on the same development: what this page does not carry yet is still there.
 previous() {this.menu=false;run('layout.switch',{name:SCREENS.devs});}
 // Pilot on this development, with all it needs to speak about it.
 openPilot(m,cx) {
  if(this.opening)return;
  this.opening='pilot';setShared(KEYS.pilotAsked,new Date().toISOString());cx.notify();
  cx.spawn(async cx=>{
   try{await api(MOD,'pilot-launch',{context:'mission',mission:m.id});goPilot();}
   catch(e){alertToast(e.message||e);setShared(KEYS.pilotAsked,null);}
   finally{this.opening=null;cx.notify();}
  });
 }
 // « Approve and start the dev »: the plan this page drew (its revision) is approved, its frozen copy recorded once by
 // the engine, then the launch is asked of the Lead, who starts its devs through the watcher.
 approve(m,cx) {
  if(this.launching)return;
  this.launching=true;cx.notify();
  cx.spawn(async cx=>{
   try{await api(MOD,'mission-launch',{mission:m.id,seen:m.plan?.revision});this.ticks=0;this.poll(cx);}
   catch(e){alertToast(e.message||e);}
   finally{this.launching=false;cx.notify();}
  });
 }
 // The confirmation of screen 06 (decision 71), over the page: what starts and the frozen copy, then « Cancel », which
 // closes it and writes nothing, and « Approve and start », the only one that approves. The veil takes the clicks meant
 // for the page beneath and does nothing with them, as on the mockup.
 confirmBox(m,c) {
  return confirmDialog(c,{cancel:(_e,cx)=>{this.confirm=false;cx.notify();},go:(_e,cx)=>{this.confirm=false;this.approve(m,cx);}});
 }
 // The same box for the changes approved after the approval (decision 81), opened by the button at the foot of the
 // sheet « Drift from approved plan »: what is approved, then « Cancel », which closes it and writes nothing, and the
 // button that alone approves, with the version of the drift the box drew.
 reconfirmBox(m,c) {
  return confirmDialog(c,{cancel:(_e,cx)=>{this.reconfirm=null;cx.notify();},go:(_e,cx)=>{this.reconfirm=null;this.reapprove(m,c.seen,cx);}});
 }
 reapprove(m,seen,cx) {
  if(this.acting||typeof seen!=='string')return;
  this.acting=true;cx.notify();
  cx.spawn(async cx=>{
   try{await api(MOD,'mission-reapprove',{mission:m.id,seen});this.ticks=0;this.poll(cx);}
   catch(e){alertToast(e.message||e);}
   finally{this.acting=false;cx.notify();}
  });
 }
 // « Pause » and « Resume »: asked of the engine, which holds the pause (decision 32: the agent at work finishes its
 // turn, nothing else starts, and the pause stays after a restart); the page then reads again what it says of it.
 hold(m,command,cx) {
  if(this.acting)return;
  this.acting=true;cx.notify();
  cx.spawn(async cx=>{
   try{await api(MOD,command,{mission:m.id});this.ticks=0;this.poll(cx);}
   catch(e){alertToast(e.message||e);}
   finally{this.acting=false;cx.notify();}
  });
 }
 // « Close… » (screen 06 of « pre-close »): the box opens on the checklist the engine computes, read without writing
 // anything; « Approve and close » sends the version of the list shown (seen), and the engine refuses it if it moved.
 askClose(m,cx) {
  if(this.closeBox)return;
  this.closeBox={of:m.id,loading:true,check:null,error:''};cx.notify();
  cx.spawn(async cx=>{
   try{const check=await api(MOD,'mission-close-check',{mission:m.id});if(this.closeBox?.of===m.id)this.closeBox={of:m.id,loading:false,check,error:''};}
   catch(e){if(this.closeBox?.of===m.id)this.closeBox={of:m.id,loading:false,check:null,error:String(e.message||e)};}
   finally{cx.notify();}
  });
 }
 approveClose(m,box,cx) {
  if(this.acting||!box.ready)return;
  this.acting=true;this.closeBox=null;cx.notify();
  cx.spawn(async cx=>{
   try{await api(MOD,'mission-approve-close',{mission:m.id,seen:box.seen});this.ticks=0;this.poll(cx);}
   catch(e){alertToast(e.message||e);}
   finally{this.acting=false;cx.notify();}
  });
 }
 // « Reopen… » (screen 08): a reason is required; the mission goes back to Validate, never to Develop.
 askReopen(m,cx) {
  this.reason=reasonField(W.page.reopenBox.hint);this.reopenBox=m.id;cx.notify();
 }
 reopen(m,cx) {
  const reason=String(this.reason?.value()||'').trim();
  if(this.acting||this.reopenBox!==m.id||!reasonOk(reason))return;
  this.acting=true;this.reopenBox=false;cx.notify();
  cx.spawn(async cx=>{
   try{await api(MOD,'mission-reopen',{mission:m.id,reason});this.ticks=0;this.poll(cx);}
   catch(e){alertToast(e.message||e);}
   finally{this.acting=false;cx.notify();}
  });
 }
 closeBoxView(m,box) {
  return confirmDialog({...box,held:!box.ready},{cancel:(_e,cx)=>{this.closeBox=null;cx.notify();},go:(_e,cx)=>this.approveClose(m,box,cx)});
 }
 reopenBoxView(m,box) {
  const input=Input.new(this.reason).w_full().h(40).px(12).rounded(8).bg('#14171C').border_1().border_color('#3A4049').text_size(14).text_color('#E6E9F0');
  return confirmDialog({...box,width:560,tone:'amber',input,rows:[]},{cancel:(_e,cx)=>{this.reopenBox=false;cx.notify();},go:(_e,cx)=>this.reopen(m,cx)});
 }
 // The tab of an agent, beside Pilot: the Lead on its own page, a dev on the page of an agent.
 openTab(m,lead,address) {
  this.menu=false;
  if(lead&&address===lead.address){goLead(m,lead);return;}
  const agent=agents().find(a=>a.address===address);
  if(!agent){alertToast(W.errors.failed);return;}
  const tabs=shared(KEYS.tabs)||[];
  if(!tabs.includes(address))setShared(KEYS.tabs,[...tabs,address]);
  setShared(KEYS.project,null);setShared(KEYS.agent,address);
  run('space.select',{id:agent.space});run('tab.select',{id:agent.tab});run('layout.switch',{name:screenOfAgent(address,shared(KEYS.missions),snapshot().sessions,snapshot().projects)});
 }
 openUrl(url,cx) {this.menu=false;cx.notify();cx.spawn(async()=>{await exec('open',[url]);});}
 // A button of the head: 34 high, the same for the three of them.
 headBtn(id,label,fn,{square=false,pilot=false,on=false}={}) {
  let el=h_flex().id(id).flex_none().items_center().justify_center().h(34).rounded(9).border_1().cursor_pointer().whitespace_nowrap().text_size(13.5)
   .border_color(pilot?'#4F5FD0':on?K.dim:K.ctl).bg(pilot?'#262B5E':on?'#262B3A':K.card).text_color(pilot?'#D6DAFF':'#D6DAE6').on_click(fn).child(label);
  el=square?el.w(34):el.px(14);
  return pilot||on?el:el.hover(s=>s.border_color(K.sep));
 }
 head(m,project,lead,tabs) {
  const h=pageHead(m,project);
  const step=t=>h_flex().flex_none().items_center().gap(5).text_color(t.state==='on'?K.white:K.dim).font_weight(t.state==='on'?600:400)
   .child(div().relative().flex_none().w(7).h(7).when(t.state==='on',e=>e.child(div().absolute().top(-3).left(-3).w(13).h(13).rounded(7).bg(K.ring))).child(div().absolute().top(0).left(0).w(7).h(7).rounded(4).bg(t.state==='on'?K.on:t.state==='done'?K.done:K.ctl)))
   .child(t.label);
  return h_flex().id('page-head').flex_none().h(44).mb(10).items_center().gap(12).min_w(0)
   .child(h_flex().id('page-flag').flex_none().w(44).h(44).rounded(11).border(1.5).border_color(K.on).bg('#261F4A').text_color('#B9AEFF').text_size(18).items_center().justify_center().child(P.flag))
   .child(v_flex().flex_1().min_w(0)
    .child(div().truncate().text_size(20).font_weight(500).text_color(K.white).child(h.title))
    .child(h_flex().items_center().gap(10).mt(1).text_size(13).text_color(K.dim).child(div().flex_none().whitespace_nowrap().child(h.sub))
     .child(h_flex().id('page-track').flex_none().items_center().gap(6).text_size(12).children(h.track.flatMap((t,n)=>n?[div().flex_none().text_color(K.sep).child('›'),step(t)]:[step(t)])))))
   .child(h_flex().flex_none().gap(8)
    .child(this.headBtn('page-back',P.back,()=>this.back(),{square:true}))
    .child(this.headBtn('page-pilot',this.opening==='pilot'?P.pilotStarting:P.pilot,(_e,cx)=>this.openPilot(m,cx),{pilot:true}))
    .child(this.headBtn('page-more',P.more,(_e,cx)=>{this.menu=!this.menu;cx.notify();},{square:true,on:this.menu})));
 }
 // The menu of the head, under its button: the issue in the tracker, then the tabs of the agents.
 menuBox(m,lead,tabs) {
  const url=/^https:\/\//.test(m.issue?.url||'')?m.issue.url:null,live=agents();
  const row=(id,fn)=>h_flex().id(id).flex_none().w_full().h(36).px(10).gap(9).items_center().rounded(7).cursor_pointer().text_size(13.5).text_color(K.text).hover(s=>s.bg(K.line)).on_click(fn);
  const small=text=>div().flex_none().text_size(12).text_color(K.dim).child(text);
  return div().absolute().top(0).left(0).size_full()
   .child(div().id('page-menu-out').absolute().top(0).left(0).size_full().on_mouse_down('left',(_e,cx)=>{this.menu=false;cx.notify();}))
   .child(v_flex().id('page-menu').absolute().top(59).right(20).w(250).p(6).rounded(10).bg('#1D2127').border_1().border_color('#3A4049').shadow_2xl().on_mouse_down('left',(_e,cx)=>cx.stop_propagation())
    .when(Boolean(url),e=>e.child(row('menu-tracker',(_e,cx)=>this.openUrl(url,cx)).child(P.menu.tracker).child(div().flex_1()).child(P.menu.out)))
    .children(tabs.map(t=>{const a=live.find(x=>x.address===t.address);return row('menu-tab-'+t.key,()=>this.openTab(m,lead,t.address)).child(div().relative().flex_none().w(8).h(8).when(a?.status==='working',e=>e.child(div().absolute().top(0).left(0).w(8).h(8).rounded(9).bg(K.done).opacity(0.5).loop('opacity',{from:0.5,to:0,...PULSE}).loop('width',{from:8,to:18,...PULSE}).loop('height',{from:8,to:18,...PULSE}).loop('left',{from:0,to:-5,...PULSE}).loop('top',{from:0,to:-5,...PULSE}))).child(div().absolute().top(0).left(0).w(8).h(8).rounded(4).bg(DOT[a?.status]||K.idle))).child(t.label).child(div().flex_1()).child(small(P.menu.status[a?.status]||P.menu.status.idle));}))
    .child(row('menu-previous',()=>this.previous()).child(P.menu.previous)));
 }
 band(m,lead,b,cx) {
  const [line,bg,disc,ink]=BAND[b.tone]||BAND.off,main=MAIN[b.tone]||MAIN.ok;
  // A main button drawn but held (screen 07: the launch while the environment is not ready) does nothing.
  const held=Boolean(b.button?.disabled),act=held?null:{answer:(_e,cx)=>this.show({t:'ask',id:b.button.item.id},cx),approve:(_e,cx)=>{if(this.launching)return;this.confirm=true;cx.notify();},resume:(_e,cx)=>this.hold(m,'mission-resume',cx),close:(_e,cx)=>this.askClose(m,cx),reopen:(_e,cx)=>this.askReopen(m,cx),test:()=>{setShared(KEYS.qa,{mission:m.id});openQa(m.id,qaSurface(m.id),{force:true});}}[b.button?.key];
  const other={pr:(_e,cx)=>b.second.urls.forEach(u=>this.openUrl(u,cx)),check:(_e,cx)=>this.show({t:'list',id:'env'},cx),pause:(_e,cx)=>this.hold(m,'mission-pause',cx),blocking:(_e,cx)=>this.show({t:'blocked',id:b.second.item.id,ticket:b.second.item.ticket},cx)}[b.second?.key];
  const label=b.button?.key==='approve'&&this.launching?P.band.approving:b.button?.label;
  return h_flex().id('page-band').flex_none().h(72).mb(12).px(20).gap(16).items_center().rounded(12).border_1().border_color(line).bg(bg)
   .child(h_flex().flex_none().w(36).h(36).rounded(18).items_center().justify_center().bg(disc).text_color(ink).text_size(16).font_weight(700).child(b.tone==='run'?svg(ARC).size(16).flex_none().text_color(ink).spin(TURN):b.icon))
   .child(v_flex().flex_1().min_w(0)
    .child(div().truncate().text_size(19).font_weight(600).text_color(K.white).child(b.big))
    .when(Boolean(b.det),e=>e.child(div().truncate().mt(2).text_size(13.5).text_color(K.sec).child(b.det))))
   .when(Boolean(other),e=>e.child(h_flex().id('band-second').flex_none().items_center().justify_center().h(34).px(14).rounded(9).border_1().border_color(K.ctl).cursor_pointer().whitespace_nowrap().text_size(13.5).font_weight(500).text_color('#D6DAE6').hover(s=>s.border_color(K.sep)).on_click(other).child(b.second.label)))
   .when(Boolean(act),e=>e.child(h_flex().id('band-main').flex_none().items_center().justify_center().h(42).px(20).rounded(9).border_1().cursor_pointer().whitespace_nowrap().text_size(15).font_weight(600).bg(main[0]).border_color(main[1]).text_color(main[2]).on_click(act).child(label)))
   .when(held,e=>e.child(h_flex().id('band-main').flex_none().items_center().justify_center().h(42).px(20).rounded(9).border_1().whitespace_nowrap().text_size(15).font_weight(600).bg(main[0]).border_color(main[1]).text_color(main[2]).opacity(0.4).child(label)));
 }
 // ---- The plan. Its head: how many tickets; in Prepare how they will run, from Develop how many are accepted.
 planHead(m,lead,waits,view=null) {
  const h=lineHead({mission:m,lead,items:waits}),bold=text=>div().flex_none().whitespace_nowrap().text_size(13).font_weight(600).text_color(K.white).child(text),sep=()=>div().flex_none().w(1).h(14).bg(K.ctl);
  const fact=()=>h_flex().flex_none().items_center().gap(6).whitespace_nowrap().text_size(13).text_color(K.sec);
  return h_flex().id('plan-head').flex_none().h(34).mb(10).gap(10).items_center().min_w(0).overflow_hidden()
   .child(div().flex_none().text_size(16).font_weight(600).text_color(K.white).child(P.plan.title))
   .when(Boolean(h.count),e=>e.child(bold(h.count)))
   .when(Boolean(h.facts?.branch),e=>e.child(sep()).child(fact().child(h.facts.line).child(div().font_family(MONO).text_size(12.5).child(h.facts.branch))))
   .when(Boolean(h.facts),e=>e.child(sep()).children(h.facts.devs.map(dev=>fact().child(devBadge({text:dev.badge,live:false})).child(dev.name).when(Boolean(dev.tool),x=>x.child(div().text_size(12).text_color(K.dim).child(dev.tool))))))
   .when(Boolean(h.progress),e=>e.child(sep()).child(bold(h.progress.text)).child(h_flex().flex_none().items_center().gap(3).children(h.progress.segs.map(tone=>div().w(18).h(6).rounded(3).flex_none().bg(SEG[tone]||K.seg)))))
   .child(div().flex_1())
   .when(Boolean(view),e=>e.child(this.views(view)))
   .when(approachLink(m),e=>e.child(this.link('plan-approach',P.strip.approachLink,(_e,cx)=>this.show({t:'approach'},cx))));
 }
 // « Plan | Kanban »: the two views of the plan, from Develop on. The one chosen is kept for every development, and
 // from a session to the next (a shared value of the window).
 views(view) {
  const side=(key,label)=>{const on=view===key;let el=h_flex().id('plan-view-'+key).flex_none().h(28).px(12).items_center().whitespace_nowrap().text_size(13).font_weight(on?600:400).text_color(on?K.white:SOFT).cursor_pointer().on_click((_e,cx)=>{setShared(KEYS.planView,key==='kanban'?'kanban':null);cx.notify();}).child(label);return on?el.bg('#2C3139'):el.hover(s=>s.text_color(K.white));};
  return h_flex().id('plan-views').flex_none().rounded(8).border_1().border_color(K.ctl).overflow_hidden().child(side('line',P.plan.title)).child(side('kanban',P.plan.kanban));
 }
 // The Kanban (screen 09): the same cards as the line, in five columns placed by boardLayout in the numbers of the
 // mockup. In dev and In review show their ticket in large, with its expected result; a column folds on one line the
 // cards it cannot show in full, and the board scrolls in its zone beyond that. A card glides to its new place when its
 // ticket changes of column. No band under it: the board takes the zone.
 board(m,tickets,cards,ends,waits,covers,reports) {
  const {total,accepted}=pageCount(m);
  const d=boardLayout({tickets,width:this.hostW,sel:this.sel,ends,acceptedAt:acceptedTimes(tickets,reports),done:stageOf(m)!=='develop'||(total>0&&accepted===total)});
  const column=c=>div().id('board-'+c.key).absolute().left(c.x).top(0).w(c.w).h(c.h).rounded(10).bg(STRIP_BG)
   .child(h_flex().flex_none().pt(9).px(12).justify_between().text_size(12).font_weight(600).text_color(K.dim).child(c.title.toUpperCase()).child(div().flex_none().text_color(K.text).child(c.count)))
   .when(Boolean(c.hint),e=>e.child(div().absolute().left(16).top(BOARD.hint).w(c.w-32).text_center().text_size(12.5).line_height(1.45).text_color(K.sep).child(c.hint)));
  const body=div().id('board-body').relative().flex_none().w(d.width).h(d.height)
   .children(d.cols.map(column))
   .children(d.cards.flatMap((box,i)=>[...cardRings(box,covers?{ring:covers.includes(box.id)?'unblocks':null}:box),ticketCard(cards[i],{id:'card-'+box.id,...box,result:tickets[i].result||'',moves:true,faded:covers?!covers.includes(box.id):false,onPick:(_e,cx)=>this.pick(box.id,cx)})]))
   .children(d.ends.map((box,i)=>ticketCard(ends[i],{id:'card-'+box.key,...box})));
  let host=div().id('plan-board').relative().flex_none().self_stretch().min_w(0).h(BOARD.host).on_size_change((size,cx)=>this.measured(size,cx)).child(this.probe());
  // The board scrolls sideways whenever it is wider than what is shown (the user: a scroll rather than a column cut), and
  // down when a column holds many cards.
  host=d.height>BOARD.host?host.overflow_scrollbar():host.overflow_x_scrollbar();
  if(this.boardScroll)host=host.track_scroll(this.boardScroll);
  // It always brings into view what is under way: the card in dev, else in review, else the QA when it tests (the user).
  const live=d.cards.find(c=>c.column===1)||d.cards.find(c=>c.column===2)||(stageOf(m)!=='develop'?d.ends.find(e=>e.key==='qa')||null:null);
  const focus=live?m.id+'|'+(live.id||live.key):null;
  if(focus&&focus!==this.boardFocus&&this.boardScroll){this.boardFocus=focus;this.boardScroll.scroll_to_item(1);}
  return host.child(body).when(Boolean(live),e=>e.child(div().id('board-focus').absolute().left(live.x).top(live.y).w(live.w).h(live.h)));
 }
 // The width of the zone, in the units the layout draws with. The window reports sizes zoomed (Herdr's zoom, 1.1 here):
 // a probe drawn 100 wide says by how much, and the width measured is brought back by it.
 probe() {return div().id('plan-probe').absolute().left(0).top(0).w(100).h(0).on_size_change((size,cx)=>{const k=size.width/100;if(k>0&&Math.abs(k-(this.zoom||1))>0.001){this.zoom=k;if(this.rawW)this.measured({width:this.rawW},cx);}});}
 measured(size,cx) {this.rawW=size.width;const w=Math.round(size.width/(this.zoom||1));if(w>0&&w!==this.hostW){this.hostW=w;cx.notify();}}
 // A link, as the mockup draws them.
 link(id,label,fn) {return div().id(id).flex_none().cursor_pointer().whitespace_nowrap().text_size(13).text_color(K.link).hover(s=>s.text_color('#D6DAFF')).on_click(fn).child(label);}
 // The user moves the line: by a button (three tickets) or by the wheel. Choosing a ticket never moves it, as on the
 // mockup: a ticket chosen out of sight stays there until the line is moved. A page opened on a ticket (from another
 // screen) shows its details; closing them forgets that ticket.
 moveLine(to,auto,cx) {this.pan=to===auto?null:to;cx.notify();}
 pick(id,cx) {
  this.sel=id;this.open=null;if(!id&&shared(KEYS.ticket))setShared(KEYS.ticket,null);
  cx.notify();
 }
 // A row of the blocks, or a link of the band, opens its sheet in the column on the right, in place of what was there.
 show(open,cx) {
  this.open=open;this.sel=null;if(shared(KEYS.ticket))setShared(KEYS.ticket,null);
  cx.notify();
 }
 // What a row or a sheet does beyond opening: open a request where it is answered (as the banner does), open a link,
 // open a ticket, ask for the check of the environment again.
 act(m,a,cx) {
  if(a.key==='answer')return this.show({t:'ask',id:a.item.id},cx);
  if(a.key==='url')return this.openUrl(a.url,cx);
  if(a.key==='ticket')return this.pick(a.id,cx);
  if(a.key==='approach')return this.show({t:'approach'},cx);
  // An approval of before, from the sheet of the frozen copy (decision 82).
  if(a.key==='frozen')return this.show({t:'frozen',id:a.id??null},cx);
  // M7, decision 81: « Approve these changes » opens the confirmation box; nothing is sent from here.
  if(a.key==='reapprove'){
   if(this.acting||typeof a.seen!=='string')return;
   this.reconfirm=a.seen;cx.notify();
   return;
  }
  // M6 (b): its own flag, so that a check in progress (or one that fails) blocks no other action of the page; the
  // readings go on meanwhile. A check that cannot run is said, and the check of before stays drawn.
  if(a.key!=='env-check'||this.checking)return;
  this.checking=true;cx.notify();
  cx.spawn(async cx=>{
   try{await api(MOD,'environment-check',{mission:m.id});}
   catch(e){alertToast(e.message||e);}
   finally{this.checking=false;this.force=true;this.poll(cx);cx.notify();}
  });
 }
 // The line: one row, from left to right, never folded. It scrolls in its zone and puts the active ticket at its
 // centre (decision 53), with room before the first ticket or after the last one when it takes that; QA and Sign-off
 // stay at its end. Everything is placed by lineLayout, in the numbers of the mockup. With two devs (`devs`, screens 40
 // and 41) the same zone holds two lanes, placed by lanesLayout: each dev named before its lane, each lane set on its own
 // active ticket, QA at the end of the first and Sign-off at the end of the second, and no band under them.
 line(m,tickets,cards,ends,waits,strip,covers,devs=null) {
  const focus=lineFocus(tickets),active=lineActive(tickets),width=this.hostW,geo=devs?TWO:LINE,phases=linePhases(m,tickets);
  const key=m.id+'|'+(tickets[focus]?.id||'')+(devs?'|'+lanesPan({tickets,width,focus}).active.map(i=>tickets[i]?.id||'').join('|'):'');
  if(this.panOf!==key){this.panOf=key;this.pan=null;}
  // A single ticket (screen 37) holds in its zone: its line does not move.
  const simple=!devs&&m.plan?.simple===true,placed=devs?lanesPan({tickets,width,focus,pan:this.pan}):linePan({count:tickets.length,width,focus,pan:this.pan,active}),at=simple?{...placed,pan:0,lo:0,hi:0}:placed;
  const d=devs?lanesLayout({tickets,phases,width,pans:at.lanes,sel:this.sel,ends:ends.length>0}):lineLayout({tickets,phases,width,pan:at.pan,sel:this.sel,ends:ends.length>0,simple}),edge=simple?width:width-LINE.pin-12;
  const seen=box=>box.x+box.w>-24&&box.x<edge+24,ink=tone=>LINK[tone]||RAIL;
  const phase=p=>{const el=h_flex().absolute().left(p.x).top(0).w(p.w).h(22).justify_center().overflow_hidden().whitespace_nowrap().border_b_2().border_color(K.line).text_size(11).font_weight(600).text_color(K.dim).child(p.text.toUpperCase());return p.dashed?el.border_dashed():el;};
  const seg=s=>div().absolute().left(s.x).top(s.y).w(s.w).h(s.h).bg(ink(s.tone));
  const head=h=>window.paint_path(PathBuilder.fill().add_polygon(h.dir==='down'?[[0,0],[10,0],[5,6]]:[[0,6],[10,6],[5,0]],true).build(),ink(h.tone)).absolute().left(h.x).top(h.y).w(10).h(6);
  const fade=(box,left)=>window.paint_path(PathBuilder.fill().move_to('0%','0%').line_to('100%','0%').line_to('100%','100%').line_to('0%','100%').close().build(),Background.linear_gradient(90,left?K.card:K.card+'00',left?K.card+'00':K.card)).absolute().left(box.x).top(box.y).w(box.w).h(box.h);
  const pan=(id,box,label,by)=>h_flex().id(id).absolute().left(box.x).top(box.y).h(26).px(9).items_center().rounded(13).border_1().border_color('#4A52A8').bg('#262B5E').text_color('#D6DAFF').text_size(12).font_weight(600).whitespace_nowrap().cursor_pointer()
   .hover(s=>s.border_color(K.link)).on_click((_e,cx)=>this.moveLine(lineJump({pan:at.pan,auto:at.auto,max:at.max,by}),at.auto,cx)).child(label);
  const shown=d.cards.map((box,i)=>({box,i})).filter(x=>seen(x.box));
  // A single ticket (oneLayout) lays its card, chevrons and ends out together: they keep their places, nothing hangs.
  const pinFrom=simple?width:Math.min(d.masks.solid.x,...(d.masks.right?[d.masks.right.x]:[]),...d.ends.map(b=>b.x),...d.phases.filter(p=>p.pin).map(p=>p.x),...d.segs.filter(x=>x.pin).map(x=>x.x),...d.heads.filter(h=>h.pin).map(h=>h.x));
  // A lane: its background, and before it the badge of its dev, its name, its tool and model in small, its tickets.
  const back=l=>div().absolute().left(l.x).top(l.y).w(l.w).h(l.h).rounded(10).bg(STRIP_BG);
  const name=(l,n)=>v_flex().id('lane-name-'+devs[n].n).absolute().left(l.name.x).top(l.name.y).w(l.name.w).gap(5).items_start().text_size(12.5).font_weight(600).line_height(1.3).text_color(K.text)
   .child(h_flex().flex_none().min_w(20).h(20).px(4).rounded(10).items_center().justify_center().border(1.5).border_color(BADGE.dev[1]).bg(BADGE.dev[0]).text_color(BADGE.dev[2]).text_size(10.5).font_weight(700).child(devs[n].badge))
   .child(v_flex().flex_none().w_full().child(div().child(devs[n].name))
    .when(Boolean(devs[n].label),e=>e.child(div().text_size(11.5).font_weight(400).text_color(K.dim).child(devs[n].label)))
    .child(div().text_size(11.5).font_weight(400).text_color(K.dim).child(devs[n].count)));
  return div().id('plan-line').relative().flex_none().self_stretch().min_w(0).h(LINE.host).overflow_hidden()
   .on_size_change((size,cx)=>this.measured(size,cx)).child(this.probe())
   .on_scroll_wheel((e,cx)=>{const by=Math.abs(e.delta.x)>Math.abs(e.delta.y)?-e.delta.x:-e.delta.y,to=Math.min(at.hi,Math.max(at.lo,at.pan+by));if(to!==at.pan)this.moveLine(to,at.auto,cx);})
   .children((d.lanes||[]).map(back))
   // One dev: the row of the tickets on a dark band, as the columns of the Kanban (the user, 2026-11-17).
   .when(!devs&&!simple,e=>e.child(div().absolute().left(0).top(geo.top-10).w(Math.max(0,edge-4)).h(geo.height+20).rounded(10).bg(STRIP_BG)))
   .children(d.phases.filter(p=>!p.pin&&seen(p)).map(phase))
   .children(d.glyphs.filter(g=>seen({x:g.x,w:8})).map(g=>h_flex().absolute().left(g.x).top(g.y).w(g.w||8).h(16).justify_center().items_center().text_size(14).text_color(LINK[g.tone]||GLYPH).child(g.text)))
   .children(d.segs.filter(s=>!s.pin).map(seg)).children(d.heads.filter(h=>!h.pin).map(head))
   .children(shown.flatMap(({box,i})=>[...cardRings(box,covers?{ring:covers.includes(box.id)?'unblocks':null}:box),ticketCard(cards[i],{id:'card-'+box.id,...box,faded:covers?!covers.includes(box.id):Boolean(this.filter)&&!lineMatches(tickets[i],this.filter,waits),onPick:(_e,cx)=>this.pick(box.id,cx)})]))
   .when(Boolean(d.masks.gutter),e=>e.child(div().absolute().left(d.masks.gutter.x).top(0).w(d.masks.gutter.w).h(d.masks.gutter.h).bg(K.card)))
   .when(Boolean(d.masks.left),e=>e.child(fade(d.masks.left,true)))
   .children((d.lanes||[]).map(name))
   // What is pinned at the end of the zone (its mask and fade, QA and Sign-off) hangs from the right edge of the line, so
   // that it stays whole whatever width was measured for the line.
   .child(div().id('plan-pinned').absolute().top(0).right(0).w(width-pinFrom).h(geo.host).children([
    div().absolute().left(d.masks.solid.x-pinFrom).top(0).w(d.masks.solid.w).h(d.masks.solid.h).bg(K.card),
    ...(d.masks.right?[fade({...d.masks.right,x:d.masks.right.x-pinFrom},false)]:[]),
    ...(!devs&&!simple&&d.ends.length?[div().absolute().left(Math.min(...d.ends.map(x=>x.x))-pinFrom-10).top(geo.top-10).w(LINE.pin+20).h(geo.height+20).rounded(10).bg(STRIP_BG)]:[]),
    // A dotted line between the last ticket and QA, under the phase Validate (Claude Design, 2026-11-17).
    ...(!devs&&!simple&&d.ends.length?[div().absolute().left(Math.min(...d.ends.map(x=>x.x))-pinFrom-16).top(26).w(0).h(geo.top+geo.height-16).border_l_1().border_dashed().border_color('#3A4052')]:[]),
    ...d.phases.filter(p=>p.pin).map(p=>phase({...p,x:p.x-pinFrom})),...d.segs.filter(s=>s.pin).map(s=>seg({...s,x:s.x-pinFrom})),...d.heads.filter(h=>h.pin).map(h=>head({...h,x:h.x-pinFrom})),
    ...(simple?[]:d.ends.map((box,i)=>ticketCard(ends[i],{id:'card-'+box.key,...box,x:box.x-pinFrom})))]))
   .when(simple,e=>e.children(d.ends.map((box,i)=>ticketCard(ends[i],{id:'card-'+box.key,...box}))))
   .when(Boolean(d.pans.before),e=>e.child(pan('line-before',d.pans.before,P.plan.before(d.pans.before?.count),-geo.step*geo.pitch)))
   .when(Boolean(d.pans.after),e=>e.child(pan('line-after',d.pans.after,P.plan.after(d.pans.after?.count),geo.step*geo.pitch)))
   .when(Boolean(strip),e=>e.child(this.strip(m,strip,width)));
 }
 // A chip, the disc of a step and the pill of a ticket: the same in the band, the details of a ticket and a sheet.
 chip(c) {const [bg,line,ink]=CHIP[c.tone]||['#262A31','#30353C',K.sec];return h_flex().flex_none().h(22).px(8).rounded(6).items_center().border_1().border_color(line).bg(bg).text_color(ink).text_size(12).font_weight(500).whitespace_nowrap().child(c.text);}
 disc(sign,tone) {const [bg,ink]=ORD[tone]||[K.bar,K.sec];return h_flex().flex_none().min_w(22).h(22).px(4).rounded(11).items_center().justify_center().bg(bg).text_color(ink).text_size(12).child(sign);}
 pill(id,key) {return h_flex().id(key+'-'+id).flex_none().h(22).px(7).mr(5).rounded(5).items_center().border_1().border_color('#4A52A8').bg('#1C2040').text_color('#C9D0FF').font_family(MONO).text_size(12).cursor_pointer().hover(s=>s.border_color(K.link)).on_click((_e,cx)=>this.pick(id,cx)).child(id);}
 // ---- The band under the line (one dev): what happens now, in large. On the left what it is about, in the middle its
 // steps or its phases, on the right its facts and its link.
 strip(m,s,width) {
  const label=text=>div().flex_none().mb(5).text_size(11).font_weight(600).text_color(K.dim).whitespace_nowrap().child(text.toUpperCase());
  // The middle keeps the width of the mockup (its steps fold as there); a title or a text too long ends with « … ».
  const room=stripRoom(width);
  const step=(x,n)=>h_flex().id('strip-step-'+n).flex_none().items_center().gap(7).py(4).pl(6).pr(9).rounded(9).bg(K.app).border_1().border_color(K.line).text_size(12.5).whitespace_nowrap()
   .child(this.disc(x.sign,x.tone)).child(v_flex().flex_none().child(div().font_weight(600).text_color(K.text).child(x.text)).when(Boolean(x.sub),e=>e.child(div().text_size(11.5).text_color(K.dim).child(x.sub))));
  return h_flex().id('plan-strip').absolute().left(0).right(0).top(LINE.band).h(LINE.host-LINE.band).py(14).px(16).gap(22).items_start().rounded(10).bg(STRIP_BG).border_1().border_color(STRIP[s.tone]||STRIP_LINE).overflow_hidden()
   .child(v_flex().id('strip-what').flex_none().w(room.left).min_w(0)
    .when(Boolean(s.kicker),e=>e.child(label(s.kicker)))
    .when(Boolean(s.title),e=>e.child(div().flex_none().max_h(41).overflow_hidden().text_size(16).font_weight(600).line_height(1.28).text_color(K.white).child(clipText(s.title,room.title))))
    .when(Boolean(s.text),e=>e.child(div().flex_none().mt(6).max_h(55).overflow_hidden().text_size(12.5).line_height(1.45).text_color(SOFT).child(clipText(s.text,room.text))))
    .when(s.chips.length>0,e=>e.child(h_flex().flex_none().flex_wrap().gap(6).mt(8).children(s.chips.map(c=>this.chip(c))))))
   .child(v_flex().id('strip-steps').flex_1().min_w(0)
    .when(Boolean(s.mid),e=>e.child(label(s.mid.title)).child(h_flex().flex_none().flex_wrap().gap(8).children(s.mid.steps.map(step)))
     .when(Boolean(s.mid.bar),x=>x.child(h_flex().id('strip-bar').flex_none().gap(3).mt(12).children(s.mid.bar.map(()=>div().flex_1().h(10).rounded(3).bg(K.seg)))))))
   .child(v_flex().id('strip-facts').flex_none().w(196).h_full().pl(18).gap(7).border_l_1().border_color(K.line).text_size(13)
    .children(s.facts.map(([name,value],n)=>h_flex().id('strip-fact-'+n).flex_none().justify_between().gap(10).child(div().flex_none().whitespace_nowrap().text_color(K.dim).child(name)).child(div().min_w(0).truncate().text_color(K.text).child(value))))
    .child(div().flex_1().min_h(0))
    .when(Boolean(s.button),e=>e.child(this.link('strip-open',s.button.label,(_e,cx)=>this.act(m,s.button,cx)))));
 }
 // The legend: only what is on the line. In Prepare an entry filters the line; with a ticket chosen, the two rings.
 legend(m,tickets,cards) {
  const stage=stageOf(m),entries=lineLegend({tickets,cards,stage});
  const glyph=l=>l.kind==='tag'?tagChip({text:l.glyph,heavy:l.heavy}):l.kind==='badge'?badgeChip({text:l.glyph,tone:l.tone}):l.kind==='mark'?div().flex_none().text_size(12).font_weight(700).text_color(MARK[l.tone]).child(l.glyph):l.kind==='reviewer'?reviewerTag({text:l.glyph,live:false}):null;
  const entry=(l,n)=>{
   const on=Boolean(l.filter)&&this.filter===l.filter;
   let el=h_flex().id('legend-'+n).flex_none().h(24).px(6).gap(6).items_center().rounded(6).border_1().whitespace_nowrap().text_size(12.5).border_color(on?'#C8CED6':K.card).text_color(on?K.white:l.filter?K.sec:K.dim);
   if(on)el=el.bg('#2C3139');
   if(l.filter)el=el.cursor_pointer().on_click((_e,cx)=>{this.filter=on?null:l.filter;cx.notify();});
   if(l.filter&&!on)el=el.hover(s=>s.border_color(K.ctl));
   const mark=glyph(l);
   return (mark?el.child(mark):el).when(Boolean(l.text),e=>e.child(l.text));
  };
  const ring=(color,text)=>h_flex().flex_none().items_center().gap(6).child(div().flex_none().w(14).h(14).rounded(5).border_2().border_color(color)).child(text);
  return h_flex().id('plan-legend').flex_none().h(26).mt(10).gap(6).items_center().min_w(0).overflow_hidden().whitespace_nowrap().text_size(12.5).text_color(K.dim)
   .children(entries.map(entry)).child(div().flex_1())
   .when(Boolean(this.sel),e=>e.child(ring(LINK.waits,P.plan.waitsFor)).child(div().w(4)).child(ring(LINK.unblocks,P.plan.unblocks)))
   .when(!this.sel&&stage==='prepare'&&tickets.length>0,e=>e.child(div().flex_none().child(P.plan.hint)));
 }
 plan(m,lead,tickets,cards,ends,waits,strip,covers,devs,view,reports) {
  return v_flex().id('page-plan').flex_none().h(PLAN_H).py(14).px(16).rounded(12).bg(K.card).border_1().border_color(K.line)
   .child(this.planHead(m,lead,waits,view)).child(view==='kanban'?this.board(m,tickets,cards,ends,waits,covers,reports):this.line(m,tickets,cards,ends,waits,strip,covers,devs)).child(this.legend(m,tickets,cards));
 }
 // ---- The three blocks at the bottom, in the shares of the mockup widths, within the width of the centre. A row opens its
 // sheet in the column on the right; a row that waits for an answer opens the request, as the banner does.
 blocks(m,list) {
  const row=(b,r)=>{
   const [bg,line]=SIGN[r.signTone]||SIGN.count,look=ROW[r.look]||null,clicks=Boolean(r.open||r.act),calm=r.look==='calm';
   let sign=h_flex().flex_none().w(22).h(22).rounded(6).items_center().justify_center().bg(bg).text_color(line).text_size(12).font_weight(700).child(r.sign);
   if(r.signTone==='count')sign=sign.font_family(MONO).font_weight(400);
   let el=h_flex().id('row-'+b.key+'-'+r.key.replace(':','-')).flex_none().w_full().h(r.small?38:46).px(8).gap(10).items_center().rounded(8).border_1().text_size(13.5)
    .border_color(r.selected?(look?K.amber:'#C8CED6'):look?look[1]:K.card).text_color(look?K.white:calm?K.dim:'#D6DAE6');
   if(look)el=el.bg(look[0]);else if(r.selected)el=el.bg('#2C3139');
   if(r.look==='zero')el=el.opacity(0.5);
   if(clicks)el=el.cursor_pointer().on_click((_e,cx)=>r.act?this.act(m,r.act,cx):this.show(r.open,cx));
   if(clicks&&!look&&!r.selected)el=el.hover(s=>s.bg('#20242F'));
   if(clicks&&r.look==='you')el=el.hover(s=>s.border_color(K.amber));
   return el.child(sign)
    .child(v_flex().flex_1().min_w(0).child(div().truncate().child(r.text)).when(Boolean(r.sub),e=>e.child(div().truncate().text_size(12).text_color(look?look[2]:K.dim).child(r.sub))))
    .when(Boolean(r.right),e=>{let right=div().flex_none().whitespace_nowrap().text_size(r.rightMono?11.5:12).text_color(look?look[3]:K.dim).child(r.right);if(r.rightMono)right=right.font_family(MONO);if(r.look==='you')right=right.font_weight(600);return e.child(right);});
  };
  // Each block takes its share of the mockup widths out of the room there is: the row never runs under the column.
  const block=(b,n)=>v_flex().id('block-'+b.key).flex_grow(b.wide?BLOCKS[1]+BLOCKS[2]:BLOCKS[n]).flex_shrink(1).flex_basis(0).h_full().min_h(0).min_w(0).pt(12).px(8).pb(8).rounded(12).bg(K.card).border_1().border_color(b.tone==='you'?'#8A6B1F':K.line)
   .child(h_flex().flex_none().h(28).px(8).mb(4).gap(8).items_center()
    .child(div().flex_none().whitespace_nowrap().text_size(12).font_weight(600).text_color(K.dim).child(b.title.toUpperCase()))
    .when(Boolean(b.count),e=>e.child(h_flex().flex_none().h(20).px(7).rounded(10).items_center().whitespace_nowrap().text_size(12).font_weight(600).bg(b.countTone==='you'?'#3A2E12':K.bar).text_color(b.countTone==='you'?K.amber:K.text).child(b.count)))
    .child(div().flex_1())
    .when(Boolean(b.note),e=>e.child(div().flex_none().whitespace_nowrap().text_size(12).text_color(K.dim).child(b.note)))
    .when(Boolean(b.link),e=>e.child(this.link('block-link-'+b.key,b.link.label,(_e,cx)=>this.show(b.link.open,cx)))))
   .when(b.wide,e=>e.child(this.usage(b)))
   .when(!b.wide,e=>e.child(v_flex().id('block-rows-'+b.key).flex_1().min_h(0).overflow_y_scrollbar().children(b.rows.map(r=>row(b,r)))));
  return h_flex().id('page-blocks').flex_1().min_h(0).gap(12).items_stretch().children(list.map(block));
 }
 // ---- A request, answered in the column on the right in place of « Right now » (screens 03, 15, 17, 19 and 20): what
 // is asked, its choices with the one recommended first and what each one brings, the tickets concerned. A click on a
 // choice sends the answer by the action of the Inbox (look.js), once; a failure is said here and leaves the request
 // open. « Answer differently… » opens Pilot with the question (decision 35).
 send(m,a,o,cx) {
  const item=a.item;
  if(!canAnswer(this,item))return;
  this.chosen={id:item.id,key:o.key};
  const after=async(_cx,made)=>{
   this.said=[saidOf(item,o,made),...this.said.filter(x=>x.id!==item.id)];
   // What the answer changed is read at once; the column goes to the next request that waits, else to the decision as
   // the engine lists it, else back to « Right now ».
   try{const fresh=await api(MOD,'mission-read',{mission:m.id});if(fresh?.mission?.id===m.id&&this.storyOf===m.id){this.story=fresh;this.recap=pageRecap(this.recap,m.id,fresh);}}catch{}
   const left=pageAsks(withoutSent(shared(KEYS.inbox),this.sent),m).filter(i=>i.id!==item.id),kept=((this.storyOf===m.id?this.story?.decisions:null)||[]).find(d=>d?.item===item.id);
   if(this.open?.t==='ask'&&this.open.id===item.id)this.open=left.length?{t:'ask',id:left[0].id}:kept?{t:'decision',id:kept.id}:null;
  };
  if(o.send.command==='inbox-delegate')delegateRequest(this,MOD,item,cx,after);
  else if(o.send.command==='mockup-pick')pickMockup(this,MOD,m,o.send,item,cx,after);
  else answerRequest(this,MOD,item,o.send.text,cx,after);
 }
 request(m,asks,a) {
  const A=P.answer,free=!a.busy,label=text=>div().flex_none().mt(14).mb(5).text_size(11).font_weight(600).text_color(K.dim).child(text.toUpperCase());
  const btn=(id,sign,name,fn)=>h_flex().id(id).flex_none().w(30).h(30).rounded(8).border_1().border_color(K.ctl).items_center().justify_center().text_size(14).text_color('#D6DAE6').cursor_pointer().hover(s=>s.border_color(K.dim)).accessibility_label(name).on_click(fn).child(sign);
  const pilot=(_e,cx)=>openRequest(this,MOD,a.item,cx),go=o=>(_e,cx)=>this.send(m,a,o,cx);
  // The small button of a choice: green for the one recommended.
  const small=(o,pri)=>{let el=h_flex().flex_none().h(28).px(10).rounded(9).items_center().justify_center().border_1().whitespace_nowrap().text_size(12.5).font_weight(pri?600:500).border_color(pri?'#2E8F6C':K.ctl).text_color(pri?'#5DE3B8':'#D6DAE6');if(pri)el=el.bg('#163028');return el.child(o.button);};
  const reco=()=>h_flex().flex_none().h(16).px(5).rounded(4).items_center().bg('#5DE3B8').text_color('#0E1A16').text_size(10.5).font_weight(700).child(A.recommended.toUpperCase());
  // A choice: its name, « recommended », what it brings (or the picture of a variant of a mockup), and « Choose ».
  const opt=o=>{
   let el=h_flex().id('ask-opt-'+o.key).flex_none().w_full().mt(8).py(11).px(12).gap(12).items_center().rounded(10).border_1().border_color(o.recommended?'#2E8F6C':K.ctl).text_size(14);
   if(o.recommended)el=el.bg('#132823');
   if(free)el=el.cursor_pointer().hover(s=>o.recommended?s.border_color(K.done):s.border_color(K.dim).bg('#20242F')).on_click(go(o));
   else if(a.chosen!==o.key)el=el.opacity(0.45);
   const wide=230;
   return el.child(v_flex().flex_1().min_w(0)
     .child(h_flex().flex_wrap().items_center().gap(6).child(div().font_weight(600).text_color(K.white).child(o.label)).when(o.recommended,e=>e.child(reco())))
     .when(Boolean(o.image),e=>e.child(div().flex_none().mt(6).w(wide).rounded(6).overflow_hidden().border_1().border_color(K.line).child(image(o.image.path).w(wide).h(Math.round(wide*(o.image.height||5)/(o.image.width||8))))))
     .when(Boolean(o.detail),e=>e.child(div().mt(2).text_size(12.5).line_height(1.4).text_color(K.sec).child(o.detail))))
    .child(small(o,o.recommended));
  };
  // A suggestion is accepted or declined: two buttons, as the mockup draws them.
  const big=o=>{let el=h_flex().id('ask-opt-'+o.key).flex_none().h(34).px(14).rounded(9).items_center().justify_center().border_1().whitespace_nowrap().text_size(13.5).font_weight(o.primary?600:500).border_color(o.primary?'#2E8F6C':K.ctl).text_color(o.primary?'#5DE3B8':'#D6DAE6');
   if(o.primary)el=el.bg('#163028');
   if(free)el=el.cursor_pointer().hover(s=>s.border_color(o.primary?K.done:K.sep)).on_click(go(o));else if(a.chosen!==o.key)el=el.opacity(0.45);
   return el.child(a.chosen===o.key?o.button:o.label);};
  const kit=a.view?(m.mockups||[]).find(k=>k.id===a.view.mockup):null;
  // The foot holds its sentence on two lines when it takes them, as the mockup does (screen 17).
  let foot=h_flex().id('ask-foot').flex_none().min_h(40).py(4).px(16).items_center().border_t_1().border_color(K.line).text_size(12).line_height(1.35).text_color(K.faint);
  if(a.pilotFoot)foot=foot.cursor_pointer().hover(s=>s.text_color(K.sec)).on_click(pilot);
  return v_flex().id('page-ask').flex_none().w(SIDE).h_full().min_h(0).rounded(12).bg(K.card).border_1().border_color(K.line).overflow_hidden()
   .child(h_flex().flex_none().h(48).px(16).gap(8).items_center().border_b_1().border_color(K.line)
    .child(div().flex_1().min_w(0).truncate().text_size(12).font_weight(600).text_color(K.dim).child(a.kicker.toUpperCase()))
    .when(a.nav,e=>e.child(btn('ask-before',P.detail.before,A.previous,(_e,cx)=>this.show({t:'ask',id:askStep(asks,a.id,-1)},cx))).child(btn('ask-after',P.detail.after,A.next,(_e,cx)=>this.show({t:'ask',id:askStep(asks,a.id,1)},cx))))
    .child(btn('ask-close',P.sheet.shut,P.sheet.close,(_e,cx)=>{this.open=null;cx.notify();})))
   .child(v_flex().id('page-ask-body-'+a.id).flex_1().min_h(0).p(16).overflow_y_scrollbar()
    .child(div().id('ask-title').flex_none().text_size(17).font_weight(600).line_height(1.3).text_color(K.white).child(a.title))
    .children(a.texts.map((text,n)=>div().id('ask-text-'+n).flex_none().mt(8).text_size(14).line_height(1.5).text_color(K.sec).child(text)))
    .when(Boolean(a.when),e=>e.child(div().id('ask-when').flex_none().mt(a.texts.length?2:8).text_size(14).line_height(1.5).text_color(K.dim).child(a.when)))
    .when(Boolean(a.command),e=>e.child(div().flex_none().mt(10).text_size(13).text_color(K.dim).child(a.command?.label||'')).child(div().id('ask-command').flex_none().mt(5).px(12).py(9).rounded(9).bg(K.app).border_1().border_color(K.line).font_family(MONO).text_size(12.5).text_color(K.text).child(a.command?.text||'')))
    .when(Boolean(kit),e=>e.child(h_flex().flex_none().mt(10).child(this.link('ask-view',a.view?.label||'',()=>openMockup(m,kit)))))
    .when(a.layout==='rows',e=>e.child(v_flex().id('ask-options').flex_none().children(a.options.map(opt))))
    .when(a.layout==='buttons',e=>e.child(h_flex().id('ask-options').flex_none().flex_wrap().gap(8).mt(14).children(a.options.map(big))))
    .when(Boolean(a.error),e=>e.child(div().id('ask-error').flex_none().mt(10).px(12).py(9).rounded(9).bg('#2C1818').border_1().border_color('#8A4A4A').text_size(13).line_height(1.45).text_color(K.red).child(a.error)))
    .when(Boolean(a.field),e=>e.child(h_flex().id('ask-field').flex_none().h(38).mt(8).px(12).items_center().rounded(8).bg('#111316').border_1().border_color('#3A4049').text_size(13.5).text_color('#7C838E').cursor_pointer().hover(s=>s.border_color(K.dim)).on_click(pilot).child(this.opening===a.id?P.pilotStarting:a.field||'')))
    .when(a.tickets.length>0,e=>e.child(label(a.ticketsLabel)).child(h_flex().id('ask-tickets').flex_none().flex_wrap().gap_y(5).children(a.tickets.map(id=>this.pill(id,'ask-go'))))))
   .when(Boolean(a.foot),e=>e.child(foot.child(div().flex_1().min_w(0).child(a.foot))));
 }
 // ---- A sheet, in the column on the right in place of « Right now »: its name and a button to close it, then its
 // parts in order, as pageSheet gives them.
 sheet(m,s) {
  const label=text=>div().flex_none().mt(14).mb(5).text_size(11).font_weight(600).text_color(K.dim).child(text.toUpperCase());
  const part=(p,n)=>{
   const first=n===0;
   if(p.kind==='title')return div().id('sheet-title-'+n).flex_none().mt(first?0:6).text_size(17).font_weight(600).line_height(1.3).text_color(K.white).child(p.text);
   if(p.kind==='text')return div().id('sheet-text-'+n).flex_none().mt(first?0:p.small?12:8).text_size(p.small?13:14).line_height(1.5).text_color(p.small?K.dim:p.dim?K.sec:K.text).child(p.text);
   if(p.kind==='label')return label(p.text);
   if(p.kind==='box')return div().id('sheet-box-'+n).flex_none().px(12).py(10).rounded(9).bg(K.app).border_1().border_color(K.line).text_size(14).line_height(1.5).text_color(K.text).child(p.text);
   if(p.kind==='pairs')return v_flex().id('sheet-pairs-'+n).flex_none().mt(14).gap(9).children(p.rows.map(([name,value])=>h_flex().flex_none().items_start().min_w(0).text_size(13.5).child(div().flex_none().w(104).text_size(13).text_color(K.dim).child(name)).child(div().flex_1().min_w(0).text_color(K.text).child(value))));
   if(p.kind==='chips')return h_flex().id('sheet-chips-'+n).flex_none().flex_wrap().gap(6).mt(10).children(p.chips.map(c=>this.chip(c)));
   if(p.kind==='tickets')return h_flex().id('sheet-tickets-'+n).flex_none().flex_wrap().gap_y(5).children(p.ids.map(id=>this.pill(id,'sheet-go-'+n)));
   if(p.kind==='items')return v_flex().id('sheet-items-'+n).flex_none().mt(p.tight?0:12).children(p.items.map((x,i)=>h_flex().id('sheet-item-'+n+'-'+i).flex_none().items_start().gap(10).py(10).text_size(13.5).when(i>0,e=>e.border_t_1().border_color(K.line)).when(p.tight&&i===0,e=>e.pt(2))
    .child(this.disc(x.sign,x.tone))
    .child(v_flex().flex_1().min_w(0).child(div().text_color(K.text).child(x.title)).when(Boolean(x.sub),e=>e.child(div().mt(2).text_size(12.5).text_color(K.dim).child(x.sub)))
     .when(x.tickets.length>0,e=>e.child(h_flex().flex_none().flex_wrap().gap_y(5).mt(6).children(x.tickets.map(id=>this.pill(id,'sheet-item-go-'+n+'-'+i))))))));
   if(p.kind==='rows')return v_flex().id('sheet-rows-'+n).flex_none().children(p.rows.map((r,i)=>h_flex().id('sheet-row-'+n+'-'+i).flex_none().items_start().gap(8).py(5).text_size(13).text_color(K.sec).child(div().flex_none().w(p.wide?92:52).font_family(MONO).text_size(12).text_color(K.dim).child(r.at)).child(div().flex_1().min_w(0).child(r.text))));
   if(p.kind==='bullets')return v_flex().id('sheet-bullets-'+n).flex_none().children(p.items.map((line,i)=>h_flex().id('sheet-bullet-'+n+'-'+i).flex_none().items_start().gap(8).my(3).text_size(14).line_height(1.45).text_color(K.text).child(div().flex_none().w(p.ordered?18:10).text_color(K.sec).child(p.ordered?(i+1)+'.':'•')).child(div().flex_1().min_w(0).child(line))));
   if(p.kind==='link')return h_flex().id('sheet-link-'+n).flex_none().mt(first?0:10).child(this.link('sheet-link-go-'+n,p.label,(_e,cx)=>this.act(m,p.act,cx)));
   if(p.kind==='action')return h_flex().id('sheet-action-'+n).flex_none().mt(14).child(h_flex().id('sheet-action-go-'+n).flex_none().h(34).px(14).rounded(9).items_center().justify_center().border_1().border_color('#2E8F6C').bg('#163028').text_color('#5DE3B8').text_size(13.5).font_weight(600).whitespace_nowrap().when(!p.busy,e=>e.cursor_pointer().hover(h=>h.border_color(K.done)).on_click((_e,cx)=>this.act(m,p.act,cx))).when(Boolean(p.busy),e=>e.opacity(0.6)).child(p.label));
   return div().h(0);
  };
  return v_flex().id('page-sheet').flex_none().w(SIDE).h_full().min_h(0).rounded(12).bg(K.card).border_1().border_color(K.line).overflow_hidden()
   .child(h_flex().flex_none().h(48).px(16).gap(8).items_center().border_b_1().border_color(K.line)
    .child(div().flex_1().min_w(0).truncate().text_size(12).font_weight(600).text_color(K.dim).child(s.kicker.toUpperCase()))
    .child(h_flex().id('sheet-close').flex_none().w(30).h(30).rounded(8).border_1().border_color(K.ctl).items_center().justify_center().text_size(14).text_color('#D6DAE6').cursor_pointer().hover(e=>e.border_color(K.dim)).accessibility_label(P.sheet.close).on_click((_e,cx)=>{this.open=null;cx.notify();}).child(P.sheet.shut)))
   .child(v_flex().id('page-sheet-body-'+s.key.replace(':','-')).flex_1().min_h(0).p(16).overflow_y_scrollbar().children(s.parts.map(part)))
   .when(Boolean(s.foot),e=>e.child(h_flex().flex_none().h(40).px(16).items_center().border_t_1().border_color(K.line).text_size(12).text_color(K.faint).child(s.foot)));
 }
 // ---- The details of a ticket, in the column on the right, in place of « Right now »: the next ticket and the one
 // before open without closing it; what the ticket waits for and unblocks opens at a click.
 detail(m,tickets,d) {
  const label=text=>div().flex_none().mt(14).mb(5).text_size(11).font_weight(600).text_color(K.dim).child(text.toUpperCase()),para=(text,size=14)=>div().flex_none().text_size(size).line_height(1.5).text_color(K.text).child(text);
  const btn=(id,sign,name,fn)=>h_flex().id(id).flex_none().w(30).h(30).rounded(8).border_1().border_color(K.ctl).items_center().justify_center().text_size(14).text_color('#D6DAE6').cursor_pointer().hover(s=>s.border_color(K.dim)).accessibility_label(name).on_click(fn).child(sign);
  const chip=c=>this.chip(c);
  // The tab shown: the one chosen when this ticket has it, else its summary.
  const open=d.tabs.includes(this.tab)?this.tab:'summary';
  const tab=key=>{const on=open===key;return h_flex().id('detail-tab-'+key).flex_none().h(34).px(9).items_center().border_b_2().border_color(on?'#6E5BD6':K.card).text_size(13.5).font_weight(on?600:400).text_color(on?K.white:K.dim).whitespace_nowrap().cursor_pointer().hover(s=>s.text_color('#D6DAE6')).on_click((_e,cx)=>{this.tab=key;cx.notify();}).child(P.detail[key]);};
  const pill=id=>h_flex().id('detail-go-'+id).flex_none().h(22).px(7).mr(5).rounded(5).items_center().border_1().border_color('#4A52A8').bg('#1C2040').text_color('#C9D0FF').font_family(MONO).text_size(12).cursor_pointer().hover(s=>s.border_color(K.link)).on_click((_e,cx)=>this.pick(id,cx)).child(id);
  const key=text=>div().flex_none().w(104).text_size(13).text_color(K.dim).child(text),row=(name,value)=>h_flex().flex_none().items_center().min_w(0).text_size(13.5).child(key(name)).child(value);
  const said=text=>div().flex_1().min_w(0).truncate().child(text),rel=r=>h_flex().flex_1().min_w(0).flex_wrap().items_center().children(r.ids.map(pill)).when(Boolean(r.none),e=>e.child(div().text_color(K.dim).child(r.none)));
  const summary=()=>v_flex().flex_none()
   .when(Boolean(d.what),e=>e.child(label(P.detail.what)).child(para(d.what)))
   .when(Boolean(d.expected),e=>e.child(label(P.detail.expected)).child(div().flex_none().px(12).py(10).rounded(9).bg(K.app).border_1().border_color(K.line).text_size(14).line_height(1.5).text_color(K.text).child(d.expected||'')))
   .child(v_flex().flex_none().mt(14).gap(9)
    .when(Boolean(d.dev),e=>e.child(row(P.detail.dev,said(d.dev)))).when(Boolean(d.reviewer),e=>e.child(row(P.detail.reviewer,said(d.reviewer))))
    .when(Boolean(d.waits),e=>e.child(row(P.detail.waits,rel(d.waits)))).when(Boolean(d.unblocks),e=>e.child(row(P.detail.unblocks,rel(d.unblocks))))
    .when(Boolean(d.delivery),e=>e.child(row(P.detail.delivery,said(d.delivery)))));
  const step=(s,n)=>{const [bg,ink]=ORD[s.tone]||[K.bar,K.sec];return h_flex().id('step-'+n).flex_none().items_start().gap(10).py(8).text_size(13.5).when(n>0,e=>e.border_t_1().border_color(K.line))
   .child(h_flex().flex_none().min_w(22).h(22).px(4).rounded(11).items_center().justify_center().bg(bg).text_color(ink).text_size(12).child(s.sign))
   .child(v_flex().flex_1().min_w(0).child(div().text_color(K.text).child(s.text)).when(Boolean(s.sub),e=>e.child(div().mt(2).text_size(12.5).text_color(K.dim).child(s.sub))))
   // Its time at the right, as the mockup (source/pv.css, .tm), when it is known (M9 review).
   .when(Boolean(s.time),e=>e.child(div().flex_none().pt(2).whitespace_nowrap().font_family(MONO).text_size(12).text_color('#8C93A6').child(s.time||'')));};
  const bullet=(text,n,mark='•',id='remark')=>h_flex().id(id+'-'+n).flex_none().items_start().gap(8).my(3).text_size(13.5).line_height(1.45).text_color(K.text).child(div().flex_none().child(mark)).child(div().flex_1().min_w(0).child(text));
  // What the plan says of the ticket beyond its summary, each under its tab, drawn only when the plan carries it.
  const technical=()=>v_flex().flex_none().child(label(P.detail.technicalDetails)).child(v_flex().flex_none().children(d.technical.map((text,n)=>bullet(text,n,'•','technical'))));
  const criteria=()=>v_flex().flex_none()
   .when(d.tests.length>0,e=>e.child(label(P.detail.testsPlanned)).child(v_flex().flex_none().children(d.tests.map((text,n)=>bullet(text,n,'•','planned')))))
   .when(d.criteria.length>0,e=>e.child(label(P.detail.acceptance)).child(v_flex().flex_none().children(d.criteria.map((text,n)=>bullet(text,n,(n+1)+'.','criterion')))));
  const entry=(f,n)=>v_flex().id('full-'+n).flex_none().gap(2).mt(n?10:6)
   .child(h_flex().flex_wrap().items_center().gap(8).child(div().text_size(12.5).font_weight(600).text_color(K.sec).child(f.title)).when(f.facts.length>0,e=>e.child(div().font_family(MONO).text_size(11.5).text_color(K.faint).child(f.facts.join(' · ')))))
   .when(Boolean(f.text),e=>e.child(textBlocks(f.text)));
  const told=t=>t.empty?v_flex().flex_none().child(div().mt(14).text_size(14).line_height(1.5).text_color(K.dim).child(t.empty)):v_flex().flex_none()
   .child(label(t.title)).child(v_flex().flex_none().children(t.steps.map(step)))
   .when(t.remarks.length>0,e=>e.child(label(P.detail.remarks)).child(v_flex().flex_none().children(t.remarks.map(bullet))))
   .when(t.commits.length>0,e=>e.child(label(P.detail.commits)).child(v_flex().flex_none().children(t.commits.map((c,n)=>h_flex().id('commit-'+n).flex_none().items_center().py(4).gap(8).text_size(13).text_color(K.sec).child(div().flex_none().w(64).font_family(MONO).text_size(12).text_color(K.dim).child(c.hash)).when(Boolean(c.text),x=>x.child(div().flex_1().min_w(0).truncate().child(c.text)))))))
   .when(Boolean(t.tests),e=>e.child(label(P.detail.testsRun)).child(para(t.tests||'',13.5)))
   // « Token usage · this ticket » (screen 10, M13): one line in mono, as the mockup (.pp2.mono, 13 px).
   .when(Boolean(t.tokens),e=>e.child(label(t.tokens?.title||'')).child(div().flex_none().font_family(MONO).text_size(13).line_height(1.5).text_color(K.text).child(t.tokens?.text||'')))
   // What the screen of before showed of a ticket, kept here: what was done, its reviews, and the reports in full.
   .when(Boolean(t.done),e=>e.child(label(W.detail.done)).child(para(t.done||'',13.5)))
   .when(t.reviews.length>0,e=>e.child(label(W.detail.reviews)).child(v_flex().flex_none().gap(10).children(t.reviews.map((r,n)=>v_flex().id('review-'+n).flex_none().gap(2)
    .child(h_flex().items_center().gap(8).text_size(13.5).child(div().font_weight(600).text_color(K.text).child(r.title)).when(Boolean(r.by),x=>x.child(div().text_size(12.5).text_color(K.dim).child(r.by))))
    .when(Boolean(r.text),x=>x.child(div().text_size(13.5).line_height(1.45).text_color(K.sec).child(r.text)))))))
   .when(t.full.length>0,e=>e.child(h_flex().id('detail-full').flex_none().mt(14).gap(6).cursor_pointer().text_size(13).text_color(K.link).hover(s=>s.text_color('#D6DAFF')).on_click((_e,cx)=>{this.full=!this.full;cx.notify();}).child(this.full?P.detail.fullShut:P.detail.fullOpen).child(this.full?W.detail.hide:W.detail.full))
    .when(this.full,x=>x.child(v_flex().flex_none().children(t.full.map(entry)))));
  return v_flex().id('page-detail').flex_none().w(SIDE).h_full().min_h(0).rounded(12).bg(K.card).border_1().border_color(K.line).overflow_hidden()
   .child(h_flex().flex_none().h(48).px(16).gap(8).items_center().border_b_1().border_color(K.line)
    .child(div().flex_none().whitespace_nowrap().text_size(12).font_weight(600).text_color(K.dim).child(d.position.toUpperCase())).child(div().flex_1())
    .child(btn('detail-before',P.detail.before,P.detail.previous,(_e,cx)=>this.pick(lineStep(tickets,d.id,-1),cx)))
    .child(btn('detail-after',P.detail.after,P.detail.next,(_e,cx)=>this.pick(lineStep(tickets,d.id,1),cx)))
    .child(btn('detail-close',P.detail.shut,P.detail.close,(_e,cx)=>this.pick(null,cx))))
   .child(v_flex().id('page-detail-body').flex_1().min_h(0).overflow_y_scrollbar()
    .child(v_flex().flex_none().px(16).pt(16)
     .child(div().flex_none().font_family(MONO).text_size(13).text_color(K.link).child(d.id))
     .child(div().flex_none().mt(6).text_size(17).font_weight(600).line_height(1.3).text_color(K.white).child(d.title))
     .when(d.chips.length>0,e=>e.child(h_flex().flex_none().flex_wrap().gap(6).mt(10).children(d.chips.map(chip)))))
    .child(h_flex().flex_none().mt(14).px(16).gap(4).border_b_1().border_color(K.line).children(d.tabs.map(tab)))
    .child(v_flex().flex_none().px(16).pb(16).child(open==='timeline'?told(d.timeline):open==='technical'?technical():open==='criteria'?criteria():summary())));
 }
 // Who works: a badge, the name, its tool in small, what it does, and its tab.
 who(m,lead,w) {
  const [bg,line,ink]=BADGE[w.kind]||BADGE.dev;
  let badge=h_flex().flex_none().min_w(20).h(20).px(4).rounded(10).items_center().justify_center().border(1.5).border_color(line).bg(bg).text_color(ink).text_size(10.5).font_weight(700).child(w.badge);
  if(w.kind==='review')badge=badge.border_dashed();
  let row=h_flex().id('who-'+w.key).flex_none().items_center().gap(10).px(12).py(9).rounded(9).bg(K.app).border_1().border_color(w.warn?'#8A6B1F':K.line);
  if(w.dim&&!w.warn)row=row.opacity(0.6);
  return row.child(badge)
   .child(v_flex().flex_1().min_w(0)
    .child(h_flex().items_baseline().gap(6).min_w(0).child(div().flex_none().font_weight(600).text_color(K.white).child(w.name)).when(Boolean(w.tool),e=>e.child(div().truncate().text_size(12).text_color(K.dim).child(w.tool))))
    .child(div().truncate().text_size(12.5).text_color(w.warn?K.amber:K.dim).child(w.what)))
   .when(Boolean(w.address),e=>e.child(div().id('who-tab-'+w.key).flex_none().cursor_pointer().text_size(12.5).text_color(K.link).hover(s=>s.text_color('#D6DAFF')).on_click(()=>this.openTab(m,lead,w.address)).child(P.side.openTab)));
 }
 // « Since yesterday, 7:10 pm » (screen 18): what happened since the last visit, one button per line. The one that
 // waits on the user is amber; a click opens its request, or the details of its ticket.
 sinceRow(m,r) {
  const you=r.tone==='you';
  return h_flex().id(r.key).flex_none().w_full().items_center().gap(10).px(12).py(9).rounded(9).border_1().border_color(you?'#6B5218':K.line).bg(you?'#221D12':K.app).text_size(13.5).text_color(you?'#F6E2B0':K.text)
   .cursor_pointer().hover(s=>s.border_color(you?'#F1C25B':K.sep)).on_click((_e,cx)=>this.act(m,r.act,cx))
   .child(div().flex_none().child(r.sign))
   .child(v_flex().flex_1().min_w(0).child(div().font_weight(700).text_color(K.white).child(r.text)).when(Boolean(r.sub),e=>e.child(div().text_size(12.5).text_color(you?'#D9C48F':K.dim).child(r.sub))));
 }
 // With two devs, what the band under the line told goes here (screen 41): the steps of the ticket in hand and the time
 // of each. Then the tokens of the issue, agent by agent, when the engine counts them (one dev or two).
 current(c) {
  return v_flex().id('page-current-'+c.id).flex_none().children(c.steps.map((s,n)=>h_flex().id('current-'+c.id+'-'+n).flex_none().items_start().gap(10).pt(n?8:2).pb(8).text_size(13.5).when(n>0,e=>e.border_t_1().border_color(K.line))
   .child(this.disc(s.sign,s.tone))
   .child(v_flex().flex_1().min_w(0).child(div().text_color(K.text).child(s.text)).when(Boolean(s.sub),e=>e.child(div().mt(2).text_size(12.5).text_color(K.dim).child(s.sub))))
   .when(Boolean(s.time),e=>e.child(div().flex_none().pt(2).whitespace_nowrap().font_family(MONO).text_size(12).text_color(K.dim).child(s.time)))));
 }
 // The token usage at the end, on the width of two blocks (Claude Design « pre-close »): the totals in large, then a line
 // by agent and a line by ticket, the costliest first, each with its bar, what came in and what went out. A ticket opens
 // its details. The bars stay in blue-greys: the colours of the states say other things.
 usage(b) {
  const u=b.usage,E=P.end,mono=(t,size=11.5,ink=K.dim)=>div().flex_none().whitespace_nowrap().font_family(MONO).text_size(size).text_color(ink).child(t);
  if(!u)return div().px(8).text_size(13).text_color(K.faint).child('—');
  const bar=(part,tone)=>div().flex_1().min_w(0).h(6).rounded(3).bg('#232838').child(div().w(String(Math.max(2,Math.round(100*part)))+'%').h(6).rounded(3).bg(tone));
  const line=(id,name,x,tone,blue,pick)=>{let el=h_flex().id(id).flex_none().items_center().gap(8).h(24).text_size(12.5).text_color(K.sec)
    .child((blue?div().font_family(MONO):div()).flex_none().w(78).truncate().text_color(blue?K.link:K.sec).child(name)).child(bar(x.part,tone)).child(div().flex_none().w(48).child(mono(x.inText,11.5,K.text))).child(div().flex_none().w(40).child(mono(x.outText)));
   return pick?el.cursor_pointer().hover(s=>s.bg('#20242F')).on_click(pick):el;};
  const TONES=['#5C6378','#7B8CFF','#4A52A8','#A9B4FF'],head=t=>div().flex_none().mb(6).text_size(11).font_weight(600).text_color(K.dim).child(t.toUpperCase());
  return h_flex().id('end-usage').flex_1().min_h(0).gap(16).px(8).pt(4).items_start()
   .child(v_flex().id('end-usage-totals').flex_none().w(140).pr(14).border_r_1().border_color(K.line).gap(2)
    .child(mono(u.in,22,K.white)).child(div().text_size(12).text_color(K.dim).mb(6).child(E.tokensIn))
    .child(mono(u.out,22,K.white)).child(div().text_size(12).text_color(K.dim).mb(6).child(E.tokensOut))
    .when(Boolean(u.avg),e=>e.child(mono(u.avg,15,K.text)).child(div().text_size(11.5).line_height(1.3).text_color(K.dim).child(E.perTicket))))
   .child(v_flex().id('end-usage-agents').flex_1().min_w(0).child(head(E.byAgent)).children(u.agents.map((x,n)=>line('end-agent-'+n,x.name,x,TONES[n%TONES.length],false,null))))
   .child(v_flex().id('end-usage-tickets').flex_1().min_w(0).child(head(E.byTicket)).child(v_flex().id('end-usage-ticket-rows').flex_none().max_h(190).overflow_y_scrollbar()
    .children(u.tickets.map(x=>line('end-ticket-'+x.id,x.id,x,'#7B8CFF',true,(_e,cx)=>this.pick(x.id,cx))))));
 }
 // The column on the right before the closure and once closed: what was done (Claude Design « pre-close »).
 summary(m,sm) {
  const label=t=>div().flex_none().mt(16).mb(6).text_size(11).font_weight(600).text_color(K.dim).child(t.toUpperCase());
  const TONE={ok:['#163028','#3DD6B0'],you:['#3A2E12','#F2C14E'],wait:['#262B3A','#C9CFDB']};
  return v_flex().id('page-summary').flex_none().w(SIDE).h_full().min_h(0).rounded(12).bg(K.card).border_1().border_color(K.line).overflow_hidden()
   .child(h_flex().flex_none().h(48).px(16).items_center().border_b_1().border_color(K.line).child(div().text_size(12).font_weight(600).text_color(K.dim).child(sm.head.toUpperCase())))
   .child(v_flex().id('page-summary-body').flex_1().min_h(0).p(16).overflow_y_scrollbar()
    .when(Boolean(sm.title),e=>e.child(div().text_size(17).font_weight(600).line_height(1.3).text_color(K.white).child(sm.title)))
    .child(div().mt(6).text_size(13.5).line_height(1.5).text_color(K.sec).child(sm.text))
    .child(label(P.end.checkedTitle))
    .children(sm.checked.map(c=>{const [bg,ink]=TONE[c.tone]||TONE.wait;return h_flex().id('checked-'+c.key).flex_none().items_start().gap(10).py(7).border_b_1().border_color(K.line)
     .child(h_flex().flex_none().w(22).h(22).rounded(11).items_center().justify_center().bg(bg).text_color(ink).text_size(11).font_weight(700).child(c.icon))
     .child(v_flex().flex_1().min_w(0).child(div().text_size(13.5).font_weight(600).text_color(K.text).child(c.title)).child(div().text_size(12.5).text_color(K.dim).child(c.sub)));}))
    .child(label(P.end.ticketsTitle))
    .children(sm.tickets.map(t=>h_flex().id('sum-ticket-'+t.id).flex_none().items_center().gap(10).h(30).rounded(6).px(4).cursor_pointer().hover(s=>s.bg('#20242F')).on_click((_e,cx)=>this.pick(t.id,cx))
     .child(div().flex_none().w(64).font_family(MONO).text_size(12).text_color(K.link).child(t.id)).child(div().flex_1().min_w(0).truncate().text_size(13).text_color(K.sec).child(t.title))
     .child(div().flex_none().font_family(MONO).text_size(11.5).text_color(K.dim).child(t.time)))))
   .child(h_flex().flex_none().h(40).px(16).items_center().border_t_1().border_color(K.line).text_size(12).text_color(K.dim).child(sm.foot));
 }
 // The same card, compact, for the end block under the plan: the totals, then a line by role, its bar and what came in.
 tokensCompact(t) {
  const big=(value,word)=>h_flex().flex_none().items_baseline().child(div().mr(3).text_size(18).font_weight(600).text_color(K.white).child(value)).child(word);
  return v_flex().id('end-tokens').flex_none().py(10).px(12).rounded(9).bg(K.app).border_1().border_color(K.line)
   .child(h_flex().flex_none().items_baseline().gap(16).mb(6).text_size(13).text_color(K.dim).child(big(t.in,t.inWord)).child(big(t.out,t.outWord)))
   .children(t.rows.map((r,n)=>h_flex().id('end-tokens-'+n).flex_none().items_center().gap(8).py(4).text_size(12.5).text_color(K.sec)
    .child(div().flex_none().w(78).truncate().child(r.name))
    .child(r.part===null?div().flex_1().h(6):div().flex_1().min_w(0).h(6).rounded(3).bg(K.bar).child(div().w(String(Math.max(2,Math.round(100*r.part)))+'%').h(6).rounded(3).bg(K.fill)))
    .child(div().flex_none().whitespace_nowrap().font_family(MONO).text_size(11.5).text_color(K.dim).child(r.in))));
 }
 tokens(t) {
  const big=(value,word)=>h_flex().flex_none().items_baseline().child(div().mr(3).text_size(18).font_weight(600).text_color(K.white).child(value)).child(word),mono=text=>h_flex().flex_1().min_w(0).justify_end().whitespace_nowrap().font_family(MONO).text_size(11.5).text_color(K.dim).child(text);
  return v_flex().id('page-tokens').flex_none().py(10).px(12).rounded(9).bg(K.app).border_1().border_color(K.line)
   .child(h_flex().flex_none().items_baseline().gap(16).mb(6).text_size(13).text_color(K.dim).child(big(t.in,t.inWord)).child(big(t.out,t.outWord)).child(div().flex_1()).child(div().flex_none().whitespace_nowrap().text_size(11.5).child(t.note)))
   .children(t.rows.map((r,n)=>h_flex().id('tokens-'+n).flex_none().items_center().gap(8).py(4).text_size(12.5).text_color(K.sec)
    .child(div().flex_none().w(78).truncate().child(r.name))
    // A line the engine cannot read has no bar (M13): an empty track would read as nothing used.
    .child(r.part===null?div().flex_none().w(112).h(6):div().flex_none().w(112).h(6).rounded(3).bg(K.bar).child(div().w(Math.max(2,Math.round(110*r.part))).h(6).rounded(3).bg(K.fill)))
    .child(mono(r.in)).child(mono(r.out))));
 }
 side(m,project,lead,workers,story,asks,tickets,more=null) {
  const since=pageSince({overnight:recapShown(this.recap?.mission===m.id?this.recap:null),asks,tickets});
  // What this render drew of the recap: what the acknowledgement may say was seen (ack), from a reading of this showing.
  if(!this.stale&&story)this.drawn={mission:m.id,visit:story.visit??null,drawn:since?.rows||[]};
  const label=(text,first=false)=>div().flex_none().mt(first?0:14).mb(5).text_size(11).font_weight(600).text_color(K.dim).child(text.toUpperCase());
  const lines=pageActivity(story?.journal||m.journal,pageStory(m.tickets||[],story?.reports||[],story?.qa)),refs=pageRefs(m,this.deskOf===m.id?this.desk?.repositories:null,project);
  const key=text=>div().flex_none().w(104).text_size(13).text_color(K.dim).child(text),ref=(name,value)=>h_flex().flex_none().items_center().child(key(name)).child(value);
  const mono=text=>div().min_w(0).truncate().font_family(MONO).text_size(12.5).text_color(K.text).child(text);
  return v_flex().id('page-side').flex_none().w(SIDE).h_full().min_h(0).rounded(12).bg(K.card).border_1().border_color(K.line).overflow_hidden()
   .child(h_flex().flex_none().h(48).px(16).items_center().border_b_1().border_color(K.line).child(div().text_size(12).font_weight(600).text_color(K.dim).child(P.side.title.toUpperCase())))
   .child(v_flex().id('page-side-body').flex_1().min_h(0).p(16).overflow_y_scrollbar()
    .child(label(P.side.who,true))
    .child(v_flex().flex_none().gap(6).children(workers.map(w=>this.who(m,lead,w))))
    .children((more?.current||[]).flatMap(c=>[label(c.title),this.current(c)]))
    .when(Boolean(since),e=>e.child(label(since.title)).child(v_flex().id('page-since').flex_none().gap(6).children(since.rows.map(r=>this.sinceRow(m,r))).when(Boolean(since.note),e=>e.child(div().id('page-since-note').text_size(12.5).text_color(K.amber).child(since.note)))))
    .when(Boolean(more?.tokens),e=>e.child(label(more.tokens.title)).child(this.tokens(more.tokens)))
    .child(label(P.side.activity))
    .child(v_flex().flex_none().children(lines.map((l,n)=>h_flex().id('act-'+n).flex_none().items_start().gap(8).py(5).text_size(13).text_color(K.sec).child(div().flex_none().w(48).font_family(MONO).text_size(12).text_color(K.dim).child(l.at)).child(div().flex_1().min_w(0).child(l.text))))
     .when(!lines.length,e=>e.child(div().py(5).text_size(13).text_color(K.faint).child(P.side.noActivity))))
    .child(label(P.side.refs))
    .child(v_flex().flex_none().gap(9)
     .when(Boolean(refs.issue),e=>e.child(ref(P.refs.issue,refs.issue.url?div().id('ref-issue').cursor_pointer().text_size(13.5).text_color(K.link).hover(s=>s.text_color('#D6DAFF')).on_click((_e,cx)=>this.openUrl(refs.issue.url,cx)).child(refs.issue.label):div().text_size(13.5).text_color(K.sec).child(refs.issue.label))))
     .when(Boolean(refs.branch),e=>e.child(ref(P.refs.branch,h_flex().min_w(0).gap(7.5).child(mono(refs.branch.name)).when(Boolean(refs.branch.from),x=>x.child(div().flex_none().font_family(MONO).text_size(12.5).text_color(K.dim).child(refs.branch.from))))))
     .when(Boolean(refs.repo),e=>e.child(ref(P.refs.repo,mono(refs.repo))))
     .when(Boolean(refs.code),e=>e.child(ref(P.refs.code,h_flex().min_w(0).flex_wrap().items_center().gap(8).child(div().flex_none().text_size(13.5).text_color(K.sec).child(refs.code.state))
      .when(Boolean(refs.code.noPr),x=>x.child(div().flex_none().text_size(13).text_color(K.dim).child(refs.code.noPr)))
      .children(refs.code.prs.map(p=>div().id('ref-pr-'+p.repo).flex_none().cursor_pointer().text_size(13.5).text_color(K.link).hover(s=>s.text_color('#D6DAFF')).on_click((_e,cx)=>this.openUrl(p.url,cx)).child(p.repo+' · '+W.check.pr(p.number)))))))))
   .child(h_flex().flex_none().h(40).px(16).items_center().border_t_1().border_color(K.line).text_size(12).text_color(K.faint).child(P.side.foot));
 }
 render(_w,cx) {
  const data=snapshot(),id=shared(KEYS.mission);
  // A development just closed leaves the list of those under way: its page stays, read from the mission itself.
  const m=missionsOf(shared(KEYS.missions)).find(x=>x.id===id)||(this.storyOf===id&&this.story?.mission?this.story.mission:null);
  const root=v_flex().id('page').relative().size_full().min_h(0).min_w(0).py(14).px(20).bg(K.app).text_color(K.text).text_size(14).line_height(1.4);
  if(!m)return root;
  // The answers given here belong to the development shown: another one starts with none.
  if(this.sentOf!==m.id&&!this.answering){this.sentOf=m.id;this.sent={};this.said=[];this.failed=null;this.chosen=null;}
  // What waits: the requests of the feed, less those answered from this page; a request with a mockup is a choice of it.
  const story=this.storyOf===m.id?this.story:null,project=(data.projects||[]).find(p=>p.key===m.project)||null,lead=leadOfMission(m),live=agents(),items=withKinds(withoutSent(shared(KEYS.inbox),this.sent,this.answering),m);
  // A page opened on a request that is a ticket stopped (from another screen) shows what blocks it (screen 13).
  if(this.open?.t==='ask'&&items.some(i=>i.id===this.open.id&&i.type==='stuck'))this.open={t:'blocked',id:this.open.id,ticket:items.find(i=>i.id===this.open.id)?.ticket??null};
  // How long the dev has run on the ticket in hand: one time for « Who's working », the card, the band and the details,
  // the one the engine gives for the step before the one of the terminal.
  const hand=currentTicket(m),took=handSpan({ticket:hand,story,span:''});
  // Two devs: two lanes in the plan, a line for each in « Who's working », and what the band told in the column.
  // The rounds of the reviews the engine keeps (M9) go with each ticket: its card, its details and the band read them.
  const tickets=lineReviews(lineDrift(lineTickets(m),story),story),devs=lineLanes(tickets);
  const pause=pauseOf(story),workers=pageWorkers({mission:m,lead,agents:live,items,started:this.started,space:lead?.space||null,took,devs,pause}),tabs=pageTabs(workers,lead);
  const band=pageBand({mission:m,lead,items,qa:story?.qa||null,on:Boolean(m.on||story?.on),environment:story?.environment||null,overnight:recapShown(this.recap?.mission===m.id?this.recap:null),pause});
  // The confirmation of screen 06, for as long as the banner offers the approval it confirms; closed otherwise.
  const confirm=this.confirm&&band.button?.key==='approve'&&!band.button.disabled?pageConfirm({mission:m,lead}):null;
  if(this.confirm&&!confirm)this.confirm=false;
  // The box of the changes, for as long as the engine gives the version of the drift the sheet drew: the drift moved,
  // the box closes, and nothing is approved that it did not show.
  const reconfirm=this.reconfirm?pageReconfirm({story}):null;
  if(this.reconfirm&&reconfirm?.seen!==this.reconfirm)this.reconfirm=null;
  // The closure box while the banner offers « Close… », the reopening box while it offers « Reopen… »; closed otherwise.
  if(this.closeBox&&(this.closeBox.of!==m.id||band.button?.key!=='close'))this.closeBox=null;
  // The reason was written for one mission: another mission shown closes the box and drops it.
  if(this.reopenBox&&!reopenKept(this.reopenBox,m,band)){this.reopenBox=false;this.reason=null;}
  const closeBox=this.closeBox?pageCloseBox({mission:m,...this.closeBox}):null,reopenBox=this.reopenBox?pageReopenBox({mission:m}):null;
  // The plan: its tickets as cards, the time the dev at work has run, and the details of the ticket chosen.
  const stage=stageOf(m),waits=pageWaits(items,m),reports=story?.reports||[];
  // How long the dev of each ticket in hand has run: with two devs, each ticket by the terminal of its own dev (pageSpans).
  const {span,spans}=pageSpans({hand,tickets,workers,story,started:this.started,took});
  const cards=tickets.map(t=>lineCard(t,{stage,reports,items:waits,span:spans[t.id]||'',dev:lineDev(tickets,t),paused:pause?.state==='paused'})),ends=lineEnds({mission:m,qa:story?.qa||null,lead});
  const detail=this.sel?lineDetail({mission:m,tickets,id:this.sel,reports,items:waits,lead,span:spans[this.sel]||'',story}):null;
  // Under the line and at the bottom: the band, the three blocks, and the sheet a row or a link opened.
  // The request opened is answered there too, in place of « Right now », for as long as it waits.
  const asks=pageAsks(items,m),asked=detail?null:askShown(asks,this.open),answer=asked?pageAnswer({item:asked,mission:m,tickets,asks,canDelegate:Boolean(lead),view:this}):null;
  const strip=pageStrip({mission:m,tickets,lead,items,reports,story,span}),blocks=pageBlocks({mission:m,lead,items,story,open:detail?null:this.open,sent:this.said})||pageEnd({mission:m,story,lead});
  const sheet=!detail&&!answer&&this.open?pageSheet({mission:m,tickets,lead,story,open:this.open,requests:items,checking:this.checking}):null,covers=sheet?.covers?.length?sheet.covers:null;
  // In the column: with two devs, the steps of the ticket in hand (one dev has them in the band); the tokens of the issue
  // whenever the engine counts them, agent by agent.
  // The view of the plan: the Kanban when the user chose it and the plan offers it, the line otherwise.
  const offered=boardOffered({stage,simple:m.plan?.simple===true,count:tickets.length}),view=offered?planView(shared(KEYS.planView),offered):null;
  // Before the closure and once closed, the column says what was done (Claude Design « pre-close »).
  const summary=pageSummary({mission:m,story});
  const more={current:devs?pageCurrent({mission:m,tickets,items,reports,story,spans}):[],tokens:pageTokens({story,tickets})};
  return root
   .child(this.head(m,project,lead,tabs))
   .child(this.band(m,lead,band,cx))
   .child(h_flex().flex_1().min_h(0).gap(16).items_stretch()
    .child(v_flex().id('page-center').flex_1().min_w(0).min_h(0).overflow_hidden().gap(12).child(this.plan(m,lead,tickets,cards,ends,waits,strip,covers,devs,view,reports)).child(blocks?this.blocks(m,blocks):div().id('page-blocks').flex_1().min_h(0)))
    .child(detail?this.detail(m,tickets,detail):answer?this.request(m,asks,answer):sheet?this.sheet(m,sheet):summary?this.summary(m,summary):this.side(m,project,lead,workers,story,asks,tickets,more)))
   .when(this.menu,e=>e.child(this.menuBox(m,lead,tabs)))
   .when(Boolean(confirm),e=>e.child(this.confirmBox(m,confirm)))
   .when(Boolean(this.reconfirm&&reconfirm),e=>e.child(this.reconfirmBox(m,reconfirm)))
   .when(Boolean(closeBox),e=>e.child(this.closeBoxView(m,closeBox)))
   .when(Boolean(reopenBox),e=>e.child(this.reopenBoxView(m,reopenBox)));
 }
}
