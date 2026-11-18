// Pure rules of the page of a ticket (v2, Claude Design « page d'un ticket »): a request answered in place, in the column
// on the right (screens 03, 15, 17, 19 and 20 of the mockup; a permission asked by an agent and a choice of mockup after
// decision 41). Which request shows, its choices and their order, what each one sends, and what the column says while an
// answer is sent or when it fails. Tested with node --test. An answer goes by the actions the Inbox already has
// (inbox-answer, inbox-delegate, mockup-pick): nothing here sends, look.js does. What the mockup shows that a request of
// today does not carry is read where simulation/CONTRAT.md says the engine will put it; absent, it is not drawn.
import {W} from './words.js';
import {answersInOrder,sameWords,mockupsFor} from './nav.js';
import {stageOf,pageWaits,askKind,asker,askedBy} from './page.js';
import {lineDev} from './line.js';
import {clockOf} from './blocks.js';

const P=W.page,A=P.answer,LETTERS='ABCDEFGH';
const textsOf=value=>(Array.isArray(value)?value:[]).filter(x=>typeof x==='string'&&x.trim());
// The requests that wait for an answer on this development, the most urgent first; a blocked ticket is no request.
export const pageAsks=(items,mission)=>pageWaits(items,mission).filter(i=>i.type!=='stuck');
// An answer sent from this page takes its request off the page at once, without waiting for the feed; the request whose
// answer is being sent stays, so that a failure leaves it open.
export const withoutSent=(items,sent,answering=null)=>(items||[]).filter(i=>i.id===answering||!sent?.[i.id]);
// A request with a mockup published for it is a choice of mockup: the line and the blocks are told so.
export const withKinds=(items,mission)=>(items||[]).map(i=>askKind(i,mission)==='mockup'&&i.kind!=='mockup'?{...i,kind:'mockup'}:i);
// The request the column shows: the one opened, for as long as it waits.
export const askShown=(asks,open)=>open?.t==='ask'?(asks||[]).find(i=>i.id===open.id)||null:null;
// The request before or after, round the list (the two arrows of the head of the column).
export const askStep=(asks,id,by)=>{const at=(asks||[]).findIndex(i=>i.id===id);return at<0?null:asks[(at+by+asks.length)%asks.length].id;};
// An answer is sent once: never while another is being sent, never for a request already answered from this page. Two
// windows are kept apart by the engine, which keeps the first decision of a request and gives it back to the second.
export const canAnswer=(view,item)=>Boolean(item?.id)&&!view?.answering&&!view?.sent?.[item.id];
// An answer says which version of its request was shown (seen, given by the engine with the request): the engine refuses
// an answer to a request replaced since by another one, or whose version is not its own.
export const asShown=item=>item?.seen?{seen:item.seen}:{};
// An answer that did not go: its request and the message of the engine. `changed`: the request is no longer the one that
// was shown, nothing was recorded; the screen reads it again, and the user answers again on what is shown now.
export const refusalOf=(item,error)=>({id:item.id,message:String(error?.message||error),changed:error?.code==='REQUEST_CHANGED'});
// What « Your decisions » says of an answer given here, until the engine lists it: the request in a few words, and the
// answer; the decision the engine kept when the request had been answered before (another window).
export const saidOf=(item,option,made=null)=>({id:item.id,short:String(item.short||item.title||''),said:made?.created===false&&made?.decision?.text?String(made.decision.text):String(option?.said||'')});

