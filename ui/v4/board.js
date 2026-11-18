// Pure rules of the Kanban view of the plan on the page of a ticket (v2, Claude Design « page d'un ticket », screen 09):
// the second way to show the zone of the tickets (decision 15), with the same cards as the line. Tested with node --test.
// The numbers are those of the mockup (source/Main.dc.html: KX, KW, HFC, HM, KH), brought to the width of the zone.
import {W} from './words.js';

const P=W.page;
// Five columns, 6 apart: To do and Accepted share what the zone leaves (246 each on the mockup), In dev and In review are
// narrow (198) and show their ticket in large (202 high), Next (100) holds QA and Sign-off (112 high). A card stands 6
// inside its column, the first one under the head of the column (34). A card of To do is 92 high, one of Accepted 116;
// folded on one line, 32. The cards of a column have 432 of height before the board scrolls. In a zone too narrow for
// the five columns, To do and Accepted give what is missing down to 160 (a card of the line), then the board is wider
// than its zone and scrolls sideways: no column is ever out of reach.
export const BOARD=Object.freeze({host:466,gap:6,pad:6,head:34,narrow:198,next:130,side:160,min:110,full:[92,202,202,116],fold:32,end:112,room:432,hint:120});
const OVER=['accepted','merged'],KEYS=['todo','dev','review','accepted','next'];
// Whether the plan offers its two views: from Develop on (never in Prepare, where the line is the plan being written),
// and not for a plan of a single ticket, which has one card.
export const boardOffered=({stage,simple=false,count=0})=>stage!=='prepare'&&!simple&&count>0;
// The view shown: the one the user chose last, kept from a development to another and from a session to the next, as
// long as the plan offers it; the line otherwise.
export const planView=(saved,offered)=>offered&&saved==='kanban'?'kanban':'line';
// A ticket set aside (merged into another one, or canceled) stays in its column, folded, after the others.
const aside=t=>t.state==='canceled'||t.delivery==='integrated';
// The column of a ticket, by its state alone: stopped or waited for, it stays where it is (in dev, in review), with its
// colour. 0 To do, 1 In dev (developed or fixed), 2 In review, 3 Accepted.
export const boardColumn=t=>OVER.includes(t?.state)?3:t?.state==='review'?2:['dev','fix'].includes(t?.state)?1:0;
// How many cards of a column are shown in full: as many as its height holds once the others are folded on one line.
export function boardFold(count,full,{fold=BOARD.fold,gap=BOARD.gap,room=BOARD.room}={}) {
  let shown=count;
  while(shown>0&&shown*(full+gap)+(count-shown)*(fold+gap)>room+gap)shown--;
  return shown;
}
// What the board draws, in its own coordinates: its columns (title, count, hint when empty), each card where it stands
// and how (`card` in full, `fold` on one line, `wide` the ticket of a narrow column, in large with its expected result),
// QA and Sign-off in Next, its width (the one of the zone, more when the zone is too narrow: the board then scrolls
// sideways) and its height (the one of the zone, more when a column needs it: the board then scrolls).
// To do keeps the order of the plan; Accepted puts the last one accepted first (`acceptedAt`: when each was, {id: instant};
// those without a time come after, in the order of the plan reversed). With a ticket chosen: what it waits for (waits), what it unblocks
// (unblocks). `done`: every ticket is accepted, nothing is left to develop.
export function boardLayout({tickets,width,sel=null,ends=[],acceptedAt={},done=false}) {
  const list=tickets||[],B=BOARD,side=Math.max(B.min,Math.floor((width-2*B.narrow-4*B.gap)/3)),widths=[side,B.narrow,B.narrow,side,side];
  const xs=widths.map((_w,i)=>widths.slice(0,i).reduce((a,b)=>a+b+B.gap,0)),at=new Map(list.map((t,i)=>[t.id,i])),chosen=sel!==null&&at.has(sel)?list[at.get(sel)]:null;
  const cols=[[],[],[],[]];
  list.forEach((t,i)=>cols[boardColumn(t)].push(i));
  // Accepted: the tickets accepted at a known time first, the last one first, then those without a time in the order of
  // the plan reversed. Two separate lists, so that the order never depends on how the sort walks them.
  const when=i=>Date.parse(acceptedAt?.[list[i].id]||'')||0,dated=cols[3].filter(when).sort((a,b)=>when(b)-when(a)||b-a);
  cols[3]=[...dated,...cols[3].filter(i=>!when(i)).sort((a,b)=>b-a)];
  for(const c of [0,3])cols[c]=[...cols[c].filter(i=>!aside(list[i])),...cols[c].filter(i=>aside(list[i]))];
  const ring=t=>!chosen?null:(chosen.deps||[]).includes(t.id)?'waits':(t.deps||[]).includes(chosen.id)?'unblocks':null,cards=new Array(list.length);
  let bottom=B.host;
  cols.forEach((col,c)=>{
    const narrow=c===1||c===2,whole=col.filter(i=>!aside(list[i])).length,shown=narrow?col.length:boardFold(whole,B.full[c],{fold:B.fold,gap:B.gap,room:B.room-(col.length-whole)*(B.fold+B.gap)});
    let y=B.head;
    col.forEach((i,k)=>{
      const t=list[i],full=narrow||(k<shown&&!aside(t)),h=full?B.full[c]:B.fold;
      cards[i]={id:t.id,column:c,x:xs[c]+B.pad,y,w:widths[c]-2*B.pad,h,view:narrow?'wide':full?'card':'fold',ring:ring(t),sel:chosen?.id===t.id};
      y+=h+B.gap;
    });
    if(col.length)bottom=Math.max(bottom,y-2);
  });
  const reviewing=cols[2].length>0,hints=['',reviewing?P.board.devWaits:done?P.board.allDone:'',done?P.board.allDone:P.board.noReview,'',''];
  const titles=[P.board.todo,P.board.dev,P.board.review,P.board.accepted,P.stages.validate];
  return {width:xs[4]+widths[4],height:bottom,
    cols:KEYS.map((key,c)=>({key,title:titles[c],x:xs[c],w:widths[c],h:bottom,count:String(c===4?ends.length:cols[c].filter(i=>!aside(list[i])).length),hint:c<4&&!cols[c].length?hints[c]:''})),
    cards,ends:ends.map((e,k)=>({key:e.key,x:xs[4]+B.pad,y:B.head+k*(B.full[3]+B.gap),w:widths[4]-2*B.pad,h:B.full[3]}))};
}
// Validate (QA, Sign-off) is as wide as To do and Accepted, its cards the size of the others (the user, 2026-11-17, over
// the 130 of the mockup); the three share the rest equally, down to 110, so that the columns hold in the zone.
// When each ticket was accepted, from the reports of the agents: its last review accepted.
export function acceptedTimes(tickets,reports) {
  const out={};
  for(const t of tickets||[]) {
    if(!OVER.includes(t.state))continue;
    const last=(reports||[]).filter(r=>r.ticket===t.id&&!r.unreadable&&r.at&&/^review-\d+$/.test(r.kind)&&r.verdict==='accepted').map(r=>String(r.at)).sort().at(-1);
    if(last)out[t.id]=last;
  }
  return out;
}
