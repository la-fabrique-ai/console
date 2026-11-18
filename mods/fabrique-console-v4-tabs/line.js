// Pure rules of the plan on the page of a ticket (v2, Claude Design « page d'un ticket »): the line of the tickets, the
// card of a ticket, the legend and the details of a ticket, from what the engine already knows. Tested with node --test.
// The numbers are those of the mockup (source/Main.dc.html, source/pv.css). What the engine does not give yet (time per
// step, tokens, migration and risk of a ticket, changes since the last visit, drift) is left out, never made up.
import {W} from './words.js';
import {waitingOn,reportDigest} from './nav.js';
import {modelShort,reviewerFor} from './view.js';
import {stageOf,pageCount,dueTickets,stuckSpan,askedBy} from './page.js';

const P=W.page;
// The line: cards of 160 by 196, 10 apart, from 4; QA and Sign-off, 150 wide, pinned at the end of the zone. A button
// moves the line by three tickets. Under the row of 272, the band of « what happens now » (ticket 32) from 278.
export const LINE=Object.freeze({card:160,gap:10,pitch:170,left:4,top:40,height:196,pin:150,pinHeight:94,pinGap:8,row:272,band:278,host:466,fade:40,step:3,pans:244});
// A single ticket (screen 37): one wide card from 4, then Review and Sign-off, 212 wide and as tall as the card, 8 apart,
// the last one 4 from the right of the zone; the card ends 12 before Review. A « › » of 12 stands in each gap.
const ONE=Object.freeze({end:212,endGap:8,right:4,cardGap:12,glyph:12});
const LEVELS={fort:'heavy',standard:'standard','léger':'light'};
const OVER=['accepted','merged'],IN_HAND=['dev','fix','review'];
const byTime=(a,b)=>String(a.at).localeCompare(String(b.at));
// How long, in the words of the mockup (« 6 min », « 1 h 05 »); nothing for a time nobody knows.
export const minutesText=min=>!Number.isFinite(min)||min<0?'':min<60?Math.round(min)+' min':Math.floor(min/60)+' h '+String(Math.round(min%60)).padStart(2,'0');
// The step of the engine (`timings`) a line of the timeline takes its time from, for the band and the details alike: the
// dev step to the dev step; a review or a fix to the step of the same kind on the same commit, the last delivery of that
// commit made before its report (decision 90). A line drawn from the rounds the engine keeps (ticket M9) is its own step.
// A review under way reads the last delivery: the step of the same commit and the same time of delivery, none other; the
// same commit delivered twice, the reviewer of the second not launched: no step, no time (M8 review 3).
export function stepTime(s,given) {
  const list=Array.isArray(given)?given:[];
  if(s.key==='dev')return list.find(x=>x?.step==='dev')||null;
  if(s.timed)return s.timed;
  if(!s.key||!s.delivery)return null;
  const mine=list.filter(x=>x?.step===s.key&&x.commit===s.delivery);
  if(!s.at)return s.delivered?mine.filter(x=>x.delivered&&String(x.delivered)===String(s.delivered)).at(-1)||null:null;
  return mine.filter(x=>!x.delivered||String(x.delivered)<=String(s.at)).at(-1)||null;
}
// The answer the user gave, as the mockup writes it after « you decided: » (« accept as is »).
const lowerFirst=text=>{const t=String(text||'').trim();return t?t[0].toLowerCase()+t.slice(1):'';};
const listOf=value=>Array.isArray(value)?value.filter(x=>typeof x==='string'&&x.trim()):[];

