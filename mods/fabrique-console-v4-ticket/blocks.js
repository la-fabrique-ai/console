// Pure rules of the page of a ticket (v2, Claude Design « page d'un ticket »): the band under the line of the tickets
// (one dev), the three blocks at the bottom in Prepare and in Develop, and what a row or a link opens in the column on
// the right (decision 40); with two devs, what the column « Right now » tells in place of the band. Tested with node --test. The strings are those of the mockup (source/Main.dc.html).
// What these zones show that the engine of today does not give is read where simulation/CONTRAT.md says the engine will
// put it; a piece of data that is absent gives an element that is absent, never a value made up.
import {W} from './words.js';
import {modelShort,reviewerFor,LEAD_BUSY} from './view.js';
import {stageOf,pageCount,pageWaits,asker,spanOf,stuckSpan,devOf,dueTickets} from './page.js';
import {dayOf as dayMonth,clockAt,launchBanner} from './nav.js';
import {lineCard,lineSteps,lineDev,lineDevs,lineLanes,lineTickets,reviewsNeeded,minutesText,stepTime,tokensText,tokensSaid} from './line.js';

const P=W.page,S=P.strip,B=P.blocks,H=P.sheet,V=P.environment,IN_HAND=['dev','fix','review'];
// ---- The environment check (M6 b, src/environment-view.mjs). Green only when the engine says `ok: true`; `ok: null`
// only for a project that declares no environment (never green, the launch not held, decision 93). The simulation gives
// the words of the mockup (`failure`, a check `detail`); the engine gives a cause and numbers, worded here.
export const envShown=env=>Boolean(env)&&(typeof env.ok==='boolean'||env.ok===null&&env.state==='not-configured');
const envCause=({cause,detail,pending,missing})=>cause==='MIGRATIONS_PENDING'&&Number.isInteger(pending)?V.pending(pending)
  :cause==='ACCOUNT_MISSING'&&Array.isArray(missing)&&missing.length?V.missing(missing)
  :cause==='DB_UNKNOWN'&&detail==='not-enrolled'?V.notEnrolled:cause==='DB_UNKNOWN'&&['enrollment-stale','enrollment-invalid'].includes(detail)?V.enrollAgain
  :Object.hasOwn(V.causes,String(cause))?V.causes[cause]:V.failed;
export const envFailure=env=>env.failure!=null?String(env.failure):envCause(env);
const envSteps=env=>(Array.isArray(env.checks)?env.checks:[]).filter(c=>c&&V.names[c.key]);
const envReadyText=env=>{const names=envSteps(env).map(c=>V.names[c.key]);return names.length?V.ready(names):B.envReady;};
// A step as the engine runs it (it says its `status`), or as the simulation draws it (its `detail`).
const engineStep=c=>typeof c.status==='string';
const stepSub=c=>c.ok===true?(c.key==='migrations'&&Number.isInteger(c.journal)?V.applied(c.journal):c.key==='accounts'&&c.accounts&&typeof c.accounts==='object'?V.found(Object.keys(c.accounts)):'')
  :c.ok===false?envCause({...c,missing:c.accounts&&typeof c.accounts==='object'?Object.keys(c.accounts).filter(k=>c.accounts[k]===false):null}):c.status==='not-declared'?V.notDeclared:V.notRun;
const listOf=value=>Array.isArray(value)?value.filter(x=>x!==null&&x!==undefined&&x!==''):[];
const textsOf=value=>listOf(value).filter(x=>typeof x==='string'&&x.trim());

// ---- Dates, in the words of the mockup, at the hour of the reader. A day given alone (2026-11-10) is that day here.
export const clockOf=at=>{const d=typeof at==='string'&&at.length>10?dateOf(at):null;return d?clock12(d):'';};
const dateOf=at=>{const day=/^(\d{4})-(\d\d)-(\d\d)$/.exec(String(at??'')),d=day?new Date(Number(day[1]),Number(day[2])-1,Number(day[3])):new Date(at??NaN);return Number.isFinite(d.getTime())?d:null;};
const clock12=d=>((d.getHours()+11)%12+1)+':'+String(d.getMinutes()).padStart(2,'0')+(d.getHours()<12?' am':' pm');
const clock24=d=>String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0');
// ---- « Right now », screen 18: what happened since the last visit, when the engine tells it (simulation/CONTRAT.md:
// overnight.since, the instant of that visit, and overnight.events, the newest first). A verdict left to the user
// opens its request where it is answered, for as long as it waits; a ticket accepted opens its details. The note of a
// line is the one the engine gives. Nothing is made up: without events there is no list.
const SINCE={verdict:'◆',accepted:'✓'};
// A recap that cannot be read (overnight.unavailable, ticket M14) is said so, never drawn as nothing: the title, the
// lines already shown on this page, and the word that it is unavailable.
export function pageSince({overnight=null,asks=[],tickets=[],now=Date.now()}) {
  const ids=new Set((tickets||[]).map(t=>t.id)),rows=[];
  for(const e of Array.isArray(overnight?.events)?overnight.events:[]) {
    if(!e||!SINCE[e.kind]||!ids.has(e.ticket))continue;
    const ask=e.kind==='verdict'?(asks||[]).find(i=>i.id===e.item)||null:null;
    if(e.kind==='verdict'&&!ask)continue;
    rows.push({key:'since-'+rows.length,sign:SINCE[e.kind],tone:ask?'you':'',text:P.side.since[e.kind](e.ticket),at:e.at,sub:[clockOf(e.at),typeof e.note==='string'?e.note.trim():''].filter(Boolean).join(' · '),act:ask?{key:'answer',item:ask}:{key:'ticket',id:e.ticket}});
  }
  if(overnight?.unavailable)return {title:P.side.since.lastVisit,rows,note:P.side.since.unavailable};
  if(!rows.length)return null;
  const from=typeof overnight.since==='string'?dateOf(overnight.since):null,today=new Date(now),eve=new Date(today.getFullYear(),today.getMonth(),today.getDate()-1);
  // The first visit (the engine gives `since: null`, no visit before): « So far », the facts of the mission from its
  // start. A recap that says no instant at all keeps the title of the mockup.
  return {title:overnight.since===null?P.side.since.firstVisit:from&&from.toDateString()===eve.toDateString()?P.side.since.yesterday(clock12(from)):P.side.since.lastVisit,rows};
}
// The recap of this page (ticket M14): what the engine told since its cursor, kept for as long as the page shows the
// same mission. A reading that comes after an acknowledgement (from this page or another) tells nothing new, yet the
// lines stay drawn until the page leaves the mission; a fact told later joins them, each fact once. The recap the
// engine cannot read is said unavailable (`visit.unavailable`), with the lines already shown.
const factKey=e=>e.kind+'|'+e.ticket+'|'+e.at;
export function pageRecap(recap,mission,story) {
  const kept=recap?.mission===mission?recap:null;
  if(!mission||story?.mission?.id!==mission)return kept;
  const told=Array.isArray(story?.overnight?.events)?story.overnight.events:[],seen=new Set((kept?.events||[]).map(factKey));
  const events=[...(kept?.events||[]),...told.filter(e=>e&&!seen.has(factKey(e)))].sort((a,b)=>String(b.at).localeCompare(String(a.at)));
  const since=kept?.since??story?.overnight?.since??null,unavailable=Boolean(story?.visit?.unavailable);
  if(!events.length&&!unavailable)return {mission,since,events:[]};
  return {mission,since,events,accepted:events.filter(e=>e.kind==='accepted').length,...(unavailable?{unavailable:true}:{})};
}
// The recap as pageSince and the band read it: nothing while it holds no fact and is readable.
export const recapShown=recap=>recap&&(recap.events.length||recap.unavailable)?recap:null;
// The acknowledgement the page owes (mission-visit-seen): only for lines drawn on a page that is visible, never for a
// recap the engine could not read, never when no line is drawn. upTo: the instant of the last fact drawn, always a fact
// really drawn (a fact not drawn is never acknowledged past, unless a later one was drawn). Once per showing, then each
// time upTo grows. `visit` is the one of the reading the lines were drawn from.
export function visitAck({mission,visit=null,drawn=[],acked=null,visible=false}) {
  if(!visible||!mission||!visit||visit.unavailable)return null;
  const ats=(Array.isArray(drawn)?drawn:[]).map(r=>r?.at).filter(at=>typeof at==='string'&&Number.isFinite(Date.parse(at)));
  if(!ats.length)return null;
  const upTo=ats.reduce((a,b)=>Date.parse(b)>Date.parse(a)?b:a);
  if(typeof visit.upTo==='string'&&!(Date.parse(upTo)>Date.parse(visit.upTo)))return null;
  if(acked?.mission===mission&&!(Date.parse(upTo)>Date.parse(acked.upTo)))return null;
  return {mission,upTo};
}
// Visible: the page of the ticket is the layout shown, in a window that has the focus (herdr window().active). Herdr has
// no DOM and draws no occlusion: the focus is the signal. Absent or in doubt, the page is not visible.
export const pageVisible=({layout=null,screen=null,win=null}={})=>Boolean(screen)&&layout===screen&&win?.active===true;
// « Nov 12 », « Nov 12 at 3:02 pm », « Nov 12, 2:46 pm », « Nov 11 17:28 ».
export const dayOf=at=>{const d=dateOf(at);if(!d)return '';const [day,month]=dayMonth(d).split(' ');return H.monthDay(month,day);};
export const dayAt=at=>{const d=dateOf(at);return d?H.dayAt(dayOf(at),clock12(d)):'';};
export const dayClock=at=>{const d=dateOf(at);return d?H.dayClock(dayOf(at),clock12(d)):'';};
export const dayHour=at=>{const d=dateOf(at);return d?dayOf(at)+' '+clock24(d):'';};
// When an answer was given, in the words of the mockup: « just now » for the last five minutes, « this morning » for the
// morning of today, else the day and the hour (« Nov 12, 2:46 pm »). Nothing without an instant, never an hour made up.
const JUST_NOW=5*60000;
export function whenOf(at,now=Date.now()) {
  const d=typeof at==='string'&&at.length>10?dateOf(at):null,today=new Date(now);
  if(!d)return '';
  const ago=now-d.getTime(),same=d.getFullYear()===today.getFullYear()&&d.getMonth()===today.getMonth()&&d.getDate()===today.getDate();
  return ago>=0&&ago<JUST_NOW?H.justNow:ago>=0&&same&&d.getHours()<12?H.thisMorning:dayClock(at);
}
// How long, from a number of minutes: « 38 min », « 2 h 04 ». How many tokens: « 490k », « 2.1M ».
// How long and how many, in the words of the mockup: one rule for the band, the column and the details (ui/v4/line.js).
export {minutesText,tokensText};

