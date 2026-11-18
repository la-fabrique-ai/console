// The card of a ticket, drawn after Claude Design « page d'un ticket » (source/pv.css, .cd): the same card in the line
// of the plan and in the Kanban (screen 09); only the room it is given changes. What it says comes from the pure rules
// of line.js (lineCard, lineEnds); this file only draws, in native components.
import {div,PathBuilder} from 'gpui-kit';
import {v_flex,h_flex,MONO} from './look.js';
import {cardTitle} from './blocks.js';

// The look of a card says its state: border, background, title, then the colour of its state word.
const LOOK={plain:['#262B3A','#1B1F2B','#D6DAE6','#A9B4FF'],heavy:['#6E5BD6','#221D3A','#FFFFFF','#A9B4FF'],ok:['#1E3D33','#151D1C','#9FB0AA','#3DD6B0'],run:['#5563D8','#1C2040','#FFFFFF','#A9B4FF'],
  blk:['#C25B5B','#2C1818','#FFFFFF','#FF8A80'],you:['#C79A2B','#2A2416','#FFFFFF','#F2C14E'],fused:['#262B3A','#1B1F2B','#D6DAE6','#A9B4FF'],next:['#262B3A',null,'#D6DAE6','#A9B4FF'],start:['#5563D8','#1C2040','#FFFFFF','#A9B4FF']};
const END_ICON={qa:'▶',signoff:'✓',review:'R'};
// The faint stripes of a test, at 135°: 6 lit, 6 not, drawn by the window; none where the window cannot draw them.
const stripes=(w,h)=>{try{let p=PathBuilder.fill();for(let x=-h;x<w;x+=12)p=p.add_polygon([[x,h],[x+6,h],[x+6+h,0],[x+h,0]],true);return window.paint_path(p.build(),'#FFFFFF06').absolute().left(0).top(0).w(w).h(h);}catch{return div();}};
const TRACE={ok:'#3DD6B0',fix:'#FFB36B',dec:'#F2C14E'},RING={waits:'#5EA8FF',unblocks:'#3DD6B0'},HOVER='#5C6378',PULSE={period:1600,easing:'ease-in-out'};
// A card of the Kanban glides to its new place when its ticket changes of column (the mockup: .6s on left, top, width
// and height), moved by the window itself: no timer, no redraw of the page.
const GLIDE={duration:600,easing:'ease-out'},glide=el=>el.transition('left',GLIDE).transition('top',GLIDE).transition('width',GLIDE).transition('height',GLIDE);
// The difficulty of a ticket: Heavy in violet, Light outlined; a Standard ticket has no tag.
export const tagChip=tag=>{const el=h_flex().flex_none().items_center().h(17).px(6).rounded(5).border_1().text_size(11).font_weight(600).whitespace_nowrap().child(tag.text);return tag.heavy?el.bg('#3A2F6B').border_color('#6E5BD6').text_color('#E3DAFF'):el.border_color('#363C50').text_color('#A3AABB');};
// A badge of a card: a square of 16; amber when it calls the user.
export const badgeChip=badge=>{const el=h_flex().flex_none().w(16).h(16).rounded(4).items_center().justify_center().text_size(10).font_weight(700).bg(badge.tone==='you'?'#F2C14E':'#262B3A').text_color(badge.tone==='you'?'#131518':'#C9CFDB').child(badge.text);return badge.tip?el.tooltip(badge.tip):el;};
// The badge of the dev at work on a ticket; its halo pulses while it works, drawn by the window itself.
export const devBadge=avatar=>div().relative().flex_none().w(24).h(20)
  .when(avatar.live,e=>e.child(div().absolute().top(0).left(0).w(24).h(20).rounded(16).bg('#7B8CFF').opacity(0.55).loop('opacity',{from:0.55,to:0,...PULSE}).loop('width',{from:24,to:36,...PULSE}).loop('height',{from:20,to:32,...PULSE}).loop('left',{from:0,to:-6,...PULSE}).loop('top',{from:0,to:-6,...PULSE})))
  .child(h_flex().absolute().top(0).left(0).w(24).h(20).rounded(10).items_center().justify_center().border(1.5).border_color('#7B8CFF').bg('#262B5E').text_color('#D6DAFF').text_size(10.5).font_weight(700).child(avatar.text));
