// The look of the V4 mockup, in native components: its colours, its rows and its buttons.
import {div} from 'gpui-kit';
import {v_flex,h_flex,Scrollbar,v_virtual_list} from 'gpui-base';
import {run,setShared,shared,agents,terminals,openOverlay,closeOverlay,notify,window as appWindow} from 'herdr';
import {snapshot,api} from './kit.js';
import {poTab} from './view.js';
import {W} from './words.js';
import {KEYS,SCREENS,issueMeta,issueTone,missionProgress,pilotOf,reportBlocks,glyphOf,tintOf,leadScreen,itemKind,itemSummary,sameWords,answersInOrder} from './nav.js';
import {projectLook} from './model.js';
import {canAnswer,asShown,refusalOf} from './answers.js';
import {useWords} from './common.js';
useWords(W.errors);
export {v_flex,h_flex};
export const C={acc:'#6B6CF5',acc2:'#2A2B5E',bg:'#0F1115',panel:'#161920',card:'#1C2029',line:'#262A33',txt:'#EAEDF1',dim:'#9AA2AD',title:'#F4F6F8',sec:'#C0C6CF',faint:'#6F7883',row:'#22262C',rowOn:'#20242D',control:'#23272D',strong:'#3A4049',chip:'#2C3139',circle:'#232733',rail:'#0A0C10',tabs:'#0C0E12',red:'#FF5F57',lead:'#F472B6',lav:'#B7B8FF',ink:'#131518',clear:'#00000000',danger:'#FF8A7E'};
export const MONO='JetBrains Mono';
const TONES={review:['#D2A8FF','#5A3D8A','#261A3F'],ok:['#4DD4AE','#1F5C49','#10271F'],rev:['#7DB8FF','#26487A','#15223A'],dec:['#F1C25B','#6B5218','#2A2112'],inc:['#FF8A7E','#6E3129','#2B1715'],unk:['#9AA2AD','#30353C',null],merged:['#B7B8FF','#45468F','#24254F']};
export const DOTS={ok:'#4DD4AE',off:'#6F7883',work:'#7DB8FF',blocked:'#F1C25B',done:'#4DD4AE',idle:'#6F7883'};
// The mockup's logo is a gradient (#7B7CF7 to #5556D8); an element's background takes one colour, its middle.
export const logoFill=()=>'#6869E7';
// A control in a block that drags the window keeps its press.
export const press=el=>el.on_mouse_down('left',(_e,cx)=>cx.stop_propagation());
export const dot=(kind,size=8)=>div().w(size).h(size).rounded(size/2).flex_none().bg(DOTS[kind]||DOTS.off);
// The picto of a project in its colour, outlined and filled like the action buttons.
export function projectTile(project,size=34,glyph=18) {
  const color=projectLook(project).color;
  return h_flex().flex_none().w(size).h(size).rounded(Math.round(size/4)).border_1().border_color(color).bg(tintOf(color)).text_color(color).text_size(glyph).items_center().justify_center().child(glyphOf(project));
}
export const sq=color=>div().w(12).h(12).rounded(3).flex_none().bg(color);
export function pill(tone,label) {
  const [xj,border,bg]=TONES[tone]||TONES.unk,el=h_flex().flex_none().items_center().h(20).px(7).rounded(5).border_1().border_color(border).text_color(xj).text_size(11.5).font_weight(600).whitespace_nowrap().child(String(label));
  return bg?el.bg(bg):el;
}
// The colour of each kind of agent, as in the V3; a small tag for what an agent is, or runs on.
export const AGENT_COLORS={claude:'#D8A27E',codex:'#8FB4FF'};
export const tag=(value,color=C.sec,family=null)=>{const el=div().flex_none().px(6).py(1).rounded(4).border_1().border_color(C.strong).bg(C.control).text_size(11.5).text_color(color).whitespace_nowrap().child(String(value));return family?el.font_family(family):el;};
export const screen=()=>v_flex().size_full().min_h(0).min_w(0).bg(C.bg).text_color(C.txt).text_size(13.5).line_height(1.5).py(18).px(24).gap(12);
export const h1=value=>div().text_size(18).font_weight(600).text_color(C.title).whitespace_nowrap().child(value);
export const hd=(left,right)=>h_flex().flex_none().items_center().justify_between().gap(12).child(left).child(right);
export const dim=value=>div().flex_none().text_color(C.dim).whitespace_nowrap().child(String(value));
export const src=value=>div().flex_none().text_size(12).text_color(C.faint).child(value);
export const mono=value=>div().font_family(MONO).text_size(12.5).text_color(C.dim).whitespace_nowrap().child(String(value??'—'));
export const fault=value=>div().flex_none().text_size(12).text_color(C.danger).child(String(value));
export const list=()=>v_flex().flex_none().bg(C.card).border_1().border_color(C.line).rounded(12).overflow_hidden();
export const box=()=>v_flex().flex_none().bg(C.card).border_1().border_color(C.line).rounded(12).py(12).px(14).gap(8);
export const h2=value=>div().text_size(13).font_weight(600).text_color(C.sec).whitespace_nowrap().child(value);
export function grp(label,count,color=null) {
  return h_flex().flex_none().items_center().gap(8).mt(4).text_size(12).text_color(C.dim)
    .when(Boolean(color),e=>e.child(sq(color))).child(String(label).toUpperCase())
    .child(div().bg(C.chip).text_color(C.txt).rounded(3).px(5).text_size(11).child(String(count)));
}
export const empty=value=>h_flex().flex_none().w_full().justify_center().p(40).border_1().border_dashed().border_color(C.line).rounded(12).text_color(C.faint).child(value);
// A button that acts: a coloured outline and, inside, the same colour paler, as the entry chosen in the column. What only
// goes somewhere else stays neutral.
const BUTTONS={mockup:['#22D3EE','#123D47'],pilot:[C.acc,C.acc2],lead:[C.lead,'#542E45'],wait:['#F1C25B','#54461F'],danger:['#FF8A7E','#553532'],ok:['#4DD4AE','#224C43']};
export function btn(id,label,fn,{tone='pilot'}={}) {
  const [line,fill]=BUTTONS[tone]||[C.strong,C.control];
  const el=h_flex().id(id).flex_none().items_center().h(30).px(12).rounded(8).border_1().cursor_pointer().whitespace_nowrap().text_size(13).font_weight(BUTTONS[tone]?600:500)
    .border_color(line).bg(fill).text_color(BUTTONS[tone]?'#FFFFFF':C.txt).child(label);
  return fn?el.on_click(fn):el;
}
// Shows Pilot. Its terminal is selected first: the page would otherwise show, for a moment, the tab that was on screen.
export function goPilot() {
  const tab=poTab(agents(),pilotOf(terminals())?.address);
  setShared(KEYS.project,null);
  if(tab){run('space.select',{id:tab.space});run('tab.select',{id:tab.tab});}
  run('layout.switch',{name:SCREENS.pilot});
}
// Pilot on an issue, with all it needs to speak about it: the Pilot on screen makes way for a new one.
// Every alert is a toast, never a line left in the page (the user, 2026-11-11 : « tout ce qui est message d'alerte comme
// ça je les veux en toaster »): what an action could not do, why Pilot could not open.
export const alertToast=message=>notify({title:String(message),level:'warning',timeout:6000});
// The same for what is read again and again: told once, and again only when it changes; a read that works forgets it.
export function alertOnce(view,key,message){view.alerts=view.alerts||{};if(message&&view.alerts[key]!==message)alertToast(message);view.alerts[key]=message||null;}
export function pilotOnIssue(mod,row,cx,failed=alertToast) {
  setShared(KEYS.pilotAsked,new Date().toISOString());
  cx.spawn(async()=>{
    try{await api(mod,'pilot-launch',{context:'issue',project:row.team.key,issueId:row.issue.id});goPilot();}
    catch(e){setShared(KEYS.pilotAsked,null);failed(String(e.message||e));}
  });
}
// The Lead of a mission, while its terminal lives.
// What someone wrote in full, in paragraphs and lists, so that it reads at a glance; its first block is its conclusion.
export function textBlocks(text,size=12.5,bright=false) {
  const bullet=value=>h_flex().items_start().gap(6).text_size(size).text_color(bright?C.title:C.dim).child(div().flex_none().child('•')).child(div().flex_1().min_w(0).child(value));
  return v_flex().gap(bright?10:8).pt(2).children(reportBlocks(text).map((b,n)=>b.items
   ?v_flex().gap(bright?5:3).when(Boolean(b.lead),e=>e.child(div().text_size(size).font_weight(600).text_color(bright?C.title:C.sec).child(b.lead))).children(b.items.map(bullet))
   :div().text_size(size).text_color(bright||n===0?C.title:C.dim).child(b.text)));
}
// The QA window, almost the whole window: what is tested on the left, the test on the right. Opened again, in its
// place, when what is tested changes; the same content is not opened twice.
export const qaSurface=mission=>({mod:'fabrique-console-v4-qa',props:{mission,part:'surface'}});
export function openQa(mission,surface,{force=false,mode=null}={}) {
  const shown=shared(KEYS.qaShown);
  if(!force&&shown?.mission===mission&&JSON.stringify(shown.surface)===JSON.stringify(surface)){if(mode&&shown.mode!==mode)setShared(KEYS.qaShown,{...shown,mode});return;}
  // Each window has its own number: only the panel of the window shown prepares anything.
  const window=Date.now()+'-'+Math.floor(Math.random()*1e6);
  setShared(KEYS.qaShown,{mission,surface,mode,window,overlay:null});
  // The whole window for the QA, made as large as the screen; given back as it was on Quit.
  if(force&&!appWindow()?.maximized&&!shared(KEYS.qaMaximized)){setShared(KEYS.qaMaximized,true);run('window.maximize');}
  // Fixed at the top left every time: no key, so no remembered spot; the window it replaces closes once it shows.
  const overlay=openOverlay({kind:'window',frame:'none',width:1,height:1,at:{x:0,y:0},layout:{type:'column',background:'#0C0D11',children:[
    {id:'qa-head',type:'block',content:{mod:'fabrique-console-v4-qa',props:{mission,window,part:'head'}},size:{px:60}},
    {id:'qa-body',type:'row',size:{weight:1},children:[{id:'qa-surface',type:'block',content:surface,size:{weight:1}},{id:'qa-panel',type:'block',content:{mod:'fabrique-console-v4-qa',props:{mission,window,part:'panel'}},size:{px:460}}]}]}});
  setShared(KEYS.qaShown,{mission,surface,mode,window,overlay});
  if(shown?.overlay&&shown.overlay!==overlay)closeOverlay(shown.overlay);
}
// A mockup, shown where the user decides; the arrow brings him back to the page he came from.
// The simulator page: the iPhone the app runs on, live, beside the terminal of the app (its log, r to reload).
// The simulator in a window over the page, the iPhone alone; Close gives the page back as it was.
export function openSimulator(app,title='') {
  if(app?.device)setShared('herdr-sim.devices',{...(shared('herdr-sim.devices')||{}),sim:app.device});
  // Fixed and centred every time: no key, so no remembered spot; one simulator window at a time.
  const before=shared(KEYS.simShown);
  const overlay=openOverlay({kind:'window',width:480,height:1,layout:{type:'column',background:'#0C0D11',children:[
    {id:'sim-head',type:'block',content:{mod:'fabrique-console-v4-qa',props:{part:'sim',title}},size:{px:52}},
    {id:'sim-phone',type:'block',content:{mod:'herdr-sim',props:{frames:'sim',reserve:52}},size:{weight:1}}]}});
  setShared(KEYS.simShown,overlay);
  if(before&&before!==overlay)closeOverlay(before);
}
export function openMockup(mission,mockup) {setShared(KEYS.mockup,{mission:mission.id,id:mockup.id,back:shared('layout')||null});run('layout.switch',{name:SCREENS.mockup});}
export function leadOfMission(mission) {
  const terminal=(snapshot().sessions||[]).find(s=>s.id===mission.lead?.sessionId)?.terminalId;
  return terminal?agents().find(a=>a.address===terminal)||null:null;
}
// Where a message to the Lead goes: its live terminal, or, while it rests (lot 1B), the terminal it had: the send of
// the backend wakes it there first. Not a terminal to show (no tab): leadOfMission is the one for that.
export function leadToTell(mission) {
  const live=leadOfMission(mission);
  if(live||!mission?.lead?.restedAt)return live;
  const terminal=(snapshot().sessions||[]).find(s=>s.id===mission.lead.sessionId)?.terminalId;
  return terminal?{address:terminal,rested:true}:null;
}
// The terminal of a Lead, in a tab beside Pilot: the user can talk to it directly. The tab stays until he closes it.
export function goLead(mission,lead) {
  if(poTab(agents(),lead.address)?.unnamed)run('tab.rename',{id:lead.tab,name:W.tabs.lead(mission.issue?.identifier||mission.id)});
  const tabs=shared(KEYS.tabs)||[];
  if(!tabs.includes(lead.address))setShared(KEYS.tabs,[...tabs,lead.address]);
  setShared(KEYS.project,null);setShared(KEYS.agent,lead.address);
  run('space.select',{id:lead.space});run('tab.select',{id:lead.tab});run('layout.switch',{name:leadScreen(mission.project,snapshot().projects)});
}
// The terminal of another agent of a development (its QA), in a tab beside Pilot as for its Lead, while it lives.
export function goAgent(agent) {
  const live=agents().find(a=>a.address===agent?.address);
  if(!live)return;
  const tabs=shared(KEYS.tabs)||[];
  if(!tabs.includes(live.address))setShared(KEYS.tabs,[...tabs,live.address]);
  setShared(KEYS.project,null);setShared(KEYS.agent,live.address);
  run('space.select',{id:live.space});run('tab.select',{id:live.tab});run('layout.switch',{name:SCREENS.agent});
}