// The tickets of the line: those of the plan in the order of their ranks, then those the plan does not name. Each with
// what the plan says of it (expected result, difficulty, phase, texts to write; its technical details, the tests its dev
// plans and its acceptance criteria when the plan carries them), what it waits for on the line, and the dev the plan
// gives it (`devN`: 2 for a ticket of Dev 2, else 1; `dev` is its tool, which says nothing of who develops it).
export function lineTickets(mission) {
  const rows=(mission?.tickets||[]).filter(t=>t&&t.id),plan=new Map((mission?.plan?.tickets||[]).map(t=>[t.id,t])),ids=new Set(rows.map(t=>t.id));
  const ranked=rows.filter(t=>t.n!=null).sort((a,b)=>a.n-b.n),rest=rows.filter(t=>t.n==null);
  return [...ranked,...rest].map((t,at)=>{
    const said=plan.get(t.id)||null;
    return {...t,at,devN:said?.dev===2?2:1,order:t.n!=null?String(at+1):'',title:String(t.title||said?.title||''),result:said?.result||null,difficulty:said?.difficulty||LEVELS[t.level]||null,phase:said?.phase??null,
      texts:said?.texts||[],technical:listOf(said?.technical),tests:listOf(said?.tests),criteria:listOf(said?.criteria),deps:[...new Set(t.deps||[])].filter(id=>ids.has(id)&&id!==t.id)};
  });
}
// The phases of the Lead: one header above each run of tickets of the same phase.
export function linePhases(mission,tickets) {
  const titles=new Map((mission?.plan?.phases||[]).map(p=>[p.id,p.title])),runs=[];
  (tickets||[]).forEach((t,i)=>{
    if(t.phase===null||!titles.has(t.phase))return;
    const last=runs.at(-1);
    if(last&&last.to===i-1&&last.phase===t.phase)last.to=i;else runs.push({from:i,to:i,title:titles.get(t.phase),phase:t.phase});
  });
  return runs.map(({phase:_phase,...run})=>run);
}
// The ticket the line is set on: the one in hand, else the next one to do, else the last.
export function lineFocus(tickets) {
  const list=tickets||[],hand=list.findIndex(t=>IN_HAND.includes(t.state));
  if(hand>=0)return hand;
  const next=list.findIndex(t=>!OVER.includes(t.state)&&t.state!=='canceled'&&t.delivery!=='integrated');
  return next>=0?next:Math.max(0,list.length-1);
}
// The active ticket (decision 53): the one in hand, whatever is said of it (in dev, in review, being fixed, stopped,
// waiting on the user). None in Prepare, nor between two tickets: -1.
export const lineActive=tickets=>(tickets||[]).findIndex(t=>IN_HAND.includes(t.state));
const pinX=width=>width-LINE.pin,viewOf=(width,geo=LINE)=>Math.max(0,pinX(width)-14-geo.left);
// How many tickets are hidden on each side of the zone for a place of the line, one cut counting as hidden.
const hiddenAt=(count,width,pan,geo=LINE)=>{const over=count*geo.pitch-geo.gap-viewOf(width,geo);return {before:Math.max(0,Math.ceil(pan/geo.pitch)),after:Math.max(0,Math.ceil((over-pan)/geo.pitch))};};
// Where the line stands in its zone: on its own place (`auto`) unless the user moved it (`pan`), and how many tickets are
// hidden on each side. With an active ticket (`active`, its place in the line; decision 53) its own place puts that
// ticket at the centre of the zone, to the point: at the two ends of the line, and for a single ticket, room is left
// before the first ticket or after the last one rather than holding the centring back, and a card that the centring
// cuts at an edge stays cut. Without one (Prepare, between two tickets) the line stands on its ticket in focus as far as
// its ends allow: at the first ticket in Prepare. `lo` and `hi` are the two ends of what the user can reach. `geo` is the
// room of a card and of the zone: the one of the line, or the one of the two lanes (TWO).
export function linePan({count,width,focus=0,pan=null,active=-1,geo=LINE}) {
  const view=viewOf(width,geo),max=Math.max(0,count*geo.pitch-geo.gap-view),centre=i=>Math.round(i*geo.pitch+geo.card/2-view/2)||0;
  const auto=active>=0?centre(active):Math.min(max,Math.max(0,centre(focus))),lo=Math.min(0,auto),hi=Math.max(max,auto);
  const at=pan===null||pan===undefined?auto:Math.min(hi,Math.max(lo,pan));
  return {view,max,lo,hi,pan:at,auto,...hiddenAt(count,width,at,geo)};
}
// A button of the line moves it by `by` between its first and its last ticket, and never jumps over the place of the
// active ticket: a step that would pass it stops on it, and a step that reaches an end of the line the active ticket
// stands beyond goes on to it. That is the gesture that brings the line back after the user moved it.
export function lineJump({pan,auto,max,by}) {
  const raw=pan+by,to=Math.min(max,Math.max(0,raw));
  if((by>0&&auto>max&&raw>=max)||(by<0&&auto<0&&raw<=0))return auto;
  return (pan<auto&&to>=auto)||(pan>auto&&to<=auto)?auto:to;
}
// Which dev a ticket is developed by: the plan says it (plan.tickets[].dev, 1 or 2), never the tool of the ticket: two
// devs can use the same tool, and stay two devs. A ticket whose dev the plan does not say is one of Dev 1, and so is
// every ticket when the plan has none for Dev 1 or none for Dev 2: one dev, as before.
const twoDevs=list=>list.some(t=>t.devN===2)&&list.some(t=>t.devN!==2);
export function lineDev(tickets,ticket) {
  return ticket?.devN===2&&twoDevs(tickets||[])?2:1;
}
// The lanes of the dependencies that jump over a ticket, in the order they are taken: one above the cards, two below
// (the mockup), then one more on each side for a plan that needs them.
const LANES=[{side:'top',y:31},{side:'bottom',y:248},{side:'bottom',y:262},{side:'top',y:26},{side:'bottom',y:255}];
const SLOT=[40,110],MARGIN=12;
// A plan of one ticket (screens 37, 38, 39): no QA agent, one review. The card is wide and carries its expected result;
// Review then Sign-off follow it, a « › » before each. Nothing scrolls, nothing is hidden, no header stands above them.
function oneLayout({tickets,width,sel,pinned}) {
  const t=(tickets||[])[0],sign=width-ONE.right-ONE.end,review=sign-ONE.endGap-ONE.end,top=LINE.top,h=LINE.height;
  const cards=t?[{id:t.id,x:LINE.left,y:top,w:review-ONE.cardGap-LINE.left,h,view:'wide',result:t.result||'',ring:null,sel:sel===t.id}]:[];
  const ends=pinned?[{key:'review',x:review,y:top,w:ONE.end,h},{key:'signoff',x:sign,y:top,w:ONE.end,h}]:[];
  const glyphs=pinned&&t?[{x:review-ONE.cardGap,y:top+h/2-8,w:ONE.glyph,text:'›',tone:null},{x:sign-ONE.endGap-2,y:top+h/2-8,w:ONE.glyph,text:'›',tone:null}]:[];
  return {cards,ends,glyphs,segs:[],heads:[],phases:[],masks:{solid:{x:width,y:0,w:0,h:LINE.row},left:null,right:null},pans:{before:null,after:null}};
}
// What the zone draws, in its own coordinates: the cards, QA and Sign-off at the end, the phases above, an arrow or a
// dot between two tickets, a rail for each dependency that jumps over one, the fades and the counts of the hidden
// tickets. With a ticket chosen: what it waits for in blue (waits), what it unblocks in green (unblocks). Without
// `ends` (the Lead still breaks the issue down), QA and Sign-off are left out, the line keeping its place.
export function lineLayout({tickets,phases=[],width,pan=0,sel=null,ends:pinned=true,simple=false}) {
  if(simple)return oneLayout({tickets,width,sel,pinned});
  const list=tickets||[],N=list.length,px=pinX(width),at=new Map(list.map((t,i)=>[t.id,i])),chosen=sel!==null&&at.has(sel)?list[at.get(sel)]:null;
  const x0=i=>LINE.left+i*LINE.pitch-pan,cx=i=>x0(i)+LINE.card/2,top=LINE.top,bottom=LINE.top+LINE.height;
  const tone=(from,to)=>!chosen?null:chosen.id===to?'waits':chosen.id===from?'unblocks':null;
  const cards=list.map((t,i)=>({id:t.id,x:x0(i),y:top,w:LINE.card,h:LINE.height,ring:!chosen?null:chosen.deps.includes(t.id)?'waits':t.deps.includes(chosen.id)?'unblocks':null,sel:chosen?.id===t.id}));
  const ends=pinned?[{key:'qa',x:px,y:top,w:LINE.pin,h:LINE.pinHeight},{key:'signoff',x:px,y:top+LINE.pinHeight+LINE.pinGap,w:LINE.pin,h:LINE.pinHeight}]:[];
  const segs=[],heads=[];
  const H=(x1,x2,y,more)=>segs.push({x:Math.min(x1,x2)-1,y:y-1,w:Math.abs(x2-x1)+2,h:2,...more}),V=(x,y1,y2,more)=>segs.push({x:x-1,y:Math.min(y1,y2),w:2,h:Math.abs(y2-y1),...more});
  const down=(x,y,more)=>heads.push({x:x-5,y:y-6,dir:'down',...more}),up=(x,y,more)=>heads.push({x:x-5,y,dir:'up',...more});
  // QA leads to Sign-off.
  const mid=px+Math.round(LINE.pin/2);
  if(pinned){V(mid,ends[0].y+ends[0].h,ends[1].y-5,{tone:null,pin:true});down(mid,ends[1].y-1,{tone:null,pin:true});}
  // Between two tickets: an arrow when the next one waits for the one before, a dot when it does not.
  const glyphs=list.slice(0,-1).map((t,i)=>{const waits=list[i+1].deps.includes(t.id);return {x:x0(i)+LINE.card,y:top+LINE.height/2-8,text:waits?'›':'·',tone:waits?tone(t.id,list[i+1].id):null};});
  // A dependency that jumps over a ticket takes a rail. The shortest first, each on the first lane where it crosses none.
  const jumps=[];
  list.forEach((t,to)=>t.deps.forEach(id=>{const from=at.get(id);if(from!==to-1)jumps.push({from,to});}));
  jumps.sort((a,b)=>Math.abs(a.to-a.from)-Math.abs(b.to-b.from)||a.from-b.from||a.to-b.to);
  const taken=LANES.map(()=>[]);
  for(const jump of jumps) {
    const a=Math.min(jump.from,jump.to)*LINE.pitch,b=Math.max(jump.from,jump.to)*LINE.pitch,crossed=lane=>taken[lane].filter(([c,d])=>a<d+MARGIN&&c<b+MARGIN).length;
    let lane=LANES.findIndex((_l,n)=>!crossed(n));
    if(lane<0)lane=LANES.map((_l,n)=>n).sort((m,n)=>crossed(m)-crossed(n)||n-m)[0];
    taken[lane].push([a,b]);jump.lane=lane;
  }
  // Several arrows into one card on one side stand apart; alone, an arrow lands in the middle, unless a rail leaves there.
  const sideOf=jump=>LANES[jump.lane].side,leaves=(i,side)=>jumps.some(j=>j.from===i&&sideOf(j)===side);
  for(const jump of jumps) {
    const side=sideOf(jump),same=jumps.filter(j=>j.to===jump.to&&sideOf(j)===side).sort((m,n)=>side==='top'?LANES[n.lane].y-LANES[m.lane].y:LANES[m.lane].y-LANES[n.lane].y);
    const k=same.indexOf(jump),alone=same.length===1&&!leaves(jump.to,side);
    jump.into=alone?LINE.card/2:same.length<=1?SLOT[0]:Math.round(SLOT[0]+k*(SLOT[1]-SLOT[0])/(same.length-1));
  }
  for(const jump of jumps) {
    const {y,side}=LANES[jump.lane],more={tone:tone(list[jump.from].id,list[jump.to].id),pin:false},x1=cx(jump.from),x2=x0(jump.to)+jump.into;
    if(side==='top'){V(x1,y,top,more);H(x1,x2,y,more);V(x2,y,top-5,more);down(x2,top-1,more);}
    else{V(x1,bottom,y,more);H(x1,x2,y,more);V(x2,bottom+5,y,more);up(x2,bottom+1,more);}
  }
  const above=phases.map(run=>({x:x0(run.from),w:x0(run.to)+LINE.card-x0(run.from),text:run.title,dashed:false,pin:false}));
  if(pinned)above.push({x:px,w:LINE.pin,text:P.stages.validate,dashed:true,pin:true});
  const box=x=>({x,y:0,w:LINE.fade,h:LINE.row}),{before,after}=hiddenAt(N,width,pan);
  return {cards,ends,glyphs,segs,heads,phases:above,
    masks:{solid:{x:px-12,y:0,w:width-px+12,h:LINE.row},left:before?box(LINE.left-4):null,right:after?box(px-52):null},
    pans:{before:before?{x:LINE.left,y:LINE.pans,count:before}:null,after:after?{x:px-96,y:LINE.pans,count:after}:null}};
}