// A text too long for the lines it is given, cut on a word and ended with the points of suspension, as the mockup does
// (two lines for the title of the band, three for its text). The window has no cut over several lines: the room is
// counted in characters, from the width of the lines.
export function clipText(text,max) {
  const all=String(text??'');
  if(!(max>0)||all.length<=max)return all;
  let cut=all.slice(0,max);
  if(!/\s/.test(all[max])&&/\s/.test(cut))cut=cut.slice(0,cut.search(/\s\S*$/));
  return cut.replace(/[\s,;:.·–-]+$/,'')+'…';
}
// The title of a card, cut as the mockup clamps it (source/pv.css .cd .cl): four lines of 13 on the line and on the
// ticket in large of the Kanban, two lines of 12.5 in a column of the Kanban; one line folded, cut by the window itself.
// The room is counted in characters from the width of the card (half the size of the type for a character, a few lost
// at the end of each line by the wrap): the window has no cut over several lines.
export function cardTitle(text,{w=0,view='line'}={}) {
  if(view==='fold')return String(text??'');
  const [size,lines]=view==='card'?[12.5,2]:[13,4],per=Math.floor((w-18)/(size/2));
  return per>0?clipText(text,lines*per-2*lines):String(text??'');
}
// The room of the band under the line for a width of the zone: its middle keeps the width of the mockup (zone of 1012,
// left part of 300), the left part gives what the menu of the application takes; and how many characters its title
// (two lines of 16) and its text (three lines of 12.5) hold there.
export function stripRoom(width) {
  const left=Math.max(220,Math.min(300,300-(1012-width)));
  return {left,title:Math.floor(2*left/8.1)-6,text:Math.floor(3*left/6.1)-8};
}
// ---- Which moment of the page these zones are drawn for: Prepare, Develop, or « all accepted, the QA starts » (screen
// 21: the tickets are all accepted and the QA has played nothing yet). Later moments belong to the screens to come.
export function pageMoment(mission,story=null) {
  const stage=stageOf(mission),{total,accepted}=pageCount(mission);
  if(stage==='prepare')return 'prepare';
  if(stage==='develop')return total>0&&accepted===total?'starting':'develop';
  // Once the QA runs, it is said starting only while the engine says it has played nothing: a QA whose flows the engine
  // does not tell is not said starting for as long as it runs.
  if(mission?.step==='qa'&&!(story?.qa?.plan?.length)&&story?.flows?.played===0)return 'starting';
  return null;
}
const planOf=mission=>mission?.plan||null,simpleOf=mission=>planOf(mission)?.simple===true;
// The tool of Dev 1 when every ticket has the same: « Claude Code · opus 5.5 ».
function devTool(tickets) {
  const one=values=>{const set=new Set(values.filter(Boolean));return set.size===1?[...set][0]:null;},tool=one(tickets.map(t=>t.dev)),model=tool?one(tickets.map(t=>t.model)):null;
  return [W.toolNames[tool]||'',model?modelShort(model):''].filter(Boolean).join(' · ');
}