// ---- The page of a ticket: a click on an issue opens it in the Issues, whatever page the issue was clicked on; ‹ goes
// back there.
export const ISSUE_OPEN='fabrique-console.v4.issue-open';
export function openTicket(row) {
  // Each opening is its own: the page reads the ticket afresh every time it opens, even the same ticket again.
  setShared(ISSUE_OPEN,{issueId:row.issue.id,project:row.team.key,identifier:row.issue.identifier??null,title:row.issue.title??null,back:shared('layout')||null,opened:Date.now()+'-'+Math.random().toString(36).slice(2,8)});
  run('layout.switch',{name:SCREENS.issues});
}
export function closeTicket() {
  const open=shared(ISSUE_OPEN);setShared(ISSUE_OPEN,null);
  if(open?.back&&open.back!==SCREENS.issues)run('layout.switch',{name:open.back});
}

// ---- Prepare ticket: Pilot opens fresh, in ticket preparation, on one project; from the Issues, a project page or Pilot.
// The view keeps preparing (the project being opened), choosing (the projects shown) and error.
export function prepareTicket(view,mod,project,cx) {
  if(view.preparing)return;
  view.preparing=project;view.choosing=false;setShared(KEYS.pilotAsked,new Date().toISOString());cx.notify();
  cx.spawn(async cx=>{
    try{await api(mod,'pilot-launch',{context:'ticket',project});goPilot();}
    catch(e){alertToast(e.message||e);setShared(KEYS.pilotAsked,null);}
    finally{view.preparing=null;cx.notify();}
  });
}
// The button: straight to Pilot when the project is known, else the choice of the project first.
export function prepareButton(view,mod,project) {
  return btn('prepare-ticket',view.preparing?W.pilot.starting:'＋ '+W.prepare.button,(_e,cx)=>{if(project)prepareTicket(view,mod,project,cx);else{view.choosing=!view.choosing;cx.notify();}},{tone:'ok'});
}
const chooseRow=(view,mod,p)=>h_flex().id('prepare-'+p.key).flex_none().items_center().gap(10).px(8).py(7).rounded(8).cursor_pointer().hover(s=>s.bg('#262B38')).on_click((_e,cx)=>prepareTicket(view,mod,p.key,cx)).child(projectTile(p,24,12)).child(div().text_color(C.title).child(String(p.name||p.key)));
// The small window of the projects, under the button at the top right of a page; a press outside it closes it. The page
// it is put in is relative.
export function projectChooser(view,mod,projects) {
  return div().absolute().top(0).left(0).size_full()
    .child(div().absolute().top(0).left(0).size_full().on_mouse_down('left',(_e,cx)=>{view.choosing=false;cx.notify();}))
    .child(v_flex().id('prepare-chooser').absolute().top(64).right(24).w(280).p(8).gap(2).rounded(12).bg('#1C2029').border_1().border_color('#33384A').shadow_md()
      .on_mouse_down('left',(_e,cx)=>cx.stop_propagation())
      .child(div().px(8).pt(4).pb(6).text_size(12).text_color(C.dim).child(W.prepare.for))
      .children(projects.map(p=>chooseRow(view,mod,p))));
}
// The same choice on one line, for a head too low for a window under it (Pilot's).
export function projectRow(view,mod,projects) {
  return h_flex().flex_1().min_w(0).flex_wrap().items_center().gap(6)
    .child(div().flex_none().text_color(C.dim).child(W.prepare.for))
    .children(projects.map(p=>btn('prepare-'+p.key,String(p.name||p.key),(_e,cx)=>prepareTicket(view,mod,p.key,cx),{tone:'plain'})))
    .child(btn('prepare-cancel',W.prepare.cancel,(_e,cx)=>{view.choosing=false;cx.notify();},{tone:'plain'}));
}