// ---- Two devs (screens 40 and 41): two lanes take the place of the line and of the band under it. The numbers of the
// mockup: cards of 150 by 182, 10 apart, from 96 (the name of each dev stands before its lane); the lane of Dev 1 from
// 40 and the one of Dev 2 from 254, each on a background of 190; QA ends the first lane, Sign-off the second. A ticket
// stands in the lane of its dev, at its place in the order of the plan.
export const TWO=Object.freeze({card:150,gap:10,pitch:160,left:96,tops:[40,254],height:182,pin:150,backs:[36,250],back:190,names:[46,260],nameX:8,nameW:82,pans:226,host:466,fade:40,step:3,glyph:9});
// Between the two lanes, the dependencies that go from a dev to the other (238 on the mockup, then one on each side for
// a plan that needs them); a dependency that jumps over a ticket inside a lane takes a rail on the outer side of that
// lane (33 then 27 above Dev 1 on the mockup; the same below Dev 2). Two arrows into one card stand 40 and 100 from its left.
const MIDS=[238,232,244],RAILS=[[33,27],[443,449]],SLOT2=[40,100];
// The devs of a line, as the plan numbers them (lineDev): Dev 1, and Dev 2 when the plan gives it tickets. A dev has one
// tool (decision 53); its model can change from a ticket to another. Each with its badge, its name, its tool and its
// model in small (what the mockup writes when all its tickets have the same model, the tool alone otherwise; nothing
// when its tickets do not have one tool, as in a plan that does not say its devs), its tickets, and how many it develops
// (a ticket merged into another, or canceled, is not counted).
export function lineDevs(tickets) {
  const list=tickets||[],one=values=>{const set=new Set(values.filter(Boolean));return set.size===1?[...set][0]:null;};
  return (twoDevs(list)?[1,2]:[1]).map((n,i)=>{
    const own=list.filter(t=>lineDev(list,t)===n),tool=one(own.map(t=>t.dev)),model=tool?one(own.map(t=>t.model)):null;
    return {n:i+1,badge:'D'+(i+1),name:P.who.dev(i+1),tool,label:[W.toolNames[tool]||'',model?modelShort(model):''].filter(Boolean).join(' · '),ids:own.map(t=>t.id),count:P.plan.tickets(own.filter(t=>t.delivery!=='integrated'&&t.state!=='canceled').length)};
  });
}
// Two lanes are drawn for two devs, and for two only (decision 14: one dev most of the time, two at most).
export const lineLanes=tickets=>{const devs=lineDevs(tickets);return devs.length===2?devs:null;};
// Where each lane stands (decision 53): a lane is set on its own active ticket, at the centre of the zone; a lane
// without one keeps the place of the mockup, which moves the two lanes as one: the place of the lane that has an active
// ticket, else the start of the plan. Once the user moved the lanes they go together, as on the mockup, until a button
// brings them back on the active ticket. `pan`, `auto`, `max`, `lo` and `hi` are those of the buttons and of the wheel;
// `lanes` is the place of each lane, `active` the active ticket of each (-1: none).
export function lanesPan({tickets,width,focus=0,pan=null}) {
  const list=tickets||[],count=list.length,active=[1,2].map(n=>list.findIndex(t=>IN_HAND.includes(t.state)&&lineDev(list,t)===n)),first=active.find(i=>i>=0)??-1;
  const at=linePan({count,width,focus,pan,active:first,geo:TWO}),own=i=>i>=0?linePan({count,width,active:i,geo:TWO}).auto:at.auto;
  return {...at,active,lanes:at.pan===at.auto?active.map(own):[at.pan,at.pan]};
}
// What the zone draws with two lanes, in its own coordinates: the background of each lane and where the name of its dev
// stands, the cards, QA and Sign-off at the end, the phases above, an arrow or a dot between two tickets that follow
// each other in a lane, the dependencies (from a lane to the other between the two, over a ticket of its lane on the
// outer side), the masks and the counts of the hidden tickets. `pans` is the place of each lane (lanesPan).
export function lanesLayout({tickets,phases=[],width,pans=[0,0],sel=null,ends:pinned=true}) {
  const list=tickets||[],N=list.length,px=pinX(width),at=new Map(list.map((t,i)=>[t.id,i])),chosen=sel!==null&&at.has(sel)?list[at.get(sel)]:null;
  const lane=list.map(t=>lineDev(list,t)===2?1:0),x0=i=>TWO.left+i*TWO.pitch-pans[lane[i]],cx=i=>x0(i)+TWO.card/2,top=i=>TWO.tops[lane[i]],bottom=i=>top(i)+TWO.height;
  const tone=(from,to)=>!chosen?null:chosen.id===to?'waits':chosen.id===from?'unblocks':null;
  const cards=list.map((t,i)=>({id:t.id,x:x0(i),y:top(i),w:TWO.card,h:TWO.height,lane:lane[i],ring:!chosen?null:chosen.deps.includes(t.id)?'waits':t.deps.includes(chosen.id)?'unblocks':null,sel:chosen?.id===t.id}));
  const ends=pinned?[{key:'qa',x:px,y:TWO.tops[0],w:TWO.pin,h:TWO.height},{key:'signoff',x:px,y:TWO.tops[1],w:TWO.pin,h:TWO.height}]:[];
  const segs=[],heads=[];
  const H=(x1,x2,y,more)=>segs.push({x:Math.min(x1,x2)-1,y:y-1,w:Math.abs(x2-x1)+2,h:2,...more}),V=(x,y1,y2,more)=>segs.push({x:x-1,y:Math.min(y1,y2),w:2,h:Math.abs(y2-y1),...more});
  const down=(x,y,more)=>heads.push({x:x-5,y:y-6,dir:'down',...more}),up=(x,y,more)=>heads.push({x:x-5,y,dir:'up',...more});
  // QA leads to Sign-off.
  const mid=px+Math.round(TWO.pin/2);
  if(pinned){V(mid,ends[0].y+ends[0].h,ends[1].y-5,{tone:null,pin:true});down(mid,ends[1].y-1,{tone:null,pin:true});}
  // Between two tickets that follow each other in the plan and in a lane: an arrow when the next one waits for the one
  // before, a dot when it does not. Nothing between two tickets of two lanes.
  const glyphs=list.slice(0,-1).flatMap((t,i)=>{if(lane[i]!==lane[i+1])return [];const waits=list[i+1].deps.includes(t.id);return [{x:x0(i)+TWO.card,y:top(i)+TWO.height/2-8,w:TWO.glyph,text:waits?'›':'·',tone:waits?tone(t.id,list[i+1].id):null}];});
  const jumps=[],cross=[],byLength=(a,b)=>Math.abs(a.to-a.from)-Math.abs(b.to-b.from)||a.from-b.from||a.to-b.to;
  list.forEach((t,to)=>t.deps.forEach(id=>{const from=at.get(id);if(lane[from]!==lane[to])cross.push({from,to});else if(from!==to-1)jumps.push({from,to});}));
  // Inside a lane: the shortest first, each on the first rail where it crosses none.
  jumps.sort(byLength);
  const taken=RAILS.map(rails=>rails.map(()=>[]));
  for(const jump of jumps) {
    const l=lane[jump.to],a=Math.min(jump.from,jump.to)*TWO.pitch,b=Math.max(jump.from,jump.to)*TWO.pitch,crossed=n=>taken[l][n].filter(([c,d])=>a<d+MARGIN&&c<b+MARGIN).length;
    let rail=RAILS[l].findIndex((_y,n)=>!crossed(n));
    if(rail<0)rail=RAILS[l].map((_y,n)=>n).sort((m,n)=>crossed(m)-crossed(n)||n-m)[0];
    taken[l][rail].push([a,b]);jump.rail=rail;
  }
  // Several arrows into one card on one side stand apart; alone, an arrow lands in the middle, unless a line leaves there.
  const slot=(k,n)=>n<=1?SLOT2[0]:Math.round(SLOT2[0]+k*(SLOT2[1]-SLOT2[0])/(n-1));
  for(const jump of jumps) {
    const same=jumps.filter(j=>j.to===jump.to).sort((m,n)=>m.rail-n.rail),alone=same.length===1&&!jumps.some(j=>j.from===jump.to);
    const y=RAILS[lane[jump.to]][jump.rail],more={tone:tone(list[jump.from].id,list[jump.to].id),pin:false},x1=cx(jump.from),x2=x0(jump.to)+(alone?TWO.card/2:slot(same.indexOf(jump),same.length));
    if(lane[jump.to]===0){V(x1,y,top(jump.from),more);H(x1,x2,y,more);V(x2,y,top(jump.to)-5,more);down(x2,top(jump.to)-1,more);}
    else{V(x1,bottom(jump.from),y,more);H(x1,x2,y,more);V(x2,bottom(jump.to)+5,y,more);up(x2,bottom(jump.to)+1,more);}
  }
  // From a lane to the other: out of the side of the card that faces the other lane, along the space between the two,
  // into the side of the card that faces it. The lines of one ticket share their way (as PRB-147 on the mockup); those
  // of two tickets that would run over each other take two ways.
  cross.sort(byLength);
  for(const c of cross) {
    const same=cross.filter(o=>o.to===c.to).sort((m,n)=>cx(m.from)-cx(n.from)),alone=same.length===1&&!cross.some(o=>o.from===c.to);
    c.x1=cx(c.from);c.x2=x0(c.to)+(alone?TWO.card/2:slot(same.indexOf(c),same.length));
  }
  const ways=MIDS.map(()=>[]);
  for(const c of cross) {
    const a=Math.min(c.x1,c.x2),b=Math.max(c.x1,c.x2),clash=n=>ways[n].filter(o=>o.from!==c.from&&a<o.b+MARGIN&&o.a<b+MARGIN).length;
    let way=MIDS.findIndex((_y,n)=>!clash(n));
    if(way<0)way=MIDS.map((_y,n)=>n).sort((m,n)=>clash(m)-clash(n)||m-n)[0];
    ways[way].push({from:c.from,a,b});
    const y=MIDS[way],more={tone:tone(list[c.from].id,list[c.to].id),pin:false};
    if(lane[c.from]===0)V(c.x1,bottom(c.from),y,more);else V(c.x1,y,top(c.from),more);
    H(c.x1,c.x2,y,more);
    if(lane[c.to]===1){V(c.x2,y,top(c.to)-5,more);down(c.x2,top(c.to)-1,more);}else{V(c.x2,bottom(c.to)+5,y,more);up(c.x2,bottom(c.to)+1,more);}
  }
  // A line in the colour of the ticket chosen is drawn over the grey ones it shares its way with.
  const last=(a,b)=>(a.tone?1:0)-(b.tone?1:0);
  segs.sort(last);heads.sort(last);
  // The phases: one row of headers above the two lanes, as on the mockup, one above each run of tickets. When the two
  // lanes do not stand at the same place (each on its own active ticket), a run is cut where it changes lane, each part
  // above its own tickets, and two headers never stand on each other: those of the lane of Dev 1, which the row stands
  // on, are whole; one of the lane of Dev 2 keeps the widest room they leave it (a card apart), and is left out when
  // that is less than a fade wide. The mockup draws the two lanes at one place only: to be validated by the owner.
  const together=pans[0]===pans[1],runs=phases.flatMap(run=>{if(together)return [run];const out=[];for(let i=run.from;i<=run.to;i++){const part=out.at(-1);if(part&&lane[part.to]===lane[i])part.to=i;else out.push({from:i,to:i,title:run.title});}return out;});
  const header=run=>({x:x0(run.from),w:x0(run.to)+TWO.card-x0(run.from),text:run.title,dashed:false,pin:false}),first=together?[]:runs.filter(run=>lane[run.from]===0).map(header);
  const roomFor=h=>{let free=[[h.x,h.x+h.w]];for(const o of first)free=free.flatMap(([a,b])=>o.x-TWO.gap>=b||o.x+o.w+TWO.gap<=a?[[a,b]]:[[a,o.x-TWO.gap],[o.x+o.w+TWO.gap,b]].filter(([c,d])=>d>c));const [a,b]=free.sort((m,n)=>(n[1]-n[0])-(m[1]-m[0])||m[0]-n[0])[0]||[0,0];return b-a>=TWO.fade?{...h,x:a,w:b-a}:null;};
  const above=runs.map(run=>together||lane[run.from]===0?header(run):roomFor(header(run))).filter(Boolean);
  if(pinned)above.push({x:px,w:TWO.pin,text:P.stages.validate,dashed:true,pin:true});
  // How many tickets are hidden on each side: the cards that are hidden or cut there, lane by lane, each lane standing
  // at its own place. With the two lanes at one place, the count of the line.
  const edge=TWO.left+viewOf(width,TWO),before=cards.filter(c=>c.x<TWO.left).length,after=cards.filter(c=>c.x+c.w>edge).length,box=x=>({x,y:0,w:TWO.fade,h:TWO.host});
  return {cards,ends,glyphs,segs,heads,phases:above,
    lanes:TWO.backs.map((y,l)=>({x:0,y,w:px-12,h:TWO.back,name:{x:TWO.nameX,y:TWO.names[l],w:TWO.nameW}})),
    masks:{gutter:{x:0,y:0,w:TWO.left-4,h:TWO.host},solid:{x:px-12,y:0,w:width-px+12,h:TWO.host},left:before?box(TWO.left-4):null,right:after?box(px-52):null},
    pans:{before:before?{x:TWO.left,y:TWO.pans,count:before}:null,after:after?{x:px-96,y:TWO.pans,count:after}:null}};
}

