import {View,div} from 'gpui-kit';
import {agents,terminals,props,closeOverlay,shared,setShared,run} from 'herdr';
import {snapshot} from './kit.js';
import {v_flex,h_flex,C,MONO,dot} from './look.js';
import {W} from './words.js';
import {KEYS,pickableAgents,pilotOf,screenOfAgent} from './nav.js';
// The + of the tabs: the agents alive that have no tab yet. One chosen gets its tab and is shown.
export default class Picker extends View {
 pick(address) {
  const agent=agents().find(a=>a.address===address);
  setShared(KEYS.tabs,[...(shared(KEYS.tabs)||[]),address]);
  if(agent){setShared(KEYS.project,null);setShared(KEYS.agent,address);run('space.select',{id:agent.space});run('tab.select',{id:agent.tab});run('layout.switch',{name:screenOfAgent(address,shared(KEYS.missions),snapshot().sessions,snapshot().projects)});}
  closeOverlay(props().overlay);
 }
 render() {
  const rows=pickableAgents(shared(KEYS.tabs),agents(),pilotOf(terminals())?.address||null);
  return v_flex().id('picker').size_full().min_h(0).p(8).gap(2).bg(C.card).text_color(C.txt).text_size(13).line_height(1.5)
   .child(div().flex_none().px(8).py(4).text_size(12).text_color(C.dim).child(W.picker.title))
   .child(v_flex().id('picker-list').flex_1().min_h(0).gap(2).overflow_y_scrollbar()
    .children(rows.map(a=>h_flex().id('pick-'+a.address).flex_none().items_center().gap(8).px(8).py(6).rounded(6).cursor_pointer().hover(s=>s.bg(C.rowOn)).on_click(()=>this.pick(a.address))
     .child(dot(a.dot)).child(div().flex_1().min_w(0).truncate().font_family(MONO).text_size(12.5).child(a.name)).child(div().flex_none().text_size(11.5).text_color(C.dim).child(String(a.space||'')))))
    .when(!rows.length,e=>e.child(div().px(8).py(6).text_size(12.5).text_color(C.faint).child(W.picker.empty))));
 }
}