// How long the dev at work has run on the ticket in hand, from one source for the card, the chip of the band, its step
// and « Who's working »: the time the engine gives for the dev step when it gives one, else the one of the terminal.
// A dev step the engine says it does not know the time of (minutes null) has none: no other time stands for it.
export function handSpan({ticket=null,story=null,span=''}) {
  const time=ticket?.state==='dev'?listOf(story?.timings?.[ticket.id]).find(x=>x?.step==='dev'):null;
  return Number.isFinite(time?.minutes)?minutesText(time.minutes):time?'':span;
}
// The steps of a ticket in hand and the time of each: the one the engine gives for it, on its own delivery; for
// the step the dev runs, how long its terminal has run when the engine gives no step for it. A step the engine gives
// without a time (minutes null) has none: nothing stands for it. `sub` is what the band writes under a step (its time,
// else what the timeline says of it), `said` what the timeline says, `took` the time alone.
// The engine keeps every round (src/dev-chain.mjs, timingsOf), the timeline only what the files of the reports still
// hold (each file is replaced at every round, and not all at once: after a fix the two reviews of a Heavy ticket start
// again while the file of one still holds its verdict of the round before). So a time goes to the line of its own
// delivery, never by the place of the line (decision 90): the dev step to the dev step; a review or a fix to the step of
// the same kind on the same commit, the last delivery of that commit made before its report (a review under way: the
// one of the same commit and the same time of delivery, the last one, none other). A line whose delivery the engine does not name takes no time from it.
function handSteps({hand,tickets,waits,reports,story,span,now=Date.now()}) {
  const dev=lineDev(tickets,hand),took1=handSpan({ticket:hand,story,span}),card=lineCard(hand,{stage:'develop',reports,items:waits,span:took1,dev,now}),told=lineSteps(hand,{reports,items:waits,card,dev}),given=listOf(story?.timings?.[hand.id]);
  const steps=told.map(s=>{
    const time=stepTime(s,given);
    const took=Number.isFinite(time?.minutes)?minutesText(time.minutes):time?'':s.running&&['dev','fix'].includes(s.key)?span:'';
    return {sign:s.sign,tone:s.tone||null,text:s.text,sub:took||s.sub||'',said:s.sub||'',took,running:Boolean(s.running)};
  });
  return {dev,card,steps};
}
// How long the dev of each ticket in hand has run: `span` for the ticket in hand of the page (one dev: the card, the
// band, the details), `spans` by ticket. With two devs (their lines of « Who's working » name their ticket) each ticket
// takes the time of its own dev, by the terminal of that dev, never the one of the other; the time the engine gives for
// a step comes first, for its ticket alone (`took` is the one of the ticket in hand).
export function pageSpans({hand=null,tickets=[],workers=[],story=null,started={},took='',now=Date.now()}) {
  const devs=workers.filter(w=>w.kind==='dev'),ran=w=>spanOf(started?.[w.address],now),at=devs.find(w=>!w.dim&&w.address),span=took||(at?ran(at):'');
  if(!devs.some(w=>'ticket' in w))return {span,spans:hand?{[hand.id]:span}:{}};
  const spans={};
  for(const w of devs)if(w.ticket&&w.address&&!w.dim)spans[w.ticket]=handSpan({ticket:tickets.find(t=>t.id===w.ticket),story,span:ran(w)});
  if(hand&&took&&!(hand.id in spans))spans[hand.id]=took;
  return {span,spans};
}
// ---- With two devs (screens 40 and 41) the two lanes take the place of the band: what it told of the ticket in hand
// goes to the column « Right now ». « Current ticket · PRB-146 · time per step »: the steps of each ticket in hand, what
// the timeline says under each and its time at the right. `spans` is how long the terminal of the dev of a ticket has
// run ({ticket: time}), used when the engine gives no time for the step.
export function pageCurrent({mission,tickets=[],items=[],reports=[],story=null,spans={}}) {
  if(pageMoment(mission,story)!=='develop')return [];
  const waits=pageWaits(items,mission);
  return tickets.filter(t=>IN_HAND.includes(t.state)).map(hand=>({id:hand.id,title:P.side.current(hand.id),steps:handSteps({hand,tickets,waits,reports,story,span:spans[hand.id]||''}).steps.map(({sign,tone,text,said,took})=>({sign,tone,text,sub:said,time:took}))}));
}
// « Token usage · this issue »: what the issue used since Prepare started, in and out, then one line for each agent
// the engine counts (the Lead, each dev under its name, the reviewers, the QA agent), with a bar for its share. A dev
// is named by its number, as in the plan (`dev`: 1 or 2); by its tool alone when one dev only has that tool. The
// total is the sum of the lines, never another number. Read in `tokens.agents` (simulation/CONTRAT.md); without it,
// nothing is drawn. M13 display (decision 106): the lines of one name are one line (the reviewers, whatever their
// tools); a line named by a tool two devs share belongs to neither: it is drawn as « Devs · Codex », counted in the
// total, never shared out between them (M13 display review 1); a count is an estimate when the engine marks it so
// (« ≈ 236k in »); a line the engine cannot read (null) is « Unknown », without a bar, and so is the total it is part
// of: never 0, never the sum of the lines known.
export function pageTokens({story=null,tickets=[]}) {
  const devs=lineDevs(tickets),num=v=>Number.isFinite(v)&&v>=0,NAME={lead:()=>P.who.lead,reviewer:()=>P.side.reviewers,qa:()=>P.who.qa,dev:a=>{const named=devs.filter(d=>d.tool===a.tool),d=Number.isInteger(a.dev)?devs.find(d=>d.n===a.dev):a.tool?(named.length===1?named[0]:null):devs.length===1?devs[0]:null;if(d)return d.name;if(!devs.length)return P.end.role('dev');return !Number.isInteger(a.dev)&&a.tool&&named.length>1?P.side.devsOf(W.toolNames[a.tool]||a.tool):'';}};
  const given=v=>v===null||num(v),estimate=story?.tokens?.estimate===true,said=n=>tokensSaid(n,estimate);
  const rows=[];
  for(const a of listOf(story?.tokens?.agents).filter(a=>a&&NAME[a.role]&&given(a.in)&&given(a.out))){
    const name=NAME[a.role](a);if(!name)continue;
    const same=rows.find(r=>r.name===name),add=(x,y)=>x===null||y===null?null:x+y;
    if(same){same.in=add(same.in,a.in);same.out=add(same.out,a.out);}else rows.push({name,in:a.in,out:a.out});
  }
  if(!rows.length)return null;
  const most=Math.max(1,...rows.map(r=>r.in??0)),sum=key=>rows.some(r=>r[key]===null)?null:rows.reduce((n,r)=>n+r[key],0);
  return {title:P.side.tokens,in:said(sum('in')),out:said(sum('out')),inWord:P.side.tokensIn,outWord:P.side.tokensOut,note:P.side.tokensNote,
    rows:rows.map(r=>({name:r.name,part:r.in===null?null:r.in/most,in:said(r.in)+' '+P.side.tokensIn,out:said(r.out)+' '+P.side.tokensOut}))};
}
// ---- The band under the line. One of: the ticket in hand (Develop), the QA that starts (all accepted), the path of a
// single ticket, the approach of the Lead and its phases (Prepare, and Develop between two tickets). `tickets` are those
// of the line (lineTickets); `span` is how long the dev at work has run, as its terminal tells it.
export function pageStrip({mission,tickets=[],lead=null,items=[],reports=[],story=null,span='',now:at=Date.now()}) {
  const moment=pageMoment(mission,story);
  // With two devs the two lanes fill the zone: no band is drawn under them (screens 40 and 41).
  if(!moment||lineLanes(tickets))return null;
  const plan=planOf(mission),simple=simpleOf(mission),waits=pageWaits(items,mission);
  const strip=o=>({tone:null,kicker:'',title:'',text:'',chips:[],mid:null,facts:[],button:null,...o});
  const hand=moment==='develop'?tickets.find(t=>IN_HAND.includes(t.state))||null:null;
  if(hand) {
    const {dev,card,steps}=handSteps({hand,tickets,waits,reports,story,span,now:at});
    // A ticket stopped says the time of its stop and only it (M10): never the time of its step, which began before.
    const now=steps.find(s=>s.running),stopped=waits.some(i=>i.type==='stuck'&&i.ticket===hand.id),more=stopped?card.sub:card.sub||now?.took||'',tool=W.toolNames[reviewerFor(hand.dev,1)?.tool]||'',spent=story?.tokens?.tickets?.[hand.id];
    return strip({tone:{blk:'bad',you:'you',ok:'ok'}[card.look]||'run',kicker:simple||!hand.order?S.theTicket(hand.id):S.current(hand.id,hand.order,pageCount(mission).total),title:hand.title,text:hand.result?S.expected(hand.result):'',
      chips:[...(card.word?[{text:card.word+(more?' · '+more:''),tone:{blk:'bad',you:'you',ok:'ok'}[card.look]||'run'}]:[]),...(hand.difficulty==='heavy'?[{text:P.card.heavy,tone:'heavy'}]:[])],
      mid:{title:S.steps,steps:steps.map(({sign,tone,text,sub})=>({sign,tone,text,sub})),bar:null},
      facts:[[P.detail.dev,P.who.dev(dev)],...(hand.dev&&tool?[[P.detail.reviewer,tool]]:[]),...(hand.difficulty?[[S.reviews,reviewsNeeded(hand)===2?S.two:S.one]]:[]),
        // The tokens of the ticket (M13): an estimate, « Unknown » when one of its launches is; not said when not given.
        ...[[S.tokensIn,'in'],[S.tokensOut,'out']].flatMap(([name,key])=>spent&&(spent[key]===null||Number.isFinite(spent[key])&&spent[key]>=0)?[[name,tokensSaid(spent[key],story.tokens.estimate===true)]]:[])],
      button:{key:'ticket',label:S.open,id:hand.id}});
  }
  if(moment==='starting') {
    // A single ticket has no QA agent: its end belongs to the screen of the single ticket.
    if(simple)return null;
    // What the QA passed and the videos it recorded are results: they are said once it has played, never before
    // (the mockup writes « Passed 34 » and « Videos 38 » on screen 21, before any flow: a gap, to be validated).
    const f=story?.flows||null,num=v=>Number.isFinite(v),ran=f?.played>0;
    return strip({tone:'run',kicker:S.qa,title:S.qaStarting,text:S.qaText,
      mid:num(f?.total)&&f.total>0?{title:S.flows(f.total),steps:[...(ran&&num(f.passed)?[{sign:'✓',tone:'ok',text:S.passed,sub:String(f.passed)}]:[]),...(num(f.forYou)?[{sign:'◆',tone:'you',text:S.forYou,sub:String(f.forYou)}]:[])],bar:Array.from({length:f.total},()=>'')}:null,
      facts:[...(ran&&num(f?.videos)?[[S.videos,String(f.videos)]]:[]),...(num(f?.minutes)?[[S.yourTime,S.about(f.minutes)]]:[]),...(num(f?.problems)?[[S.problems,String(f.problems)]]:[])]});
  }
  if(simple&&tickets.length) {
    const t=tickets[0],tool=W.toolNames[reviewerFor(t.dev,1)?.tool]||'',copy=tickets.reduce((n,x)=>n+(x.texts?.length||0),0);
    return strip({kicker:S.theTicket(t.id),title:t.title,text:t.result?S.expected(t.result):'',
      mid:{title:S.path,bar:null,steps:[{text:P.detail.dev,sub:P.who.dev(1)},{text:S.oneReview,sub:t.dev?tool:''},{text:S.yourCheck,sub:Number.isFinite(plan?.points)?S.points(plan.points):''},{text:S.close,sub:''}].map((s,i)=>({sign:String(i+1),tone:null,...s}))},
      facts:[...(Array.isArray(plan?.migrations)?[[S.migration,plan.migrations.length?plan.migrations.join(', '):S.none]]:[]),[S.copy,copy?String(copy):S.none],[S.qaAgent,S.notNeeded]]});
  }
  const approach=plan?.approach||null,phases=listOf(plan?.phases).filter(p=>p?.title);
  if(!approach?.summary&&!phases.length)return null;
  const working=moment==='prepare'&&lead?.status==='working',migrations=textsOf(plan?.migrations);
  return strip({kicker:working?S.leadWorking:S.approach,title:String(approach?.summary||''),text:String(approach?.text||''),
    mid:phases.length?{title:S.phases,bar:null,steps:phases.map((p,i)=>{const n=tickets.filter(t=>t.phase===p.id).length;return {sign:String(i+1),tone:null,text:p.title,sub:n?P.plan.tickets(n):working?S.coming:''};})}:null,
    facts:[[S.execution,S.oneAtATime],...(tickets.length?[[S.heavyTickets,String(tickets.filter(t=>t.difficulty==='heavy').length)]]:[]),...(migrations.length?[[S.migrations,migrations.join(', ')]]:[])],
    button:textsOf(approach?.paragraphs).length?{key:'approach',label:S.readApproach}:null});
}
// The link « Lead's approach › » of the head of the plan: when the approach can be read, and not on a single ticket.
export const approachLink=mission=>!simpleOf(mission)&&textsOf(planOf(mission)?.approach?.paragraphs).length>0;

