import { isOwnerRecord } from './owner.mjs';
import { join } from 'node:path';
import { readdir } from 'node:fs/promises';
import { fail, object, readJSON, text, waitLock, writeJSON } from './common.mjs';
import { nextId } from './ids.mjs';
import { missionActive, stopAfterOf } from './mission.mjs';
import { ownerAnswerOf } from './requests.mjs';
export { answersOf } from './requests.mjs';

// A question of an agent: asked once, answered by the Lead or by the user through his answer to a request, delivered to
// the one who asked, and over when that agent is seen working again. It outlives every terminal.
const FILE=/^(Q-\d{1,7})\.json$/,ID=/^Q-\d{1,7}$/,TICKET=/^[A-Z][A-Z0-9]{0,9}-\d{1,7}$/;
const TEXT_MAX=4000,SHORT_MAX=200,LIST_MAX=20,PROOF_MAX=500;
const OPTIONS_MAX=4;
const number=id=>Number(id.slice(2));
// What a question is, written once: its words, the answers it offers, the one who asked.
const FIXED=['id','mission','ticket','from','fromTab','question','options','source','askedAt'];
// The answer of the user a question carries, in its place or kept aside while the Lead passes it on (the relay).
const saidOf=q=>{const said=ownerAnswerOf(q);return said?[said.text,said.decision??null,said.by,said.role??null]:null;};
const free=q=>!q.answer&&!q.legacyOwner;

export function createQuestionRegistry({root,now=Date.now}) {
  const dir=join(root,'state','questions'),path=id=>join(dir,id+'.json');
  const stamp=()=>new Date(now()).toISOString(),lock=task=>waitLock(dir,task);
  async function load(id) {
    if(typeof id!=='string'||!ID.test(id))fail('INVALID_ARGUMENT','Expected a question (Q-<n>).');
    const question=await readJSON(path(id),null);
    if(!question)fail('NOT_FOUND','No question uses this identifier.');
    return question;
  }
  async function all() {
    let names;
    try{names=await readdir(dir);}catch(error){if(error.code==='ENOENT')return [];throw error;}
    const ids=names.map(name=>FILE.exec(name)?.[1]).filter(Boolean).sort((a,b)=>number(a)-number(b));
    return (await Promise.all(ids.map(id=>load(id).catch(()=>null)))).filter(Boolean);
  }
  async function write(fields) {
    const id=await nextId(root,'Q');
    const question={id,mission:null,ticket:null,from:'lead',fromTab:null,question:'',options:[],askedAt:stamp(),state:'open',answer:null,delivery:null,source:null,routedAt:null,...fields};
    await writeJSON(path(id),question);
    return question;
  }
  // One question per file of an agent, even with two watchers reading it at once.
  const ensure=fields=>lock(async()=>{
    const known=(await all()).find(q=>q.mission===fields.mission&&q.source===fields.source);
    return known?{question:known,created:false}:{question:await write(fields),created:true};
  });
  const create=fields=>lock(()=>write(fields));
  // A question is written by the few operations below, each for one passage. None of them changes what it is.
  //
  // Held for a request (requests.ask): the Lead can no longer answer it. Only a question that still waits, without an
  // answer of the user, in its place or kept aside. Null when it cannot be held.
  const retain=id=>lock(async()=>{
    const q=await load(id);
    if(!['open','escalated'].includes(q.state)||!free(q))return null;
    if(q.state!=='escalated'){q.state='escalated';await writeJSON(path(id),q);}
    return q;
  });
  // Given back to the Lead, who was left the decision: it can answer the agent again.
  const giveBack=id=>lock(async()=>{
    const q=await load(id);
    if(q.state!=='escalated'||!free(q))return false;
    q.state='open';await writeJSON(path(id),q);
    return true;
  });
  // A question of the Lead whose request was left to it: nothing more is expected.
  const close=id=>lock(async()=>{
    const q=await load(id);
    if(q.state!=='escalated'||!free(q))return false;
    q.state='resolved';await writeJSON(path(id),q);
    return true;
  });
  // The Lead answers a question that waits for it, and no other: one held for a request is refused.
  const leadAnswer=(id,reply)=>lock(async()=>{
    const q=await load(id);
    if(q.state==='open'){q.state='answered';q.answer={text:reply,by:'lead',decision:null,at:stamp()};await writeJSON(path(id),q);return q;}
    if(q.answer?.by==='lead'&&q.answer.text===reply)return q;
    fail('QUESTION_CLOSED','This question is no longer waiting for the Lead.');
  });
  // The answer of the user, put by the request it was given on (requests.settle), and by nothing else: only in a question
  // that still waits without an answer and is still the one the request copied. Already there (in its place, or kept
  // aside for the relay), it is said so and nothing is written, whatever became of the question since.
  const inscribe=(id,given,recipient)=>lock(async()=>{
    if(!given.by)fail('INVALID_ARGUMENT','A recorded owner identity (by) is required.');
    const q=await load(id),mine=said=>isOwnerRecord(said,given.by)&&said.decision===given.decision;
    if(mine(q.answer)||mine(q.legacyOwner))return {written:false,already:true,question:q};
    if(!['open','escalated'].includes(q.state)||!free(q)||q.from!==recipient.from||(q.fromTab??null)!==(recipient.fromTab??null))return {written:false,already:false,question:q};
    q.state='answered';q.answer={text:given.text,by:given.by,role:given.role,decision:given.decision,choice:given.choice??null,title:given.title??null,at:given.at};
    await writeJSON(path(id),q);
    return {written:true,already:false,question:q};
  });
  // The way of an answer to its agent (routed, relayed, delivered, taken in), as the watcher sees it. It never changes
  // what the question is, nor the answer of the user (which the relay moves aside and back, word for word), and neither
  // holds a question for a request nor gives one back.
  const progress=(id,change)=>lock(async()=>{
    const q=await load(id),before=JSON.stringify([FIXED.map(key=>q[key]),saidOf(q),q.state==='escalated']);
    if(await change(q)===false)return q;
    if(JSON.stringify([FIXED.map(key=>q[key]),saidOf(q),q.state==='escalated'])!==before)fail('REQUEST_FIXED','A question keeps its words, its answers and the answer it was given.');
    await writeJSON(path(id),q);
    return q;
  });
  const list=async({mission}={})=>(await all()).filter(q=>mission===undefined||q.mission===mission);
  // Nothing is read nor written here before the switch-over to the requests is made (requests.switched, decision 61):
  // the requests that lean on this register install it (before), so that the very first reading after an
  // installation never gives an answer of the old stock.
  let ready=async()=>{};
  const gated=fn=>async(...args)=>{await ready();return fn(...args);};
  // Where a question is kept: the file an operational message names instead of copying its words (decision 61).
  const fileOf=id=>typeof id==='string'&&ID.test(id)?path(id):null;
  return {...Object.fromEntries(Object.entries({ensure,create,read:load,retain,giveBack,close,leadAnswer,inscribe,progress,list}).map(([name,fn])=>[name,gated(fn)])),stamp,fileOf,before:fn=>{ready=fn;}};
}