// ---- A request of the Inbox, answered where it is shown: in the Inbox, or in the page of its development beside what
// it is about. The same commands everywhere, so an answer given in one place leaves the other. The view keeps answering,
// sent, talking, opening and error; failed ({id, message}) is the last answer that did not go, for a screen that says it
// beside its request. An answer is sent once (canAnswer), with the version of the request that was shown (asShown).
// `after(cx, made)` is called once the answer is recorded.
const LABEL_MAX=70;
// An answer that did not go leaves its request open. Refused because the request changed since it was shown, the requests
// are read again at once, for every screen: what is shown is the request as it is now, to be answered again.
async function notSent(view,mod,item,e) {
  delete view.sent[item.id];view.failed=refusalOf(item,e);
  if(view.failed.changed)try{const fresh=await api(mod,'inbox-list',{});if(Array.isArray(fresh?.items))setShared(KEYS.inbox,fresh.items);}catch{}
  alertToast(e.message||e);
}
// An answer given in one click, by the command of the screens (inbox-answer): the only one that records a permission.
export function answerRequest(view,mod,item,text,cx,after=null) {
  if(!canAnswer(view,item))return;
  view.answering=item.id;view.error='';view.failed=null;view.sent[item.id]=text;cx.notify();
  cx.spawn(async cx=>{
    // One decision per request: what is shown is the one kept, which may be an earlier one.
    try{const made=await api(mod,'inbox-answer',{item:item.id,choice:text.slice(0,200),text,...asShown(item)});view.sent[item.id]=made?.decision?.text||text;if(after)await after(cx,made);}
    catch(e){await notSent(view,mod,item,e);}
    finally{view.answering=null;cx.notify();}
  });
}
// The user does not want to choose: the Lead does, and the request leaves the Inbox.
export function delegateRequest(view,mod,item,cx,after=null) {
  if(!canAnswer(view,item))return;
  view.answering=item.id;view.error='';view.failed=null;view.sent[item.id]=W.inbox.delegated;cx.notify();
  cx.spawn(async cx=>{
    try{const made=await api(mod,'inbox-delegate',{item:item.id,...asShown(item)});if(after)await after(cx,made);}
    catch(e){await notSent(view,mod,item,e);}
    finally{view.answering=null;cx.notify();}
  });
}
// A variant of a mockup chosen in answer to its request, by the action of the screen of the mockups: `send` names the
// mockup, the variant and the publication shown; the request and its version go with them.
export function pickMockup(view,mod,mission,send,item,cx,after=null) {
  if(!canAnswer(view,item))return;
  view.answering=item.id;view.error='';view.failed=null;view.sent[item.id]=W.mockup.chosen(String(send.variant).toUpperCase());cx.notify();
  cx.spawn(async cx=>{
    try{const made=await api(mod,'mockup-pick',{mission:mission.id,mockup:send.mockup,variant:send.variant,published:send.published,item:item.id,...asShown(item)});if(after)await after(cx,made);}
    catch(e){await notSent(view,mod,item,e);}
    finally{view.answering=null;cx.notify();}
  });
}
// The Lead is shown at once, and given the question if it still waits for an answer.
export function discussRequest(view,mod,item,mission,lead,open,cx) {
  if(!open){goLead(mission,lead);return;}
  if(view.talking)return;
  view.talking=true;view.error='';cx.notify();
  // The question first: the page goes when the Lead is shown, and what it was doing stops with it.
  cx.spawn(async cx=>{
    try{await api(mod,'inbox-discuss',{item:item.id});goLead(mission,lead);}
    catch(e){alertToast(e.message||e);}
    finally{view.talking=false;cx.notify();}
  });
}
// The page of Pilot starts an agent when it finds none: it is told that one is on its way.
export function openRequest(view,mod,item,cx) {
  if(view.opening)return;
  view.opening=item.id;view.error='';setShared(KEYS.pilotAsked,new Date().toISOString());cx.notify();
  cx.spawn(async cx=>{
    try{await api(mod,'inbox-open',{item:item.id});goPilot();}
    catch(e){alertToast(e.message||e);setShared(KEYS.pilotAsked,null);}
    finally{view.opening=null;cx.notify();}
  });
}
// One answer in a button, the one recommended if there is one; the others in plain links, so that they read as options.
export function answerRow(view,mod,item,answers,canDelegate) {
  const label=a=>a.length>LABEL_MAX?a.slice(0,LABEL_MAX)+'…':a,[first,...rest]=answersInOrder(answers,item.recommendation);
  const link=(id,text,fn,color)=>div().id(id).flex_none().cursor_pointer().text_size(13).text_color(color).text_decoration_1().text_decoration_solid().hover(x=>x.text_color(C.title)).on_click(fn).child(text);
  const links=[...rest.map((a,n)=>link('answer-'+item.id+'-'+(n+1),label(a),(_e,cx)=>answerRequest(view,mod,item,a,cx),C.txt)),...(canDelegate?[link('delegate-'+item.id,W.inbox.delegate,(_e,cx)=>delegateRequest(view,mod,item,cx),C.lead)]:[])];
  return h_flex().w_full().flex_wrap().items_center().gap(10).mt(10)
    .when(Boolean(first),e=>e.child(btn('answer-'+item.id+'-0',label(first||''),(_e,cx)=>answerRequest(view,mod,item,first,cx),{tone:first===item.recommendation?'ok':'plain'})))
    .when(Boolean(first)&&links.length>0,e=>e.child(div().flex_none().text_size(12.5).text_color(C.dim).child(W.inbox.or)))
    .children(links.flatMap((el,n)=>n?[div().flex_none().text_color(C.faint).child('·'),el]:[el]));
}
// A request in the page of its development, beside what it is about (its ticket, or the top of the step): what is asked,
// what the Lead suggests, the answers, and the ways to talk it over. What it says in full unfolds, as in the Inbox.
export function requestInPlace(view,mod,item,mission) {
  const lead=mission?leadOfMission(mission):null,said=item.answered||view.sent[item.id]||null,open=!item.decision&&!said,answers=item.answers||[],kind=itemKind(item);
  const canDelegate=item.type==='decision'&&Boolean(lead),summary=sameWords(itemSummary(item),item.title)?'':itemSummary(item),key='request:'+item.id,on=view.unfolded.has(key);
  const more=Boolean((item.text&&String(item.text).trim()!==itemSummary(item))||item.why);
  return v_flex().id(key).flex_none().w_full().px(14).py(10).gap(4).bg(C.bg).border_l_3().border_color(DOTS.blocked).rounded_r_lg()
    .child(h_flex().w_full().items_start().gap(10)
      .child(v_flex().flex_1().min_w(0).gap(4)
        .child(h_flex().flex_wrap().items_center().gap(8).child(div().font_weight(600).text_color(C.title).child(String(item.title||'—'))).child(pill(kind.tone,kind.label)))
        .when(Boolean(summary),e=>e.child(div().text_size(13).text_color(C.title).child(String(summary))))
        .when(Boolean(item.recommendation),e=>e.child(div().text_size(12.5).text_color(C.sec).child(W.inbox.recommendation+String(item.recommendation))))
        .when(more,e=>e.child(div().id('more-'+item.id).flex_none().cursor_pointer().text_size(12.5).text_color(C.dim).hover(s=>s.text_color(C.title)).on_click((_e,cx)=>{cx.stop_propagation();if(view.unfolded.has(key))view.unfolded.delete(key);else view.unfolded.add(key);cx.notify();}).child((on?'▴ ':'▾ ')+(on?W.inbox.less:W.inbox.more)))))
      .child(h_flex().flex_none().gap(6)
        .child(btn('open-'+item.id,view.opening===item.id?W.pilot.starting:W.inbox.open,(_e,cx)=>openRequest(view,mod,item,cx)))
        .when(Boolean(lead),e=>e.child(btn('lead-'+item.id,W.devs.goLead,(_e,cx)=>discussRequest(view,mod,item,mission,lead,open,cx),{tone:'lead'})))))
    .when(more&&on,e=>e.child(v_flex().w_full().mt(6).gap(10).px(14).py(12).rounded(10).bg('#06070A').border_1().border_color(C.line).when(Boolean(item.text),x=>x.child(textBlocks(item.text,13.5,true))).when(Boolean(item.why),x=>x.child(div().text_size(13).text_color(C.sec).child(String(item.why))))))
    .when(open&&(answers.length>0||canDelegate),e=>e.child(answerRow(view,mod,item,answers,canDelegate)))
    .when(Boolean(said),e=>e.child(h_flex().flex_wrap().items_center().gap(8).mt(6).child(pill('ok',W.inbox.sent)).child(div().text_size(13).text_color(C.sec).child(String(said)))));
}