// ---- The requests of the issue and how the plan covers each: covered by its tickets; else asked to the user by the
// Lead, postponed by the user, not written yet while the Lead works (pending), or left open. A request is one of the
// contract (simulation/CONTRAT.md) only with its words (short or full), as lead-plan keeps them since ticket M3: a plan
// kept before has {id, text}, and such a request is not drawn rather than said « not covered » (ticket M1).
export function coverageOf(mission,lead=null) {
  const working=stageOf(mission)==='prepare'&&lead?.status==='working';
  const list=listOf(planOf(mission)?.requests).filter(r=>r&&r.id&&textsOf([r.short,r.full]).length).map(r=>{const tickets=textsOf(r.tickets);return {...r,tickets,state:tickets.length?'covered':['asked','postponed','pending'].includes(r.state)?r.state:working?'pending':'open'};});
  return {list:[...list.filter(r=>r.state!=='covered'),...list.filter(r=>r.state==='covered')],total:list.length,covered:list.filter(r=>r.state==='covered').length,postponed:list.filter(r=>r.state==='postponed').length};
}
// The copy to write, from the plan: what its Lead lists (title, detail, ticket), else the texts its tickets name. A
// variant chosen by the user is said on its ticket.
function copyOf(mission,story) {
  // The engine gives the decisions the newest first: the first choice met for a ticket is the last one made, unless
  // their instants say otherwise.
  const plan=planOf(mission),chosen=new Map(),stamp=d=>Date.parse(d.at||'');
  for(const d of listOf(story?.decisions).filter(d=>d?.kind==='copy'&&d.variant&&d.ticket)){const kept=chosen.get(d.ticket);if(!kept||stamp(d)>stamp(kept))chosen.set(d.ticket,d);}
  const named=listOf(plan?.toPlan?.copy).filter(c=>c?.title),fromTickets=listOf(plan?.tickets).flatMap(t=>textsOf(t.texts).map(text=>({title:text,section:text,detail:'',ticket:t.id})));
  return (named.length?named.map(c=>({title:c.title,section:c.section||c.title,detail:c.detail||'',ticket:c.ticket||null})):fromTickets).map(c=>({...c,variant:chosen.get(c.ticket)?.variant||null}));
}
const mockupsOf=mission=>listOf(planOf(mission)?.tickets).flatMap(t=>listOf(t.mockups).map(m=>({title:typeof m==='string'?m:String(m?.title||m?.name||m?.file||''),ticket:t.id})).filter(m=>m.title));
const same=(open,t,id=null)=>Boolean(open)&&open.t===t&&(open.id??null)===id;
// What an inbox request is, in the words of a row: a question, a suggestion, a verdict, a choice of copy, a permission.
const askedWord=item=>item?.type==='authorization'?B.asked.permission:B.asked[item?.kind]||B.asked.question;