// The tag of the reviewer on a card in review (source/pv.css, .crw): a pill outlined in dashes; while the review runs a
// ring around it fades out and back, drawn by the window itself. A reviewer that waits for an answer (`off`, M9 review,
// decision 96) is dimmed as the inactive controls of the mockup (.off, opacity .35), with no ring.
export const reviewerTag=tag=>h_flex().relative().flex_none().self_start().when(Boolean(tag.off),e=>e.opacity(0.35))
  .when(tag.live,e=>e.child(div().absolute().inset(-3).rounded(12).border_2().border_color('#E6E9F0').opacity(0.45).loop('opacity',{from:0.45,to:0,...PULSE})))
  .child(h_flex().flex_none().items_center().h(18).px(7).rounded(9).border(1.5).border_dashed().border_color('#C9CFDB').bg('#1B1F2B').text_color('#E6E9F0').text_size(10.5).font_weight(600).whitespace_nowrap().child(tag.text));
// What circles a card from outside, without moving it: the ticket chosen (a white outline, 2 away), what it waits for
// (blue) and what it unblocks (green).
export function cardRings({x,y,w,h},{ring=null,sel=false}={}) {
  const out=[];
  if(ring)out.push(div().absolute().left(x-2).top(y-2).w(w+4).h(h+4).rounded(12).border_2().border_color(RING[ring]));
  if(sel)out.push(div().absolute().left(x-4).top(y-4).w(w+8).h(h+8).rounded(14).border_2().border_color('#E6E9ED'));
  return out;
}
// One card, placed: `card` is what lineCard says of a ticket (order, id, badges, title, tag, trace, look, word, sub,
// avatar), or what lineEnds says of QA and Sign-off (title, sub, look, word). `faded` sets aside a ticket a filter of the
// legend leaves out. `view` is the room the Kanban gives it (boardLayout): `card` in a column (its title on two lines),
// `fold` on one line (order, identifier, title, and the time beside its state), `wide` the ticket of a narrow column,
// with its expected result (`result`) on one line; `moves`: it glides when its place changes.
export function ticketCard(card,{id,x,y,w,h,faded=false,onPick=null,view='line',result='',moves=false}) {
  const end=!('order' in card),[line,bg,title,ink]=LOOK[card.look]||LOOK.plain,dashed=card.look==='fused'||card.look==='next',fold=view==='fold';
  let el=(fold?h_flex():v_flex()).id(id).absolute().left(x).top(y).w(w).h(h).rounded(10).border_1().border_color(line).overflow_hidden().text_color('#C9CFDB').hover(s=>s.border_color(HOVER));
  el=fold?el.items_center().gap(8).px(9):el.pt(8).px(9).pb(7);
  if(moves)el=glide(el);
  if(bg)el=el.bg(bg);
  if(dashed)el=el.border_dashed();
  if(faded)el=el.opacity(0.28);else if(card.look==='fused')el=el.opacity(0.55);
  if(onPick)el=el.cursor_pointer().on_click(onPick);
  if(end&&!fold)el=el.child(stripes(w,h));
  if(!end&&card.title)el=el.tooltip(card.title);
  if(fold)return el.when(Boolean(card.order),e=>e.child(div().flex_none().font_family(MONO).text_size(10.5).text_color('#6F7689').child(card.order)))
   .child(div().flex_none().whitespace_nowrap().font_family(MONO).text_size(11).text_color('#8C93A6').child(card.id))
   .child(div().flex_1().min_w(0).truncate().text_size(13).font_weight(600).text_color(title).child(card.title))
   .when(Boolean(card.sub),e=>e.child(div().flex_none().whitespace_nowrap().text_size(11.5).text_color('#8C93A6').child(card.sub)));
  const top=h_flex().flex_none().items_center().gap(6).min_h(16);
  // A test (Claude Design, 2026-11-17): the ticket card, an icon in place of the order (▶ QA, ✓ Sign-off, R the review of a
  // single ticket), a counter in mono in place of the review trace, and a faint striped ground.
  const head=end?top.child(div().flex_none().w(12).font_family(MONO).text_size(11).text_color('#A9B4FF').child(END_ICON[card.key]||'')).child(div().flex_none().whitespace_nowrap().text_size(13).font_weight(600).text_color('#E6E9F0').child(card.title))
   :top.when(Boolean(card.order),e=>e.child(div().flex_none().font_family(MONO).text_size(10.5).text_color('#6F7689').child(card.order)))
     .child(div().flex_none().whitespace_nowrap().font_family(MONO).text_size(11).text_color('#8C93A6').child(card.id))
     .child(div().flex_1()).child(h_flex().flex_none().gap(3).children(card.badges.map(badgeChip)));
  const label=end?div().flex_none().mt(2).max_h(65).overflow_hidden().text_size(12.5).font_weight(500).line_height(1.24).text_color(card.look==='start'?'#C9D0FF':'#A3AABB').child(card.sub)
   :view==='card'?div().flex_none().mt(4).max_h(31).overflow_hidden().text_size(12.5).font_weight(600).line_height(1.24).text_color(title).child(cardTitle(card.title,{w,view}))
   :div().flex_none().mt(4).max_h(65).overflow_hidden().text_size(13).font_weight(600).line_height(1.24).text_color(title).child(cardTitle(card.title,{w,view}));
  const meta=end?(card.count?h_flex().flex_none().mt(6).child(div().flex_none().whitespace_nowrap().font_family(MONO).text_size(11.5).text_color('#C9CFDB').child(card.count)):null):(card.tag||card.trace.length)?h_flex().flex_none().flex_wrap().items_center().gap_x(8).gap_y(3).mt(6)
   .when(Boolean(card.tag),e=>e.child(tagChip(card.tag)))
   .children(card.trace.map(t=>div().flex_none().whitespace_nowrap().text_size(11.5).font_weight(500).text_color(TRACE[t.tone]||TRACE.ok).child(view==='card'&&t.tight?t.tight:t.text))):null;
  // The foot: the state and what is said beside it, then the badge of the dev. When the three do not fit on one row
  // (« Waiting on you » « copy choice » D1), what is said beside the state goes under it: nothing is cut, the badge stays.
  const foot=card.word||card.avatar?h_flex().flex_none().items_end().gap(6).min_h(20)
   .child(h_flex().flex_1().min_w(0).flex_wrap().items_center().gap_x(6)
    .when(Boolean(card.word),e=>e.child(div().flex_none().whitespace_nowrap().text_size(12).font_weight(600).text_color(ink).child(card.word)))
    .when(Boolean(card.sub)&&!end,e=>e.child(div().flex_none().whitespace_nowrap().text_size(11.5).text_color('#8C93A6').child(card.sub))))
   .when(Boolean(card.avatar),e=>e.child(devBadge(card.avatar))):null;
  el=el.child(head).child(label);
  if(view==='wide'&&result)el=el.child(div().flex_none().w_full().mt(4).truncate().text_size(12).text_color('#8C93A6').child(result));
  if(meta)el=el.child(meta);
  if(!foot&&!card.reviewer)return el;
  el=el.child(div().flex_1().min_h(0));
  if(card.reviewer)el=el.child(reviewerTag(card.reviewer));
  return foot?el.child(card.reviewer?foot.mt(3):foot):el;
}
