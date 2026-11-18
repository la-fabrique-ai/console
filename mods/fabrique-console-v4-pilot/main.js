import {View,div} from 'gpui-kit';
import {terminals,agents,run,shared,setShared} from 'herdr';
import {api,snapshot} from './kit.js';
import {poTab,spaceAsked} from './view.js';
import {v_flex,h_flex,C,logoFill,btn,prepareButton,projectRow,alertToast} from './look.js';
import {W} from './words.js';
import {KEYS,PILOT_TOOL,pilotOf} from './nav.js';
const MOD='fabrique-console-v4-pilot',ASKED=KEYS.pilotAsked;
// The head of the Pilot screen. The conversation is the terminal under it: an agent, in its own tab. Until the lot of
// Pilot, this agent is the general assistant the backend already starts. It is started by a timer, never at load: a
// check of the mod must not start an agent.
export default class PilotHead extends View {
 init(_p,cx) {this.preparing=null;this.choosing=false;this.busy=false;this.error='';this.failure='';this.sending=null;this.notice='';this.noticeAt=0;this.shown=null;cx.timer.every(1000,cx=>this.tick(cx));}
 tick(cx) {
  if(this.notice&&Date.now()-this.noticeAt>6000){this.notice='';cx.notify();}
  const terminal=pilotOf(terminals()),tab=terminal?poTab(agents(),terminal.address):null;
  if(tab&&this.shown!==terminal.address){this.shown=terminal.address;this.error='';run('space.select',{id:tab.space});run('tab.select',{id:tab.tab});cx.notify();}
  else if(!terminal&&!this.busy&&!this.error&&!spaceAsked(shared(ASKED),Date.now()))this.start(cx);
 }
 // hc keeps the name of the terminal unique: a second window asking at the same time is refused, and finds it.
 start(cx) {
  this.busy=true;this.error='';setShared(ASKED,new Date().toISOString());cx.notify();
  cx.spawn(async cx=>{
   try{await api(MOD,'agent-start',{tool:PILOT_TOOL});this.shown=null;}
   catch{this.error=W.pilot.failed;}
   finally{this.busy=false;cx.notify();}
  });
 }
 // Compact keeps what matters for the subject Pilot is on, clear starts again: the backend types them in its terminal.
 command(name,cx) {
  if(this.sending)return;
  this.sending=name;this.failure='';cx.notify();
  cx.spawn(async cx=>{
   try{await api(MOD,'pilot-command',{command:name});this.notice=name==='clear'?W.pilot.cleared:W.pilot.compacted;this.noticeAt=Date.now();}
   catch(e){alertToast(e.message||e);}
   finally{this.sending=null;cx.notify();}
  });
 }
 render() {
  const alive=Boolean(pilotOf(terminals()));
  return h_flex().id('pilot-head').size_full().min_w(0).items_center().gap(14).pt(18).px(24).bg(C.bg).text_color(C.txt).text_size(13.5).line_height(1.5)
   .child(h_flex().flex_none().w(48).h(48).rounded(12).bg(logoFill()).text_color('#FFFFFF').text_size(20).items_center().justify_center().child(W.pilot.glyph))
   // Prepare ticket: the head is too low for a window under it, so the projects take the place of the title.
   .when(this.choosing,e=>e.child(projectRow(this,MOD,snapshot().projects||[])))
   .when(!this.choosing,e=>e.child(v_flex().flex_1().min_w(0)
    .child(div().text_size(24).line_height(1.2).font_weight(600).text_color(C.title).child(W.pilot.title))
    .child(div().truncate().text_color(C.dim).child(this.failure||this.error||(this.sending?(this.sending==='clear'?W.pilot.clearing:W.pilot.compacting):this.notice||(this.busy?W.pilot.starting:W.pilot.sub)))))
    .child(prepareButton(this,MOD,null)))
   .when(alive&&!this.choosing,e=>e.child(btn('pilot-compact',W.pilot.compact,(_e,cx)=>this.command('compact',cx))).child(btn('pilot-clear',W.pilot.clear,(_e,cx)=>this.command('clear',cx),{tone:'danger'})))
   .when(Boolean(this.error),e=>e.child(btn('pilot-retry',W.pilot.retry,(_e,cx)=>this.start(cx))));
 }
}