// ---- The three blocks. Each: its title, its counter (amber when it calls the user), a link, and its rows. A row: its
// sign and the tone of the sign (ok, wait, count, you, bad), its text, a line under it, what is said at its right, its
// look (calm: nothing to click; you; bad; zero: faded), `small` for a row of one line, and what a click opens.
// « Your decisions » lists what waits only when SEVERAL things wait; with one, the banner carries it.
// The confirmation of screen 06 (decision 71), opened by « Approve and start the dev » while the plan is ready: what
// starts (the tickets, the branch the frozen copy writes, the first ticket, its dev, its tool and model), then the frozen
// copy, Cancel and Approve and start. Two temporary exceptions: no « Environment » line (M6), and neither « Allowed to
// devs, locally » nor « Always needs your approval » while the engine does not hold those limits. Null when the plan
// cannot be approved now (the Lead at work, nothing to launch).
export function pageConfirm({mission,lead=null,now=Date.now()}) {
  if(!lead||LEAD_BUSY.includes(lead.status))return null;
  const b=launchBanner(mission,lead,{now});
  if(b?.kind!=='ready'||b.state!=='offer')return null;
  const all=mission?.tickets||[],first=all.filter(t=>t.n!=null).sort((x,y)=>x.n-y.n)[0]||all[0],dev=devOf(mission,first.id);
  const tool=lineDevs(lineTickets({tickets:dueTickets(mission),plan:mission?.plan})).find(d=>d.n===dev)?.label||'';
  const branch=mission?.branch||String(mission?.issue?.identifier||'').toLowerCase(),C=P.confirm;
  return {title:C.title,rows:[{key:'starts',label:C.starts,text:b.total===1?C.one(branch,dev,tool):C.many(b.total,branch,first.id,dev,tool)},{key:'frozen',label:C.frozen,text:C.frozenText}],cancel:C.cancel,go:C.go};
}
// ---- The drift from the plan approved (M7): a ticket by its identifier, a part of the plan by its name on the page,
// what changed in the words of the page (a model by its short name, a tool by its name), with what it was and is.
const driftKey=d=>d.ticket||d.part||'';
const driftName=d=>d.ticket||B.parts[d.part]||String(d.part||'');
// Decision 87: a ticket or a part by what happened to it (« PRB-152 added », « Risks removed »).
const driftHead=d=>d.kind==='added'?B.added(driftName(d)):d.kind==='removed'?B.removed(driftName(d)):d.ticket?B.changed(d.ticket):B.partChanged(driftName(d));
// An entry the engine names by its place (« #2 ») is said « Item 2 » (decision 87).
const entryShown=name=>/^#\d+$/.test(String(name))?B.itemAt(String(name).slice(1)):String(name);
const entriesShown=list=>listOf(list).map(entryShown);
const driftShown=list=>listOf(list).filter(d=>d&&(d.ticket||d.part));
const valueShown=(field,v)=>v==null||v===''?'—':field==='model'?modelShort(String(v))||String(v):['dev','agent','tool'].includes(field)?W.toolNames[v]||String(v):String(v);
// Every change the engine gives, in the block and the box as a summary (decisions 84 and 85): never a field left out,
// never an empty line, never a field name with nothing after it. A part names its own summary without a field
// (« collations → collations, drops »), any other field of it by its name; a list by its entries added, removed and
// changed, and « order changed » when its order moved; a value too long for a line is only named (« result changed »);
// a part added or removed says what it holds in a line, else nothing more; a field of a ticket given without its values
// is named (« dependencies changed »). The whole before and after is in the sheet (driftDetails).
const listed=c=>Array.isArray(c.added)||Array.isArray(c.removed)||Array.isArray(c.changed);
const BRIEF=80,brief=v=>v==null||String(v).length<=BRIEF;
// The engine gives the whole order as soon as a list moves (decision 86); the summary says « order changed » only when
// the entries both lists hold changed places, as before: an insertion or a removal alone is said by its entries.
const moved=c=>{if(!c.order)return false;const from=listOf(c.order.from),to=listOf(c.order.to),both=x=>x.filter(n=>from.includes(n)&&to.includes(n)).join('\u0000');return both(from)!==both(to);};
function changeShown(d,c) {
  const own=Boolean(d.part)&&c.field===d.part,name=own?'':B.fieldNames[c.field]||c.field;
  if(d.part&&['added','removed'].includes(d.kind)&&!own)return '';
  if(listed(c)){
    if(own&&d.kind==='added')return entriesShown(c.added).join(', ');
    if(own&&d.kind==='removed')return entriesShown(c.removed).join(', ');
    return B.entries(name,entriesShown(c.added),entriesShown(c.removed),entriesShown(c.changed),moved(c));
  }
  if(!('from' in c)&&!('to' in c))return B.fieldsChanged([name||B.parts[d.part]||String(c.field)]);
  if(!brief(c.from)||!brief(c.to))return own?(d.kind==='changed'?B.summaryChanged:''):B.fieldsChanged([name]);
  if(own&&d.kind==='added')return valueShown(c.field,c.to);
  if(own&&d.kind==='removed')return valueShown(c.field,c.from);
  return B.change(name,valueShown(c.field,c.from),valueShown(c.field,c.to));
}
function driftWhatOf(d) {
  const changes=listOf(d.changes).filter(c=>c&&c.field),said=changes.map(c=>changeShown(d,c)).filter(Boolean);
  const alone=listOf(d.fields).filter(f=>!changes.some(c=>c.field===f||String(c.field).startsWith(f+'.'))).map(f=>B.fieldNames[f]||f);
  if(alone.length)said.push(B.fieldsChanged(alone));
  const what=B.joinChanges(said);
  if(d.kind==='added')return B.driftHolds(B.driftAdded,d.part?what:'');
  if(d.kind==='removed')return B.driftHolds(B.driftRemoved,d.part?what:'');
  return what||B.somethingChanged;
}
// The before and the after of every change, whole, order included (decision 85), as the sheet of the drift lists them:
// a value by what it was and is, each entry of a list added, removed or changed, the whole order before and after when
// a list moved (decision 86); a ticket removed whose dev still runs says what becomes of it. Nothing for a drift given
// without values.
const cap=t=>t?t.charAt(0).toUpperCase()+t.slice(1):t;
// A field by its name in the sheet, a path (« note.text ») segment by segment (« Note · Text », decision 87).
const fieldLabel=field=>String(field).split('.').map(seg=>cap(B.fieldNames[seg]||seg)).join(' · ');
// A ticket added or removed (decision 86): one line per field, what it is or was (« Tool = Claude Code »), its level
// written as the box writes it.
const ticketValue=(c,v)=>['level','difficulty'].includes(c.field)&&v!=null?P.reconfirm.levels[v]||String(v):valueShown(c.field,v);
function driftDetails(d) {
  const out=[],label=(...p)=>cap(p.filter(Boolean).join(' · ')),said=v=>v==null||v===''?H.nothing:String(v);
  for(const c of listOf(d.changes).filter(c=>c&&c.field)){
    const own=Boolean(d.part)&&c.field===d.part,base=own?'':fieldLabel(c.field);
    if(d.ticket&&['added','removed'].includes(d.kind)){
      const side=d.kind==='added'?'to':'from';
      out.push([label(base),listed(c)?listOf(c.entries).map(e=>e?.[side]).filter(x=>x!=null).join(' | ')||H.nothing:ticketValue(c,c[side])]);
      continue;
    }
    if(listed(c)){
      for(const e of listOf(c.entries).filter(e=>e&&e.name!=null)){
        const name=entryShown(e.name);
        if(e.kind==='added')out.push([label(base,name,H.added),said(e.to)]);
        else if(e.kind==='removed')out.push([label(base,name,H.removed),said(e.from)]);
        else out.push([label(base,name,H.before),said(e.from)],[label(base,name,H.after),said(e.to)]);
      }
      if(c.order)out.push([label(base,H.orderBefore),entriesShown(c.order.from).join(', ')||H.nothing],[label(base,H.orderAfter),entriesShown(c.order.to).join(', ')||H.nothing]);
    }else if('from' in c||'to' in c)out.push([label(base,H.before),valueShown(c.field,c.from)],[label(base,H.after),valueShown(c.field,c.to)]);
  }
  if(d.ticket&&d.kind==='removed'&&d.running===true)out.push([H.itsDev,H.devRunning]);
  return out;
}
// The confirmation of the changes approved after the approval (decision 81): the box of screen 06, drawn by the same
// file (dialog.js), with what is approved, ticket by ticket (its development settings: the tool, the model, the
// effort and the level; a ticket removed: no further development, review or merge) and part by part, then the frozen copy. It sends the version of the drift it
// drew (`seen`), and only that one. Null when the engine names no version to approve.
export function pageReconfirm({story=null}) {
  const seen=typeof story?.driftSeen==='string'&&story.driftSeen?story.driftSeen:null,drift=driftShown(story?.drift);
  if(!seen||!drift.length)return null;
  const R=P.reconfirm,C=P.confirm;
  const values=v=>[W.toolNames[v?.tool]||v?.tool||'',v?.model?modelShort(v.model):'',v?.effort?R.effort(v.effort):'',R.levels[v?.level]||''].filter(Boolean).join(' · ');
  const text=d=>{
    if(d.summary!=null)return String(d.summary);
    const what=driftWhatOf(d);
    // Decision 85: a ticket removed whose dev still runs is said to stop after this turn (words of decision 87).
    if(d.ticket&&d.kind==='removed')return what+' · '+(d.running===true?R.stopsAfter:R.never);
    const v=d.ticket?values(d.values):'';
    return v?what+' · '+R.settings(v):what;
  };
  // The box keeps a summary; the whole before and after is in the sheet it opened from (decision 85).
  return {title:R.title,rows:[...drift.map(d=>({key:'drift-'+driftKey(d),label:driftName(d),text:text(d)})),{key:'details',label:R.detailsLabel,text:R.details},{key:'frozen',label:C.frozen,text:R.frozenText}],cancel:C.cancel,go:R.go,seen};
}
export function pageBlocks({mission,lead=null,items=[],story=null,open=null,sent=[]}) {
  const moment=pageMoment(mission,story);
  if(!moment)return null;
  const prepare=moment==='prepare',plan=planOf(mission),simple=simpleOf(mission);
  const row=o=>({sign:'',signTone:'count',text:'',sub:'',right:B.go,rightMono:false,look:'',small:false,open:null,act:null,selected:false,...o}),pick=(t,id=null)=>({open:{t,id},selected:same(open,t,id)});
  // Left: the answers of the user, the newest first; above them what waits, when several things wait.
  // A stop holds the band of Develop (M10 review): that band has no « Answer », so even one request waits here, in its row.
  const every=pageWaits(items,mission),waits=every.filter(i=>i.type!=='stuck'),held=!prepare&&every.some(i=>i.type==='stuck'),many=waits.length>1||(held&&waits.length>0),taken=listOf(story?.decisions).filter(d=>d&&d.id&&d.short);
  const line=lineTickets(mission),devOf=i=>lineDev(line,line.find(t=>t.id===i.ticket));
  // An answer given on this page is said at once, above the others, until the engine lists its decision (`item`).
  const fresh=listOf(sent).filter(x=>x&&x.id&&!taken.some(d=>d.item===x.id)).map(x=>row({key:'sent:'+x.id,sign:'✓',signTone:'ok',text:String(x.short||''),right:String(x.said||''),small:true}));
  const settled=[...fresh,...taken.map(d=>row({key:'decision:'+d.id,sign:'✓',signTone:'ok',text:d.short,right:String(d.said||''),small:true,...pick('decision',d.id)}))];
  // A row that waits opens its request in the column on the right, where it is answered, and is marked while open.
  const asked=waits.map(i=>row({key:'wait:'+i.id,sign:i.kind==='suggestion'?'→':'?',signTone:'you',text:String(i.short||i.title||''),sub:B.askedBy(askedWord(i),asker(i,devOf(i))),right:B.answer,look:'you',act:{key:'answer',item:i},selected:same(open,'ask',i.id)}));
  const left={key:'decisions',title:many?B.waiting:B.decisions,count:many?String(waits.length):settled.length?String(settled.length):'',countTone:many?'you':null,tone:many?'you':null,link:null,
    rows:many?[...asked,...settled]:[...(waits.length?[]:[row({key:'nothing',sign:'✓',signTone:'ok',text:B.nothing,right:'',look:'calm',small:true})]),...settled]};
  // Middle. Prepare: each request of the issue and the tickets that cover it. Develop: the drift from the plan approved,
  // its frozen copy, and the coverage in one row. Drift is said (or said absent) only when the engine tells it.
  const cover=coverageOf(mission,lead),short=id=>String(id).replace(/^[A-Za-z][A-Za-z0-9]*-/,''),middle={key:prepare?'coverage':'drift',title:prepare?B.coverage:B.drift,count:'',countTone:null,tone:null,link:null,rows:[]};
  if(prepare) {
    if(cover.total){middle.count=B.covered(cover.covered,cover.total);middle.countTone=cover.covered<cover.total?'you':null;}
    if(!simple&&issueOf(mission,story))middle.link={label:B.readIssue,...pick('issue')};
    middle.rows=cover.list.map(r=>r.state==='covered'?row({key:'request:'+r.id,sign:'✓',signTone:'ok',text:r.short,right:r.tickets.map(short).join(' · '),rightMono:true,small:true,...pick('request',r.id)})
      :r.state==='pending'?row({key:'request:'+r.id,sign:'…',signTone:'wait',text:r.short,right:B.noTicketYet,small:true,...pick('request',r.id)})
      :row({key:'request:'+r.id,sign:'◆',signTone:'you',text:r.short,sub:r.state==='asked'?B.leadAsks:r.state==='postponed'?B.postponed(dayOf(r.postponedAt)):'',right:B.notCovered,look:'you',...pick('request',r.id)}));
  } else {
    const drift=Array.isArray(story?.drift)?driftShown(story.drift):null;
    if(drift?.length){middle.count=String(drift.length);middle.countTone='you';middle.rows.push(...drift.map(d=>row({key:'drift:'+driftKey(d),sign:'≠',signTone:'you',text:driftHead(d),sub:d.summary!=null?String(d.summary):d.kind?B.driftWhen(driftWhatOf(d),d.at?dayAt(d.at):''):'',...pick('list','drift')})));}
    else if(drift)middle.rows.push(row({key:'no-drift',sign:'✓',signTone:'ok',text:B.noDrift,right:'',look:'calm',small:true}));
    if(story?.approval?.at&&dayAt(story.approval.at))middle.rows.push(row({key:'frozen',sign:'❏',signTone:'wait',text:B.frozen,sub:B.approvedOn(dayAt(story.approval.at)),...pick('frozen')}));
    if(cover.total)middle.rows.push(row({key:'coverage',sign:cover.covered<cover.total?'◆':'✓',signTone:cover.covered<cover.total?'you':'ok',text:B.coverage,sub:B.requests(cover.covered,cover.total,cover.postponed),...pick('list','coverage')}));
  }
  // Right: what to plan for. A row is drawn when its data is known; a list known to be empty is faded.
  const rows=[],env=story?.environment||null,toPlan=plan?.toPlan||{},counted=(key,title,n,sub)=>row({key,sign:String(n),text:title,sub,look:n?'':'zero',...pick('list',key)});
  // A check running (started here or elsewhere): neither green nor failed, the launch held until it ends (review 1).
  if(envShown(env))rows.push(env.ok===true?row({key:'env',sign:'✓',signTone:'ok',text:B.environment,sub:envReadyText(env),...pick('list','env')})
    :env.ok===false&&env.state==='checking'?row({key:'env',sign:'…',signTone:'wait',text:B.environment,sub:B.startHeld(V.checking),...pick('list','env')})
    :env.ok===false?row({key:'env',sign:'!',signTone:'bad',text:B.environment,sub:B.startHeld(envFailure(env)),look:'bad',...pick('list','env')})
    :row({key:'env',sign:'–',signTone:'wait',text:B.environment,sub:V.notConfigured,...pick('list','env')}));
  if(toPlan.manual){const n=listOf(toPlan.manual.items).length;rows.push(counted('manual',B.manual,n,n?String(toPlan.manual.summary||''):B.noMigration));}
  if(toPlan.risks){const n=listOf(toPlan.risks.items).length;rows.push(counted('risks',B.risks,n,n?String(toPlan.risks.summary||''):B.noneFlagged));}
  if(plan){const copy=copyOf(mission,story),first=copy[0];rows.push(counted('copy',B.copy,copy.length,!first?B.none:first.variant?B.copyChosen(first.section,first.variant):first.ticket?B.copyOf(first.section,first.ticket):first.section));
    const shots=mockupsOf(mission);rows.push(counted('mockups',B.mockups,shots.length,shots.length?'':B.noMockup));}
  if(toPlan.accounts){const n=listOf(toPlan.accounts.items).length;rows.push(counted('accounts',B.accounts,n,String(toPlan.accounts.summary||'')));}
  return [left,middle,{key:'toPlan',title:B.toPlan,count:'',countTone:null,tone:null,link:null,rows}];
}

