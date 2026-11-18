import {View,div} from 'gpui-kit';
import {machines,run,shared,setShared,window,agents} from 'herdr';
import {waitingAgents} from './view.js';
import {v_flex,h_flex,C,DOTS,press,logoFill} from './look.js';
import {W} from './words.js';
import {KEYS,railModel} from './nav.js';
// The machines, as Slack shows its workspaces: every machine, this computer, each other one. The one chosen filters
// every list of the window. The window buttons of macOS sit above them.
export default class Rail extends View {
 circle(r) {
  const on=r.on;
  return press(div().id('machine-'+(r.key||'all')).relative().flex_none().w(46).h(46).rounded(23).border_2().border_color(on?C.acc:C.clear).flex().items_center().justify_center().cursor_pointer().on_click(()=>setShared(KEYS.machine,r.key)))
   .child(h_flex().w(38).h(38).rounded(on?12:19).bg(on?C.acc2:C.circle).text_color(C.txt).font_weight(700).text_size(12).items_center().justify_center().child(r.glyph))
   .when(Boolean(r.state),e=>e.child(div().absolute().right(-1).bottom(-1).w(12).h(12).rounded(6).border_2().border_color(C.rail).bg(DOTS[r.state])))
   .when(r.badge>0,e=>e.child(h_flex().absolute().top(-5).right(-5).min_w(17).h(17).rounded(9).bg(C.red).text_color('#FFFFFF').text_size(10.5).font_weight(700).items_center().justify_center().px(4).child(String(r.badge))));
 }
 label(text) {return div().flex_none().mt(-6).text_size(9.5).text_color(C.dim).whitespace_nowrap().child(String(text));}
 render() {
  const [all,...others]=railModel({machines:machines(),chosen:shared(KEYS.machine)??null,items:[...(shared(KEYS.inbox)||[]),...waitingAgents(agents())]}),w=window(),lights=w?.platform==='macos'&&w.titlebar==='none'&&!w.fullscreen;
  const mark=h_flex().flex_none().w(30).h(30).rounded(8).bg(logoFill()).text_color('#FFFFFF').font_weight(800).text_size(12).items_center().justify_center().child(W.logo);
  return v_flex().id('rail').size_full().bg(C.rail).border_r_1().border_color(C.line).text_size(13.5).line_height(1.5)
   // The head of the rail continues the header of the column. The window buttons of macOS take it, except in full
   // screen: the mark then opens the list under it.
   .child(h_flex().flex_none().w_full().h(44).items_center().justify_center().border_b_1().border_color(C.line).when(!lights,e=>e.child(mark)))
   .child(v_flex().flex_1().min_h(0).w_full().items_center().gap(10).py(10)
   .when(lights,e=>e.child(mark))
   .child(this.circle(all)).child(this.label(all.label))
   .child(div().flex_none().w(30).h(1).bg(C.line))
   .children(others.flatMap(r=>[this.circle(r),this.label(r.label)]))
   .child(press(h_flex().id('machine-add').flex_none().w(38).h(38).rounded(19).border_1().border_dashed().border_color(C.strong).text_color(C.dim).text_size(18).items_center().justify_center().cursor_pointer().on_click(()=>run('app.settings',{section:'machines'})).child(W.rail.add))));
 }
}