// ---- The card of a ticket: the same in the line and, later, in the Kanban.
// What waits for the user on a ticket: it is stopped, or something is asked about it.
const waitsOn=(ticket,items)=>waitingOn(items).filter(i=>i.ticket===ticket.id);
const reviewsOf=(ticket,reports)=>(reports||[]).filter(r=>r.ticket===ticket.id&&!r.unreadable&&r.at&&/^review-\d+$/.test(r.kind)).sort(byTime);
const need=ticket=>ticket.difficulty==='heavy'?2:1,numberOf=r=>Number(r.kind.slice(7));
// The verdict of a review: accepted, changes requested, or not known (the engine then still waits for it). An unknown
// verdict is never read as a refusal.
const VERDICTS=['accepted','changes_requested'],judged=r=>VERDICTS.includes(r.verdict);
// The last report of the dev on a ticket, and whether a review counts for it: on its commit and written after it, as
// the engine reads them (a report written again, even on the same commit, asks for a new review).
const lastDev=(ticket,reports)=>(reports||[]).filter(r=>r.ticket===ticket.id&&!r.unreadable&&r.kind==='dev').sort(byTime).at(-1)||null;
const countsFor=(r,dev)=>Boolean(dev)&&r.commit===dev.commit&&String(r.at||'')>=String(dev.at||'');
// Accepted by its reviews, but the merge of its branch was refused and is not done since: not a ticket that is over.
const refusedMerge=ticket=>Boolean(ticket.mergeRefused)&&ticket.state!=='merged';
// The trace of the reviews, read without a legend: an entry for each review, a sign for each round whose verdict is
// known. A review that asked for changes and was not passed since stays open. The rounds are those the engine keeps
// (`history`, lineReviews) when it tells them, else those the reports still hold. `asked`: the reviewer left its verdict
// to the user (screens 18, 19), « ◆ » on the review that runs, open. `text` counts the rounds of a review passed after
// more than one when the card is wide (`wide`), `tight` never (a card of the Kanban in full, To do and Accepted).
export function lineTrace(ticket,reports,{wide=true,asked=false}={}) {
  const two=need(ticket)===2,byReview=new Map(),add=(n,mark)=>byReview.set(n,[...(byReview.get(n)||[]),mark]);
  // A verdict the user decided (M9 review, E5) is his call, « ◆ », whatever the reviewer wrote after it.
  const judgedOnes=Array.isArray(ticket.history)?ticket.history.filter(x=>/^review-\d+$/.test(x.step)&&VERDICTS.includes(x.verdict)).map(x=>({n:Number(x.step.slice(7)),verdict:x.verdict,decided:Boolean(x.decided?.answer)}))
    :reviewsOf(ticket,reports).filter(judged).map(r=>({n:numberOf(r),verdict:r.verdict}));
  for(const r of judgedOnes)add(r.n,r.decided?'◆':r.verdict==='accepted'?'✓':'✗');
  if(asked)add(reviewNow(ticket,reports),'◆');
  return [...byReview.keys()].sort((a,b)=>a-b).map(n=>{const marks=byReview.get(n),closed=marks.at(-1)==='✓',sign=marks.join(' ');
    return {text:P.card.review(two?n:0,sign,wide&&closed?marks.length:1),tight:P.card.review(two?n:0,sign,1),tone:closed?'ok':marks.at(-1)==='◆'?'dec':'fix'};});
}
// The reviews of each ticket round after round, as the engine keeps them (ticket M9, `timings`): each review whose
// verdict is known (null when nothing tells it any more) and the fix of its round, with its delivery and its time. The
// files of the reports are replaced at every round: a review that asked for changes then accepted is told by the engine
// alone. Given to a ticket only when the engine tells the verdicts (an engine of before M9 does not): its reports tell
// its reviews then, as before.
export function lineReviews(tickets,story) {
  const all=story?.timings;
  if(!all||typeof all!=='object')return tickets;
  return tickets.map(t=>{
    const list=(Array.isArray(all[t.id])?all[t.id]:[]).filter(x=>x&&typeof x==='object');
    if(!list.some(x=>/^review-\d+$/.test(x.step)&&'verdict' in x))return t;
    return {...t,history:list.filter(x=>x.step==='fix'||(/^review-\d+$/.test(x.step)&&'verdict' in x))};
  });
}
// The tool of the reviewer of the review that runs, by its name in the mockup (« Codex »).
const reviewerTool=(ticket,reports)=>W.toolNames[ticket.dev]?W.toolNames[reviewerFor(ticket.dev,reviewNow(ticket,reports))?.tool]||'':'';
// The review that runs on a ticket in review: the first of those it needs that its last delivery has not passed.
function reviewNow(ticket,reports) {
  const dev=lastDev(ticket,reports),passed=new Set(reviewsOf(ticket,reports).filter(r=>countsFor(r,dev)&&r.verdict==='accepted').map(numberOf));
  for(let n=1;n<=need(ticket);n++)if(!passed.has(n))return n;
  return need(ticket);
}
// The card: its order, its identifier, its badges, its title, its difficulty, the trace of its reviews, its state and
// who is on it. Its look says the state: plain or heavy (to do), run (an agent works), blk (stopped, or its merge
// refused: the mockup draws no state for that one, the red of « Blocked » is the nearest), you (the user is waited for),
// ok (accepted), fused (integrated by another ticket, or canceled). `span` is how long its dev has run; a ticket stopped
// says instead for how long it has been stopped, from the instant of its stop at `now`, as the banner and the details. `paused`: the
// development is in pause (screen 11): the ticket in hand keeps its look and says « Paused », nobody being at work on it.
// Who is on it, as the mockup draws it: the badge of its dev while it develops, fixes, is stopped, or waits for an answer
// of the user to a question of the dev (a copy, a mockup, a permission); none while the user decides a verdict or answers
// the Lead; in review the dashed « Reviewer » tag with the tool of its reviewer (`reviewer`), which pulses while it reads.
// The tickets that drift from the plan approved (M7, `drift` of the engine), marked for their card, the legend and the
// details (screen 19). A ticket removed from the plan is not on the line; nothing told, nothing marked.
export function lineDrift(tickets,story) {
  const ids=new Set((Array.isArray(story?.drift)?story.drift:[]).filter(d=>d&&d.ticket&&d.kind!=='removed').map(d=>d.ticket));
  return ids.size?tickets.map(t=>ids.has(t.id)?{...t,drift:true}:t):tickets;
}
export function lineCard(ticket,{stage='prepare',reports=[],items=[],span='',wide=true,dev=1,paused=false,now=Date.now()}={}) {
  const waits=waitsOn(ticket,items),stuck=waits.some(i=>i.type==='stuck'),asks=waits.filter(i=>i.type!=='stuck'),prepare=stage==='prepare',hand=IN_HAND.includes(ticket.state);
  const badges=[];
  if(prepare&&asks.length)badges.push({text:'?',tone:'you',tip:P.card.tip.question});
  if(ticket.drift===true)badges.push({text:'≠',tone:'you',tip:P.card.tip.drift});
  if(ticket.texts?.length)badges.push({text:'T',tone:null,tip:P.card.tip.copy});
  const tag=ticket.difficulty==='heavy'?{text:P.card.heavy,heavy:true}:ticket.difficulty==='light'?{text:P.card.light,heavy:false}:null;
  const asked=!prepare&&ticket.state==='review'&&asks.some(i=>i.kind==='verdict');
  const card={id:ticket.id,order:ticket.order??'',title:String(ticket.title||''),badges,tag,trace:ticket.state==='todo'||!ticket.state?[]:lineTrace(ticket,reports,{wide,asked})};
  const still=paused&&hand&&!prepare,say=(look,word='',sub='',avatar=null)=>({...card,look,word:still&&word?P.card.paused:word,sub,avatar:still&&avatar?{...avatar,live:false}:avatar}),d1=live=>({text:'D'+dev,live});
  if(ticket.state==='canceled')return say('fused',P.card.canceled);
  if(ticket.delivery==='integrated')return prepare?say('fused'):say('fused',P.card.merged,ticket.integratedBy?P.card.into(ticket.integratedBy):'');
  if(prepare)return say(ticket.difficulty==='heavy'?'heavy':'plain');
  if(OVER.includes(ticket.state))return refusedMerge(ticket)?say('blk',W.ticket.mergeRefused):say('ok',P.card.accepted);
  if(hand&&stuck)return say('blk',P.card.blocked,stuckSpan(waits.find(i=>i.type==='stuck'),{now}),d1(false));
  // In review the dev waits for its reviewer: a ticket waited for then never shows a dev in place of the reviewer (M9).
  const ofDev=ticket.state!=='review'&&(!asks.length||asks.some(i=>askedBy(i)==='dev'||['copy','mockup'].includes(i.kind)||i.type==='authorization'));
  // A reviewer that asks a question waits for its answer (M9 review, E6, decision 96 of the owner): its tag stays, dimmed,
  // not reading. A verdict left to the user or a question of the Lead shows none (mockup, screens 17 to 19).
  // Who asks, as the engine says it (the recipient of the request: `review-1`, `review-2`), or as the simulation does.
  const reviewerAsks=ticket.state==='review'&&!asks.some(i=>i.kind==='verdict')&&(asks.some(i=>askedBy(i)==='reviewer')||(!asks.length&&Boolean(ticket.waitingAnswer)));
  if(hand&&(asks.length||ticket.waitingAnswer)&&reviewerAsks)return {...say('you',P.card.waiting,P.card.question,null),reviewer:{text:P.card.reviewer(reviewerTool(ticket,reports)),live:false,off:true}};
  if(hand&&(asks.length||ticket.waitingAnswer))return say('you',P.card.waiting,asks.some(i=>i.kind==='verdict')?P.card.verdict:asks.some(i=>i.kind==='copy')?P.card.copyChoice:asks.some(i=>i.kind==='mockup')?P.card.mockupChoice:asks.some(i=>i.type==='decision')||(!asks.length&&ticket.waitingAnswer)?P.card.question:'',ofDev?d1(true):null);
  if(ticket.state==='dev')return say('run',P.card.inDev,span||'',d1(true));
  if(ticket.state==='fix')return say('run',P.card.fixing,P.card.round((ticket.rounds||1)+1),d1(true));
  if(ticket.state==='review'){const now=reviewNow(ticket,reports);
    return {...say('run',P.card.inReview,need(ticket)===2?P.card.ofTwo(now):''),reviewer:{text:P.card.reviewer(reviewerTool(ticket,reports)),live:!still}};}
  return say(ticket.difficulty==='heavy'?'heavy':'plain');
}
// At the end of the line: QA, then Sign-off, and where each stands (a single ticket: its review, then Sign-off). How many flows the QA has played while it runs is
// not known yet: no count is said then. While the Lead breaks the issue down (Prepare, its terminal at work), neither is
// drawn: the mockup shows them once the plan is ready (screens 01 and 04).
export function lineEnds({mission,qa=null,lead=null}) {
  if(stageOf(mission)==='prepare'&&lead?.status==='working')return [];
  const stage=stageOf(mission),{total,accepted}=pageCount(mission),plan=qa?.plan||[],marks=qa?.marks||{};
  const passed=plan.filter(t=>t.auto==='ok').length,left=plan.filter(t=>!['ok','ko'].includes(marks[t.id]?.result)).length;
  const end=(key,title,sub,[look,word],count='')=>({key,title,sub,look,word,count});
  const mine=plan.filter(t=>t.auto!=='ok'),checked=mine.filter(t=>['ok','ko'].includes(marks[t.id]?.result)).length;
  const qaCount=plan.length?P.card.passedOf(passed,plan.length):'',signCount=mine.length?P.card.checkedOf(checked,mine.length):'';
  const QA=stage==='prepare'?['next','']:stage==='develop'?(total>0&&accepted===total?['start',P.card.starting]:['next',P.card.upcoming]):plan.length?['ok',P.card.doneAll]:stage==='closed'?['ok','']:['start',''];
  const SIGN=stage==='prepare'?['next','']:stage==='closed'?['ok',P.card.closed]:stage==='develop'||!plan.length?['next',P.card.upcoming]:left?['you',P.card.yourTurnWord]:['ok',P.card.doneAll];
  // A single ticket has no QA agent: its one review stands in its place (screens 37, 38, 39).
  if(mission?.plan?.simple===true){const t=(mission.tickets||[])[0],done=total>0&&accepted===total;
    const REVIEW=stage==='prepare'?['next','']:done||stage!=='develop'?['ok',P.card.accepted]:t?.state==='review'?['run',P.card.running]:['next',P.card.upcoming];
    return [end('review',P.card.reviewEnd,P.card.reviewEndSub,REVIEW),end('signoff',P.card.signoff,P.card.signoffSub,SIGN,signCount)];}
  return [end('qa',P.card.qa,P.card.qaSub,QA,qaCount),end('signoff',P.card.signoff,P.card.signoffSub,SIGN,signCount)];
}
// The head of the plan: how many tickets; in Prepare how they will run (one at a time, on which branch, by Dev 1 and
// its tool, then Dev 2 and its own when the plan has two devs: `devs`); from Develop how many are accepted, one segment
// for each ticket.
export function lineHead({mission,lead=null,items=[]}) {
  const stage=stageOf(mission),all=(mission?.tickets||[]).length,due=dueTickets(mission),{total,accepted}=pageCount(mission);
  if(!all)return {count:'',facts:null,progress:null};
  const devs=lineDevs(lineTickets({tickets:due,plan:mission?.plan})).map(d=>({badge:d.badge,name:d.name,tool:d.label}));
  const facts=stage==='prepare'?{line:P.plan.oneAtATime,branch:mission.branch||null,dev:devs[0],devs}:null;
  const mine=waitingOn(items).filter(i=>!i.mission||i.mission===mission.id),seg=t=>refusedMerge(t)?'blk':OVER.includes(t.state)?'ok':!IN_HAND.includes(t.state)?'':mine.some(i=>i.ticket===t.id&&i.type==='stuck')?'blk':mine.some(i=>i.ticket===t.id)?'you':'run';
  return {count:stage==='prepare'&&lead?.status==='working'?P.band.written(all):P.plan.tickets(all),facts,progress:stage!=='prepare'&&total>0?{text:P.band.accepted(accepted,total),segs:lineTickets({tickets:due}).map(seg)}:null};
}
// A ticket answers a filter of the legend (Prepare).
export const lineMatches=(ticket,filter,items=[])=>!filter||(filter==='heavy'?ticket.difficulty==='heavy':filter==='light'?ticket.difficulty==='light':filter==='copy'?ticket.texts?.length>0:filter==='question'?waitsOn(ticket,items).some(i=>i.type!=='stuck'):true);
// The legend: only what is on the line. In Prepare an entry filters the line.
export function lineLegend({tickets,cards,stage}) {
  const prepare=stage==='prepare',shown=(tickets||[]).filter(t=>t.delivery!=='integrated'&&t.state!=='canceled'),marks=(cards||[]).flatMap(c=>c.trace.map(t=>t.text)).join(' '),out=[],by=key=>prepare?key:null;
  if(shown.some(t=>t.difficulty==='heavy'))out.push({kind:'tag',glyph:P.card.heavy,heavy:true,text:prepare?P.legend.heavyPrepare:P.legend.heavyDevelop,filter:by('heavy')});
  if(shown.some(t=>t.difficulty==='light'))out.push({kind:'tag',glyph:P.card.light,heavy:false,text:'',filter:by('light')});
  if(prepare&&shown.some(t=>t.difficulty==='standard'))out.push({kind:'text',glyph:'',text:P.legend.standard,filter:null});
  if(shown.some(t=>t.texts?.length))out.push({kind:'badge',glyph:'T',tone:null,text:prepare?P.legend.copyPrepare:P.legend.copyDevelop,filter:by('copy')});
  if((cards||[]).some(c=>c.badges.some(b=>b.text==='?')))out.push({kind:'badge',glyph:'?',tone:'you',text:P.legend.question,filter:by('question')});
  if((cards||[]).some(c=>c.badges.some(b=>b.text==='≠')))out.push({kind:'badge',glyph:'≠',tone:'you',text:P.legend.drift,filter:null});
  if(marks.includes('✓'))out.push({kind:'mark',glyph:'✓',tone:'ok',text:P.legend.accepted,filter:null});
  if(marks.includes('✗'))out.push({kind:'mark',glyph:'✗',tone:'fix',text:P.legend.changes,filter:null});
  if(marks.includes('◆'))out.push({kind:'mark',glyph:'◆',tone:'dec',text:P.legend.yourCall,filter:null});
  if((cards||[]).some(c=>c.reviewer?.live))out.push({kind:'reviewer',glyph:P.card.reviewer(''),tone:null,text:P.legend.reviewing,filter:null});
  return out;
}

