import {normalizeTicketMission} from '../integrations/tickets/factory.mjs';
import {ticketOf} from '../integrations/tickets/contract.mjs';
import { ownerOf,ownerRecord } from './owner.mjs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import { canonical, fail, object, patientLock, readJSON, text, waitLock, writeJSON } from './common.mjs';
import { nextId } from './ids.mjs';
import { teamProject } from './ticket-read.mjs';
import { stepOf, LEAD_BUSY } from '../ui/v3/view.js';
import { launchAsk, closeAsk, delegateAsk, discussAsk } from './agent-texts.mjs';
import { missionCloseLock } from './mission-close.mjs';
import { W } from '../ui/v4/words.js';
import { createHandover } from './conversation.mjs';
import { createClaims } from './claims.mjs';
import { planOf, samePlan, againstTracker, hasPlan, said as planWords } from './plan.mjs';
import { createVisits, chainDone, sinceVisit } from './visits.mjs';
import { UNKNOWN as ENVIRONMENT_UNKNOWN } from './environment-view.mjs';

// A mission: what the user asked of a project, for as long as it takes. It lives in <root>/state/missions/M-<n>.json,
// whatever becomes of the terminals: its Lead, its agents and their tabs are attributes the watcher keeps up to date.
// Not to be confused with the previews of src/missions.mjs (a UUID, gone after fifteen minutes, never launched).
export const MISSION_STEPS=['requested','delegated','analysing','building','qa','validating','validated','closed'];
const OVER=['validated','closed'],FILE=/^(M-\d{1,7})\.json$/,ID=/^M-\d{1,7}$/,LOG_MAX=60,REQUEST_MAX=8000,TLDR_MAX=500,TLDR_TICKET_MAX=300;
export const missionActive=mission=>!OVER.includes(mission?.step);
// Where a mission stops on its own (chantier 1, point 16): at the end of Develop when the user said so, else at the end of
// Validate, as every mission of before. Develop over (every ticket accepted), a mission held there starts neither the QA
// agent nor the Validation (src/dev-chain.mjs), and says it is held (`heldAt`). Set by the screens alone (mission-launch,
// mission-stop-after), or by Pilot when it hands the issue to a Lead (lead-launch): never by the Lead.
export const STOP_AFTER=Object.freeze(['develop','validate']);
export const stopAfterOf=mission=>mission?.stopAfter==='develop'?'develop':'validate';
const PAST_DEVELOP=['qa','validating','validated','closed'];
export function stopAfterArg(value) {
  if(!STOP_AFTER.includes(value))fail('INVALID_ARGUMENT','stopAfter must be develop or validate.');
  return value;
}
// The limit written on a mission (inside an update): Develop is refused once the mission is past it; Validate lifts a hold.
export function setStopAfter(m,value) {
  if(!missionActive(m))fail('MISSION_OVER','This development is already over.');
  if(value==='develop'&&PAST_DEVELOP.includes(m.step))fail('MISSION_PAST_DEVELOP','This development is already past Develop.');
  if(value==='validate')delete m.heldAt;
  m.stopAfter=value;
}
// The step of a mission that a session of the first version stands at.
export const missionStepOf=session=>({plan:'analysing',split:'analysing',dev:'building',check:'validating',close:'validated'})[stepOf(session)];
// ---- The approval of the plan (ticket M5). The steps before any dev was launched.
const BEFORE_DEVS=['requested','delegated','analysing'];
// Each request of the issue and how the plan covers it, as the page counts it (ui/v4/blocks.js, coverageOf): covered by
// its tickets, else asked, postponed or pending as the Lead says, else open. A request kept before ticket M3 ({id, text})
// is none of the contract and is not counted.
const words=list=>(Array.isArray(list)?list:[]).filter(x=>typeof x==='string'&&x.trim());
export const coverageOfPlan=plan=>(Array.isArray(plan?.requests)?plan.requests:[]).filter(r=>r&&r.id&&words([r.short,r.full]).length).map(r=>{const tickets=words(r.tickets);return {id:r.id,state:tickets.length?'covered':['asked','postponed','pending'].includes(r.state)?r.state:'open',tickets};});
// What is still open before the plan is approved: a request of the mission the user has not answered (a question, a
// suggestion, a verdict, a choice of copy or of mockup, a permission), and a request of the issue the plan says the Lead
// asks, that no ticket covers.
export const openQuestionsOf=(items,plan)=>(items||[]).filter(i=>!i.answer&&!['stuck','validation'].includes(i.type)).length+coverageOfPlan(plan).filter(r=>r.state==='asked').length;
// The frozen copy: what the user approved, at the moment he did, as simulation/CONTRAT.md reads it (`approval`), and the
// plan itself, whole, as it was. Written once and never again: the plan of today may move, the copy does not. The branch
// is the one of the mission, else the one its worktree takes (the identifier of the issue, src/issue-worktree.mjs).
// What the chain already knew outside the plan when it was approved (M7, decision 82): every sub-ticket of the tracker
// seen before the first approval, whatever its state (read with the plan by lead-plan, or by the chain), that the plan
// does not name. Neither approved nor drift, for good: kept through a cancellation, a reopening and every reapproval.
const knownBefore=mission=>{const named=new Set(listOf(mission?.plan?.tickets).map(t=>t?.id));return [...new Set([...listOf(mission?.trackerSeen),...listOf(mission?.tickets).map(t=>t?.id)])].filter(id=>typeof id==='string'&&id&&!named.has(id)).sort();};
const outsideOf=mission=>{const ids=knownBefore(mission);return ids.length?{outside:ids}:{};};
// The sub-tickets of the tracker seen before the first approval, noted as they are read: never forgotten after.
export function noteSeen(mission,ids) {
  if(!mission||mission.approval)return;
  const next=[...new Set([...listOf(mission.trackerSeen),...listOf(ids).filter(id=>typeof id==='string'&&id)])].sort();
  if(next.length!==listOf(mission.trackerSeen).length)mission.trackerSeen=next;
}
export function frozenCopyOf(mission,{at,owner}) {
  const plan=mission.plan,manual=plan?.toPlan?.manual||null;
  return {at,revision:plan.revision,tickets:plan.tickets.length,...(plan.simple===true?{simple:true}:{}),branch:mission.branch||String(mission.issue?.identifier||'').toLowerCase()||null,openQuestions:0,
    ...(manual?{manual:{summary:String(manual.summary||''),count:Array.isArray(manual.items)?manual.items.length:0}}:{}),coverage:coverageOfPlan(plan),plan:JSON.parse(JSON.stringify(plan)),...outsideOf(mission),...ownerRecord(owner),via:'screen'};
}
// The one gate of every launch of a dev (ticket M5): no dev without the frozen copy of the plan the user approved, asked
// by the Lead (a launch, a fix, a resume), by dev-launch, by the chain on its own, or by the launch of before (launch).
// Told to the agent that asked, in French: the approval is his click on the screen, never a command of an agent.
export const NOT_APPROVED='Le plan n\'est pas approuvé : aucun dev ne part avant que le propriétaire clique sur « Approve and start the dev » dans la page du ticket. Rien n\'est lancé.';
export function approvedOnly(mission){if(!mission?.approval?.at)fail('NOT_APPROVED',NOT_APPROVED);return mission;}
// The approval covers the tickets of the frozen copy, and only them (decision 77): a ticket absent from the copy, or that
// the plan of today gives otherwise (its agent, its model, its effort, its rank, what it waits for…), does not start,
// whoever asks. Its identity read in the tracker since is no change. The reapproval of what changed comes with M7.
// Told to the agent that asked, in French, in the words of decision 87 (a ticket kept out for good is never said to
// start once approved again). Null when the copy covers it.
export const COPY={
  absent:ticket=>'Lancement de '+ticket+' refusé : le ticket n’est pas couvert par l’approbation actuelle. Ne le lance pas.',
  changed:ticket=>'Lancement de '+ticket+' refusé : sa version actuelle diffère de la version approuvée. le propriétaire doit approuver les changements avant son lancement.',
  // M7 review: a launch that asks another tool, model or effort than the approved ones.
  params:ticket=>'Lancement de '+ticket+' refusé : l’outil, le modèle ou l’effort demandé diffère des paramètres approuvés. Utilise les paramètres approuvés, ou fais approuver leur modification par le propriétaire.',
};
const asApproved=ticket=>{if(!ticket||typeof ticket!=='object')return null;const {uid:_uid,...rest}=ticket;return canonical(rest);};
// What a launch asks ({tool, model, effort}) against what was approved: the same, or refused.
const asks=(asked,approved)=>!asked||(asked.tool===(approved.tool??null)&&asked.model===(approved.model??null)&&asked.effort===(approved.effort??null));
// `asked`: what the launch asks (its tool, model and effort), never taken on trust; `row`: the sub-ticket as the chain
// reads it now in the tracker (src/dev-chain.mjs, ticketOfRow), else as it last recorded it.
export function copyRefusal(mission,ticket,{asked=null,row=null}={}) {
  const copy=listOf(mission?.approval?.plan?.tickets).find(t=>t?.id===ticket)||null;
  const today=listOf(mission?.plan?.tickets).find(t=>t?.id===ticket)||null;
  if(!copy&&!today) {
    // A sub-ticket the plan does not name (a correction asked in Validation): covered once a reapproval approved it,
    // as the chain records it then (M7); given otherwise since, it is changed. One there before the approval, or removed
    // from the plan by an approval, never (decision 82).
    const kept=listOf(mission?.approval?.extra).find(e=>e?.id===ticket);
    if(!kept||listOf(mission?.approval?.outside).includes(ticket))return {code:'NOT_IN_COPY',message:COPY.absent(ticket)};
    const now=row||listOf(mission?.tickets).find(t=>t?.id===ticket);
    if(!now||canonical(asUnplanned(now))!==canonical(asUnplanned(kept.ticket)))return {code:'COPY_CHANGED',message:COPY.changed(ticket)};
    return asks(asked,{tool:kept.ticket.dev,model:kept.ticket.model,effort:kept.ticket.effort})?null:{code:'NOT_AS_APPROVED',message:COPY.params(ticket)};
  }
  if(!copy)return {code:'NOT_IN_COPY',message:COPY.absent(ticket)};
  if(asApproved(today)!==asApproved(copy))return {code:'COPY_CHANGED',message:COPY.changed(ticket)};
  return asks(asked,{tool:copy.agent,model:copy.model,effort:copy.effort})?null:{code:'NOT_AS_APPROVED',message:COPY.params(ticket)};
}
// ---- The drift from the plan approved (ticket M7): what the plan of today, the tracker and the worktree hold that the
// frozen copy does not.
// - A ticket of the plan absent from the copy is added, one of the copy absent from the plan is removed, one in both
//   given otherwise (anything but its identity read in the tracker since) is changed, with the fields that differ.
// - A sub-ticket of the tracker the plan does not name, still to be done (a correction asked in Validation), is added,
//   unless it is kept out (`outside`: there before the approval, or removed from the plan by an approval). Approved by a
//   reapproval, it is kept in the copy (`extra`) and compared as the chain records it; done, canceled or gone, it is no
//   drift (nothing of it is launched).
// - Every other part of the plan (approach, phases, requests, migrations, the four lists of « To plan for »…) added,
//   removed or changed (decision 82: the reapproval covers only what the screen drew).
// - The branch of the worktree, once made, other than the one of the copy (decision 73).
// Each drift says what will be approved (`values`: the tool, model, effort and level of a ticket) and every change in
// it (`changes`, decision 84: each field of a ticket, each field or entry of a part, a part added with its value). Nothing is said when the plan is the one approved, whatever its revision.
// When each drift appeared is noted by the engine (`driftAt`), at the moment it records the plan or the tickets that
// make it; never made up.
const listOf=x=>Array.isArray(x)?x:[];
const OUT_OF_PLAY=['completed','canceled'];
const unplanned=m=>{const named=new Set(listOf(m?.plan?.tickets).map(t=>t?.id));return listOf(m?.tickets).filter(t=>t&&t.id&&!named.has(t.id)&&t.state!=='canceled'&&!OUT_OF_PLAY.includes(t.tracker));};
const asUnplanned=t=>({title:t?.title??null,level:t?.level??null,dev:t?.dev??null,model:t?.model??null,effort:t?.effort??null,deps:listOf(t?.deps)});
const fieldsOf=(a,b)=>[...new Set([...Object.keys(a||{}),...Object.keys(b||{})])].filter(k=>k!=='uid'&&canonical(a?.[k]??null)!==canonical(b?.[k]??null)).sort();
const digest=x=>createHash('sha256').update(canonical(x)).digest('hex').slice(0,16);
const scalar=v=>v===null||['string','number','boolean'].includes(typeof v);
// What changed in a value, said whole (decisions 84 and 85: the reapproval approves only what the screen shows, and
// the sheet of the drift shows the before and the after of every change, in full, order included). A value or a list of
// short words or numbers by what it was and what it is (null: nothing), however long; a list of entries by the entries
// added, removed and changed, each by its title, its few words or its id, else by its place (#2), with each one whole
// (`entries`: what it was and what it is) and the order of the list when it moved (`order`); an object by each field
// that changed; anything else by its whole text before and after.
const SHORT=120;
const blank=v=>v==null||v===''||(Array.isArray(v)&&!v.length);
const isObject=v=>Boolean(v)&&typeof v==='object'&&!Array.isArray(v);
const plainList=v=>Array.isArray(v)&&v.every(x=>scalar(x)&&x!==null&&String(x).length<=SHORT);
const plain=v=>blank(v)||scalar(v)||plainList(v);
const flat=v=>blank(v)?null:Array.isArray(v)?v.map(String).join(', '):String(v);
// The whole text of a value: an entry by each field it holds (« title: Collations; detail: utf8mb4 »), a list by its
// entries; nothing is cut.
function whole(v,top=true) {
  if(blank(v))return null;
  if(scalar(v))return String(v);
  if(Array.isArray(v))return v.every(scalar)?v.map(String).join(', '):v.map(x=>whole(x,false)).filter(x=>x!=null).join(' | ');
  const said=Object.entries(v).filter(([k,x])=>k!=='uid'&&!blank(x)).map(([k,x])=>k+': '+whole(x,false)).join('; ');
  return top?said:'('+said+')';
}
const entryName=(x,n)=>isObject(x)&&(x.title??x.short??x.id)!=null?String(x.title??x.short??x.id):'#'+(n+1);
function entriesOf(list) {
  const seen=new Set();
  return new Map(listOf(list).map((x,n)=>{
    const own=isObject(x)?x.id??x.title??x.short??null:null;
    let key=own==null?'#'+n:'='+own;if(seen.has(key))key+='#'+n;seen.add(key);
    return [key,{x,name:entryName(x,n)}];
  }));
}
function entriesChanged(a,b) {
  const was=entriesOf(a),now=entriesOf(b),entries=[];
  const added=[...now].filter(([k])=>!was.has(k)).map(([,e])=>(entries.push({name:e.name,kind:'added',from:null,to:whole(e.x)}),e.name));
  const removed=[...was].filter(([k])=>!now.has(k)).map(([,e])=>(entries.push({name:e.name,kind:'removed',from:whole(e.x),to:null}),e.name));
  const changed=[...now].filter(([k,e])=>was.has(k)&&canonical(was.get(k).x)!==canonical(e.x)).map(([k,e])=>(entries.push({name:e.name,kind:'changed',from:whole(was.get(k).x),to:whole(e.x)}),e.name));
  // As soon as the list moves (an order, an insertion, a removal) between two lists that both hold something, the whole
  // list before and after is given, never a difference computed (decision 86).
  const keys=m=>[...m.keys()].join('\u0000');
  const order=was.size&&now.size&&keys(was)!==keys(now)?{from:[...was.values()].map(e=>e.name),to:[...now.values()].map(e=>e.name)}:null;
  return {added,removed,changed,entries,...(order?{order}:{})};
}
const keysChanged=(a,b)=>[...new Set([...Object.keys(a||{}),...Object.keys(b||{})])].filter(k=>canonical(a?.[k]??null)!==canonical(b?.[k]??null)).sort();
function changeOf(field,a,b) {
  if(plain(a)&&plain(b))return [{field,from:flat(a),to:flat(b)}];
  if((blank(a)||Array.isArray(a))&&(blank(b)||Array.isArray(b)))return [{field,...entriesChanged(a,b)}];
  if((blank(a)||isObject(a))&&(blank(b)||isObject(b)))return keysChanged(a,b).flatMap(k=>changeOf(field+'.'+k,a?.[k],b?.[k]));
  return [{field,from:whole(a),to:whole(b)}];
}
const changesOf=(fields,was,now)=>fields.flatMap(f=>changeOf(f,was?.[f]??null,now?.[f]??null));
// A part of the plan: its summary as the part itself (« collations → collations, drops »), then each other field.
function partChanges(part,a,b) {
  if(!isObject(a)&&!isObject(b))return changeOf(part,a,b);
  const keys=keysChanged(a,b);
  return [...(keys.includes('summary')?changeOf(part,a?.summary,b?.summary):[]),...keys.filter(k=>k!=='summary').flatMap(k=>changeOf(k,a?.[k],b?.[k]))];
}
// The level in the words of the tracker (léger, standard, fort), whatever side it comes from.
const LEVEL={light:'léger',standard:'standard',heavy:'fort'};
const planValues=t=>({tool:t.agent??null,model:t.model??null,effort:t.effort??null,level:LEVEL[t.difficulty]??t.difficulty??null});
const rowValues=t=>({tool:t.dev??null,model:t.model??null,effort:t.effort??null,level:t.level??null});
// The parts of a plan beside its tickets, in the order the page reads them; one the Lead adds later is compared too.
const PARTS=['approach','phases','migrations','requests','simple','points','toPlan.manual','toPlan.risks','toPlan.copy','toPlan.accounts'];
function partsOf(plan) {
  const {tickets:_tickets,toPlan,...rest}=planWords(plan||{}),out={...rest};
  for(const [key,value] of Object.entries(toPlan&&typeof toPlan==='object'?toPlan:{}))if(value!==undefined)out['toPlan.'+key]=value;
  for(const key of Object.keys(out))if(out[key]===undefined)delete out[key];
  return out;
}
const isEmpty=v=>v==null||(Array.isArray(v)&&!v.length);
// A ticket added or removed, of the plan or of the tracker: each of its fields, what it is or what it was (decisions 85
// and 86), its identity aside.
const wholeTicket=(was,now)=>changesOf(fieldsOf(was,now).filter(f=>f!=='id'),was,now);
function driftEntries(m) {
  const copy=listOf(m.approval.plan?.tickets),extra=listOf(m.approval.extra),outside=new Set(listOf(m.approval.outside)),today=listOf(m.plan?.tickets);
  const byCopy=new Map(copy.map(t=>[t?.id,t])),byToday=new Map(today.map(t=>[t?.id,t])),extras=new Map(extra.map(e=>[e?.id,e])),out=[];
  for(const t of today){
    if(!t?.id)continue;
    const c=byCopy.get(t.id);
    if(!c){out.push({key:t.id,ticket:t.id,kind:'added',title:t.title??null,changes:wholeTicket(null,t),values:planValues(t),sig:digest({added:asApproved(t)})});continue;}
    const fields=fieldsOf(t,c);
    if(fields.length)out.push({key:t.id,ticket:t.id,kind:'changed',fields,changes:changesOf(fields,c,t),title:t.title??null,values:planValues(t),sig:digest({changed:asApproved(t)})});
  }
  // A ticket removed whose dev the chain says running (decision 85): it is said, so that the screen never says it
  // « never starts »; its dev is stopped once its turn ends, never reviewed nor merged.
  const runs=id=>listOf(m.tickets).some(t=>t?.id===id&&t.running===true);
  for(const c of copy)if(c?.id&&!byToday.has(c.id))out.push({key:c.id,ticket:c.id,kind:'removed',title:c.title??null,changes:wholeTicket(c,null),...(runs(c.id)?{running:true}:{}),from:'plan',sig:digest({removed:c.id})});
  for(const t of unplanned(m)){
    if(byCopy.has(t.id)||outside.has(t.id))continue;
    const e=extras.get(t.id),now=asUnplanned(t);
    if(!e){out.push({key:t.id,ticket:t.id,kind:'added',title:t.title??null,changes:wholeTicket(null,now),values:rowValues(t),from:'tracker',sig:digest({added:now})});continue;}
    const was=asUnplanned(e.ticket),fields=fieldsOf(now,was);
    if(fields.length)out.push({key:t.id,ticket:t.id,kind:'changed',fields,changes:changesOf(fields,was,now),title:t.title??null,values:rowValues(t),from:'tracker',sig:digest({changed:now})});
  }
  // The other parts of the plan: compared only with a copy that kept its plan.
  if(m.approval.plan&&m.plan){
    const was=partsOf(m.approval.plan),now=partsOf(m.plan),keys=[...new Set([...Object.keys(was),...Object.keys(now)])].sort((a,b)=>(PARTS.indexOf(a)+1||99)-(PARTS.indexOf(b)+1||99)||a.localeCompare(b));
    for(const part of keys){
      const a=isEmpty(was[part])?null:was[part],b=isEmpty(now[part])?null:now[part];
      if(canonical(a)===canonical(b))continue;
      out.push({key:'plan:'+part,ticket:null,part,kind:a===null?'added':b===null?'removed':'changed',changes:partChanges(part,a,b),sig:digest({part,now:b})});
    }
  }
  // Decision 73: the copy writes the branch planned; the worktree once made gives the real one.
  if(m.worktree&&m.branch&&m.approval.branch&&m.branch!==m.approval.branch)out.push({key:'branch',ticket:null,part:'branch',kind:'changed',changes:[{field:'branch',from:m.approval.branch,to:m.branch}],sig:digest({branch:m.branch})});
  return out;
}
// The drift as the page reads it (simulation/CONTRAT.md, `drift`): null until the plan is approved.
export function driftOf(mission) {
  if(!mission?.approval)return null;
  const at=mission.driftAt||{};
  return driftEntries(mission).map(({sig,key,from:_from,...d})=>({...d,at:at[key]?.sig===sig?at[key].at:null}));
}
// The version of the drift the screen draws: what each drift is today, and the whole plan the copy would freeze (its
// tickets, its other parts, its branch). What a reapproval approves, and only that (null: nothing to approve). Anything
// that moves after the screen drew it gives another version: the old click is then refused.
export function driftSeenOf(mission) {
  if(!mission?.approval)return null;
  const now=driftEntries(mission);
  return now.length?digest({drift:now.map(d=>[d.key,d.kind,d.sig]),plan:planWords(mission.plan||{}),branch:mission.branch??null}):null;
}
// The copy approved again (M7): the plan of today, frozen as a first approval is, the approval of before kept whole
// beneath it (`previous`, never rewritten), what was approved this time (`approves`). What is kept out stays out and
// grows (decision 82): the sub-tickets there before the first approval, and every ticket an approval removed from the
// plan. Once the devs have left, the sub-tickets of the tracker the drift drew as added or changed are approved with
// it (`extra`, as the chain records them), and only them. The drift starts again from nothing.
function approvedAgain(mission,{at,owner,items,drift,approves=null,withExtra=false}) {
  const {previous=[],...was}=mission.approval,copy=frozenCopyOf(mission,{at,owner});
  const named=new Set(listOf(mission.plan?.tickets).map(t=>t?.id)),removed=drift.filter(d=>d.kind==='removed'&&d.ticket).map(d=>d.ticket);
  const outside=[...new Set([...listOf(was.outside),...(withExtra?[]:listOf(copy.outside)),...removed])].filter(id=>!named.has(id)).sort();
  const extras=new Map(listOf(was.extra).filter(e=>e?.id&&!named.has(e.id)&&!outside.includes(e.id)).map(e=>[e.id,e]));
  if(withExtra)for(const d of drift)if(d.from==='tracker'&&d.kind!=='removed'){const row=unplanned(mission).find(t=>t.id===d.ticket);if(row)extras.set(d.ticket,{id:d.ticket,ticket:asUnplanned(row)});}
  delete copy.outside;
  mission.driftAt={};
  return {...copy,openQuestions:openQuestionsOf(items,mission.plan),...(outside.length?{outside}:{}),...(extras.size?{extra:[...extras.values()]}:{}),kind:'reapproval',...(approves?{approves}:{}),previous:[...previous,was]};
}
// Notes when each drift appeared, under the lock of the mission, as it is written: a drift already noted keeps its
// instant; one gone is forgotten.
export function noteDrift(mission,at) {
  if(!mission?.approval)return;
  const was=mission.driftAt||{},now=driftEntries(mission);
  mission.driftAt=Object.fromEntries(now.map(d=>[d.key,was[d.key]?.sig===d.sig?was[d.key]:{sig:d.sig,at}]));
}
// The mission under way that an issue belongs to: its own issue, or a ticket of its plan (approved or of today).
const named=(plan,issue)=>(plan?.tickets||[]).some(t=>t&&((issue.identifier&&t.id===issue.identifier)||(issue.id&&t.uid===issue.id)));
export const coversIssue=(mission,issue)=>Boolean(issue)&&((issue.id&&mission?.issue?.id===issue.id)||named(mission?.plan,issue)||named(mission?.approval?.plan,issue));
// The gate for a launch that names an issue, not a mission: one of the missions under way it belongs to is approved.
export async function approvedForIssue(registry,issue){return approvedOnly((await registry.list({active:true})).filter(m=>!m.unreadable&&coversIssue(m,issue)).find(m=>m.approval?.at));}
// Said on the screen when the approval is refused or its launch is uncertain, in the words of decision 74.
export const APPROVAL={
  open:'Answer the pending question or request before approving.',
  changed:'The plan has changed. Review the updated plan before approving.',
  missing:'There is no plan to approve yet.',
  started:'Development has already started. No approval is needed.',
  unsure:'The launch is not confirmed. Its status is being checked.',
  busy:'Another approval is being saved. Try again in a moment.',
  working:'The Lead is still preparing. Wait until it finishes, then approve.',
  // Decision 87: the Lead held in its terminal (blocked) is waiting, not preparing.
  waiting:'The Lead is waiting. Check its terminal before approving.',
  // M7, the reapproval of what changed (words of decision 87).
  notStarted:'The mission is still in Prepare. Use the plan’s approval button.',
  noDrift:'There are no changes to approve.',
  driftChanged:'The plan has changed again. Review the latest changes before approving.',
  reopen:'Reopen the changes, review them, then approve.',
  // Decision 111: the environment the project declares is not green at the moment of the launch (provisional words,
  // to be written by Codex).
  environment:'The environment of this project is not ready. Run the check again on the Prepare screen, then approve.',
};
// The environment of the project of a mission at the moment of a launch (decision 111, M6 b review point 1): read again
// from its view (src/environment-view.mjs), never checked from here. True: the project declares an environment and its
// view is not green (to fix, running, interrupted, unknown, not enrolled, never checked, stale; a reading that fails is
// unknown), and the launch is held. A project that declares none (not configured), or that the configuration does not
// know (no view), is launchable as before. No reader (a caller of before), nothing is held.
export async function environmentHeld(environment,mission) {
  if(typeof environment!=='function'||!mission?.project)return false;
  const view=await Promise.resolve().then(()=>environment({project:mission.project})).catch(()=>ENVIRONMENT_UNKNOWN);
  return viewHeld(view);
}
const viewHeld=view=>{
  if(view===null)return false;
  if(view?.state==='not-configured'&&view.ok===null)return false;
  return !(view?.state==='ready'&&view.ok===true);
};
// The durable proof that a dev of the mission already left (M6 b engine review 1, point 2): written once, at the first
// launch of a dev that succeeded (src/dev-chain.mjs). Until it is there, every launch of a dev is checked against the
// environment, whatever the step of the mission says.
export const devStarted=mission=>typeof mission?.devStartedAt==='string';
// task({held}) with the environment of the project of the mission kept as it was read for the whole of task (decision
// 111, M6 b engine review 1, point 1): `hold` (src/environment-view.mjs hold) keeps the kernel lock of the check from
// the reading to the end of task, so no check starts in between; with only a reader (a test, a caller of before), it is
// read once, nothing kept. `held`: not green, the caller refuses. No project, or neither, nothing is held.
export async function withEnvironment({read=null,hold=null},mission,task) {
  if(!mission?.project||typeof hold!=='function'&&typeof read!=='function')return task({held:false});
  if(typeof hold==='function')return hold({project:mission.project},view=>task({held:viewHeld(view)}));
  return task({held:await environmentHeld(read,mission)});
}
// The journal of an approval, in the words of decision 87: a launch asked again is recorded (before it is sent), a plan
// rewritten before the devs approved again, the changes approved after, a part of the plan by its name on the page.
export const LOG={again:'New launch request recorded for the Lead.',updated:'Updated plan approved by you.',
  changesApproved:list=>'Changes approved by you: '+list.map(d=>d.ticket||W.page.blocks.parts[d.part]||d.part).join(', ')+'.'};
