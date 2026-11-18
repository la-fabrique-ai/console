import { fail, canonical } from './common.mjs';
import { MODEL_EFFORTS } from './config.mjs';
import { devRows } from '../ui/v3/view.js';

// The plan of a mission, as its Lead records it (v2): a list of tickets, each named by its sub-ticket of the tracker.
// That identifier is the identity of the ticket; its rank only says where it is shown. A dependency names a ticket by
// its identifier, never by its rank. A plan badly formed is refused whole, with the ticket at fault: nothing of it is
// kept, and nothing is guessed.
export const PLAN_FORMAT=2;
export const DIFFICULTIES=Object.freeze(['light','standard','heavy']);
export const KINDS=Object.freeze(['work','design']);
export const DELIVERIES=Object.freeze(['included','deferred','associated','integrated']);
const TICKET=/^[A-Z][A-Z0-9]{0,9}-\d{1,7}$/,KEY=/^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/,AGENTS=['claude','codex'];
const TICKETS_MAX=200,LIST_MAX=50,RANK_MAX=9999,TITLE_MAX=255,TEXT_MAX=2000,MODEL_MAX=80,MODEL=/^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const TICKET_KEYS=['id','rank','title','result','difficulty','kind','delivery','integratedBy','agent','dev','model','effort','modelReason','deps','phase','covers','texts','mockups'];
// The devs a plan may share its tickets between: Dev 1 and Dev 2, two at most (decision 14).
const DEVS=[1,2];
// What a plan says beside its tickets, for Prepare (simulation/CONTRAT.md § 1): its phases, the requests of its issue,
// the approach of its Lead, its migrations, what to plan for, and whether it is a plan of one ticket.
const PLAN_KEYS=['tickets','phases','requests','approach','migrations','simple','points','toPlan'];
// The two lists of the plans of before, and where what they said goes now.
const MOVED={risks:'risks is now toPlan.risks: {summary, items: [{title, detail, tickets}]}.',manual:'manual is now toPlan.manual: {summary, note, items: [{title, detail, tickets}]}.'};
const REQUEST_KEYS=['id','short','full','state','postponedAt','reason'],REQUEST_STATES=['asked','postponed','pending'],POINTS_MAX=999,DAY=/^\d{4}-\d\d-\d\d$/;
const INSTANT=/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d{1,3})?)?(?:Z|[+-]\d\d:\d\d)$/;
// A day of the calendar: Date.parse reads « 2026-02-30 » as March 2, so the day is checked against its own month.
const onCalendar=value=>{const [y,m,d]=value.slice(0,10).split('-').map(Number),day=new Date(Date.UTC(y,m-1,d));return day.getUTCFullYear()===y&&day.getUTCMonth()===m-1&&day.getUTCDate()===d;};
// The level the chain and the screens of today know a difficulty by.
const LEVELS={light:'léger',standard:'standard',heavy:'fort'};
// The model of a ticket follows its difficulty: the rule is the profile the configuration gives a dev of that agent
// for that level. Null where none is configured: nothing is called a rule then.
function ruleFor(profiles,agent,difficulty) {
  const byLevel=plain(profiles?.dev)&&Object.hasOwn(profiles.dev,agent)?profiles.dev[agent]:null,level=LEVELS[difficulty];
  const rule=plain(byLevel)&&Object.hasOwn(byLevel,level)?byLevel[level]:null;
  return plain(rule)&&typeof rule.model==='string'&&MODEL.test(rule.model)&&MODEL_EFFORTS.includes(rule.effort)?{model:rule.model,effort:rule.effort}:null;
}