// The coverage approved and the coverage of today, compared request by request (its state, its tickets): the same or
// not. Without the coverage of the approval there is nothing to compare, and nothing is affirmed.
function sameCoverage(approved,cover) {
  if(!Array.isArray(approved)||!approved.every(r=>r&&r.id))return false;
  const key=r=>r.state+'|'+[...textsOf(r.tickets)].sort().join(','),was=new Map(approved.map(r=>[r.id,key(r)]));
  return was.size===cover.list.length&&cover.list.every(r=>was.get(r.id)===key(r));
}
// ---- What opens in the column on the right. The issue as it was prepared with Pilot, when the engine gives it.
const issueOf=(mission,story)=>{const i=story?.issue||null;return i&&(i.goal||i.audience||listOf(i.inScope).length||listOf(i.criteria).length)?i:null;};
// The sheet opened: its header, then its parts in order, each of one kind (title, text, label, box, pairs, items,
// chips, tickets, rows, bullets, link, action), and a foot. Null when what it shows is not there any more.
export function pageSheet({mission,tickets=[],lead=null,story=null,open=null,requests=[],checking=false,now=Date.now()}) {
  if(!open)return null;
  const plan=planOf(mission),simple=simpleOf(mission),parts=[],add=(kind,more)=>{parts.push({kind,...more});},text=(value,dim=false,small=false)=>{if(value)add('text',{text:String(value),dim,small});};
  const sheet=(kicker,foot='')=>({key:open.t+(open.id?':'+open.id:''),kicker,parts,foot}),items=list=>{if(list.length)add('items',{items:list});};
  const count=tickets.length,working=stageOf(mission)==='prepare'&&lead?.status==='working',countText=simple?H.single:working?P.band.written(count):P.plan.tickets(count);
  if(open.t==='approach') {
    const approach=plan?.approach||null,paragraphs=textsOf(approach?.paragraphs),migrations=textsOf(plan?.migrations),tool=devTool(tickets),lanes=lineLanes(tickets),heavy=tickets.filter(t=>t.difficulty==='heavy').length;
    if(!paragraphs.length)return null;
    paragraphs.forEach(p=>text(p));
    add('label',{text:H.mode});add('box',{text:H.oneBranch(mission?.branch||'')});
    add('pairs',{rows:[...(count?[[H.tickets,countText]]:[]),...(count?[[H.devs,lanes?lanes.map(d=>H.devWith(d.name,d.label)).join(', '):H.devWith(P.who.dev(1),tool)]]:[]),...(count?[[S.heavyTickets,H.heavyOf(heavy)]]:[]),...(migrations.length?[[S.migrations,H.thenList(migrations)]]:[])]});
    return sheet(S.approach);
  }
  if(open.t==='frozen') {
    // Every line is read in the approval, which the engine keeps as it was (simulation/CONTRAT.md): never in the plan of
    // today, which may have moved since. A line the approval does not carry is not drawn.
    // An approval of before (M7 review, decision 82) opens the same sheet, read in the history the engine gives.
    const current=story?.approval||null,history=listOf(current?.history),index=open.id==null?null:Number(open.id);
    const approval=index===null?current:Number.isInteger(index)?history[index]||null:null,when=dayAt(approval?.at),manual=approval?.manual||null,n=Number.isFinite(approval?.tickets)?approval.tickets:0;
    if(!when)return null;
    const approves=listOf(approval.approves).map(a=>a?.ticket||B.parts[a?.part]||a?.part).filter(Boolean);
    add('title',{text:H.frozenTitle(when)});text(index===null?H.frozenText:H.replaced(dayAt((history[index+1]||current)?.at)),true);add('label',{text:H.inCopy});
    add('pairs',{rows:[...(n>0?[[H.tickets,H.ticketsOn(approval.simple===true?H.single:P.plan.tickets(n),String(approval.branch||''))]]:[]),...(approval.openQuestions===0?[[H.questions,H.allSettled]]:[]),
      ...(manual&&Number.isFinite(manual.count)?[[H.yourSteps,manual.count>0?String(manual.summary||''):B.noMigration]]:[]),...(approves.length?[[H.approvedChanges,approves.join(', ')]]:[])]});
    if(index===null&&history.length){add('label',{text:H.earlier});history.map((h,i)=>[h,i]).reverse().forEach(([h,i])=>{const at=dayAt(h?.at);if(at)add('link',{label:H.earlierRow(at,h.kind),act:{key:'frozen',id:String(i)}});});}
    return sheet(B.frozen);
  }
  if(open.t==='issue') {
    const issue=issueOf(mission,story),url=/^https:\/\//.test(mission?.issue?.url||'')?mission.issue.url:null;
    if(!issue)return null;
    if(url)add('link',{label:H.openTracker,act:{key:'url',url}});
    const bullets=(label,list,ordered=false)=>{const lines=textsOf(list);if(lines.length){add('label',{text:label});add('bullets',{items:lines,ordered});}};
    if(issue.goal){add('label',{text:H.goal});text(issue.goal);}
    if(issue.audience){add('label',{text:H.forWhom});text(issue.audience);}
    bullets(H.inScope,issue.inScope);bullets(H.outScope,issue.outOfScope);bullets(H.criteria,issue.criteria,true);
    const taken=listOf(issue.decisions).filter(d=>d?.text);
    if(taken.length){add('label',{text:H.withPilot});add('rows',{rows:taken.map(d=>({at:dayOf(d.at),text:String(d.text)}))});}
    return sheet(H.issue(mission?.issue?.identifier||''));
  }
  // What stops a ticket (screen 13), from its request in the Inbox (simulation/CONTRAT.md § 3 ter): which ticket and for
  // how long, since when, why in plain words, what is being tried, and what is expected of the user. A part the engine
  // does not tell is not drawn. Gone once the ticket runs again.
  if(open.t==='blocked') {
    // The stop opened, by its request; written again since (the Lead adds its tries: another request, M10), the stop of
    // the same ticket. Never the stop of another ticket.
    const stops=pageWaits(requests,mission).filter(i=>i.type==='stuck'),stuck=!open.id?stops[0]:stops.find(i=>i.id===open.id)||(open.ticket?stops.find(i=>i.ticket===open.ticket):null);
    if(!stuck)return null;
    const id=stuck.ticket||'',t=tickets.find(x=>x.id===id)||null,since=clockAt(stuck.since||stuck.createdAt),tries=listOf(stuck.tries).filter(x=>x&&x.text),last=tries.findIndex(x=>x.last===true);
    add('title',{text:H.stoppedFor(id,stuckSpan(stuck,{now}))});
    add('chips',{chips:[{text:t?.state==='dev'?H.blockedInDev:P.card.blocked,tone:'bad'},...(since?[{text:H.since(since),tone:null}]:[])]});
    const why=String(stuck.text||stuck.title||'');
    if(why){add('label',{text:H.why});add('box',{text:why});}
    if(tries.length){add('label',{text:H.tried});add('items',{tight:true,items:tries.map((x,i)=>{const at=clockAt(x.at)||'';return {sign:String(i+1),tone:x.outcome==='same'?'bad':x.outcome==='running'?'run':null,title:String(x.text),sub:x.outcome==='same'?H.sameFailure(at):x.outcome==='running'?H.tryRunning(at):x.last===true?H.lastTry:'',tickets:[]};})});}
    if(stuck.forUser===false){add('label',{text:H.forYou});add('box',{text:H.nothingForNow(last>=0?H.nth[last]||'':'')});}
    if(id){add('label',{text:P.answer.ticket});add('tickets',{ids:[id]});}
    return sheet(H.blocked,H.toPilot);
  }
  if(open.t==='decision') {
    const d=listOf(story?.decisions).find(x=>x?.id===open.id);
    if(!d)return null;
    add('title',{text:String(d.title||d.short||'')});add('label',{text:H.yourAnswer(whenOf(d.at,now))});add('box',{text:String(d.answer||d.said||'')});
    if(d.changed){add('label',{text:H.whatChanged});text(d.changed);}
    const history=listOf(d.history).filter(h=>h?.text);
    if(history.length){add('label',{text:H.history});add('rows',{rows:history.map(h=>({at:dayHour(h.at),text:String(h.text)})),wide:true});}
    return sheet(H.settled(H.kinds[d.kind]||H.kinds.question));
  }
  if(open.t==='request') {
    const r=coverageOf(mission,lead).list.find(x=>x.id===open.id);
    if(!r)return null;
    const ok=r.state==='covered';
    add('title',{text:String(r.full||r.short||'')});
    add('chips',{chips:[{text:ok?H.coveredBy(r.tickets.length):r.state==='pending'?B.noTicketYet:r.state==='asked'?H.openQuestion:r.state==='postponed'?H.postponed:B.notCovered,tone:ok?null:'you'}]});
    add('label',{text:ok?H.cover:H.noTicket});
    if(ok)add('tickets',{ids:r.tickets});
    text(r.reason,true,true);
    return {...sheet(H.request,ok?H.outlined:''),covers:r.tickets};
  }
  if(open.t!=='list')return null;
  const toPlan=plan?.toPlan||{},numbered=list=>listOf(list).filter(x=>x?.title).map((x,i)=>({sign:String(i+1),tone:null,title:String(x.title),sub:String(x.detail||''),tickets:textsOf(x.tickets)}));
  const note=value=>text(value,true,true);
  if(open.id==='env') {
    const env=story?.environment||null;
    if(!envShown(env))return null;
    // No environment declared: said, never green, nothing to run again.
    if(env.ok===null){add('title',{text:V.notConfiguredTitle});text(V.notConfiguredIntro,true);return sheet(H.envCheck);}
    // A check running, from anywhere: the result of before is not shown, nothing more is asked until it ends.
    if(env.state==='checking'){add('title',{text:V.checkingTitle});text(V.checkingIntro,true);add('action',{label:V.checking,act:{key:'env-check'},busy:true});return sheet(H.envCheck);}
    const fail=env.ok?'':envFailure(env);
    add('title',{text:env.ok?H.envReady:fail.charAt(0).toUpperCase()+fail.slice(1)});text(env.ok?H.envIntro:H.envHeld,true);
    items(listOf(env.checks).filter(c=>c&&(engineStep(c)?V.checks[c.key]:H.checks[c.key]||c.title)).map(c=>engineStep(c)
      ?{sign:c.ok===true?'✓':c.ok===false?'!':'–',tone:c.ok===true?'ok':c.ok===false?'bad':null,title:V.checks[c.key],sub:stepSub(c),tickets:[]}
      :{sign:c.ok?'✓':'!',tone:c.ok?'ok':'bad',title:H.checks[c.key]||String(c.title),sub:String(c.detail||''),tickets:[]}));
    // Receiving a check does not prove it can be run again: the button is there when the engine says so. While a check
    // asked from this page runs, it says so and asks nothing more.
    if(env.ok!==true&&env.recheck===true)add('action',checking?{label:V.checking,act:{key:'env-check'},busy:true}:{label:H.envAgain,act:{key:'env-check'}});
    note(env.note);
    if(dayAt(env.at))text(V.lastAt(dayAt(env.at))+(env.interrupted===true?' '+V.interrupted:''),true,true);
    return sheet(H.envCheck);
  }
  if(open.id==='manual'&&toPlan.manual){const list=numbered(toPlan.manual.items);add('title',{text:H.manualTitle});text(list.length?H.manualIntro:H.manualNone,true);items(list);note(toPlan.manual.note);return sheet(B.toPlan);}
  if(open.id==='risks'&&toPlan.risks){const list=numbered(toPlan.risks.items).map(x=>({...x,sign:'▲'}));add('title',{text:B.risks});text(list.length?H.risksIntro:H.risksNone,true);items(list);note(toPlan.risks.note);return sheet(B.toPlan);}
  if(open.id==='copy'&&plan) {
    const copy=copyOf(mission,story);
    add('title',{text:B.copy});text(!copy.length?H.copyNone:copy.some(c=>c.variant)?H.copyChosen:H.copyIntro,true);
    items(copy.map(c=>({sign:'T',tone:c.variant?'ok':null,title:c.title,sub:c.variant?H.chosen(c.variant):c.detail,tickets:c.ticket?[c.ticket]:[]})));
    return sheet(B.toPlan);
  }
  if(open.id==='mockups'&&plan){const shots=mockupsOf(mission);add('title',{text:B.mockups});text(shots.length?'':H.mockupsNone,true);items(shots.map((m,i)=>({sign:String(i+1),tone:null,title:m.title,sub:'',tickets:[m.ticket]})));return sheet(B.toPlan);}
  if(open.id==='accounts'&&toPlan.accounts){add('title',{text:H.accountsTitle});text(H.accountsIntro,true);items(numbered(toPlan.accounts.items));note(H.accountsNote);return sheet(B.toPlan);}
  if(open.id==='coverage') {
    const cover=coverageOf(mission,lead);
    if(!cover.total)return null;
    add('title',{text:H.coveredTitle(cover.covered,cover.total)});text(sameCoverage(story?.approval?.coverage,cover)?H.unchanged:'',true);
    items(cover.list.map(r=>({sign:r.state==='covered'?'✓':'◆',tone:r.state==='covered'?'ok':'you',title:String(r.short||''),sub:r.state==='covered'?'':r.state==='pending'?B.noTicketYet:r.state==='asked'?H.openQuestion:r.state==='postponed'?H.postponed:B.notCovered,tickets:r.tickets})));
    return sheet(B.coverage);
  }
  if(open.id==='drift') {
    const drift=driftShown(story?.drift);
    if(!drift.length)return null;
    add('title',{text:drift.every(d=>d.ticket)?H.driftTitle(drift.length):H.changesTitle(drift.length)});text(H.driftIntro(dayOf(story?.approval?.at)),true);
    // The words of the mockup when given (the simulation), else what the engine says: the kind, the fields, when. No
    // « Reason… » line (decision 82): the engine does not know the reason, and nothing is made up.
    const said=d=>d.summary!=null||d.reason!=null||!d.kind;
    items(drift.map(d=>said(d)?{sign:'≠',tone:'you',title:String(d.title||driftHead(d)),sub:'',tickets:d.ticket?[d.ticket]:[]}:{sign:'≠',tone:'you',title:H.driftItem(driftName(d),driftWhatOf(d)),sub:H.driftSeenOn(d.at?dayAt(d.at):''),tickets:d.ticket?[d.ticket]:[]}));
    // Decision 85: the before and the after of each change, whole, drift by drift.
    const details=drift.filter(d=>!said(d)).map(d=>[d,driftDetails(d)]).filter(([,rows])=>rows.length);
    if(details.length){add('label',{text:H.beforeAfter});for(const [d,rows] of details){add('label',{text:driftName(d)});add('pairs',{rows});}}
    note(H.driftNote);
    // Approving what changed (M7, decisions 77, 80 and 81): not drawn by the mockup; a button at the foot of the sheet,
    // there only when the engine names the version of the drift it would approve. It opens the box of screen 06
    // (pageReconfirm), which alone approves.
    if(typeof story?.driftSeen==='string'&&story.driftSeen)add('action',{label:H.reapprove,act:{key:'reapprove',seen:story.driftSeen}});
    return sheet(B.drift);
  }
  return null;
}