// The refusal of a Lead busy in its terminal, by what it does: at work, or waiting (decision 87).
const leadBusy=status=>fail('LEAD_WORKING',status==='blocked'?APPROVAL.waiting:APPROVAL.working);
// A launch whose fate is unknown (decision 72) is never sent again on its own: the tool establishes what became of it.
// Started (asked) as soon as a dev of the mission is known launched: its chain runs, or the mission left Prepare. Not
// started (failed) once no dev was launched and the Lead rests long after the message: idle, done with its turn, gone
// from the window, or its session stopped (M5 review 2: a Lead done or stopped never left the banner up for good):
// a click may then ask the launch again (the copy stays as it is). The Lead at work or held in its terminal may still be
// launching; Herdr out of reach (lead null) establishes nothing. A launch left « asking » by a stop midway is unknown.
// The two minutes the page says a launch asked (ui/v4/nav.js, launchState) before it offers the approval again.
export const ASK_AGAIN_MS=120000;
export const LAUNCH_SETTLE_MS=10*60000,LEAD_RESTS=['idle','done','absent','stopped'];
export function launchSettled(mission,{chainOn=false,lead=null,now=Date.now()}={}) {
  const l=mission?.launch;
  if(!l||!['unknown','asking'].includes(l.state))return null;
  if(chainOn||!BEFORE_DEVS.includes(mission.step))return 'asked';
  const from=Date.parse(l.saidAt||l.at||'');
  return LEAD_RESTS.includes(lead)&&Number.isFinite(from)&&now-from>=LAUNCH_SETTLE_MS?'failed':null;
}
export const issueBrief=issue=>({id:issue.id,identifier:issue.identifier??null,title:issue.title??null,url:issue.url??null});
const number=id=>Number(id.slice(2));

