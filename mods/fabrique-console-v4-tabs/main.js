import {View,div} from 'gpui-kit';
import {agents,terminals,run,shared,setShared,props,openOverlay} from 'herdr';
import {snapshot} from './kit.js';
import {h_flex,C,MONO,dot,press,goPilot} from './look.js';
import {W} from './words.js';
import {KEYS,SCREENS,agentTabs,agentDot,pilotOf,screenOfAgent,leadWaits} from './nav.js';
// The tabs are agents, as in Herdr: Pilot first and for good, then the agents chosen with +. A cross takes a tab away
// and leaves its agent running.
export default class Tabs extends View {
 pilot() {goPilot();}
 show(address) {
  const agent=agents().find(a=>a.address===address);if(!agent)return;
  setShared(KEYS.project,null);setShared(KEYS.agent,address);
  run('space.select',{id:agent.space});run('tab.select',{id:agent.tab});run('layout.switch',{name:this.screen(address)});
 }
 screen(address) {return screenOfAgent(address,shared(KEYS.missions),snapshot().sessions,snapshot().projects);}
 remove(address,shown,cx) {
  cx.stop_propagation();
  setShared(KEYS.tabs,(shared(KEYS.tabs)||[]).filter(a=>a!==address));
  if(shown)this.pilot();
 }
 tab(id,on,{kind,label,lock=null,close=null,color=C.acc,fn}) {
  return press(h_flex().id(id).flex_none().h_full().items_center().gap(10).px(16).border_r_1().border_color(C.line).font_family(MONO).text_size(13).whitespace_nowrap().text_color(on?C.title:C.dim).cursor_pointer().when(on,e=>e.bg(C.card).border_t_2().border_color(color)).on_click(fn))
   .child(dot(kind)).child(String(label).toUpperCase())
   .when(Boolean(lock),e=>e.child(div().text_size(11).text_color(on?C.lav:C.dim).child(lock)))
   .when(Boolean(close),e=>e.child(press(div().id(id+'-close').ml(4).text_size(11).text_color(C.dim).hover(s=>s.text_color(C.title)).on_click(close)).child(W.tabs.close)));
 }
 icon(id,glyph,fn) {return press(div().id(id).text_color(C.dim).text_size(16).cursor_pointer().hover(s=>s.text_color(C.title)).on_click(fn)).child(glyph);}
 render() {
  const page=props()?.page,list=agents(),pilot=pilotOf(terminals()),address=pilot?.address||null,live=list.find(a=>a.address===address),current=page==='agent'||page==='lead'?shared(KEYS.agent):null;
  const dotOfPilot=!live?'off':live.status==='idle'?'ok':agentDot(live.status);
  return h_flex().id('tabs').size_full().min_w(0).items_center().bg(C.tabs).border_b_1().border_color(C.line).text_size(13.5).line_height(1.5)
   .child(this.tab('tab-pilot',page==='pilot',{kind:dotOfPilot,label:W.tabs.pilot,lock:W.tabs.pinned,fn:()=>this.pilot()}))
   .children(agentTabs(shared(KEYS.tabs),list,address).map(t=>this.tab('tab-'+t.address,t.address===current,{kind:leadWaits(t.address,shared(KEYS.missions),snapshot().sessions,shared(KEYS.inbox))?'blocked':t.dot,label:t.name,color:this.screen(t.address)===SCREENS.lead?C.lead:C.acc,close:(_e,cx)=>this.remove(t.address,t.address===current,cx),fn:()=>this.show(t.address)})))
   .child(press(h_flex().id('tab-add').flex_none().h_full().items_center().px(12).text_size(16).text_color(C.dim).cursor_pointer().hover(s=>s.text_color(C.title)).on_click(()=>openOverlay({mod:'fabrique-console-v4-picker',kind:'popup',at:'pointer'}))).child(W.tabs.add))
   .child(div().flex_1())
   .child(h_flex().flex_none().items_center().gap(14).px(14)
    .child(this.icon('tab-search',W.tabs.search,()=>run('app.palette')))
    .child(this.icon('tab-settings',W.tabs.settings,()=>run('app.settings'))));
 }
}