// The page before the closure, and once closed (Claude Design « pre-close », decisions of the user 2026-11-17): a summary of
// what was done in the column on the right, « Before closing » (then « Left for you ») and the token usage at the bottom.
// Only what the engine tells is drawn: no push, pull request or merge said done, no count made up.
const ENDED=mission=>stageOf(mission)==='closed';
const judged=story=>{const plan=listOf(story?.qa?.plan),marks=story?.qa?.marks||{};const mine=plan.filter(t=>t.auto!=='ok');
  return {plan,passed:plan.filter(t=>t.auto==='ok').length,mine,checked:mine.filter(t=>['ok','ko'].includes(marks[t.id]?.result)).length,problems:plan.filter(t=>marks[t.id]?.result==='ko').length};};
export const preClose=(mission,story)=>{if(ENDED(mission))return true;if(stageOf(mission)!=='validate')return false;const j=judged(story);return j.plan.length>0&&j.checked===j.mine.length;};
const ticketMinutes=(story,id)=>listOf(story?.timings?.[id]).reduce((n,x)=>n+(Number.isFinite(x?.minutes)?x.minutes:0),0);
export function pageSummary({mission,story=null}) {
  if(!preClose(mission,story))return null;
  const E=P.end,j=judged(story),reviews=Object.values(story?.timings||{}).flatMap(listOf).filter(x=>/^review-/.test(x?.step||''));
  const changes=reviews.filter(x=>x.verdict==='changes_requested').length,decisions=listOf(story?.decisions).length;
  const checked=[{key:'qa',icon:'▶',tone:'ok',title:E.qa,sub:E.qaSub(j.passed,j.plan.length)},
    {key:'signoff',icon:'✓',tone:'ok',title:E.signoff,sub:E.signoffSub(j.checked,j.mine.length,j.problems)},
    {key:'reviews',icon:'R',tone:'ok',title:E.reviews,sub:E.reviewsSub(reviews.length,changes)},
    ...(j.problems?[{key:'problems',icon:'!',tone:'you',title:E.problems,sub:E.problemsSub(j.problems)}]:[]),
    {key:'decisions',icon:'◆',tone:'wait',title:E.decisions,sub:E.decisionsSub(decisions)}];
  const tickets=lineTickets(mission).map(t=>({id:t.id,title:String(t.title||''),time:ticketMinutes(story,t.id)?minutesText(ticketMinutes(story,t.id)):''}));
  const total=tickets.reduce((n,t)=>n+ticketMinutes(story,t.id),0),start=Date.parse(mission?.createdAt||'');
  return {head:ENDED(mission)?E.closedHead:E.summaryHead,title:String(mission?.issue?.title||''),text:String(mission?.tldr||'').trim()||E.noSummary,
    checked,tickets,foot:[Number.isFinite(start)?E.started(dayMonth(mission.createdAt),clockAt(mission.createdAt)):'',total?minutesText(total):'',E.tickets(tickets.length)].filter(Boolean).join(' · ')};
}
const short=n=>!Number.isFinite(n)?'—':n>=1e6?(Math.round(n/1e5)/10)+'M':n>=1e3?Math.round(n/1e3)+'k':String(n);
export function pageEnd({mission,story=null,lead=null}) {
  if(!preClose(mission,story))return null;
  const E=P.end,j=judged(story),closed=ENDED(mission),row=o=>({sign:'',signTone:'count',text:'',sub:'',right:'',rightMono:false,look:'',small:true,open:null,act:null,selected:false,...o});
  const left=closed?listOf(planOf(mission)?.toPlan?.manual?.items).map((x,n)=>row({key:'manual:'+n,sign:String(n+1),text:String(x?.text||x?.title||x||'')}))
    :[row({key:'qa',sign:'✓',signTone:'ok',text:E.qaFinished,right:E.passed(j.passed)}),
      row({key:'judged',sign:j.checked===j.mine.length?'✓':'○',signTone:j.checked===j.mine.length?'ok':'you',text:E.everyJudged,right:E.byQaAndYou}),
      row({key:'problems',sign:'✓',signTone:'ok',text:E.problemsHandled,right:E.handled(j.problems)})];
  if(closed&&!left.length)left.push(row({key:'nothing',sign:'✓',signTone:'ok',text:E.nothingLeft,look:'calm'}));
  const num=v=>Number.isFinite(v)&&v>=0,byRole={},inOut={};
  for(const a of listOf(story?.tokens?.agents).filter(a=>a&&num(a.in))){const r=a.role==='reviewer'||/^review/.test(a.role)?'reviewer':a.role;byRole[r]=byRole[r]||{in:0,out:0};byRole[r].in+=a.in;byRole[r].out+=num(a.out)?a.out:0;}
  const agents=['lead','dev','reviewer','qa'].filter(r=>byRole[r]).map(r=>({name:E.role(r),in:byRole[r].in,out:byRole[r].out}));
  const tickets=Object.entries(story?.tokens?.tickets||{}).filter(([,t])=>t&&num(t.in)).map(([id,t])=>({id,in:t.in,out:num(t.out)?t.out:0})).sort((a,b)=>b.in-a.in);
  const sum=key=>agents.reduce((n,a)=>n+a[key],0),most=list=>Math.max(1,...list.map(x=>x.in)),part=list=>list.map(x=>({...x,part:x.in/most(list),inText:short(x.in),outText:short(x.out)}));
  const count=closed?(left.length?String(left.length):''):E.ofChecks(left.filter(r=>r.signTone==='ok').length,left.length);
  return [{key:'left',title:closed?E.leftForYou:E.beforeClosing,count,countTone:closed?'you':null,tone:null,link:null,rows:left},
    {key:'tokens',wide:true,title:E.tokenUsage,note:closed?E.final:E.soFar,count:'',rows:[],
     usage:agents.length?{in:short(sum('in')),out:short(sum('out')),avg:tickets.length?short(Math.round(sum('in')/tickets.length)):'',agents:part(agents),tickets:part(tickets)}:null}];
}