export function createMissionRegistry({root,now=Date.now}) {
  const dir=join(root,'state','missions'),path=id=>join(dir,id+'.json');
  const stamp=()=>new Date(now()).toISOString();
  const lock=task=>patientLock(dir,task);
  const valid=id=>{if(typeof id!=='string'||!ID.test(id))fail('INVALID_ARGUMENT','Expected a mission identifier (M-<n>).');return id;};
  async function load(id) {
    const mission=await readJSON(path(id),null);
    if(!mission)fail('NOT_FOUND','No mission uses this identifier.');
    return normalizeTicketMission(mission);
  }
  const read=id=>load(valid(id));
  // Every mission, oldest first. A file that cannot be read stays in the list, said as such: one bad file neither
  // hides a mission nor stops the others.
  async function all() {
    let names;
    try{names=await readdir(dir);}catch(error){if(error.code==='ENOENT')return [];throw error;}
    const ids=names.map(name=>FILE.exec(name)?.[1]).filter(Boolean).sort((a,b)=>number(a)-number(b));
    return Promise.all(ids.map(async id=>{try{return await load(id);}catch{return {id,step:'unknown',unreadable:true};}}));
  }
  // Active first, then the most recent.
  async function list({active=false,project}={}) {
    const found=(await all()).filter(m=>(!active||missionActive(m))&&(project===undefined||m.project===project));
    return found.sort((a,b)=>Number(missionActive(b))-Number(missionActive(a))||number(b.id)-number(a.id));
  }
  const ofSession=async sessionId=>(await list()).find(m=>m.lead?.sessionId===sessionId)||null;
  // The new mission, written under the lock of the caller.
  async function write(fields) {
    const id=await nextId(root,'M'),at=stamp();
    const mission={id,project:null,machine:null,issue:null,request:null,requestedAt:at,lead:{sessionId:null,lastSeen:null},worktree:null,branch:null,base:null,tickets:[],step:'requested',blocked:false,decisions:[],questions:[],log:[],adoptedFrom:null,createdAt:at,updatedAt:at,...fields};
    await writeJSON(path(id),mission);
    return mission;
  }
  // One open mission per issue: the open one is given back, and nothing is made.
  const create=fields=>lock(async()=>{
    const open=fields.issue?.id?(await all()).find(m=>missionActive(m)&&m.issue?.id===fields.issue.id):null;
    return open?{created:false,mission:open}:{created:true,mission:await write(fields)};
  });
  // The mission of a session of the first version (a PO), made once. Null when the issue already has a mission led by
  // someone else: two chains on one issue would launch everything twice. What nobody recorded (the demand) stays unknown.
  const adopt=(session,step)=>lock(async()=>{
    const known=await all(),own=known.find(m=>m.lead?.sessionId===session.id);
    if(own)return own;
    if(known.some(m=>missionActive(m)&&m.issue?.id===session.issueId))return null;
    return write({project:session.projectKey??null,issue:{id:session.issueId,identifier:session.identifier??null,title:session.title??null,url:session.issueUrl??null},requestedAt:session.createdAt??stamp(),step,
      worktree:session.worktree??null,branch:session.branch??null,base:session.base??null,lead:{sessionId:session.id,lastSeen:null},adoptedFrom:session.id});
  });
  // A change of a mission, under the lock; a change that returns false writes nothing.
  const update=(id,change)=>lock(async()=>{
    const mission=await read(id);
    if(await change(mission)===false)return mission;
    mission.updatedAt=stamp();
    await writeJSON(path(id),mission);
    return mission;
  });
  // A mission that is over stays over while another one is under way on its issue: two chains on one issue would launch
  // everything twice.
  function setStep(id,step,line) {
    if(!MISSION_STEPS.includes(step))fail('INVALID_ARGUMENT','Unknown step of a mission.');
    return update(id,async m=>{
      if(m.step===step)return false;
      if(!missionActive(m)&&missionActive({step})&&m.issue?.id&&(await all()).some(o=>o.id!==m.id&&missionActive(o)&&o.issue?.id===m.issue.id))return false;
      m.step=step;m.log=[...m.log,{at:stamp(),text:line||step}].slice(-LOG_MAX);
    });
  }
  // Where a mission is kept: the file an operational message names instead of copying its words (decision 61).
  const fileOf=id=>typeof id==='string'&&ID.test(id)?path(id):null;
  return {create,adopt,read,list,ofSession,update,setStep,stamp,fileOf};
}

