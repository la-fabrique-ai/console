import {View,div} from 'gpui-kit';
import {agents,spaces,shared,setShared,props,run} from 'herdr';
import {snapshot,api} from './kit.js';
import {waitingAgents} from './view.js';
import {v_flex,h_flex,C,MONO,pill,press,openRequest,goPilot,alertToast} from './look.js';
import {W} from './words.js';
import {KEYS,SCREENS,rightModel,agentHead,machineToShow,workingTabs,readStartedInto} from './nav.js';
// The column on the right of Pilot and of an agent's page, drawn after Claude Design's « Colonnes de droite »
// (2026-11-12) in the colours of the app. Beside Pilot: the Inbox, then the developments. Beside a Lead: the summary of
// its development, what waits for the user there, then its tickets grouped by what they need. Every line opens Pilot.
const MOD='fabrique-console-v4-side',MINT='#4DD4AE',AMBER='#F1C25B',AMBER_BG='#2A2112',DONE_BG='#10271F',DONE_LINE='#2A6B58',INK='#0F1A17',LINK='#A9C4FF',READ_MS=10000;
// The column is 420 wide: 14 of padding each side, then 16 inside a card and its border.
const BAR=420-28-32-2;
export default class Side extends View {
 init(_p,cx) {this.opening=null;this.error='';this.hovered=null;this.all=new Set();this.asks={};this.started={};this.reading=false;this.dating=false;this.readAsks(cx);this.readStarted(cx);cx.timer.every(READ_MS,cx=>{this.readAsks(cx);this.readStarted(cx);});cx.timer.every(30000,cx=>cx.notify());}
 // When the agents at work were launched: read once per terminal, a relaunch being a new terminal.
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
 // What an agent stopped on its terminal asks, read as the Inbox reads it.
 readAsks(cx) {
  if(this.reading)return;
  const blocked=waitingAgents(agents());
  if(!blocked.length)return;
  this.reading=true;
  cx.spawn(async cx=>{
   try{for(const a of blocked)if(a.address)this.asks[a.address]=await api(MOD,'agent-waiting',{terminal:a.address}).catch(()=>this.asks[a.address]||null);}
   finally{this.reading=false;cx.notify();}
  });
 }
 // Pilot on a development: the one on screen makes way for a new one that knows the mission.
 askOnMission(id,cx) {
  if(this.opening)return;
  this.opening=id;setShared(KEYS.pilotAsked,new Date().toISOString());cx.notify();
  cx.spawn(async cx=>{
   try{await api(MOD,'pilot-launch',{context:'mission',mission:id});goPilot();}
   catch(e){setShared(KEYS.pilotAsked,null);alertToast(String(e.message||e));}
   finally{this.opening=null;cx.notify();}
  });
 }
 // An agent stopped on its terminal: Pilot opens on its development and is told to talk with it, as from the Inbox.
 agentToPilot(a,cx) {
  if(this.opening)return;
  if(!a.mission){run('layout.switch',{name:SCREENS.inbox});return;}
  this.opening=a.address;setShared(KEYS.pilotAsked,new Date().toISOString());cx.notify();
  cx.spawn(async cx=>{
   try{const out=await api(MOD,'pilot-launch',{context:'mission',mission:a.mission});if(a.ticket)await api(MOD,'agent-discuss',{agent:a.address,mission:a.mission,ticket:a.ticket,to:'pilot',terminal:out.terminal});goPilot();}
   catch(e){setShared(KEYS.pilotAsked,null);alertToast(String(e.message||e));}
   finally{this.opening=null;cx.notify();}
  });
 }
 openMission(id) {setShared(KEYS.machine,machineToShow((shared(KEYS.missions)||[]).find(m=>m.id===id),shared(KEYS.machine)));setShared(KEYS.project,null);setShared(KEYS.mission,id);run('layout.switch',{name:SCREENS.ticket});}
 // The two buttons: « Open Pilot » in words where there is room, a chevron at the end of a line elsewhere.
 click(el,fn) {return press(el).cursor_pointer().on_click((_e,cx)=>{cx.stop_propagation();fn(cx);});}
 button(id,fn) {return this.click(h_flex().id(id).flex_none().items_center().h(28).px(11).rounded(8).border_1().border_color(C.strong).text_size(13).text_color(C.sec).whitespace_nowrap().hover(s=>s.bg(C.chip)),fn).child(W.right.ask);}
 chevron(id,fn,shown=true) {
  const el=this.click(h_flex().id(id).flex_none().items_center().justify_center().w(28).h(28).rounded(8).border_1().border_color(shown?C.strong:C.clear).text_size(15).text_color(C.dim).hover(s=>s.bg(C.chip).text_color(C.title)),fn).child('›');
  return shown?el:el.invisible();
 }
 count(value,amber=false) {return h_flex().flex_none().items_center().justify_center().min_w(26).h(22).px(8).rounded(11).bg(amber?AMBER_BG:C.chip).text_color(amber?AMBER:C.title).text_size(12.5).font_weight(600).child(String(value));}
 card(id,title,right,rows) {
  return v_flex().id(id).flex_none().px(16).py(14).rounded(12).border_1().border_color(C.line).bg(C.card)
   .child(h_flex().flex_none().items_center().justify_between().mb(10).child(div().text_size(12.5).font_weight(600).text_color(C.dim).child(String(title).toUpperCase())).when(Boolean(right),e=>e.child(right)))
   .children(rows);
 }
 bar(done,total) {return div().w(BAR).h(5).rounded(3).bg(C.chip).overflow_hidden().child(div().h_full().w(Math.round(BAR*(total?done/total:0))).bg(MINT));}
 // A request: its full title, then where, why and since when; the amber dot says what the amber count says.
 request(r,n,withProject) {
  const lead=withProject&&r.project?r.project:'',rest=[r.ref,r.reason,r.ago].filter(Boolean).join(' · ');
  return h_flex().id('side-item-'+n).flex_none().items_start().gap(10).cursor_pointer().when(n>0,e=>e.mt(12).pt(12).border_t_1().border_color(C.line))
   .on_click(()=>run('layout.switch',{name:SCREENS.inbox}))
   .child(div().flex_none().mt(5).w(9).h(9).rounded(5).bg(AMBER))
   .child(v_flex().flex_1().min_w(0)
    .child(div().text_size(14).font_weight(600).text_color(C.title).line_height(1.3).child(r.title))
    // One line of text that wraps: the project in a lighter grey, then the ticket, the reason and the age.
    .child(div().mt(3).text_size(12.5).text_color(C.dim).child(lead&&rest?lead+' · '+rest:lead||rest)))
   .child(div().flex_none().mt(1).child(this.button('side-ask-item-'+n,cx=>r.agent?this.agentToPilot(r.agent,cx):openRequest(this,MOD,r.item,cx))));
 }
 // A development: its title has the whole first line; its step, project and progress the second, with the chevron.
 dev(d,n) {
  return v_flex().id('side-dev-'+n).flex_none().cursor_pointer().pb(2).when(n>0,e=>e.mt(10).pt(10).border_t_1().border_color(C.line))
   .on_click(()=>this.openMission(d.mission))
   .child(h_flex().items_center().gap(8).min_w(0).child(div().flex_none().font_family(MONO).text_size(12.5).text_color(C.dim).child(d.issue)).child(div().flex_1().min_w(0).truncate().text_size(14).font_weight(600).text_color(C.title).child(d.title)))
   .child(h_flex().items_center().gap(8).mt(7).text_size(12.5).text_color(C.dim)
    .child(pill(d.tone,d.step)).child(div().text_color(C.sec).font_weight(500).child(d.project)).child(div().flex_1())
    .child(div().whitespace_nowrap().child(W.right.merged(d.done,d.total)))
    .child(this.chevron('side-ask-dev-'+n,cx=>this.askOnMission(d.mission,cx))))
   .child(div().mt(8).child(this.bar(d.done,d.total)));
 }
 pilot(model) {
  return [this.card('side-inbox',W.nav.inbox,this.count(model.items.length,model.items.length>0),model.items.length?model.items.map((r,n)=>this.request(r,n,true)):[div().text_color(C.dim).child(W.inbox.empty)]),
   this.card('side-devs',W.nav.devs,this.count(model.devs.length),model.devs.length?model.devs.map((d,n)=>this.dev(d,n)):[div().text_color(C.dim).child(W.devs.none)])];
 }
 // The four steps as a stepper: done ✓, the current one full, the others hollow, joined by a line.
 stepper(steps) {
  // The lines between the steps take what is left of the card: the four steps always fit its width.
  return h_flex().w_full().items_center().mt(2).mb(12).children(steps.flatMap((s,n)=>{
   const done=s.state==='done',on=s.state==='now';
   const disc=h_flex().flex_none().items_center().justify_center().w(18).h(18).rounded(9).border_1().text_size(10.5)
    .border_color(done?DONE_BG:on?MINT:C.strong).bg(done?DONE_BG:on?MINT:C.card).text_color(done?MINT:on?INK:C.dim).child(done?'✓':String(n+1));
   const step=h_flex().id('side-step-'+n).flex_none().items_center().gap(6).text_size(12.5).font_weight(on?600:500).text_color(on?C.title:C.dim)
    .child(disc).child(div().whitespace_nowrap().child(s.label));
   return n<steps.length-1?[step,div().flex_1().min_w(6).max_w(22).h(1).mx(6).bg(done?DONE_LINE:C.strong)]:[step];
  }));
 }
 // A group of tickets: its state in a pill and how many, then one line per ticket, the chevron shown on hover.
 group(g,mission,first,status) {
  const folded=g.key==='merged'&&g.hidden>0;
  return v_flex().flex_none().when(!first,e=>e.mt(8))
   .child(h_flex().items_center().gap(8).mt(2).mb(6).text_size(12.5).text_color(C.dim).child(pill(g.tone,g.label)).child(div().child(String(g.count)))
    .when(Boolean(status),e=>e.child(div().flex_1()).child(div().child(status))))
   .children(g.tickets.map(t=>{
    const id='side-ticket-'+t.id,over=this.hovered===id;
    return h_flex().id(id).flex_none().items_center().gap(8).h(30).pl(6).pr(4).rounded(7).cursor_pointer().when(over,e=>e.bg(C.rowOn))
     .on_hover((h,cx)=>{if(h)this.hovered=id;else if(this.hovered===id)this.hovered=null;cx.notify();})
     .on_click(()=>this.openMission(mission))
     .child(div().flex_none().w(62).font_family(MONO).text_size(12.5).text_color(C.dim).child(t.id))
     .child(div().flex_1().min_w(0).truncate().text_size(13.5).text_color(g.hot?AMBER:C.txt).child(t.title))
     .child(this.chevron('side-ask-'+t.id,cx=>this.askOnMission(mission,cx),over));
   }))
   .when(folded,e=>e.child(h_flex().justify_between().pt(8).px(6).text_size(12.5).text_color(C.dim)
    .child(div().child(W.right.hidden(g.hidden)))
    .child(div().id('side-all').cursor_pointer().text_color(LINK).on_click((_e,cx)=>{this.all.add(mission);cx.notify();}).child(W.right.all))));
 }
 // Under the summary: who runs now and since when, then the way to Pilot.
 live(model) {
  const l=model.live,said=l?[l.kind==='qa'?W.right.live.qa:W.right.live[l.kind](l.who),l.waits?W.right.live.waits:null,l.since?W.right.live.since(l.since):null].filter(Boolean).join(' · '):'';
  return h_flex().mt(10).items_center().gap(8).text_size(12.5).text_color(C.dim)
   .when(Boolean(l),e=>e.child(div().flex_none().w(9).h(9).rounded(5).bg(AMBER)).child(div().child(said+' ·')))
   .child(div().id('side-ask-mission').flex_none().cursor_pointer().text_color(LINK).on_click((_e,cx)=>this.askOnMission(model.mission,cx)).child(W.right.ask));
 }
 lead(model) {
  if(!model.mission)return [div().text_color(C.dim).child(W.right.noLead)];
  return [
   this.card('side-summary',W.right.summary,pill(model.tone,model.step),[this.stepper(model.steps),
    div().text_size(14).text_color(model.tldr?C.txt:C.dim).line_height(1.45).child(model.tldr||W.right.noSummary),
    this.live(model)]),
   ...(model.asks.length?[this.card('side-asks',W.nav.inbox,this.count(model.asks.length,true),model.asks.map((r,n)=>this.request(r,n,false)))]:[]),
   this.card('side-tickets',W.right.tickets,this.count(model.done+' / '+model.total),[div().mb(10).child(this.bar(model.done,model.total)),
    ...model.groups.map((g,n)=>this.group(g,model.mission,n===0,n===0?W.right.status(model.review,model.fix):null))])];
 }
 render() {
  const page=props()?.page||'pilot',data=snapshot();
  const live=agents(),head=page==='pilot'?null:agentHead({address:shared(KEYS.agent),agents:live,spaces:spaces(),missions:shared(KEYS.missions),sessions:data.sessions});
  const missions=shared(KEYS.missions)||[],blocked=waitingAgents(live).map(a=>({address:a.address,name:a.name,mission:agentHead({address:a.address,agents:live,spaces:spaces(),missions,sessions:data.sessions})?.mission||null}));
  const mission=head?.lead?head.mission:null;
  const space=live.find(a=>a.address===shared(KEYS.agent))?.space||null;
  const model=rightModel({page,head,items:shared(KEYS.inbox)||[],missions,projects:data.projects||[],agents:live,blocked,asks:this.asks,started:this.started,space,all:Boolean(mission)&&this.all.has(mission),machine:shared(KEYS.machine)??null});
  return v_flex().id('side').size_full().min_h(0).gap(14).p(14).bg(C.bg).border_l_1().border_color(C.line).text_color(C.txt).text_size(13).line_height(1.4).overflow_y_scrollbar()
   .children(page==='pilot'?this.pilot(model):this.lead(model));
 }
}