// One mission in a list: its project, its issue, what it is doing, how far it is.
export function missionRow(id,mission,{color,detail,on=false,first=false,last=false,fn=null}={}) {
  const {done,total,ratio}=missionProgress(mission);
  let row=h_flex().id(id).flex_none().items_center().gap(12).px(16).py(10);
  if(!first)row=row.border_t_1().border_color(C.row);
  // A card does not clip its children to its corners: the marked row follows them itself.
  if(on)row=row.bg(C.rowOn).when(first,e=>e.rounded_t(11)).when(last,e=>e.rounded_b(11));
  if(fn)row=row.cursor_pointer().on_click(fn);
  return row.child(div().w(14).flex_none().child(sq(color)))
    .child(div().w(70).flex_none().child(mono(mission.issue?.identifier||mission.id)))
    .child(v_flex().flex_1().min_w(0).child(div().truncate().font_weight(500).text_color(C.title).child(String(mission.issue?.title||mission.request||'—'))).child(div().truncate().text_size(12).text_color(C.dim).child(String(detail))))
    .child(div().w(120).h(6).flex_none().rounded(3).bg(C.chip).overflow_hidden().child(div().h_full().w(Math.round(120*ratio)).bg('#4DD4AE')))
    .child(dim(done+' / '+total));
}