// A PO of the first version at work on this issue gets its mission before anything new is made for it: the chain it
// runs would never be walked again. A PO that is done leaves the issue free. The demand that nobody had recorded is
// the one given here; one already on the mission stays.
// That PO, read only (nothing adopted).
export async function workingPoOf(loadState,issueId) {
  return ((await loadState()).sessions||[]).find(s=>s.role==='po'&&s.issueId===issueId&&s.worktree&&!s.stoppedAt)||null;
}
export async function missionOfWorkingPo(registry,loadState,issueId,request) {
  const po=await workingPoOf(loadState,issueId);
  if(!po)return null;
  const step=missionStepOf(po);
  if(!missionActive({step}))return null;
  const mission=await registry.adopt(po,step);
  if(!mission||!missionActive(mission))return null;
  return registry.update(mission.id,m=>{if(m.request!=null)return false;m.request=request;});
}

// The last PO of the first version stopped on this issue while its work was still under way: a Lead launched after it
// takes up its folder and its step, the work already done stays done.
export async function stoppedPoOf(loadState,issueId) {
  const po=((await loadState()).sessions||[]).filter(s=>s.role==='po'&&s.issueId===issueId&&s.worktree&&s.stoppedAt).at(-1)||null;
  return po&&missionActive({step:missionStepOf(po)})?po:null;
}

