// Native components of the Claude Design direction (DESIGN.md, export claude-design-4), kept from the V2 kit.
import {div,svg} from 'gpui-kit';
import {v_flex,h_flex} from 'gpui-base';
export {v_flex,h_flex};
export {api,task,snapshot,reloadSnapshot,feed,pokeFeed,readTeamIssues,FEED_ERRORS} from './common.js';
import {labelLook} from './view.js';
export const C={window:'#111316',bar:'#171A1F',card:'#1D2127',control:'#23272D',selected:'#2C3139',rowSelected:'#232830',border:'#2B3037',barBorder:'#272B31',rowBorder:'#22262C',strong:'#3A4049',title:'#F4F6F8',text:'#EAEDF1',secondary:'#C0C6CF',tertiary:'#9AA2AD',tab:'#B3BAC4',selection:'#C8CED6',projectName:'#C8CED6',filet:'#E6E9ED',ink:'#131518',running:'#7DB8FF',kbd:'#15181C',amber:'#F1C25B',danger:'#FF8A7E',dangerBorder:'#6E3129',dangerBg:'#2B1715',done:'#5BB974',doneText:'#9FD4A8'};
// tone: [text, border, background, default pictogram]
const TONES={inc:['#FF8A7E','#6E3129','#2B1715','incident'],dec:['#F1C25B','#6B5218','#2A2112','attente'],rev:['#7DB8FF','#26487A','#15223A','cours'],ok:['#4DD4AE','#1F5C49','#10271F','reussi'],unk:['#9AA2AD','#30353C',null,'inconnu']};
export const icons=mod=>'mods/'+mod+'/icons/';
export function pill(iconFolder,tone,label,icon) {
  const [xj,border,bg,pictogram]=TONES[tone]||TONES.unk;
  const el=h_flex().flex_none().items_center().gap(5).h(21).pl(6).pr(7).rounded(4).border_1().border_color(border).text_color(xj).text_size(12).font_weight(600).whitespace_nowrap()
    .child(svg(iconFolder+(icon||pictogram)+'.svg').size(11).flex_none().text_color(xj)).child(label);
  return bg?el.bg(bg):el;
}
export const sq=color=>div().w(10).h(10).rounded(2).flex_none().bg(color);
// A project named in a row: its square, then its name.
export const projectName=(color,name)=>h_flex().items_center().gap(7).min_w(0).text_color(C.projectName).font_weight(500).child(sq(color)).child(div().min_w(0).truncate().child(name));
export const LINE=1.45;
export const root=()=>v_flex().size_full().min_h(0).min_w(0).bg(C.window).text_color(C.text).text_size(13).line_height(LINE);
export const h2=value=>div().text_size(15).font_weight(600).text_color(C.title).whitespace_nowrap().child(value);
export const meta=value=>div().text_size(12).font_weight(500).text_color(C.tertiary).whitespace_nowrap().child(value);
export const card=()=>v_flex().bg(C.card).border_1().border_color(C.border).rounded(6);
export const header=(gap=12)=>h_flex().flex_none().items_baseline().justify_between().gap(gap).min_h(20);
export function btn(id,label,fn,{primary=false,small=false,arrow=null,danger=false}={}) {
  let el=h_flex().id(id).flex_none().items_center().gap(6).h(small?24:28).px(small?8:11).rounded(5).border_1().cursor_pointer().whitespace_nowrap().text_size(small?12.5:13).font_weight(primary?600:500)
    .border_color(primary?C.title:danger?C.dangerBorder:C.strong).bg(primary?C.title:C.control).text_color(primary?C.ink:danger?C.danger:C.text).on_click(fn).child(label);
  if(!primary) el=el.hover(s=>s.bg(C.selected));
  // An action that goes through a preview carries an arrow (the label ends with an ellipsis).
  if(arrow) el=el.child(svg(arrow+'fleche.svg').size(9).flex_none().text_color(primary?C.ink:C.text));
  return el;
}
export const errorBox=view=>view.error?div().flex_none().p(8).rounded(6).border_1().border_color(C.dangerBorder).bg(C.dangerBg).text_color(C.danger).child(view.error):div().h(0);
// A missing value is shown as a dash, never as an empty line or an error.
const shown=value=>String(value??'—');
export const note=value=>div().text_size(12).text_color(C.tertiary).child(shown(value));
export const field=input=>input.h(34).px(8).rounded(5).bg(C.window).border_1().border_color(C.strong).text_size(14).text_color(C.text);
export const mono=value=>div().font_family('JetBrains Mono').text_size(12.5).child(shown(value));
// A neutral chip for a value that carries no state of its own (a Tracker status, a label).
export const chip=value=>h_flex().flex_none().items_center().h(20).px(7).rounded(4).border_1().border_color('#30353C').bg('#262A31').text_color(C.secondary).text_size(12).whitespace_nowrap().child(shown(value));
// A Tracker label: its colour as a dot when known, then its name.
// A label chip: a dot in the label's colour (Tracker's, or one drawn from its name), a tinted border, its name.
export const labelChip=label=>{const {color}=labelLook(label);return h_flex().flex_none().items_center().gap(5).h(20).px(7).rounded(10).border_1().border_color(color.length===7?color+'66':color).bg(color.length===7?color+'14':C.control).text_color(C.secondary).text_size(12).whitespace_nowrap()
  .child(div().w(7).h(7).rounded(4).flex_none().bg(color)).child(shown(label?.name));};
// The pages of the V3: the content under the top bar (a block of its own in the layout).
export const page=()=>root().py(14).px(20).gap(14);
// The top bar of every page (the mockup's crumb bar): 44 px, the breadcrumb, then what the page adds at the right.
export const topBar=()=>h_flex().id('top-root').w_full().flex_none().min_w(0).h(44).px(20).gap(8).items_center().bg(C.bar).border_b_1().border_color(C.barBorder).text_size(14).line_height(LINE);
export const crumbSep=()=>div().flex_none().text_color('#4A515B').child('›');
export const crumbPart=(text,strong)=>div().flex_none().whitespace_nowrap().text_color(strong?C.title:C.tertiary).font_weight(strong?600:400).child(String(text??'—'));
// A segmented choice (Backlog | Toutes): one bordered box, the chosen option filled.
export function segment(id,options,current,fn) {
  const box=h_flex().id(id).flex_none().items_center().rounded(5).border_1().border_color(C.strong).overflow_hidden();
  return box.children(options.map(([key,label],n)=>{
    const on=key===current;
    let el=div().id(id+'-'+key).flex_none().px(10).py(3).cursor_pointer().whitespace_nowrap().text_size(12.5).font_weight(on?600:500).text_color(on?C.title:C.tab).on_click((e,cx)=>fn(key,e,cx)).child(label);
    if(n)el=el.border_l_1().border_color(C.strong);
    return on?el.bg(C.selected):el.hover(s=>s.bg(C.rowSelected));
  }));
}