// What the Lead tries for a ticket stopped (M10): ten tries at most, each its text, and at its option the instant it
// was made, how it went (same: the same failure; running) and whether it is the last before asking the user.
const TRY_KEYS=['text','at','outcome','last'];
function triesOf(value) {
  if(!Array.isArray(value)||value.length>10)fail('INVALID_ARGUMENT','tries must be a list of ten tries at most.');
  return value.map(x=>{
    if(!x||typeof x!=='object'||Array.isArray(x)||Object.keys(x).some(key=>!TRY_KEYS.includes(key)))fail('INVALID_ARGUMENT','A try is {text, at?, outcome?, last?}.');
    if(x.at!==undefined&&!(typeof x.at==='string'&&Number.isFinite(Date.parse(x.at))))fail('INVALID_ARGUMENT','at must be an ISO instant.');
    if(x.outcome!==undefined&&!['same','running'].includes(x.outcome))fail('INVALID_ARGUMENT','outcome must be same or running.');
    if(x.last!==undefined&&x.last!==true)fail('INVALID_ARGUMENT','last can only be true.');
    return {text:text(x.text,'text',300).trim(),...(x.at!==undefined?{at:new Date(Date.parse(x.at)).toISOString()}:{}),...(x.outcome?{outcome:x.outcome}:{}),...(x.last?{last:true}:{})};
  });
}
const only=(input,names)=>{if(Object.keys(input).some(key=>!names.includes(key)))fail('INVALID_ARGUMENT','Unexpected argument.');};
const ticketOf=value=>{if(value===undefined||value===null)return null;if(typeof value!=='string'||!TICKET.test(value))fail('INVALID_ARGUMENT','Expected a ticket identifier.');return value;};
function tickets(value) {
  if(value===undefined)return null;
  if(!Array.isArray(value)||value.length>LIST_MAX)fail('INVALID_ARGUMENT','blocked must be a list of tickets.');
  return value.map(ticketOf);
}
function optionsOf(value) {
  if(value===undefined)return [];
  if(!Array.isArray(value)||value.length>OPTIONS_MAX)fail('INVALID_ARGUMENT','options must be a short list of answers.');
  return value.map(option=>text(option,'option',SHORT_MAX).trim());
}
// What a request is beyond a question (simulation/CONTRAT.md § 3): a suggestion of the Lead, a verdict a review leaves
// to the user, a choice between texts (each answer is the text of a variant). A question says no kind; a permission is
// its type.
const KINDS=['suggestion','verdict','copy'],SHORT_WORDS=120;
function kindOf(value,type) {
  if(value===undefined)return null;
  if(!KINDS.includes(value)||type!=='decision')fail('INVALID_ARGUMENT','kind must be suggestion, verdict or copy, on a decision (a question says no kind).');
  return value;
}
// The request in a few words, for the line of « Waiting on you » and of « Your decisions ».
function shortOf(value) {
  if(typeof value!=='string'||!value.trim()||value.length>SHORT_WORDS||value.includes('\0'))fail('INVALID_ARGUMENT','short must be the request in a few words ('+SHORT_WORDS+' characters at most).');
  return value.trim();
}
// The tickets concerned, when there are several (« Tickets concerned »).
function concerned(value) {
  if(!Array.isArray(value)||!value.length||value.length>LIST_MAX)fail('INVALID_ARGUMENT','tickets must be a list of the tickets concerned.');
  return [...new Set(value.map(ticketOf))];
}
// What each answer brings, written under it: {answer: text}, for answers the request offers.
function detailsOf(value,answers) {
  if(!value||typeof value!=='object'||Array.isArray(value))fail('INVALID_ARGUMENT','details must say, for an answer offered, what it brings: {"answer": "text"}.');
  return Object.fromEntries(Object.entries(value).map(([answer,said])=>{
    if(!answers.includes(answer.trim()))fail('INVALID_ARGUMENT','details: « '+answer.slice(0,SHORT_MAX)+' » is not one of the answers offered (options).');
    return [answer.trim(),text(said,'details « '+answer.slice(0,SHORT_MAX)+' »',TEXT_MAX).trim()];
  }));
}
function proofsOf(value) {
  if(value===undefined)return [];
  if(!Array.isArray(value)||value.length>LIST_MAX)fail('INVALID_ARGUMENT','proofs must be a list of paths.');
  return value.map(proof=>text(proof,'proof',PROOF_MAX));
}

