import {View,div} from 'gpui-kit';
import {agents,spaces,shared,setShared,run} from 'herdr';
import {snapshot} from './kit.js';
import {v_flex,h_flex,C,btn,projectTile} from './look.js';
import {W} from './words.js';
import {KEYS,SCREENS,agentHead,machineToShow} from './nav.js';
// The head of an agent's page, as Pilot has one: who it is, what it works on, and the way back to its development.
export default class AgentHead extends View {
 back(id) {setShared(KEYS.machine,machineToShow((shared(KEYS.missions)||[]).find(m=>m.id===id),shared(KEYS.machine)));setShared(KEYS.mission,id);setShared(KEYS.project,null);run('layout.switch',{name:SCREENS.ticket});}
 render() {
  const head=agentHead({address:shared(KEYS.agent),agents:agents(),spaces:spaces(),missions:shared(KEYS.missions),sessions:snapshot().sessions});
  const root=h_flex().id('agent-head').size_full().min_w(0).items_center().gap(14).pt(18).px(24).bg(C.bg).text_color(C.txt).text_size(13.5).line_height(1.5);
  if(!head)return root;
  const mission=(shared(KEYS.missions)||[]).find(m=>m.id===head.mission),project=(snapshot().projects||[]).find(p=>p.key===mission?.project)||null;
  return root
   .child(project&&head.lead?projectTile(project,48,26):h_flex().flex_none().w(48).h(48).rounded(12).bg(head.lead?C.lead:C.chip).text_color(head.lead?C.ink:C.txt).text_size(22).items_center().justify_center().child(head.lead?W.lead.glyph:W.glyph.devs))
   .child(v_flex().flex_1().min_w(0)
    .child(div().truncate().text_size(24).line_height(1.2).font_weight(600).text_color(C.title).child(String(head.title)))
    .when(Boolean(head.task),e=>e.child(div().truncate().text_color(C.dim).child(String(head.task)))))
   .when(Boolean(head.mission),e=>e.child(btn('agent-back',head.issue,()=>this.back(head.mission),{tone:'plain'})));
 }
}
