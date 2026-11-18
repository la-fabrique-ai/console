import {View,div} from 'gpui-kit';
import {shared,setShared,run,agents,spaces} from 'herdr';
import {snapshot,api} from './kit.js';
import {waitingAgents} from './view.js';
import {v_flex,h_flex,C,screen,h1,hd,dim,fault,list,sq,dot,grp,pill,btn,empty,goPilot,goLead,leadOfMission,textBlocks,projectTile,openMockup,answerRequest,delegateRequest,discussRequest,openRequest,answerRow,alertToast} from './look.js';
import {W} from './words.js';
import {KEYS,SCREENS,inboxOrdered,itemKind,itemUrgency,itemSummary,sameWords,agentHead,machineToShow,mockupsToSee,agoOf} from './nav.js';
// The Inbox: only what needs the user, the most blocking first. Nothing is answered here: an element opens Pilot on the
// whole file of the Lead.
const MOD='fabrique-console-v4-inbox';
export default class Inbox extends View {
 init(_p,cx) {this.opening=null;this.error='';this.sent={};this.answering=null;this.talking=false;this.unfolded=new Set();this.asks={};this.reading=false;this.readAsks(cx);cx.timer.every(30000,cx=>cx.notify());cx.timer.every(8000,cx=>this.readAsks(cx));}
 // What each agent stopped on its terminal is asking.
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
 // The answers, the Lead and Pilot: the actions every request has, here and in the page of its development (look.js).
 answer(item,text,cx) {answerRequest(this,MOD,item,text,cx);}
 discuss(item,mission,lead,open,cx) {discussRequest(this,MOD,item,mission,lead,open,cx);}
 delegate(item,cx) {delegateRequest(this,MOD,item,cx);}
 answerRow(item,answers,canDelegate) {return answerRow(this,MOD,item,answers,canDelegate);}
 openItem(item,cx) {openRequest(this,MOD,item,cx);}
 row(item,first) {
  const project=(snapshot().projects||[]).find(p=>p.key===item.project),kind=itemKind(item),urgency=itemUrgency(item),issue=item.issue?.identifier||item.issue||'—',mission=(shared(KEYS.missions)||[]).find(m=>m.id===item.mission)||null,lead=mission?leadOfMission(mission):null,said=item.answered||this.sent[item.id]||null,open=!item.decision&&!said,answers=item.answers||[];
  const tail=[item.blocked?.length?item.blocked.join(', '):null,item.proofs?.length?W.inbox.proofs:null].filter(Boolean).join(' · ');
  const canDelegate=item.type==='decision'&&Boolean(lead),kits=mission?mockupsToSee(mission,{item:item.id,ticket:item.ticket}):[];
  const summary=sameWords(itemSummary(item),item.title)?'':itemSummary(item),more=Boolean((item.text&&String(item.text).trim()!==itemSummary(item))||item.why||tail),on=this.unfolded.has(item.id);
  let row=v_flex().id('item-'+item.id).flex_none().w_full().px(16).py(12);
  if(!first)row=row.border_t_1().border_color(C.row);
  return row.child(h_flex().items_start().gap(14).child(projectTile(project,30,16))
   .child(v_flex().flex_1().min_w(0)
    .child(h_flex().flex_wrap().items_center().gap(8).font_weight(600).text_color(C.title).child(div().font_weight(500).text_color(C.dim).child((project?.name||item.project||'—')+' · '+issue)).child(String(item.title||'—')).child(pill(kind.tone,kind.label)).child(pill(urgency.tone,urgency.label)).child(h_flex().flex_none().items_center().gap(4).font_weight(400).text_size(12.5).text_color(C.dim).child(div().flex_none().child('◷')).child(div().flex_none().child(agoOf(Date.parse(item.createdAt))))))
    .when(Boolean(summary),e=>e.child(div().mt(6).text_size(13.5).text_color(C.title).child(String(summary))))
    .when(more||kits.length>0,e=>e.child(h_flex().mt(6).gap(12).items_center().when(more,x=>x.child(div().id('more-'+item.id).flex_none().cursor_pointer().text_size(12.5).text_color(C.dim).hover(s=>s.text_color(C.title)).on_click((_e,cx)=>{if(this.unfolded.has(item.id))this.unfolded.delete(item.id);else this.unfolded.add(item.id);cx.notify();}).child((on?'▴ ':'▾ ')+(on?W.inbox.less:W.inbox.more)))).children(kits.map(k=>btn('mockup-'+item.id+'-'+k.id,W.mockup.open,()=>openMockup(mission,k),{tone:'mockup'}))))))
   .child(v_flex().flex_none().items_end().gap(6).child(h_flex().flex_none().gap(6).when(Boolean(mission),e=>e.child(btn('dev-'+item.id,issue,()=>this.openDev(mission),{tone:'plain'}))).child(btn('open-'+item.id,this.opening===item.id?W.pilot.starting:W.inbox.open,(_e,cx)=>this.openItem(item,cx))).when(Boolean(lead),e=>e.child(btn('lead-'+item.id,W.devs.goLead,(_e,cx)=>this.discuss(item,mission,lead,open,cx),{tone:'lead'}))))))
   .child(v_flex().w_full().pl(44)
    .when(more&&on,e=>e.child(v_flex().w_full().mt(10).gap(12).px(18).py(16).rounded(10).bg('#06070A').border_1().border_color(C.line).when(Boolean(item.text),x=>x.child(textBlocks(item.text,14.5,true))).when(Boolean(item.why),x=>x.child(div().text_size(13.5).text_color(C.sec).child(String(item.why)))).when(Boolean(tail),x=>x.child(div().text_size(12.5).text_color(C.dim).child(tail)))))
    .when(open&&(answers.length>0||canDelegate),e=>e.child(this.answerRow(item,answers,canDelegate)))
    .when(Boolean(said),e=>e.child(h_flex().flex_wrap().items_center().gap(8).mt(10).child(pill('ok',W.inbox.sent)).child(div().text_size(13).text_color(C.sec).child(String(said))))));
 }
 openDev(mission) {setShared(KEYS.machine,machineToShow(mission,shared(KEYS.machine)));setShared(KEYS.mission,mission.id);setShared(KEYS.project,null);run('layout.switch',{name:SCREENS.ticket});}
 show(a) {setShared(KEYS.project,null);setShared(KEYS.agent,a.address);run('space.select',{id:a.space});run('tab.select',{id:a.tab});run('agent.focus',{terminal:a.address});run('layout.switch',{name:SCREENS.agent});}
 // An agent of an issue blocked on its terminal, as the V3 listed it: only the user can answer there.
 // The Lead and Pilot are given what the agent asks, then shown: this page goes when they are.
 agentToLead(a,address,ticket,mission,lead,cx) {
  if(this.talking)return;
  this.talking=true;this.error='';cx.notify();
  cx.spawn(async cx=>{
   try{await api(MOD,'agent-discuss',{agent:address,mission:mission.id,ticket,to:'lead'});goLead(mission,lead);}
   catch(e){alertToast(e.message||e);}
   finally{this.talking=false;cx.notify();}
  });
 }
 agentToPilot(a,address,ticket,mission,cx) {
  if(this.opening)return;
  this.opening=a.address;this.error='';setShared(KEYS.pilotAsked,new Date().toISOString());cx.notify();
  cx.spawn(async cx=>{
   try{const out=await api(MOD,'pilot-launch',{context:'mission',mission:mission.id});await api(MOD,'agent-discuss',{agent:address,mission:mission.id,ticket,to:'pilot',terminal:out.terminal});goPilot();}
   catch(e){alertToast(e.message||e);setShared(KEYS.pilotAsked,null);}
   finally{this.opening=null;cx.notify();}
  });
 }
 // An agent stopped on its terminal reads like any other request; its answer is given in that terminal.
 agent(a,first) {
  const list=agents(),missions=shared(KEYS.missions)||[],address=a.address,head=agentHead({address,agents:list,spaces:spaces(),missions,sessions:snapshot().sessions}),mission=head?.mission?missions.find(m=>m.id===head.mission)||null:null,lead=mission?leadOfMission(mission):null,project=(snapshot().projects||[]).find(p=>p.key===mission?.project)||null;
  const ask=this.asks[a.address]||null,said=ask?.command?W.inbox.asksToRun+' '+ask.command:ask?.question||null,ticket=/^([A-Z][A-Z0-9]*-\d+)/.exec(a.name)?.[1]||null,issue=mission?.issue?.identifier||null,details=[...(ask?.command&&ask?.question?[ask.question]:[]),...(ask?.details||[])],on=this.unfolded.has(a.address),more=details.length>0;
  let row=v_flex().id('agent-'+a.address).flex_none().w_full().px(16).py(12);
  if(!first)row=row.border_t_1().border_color(C.row);
  return row.child(h_flex().items_start().gap(14).child(project?projectTile(project,30,16):div().w(30).flex_none().pt(4).child(dot('blocked')))
    .child(v_flex().flex_1().min_w(0)
     .child(h_flex().flex_wrap().items_center().gap(8).font_weight(600).text_color(C.title).when(Boolean(project||issue),e=>e.child(div().font_weight(500).text_color(C.dim).child([project?.name,issue].filter(Boolean).join(' · ')))).child(a.name+' · '+W.inbox.agentWaits).child(pill('dec',W.item.authorization)).child(pill('inc',W.item.urgent)))
     .when(Boolean(said),e=>e.child(div().mt(6).text_size(13.5).text_color(C.title).child(String(said))))
     .when(more,e=>e.child(h_flex().mt(6).child(div().id('more-'+a.address).flex_none().cursor_pointer().text_size(12.5).text_color(C.dim).hover(s=>s.text_color(C.title)).on_click((_e,cx)=>{if(this.unfolded.has(a.address))this.unfolded.delete(a.address);else this.unfolded.add(a.address);cx.notify();}).child((on?'▴ ':'▾ ')+(on?W.inbox.less:W.inbox.more))))))
    .child(h_flex().flex_none().gap(6)
     .when(Boolean(mission),e=>e.child(btn('agent-dev-'+a.address,issue||mission.id,()=>this.openDev(mission),{tone:'plain'})))
     .when(Boolean(mission&&ticket&&address),e=>e.child(btn('agent-pilot-'+a.address,this.opening===a.address?W.pilot.starting:W.inbox.open,(_e,cx)=>this.agentToPilot(a,address,ticket,mission,cx))))
     .when(Boolean(lead&&ticket&&address),e=>e.child(btn('agent-lead-'+a.address,W.devs.goLead,(_e,cx)=>this.agentToLead(a,address,ticket,mission,lead,cx),{tone:'lead'})))))
   .child(v_flex().w_full().pl(44)
    .when(more&&on,e=>e.child(v_flex().w_full().mt(10).gap(12).px(18).py(16).rounded(10).bg('#06070A').border_1().border_color(C.line).child(textBlocks(details.join('\n'),14.5,true))))
    .child(h_flex().w_full().mt(10).child(btn('agent-open-'+a.address,W.inbox.openTerminal,()=>this.show(a),{tone:'wait'}))));
 }
 render() {
  const items=inboxOrdered(shared(KEYS.inbox)),blocked=waitingAgents(agents()),total=items.length+blocked.length;
  return screen().id('inbox')
   .child(hd(h1(W.inbox.title),dim(total?W.inbox.count(total):W.inbox.none)))
   .when(Boolean(this.error),e=>e.child(fault(this.error)))
   .when(total>0,e=>e.child(v_flex().id('inbox-scroll').flex_shrink(1).min_h(0).overflow_y_scrollbar().child(list().children([...blocked.map((a,n)=>this.agent(a,n===0)),...items.map((item,n)=>this.row(item,n===0&&!blocked.length))]))))
   .when(!total,e=>e.child(empty(W.inbox.empty)));
 }
}