const plain=value=>Boolean(value)&&typeof value==='object'&&!Array.isArray(value);
const words=(value,max)=>typeof value==='string'&&Boolean(value.trim())&&value.length<=max&&!value.includes('\0');
const known=(value,keys)=>plain(value)&&Object.keys(value).every(key=>keys.includes(key));
// What a ticket is named by in a refusal: its identifier when it has a readable one, else its place in the list.
const nameOf=(raw,n)=>typeof raw?.id==='string'&&TICKET.test(raw.id)?raw.id:'ticket '+(n+1);
// A list of short texts, each kept once; absent is empty.
function textsOf(value,max,refuse) {
  if(value===undefined)return [];
  if(!Array.isArray(value)||value.length>LIST_MAX||!value.every(item=>words(item,max)))refuse();
  return [...new Set(value.map(item=>item.trim()))];
}
// The entries a plan names by a key of its own (its phases, the requests of its issue).
function keyed(value,field,what) {
  if(value===undefined)return [];
  if(!Array.isArray(value)||value.length>LIST_MAX)fail('PLAN_INVALID',`The ${what} of a plan are a list.`);
  const seen=new Set();
  return value.map(item=>{
    if(!known(item,['id',field])||typeof item.id!=='string'||!KEY.test(item.id)||!words(item[field],TEXT_MAX))fail('PLAN_INVALID',`Each of the ${what} has an id and a ${field}.`);
    if(seen.has(item.id))fail('PLAN_INVALID',`Two ${what} share the id ${item.id}.`);
    seen.add(item.id);
    return {id:item.id,[field]:item[field].trim()};
  });
}
// A field of a plan badly formed: refused, named.
const bad=(field,why)=>fail('PLAN_INVALID',field+': '+why);
// One text of a plan: trimmed; absent (or empty, when it may be) is undefined.
function textOf(value,field,max,{required=false}={}) {
  if(value===undefined||value===null||(!required&&value===''))return required?bad(field,'is required.'):undefined;
  if(!words(value,max))bad(field,`is a text of at most ${max} characters.`);
  return value.trim();
}
const onlyKeys=(value,keys,field)=>{
  if(!plain(value))bad(field,'is an object.');
  const extra=Object.keys(value).find(key=>!keys.includes(key));
  if(extra!==undefined)bad(field,'unexpected field '+JSON.stringify(extra).slice(0,60)+' (it has '+keys.join(', ')+').');
};
// The approach of the Lead: one sentence (summary), a short paragraph (text), the whole of it (paragraphs).
function approachOf(raw) {
  if(raw===undefined)return undefined;
  onlyKeys(raw,['summary','text','paragraphs'],'approach');
  const summary=textOf(raw.summary,'approach.summary',TITLE_MAX,{required:true}),text=textOf(raw.text,'approach.text',TEXT_MAX);
  const paragraphs=textsOf(raw.paragraphs,TEXT_MAX,()=>bad('approach.paragraphs','is a list of the paragraphs of the approach, each a text.'));
  return {summary,...(text?{text}:{}),...(paragraphs.length?{paragraphs}:{})};
}
// The requests of the issue, by an id of their own: a few words (short), the request as the issue says it (full), and
// for one no ticket covers, where it stands (state) and why (reason). What covers it is read on the tickets (covers).
function requestsOf(raw) {
  if(raw===undefined)return [];
  if(!Array.isArray(raw)||raw.length>LIST_MAX)bad('requests',`is the list of the requests of the issue, ${LIST_MAX} at most.`);
  const seen=new Set();
  return raw.map((item,n)=>{
    const named=plain(item)&&typeof item.id==='string'&&KEY.test(item.id),field='requests['+(named?item.id:n+1)+']';
    if(!named)bad(field,'each request has an id (letters, digits, - and _).');
    if(seen.has(item.id))bad(field,'two requests share this id.');
    seen.add(item.id);
    if(Object.hasOwn(item,'text'))bad(field,'text is now short (the request in a few words) and full (the request as the issue says it).');
    onlyKeys(item,REQUEST_KEYS,field);
    const short=textOf(item.short,field+'.short',TITLE_MAX,{required:true}),full=textOf(item.full,field+'.full',TEXT_MAX,{required:true});
    if(item.state!==undefined&&!REQUEST_STATES.includes(item.state))bad(field+'.state','is asked (the Lead asks you), postponed (postponed by you) or pending (its ticket is not written yet).');
    if(item.postponedAt!==undefined){
      if(item.state!=='postponed')bad(field+'.postponedAt','is the day a request postponed was postponed: only with state postponed.');
      if(typeof item.postponedAt!=='string'||!(DAY.test(item.postponedAt)||INSTANT.test(item.postponedAt))||!Number.isFinite(Date.parse(item.postponedAt))||!onCalendar(item.postponedAt))bad(field+'.postponedAt','is a day (2026-11-12) or an instant (2026-11-12T14:02:00.000Z).');
    }
    const reason=textOf(item.reason,field+'.reason',TEXT_MAX);
    return {id:item.id,short,full,...(item.state?{state:item.state}:{}),...(item.postponedAt?{postponedAt:item.postponedAt}:{}),...(reason?{reason}:{})};
  });
}
// The tickets a line of the plan names: tickets of the plan, each once.
function ticketsNamed(value,field,known) {
  if(value===undefined)return [];
  if(!Array.isArray(value)||value.length>TICKETS_MAX)bad(field,'is the list of the tickets it concerns, by their identifier.');
  const unknown=value.find(id=>typeof id!=='string'||!known.has(id));
  if(unknown!==undefined)bad(field,`names ${typeof unknown==='string'&&unknown.length<=40?'« '+unknown+' »':'something'}, which is not a ticket of the plan.`);
  return [...new Set(value)];
}
// A list of what to plan for (the manual steps, the risks, the test accounts): its line (summary), a note, its items.
function groupOf(raw,field,known,{note=false}={}) {
  if(raw===undefined)return undefined;
  onlyKeys(raw,['summary',...(note?['note']:[]),'items'],field);
  if(!Array.isArray(raw.items)||raw.items.length>LIST_MAX)bad(field+'.items',`is a list, ${LIST_MAX} at most ([] for none).`);
  const items=raw.items.map((item,n)=>{
    const at=field+'.items['+(n+1)+']';onlyKeys(item,['title','detail','tickets'],at);
    const title=textOf(item.title,at+'.title',TITLE_MAX,{required:true}),detail=textOf(item.detail,at+'.detail',TEXT_MAX);
    return {title,...(detail?{detail}:{}),tickets:ticketsNamed(item.tickets,at+'.tickets',known)};
  });
  const summary=textOf(raw.summary,field+'.summary',TITLE_MAX,{required:items.length>0}),said=note?textOf(raw.note,field+'.note',TEXT_MAX):undefined;
  return {summary:summary??'',...(said?{note:said}:{}),items};
}
// The copy to write, as the Lead names it: its title, where it goes (section), what it says (detail), its ticket.
function copyOf(raw,known) {
  if(raw===undefined)return undefined;
  if(!Array.isArray(raw)||raw.length>LIST_MAX)bad('toPlan.copy',`is the list of the texts to write, ${LIST_MAX} at most.`);
  return raw.map((item,n)=>{
    const at='toPlan.copy['+(n+1)+']';onlyKeys(item,['title','section','detail','ticket'],at);
    const title=textOf(item.title,at+'.title',TITLE_MAX,{required:true}),section=textOf(item.section,at+'.section',TITLE_MAX),detail=textOf(item.detail,at+'.detail',TEXT_MAX);
    if(item.ticket!==undefined&&(typeof item.ticket!=='string'||!known.has(item.ticket)))bad(at+'.ticket',`names ${typeof item.ticket==='string'&&item.ticket.length<=40?'« '+item.ticket+' »':'something'}, which is not a ticket of the plan.`);
    return {title,...(section?{section}:{}),...(detail?{detail}:{}),...(item.ticket!==undefined?{ticket:item.ticket}:{})};
  });
}
function toPlanOf(raw,known) {
  if(raw===undefined)return undefined;
  onlyKeys(raw,['manual','risks','copy','accounts'],'toPlan');
  const out={manual:groupOf(raw.manual,'toPlan.manual',known,{note:true}),risks:groupOf(raw.risks,'toPlan.risks',known,{note:true}),copy:copyOf(raw.copy,known),accounts:groupOf(raw.accounts,'toPlan.accounts',known)};
  return Object.fromEntries(Object.entries(out).filter(([,value])=>value!==undefined));
}
function ticketOf(raw,n,phases,requests,profiles) {
  const name=nameOf(raw,n),refuse=why=>fail('PLAN_TICKET_INVALID',`${name}: ${why}`);
  if(!plain(raw)||typeof raw.id!=='string'||!TICKET.test(raw.id))fail('PLAN_TICKET_INVALID',`${name}: a ticket is named by the identifier of its sub-ticket in the tracker (XJ-12), not by a number.`);
  const extra=Object.keys(raw).find(key=>!TICKET_KEYS.includes(key));
  if(extra)refuse('unexpected field '+JSON.stringify(extra).slice(0,60)+'.');
  if(!Number.isInteger(raw.rank)||raw.rank<1||raw.rank>RANK_MAX)fail('PLAN_RANK_INVALID',`${name}: its rank must be a whole number from 1 (2, never « 2b »).`);
  if(!words(raw.title,TITLE_MAX))refuse('a title is required.');
  if(!words(raw.result,TEXT_MAX))refuse('the expected result is required.');
  if(!DIFFICULTIES.includes(raw.difficulty))refuse('difficulty is light, standard or heavy.');
  const kind=raw.kind??'work',delivery=raw.delivery??'included';
  if(!KINDS.includes(kind))refuse('kind is work or design.');
  if(!DELIVERIES.includes(delivery))refuse('delivery is included, deferred, associated or integrated.');
  if(delivery==='integrated'?typeof raw.integratedBy!=='string':raw.integratedBy!=null)refuse('integratedBy names the ticket that integrates it, for a ticket integrated by another and for no other.');
  // A ticket developed in this delivery says who develops it; another one may leave it unsaid.
  const developed=kind==='work'&&delivery==='included',given=key=>raw[key]!==undefined&&raw[key]!==null;
  if(developed&&!given('agent'))refuse('agent is required for a ticket developed in this delivery.');
  if(given('agent')&&!AGENTS.includes(raw.agent))refuse('agent is claude or codex.');
  // Which dev develops it, when the plan has two: Dev 1 or Dev 2. Left unsaid, the ticket is one of Dev 1. The agent is
  // the tool of that dev, and says nothing of who it is: two devs may use the same tool.
  if(given('dev')&&!DEVS.includes(raw.dev))refuse('dev is 1 or 2: the dev that develops it, Dev 1 or Dev 2. Leave it out for a plan with one dev.');
  if(given('model')&&(typeof raw.model!=='string'||raw.model.length>MODEL_MAX||!MODEL.test(raw.model)))refuse('invalid model.');
  if(given('effort')&&!MODEL_EFFORTS.includes(raw.effort))refuse('effort is low, medium or high.');
  if(given('modelReason')&&typeof raw.modelReason!=='string')refuse('modelReason is a text.');
  // Its model and its effort follow its difficulty: left unsaid, they are the rule's. The Lead may take others, by
  // saying why (modelReason). Where no rule is configured, the Lead says them, as it always did.
  let model=raw.model??null,effort=raw.effort??null,modelReason=null;
  const rule=developed?ruleFor(profiles,raw.agent,raw.difficulty):null,why=words(raw.modelReason,TEXT_MAX)?raw.modelReason.trim():null;
  if(rule){
    model=model??rule.model;effort=effort??rule.effort;
    const departs=model!==rule.model||effort!==rule.effort;
    if(departs&&!why)fail('PLAN_MODEL_RULE',`${name}: the rule gives ${rule.model} · ${rule.effort} to a ${raw.difficulty} ticket of ${raw.agent}. To take ${model} · ${effort} instead, say why in modelReason.`);
    if(!departs&&given('modelReason'))refuse('modelReason is the reason of a departure from the rule, and this ticket has the model and the effort of the rule: leave it out.');
    modelReason=departs?why:null;
  }else{
    for(const key of ['model','effort'])if(developed&&!given(key))refuse(key+' is required for a ticket developed in this delivery: no rule gives one to a '+raw.difficulty+' ticket of '+raw.agent+'.');
    if(given('modelReason')&&!why)refuse('modelReason is a text.');
    modelReason=why;
  }
  if(raw.deps!==undefined&&!Array.isArray(raw.deps))fail('PLAN_INVALID',`${name}: deps is the list of the tickets it waits for.`);
  if((raw.deps||[]).length>TICKETS_MAX)fail('PLAN_INVALID',`${name}: too many dependencies.`);
  const phase=raw.phase??null;
  if(phase!==null&&!phases.has(phase))fail('PLAN_INVALID',`${name}: its phase is not one of the plan.`);
  if(raw.covers!==undefined&&(!Array.isArray(raw.covers)||raw.covers.length>LIST_MAX))fail('PLAN_INVALID',`${name}: covers is the list of the requests it covers.`);
  const covers=[...new Set(raw.covers||[])];
  if(covers.some(id=>!requests.has(id)))fail('PLAN_INVALID',`${name}: it covers a request that is not one of the plan.`);
  return {id:raw.id,rank:raw.rank,title:raw.title.trim(),result:raw.result.trim(),difficulty:raw.difficulty,kind,delivery,integratedBy:raw.integratedBy??null,
    agent:raw.agent??null,...(given('dev')?{dev:raw.dev}:{}),model,effort,modelReason,deps:[...new Set(raw.deps||[])],phase,covers,
    texts:textsOf(raw.texts,TITLE_MAX,()=>refuse('texts is a list of the texts to write.')),mockups:textsOf(raw.mockups,TITLE_MAX,()=>refuse('mockups is a list of the mockups attached.'))};
}
// The tickets of a loop, or null: each ticket is walked once, without recursion (a plan may be a long chain).
function loopOf(tickets,next) {
  const state=new Map();
  for(const start of tickets){
    if(state.has(start.id))continue;
    const path=[],stack=[[start.id,0]];
    while(stack.length){
      const top=stack.at(-1),[id,at]=top,out=next(id);
      if(at===0){state.set(id,'open');path.push(id);}
      if(at>=out.length){state.set(id,'done');path.pop();stack.pop();continue;}
      top[1]=at+1;
      const to=out[at],seen=state.get(to);
      if(seen==='open')return path.slice(path.indexOf(to));
      if(!seen)stack.push([to,0]);
    }
  }
  return null;
}
// Two titles that say the same work: case and blanks apart.
const sameTitle=value=>String(value||'').trim().replace(/\s+/g,' ').toLowerCase();
// The plan as it is kept: checked whole, its tickets in the order of their ranks. Throws on the first thing wrong.
// `profiles` are those of the configuration: the rule that gives a ticket its model by its difficulty.
export function planOf(raw,{profiles=null}={}) {
  if(!plain(raw))fail('PLAN_INVALID','A plan is a JSON object with its tickets.');
  const moved=Object.keys(MOVED).find(key=>Object.hasOwn(raw,key));
  if(moved)fail('PLAN_INVALID',MOVED[moved]);
  const extra=Object.keys(raw).find(key=>!PLAN_KEYS.includes(key));
  if(extra)fail('PLAN_INVALID','Unexpected field of a plan: '+JSON.stringify(extra).slice(0,60)+'.');
  if(!Array.isArray(raw.tickets)||!raw.tickets.length||raw.tickets.length>TICKETS_MAX)fail('PLAN_INVALID',`A plan has from 1 to ${TICKETS_MAX} tickets.`);
  const phases=keyed(raw.phases,'title','phases'),requests=requestsOf(raw.requests),approach=approachOf(raw.approach);
  const migrations=raw.migrations===undefined?undefined:textsOf(raw.migrations,TITLE_MAX,()=>bad('migrations','is the list of the migrations of the plan, in order, each a text ([] for none).'));
  if(raw.simple!==undefined&&typeof raw.simple!=='boolean')bad('simple','is true for a plan of one ticket (one review, no QA agent), or left out.');
  if(raw.simple===true&&raw.tickets.length!==1)bad('simple','is for a plan of one ticket, and this one has '+raw.tickets.length+'.');
  if(raw.points!==undefined){
    if(raw.simple!==true)bad('points','is the number of points of your check of the one ticket: only with simple.');
    if(!Number.isInteger(raw.points)||raw.points<1||raw.points>POINTS_MAX)bad('points',`is a whole number from 1 to ${POINTS_MAX}.`);
  }
  const phaseIds=new Set(phases.map(p=>p.id)),requestIds=new Set(requests.map(r=>r.id));
  const tickets=raw.tickets.map((ticket,n)=>ticketOf(ticket,n,phaseIds,requestIds,profiles)),byId=new Map(),byRank=new Map(),byTitle=new Map();
  for(const ticket of tickets){
    if(byId.has(ticket.id))fail('PLAN_TICKET_DUPLICATE',`${ticket.id} is in the plan twice: one sub-ticket is one ticket.`);
    byId.set(ticket.id,ticket);
    // Two tickets with one title are one piece of work written twice.
    const title=sameTitle(ticket.title);
    if(byTitle.has(title))fail('PLAN_TICKET_DUPLICATE',`${byTitle.get(title)} and ${ticket.id} have the same title: the same ticket written twice.`);
    byTitle.set(title,ticket.id);
    if(byRank.has(ticket.rank))fail('PLAN_RANK_INVALID',`${byRank.get(ticket.rank)} and ${ticket.id} share the rank ${ticket.rank}.`);
    byRank.set(ticket.rank,ticket.id);
  }
  for(const ticket of tickets){
    const unknown=[...ticket.deps,...(ticket.integratedBy===null?[]:[ticket.integratedBy])].find(id=>typeof id!=='string'||!byId.has(id));
    if(unknown!==undefined)fail('PLAN_DEPENDENCY_UNKNOWN',`${ticket.id} names ${typeof unknown==='string'&&unknown.length<=40?'« '+unknown+' »':'something'} that is not a ticket of the plan: a dependency is the identifier of a ticket of the plan, never its rank.`);
  }
  // A plan that says its devs: a dev has one tool (decision 53), whatever the model of each of its tickets, and Dev 2
  // comes with a Dev 1. A plan that says none has one dev, and is read as it always was.
  if(tickets.some(t=>t.dev!==undefined)){
    if(!tickets.some(t=>(t.dev??1)===1))fail('PLAN_INVALID','The plan has no ticket for Dev 1: a plan with one dev leaves dev out, a plan with two has tickets for both.');
    for(const dev of DEVS){
      const tools=[...new Set(tickets.filter(t=>(t.dev??1)===dev&&t.agent).map(t=>t.agent))];
      if(tools.length>1)fail('PLAN_INVALID',`Dev ${dev} has two tools (${tools.join(', ')}): a dev has one tool. Give its tickets the same agent, or say dev: ${dev===1?2:1} on those of the other dev.`);
    }
  }
  const waits=loopOf(tickets,id=>byId.get(id).deps),taken=loopOf(tickets,id=>{const by=byId.get(id).integratedBy;return by===null?[]:[by];});
  if(waits)fail('PLAN_CYCLE','These tickets wait for one another in a loop: '+waits.join(' → ')+' → '+waits[0]+'.');
  if(taken)fail('PLAN_CYCLE','These tickets are integrated by one another in a loop: '+taken.join(' → ')+' → '+taken[0]+'.');
  // The two relations hold a ticket the same way (it is not over before the other is), so a loop made of both is one
  // too: a ticket that waits for one it integrates would never start, and nothing after it either.
  const held=loopOf(tickets,id=>{const ticket=byId.get(id);return ticket.integratedBy===null?ticket.deps:[...ticket.deps,ticket.integratedBy];});
  if(held)fail('PLAN_CYCLE','These tickets hold one another in a loop, by what they wait for and by the ticket that integrates them: '+held.join(' → ')+' → '+held[0]+'. None of them could ever start.');
  tickets.sort((a,b)=>a.rank-b.rank);
  // What covers a request: the tickets that say so, in the order of their ranks. A ticket deferred to a later delivery
  // covers nothing in this one. A request a ticket covers has no state: it is covered.
  const covered=requests.map(r=>{
    const by=tickets.filter(t=>t.delivery!=='deferred'&&t.covers.includes(r.id)).map(t=>t.id);
    if(by.length&&r.state)bad('requests['+r.id+'].state','is for a request no ticket covers, and '+by.join(', ')+' cover'+(by.length>1?'':'s')+' it.');
    const {id,short,full,...rest}=r;
    return {id,short,full,tickets:by,...rest};
  });
  const toPlan=toPlanOf(raw.toPlan,byId);
  return {format:PLAN_FORMAT,tickets,phases,requests:covered,...(approach?{approach}:{}),...(migrations?{migrations}:{}),...(raw.simple===true?{simple:true}:{}),...(raw.points!==undefined?{points:raw.points}:{}),...(toPlan?{toPlan}:{})};
}
// What a Lead said of its plan, apart from what the tool adds to it (revision, date, identity read from the tracker).
// The two lists of the plans of before, left empty, said nothing.
export function said(plan) {
  const {format:_format,revision:_revision,savedAt:_savedAt,tracker:_tracker,tickets,...rest}=plan||{};
  for(const key of Object.keys(MOVED))if(Array.isArray(rest[key])&&!rest[key].length)delete rest[key];
  return {...rest,tickets:(tickets||[]).map(({uid:_uid,...ticket})=>ticket),phases:rest.phases||[],requests:rest.requests||[]};
}
export const samePlan=(a,b)=>Boolean(a)&&Boolean(b)&&canonical(said(a))===canonical(said(b));
// The sub-tickets by their identifier. Two of them under one identifier with two identities name no ticket: which one
// is meant is unknown (null), never the first nor the last one read.
function byIdentifier(kids) {
  const byName=new Map();
  for(const kid of kids){
    const name=String(kid.identifier||''),seen=byName.get(name);
    byName.set(name,seen===undefined||(seen!==null&&seen.id===kid.id)?kid:null);
  }
  return byName;
}
// The plan against the sub-tickets the tracker has for its issue: the identity of each ticket it could read (uids), and
// whether the list vouches for the plan (whole). `whole` says the list names every sub-ticket: only then is a ticket it
// does not show known to be missing; a list with two sub-tickets under one identifier does not say which tickets it
// holds, and gives that identifier no identity. A sub-ticket still open that the plan does not name, with the title of
// a ticket of the plan, is that ticket made twice.
export function againstTracker(plan,children,whole) {
  const kids=(Array.isArray(children)?children:[]).filter(k=>k&&typeof k.identifier==='string'),byName=byIdentifier(kids),named=new Set(plan.tickets.map(t=>t.id));
  const sure=Boolean(whole)&&![...byName.values()].includes(null);
  const missing=sure?plan.tickets.find(t=>!byName.has(t.id)):null;
  if(missing)fail('PLAN_TICKET_UNKNOWN',`${missing.id} is not a sub-ticket of this issue in the tracker: create it there first, once, then record the plan with its identifier.`);
  const titles=new Map(plan.tickets.map(t=>[sameTitle(t.title),t.id]));
  const twin=kids.find(k=>!named.has(k.identifier)&&!['canceled','completed'].includes(k.state?.type)&&titles.has(sameTitle(k.title)));
  if(twin)fail('PLAN_TICKET_DUPLICATE',`${twin.identifier} and ${titles.get(sameTitle(twin.title))} are two sub-tickets with one title: the same ticket made twice. Cancel the one that is not in the plan, or name them apart.`);
  return {uids:new Map(plan.tickets.filter(t=>byName.get(t.id)?.id).map(t=>[t.id,String(byName.get(t.id).id)])),whole:sure};
}
// A mission has the plan of its Lead: one of this format, with its tickets. Without it, it is of the old format, or not
// planned yet: nothing of it is run.
export const hasPlan=mission=>mission?.plan?.format===PLAN_FORMAT&&Array.isArray(mission.plan.tickets)&&mission.plan.tickets.length>0;
// The rows the chain and the screens of today work on, drawn from the plan: rank, title, level, agent, model, effort
// and waits are the plan's, and nothing else is a source of them; the tracker gives the state of each ticket, and the
// run what it was launched with. A row says whether its ticket is developed in this delivery (here): a ticket of
// design, deferred, associated or integrated by another one is not. A sub-ticket the plan does not name (a correction
// added later) stays a row, without a rank and waiting for nothing: what blocks it in the tracker is not read. A ticket
// the tracker shows twice under two identities keeps the identity of the plan, its state there unknown. Without a plan,
// the rows are the sub-tickets alone.
export function planRows(plan,children,runs=null) {
  const tickets=plan?.tickets||[],kids=(Array.isArray(children)?children:[]).filter(Boolean),byName=byIdentifier(kids),named=new Set(tickets.map(t=>t.id));
  const rows=tickets.map(t=>{
    const kid=byName.get(t.id)||null;
    return {identifier:t.id,id:kid?.id??t.uid??'',title:t.title,state:kid?.state||null,ticket:t};
  });
  const own=devRows(rows.map(r=>({id:r.id,identifier:r.identifier,title:r.title,state:r.state,labels:[],blockedBy:[],model:r.ticket.model||'',effort:r.ticket.effort||''})),null,runs).rows;
  const planned=tickets.map(t=>{
    const row=own.find(r=>r.id===t.id);
    return {...row,n:t.rank,content:t.title,level:LEVELS[t.difficulty],agent:row.run?.agent||t.agent||'',waits:[...t.deps],kind:t.kind,delivery:t.delivery,integratedBy:t.integratedBy??null,
      planned:true,here:t.kind==='work'&&t.delivery==='included',asked:{agent:t.agent??null,model:t.model??null,effort:t.effort??null}};
  });
  const others=devRows(kids.map(k=>({...k,blockedBy:[]})),null,runs).rows.filter(r=>!named.has(r.id)).map(r=>({...r,planned:false,here:true}));
  return [...planned,...others];
}