// The column of a request. `view` is what the page keeps while it answers: answering (the request being sent), sent,
// failed ({id, message}) and chosen ({id, key}: the choice clicked). `canDelegate`: a Lead is there to decide instead.
export function pageAnswer({item,mission,tickets=[],asks=[],canDelegate=false,view={}}) {
  if(!item)return null;
  const kind=askKind(item,mission),stage=stageOf(mission),who=asker(item,lineDev(tickets,tickets.find(t=>t.id===item.ticket))),fromDev=askedBy(item)==='dev',prepare=stage==='prepare'&&!fromDev;
  const busy=view?.answering===item.id,chosen=view?.chosen?.id===item.id?view.chosen.key:null,error=view?.failed?.id===item.id?String(view.failed.message||''):'';
  const kit=kind==='mockup'?mockupsFor(mission,{item:item.id})[0]||null:null,button=key=>busy&&chosen===key?W.mockup.choosing:kit&&key!=='delegate'?W.mockup.approve:A.choose;
  const option=(key,o)=>({key,label:'',detail:'',recommended:false,primary:false,image:null,said:'',...o,button:button(key)});
  const answers=textsOf(item.answers),detail=answer=>String(item.details?.[answer]||(answer===item.recommendation?item.why||'':'')),clock=clockOf(item.createdAt);
  // The choices. A question, a verdict, a permission: the answers of the request, the one recommended first. A copy and a
  // mockup: their variants, named by their letter, in their own order.
  const options=kit?kit.variants.map((v,n)=>option('v'+n,{label:A.variant(String(v.name).toUpperCase()),image:v.image?{path:v.image,width:v.width,height:v.height}:null,said:A.saidVariant(String(v.name).toUpperCase()),send:{command:'mockup-pick',mockup:kit.id,variant:v.name,published:kit.pub}}))
    :kind==='copy'?answers.map((text,n)=>option('a'+n,{label:A.variant(LETTERS[n]||String(n+1)),detail:text,recommended:text===item.recommendation,said:A.saidVariant(LETTERS[n]||String(n+1)),send:{command:'inbox-answer',text}}))
    :answersInOrder(answers,item.recommendation).map((text,n)=>option('a'+n,{label:text,detail:detail(text),recommended:text===item.recommendation,primary:kind==='suggestion'&&n===0,said:text,send:{command:'inbox-answer',text}}));
  // « Let the Lead decide »: kept for a question, and for a question only (decision 44). A suggestion, a verdict, a choice
  // of copy or of mockup and a permission offer the choices drawn, no other.
  if(canDelegate&&item.type==='decision'&&kind==='question')options.push(option('delegate',{label:W.inbox.delegate,said:W.inbox.delegated,send:{command:'inbox-delegate'}}));
  const said=kind==='copy'?[A.variants(answers.length,item.ticket||''),item.text]:[item.text||item.summary];
  const ids=new Set(tickets.map(t=>t.id)),about=[...new Set([item.ticket,...textsOf(item.tickets)])].filter(id=>ids.has(id));
  return {key:'ask:'+item.id,id:item.id,item,kind,layout:kind==='suggestion'?'buttons':'rows',busy,chosen:busy?chosen:null,error,options,
    kicker:kind==='verdict'?A.verdict:kind==='copy'?A.copy:kind==='mockup'?A.mockup:kind==='permission'?A.permission(who):kind==='suggestion'?A.suggestion(who):A.question(who),
    title:String(item.title||''),texts:said.filter(t=>typeof t==='string'&&t.trim()&&!sameWords(t,item.title)).map(String),
    // The hour of the request is said in Prepare, as the mockup does (screen 03): « Asked at 2:40 pm. »
    when:prepare&&clock?(kind==='suggestion'?A.madeAt(clock):kind==='question'?A.askedAt(clock):''):'',
    command:kind==='permission'&&item.command?{label:W.inbox.asksToRun,text:String(item.command)}:null,
    view:kit?{label:W.mockup.open,mockup:kit.id}:null,
    // « Answer differently… » opens Pilot with the question (decision 35): for a question only, as on the mockup.
    field:kind==='question'?A.differently:null,
    ticketsLabel:about.length>1?A.tickets:A.ticket,tickets:about,
    foot:kind==='verdict'?A.foot.verdict:kind==='copy'?A.foot.copy:kind==='mockup'?A.foot.mockup:fromDev?A.foot.dev:kind==='permission'?'':prepare?A.foot.prepare:item.drift===true?A.foot.drift:'',
    // « For another wording, talk to Pilot. »: the foot opens Pilot with the request.
    pilotFoot:['copy','mockup'].includes(kind),nav:asks.length>1};
}
