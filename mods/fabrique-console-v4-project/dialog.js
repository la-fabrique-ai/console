// The confirmation of screen 06 (decisions 71 and 78), drawn once for every screen that approves a plan: the page of a
// ticket and the old Development screen. The veil (.veil of the mockup) takes the clicks meant for the page beneath and
// does nothing with them; the box (.dlg), its title, its rows (.dkv), « Cancel » (.btn), which closes it and writes
// nothing, and « Approve and start » (.btn.go), the only one that approves. Its words are pageConfirm's (blocks.js).
import {div} from 'gpui-kit';
import {v_flex,h_flex,InputState} from 'gpui-base';

// The veil, the box, its border, its title, the colour of a key and of a value, a button and its border when pointed at,
// the main button and its background when pointed at.
const DLG={veil:'#090A0CA8',bg:'#1D2127',line:'#3A4049',title:'#F4F6F8',key:'#8C93A6',value:'#E6E9F0',btn:'#363C50',btnHover:'#5C6378',btnText:'#D6DAE6',go:'#F4F6F8',goText:'#131518',goHover:'#FFFFFF'};
// Many rows (a reapproval of many changes, M7 review 2): the box is never taller than this share of the window, its rows
// scroll inside it, and its title and buttons stay in sight.
const BOX_MAX='86%';
// The closure (screen 06 of « pre-close ») adds its computed checklist above the rows (.dck), and holds its main button
// while the list is not ready; the reopening (screen 08) has a sentence, a field for the reason and an amber button.
const CK={head:'#8C93A6',line:'#2A2F37',ok:'#3DD68C',okBg:'#173A2A',no:'#F5A524',noBg:'#3A2E14',detail:'#8C93A6',amber:'#F5C451',amberBg:'#3A2E14',amberHover:'#4A3A18'};
// Inside the rows that scroll (as the box of the approval), so that many rows keep the buttons in sight.
const checklist=c=>v_flex().id('confirm-checklist').flex_none()
  .child(div().flex_none().text_size(11).font_weight(600).text_color(CK.head).child(String(c.checkTitle||'').toUpperCase()))
  .when(Boolean(c.status),e=>e.child(div().mt(10).text_size(13.5).text_color(DLG.key).child(c.status)))
  .children((c.checklist||[]).map((r,i)=>h_flex().id('check-'+r.key).flex_none().h(39).items_center().gap(12).when(i>0,e=>e.border_t_1().border_color(CK.line))
   .child(h_flex().flex_none().w(20).h(20).rounded(10).items_center().justify_center().bg(r.ok?CK.okBg:CK.noBg).text_size(11).text_color(r.ok?CK.ok:CK.no).child(r.ok?'✓':'!'))
   .child(div().flex_1().min_w(0).text_size(14).text_color(DLG.value).child(r.label))
   .child(div().flex_none().text_size(12.5).text_color(r.ok?CK.detail:CK.no).child(r.detail))));
// The field of the reason to reopen (screen 08), empty, with its hint.
export const reasonField=hint=>InputState.new({value:'',placeholder:hint});
export function confirmDialog(c,{cancel,go}) {
  const stop=(_e,cx)=>cx.stop_propagation();
  const held=c.held===true,amber=c.tone==='amber';
  const btn=(id,label,fn,main=false)=>{
   if(main&&held)return h_flex().id(id).flex_none().h(34).px(14).items_center().justify_center().rounded(9).border_1().whitespace_nowrap().text_size(13.5).font_weight(600).border_color(DLG.btn).text_color(DLG.key).child(label);
   if(main&&amber)return h_flex().id(id).flex_none().h(34).px(14).items_center().justify_center().rounded(9).border_1().whitespace_nowrap().cursor_pointer().text_size(13.5).font_weight(600).border_color(CK.amber).bg(CK.amberBg).text_color(CK.amber).hover(s=>s.bg(CK.amberHover)).on_click(fn).child(label);
   return h_flex().id(id).flex_none().h(34).px(14).items_center().justify_center().rounded(9).border_1().whitespace_nowrap().cursor_pointer().text_size(13.5)
   .font_weight(main?600:500).border_color(main?DLG.go:DLG.btn).bg(main?DLG.go:'#00000000').text_color(main?DLG.goText:DLG.btnText).hover(s=>main?s.bg(DLG.goHover):s.border_color(DLG.btnHover)).on_click(fn).child(label);};
  return h_flex().id('confirm-veil').absolute().top(0).left(0).size_full().items_center().justify_center().bg(DLG.veil).on_mouse_down('left',stop).on_mouse_up('left',stop)
   .child(v_flex().id('confirm-box').flex_none().w(c.width||680).max_h(BOX_MAX).py(22).px(24).rounded(12).border_1().border_color(DLG.line).bg(DLG.bg)
    .child(div().flex_none().text_size(18).font_weight(600).text_color(DLG.title).child(c.title))
    // Each part is a child of the box, as in the box of the approval (a part a box has not is an empty block).
    .child(c.text?div().flex_none().mt(12).text_size(14).text_color(DLG.value).child(c.text):div().flex_none())
    .child(c.input?div().flex_none().mt(14).child(c.input):div().flex_none())
    .child(v_flex().id('confirm-rows').mt(Array.isArray(c.checklist)||(c.rows||[]).length?16:0).min_h(0).overflow_y_scrollbar().gap(12).text_size(14)
     .child(Array.isArray(c.checklist)?checklist(c):div().flex_none())
     .children((c.rows||[]).map(r=>h_flex().id('confirm-'+r.key).flex_none().items_start().w_full()
      .child(div().flex_none().w(200).text_size(13.5).text_color(DLG.key).child(r.label))
      .child(div().flex_1().min_w(0).text_color(DLG.value).child(r.text)))))
    .child(h_flex().id('confirm-buttons').flex_none().mt(22).gap(8).justify_end()
     .child(btn('confirm-cancel',c.cancel,cancel))
     .child(btn('confirm-go',c.go,go,true))));
}