// ---- The details of a ticket, in the column on the right.
export const lineStep=(tickets,id,by)=>{const list=tickets||[],at=list.findIndex(t=>t.id===id);return at<0?null:list[(at+by+list.length)%list.length].id;};
// What the ticket went through, from the reports of the agents: its steps (no time is known for them yet), the remarks
// of the review that asked for changes, its commits (each with its message when the report of the dev names it, else its
// hash alone), the tests the dev says it ran (when its report says so); then what the screen of before showed and the mockup has no place
// for: what was done, the reviews of the last delivery, and the reports in full.
// `times` (the details, M9 review): the steps of the engine (`given`), how long the dev at work has run (`span`) and the
// total time of the ticket when the engine knows it (`total`, minutes): each line then says its time (`time`), as the
// mockup at its right, and the end of an accepted ticket its total time. Nothing stands for a time nobody knows.
function timelineOf(ticket,reports,card,items=[],keyed=false,dev=1,times=null) {
  // A ticket canceled keeps what its reports tell, then is said canceled: nothing runs on it, nothing is to come.
  const canceled=ticket.state==='canceled';
  if(!canceled&&(ticket.state==='todo'||!ticket.state))return {empty:P.detail.notStarted};
  const own=(reports||[]).filter(r=>r.ticket===ticket.id&&!r.unreadable&&r.at).sort(byTime),devs=own.filter(r=>r.kind==='dev'),last=devs.at(-1)||null,two=need(ticket)===2,dev1=P.who.dev(dev);
  const reviewer=n=>{const by=reviewerFor(ticket.dev,n);return [W.toolNames[by?.tool],by?.model].filter(Boolean).join(' · ');},numbered=n=>two?n:0,steps=[],over=OVER.includes(ticket.state);
  const delivered=devs.length>0||over||ticket.state==='review'||ticket.state==='fix';
  if(!canceled||devs.length)steps.push({sign:delivered?'✓':'●',tone:delivered?'ok':card.look==='blk'?'bad':card.look==='you'?'you':'run',text:P.detail.inDev(dev1),sub:delivered?'':P.detail.running,key:'dev',running:!delivered});
  const reviews=own.filter(r=>/^review-\d+$/.test(r.kind));let round=1;
  // The reviewer, and how many remarks a review that asked for changes made when its report still says it (« Codex ·
  // gpt-6.1-sol · 2 remarks »).
  // The count the engine keeps for the round (M9 review, E4) comes first: the report is replaced at the next round.
  const told=(n,r,kept=null)=>{const count=Number.isInteger(kept)&&kept>0?kept:r?.verdict==='changes_requested'?reportDigest(r.summary).remarks.length:0;return [reviewer(n),count?P.detail.remarkCount(count):''].filter(Boolean).join(' · ');};
  if(Array.isArray(ticket.history)) {
    // The rounds the engine keeps (ticket M9): every review whose verdict is known, and the fix of each round, each with
    // its delivery and its own time (`timed`), though the files hold only the last round. A verdict nothing tells any
    // more adds no step.
    const fixes=ticket.history.filter(x=>x.step==='fix').length;let fix=0;
    for(const x of ticket.history){
      if(x.step==='fix'){fix+=1;round+=1;const fixing=ticket.state==='fix'&&fix===fixes;
        steps.push({sign:fixing?'●':'✓',tone:fixing?'run':'ok',text:P.detail.fixing(dev1),sub:fixing?P.detail.roundRunning(round):P.detail.round(round),key:'fix',running:fixing,timed:x});continue;}
      if(!VERDICTS.includes(x.verdict))continue;
      const n=Number(x.step.slice(7)),ok=x.verdict==='accepted',r=reviews.find(v=>v.kind===x.step&&v.commit===x.commit&&judged(v)&&(!x.delivered||String(v.at)>=String(x.delivered)));
      // A verdict the user decided stays his (M9 review, E5): « your call », and what he decided (screen 19).
      if(x.decided?.answer){steps.push({sign:'◆',tone:'you',text:P.strip.yourCall(numbered(n)),sub:P.detail.decided(lowerFirst(x.decided.answer)),key:x.step,timed:x});continue;}
      steps.push({sign:ok?'✓':'✗',tone:ok?'ok':'fix',text:(ok?P.detail.reviewAccepted:P.detail.reviewChanges)(numbered(n)),sub:ok?reviewer(n):told(n,r,x.remarks),key:x.step,timed:x});
    }
    // Being fixed, and the engine says no fix for it yet: the fix under way all the same, with no time of its own.
    if(ticket.state==='fix'&&steps.at(-1)?.key!=='fix')steps.push({sign:'●',tone:'run',text:P.detail.fixing(dev1),sub:P.detail.roundRunning(round+1),key:'fix',running:true});
  }
  // A review whose verdict is not known adds no step: the engine still waits for it.
  else reviews.forEach((r,i)=>{
    const n=numberOf(r);
    if(!judged(r))return;
    if(r.verdict==='accepted'){steps.push({sign:'✓',tone:'ok',text:P.detail.reviewAccepted(numbered(n)),sub:reviewer(n),key:'review-'+n,delivery:r.commit,at:r.at});return;}
    round+=1;
    const fixing=ticket.state==='fix'&&i===reviews.length-1;
    steps.push({sign:'✗',tone:'fix',text:P.detail.reviewChanges(numbered(n)),sub:told(n,r),key:'review-'+n,delivery:r.commit,at:r.at});
    if(!canceled||devs.some(d=>String(d.at)>String(r.at)))steps.push({sign:fixing?'●':'✓',tone:fixing?'run':'ok',text:P.detail.fixing(dev1),sub:fixing?P.detail.roundRunning(round):P.detail.round(round),key:'fix',running:fixing,delivery:r.commit,at:r.at});
  });
  const now=ticket.state==='review'?reviewNow(ticket,reports):0;
  // A review that leaves its verdict to the user: the step says so, the reviewer reads no more (screen 18).
  const call=now>0&&waitsOn(ticket,items).some(i=>i.kind==='verdict');
  // A question the Lead asks the user about the ticket while it is reviewed: the step says so (screen 17).
  const asked17=now>0&&!call&&waitsOn(ticket,items).some(i=>i.type==='decision'&&askedBy(i)!=='dev'&&!i.kind);
  if(call)steps.push({sign:'◆',tone:'you',text:P.strip.yourCall(numbered(now)),sub:reviewer(now),key:'review-'+now,running:true,delivery:last?.commit,delivered:last?.at});
  else if(asked17)steps.push({sign:'?',tone:'you',text:P.strip.leadAsks(numbered(now)),sub:P.who.waitingAnswer,key:'review-'+now,running:true,delivery:last?.commit,delivered:last?.at});
  else if(now)steps.push({sign:'R',tone:'run',text:P.detail.reviewRunning(now,two),sub:[reviewer(now),P.detail.reading].filter(Boolean).join(' · '),key:'review-'+now,running:true,delivery:last?.commit,delivered:last?.at});
  const total=times&&over&&!refusedMerge(ticket)?minutesText(times.total):'';
  if(canceled)steps.push({sign:'–',tone:null,text:P.card.canceled,sub:''});
  else if(over)steps.push(refusedMerge(ticket)?{sign:'!',tone:'bad',text:W.ticket.mergeRefused,sub:''}:{sign:'✓',tone:'ok',text:P.detail.accepted,sub:total?P.detail.totalTime:'',...(total?{time:total}:{})});
  else{
    const passed=new Set(reviews.filter(r=>countsFor(r,last)&&r.verdict==='accepted').map(numberOf));
    for(let n=1;n<=need(ticket);n++)if(n!==now&&!passed.has(n))steps.push({sign:'·',tone:null,text:P.detail.review(numbered(n)),sub:P.detail.upNext});
  }
  const asked=reviews.filter(r=>r.verdict==='changes_requested').at(-1)||null,mine=reviews.filter(r=>countsFor(r,last));
  const titleOf=r=>(r.verdict==='accepted'?P.detail.reviewAccepted:r.verdict==='changes_requested'?P.detail.reviewChanges:P.detail.review)(numbered(numberOf(r)));
  // Each line its time, in the details: the one of its step of the engine, else, for the dev or the fix under way, how
  // long the dev has run; a step the engine gives without a time has none.
  const withTime=s=>{if(!times||s.time)return s;const time=stepTime(s,times.given),took=Number.isFinite(time?.minutes)?minutesText(time.minutes):time?'':s.running&&['dev','fix'].includes(s.key)?times.span||'':'';return took?{...s,time:took}:s;};
  const timedSteps=steps.map(withTime);
  return {title:over||canceled?(total?P.detail.stepsTotal(total):P.detail.steps):P.detail.stepsRunning,steps:keyed?timedSteps:timedSteps.map(({key:_key,running:_running,delivery:_delivery,at:_at,delivered:_delivered,timed:_timed,...step})=>step),remarks:asked?reportDigest(asked.summary).remarks:[],
    commits:[...new Map(devs.flatMap(r=>{const named=(Array.isArray(r.commits)?r.commits:[]).filter(c=>c&&typeof c.commit==='string'&&c.commit);return named.length?named.map(c=>({hash:c.commit.slice(0,7),text:String(c.message||'')})):r.commit?[{hash:String(r.commit).slice(0,7),text:''}]:[];}).map(c=>[c.hash,c])).values()],
    tests:typeof last?.tests==='string'&&last.tests.trim()?last.tests.trim():null,
    done:last?.summary?reportDigest(last.summary).head:null,
    reviews:mine.map(r=>({title:titleOf(r),by:reviewer(numberOf(r)),text:reportDigest(r.summary).head})),
    full:last?[{title:dev1,facts:[W.toolNames[ticket.dev],last.repo,last.commit?String(last.commit).slice(0,8):null].filter(Boolean),text:String(last.summary||'')},
      ...mine.map(r=>({title:titleOf(r),facts:[reviewer(numberOf(r))].filter(Boolean),text:String(r.summary||'')}))]:[]};
}
// How many tokens: « 490k », « 2.1M », a real zero « 0 » (M13). As the page says a count (decision 106): an estimate when
// the engine marks it so (`tokens.estimate`, « ≈ 490k »), « Unknown » when it gives null (an agent it cannot read, and
// every total that agent is part of), never 0. A counter the engine does not give at all (undefined) is not said.
export const tokensText=n=>{if(!Number.isFinite(n)||n<0)return '';const k=Math.round(n/1000);return n<1000?String(Math.round(n)):k>=1000?(n/1e6).toFixed(1).replace('.0','')+'M':k+'k';};
export const tokensSaid=(n,estimate)=>Number.isFinite(n)&&n>=0?(estimate?P.tokens.about(tokensText(n)):tokensText(n)):P.tokens.unknown;
// « Token usage · this ticket » (screen 10): its total in and out, then what its dev and its reviewers used, in. A part
// with one launch unknown is « Unknown »; the parts known keep their estimate, never added up to a total of their own.
export function lineTokens(tokens,id) {
  const t=tokens?.tickets?.[id];
  if(!t||typeof t!=='object')return null;
  const estimate=tokens.estimate===true,said=n=>tokensSaid(n,estimate),agents=Array.isArray(t.agents)?t.agents.filter(a=>a&&typeof a==='object'):[];
  const part=test=>{const of=agents.filter(a=>test(String(a.role)));return of.length?of.some(a=>a.state!=='counted'||!Number.isFinite(a.in))?null:of.reduce((n,a)=>n+a.in,0):undefined;};
  const dev=part(r=>r==='dev'),review=part(r=>/^review-\d+$/.test(r));
  const parts=[...(dev!==undefined?[P.tokens.dev(said(dev))]:[]),...(review!==undefined?[P.tokens.review(said(review))]:[])];
  return {title:P.tokens.ticket,text:[P.tokens.total(said(t.in),said(t.out)),...(parts.length?[parts.join(', ')]:[])].join(' · ')};
}
// A ticket not started has no timeline, and so no tokens to tell.
const withTokens=(told,story,id)=>told.empty?told:{...told,tokens:lineTokens(story?.tokens,id)};
// The details of the ticket chosen: where it stands on the line, its chips, what it does (the summary its Lead keeps),
// its expected result, who develops and reviews it, what it waits for and what it unblocks: « nothing » for a ticket in
// the middle, the first and the last being said so. A tab for its technical details and one for its tests and criteria
// when the plan carries them, in the order of the mockup; none otherwise.
export function lineDetail({mission,tickets,id,reports=[],items=[],lead=null,span='',story=null,now=Date.now()}) {
  const list=tickets||[],at=list.findIndex(t=>t.id===id);
  if(at<0)return null;
  const t=list[at],stage=stageOf(mission),prepare=stage==='prepare',dev=lineDev(list,t),card=lineCard(t,{stage,reports,items,span,dev,now}),chips=[];
  // A ticket integrated by another one never ran: it has no timeline, and is not said to wait for its turn.
  const timed=!prepare&&!(t.delivery==='integrated'&&(t.state==='todo'||!t.state));
  if(!prepare)chips.push(!card.word?{text:P.detail.todo,tone:null}:{text:card.word+(card.sub&&card.look!=='ok'?' · '+card.sub:''),tone:{ok:'ok',blk:'bad',you:'you',run:'run'}[card.look]||null});
  if(t.difficulty)chips.push(t.difficulty==='heavy'?{text:P.detail.heavy,tone:'heavy'}:{text:t.difficulty==='light'?P.card.light:P.detail.standard,tone:null});
  if(t.texts?.length)chips.push({text:P.card.tip.copy,tone:null});
  if(waitsOn(t,items).some(i=>i.type!=='stuck'))chips.push({text:P.card.tip.question,tone:'you'});
  if(t.drift===true)chips.push({text:P.card.tip.drift,tone:'you'});
  const tool=W.toolNames[t.dev]||'',first=reviewerFor(t.dev,1),unblocks=list.filter(o=>o.deps.includes(t.id)).map(o=>o.id);
  const rel=(ids,none)=>ids.length?{ids,none:''}:{ids:[],none};
  return {id:t.id,title:t.title,position:P.detail.position(at+1,list.length),chips,tabs:['summary',...(timed?['timeline']:[]),...(t.technical.length?['technical']:[]),...(t.tests.length||t.criteria.length?['criteria']:[])],technical:t.technical,tests:t.tests,criteria:t.criteria,
    what:mission?.tldrs?.[t.id]||null,expected:t.result,
    dev:tool?[P.who.dev(dev),tool,modelShort(t.model),t.effort?P.detail.effort(t.effort):''].filter(Boolean).join(' · '):'',
    reviewer:tool&&t.difficulty?[P.detail.reviews(need(t)),W.toolNames[first.tool],first.model].filter(Boolean).join(' · '):'',
    waits:rel(t.deps,at===0?P.detail.first:P.detail.none),unblocks:rel(unblocks,at===list.length-1?(prepare&&lead?.status==='working'?P.detail.toBeSet:P.detail.last):P.detail.none),
    delivery:t.delivery==='integrated'&&t.integratedBy?P.detail.mergedInto(t.integratedBy):'',
    ...(timed?{timeline:withTokens(timelineOf(t,reports,card,items,false,dev,story?{given:Array.isArray(story.timings?.[t.id])?story.timings[t.id].filter(x=>x&&typeof x==='object'):[],span,total:story.metrics?.[t.id]?.totalMin}:null),story,t.id)}:{})};
}
// The steps of a ticket in hand, for the band under the line: those of its timeline, each with its key (dev, review-1,
// fix) and its delivery (`delivery`, the commit; `at`, the time of its report; for a review under way, `delivered`, the
// time of the report of the dev it reads) so that its own time can be put on it,
// and `running` on the one that is not over.
export const lineSteps=(ticket,{reports=[],items=[],card,dev=1})=>{const told=timelineOf(ticket,reports,card,items,true,dev);return told.empty?[]:told.steps;};
export const reviewsNeeded=need;