// `unpaused` (M11 review 1): a change of step made under the lock of the launches, refused while the mission is in
// pause (MISSION_PAUSED); without a chain, the task as it is.
export function createQuestionActions({questions,inbox,missions,launch,unpaused=async(_mission,task)=>task()}) {
  async function answer(raw) {
    const input=object(raw);only(input,['question','text']);
    return {question:await questions.leadAnswer(input.question,text(input.text,'text',TEXT_MAX).trim())};
  }
  async function escalate(raw) {
    const input=object(raw);only(input,['mission','question','ticket','type','kind','title','short','summary','text','recommendation','options','why','details','tickets','consequences','blocked','proofs']);
    if(!['decision','authorization'].includes(input.type))fail('INVALID_ARGUMENT','type must be decision or authorization.');
    const kind=kindOf(input.kind,input.type),options=optionsOf(input.options),proposed=Boolean(kind);
    // A suggestion, a verdict and a choice of copy are answered by a click on one of their answers; the suggestion is
    // itself the proposal of the Lead, and a verdict or a copy is the user's to choose: a recommendation is not asked.
    if(proposed&&!options.length)fail('INVALID_ARGUMENT','options: a '+kind+' offers the answers to click.');
    const optional=(value,name)=>value===undefined&&proposed?'':text(value,name,TEXT_MAX).trim();
    const fields={type:input.type,...(kind?{kind}:{}),title:text(input.title,'title',SHORT_MAX).trim(),...(input.short===undefined?{}:{short:shortOf(input.short)}),summary:input.summary===undefined?undefined:text(input.summary,'summary',SHORT_MAX).trim(),text:text(input.text,'text',TEXT_MAX).trim(),recommendation:optional(input.recommendation,'recommendation'),why:optional(input.why,'why'),options,
...(input.tickets===undefined?{}:{tickets:concerned(input.tickets)}),consequences:input.consequences===undefined?'':text(input.consequences,'consequences',TEXT_MAX).trim(),proofs:proofsOf(input.proofs)};
    const given=tickets(input.blocked),named=ticketOf(input.ticket),mission=await missions.read(input.mission);
    const question=input.question===undefined?null:await questions.read(input.question);
    if(question&&question.mission!==mission.id)fail('INVALID_ARGUMENT','This question belongs to another mission.');
    // The text under each answer, for the answers the request offers: its own, else those of the question it comes from,
    // else what the Lead recommends (as answersOf works them out). Read after the question, so that its choices count.
    // A first check only: requests.ask decides, under its lock, whether the question is taken, and refuses the text under
    // a choice it leaves.
    if(input.details!==undefined)fields.details=detailsOf(input.details,options.length?options:question?.options?.length?question.options:[input.recommendation].filter(Boolean));
    const ticket=named??question?.ticket??null,blocked=given??(ticket?[ticket]:[]);
    // The request holds the question it comes from, or waits in a question of the Lead: requests.ask decides, under its lock.
    const {item,created,replaced}=await inbox.ask({...fields,mission:mission.id,project:mission.project,issue:mission.issue?.identifier??null,ticket,question:question?.id??null,blocked});
    return {item,created,question:item.question,...(replaced?{replaced}:{})};
  }
  // A ticket stopped, in the hands of the Lead (M10): what it tries, in order, and whether the user is needed now
  // (forUser: true once the last try failed and the Lead asks him, with lead-escalate); or the stop lifted. It writes the
  // stop again with the same words and its instant (requests.ask keeps it): the time shown never moves.
  async function block(raw) {
    const input=object(raw);only(input,['mission','ticket','tries','forUser','lifted']);
    const ticket=ticketOf(input.ticket);if(!ticket)fail('INVALID_ARGUMENT','ticket is required.');
    if(input.forUser!==undefined&&typeof input.forUser!=='boolean')fail('INVALID_ARGUMENT','forUser must be true or false.');
    if(input.lifted!==undefined&&input.lifted!==true)fail('INVALID_ARGUMENT','lifted can only be true.');
    const tries=input.tries===undefined?undefined:triesOf(input.tries),mission=await missions.read(input.mission);
    // Lifted: the stop of now, found and lifted in one step under the lock of the register (M10 review).
    if(input.lifted){const lifted=await inbox.liftStop({mission:mission.id,ticket});if(!lifted)fail('NOT_FOUND','No stop is open for this ticket.');return {lifted:true,item:lifted.id};}
    const open=(await inbox.list({mission:mission.id})).filter(i=>i.type==='stuck'&&i.cause==='blocked'&&i.ticket===ticket&&i.state!=='resolved').at(-1);
    if(!open)fail('NOT_FOUND','No stop is open for this ticket.');
    // Written on the stop that was read, and on no other: replaced or lifted since, it is refused (STOP_CHANGED).
    const {item,created,replaced}=await inbox.ask({type:'stuck',cause:'blocked',mission:mission.id,project:open.project??null,issue:open.issue??null,ticket,question:null,title:open.title,text:open.text,recommendation:open.recommendation??'',why:open.why??'',blocked:open.blocked??[ticket],proofs:open.proofs??[],
      owner:open.owner,migration:open.migration,forUser:input.forUser??open.forUser,tries:tries??open.tries,expect:open.id});
    return {item,created,...(replaced?{replaced}:{})};
  }
  const DEV_RUNS='Le dev de ce ticket tourne encore : il ne peut pas être relancé et tu ne peux pas lui écrire. Ne réessaie pas et ne colle rien dans son onglet : remonte tout de suite au propriétaire (lead-escalate, forUser: true) ce que tu voulais lui dire.';
  async function request(raw) {
    const input=object(raw);only(input,['mission','kind','tickets','text']);
    if(!['launch','resume','validation','qa','fix'].includes(input.kind))fail('INVALID_ARGUMENT','kind must be launch, resume, validation, qa or fix.');
    const mission=await missions.read(input.mission);
    if(input.kind==='qa')return {launched:false,automatic:true,message:'Le veilleur lance le QA tout seul quand tous les tickets sont acceptés et fusionnés.'};
    if(input.kind==='launch'||input.kind==='fix')return launch({mission:mission.id,tickets:input.tickets,fresh:false});
    // The agent of a ticket whose tab is gone, launched again in its worktree with the answer that waits for it.
    // Its dev still runs (lot 1B): it can be neither relaunched nor written to; the Lead is told to ask le propriétaire
    // at once rather than try again.
    if(input.kind==='resume'){const out=await launch({mission:mission.id,tickets:input.tickets,fresh:false,resume:true});return (out?.launched||[]).some(t=>t?.reason==='already')?{...out,next:DEV_RUNS}:out;}
    const bilan=text(input.text,'text',TEXT_MAX).trim();
    // In pause the mission stays in its step (M11 review 1): refused before anything is written.
    return unpaused(mission.id,async()=>{
      // Held at the end of Develop as the user asked (chantier 1, point 16): the Lead cannot take the mission further. Read
      // under the lock of the lane, as mission-stop-after writes it: a limit confirmed before is never passed.
      if(stopAfterOf(await missions.read(mission.id))==='develop')fail('MISSION_STOPS_AFTER_DEVELOP','le propriétaire asked to stop at the end of Develop: no Validation for this development.');
      const {item,created}=await inbox.ask({type:'validation',mission:mission.id,project:mission.project,issue:mission.issue?.identifier??null,ticket:null,question:null,title:mission.issue?.title||mission.id,text:bilan,own:bilan,blocked:[],proofs:[]});
      await missions.setStep(mission.id,'validating','validation demandée');
      return {item,created};
    });
  }
  // An answer of the user to a request, recorded by the one function that records one (requests.answer), then carried
  // to its question; the watcher carries it again if this stops midway. `via` says which command sent it: a screen
  // (inbox-answer, the choice of a mockup), or an agent that records his words (pilot-decide), refused for a permission.
  async function record({item,choice,text:reply,seen,mockup,published},via) {
    const made=await inbox.answer({item,choice,text:reply,seen,via,...(mockup===undefined?{}:{mockup,published})});
    // Left to the Lead from another window: there is no answer to give back, and none to add.
    if(made.answer.left)fail('QUESTION_CLOSED','This request is closed.');
    const {item:kept}=await inbox.settle(made.item.id);
    return {decision:{id:made.answer.id,item:kept.id,mission:kept.mission,question:kept.question,choice:made.answer.choice,text:made.answer.text,seen:made.answer.seen,by:made.answer.by,role:made.answer.role,via:made.answer.via,at:made.answer.at},item:kept,created:made.created};
  }
  const said=input=>({item:input.item,seen:input.seen,text:text(input.text,'text',TEXT_MAX).trim(),choice:input.choice===undefined?null:text(input.choice,'choice',SHORT_MAX).trim()});
  // pilot-decide: Pilot, or the Lead talking with the user, records what he decided, with the version it read to him.
  const decide=async raw=>{const input=object(raw);only(input,['item','choice','text','seen']);return record(said(input),'agent');};
  // inbox-answer: a click on an answer shown, in the page of a ticket or in the Inbox.
  const click=async raw=>{const input=object(raw);only(input,['item','choice','text','seen']);return record(said(input),'screen');};
  // The variant of a mockup chosen on a screen (mockup-pick): the same record, tied to the publication that was shown.
  const choose=async input=>record({...said(input),mockup:input.mockup,published:input.published},'screen');
  // What the Inbox shows: each request with the answers it offers, its version (seen) to send back with an answer, and
  // the answer already given on it — its own, never that of another request. The requests of before this register
  // come after, for the developments still under way: shown, never answered (requests.legacy).
  const list=async raw=>{
    only(object(raw),[]);
    const items=(await inbox.list({})).map(item=>({...item,seen:item.version,decision:item.answer?.id??null,answered:item.answer?.text??null}));
    const active=new Map(),old=[];
    for(const item of await inbox.legacy({})) {
      if(!active.has(item.mission))active.set(item.mission,await missions.read(item.mission).then(missionActive,()=>false));
      if(active.get(item.mission))old.push(item);
    }
    return {items:[...items,...old]};
  };
  return {answer,escalate,block,request,decide,click,choose,list};
}