// ---- The closure box (screen 06 of « pre-close ») and the reopening box (screen 08). The checklist is the one the engine
// computes (mission-close-check): never a line drawn green that it did not give green. « Approve and close » is held while
// the list is not ready; the one approval triggers what the box says, nothing else.
const baseName=mission=>String(mission?.base||'main').replace(/^origin\//,'');
export function pageCloseBox({mission,check=null,loading=false,error=''}) {
  const C=P.closeBox,base=check?.base?String(check.base).replace(/^origin\//,''):baseName(mission),id=String(mission?.issue?.identifier||mission?.id||'');
  // The engine names a row by its kind, or by the path of a repository then its kind (« /…/app:checks »).
  const kind=r=>String(r?.key||'').split(':').pop(),label=r=>C.rows[kind(r)]?C.rows[kind(r)](base):String(r?.key||'');
  // A row of a repository says which one after its label (« PR checks · app »), its state alone on the right.
  const rows=listOf(check?.rows).filter(r=>r&&r.key).map(r=>({key:String(r.key),ok:r.ok===true,label:label(r)+(typeof r.repo==='string'&&r.repo?' · '+r.repo:''),detail:String(r.detail??'')}));
  const status=loading?C.checking:error?String(error):!check?C.unknown:null;
  return {title:C.title(id),checkTitle:C.checkTitle,checklist:rows,status,rows:[{key:'triggers',label:C.triggers,text:C.triggersText(base)}],cancel:C.cancel,go:C.go,ready:!loading&&!error&&check?.ready===true&&rows.length>0,seen:check?.seen??null};
}
export const REASON_MAX=500;
export function pageReopenBox({mission}) {
  const R=P.reopenBox,id=String(mission?.issue?.identifier||mission?.id||'');
  return {title:R.title(id),text:R.text,hint:R.hint,cancel:R.cancel,go:R.go,max:REASON_MAX};
}
// The reopening box stays open only on the mission it was opened for, while its banner offers « Reopen… »: another
// mission shown drops it, and its reason with it (never a reason written for one mission sent for another).
export const reopenKept=(box,mission,band)=>Boolean(box)&&box===mission?.id&&band?.button?.key==='reopen';
export const reasonOk=r=>{const t=String(r??'').trim();return t.length>0&&t.length<=REASON_MAX;};