// One section of an issue's description (level 2 by default), its sub-sections included, until the next title of the
// same level or above. Several names may be given for one section (« Décidé », « Decided »).
const SECTION_MAX=8000,LINKS_MAX=12;
// A Markdown title read by hand, in one pass over the line: no pattern that could backtrack on what Tracker holds.
function titleOf(line) {
  let n=0;while(n<line.length&&n<7&&line[n]==='#')n++;
  if(n<1||n>6||(line[n]!==' '&&line[n]!=='\t'))return null;
  let end=line.length;while(end>n&&(line[end-1]===' '||line[end-1]==='\t'||line[end-1]==='#'))end--;
  return {level:n,text:line.slice(n,end).trim().toLowerCase()};
}
export function issueSection(markdown,title,level=2) {
  const lines=String(markdown||'').split(/\r\n|\r|\n/),want=[].concat(title).map(t=>String(t).toLowerCase()),out=[];
  let on=false;
  for(const line of lines){
    const head=titleOf(line);
    if(head&&head.level<=level){if(on)break;on=head.level===level&&want.includes(head.text);continue;}
    if(on)out.push(line);
  }
  const text=out.join('\n').trim();
  return text?text.slice(0,SECTION_MAX):null;
}
// What a description says before its first title: its summary, as written.
export function issueIntro(markdown) {
  const out=[];
  for(const line of String(markdown||'').split(/\r\n|\r|\n/)){if(titleOf(line))break;out.push(line);}
  const text=out.join('\n').trim();
  return text?text.slice(0,1200):null;
}
// The links a description gives in Markdown, web addresses only, each once.
export function issueLinks(markdown) {
  const seen=new Set(),out=[];
  for(const [,label,url] of String(markdown||'').matchAll(/\[([^\]\n]{1,200})\]\((https?:\/\/[^\s)]{1,500})\)/g)){
    if(seen.has(url))continue;seen.add(url);out.push({text:label.trim(),url});
    if(out.length>=LINKS_MAX)break;
  }
  return out;
}
// Where the QA agent of a mission stands, from what it leaves (the user, 2026-11-12: it ran unseen beside « Lead Idle »):
// its last launch, the tests it has captured since (3.png and 3-detail.png are one test), its report once written
// after that launch. A report older than the launch is the one of the run before: the new run is not done. Its
// terminal, the screen sees it. Never launched and no report: null.
export function qaRunOf(launch,reportAt,shots) {
  if(!launch&&!reportAt)return null;
  const since=launch?.launchedAt?Date.parse(launch.launchedAt):null,after=at=>since===null||Date.parse(at)>=since;
  const mine=(shots||[]).filter(s=>s&&typeof s.at==='string'&&after(s.at));
  const done=Boolean(reportAt)&&after(reportAt);
  return {launchedAt:launch?.launchedAt??null,reportAt:done?reportAt:null,done,tests:new Set(mine.map(s=>s.test)).size,lastShotAt:mine.reduce((last,s)=>!last||s.at>last?s.at:last,null)};
}
// The frozen copy as the page reads it (simulation/CONTRAT.md, `approval`): absent until the plan is approved.
// The approvals of before (M7) are given as a history, without their plans: what each one said, as the frozen copy is
// read (decision 82: the approval of before stays readable from the sheet of the copy).
const approvalShown=mission=>{
  if(!mission?.approval)return {};
  const {plan:_plan,extra:_extra,previous,...shown}=mission.approval;
  return {approval:{...shown,...(Array.isArray(previous)&&previous.length?{history:previous.map(p=>({at:p.at,revision:p.revision??null,tickets:p.tickets??null,...(p.kind?{kind:p.kind}:{}),...(p.simple===true?{simple:true}:{}),branch:p.branch??null,...(Number.isInteger(p.openQuestions)?{openQuestions:p.openQuestions}:{}),...(p.manual?{manual:p.manual}:{}),...(Array.isArray(p.approves)?{approves:p.approves}:{})}))}:{})}};
};
// The drift from the copy, and the version of it a reapproval names (ticket M7): absent until the plan is approved.
const driftShown=mission=>{const drift=driftOf(mission);return drift?{drift,driftSeen:driftSeenOf(mission)}:{};};
export function createMissionActions({root=null,now=Date.now,registry,loadConfig=async()=>({}),loadState,getTickets,previewRead,chain,questions,inbox,validation=null,send=null,window=null,tokens=null,environment=null,environmentHold=null,claims=root?createClaims({root,now}):null}) {
  // The message of a request left to the Lead goes once, claimed where the chain of the mission keeps its claims.
  const handover=createHandover({inbox,send:message=>send(message),now});
  const only=(input,names)=>{if(Object.keys(input).some(key=>!names.includes(key)))fail('INVALID_ARGUMENT','Unexpected mission argument.');};
  // « Since your last visit » (ticket M14): the cursor of what the page showed, kept apart from the missions
  // (src/visits.mjs). A reading never moves it; only the acknowledgement of the screen does (visitSeen).
  const visits=root?createVisits({root,now}):null;
  async function create(raw) {
    const input=object(raw);only(input,['project','issueId','request','machine']);
    const request=text(input.request,'request',REQUEST_MAX).trim();
    if(input.machine!==undefined&&input.machine!==null)fail('INVALID_ARGUMENT','Missions run on this computer for now.');
    const project=await teamProject(loadConfig,input.project);
    let issue=null;
    if(input.issueId!==undefined) {
      // The issue is read again here: a screen or an agent never supplies it.
      const found=ticketOf(await (await getTickets()).detail(text(input.issueId,'issueId',200),{refresh:true}));
      if(found.team?.id!==project.teamId)fail('ISSUE_NOT_IN_TEAM','This issue does not belong to the team of the project.');
      issue=issueBrief(found);
    }
    const open=mission=>({created:false,code:'MISSION_OPEN',message:'This issue already has a mission under way.',mission});
    const taken=issue?await missionOfWorkingPo(registry,loadState,issue.id,request):null;
    if(taken)return open(taken);
    const made=await registry.create({project:project.key,issue,request});
    return made.created?{created:true,mission:made.mission}:open(made.mission);
  }
  // A mission M-n and what its chain says. A preview of src/missions.mjs is still read by its UUID.
  async function read(raw) {
    const input=object(raw);
    if(!Object.hasOwn(input,'mission')||Object.hasOwn(input,'missionId'))return previewRead(input);
    only(input,['mission']);
    // The switch-over first, before anything of the state is read (decision 61): the very first reading after an
    // installation never gives an answer of the old stock.
    await inbox?.switched?.();
    const mission=await registry.read(input.mission),run=await chain.read({mission:mission.id});
    // What the QA agent found, once it has written it; unread or absent, it stays unknown.
    const checked=validation&&mission.lead?.sessionId?await validation({sessionId:mission.lead.sessionId}).catch(()=>null):null,qa=checked?.qa??null;
    // The tokens of its tickets and agents (M13): unknown, or none traced, and there is no number.
    const counted=tokens?await tokens({mission:mission.id}).catch(()=>null):null;
    const items=await inbox.list({mission:mission.id}),recap=visits?await recapOf(mission,run,items):{};
    // The environment check of its project (M6 b, src/environment-view.mjs): unreadable, it is unknown, never green.
    const environmentNow=environment&&mission.project?await environment({project:mission.project}).catch(()=>ENVIRONMENT_UNKNOWN):null;
    return {mission,on:run.on,journal:run.log,metrics:run.metrics,...(environmentNow?{environment:environmentNow}:{}),...(run.timings?{timings:run.timings}:{}),...(counted?{tokens:counted}:{}),...(run.pause?{pause:run.pause}:{}),reports:run.reports||[],qaRun:qaRunOf(run.qa??null,qa?.at??null,checked?.shots),qa:qa&&{at:qa.at,verdict:qa.verdict,summary:qa.summary,found:qa.found??null,checkFirst:qa.checkFirst??null,risks:qa.risks??null,tests:qa.tests.length,plan:qa.tests,marks:checked.marks||{}},questions:(await questions.list({mission:mission.id})).filter(q=>q.state!=='resolved'),items,decisions:await inbox.taken({mission:mission.id,launchedAt:mission.launchAskedAt??null}),...approvalShown(mission),...driftShown(mission),...recap};
  }
  // What happened since the cursor (ticket M14), read only. The cursor or the chain unreadable: the recap is unknown,
  // said unavailable, and the mission is read all the same.
  async function recapOf(mission,run,items) {
    try{return sinceVisit({record:await visits.read(mission.id),done:await chainDone(root,mission.id),timings:run.timings,items});}
    catch{return {visit:{unavailable:true}};}
  }
  // « Seen » (ticket M14): the page acknowledges what it showed, up to the instant of the last fact it drew. A command
  // of the screens only (src/backend.mjs, SCREEN_COMMANDS): an agent can never hide a fact from the user.
  async function visitSeen(raw) {
    const input=object(raw);only(input,['mission','upTo']);
    if(!visits)fail('INVALID_ARGUMENT','No visits without a state folder.');
    const mission=await registry.read(input.mission),record=await visits.seen(mission.id,input.upTo);
    return {mission:mission.id,upTo:record.upTo,at:record.at};
  }
  async function list(raw) {
    const input=object(raw);only(input,['project','active','journal']);
    if(input.project!==undefined)text(input.project,'project',48);
    for(const key of ['active','journal'])if(input[key]!==undefined&&typeof input[key]!=='boolean')fail('INVALID_ARGUMENT',key+' must be a boolean.');
    const missions=await registry.list({active:input.active===true,project:input.project});
    if(input.journal!==true)return {missions};
    return {missions:await Promise.all(missions.map(async m=>m.unreadable?m:{...m,...await chain.brief(m.id)}))};
  }
  // The TL;DR of a development and of its tickets, kept by its Lead: what it does, in plain words.
  async function tldr(raw) {
    const input=object(raw);only(input,['mission','text','tickets']);
    if(input.text===undefined&&input.tickets===undefined)fail('INVALID_ARGUMENT','Give a text, or tickets.');
    const summary=input.text===undefined?undefined:text(input.text,'text',TLDR_MAX).trim(),tickets=input.tickets===undefined?{}:object(input.tickets);
    for(const [id,value] of Object.entries(tickets)){if(!/^[A-Z][A-Z0-9]{0,9}-\d{1,7}$/.test(id))fail('INVALID_ARGUMENT','Unknown ticket.');text(value,'ticket text',TLDR_TICKET_MAX);}
    const mission=await registry.update(input.mission,m=>{if(summary!==undefined)m.tldr=summary;m.tldrs={...(m.tldrs||{}),...Object.fromEntries(Object.entries(tickets).map(([id,value])=>[id,value.trim()]))};});
    return {mission:mission.id,tldr:mission.tldr??null,tldrs:mission.tldrs||{}};
  }
  // « Approve and start the dev »: the command of the screens, and of nothing else (decision 55: no agent is given it).
  // The plan the screen drew (`seen`, its revision) is approved: its frozen copy is recorded once, before anything is
  // sent, then the launch is asked of the Lead, once, who starts its devs through the watcher. No dev starts without
  // that copy (src/dev-chain.mjs). Refused, nothing is written. A message whose fate is unknown (Herdr mute, an answer
  // lost, a process stopped midway) is said unknown and never sent again; one known not to have left can be asked again.
  // What this does not prove, as for inbox-answer: that a person clicked. The engine knows a command, not who ran it.
  const approvals=root?task=>waitLock(join(root,'state','approvals'),task).catch(error=>{if(error.code==='BUSY')fail('LAUNCH_BUSY',APPROVAL.busy);throw error;}):task=>task();
  async function launch(raw) {
    const owner=ownerOf(await loadConfig());
    const input=object(raw);only(input,['mission','seen','stopAfter']);
    if(input.seen===undefined)fail('SEEN_REQUIRED','Read the plan again, then approve it.');
    // The limit chosen at the launch (chantier 1, point 16): written with the approval; absent, the mission keeps its own.
    const limit=input.stopAfter===undefined?undefined:stopAfterArg(input.stopAfter);
    if(!Number.isInteger(input.seen)||input.seen<1)fail('INVALID_ARGUMENT','seen must be the revision of the plan that was shown.');
    const id=(await registry.read(input.mission)).id;
    return approvals(async()=>{
      const session=await liveLead(id),at=new Date(now()).toISOString();
      // Checked on every click, the copy written or not (M5 review 2): a page left open long may click on a mission
      // started or over since, or whose plan was rewritten after its copy (its reapproval comes with M7). The open
      // questions are checked once, with the copy.
      // A plan rewritten after its copy, before any dev left (M7, no more dead end on PLAN_REVISED): the click on the plan
      // the screen drew approves it again, as a first approval, the copy of before kept beneath it.
      const unapproved=m=>!m.approval||!samePlan(m.approval.plan,m.plan);
      const refused=(m,items)=>{
        if(!missionActive(m))fail('MISSION_OVER','This development is already over.');
        if(!BEFORE_DEVS.includes(m.step))fail('MISSION_STARTED',APPROVAL.started);
        if(!hasPlan(m))fail('PLAN_MISSING',APPROVAL.missing);
        if(m.plan.revision!==input.seen)fail('PLAN_REVISED',APPROVAL.changed);
        if(unapproved(m)&&openQuestionsOf(items,m.plan)>0)fail('QUESTIONS_OPEN',APPROVAL.open);
      };
      // The Lead at work, or held in its terminal, prepares a plan that may still move (decision 49): approved once it has
      // finished, by the rule of the page (LEAD_BUSY). Read under the lock of the copy. Herdr out of reach approves nothing.
      const busy=async()=>{const a=((await window.ls()).agents||[]).find(a=>a.address===session.terminalId&&LEAD_BUSY.includes(a.status));if(a)leadBusy(a.status);};
      // The checks, the copy and the claim of the launch are one step: under the lock of the requests (none can be asked
      // meanwhile), then of the mission. The copy is written only if none is, on the plan the screen drew; the launch is
      // asked at most once: claimed before the message, said after it.
      // Asked, and nothing came of it (M5 review, P2): the Lead got the message, rests, and no dev was asked of the core
      // (the chain is off). Once the two minutes of the page are over, a click asks the Lead again, once per click. It
      // never makes two devs: the lane of the mission refuses a second dev, whoever asks (src/dev-lane.mjs).
      const on=chain?.read?await chain.read({mission:id}).then(r=>Boolean(r?.on),()=>true):true;
      const quiet=m=>{const said=Date.parse(m.launchAskedAt||m.launch?.saidAt||'');return !on&&Number.isFinite(said)&&Date.parse(at)-said>=ASK_AGAIN_MS;};
      // The environment its project declares, read once, kept as read from here to the message to the Lead (M6 b engine
      // review 1): no check starts in between. Order of the locks: the approvals, the environment, then the requests and
      // the mission. Not green, nothing is written nor sent (decision 111).
      return withEnvironment({read:environment,hold:environmentHold},await registry.read(id),async({held})=>{
      let mine=false,state=null;
      await inbox.withWaiting(id,items=>registry.update(id,async m=>{
        refused(m,items);await busy();
        const changedLimit=limit!==undefined&&m.stopAfter!==limit;
        if(limit!==undefined)setStopAfter(m,limit);
        if(held&&!devStarted(m))fail('ENVIRONMENT_NOT_READY',APPROVAL.environment);
        const fresh=!m.approval,moved=!fresh&&unapproved(m);
        state=m.launch?.state??(m.launchAskedAt?'asked':null);
        // Never while a launch is in doubt: the copy it was asked on stays.
        if(moved&&['asking','unknown'].includes(state))fail('LAUNCH_UNSURE',APPROVAL.unsure);
        if(fresh){m.approval=frozenCopyOf(m,{at,owner});m.log=[...(m.log||[]),{at,text:'Plan approuvé par le propriétaire'}].slice(-LOG_MAX);}
        if(moved){m.approval=approvedAgain(m,{at,owner,items,drift:driftEntries(m)});m.log=[...(m.log||[]),{at,text:LOG.updated}].slice(-LOG_MAX);}
        const again=state==='asked'&&quiet(m);
        if(state!==null&&state!=='failed'&&!again)return fresh||moved||changedLimit?undefined:false;
        m.launch={state:'asking',at,...(again?{again:(m.launch?.again||0)+1}:{})};mine=true;
        if(again)m.log=[...(m.log||[]),{at,text:LOG.again}].slice(-LOG_MAX);
      }));
      if(!mine) {
        if(state==='asked')return {mission:id,approved:true,launch:'asked',asked:true};
        fail('LAUNCH_UNSURE',APPROVAL.unsure);
      }
      const approved=await registry.read(id);
      // Said only of the launch this click claimed, still « asking »: a failure the Lead met meanwhile stays (M5 review,
      // minor 2), and the page offers the approval again.
      const said=launchState=>registry.update(id,m=>{if(m.launch?.state!=='asking'||m.launch.at!==at)return false;m.launch={...m.launch,state:launchState,saidAt:new Date(now()).toISOString()};if(launchState==='asked')m.launchAskedAt=m.launch.saidAt;});
      try{await send({sessionId:session.id,terminal:session.terminalId,text:launchAsk({issue:approved.issue?.identifier??null,at:approved.approval.at,stopAfter:stopAfterOf(approved)})});}
      catch(error){
        // Refused before the message reached Herdr: known not sent. Anything else may have arrived.
        if(['SEND_FAILED','NOT_FOUND','INVALID_ARGUMENT'].includes(error?.code)){await said('failed');throw error;}
        await said('unknown');fail('LAUNCH_UNSURE',APPROVAL.unsure);
      }
      const after=await said('asked');
      return {mission:id,approved:true,launch:after.launch?.state==='failed'?'failed':'asked',asked:true};
      });
    });
  }
  // « Approve these changes » (M7, decisions 77 and 80): the command of the screens, and of nothing else, as mission-launch.
  // The drift the screen drew (`seen`, its version) is approved: the frozen copy becomes the plan of today, the copy of
  // before kept whole beneath it, and the tickets added or changed go as any other. Once the devs have left only (before,
  // « Approve and start the dev » does it). Refused, nothing is written.
  async function reapprove(raw) {
    const owner=ownerOf(await loadConfig());
    const input=object(raw);only(input,['mission','seen']);
    if(input.seen===undefined)fail('SEEN_REQUIRED',APPROVAL.reopen);
    if(typeof input.seen!=='string'||!/^[0-9a-f]{16}$/.test(input.seen))fail('INVALID_ARGUMENT','seen must be the version of the changes that was shown (driftSeen).');
    const id=(await registry.read(input.mission)).id;
    return approvals(async()=>{
      const at=new Date(now()).toISOString();let approved=null;
      // The Lead at work, or held in its terminal, may be rewriting its plan (decision 49, M7 review): approved once it
      // has finished, as « Approve and start the dev ». Herdr out of reach approves nothing. Without a Lead running,
      // nothing is being rewritten. Read under the lock of the mission (M7 review 2): a Lead started meanwhile is seen.
      const busy=async m=>{
        const leadId=m.lead?.sessionId,session=leadId?((await loadState()).sessions||[]).find(x=>x.id===leadId&&!x.stoppedAt&&x.terminalId)||null:null;
        const lead=session&&window?((await window.ls()).agents||[]).find(a=>a.address===session.terminalId&&LEAD_BUSY.includes(a.status)):null;
        if(lead)leadBusy(lead.status);
      };
      await inbox.withWaiting(id,items=>registry.update(id,async m=>{
        if(!missionActive(m))fail('MISSION_OVER','This development is already over.');
        if(!m.approval)fail('NOT_APPROVED',NOT_APPROVED);
        if(BEFORE_DEVS.includes(m.step))fail('MISSION_NOT_STARTED',APPROVAL.notStarted);
        if(!hasPlan(m))fail('PLAN_MISSING',APPROVAL.missing);
        const entries=driftEntries(m),seen=driftSeenOf(m);
        if(!seen)fail('NO_DRIFT',APPROVAL.noDrift);
        if(seen!==input.seen)fail('DRIFT_CHANGED',APPROVAL.driftChanged);
        // An open question or request holds the reapproval as it holds the first approval (decision 82): same refusal.
        if(openQuestionsOf(items,m.plan)>0)fail('QUESTIONS_OPEN',APPROVAL.open);
        await busy(m);
        m.approval=approvedAgain(m,{at,owner,items,drift:entries,withExtra:true,approves:entries.map(({ticket,part,kind,fields})=>({...(ticket?{ticket}:{}),...(part?{part}:{}),kind,...(fields?{fields}:{})}))});
        approved=entries.map(d=>d.ticket||d.part);
        m.log=[...(m.log||[]),{at,text:LOG.changesApproved(entries)}].slice(-LOG_MAX);
      }));
      return {mission:id,approved:true,reapproved:approved};
    });
  }
  // the user asks for the closure, from his Validation: recorded first (it is what lets the Lead close), then the Lead is
  // told. The Lead checks, then closes with lead-close; a Lead never closes on its own.
  async function close(raw) {
    const input=object(raw);only(input,['mission']);
    const mission=await registry.read(input.mission);
    if(!missionActive(mission))fail('MISSION_OVER','This development is already over.');
    // Asked once: a second click sends nothing more to the Lead.
    if(mission.closeAskedAt)return {mission:mission.id,asked:true};
    const session=await liveLead(mission.id);
    await registry.update(mission.id,m=>{const at=new Date().toISOString();m.closeAskedAt=at;m.log=[...(m.log||[]),{at,text:'Clôture demandée par le propriétaire'}].slice(-LOG_MAX);});
    await send({sessionId:session.id,terminal:session.terminalId,text:closeAsk()});
    return {mission:mission.id,asked:true};
  }
  // The Lead closes its mission, and only once the user has asked for it.
  async function leadClose(raw) {
    const input=object(raw);only(input,['mission']);
    // The standalone actions API accepts no root; the backend always supplies it for the shared closure lock.
    const underClose=task=>root?missionCloseLock(root,input.mission,task):task();
    return underClose(async()=>{
    const mission=await registry.read(input.mission);
    if(mission.step==='closed')return {mission:mission.id,closed:true};
    if(!mission.closeAskedAt)fail('CLOSE_NOT_ASKED','le propriétaire has not asked to close this development: a Lead never closes on its own.');
    // In pause the mission is not closed (M11 review 1): refused, MISSION_PAUSED.
    const closing=()=>registry.setStep(mission.id,'closed','Mission clôturée par le Lead, à la demande du propriétaire');
    await (chain?.unpaused?chain.unpaused(mission.id,closing):closing());
    return {mission:mission.id,closed:true};
    });
  }
  // The plan of a development as its issue says it in Tracker: its Plan and Clarification sections, whole (their sub-titles
  // included), and the links of the description. What Tracker holds is data: shown as text, never run. Tracker down or
  // no issue: said so, nothing invented.
  async function plan(raw) {
    const input=object(raw);only(input,['mission']);
    const mission=await registry.read(input.mission);
    if(!mission.issue?.id||!getTickets)return {mission:mission.id,unavailable:true};
    let issue=null;
    try{issue=ticketOf(await (await getTickets()).detail(mission.issue.id,{refresh:false}));}catch{return {mission:mission.id,unavailable:true};}
    const description=String(issue?.description||'');
    return {mission:mission.id,plan:issueSection(description,'plan'),decided:issueSection(issueSection(description,'clarification'),['décidé','decided'],3),links:issueLinks(description),url:issue?.url??null};
  }
  // The sheet of a ticket, as Tracker has it, with what was done on it: its development when it has one. Read whole when
  // its page opens (refresh), from the cache after. What Tracker holds is data, shown as text; Tracker down is said so.
  const nameOf=v=>typeof v==='string'?v:v?.displayName||v?.name||null;
  async function sheet(raw) {
    const input=object(raw);only(input,['issueId','refresh']);
    text(input.issueId,'issueId',200);
    if(input.refresh!==undefined&&typeof input.refresh!=='boolean')fail('INVALID_ARGUMENT','refresh must be a boolean.');
    const mission=(await registry.list()).find(m=>m.issue?.id===input.issueId)||null;
    let issue=null;
    try{issue=getTickets?ticketOf(await (await getTickets()).detail(input.issueId,{refresh:input.refresh===true}))??null:null;}catch{issue=null;}
    const description=String(issue?.description||''),tickets=mission?.tickets||[];
    const journal=mission&&chain?((await chain.brief(mission.id).catch(()=>null))?.journal||[]):[];
    return {issueId:input.issueId,unavailable:!issue,
      issue:issue?{identifier:issue.identifier??null,title:issue.title??null,url:issue.url??null,state:{name:issue.state?.name??issue.status?.label??null,type:issue.state?.type??issue.status?.category??issue.statusType??null},priority:issue.priorityLabel??null,assignee:nameOf(issue.assignee),labels:(issue.labels||[]).map(nameOf).filter(Boolean).slice(0,12),branch:issue.branchName||issue.gitBranchName||null,createdAt:issue.createdAt??null,updatedAt:issue.updatedAt??null,project:nameOf(issue.project)}:null,
      summary:issueIntro(description),plan:issueSection(description,'plan'),decided:issueSection(issueSection(description,'clarification'),['décidé','decided'],3),links:issueLinks(description),
      children:(issue?.children||[]).slice(0,50).map(c=>({identifier:c.identifier??null,title:c.title??null,state:c.state?.name??null,stateType:c.state?.type??null,agent:(c.labels||[]).map(nameOf).find(n=>/^agent:/i.test(String(n)))?.slice(6).trim().toLowerCase()||null,model:c.model??null})),
      comments:(issue?.comments||[]).slice(-5).reverse().map(c=>({author:nameOf(c.user)||nameOf(c.author),at:c.createdAt??null,body:String(c.body||'').slice(0,600)})),
      mission:mission?{id:mission.id,step:mission.step,tldr:mission.tldr??null,tickets:tickets.length,done:tickets.filter(t=>t.state==='merged').length,mockups:(mission.mockups||[]).slice(0,12),journal:journal.slice(-10)}:null};
  }
  // The Lead records its plan in its mission (v2): checked whole first, then against the sub-tickets the tracker has for
  // the issue, read again and never written. Each ticket takes the identity of its sub-ticket. The same plan recorded
  // again changes nothing; a plan that changed is a new revision. A tracker out of reach vouches for nothing, and it is
  // said so: the plan is kept, its tickets without the identity nobody read. tracker.verified is what the reading of
  // this very recording said, never an older one; what was vouched for before is a memory, kept apart: the identities
  // already read, and the date this plan was first vouched for (verifiedAt).
  async function savePlan(raw) {
    const input=object(raw);only(input,['mission','plan']);
    const known=await registry.read(input.mission),over=()=>fail('MISSION_OVER','This development is already over: its plan no longer changes.');
    if(!missionActive(known))over();
    // The rule of the models is the configuration's; one that cannot be read gives no rule.
    const config=loadConfig?await loadConfig().catch(()=>null):null,plan=planOf(input.plan,{profiles:config?.profiles??null});
    let uids=new Map(),verified=false,kids=null;
    if(known.issue?.id&&getTickets){
      let issue=null;
      try{issue=ticketOf(await (await getTickets()).detail(known.issue.id,{refresh:true}))??null;}catch{issue=null;}
      if(issue&&Array.isArray(issue.children)){
        // The sub-tickets the tracker has before the first approval: kept out of it for good (decision 82).
        kids=issue.children.map(c=>c?.identifier);
        // A list read in part says nothing of the sub-tickets it does not show (same rule as the chain).
        const whole=!(issue.childrenComplete===false&&issue.childrenReason!=='incomplete-fields');
        ({uids,whole:verified}=againstTracker(plan,issue.children,whole));
      }
    }
    let saved=false;
    const mission=await registry.update(known.id,m=>{
      if(!missionActive(m))over();
      const old=m.plan||null,same=samePlan(old,plan),uidOf=id=>uids.get(id)??old?.tickets?.find(t=>t.id===id)?.uid??null;
      const next={...plan,tickets:plan.tickets.map(t=>({...t,uid:uidOf(t.id)})),revision:same?old.revision:(old?.revision||0)+1,savedAt:same?old.savedAt:registry.stamp(),tracker:{verified,verifiedAt:(same?old.tracker?.verifiedAt:null)||(verified?registry.stamp():null)}};
      const seen=JSON.stringify(m.trackerSeen??null);noteSeen(m,kids);
      if(old&&JSON.stringify(next)===JSON.stringify(old))return JSON.stringify(m.trackerSeen??null)===seen?false:undefined;
      m.plan=next;saved=true;noteDrift(m,registry.stamp());
    });
    return {mission:mission.id,saved,unchanged:!saved,revision:mission.plan.revision,tickets:mission.plan.tickets.length,tracker:mission.plan.tracker};
  }
  // Waiting for an answer: opened with Pilot or not.
  const stillOpen=item=>!item.legacy&&['pending','opening'].includes(item.state)&&!item.answer;
  async function liveLead(id) {
    // A Lead the chain put to rest (lot 1B) keeps its session: the send wakes it (lead-wake.mjs).
    const mission=await registry.read(id),session=((await loadState()).sessions||[]).find(s=>s.id===mission.lead?.sessionId);
    if(!session||session.stoppedAt||!session.terminalId)fail('NOT_FOUND','This development has no Lead running.');
    return session;
  }
  // the user opens a request to talk it over with the Lead: it is given the question, once, even after two quick clicks.
  async function discuss(raw) {
    const input=object(raw);only(input,['item']);
    const known=await inbox.read(input.item);
    if(!stillOpen(known)||known.discussedAt)return {item:known.id,told:false};
    const session=await liveLead(known.mission);
    const {item,changed}=await inbox.mark(known.id,{discussedAt:new Date(now()).toISOString()},{when:['pending','opening']});
    if(!changed||item.answer)return {item:known.id,told:false};
    try{await send({sessionId:session.id,terminal:session.terminalId,text:discussAsk(item,{file:inbox.fileOf(item.id)})});}
    catch(error){await inbox.mark(item.id,{discussedAt:null});throw error;}
    return {item:item.id,told:true};
  }
  // the user leaves a decision to the Lead. It is an answer like any other: written once, by the one function that
  // records an answer, with the version the screen showed. From then on no other answer can be given, the question of an
  // agent is given back to the Lead, and the Lead is told once: by this call, or by the watcher if this call stops
  // midway, never by both (once). A second window gets the same outcome and sends nothing. A Lead out of reach leaves
  // the request as it was: nothing is written.
  async function delegate(raw) {
    const input=object(raw);only(input,['item','seen']);
    const known=await inbox.read(input.item);
    // A question only (decision 44): neither a suggestion, nor a verdict, nor a choice of copy.
    if(known.type!=='decision'||known.kind)fail('INVALID_ARGUMENT','Only a question can be left to the Lead.');
    if(!claims)fail('STORAGE_ERROR','The claims of this development cannot be kept.');
    const session=await liveLead(known.mission);
    const made=await inbox.answer({item:known.id,seen:input.seen,via:'screen',left:true});
    if(!made.answer.left)fail('QUESTION_CLOSED','This request has already been answered.');
    const {waits}=await inbox.settle(made.item.id);
    await handover(made.item,{waits,claims,target:async()=>({sessionId:session.id,terminal:session.terminalId})});
    return {item:made.item.id,delegated:true};
  }
  // mission-stop-after (chantier 1, point 16): the limit of a mission, from the screens only (SCREEN_COMMANDS). Set back to
  // Validate, a mission held at the end of Develop goes on: the watcher starts its QA agent and its Validation.
  async function stopAfter(raw) {
    const input=object(raw);only(input,['mission','stopAfter']);
    const value=stopAfterArg(input.stopAfter),id=(await registry.read(input.mission)).id;
    // Under the lock of the lane, where the watcher starts the QA agent and the Validation: once this answers, no pass
    // that read the limit before can start them.
    const write=()=>registry.update(id,m=>{setStopAfter(m,value);});
    const mission=await (chain?.underLane?chain.underLane(id,write):write());
    return {mission:mission.id,stopAfter:stopAfterOf(mission)};
  }
  return {create,read,visitSeen,list,tldr,launch,reapprove,close,leadClose,plan,savePlan,sheet,delegate,discuss,stopAfter};
}