// ---- The issues, by project, as one list: only the visible rows cost anything, and the click is the list's.
const ROW=58,HEAD=36;
function head(section,color,top) {
  return h_flex().id('head-'+section.key).h(HEAD).items_center().when(!top,e=>e.pt(8)).gap(8).text_size(12).text_color(C.dim)
    .child(sq(color)).child(String(section.name).toUpperCase())
    .child(div().bg(C.chip).text_color(C.txt).rounded(3).px(5).text_size(11).child(String(section.rows.length)));
}
function issueRow(item,missions) {
  const {issue}=item.row;
  let row=h_flex().id('issue-'+issue.id).h(ROW).px(16).gap(12).items_center().bg(C.card).border_l_1().border_r_1().border_color(C.line).cursor_pointer().hover(s=>s.bg(C.rowOn)).border_t_1();
  if(item.first)row=row.rounded_t(12);
  if(item.last)row=row.rounded_b(12).border_b_1();
  return row.child(div().w(70).flex_none().child(mono(issue.identifier)))
    .child(v_flex().flex_1().min_w(0).child(div().truncate().font_weight(500).text_color(C.title).child(String(issue.title??'—'))).child(div().truncate().text_size(12).text_color(C.dim).child(issueMeta(item.row,missions))))
    .child(pill(issueTone(issue.state?.type,issue.state?.name),issue.state?.name||'—'))
    // The whole row opens the ticket: Pilot is one click away on its page.
    .child(div().flex_none().w(16).text_size(16).text_color(C.dim).child('›'));
}
export function issueList(id,sections,{missions,colorOf,open,heads=true}) {
  const items=sections.flatMap((section,n)=>[...(heads?[{key:'head:'+section.key,size:HEAD,section,top:n===0}]:[]),...section.rows.map((row,i)=>({key:'row:'+section.key+'/'+row.issue.id,size:ROW,row,first:i===0,last:i===section.rows.length-1}))]);
  const byKey=new Map(items.map(item=>[item.key,item]));
  return v_flex().relative().flex_1().min_h(0)
    .child(v_virtual_list(id,items.length,items.map(item=>item.size),index=>items[index].key,range=>items.slice(range.start,range.end).map(item=>item.section?head(item.section,colorOf(item.section.key),item.top):issueRow(item,missions)))
      .on_item_click((key,cx)=>{const item=byKey.get(key);if(item?.row)open(cx,item.row);}))
    .child(Scrollbar.vertical(id).absolute().inset_0());
}
