import { ownerOf,ownerRecord,isOwnerRecord,sameOwnerRecord } from './owner.mjs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import { clean, fail, readJSON, waitLock, writeJSON } from './common.mjs';
import { nextId } from './ids.mjs';
import { MARKER, archiveOf, archived, switchOver } from './legacy-archive.mjs';

// The requests: what only the user can settle, and the answer he gave to each. This module alone writes them, under one
// lock, in <root>/state/requests/I-<n>.json.
//
// The rule it keeps: an answer of the user is one record, written once in its request and never written again; it names
// the print of everything he saw, and that print names the request itself; it is written only while the request is open
// and not replaced; a permission is written only by the command of the screens; and it is carried, at most once, to the
// one the request names.
//
// A request never changes: it is written once, with the answers it offers, the question it comes from and the one its
// answer goes back to. Other words are another request, which says the one it replaces (`replaces`). What is kept
// beside it (its state, an error, a talk with the Lead, its answer) is changed by `mark` and `answer`, and by nothing
// else.
//
// What this does not prove: that a person clicked. `via` says which command recorded an answer, and any process that
// can run the CLI can run that command. The engine ties an answer to what was said to be seen; it does not see who
// answered.
const FILE=/^(I-\d{1,7})\.json$/,ID=/^I-\d{1,7}$/,SEEN=/^[0-9a-f]{64}$/,SHORT_MAX=200;
const number=id=>Number(id.slice(2));
// What blocks agents first, then what asks for permission, then the final approval.
const priorityOf=({type,blocked})=>type==='validation'?3:blocked?.length?1:2;
// Kept beside a request; everything else is the request, and is covered by its print, its identifier and the request
// it replaces included: the same words under two identifiers are two prints.
const BESIDE=['state','error','discussedAt','answer','updatedAt','version'];
const WORDS=['kind','title','short','summary','text','recommendation','options','why','details','tickets','consequences','blocked','proofs','answers','source','owner','forUser','migration','tries'];
// What a ticket stopped says beyond its words (M10, simulation/CONTRAT.md § 3 ter): who is on it (`owner`: the Lead), whether
// anything is expected of the user for now (`forUser`), the migration that fails, and what is being tried, in order. What
// is not as said is left out, never guessed. Its instant (`since`) is not one of its words: it is the instant of the stop,
// kept by the request written again for the same stop (tries added, the watcher started again), so that the time shown
// always starts from it.
const TRY_MAX=10,TRY_TEXT=300,MIGRATION_MAX=40;
const instant=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T/.test(value)&&Number.isFinite(Date.parse(value))?new Date(Date.parse(value)).toISOString():null;
export function stopWords(fields) {
  if(fields.type!=='stuck')return {};
  const tries=(Array.isArray(fields.tries)?fields.tries:[]).filter(x=>x&&typeof x.text==='string'&&x.text.trim()).slice(0,TRY_MAX).map(x=>({text:x.text.trim().slice(0,TRY_TEXT),...(instant(x.at)?{at:instant(x.at)}:{}),...(['same','running'].includes(x.outcome)?{outcome:x.outcome}:{}),...(x.last===true?{last:true}:{})}));
  return {...(fields.owner==='lead'?{owner:'lead'}:{}),...(typeof fields.forUser==='boolean'?{forUser:fields.forUser}:{}),
    ...(typeof fields.migration==='string'&&fields.migration.trim()?{migration:fields.migration.trim().slice(0,MIGRATION_MAX)}:{}),...(tries.length?{tries}:{})};
}
// The text under each answer, keyed by the answer: its keys are words of the Lead, not names of fields, so they are
// cleaned as words (clean would take a key that reads like a secret, « Keep Authorization header », for one, and the
// request would no longer match its print). Every write of a request goes through scrub, so no later write undoes it.
const wordsUnder=details=>Object.fromEntries(Object.entries(details).map(([answer,said])=>[clean(answer),clean(said)]));
const scrub=item=>{const {details,...rest}=item,out=clean(rest);if(details!==undefined)out.details=wordsUnder(details);return out;};
export const printOf=item=>createHash('sha256').update(JSON.stringify(Object.keys(item).filter(key=>!BESIDE.includes(key)&&item[key]!==undefined).sort().map(key=>[key,item[key]]))).digest('hex');
// The answers the user can give in one click: those the Lead proposes, else those the agent offered, else what the Lead
// recommends. Worked out once, when the request is made.
export function answersOf(item,question) {
  // A button is clicked as it is: an answer with a blank to fill in is no answer.
  const usable=list=>[...new Set(list||[])].filter(answer=>answer.length<=SHORT_MAX&&!/<[^<>]+>/.test(answer));
  for(const list of [item.options,question?.options,item.recommendation?[item.recommendation]:[]]){const found=usable(list);if(found.length)return found;}
  return [];
}
// The version a caller says it showed, or read to the user. No answer is recorded without it.
function seenArg(value) {
  if(value===undefined)fail('SEEN_REQUIRED','Read this request again, then answer.');
  if(typeof value!=='string'||!SEEN.test(value))fail('INVALID_ARGUMENT','seen must be the version of the request that was shown.');
  return value;
}
const refuseChanged=()=>fail('REQUEST_CHANGED','This request changed. Review it, then answer again.');
const closed=()=>fail('QUESTION_CLOSED','This request is closed.');
const fixed=()=>fail('REQUEST_FIXED','A request does not change once it is made.');
// Shown on a request whose answer cannot be tied to it for sure. Provisional: to be worded.
export const UNCERTAIN='The answer to this request is not certain. Nothing was passed on.';
// What an agent is told when it tries to record a permission. For agents, in French, provisional.
export const CLICK='Une autorisation se donne par un clic du propriétaire sur le choix affiché, dans la page du ticket ou l\'Inbox. Rien n\'est enregistré. Dis-lui où cliquer.';
const MARKS=['state','error','discussedAt'],MARKED=['opening','delivered','resolved','error'],VIAS=['screen','agent'];
// The print of a request of before this module (state/inbox), as it was worked out then.
const OLD_BESIDE=['state','draft','decision','updatedAt','error','priority','delegatingAt','delegatedAt','discussedAt','closedBy','replacedBy'];
// The answer of the user a question carries: in its place, or kept aside while the Lead passes it on (the relay). An
// answer that names a decision is one of the user, whoever it says gave it.
export const ownerAnswerOf=q=>q?.answer&&(isOwnerRecord(q.answer)||q.answer.decision)?q.answer:q?.legacyOwner??null;
// Answered here, by requests.answer, on a request whose version is still its print.
const recorded=item=>Boolean(item.answer?.id)&&item.version===printOf(item)&&item.answer.seen===item.version;
const oldPrint=(item,answers)=>createHash('sha256').update(JSON.stringify([Object.keys(item).filter(key=>!OLD_BESIDE.includes(key)).sort().map(key=>[key,item[key]]),answers])).digest('hex');

export function createRequestRegistry({root,questions,missions=null,now=Date.now,notify=async()=>{},probe=async()=>{},loadConfig=async()=>({})}) {
  const dir=join(root,'state','requests'),path=id=>join(dir,id+'.json'),decision=id=>join(root,'state','decisions',id+'.json');
  const stamp=()=>new Date(now()).toISOString(),lock=task=>waitLock(dir,task);
  const valid=id=>{if(typeof id!=='string'||!ID.test(id))fail('INVALID_ARGUMENT','Expected an Inbox element (I-<n>).');return id;};
  // A request of before, read where it was left and never written: it is shown, it is not answered.
  // A request of before, read in the archive of the switch-over and never written: it is shown, it is not answered,
  // and it is worth nothing as a permission (authorizes: false).
  const legacyOf=async id=>{const where=await archiveOf(root),item=where?await readJSON(join(where.folder,'state','inbox',id+'.json'),null):null;return item?{...item,legacy:true,authorizes:false}:null;};
  async function load(id) {
    const item=await readJSON(path(valid(id)),null)??await legacyOf(id);
    if(!item)fail('NOT_FOUND','No Inbox element uses this identifier.');
    return item;
  }
  async function folder(where) {
    let names;
    try{names=await readdir(where);}catch(error){if(error.code==='ENOENT')return [];throw error;}
    return names.map(name=>FILE.exec(name)?.[1]).filter(Boolean).sort((a,b)=>number(a)-number(b));
  }
  const all=async()=>(await Promise.all((await folder(dir)).map(id=>readJSON(path(id),null).catch(()=>null)))).filter(Boolean);
  // Replaced: another request says so. Nothing is written in the one that is replaced.
  const replacedIn=(every,item)=>every.some(other=>other.replaces===item.id);
  const live=(every,item)=>item.state!=='resolved'&&!replacedIn(every,item);
  // A ticket said stuck says why (cause): each cause is its own request.
  const causeOf=x=>x.type==='stuck'?(x.cause||'answer'):null;
  // What a request waits for: the question it comes from, else its mission, ticket, type and cause. Two questions are
  // two requests, open at the same time: neither replaces the other.
  const keyOf=x=>x.source?'q:'+x.source.id:['k',x.mission,x.ticket??'',x.type,causeOf(x)??''].join('|');
  const wordsOf=x=>JSON.stringify(WORDS.map(key=>x[key]??null));
  const usable=q=>['open','escalated'].includes(q.state)&&!q.answer&&!q.legacyOwner?{id:q.id,question:q.question,options:q.options||[],from:q.from,fromTab:q.fromTab??null,ticket:q.ticket??null}:null;
  // One request per key waits at a time, and only a new one notifies. The same words again change nothing. Other words
  // are another request, which names the one it replaces; one already answered is never replaced: the new one waits on
  // its own, in a question of the Lead. `fields.question` names the question of an agent it comes from: that question
  // is held (no answer of the Lead can reach it any more) under this lock, before the request is written; a question
  // the Lead answered first, or that already carries an answer of the user, is not taken, and the request waits in a
  // question of the Lead.
  async function ask(fields) {
    const {item,created,notified}=await lock(async()=>{
      const every=await all(),at=stamp(),cited=fields.question??null;
      if(fields.once!==undefined){
        if(typeof fields.once!=='string'||!/^[a-z0-9|.-]{1,200}$/.test(fields.once))fail('INVALID_ARGUMENT','Invalid request event key.');
        const prior=every.find(x=>x.mission===fields.mission&&x.once===fields.once);
        if(prior)return {item:prior,created:false,notified:false};
      }
      let source=cited&&!every.some(x=>x.question===cited&&x.answer)?usable(await questions.read(cited)):null,known,words;
      for(;;) {
        words=JSON.parse(JSON.stringify(clean({...stopWords(fields),...(fields.kind?{kind:fields.kind}:{}),title:fields.title,...(fields.short?{short:fields.short}:{}),summary:fields.summary??null,text:fields.text,recommendation:fields.recommendation??'',options:fields.options??[],why:fields.why??'',...(fields.tickets?{tickets:fields.tickets}:{}),consequences:fields.consequences??'',blocked:fields.blocked??[],proofs:fields.proofs??[],source:source&&{id:source.id,question:source.question,options:source.options}})));
        if(fields.details)words.details=wordsUnder(fields.details);
        words.answers=answersOf(words,source);
        // The text under a choice is only for a choice the request offers: worked out here, under the lock, once the
        // source question is known to be taken or left (one already answered, or answered just now, is left, and so are
        // its choices). Nothing is held or written before.
        const unknown=Object.keys(words.details??{}).find(answer=>!words.answers.includes(answer));
        if(unknown!==undefined)fail('INVALID_ARGUMENT','details: « '+unknown.slice(0,SHORT_MAX)+' » is not one of the answers offered (options).');
        // A permission is given by a click on one of its answers: without one to click, it could never be given.
        if(fields.type==='authorization'&&!words.answers.length)fail('INVALID_ARGUMENT','An authorization offers the answers to click (options).');
        const key=keyOf({...fields,source});
        known=every.filter(x=>live(every,x)&&keyOf(x)===key).at(-1)??null;
        // Written again on the request it was read from (`expect`, lead-block, M10 review): refused when that one was
        // replaced or lifted since, under this lock, so that nothing lands on an old stop or opens a lifted one again.
        if(fields.expect!==undefined&&known?.id!==fields.expect)fail('STOP_CHANGED','The stop was written again or lifted since it was read. Read it again.');
        if(known&&wordsOf(known)===wordsOf(words))return {item:known,created:false,notified:false};
        if(!source||await questions.retain(source.id))break;
        source=null;
      }
      await probe('ask:held');
      const waiting=Boolean(known)&&!known.answer,ticket=fields.ticket??null;
      const question=source?.id??(waiting?known.question:fields.type==='stuck'?null:(await questions.create({mission:fields.mission,ticket,from:'lead',question:fields.own??fields.title,state:'escalated'})).id);
      const recipient=source?{question:source.id,from:source.from,fromTab:source.fromTab,ticket:source.ticket,mission:fields.mission}:waiting?known.recipient:question?{question,from:'lead',fromTab:null,ticket,mission:fields.mission}:null;
      await probe('ask:asked');
      const id=await nextId(root,'I');
      const {details,...said}=words;
      // The instant of a stop: the one of the stop it is written again for (still open: the ticket has not run since),
      // else the one said, else now.
      const since=fields.type==='stuck'?{since:(waiting?known.since??known.createdAt:null)??instant(fields.since)??at}:{};
      const made=JSON.parse(JSON.stringify(clean({id,type:fields.type,mission:fields.mission,...(fields.once?{once:fields.once}:{}),project:fields.project??null,issue:fields.issue??null,ticket,question,recipient,...said,...(fields.cause?{cause:fields.cause}:{}),...(waiting?{replaces:known.id}:{}),to:ownerOf(await loadConfig()).id,priority:priorityOf({type:fields.type,blocked:words.blocked}),createdAt:at,...since})));
      if(details)made.details=details;
      Object.assign(made,{version:printOf(made),state:'pending',error:null,answer:null,updatedAt:at});
      await writeJSON(path(id),made,scrub);
      await probe('ask:written');
      return {item:made,created:true,notified:!waiting};
    });
    if(notified)await notify('FABRIQUE_CONSOLE · '+(item.issue||item.mission),'Reply needed: '+item.title);
    return {item,created,...(created&&item.replaces?{replaced:item.replaces}:{})};
  }
  // What is kept beside a request: its state, an error, the moment it was opened with the Lead. Never its answer, never
  // a word of it. A request resolved stays resolved; « answered » is said by `answer` alone.
  const mark=(id,fields,{when=null}={})=>lock(async()=>{
    if(Object.keys(fields).some(key=>!MARKS.includes(key))||(fields.state!==undefined&&!MARKED.includes(fields.state)))fixed();
    const item=await load(id);
    if(item.legacy||item.state==='resolved'||(when&&!when.includes(item.state)))return {item,changed:false};
    const before=JSON.stringify(MARKS.map(key=>item[key]??null));
    if(fields.state!==undefined)item.state=fields.state;
    if(fields.error!==undefined)item.error=fields.error;
    // Opened with the Lead once: the first one keeps it, null gives it back.
    if(fields.discussedAt===null)delete item.discussedAt;else if(fields.discussedAt!==undefined&&!item.discussedAt)item.discussedAt=fields.discussedAt;
    if(JSON.stringify(MARKS.map(key=>item[key]??null))===before)return {item,changed:false};
    item.updatedAt=stamp();
    await writeJSON(path(item.id),item,scrub);
    return {item,changed:true};
  });
  // The stop of a ticket as it is now (lead-block lifted, M10 review): found and lifted under the lock, in one step.
  // Null when none is open.
  // `since`: only the stop of that instant (the watcher, M10 review 2), every live one of it; else the last stop of the
  // ticket (lead-block).
  const liftStop=({mission,ticket,cause='blocked',since})=>lock(async()=>{
    const every=await all(),found=every.filter(x=>live(every,x)&&x.type==='stuck'&&x.mission===mission&&x.ticket===ticket&&causeOf(x)===cause&&x.state!=='resolved'&&(since===undefined||x.since===since));
    const items=since===undefined?found.slice(-1):found;
    for(const item of items){item.state='resolved';item.updatedAt=stamp();await writeJSON(path(item.id),item,scrub);}
    return items.at(-1)??null;
  });
  // The one function that records an answer. Everything is compared here, under the lock, before the one write: the
  // version that was shown (seen) is the print of this request; the request is not replaced, not closed; a mockup
  // chosen is the publication that was shown, published for this request; a permission is one of its answers, sent by
  // a screen. A request already answered gives its first answer back, and nothing is written. « Left to the Lead » is
  // an answer too (left), for a decision only.
  const answer=({item:id,seen,choice=null,text=null,mockup,published,via,left=false})=>lock(async()=>{
    const item=await load(id);
    if(!VIAS.includes(via))fail('INVALID_ARGUMENT','An answer says where it comes from.');
    if(item.type==='authorization'&&via!=='screen')fail('CLICK_REQUIRED',CLICK);
    if(item.legacy)closed();
    if(seenArg(seen)!==item.version||printOf(item)!==seen)refuseChanged();
    if(item.answer)return {item,answer:item.answer,created:false};
    if(replacedIn(await all(),item))refuseChanged();
    if(item.state==='resolved')closed();
    // « Let the Lead decide » is for a question only (decision 44): a suggestion, a verdict, a choice of copy are not.
    if(left&&(item.type!=='decision'||item.kind))fail('INVALID_ARGUMENT','Only a question can be left to the Lead.');
    if(item.type==='authorization'&&!item.answers.includes(choice))fail('INVALID_ARGUMENT','An authorization is answered with one of the answers shown.');
    if(mockup!==undefined) {
      const kit=missions?((await missions.read(item.mission)).mockups||[]).find(known=>known.id===mockup):null;
      if(!kit||kit.item!==item.id||!kit.pub||kit.pub!==published)fail('MOCKUP_STALE','This mockup was published again. Look at it once more.');
    }
    const made=JSON.parse(JSON.stringify(clean({...ownerRecord(ownerOf(await loadConfig())),id:left?null:await nextId(root,'D'),choice,text,seen,published:mockup===undefined?null:published,via,at:stamp(),...(left?{left:true}:{})})));
    item.answer=made;
    // Answered, it is « answered » whatever it was (an error said on it included, which it keeps): the watcher finds it
    // there (toSettle) until its answer has gone, even after a stop just after this write.
    item.state='answered';
    item.updatedAt=made.at;
    await writeJSON(path(item.id),item,scrub);
    await probe('answer:written');
    return {item,answer:made,created:true};
  });
  // What an answer leaves behind it, each file under its own condition, so that it can be played again after a crash at
  // any point and after the answer went on its way: the decision D-n if it is not there; the answer in the question the
  // request names, only if that question still waits, without an answer, and is still the one that was copied. A
  // question answered, delivered or resolved is neither opened again nor written again; an answer kept aside for the
  // relay (legacyOwner) counts as written. Left to the Lead, the question of an agent is given back to it. Nothing is sent
  // from here. What cannot be tied for sure is said (UNCERTAIN) and passed on to nobody.
  const settle=id=>lock(async()=>{
    const item=await load(id),given=item.answer,to=item.recipient;
    if(item.legacy||!given)return {item,settled:'none'};
    // A question that is no longer there is a question that cannot be written: said uncertain, like any other doubt.
    const gone=error=>{if(error?.code==='NOT_FOUND')return {written:false,already:false};throw error;};
    if(given.left) {
      const waits=Boolean(to)&&to.from!=='lead';
      if(to)await (waits?questions.giveBack(to.question):questions.close(to.question)).catch(gone);
      return {item,settled:'left',waits};
    }
    const unsure=async()=>{
      if(!['resolved','error'].includes(item.state)){item.state='error';item.error=UNCERTAIN;item.updatedAt=stamp();await writeJSON(path(item.id),item,scrub);}
      return {item,settled:'uncertain'};
    };
    let kept=await readJSON(decision(given.id),null);
    if(!kept){kept={id:given.id,item:item.id,mission:item.mission,question:item.question,choice:given.choice,text:given.text,seen:given.seen,...(given.by?{by:given.by,role:given.role}:ownerRecord({id:item.to||'owner'})),via:given.via,at:given.at};await writeJSON(decision(given.id),kept);}
    else if(kept.item!==item.id)return unsure();
    await probe('settle:decided');
    if(!to)return {item,settled:'kept'};
    const put=await questions.inscribe(to.question,{text:given.text,decision:given.id,choice:given.choice,title:item.title,by:kept.by,role:kept.role,at:given.at},to).catch(gone);
    await probe('settle:inscribed');
    return put.written||put.already?{item,settled:put.written?'inscribed':'already'}:unsure();
  });
  // A task that needs a request still open (a mockup published for it), run under the lock of the requests.
  const holding=(id,task)=>lock(async()=>{
    const item=await load(id);
    if(item.legacy||item.answer||item.state==='resolved')closed();
    if(replacedIn(await all(),item))refuseChanged();
    return task(item);
  });
  const ordered=items=>items.sort((a,b)=>a.priority-b.priority||String(a.createdAt).localeCompare(String(b.createdAt))||number(a.id)-number(b.id));
  // What waits in the Inbox: open, not replaced, not left to the Lead.
  async function list({mission}={}) {
    const every=await all();
    return ordered(every.filter(item=>live(every,item)&&!item.answer?.left&&(mission===undefined||item.mission===mission)));
  }
  // A task run while no request can be asked, with what waits of a mission as list gives it: what it decides from them
  // stays true until it ends (the approval of a plan, ticket M5, is never written beside a request asked meanwhile).
  const withWaiting=(mission,task)=>lock(async()=>{
    const every=await all();
    return task(ordered(every.filter(item=>live(every,item)&&!item.answer?.left&&item.mission===mission)));
  });
  // The answers still to carry: written, and not yet said delivered. One that goes to nobody (an alert) is carried once
  // its decision is kept.
  async function toSettle({mission}={}) {
    const waiting=(await all()).filter(item=>item.answer&&item.state==='answered'&&(mission===undefined||item.mission===mission));
    const carried=await Promise.all(waiting.map(async item=>!item.answer.left&&!item.recipient&&Boolean(await readJSON(decision(item.answer.id),null).catch(()=>null))));
    return waiting.filter((_item,n)=>!carried[n]);
  }
  // Whether an answer of the user that a question carries may go on to an agent: only the answer this register recorded
  // (requests.answer) on the request that names this question, on the version that request has, word for word (its
  // decision, its words, its choice). Any other goes to nobody, by any way: a question of before, words changed since,
  // a request changed since. Worked out once per pass; a question carrying no answer of the user is not vouched for.
  const vouchIn=known=>q=>{
    const said=ownerAnswerOf(q);
    return Boolean(said)&&known.some(item=>recorded(item)&&sameOwnerRecord(said,item.answer,item.to)&&item.recipient?.question===q.id&&item.question===q.id&&item.mission===q.mission&&item.answer.id===said.decision&&item.answer.text===said.text&&(item.answer.choice??null)===(said.choice??null));
  };
  async function vouches({mission}={}) {
    return vouchIn((await all()).filter(item=>mission===undefined||item.mission===mission));
  }
  // The request that waits in a question, or whose answer went to it.
  async function waitingIn(question) {
    const every=await all();
    return every.filter(item=>item.question===question&&live(every,item)).at(-1)??null;
  }
  // The decisions taken, oldest first, for a mission when one is named. Those of before are kept as they were.
  async function decisions({mission}={}) {
    const where=join(root,'state','decisions');
    let names;
    try{names=await readdir(where);}catch(error){if(error.code==='ENOENT')return [];throw error;}
    const found=(await Promise.all(names.filter(name=>/^D-\d{1,7}\.json$/.test(name)).map(name=>readJSON(join(where,name),null)))).filter(Boolean);
    return found.filter(d=>mission===undefined||d.mission===mission).sort((a,b)=>String(a.at).localeCompare(String(b.at)));
  }
  // The decisions as an agent may be given them: the words of one only when it is the answer this register recorded, on
  // the version of its request, word for word. Any other (a decision of before, a file that names a request with other
  // words) is said uncertain, without its choice or its words.
  const sureIn=every=>{
    const known=new Map(every.filter(recorded).map(item=>[item.id,item]));
    return d=>{const item=known.get(d.item);return Boolean(item)&&sameOwnerRecord(d,item.answer,item.to)&&item.answer.id===d.id&&item.mission===d.mission&&d.seen===item.version&&d.text===item.answer.text&&(d.choice??null)===(item.answer.choice??null);};
  };
  async function vouchedDecisions({mission}={}) {
    const sure=sureIn(await all());
    return (await decisions({mission})).map(d=>sure(d)?d:{id:d.id,item:d.item,at:d.at,uncertain:true});
  }
  // The answers of the user as the page of a development shows them (« Your decisions », simulation/CONTRAT.md), the
  // newest first: only an answer this register recorded, on the version of its request, word for word (sureIn), with
  // the words of its request (its kind, its short wording, its title, its ticket). Left to the Lead, an answer is no
  // decision; one that cannot be vouched for is not shown. `kind`: that of the request, else « dev » for the question
  // of a dev, « lead » for a question of the Lead on a ticket asked once the launch was asked (`launchedAt`), else
  // « question ». A choice of copy or of mockup says its variant by its letter, in the words of the mockup. `from`: where
  // its request comes from (its recipient: `review-1`, `review-2`, `dev`, `qa`, `lead`), when it says it.
  async function taken({mission,launchedAt=null}={}) {
    const every=await all(),sure=sureIn(every),byId=new Map(every.map(item=>[item.id,item]));
    return (await decisions({mission})).filter(sure).reverse().map(d=>{
      const item=byId.get(d.item),said=d.choice??d.text,pick=item.answer?.published!=null;
      const kind=item.kind??(item.recipient?.from==='dev'?'dev':item.ticket&&launchedAt&&String(item.createdAt)>=String(launchedAt)?'lead':'question');
      const at=(item.answers||[]).indexOf(said),letter=pick?String(said).toUpperCase():kind==='copy'&&at>=0&&at<8?String.fromCharCode(65+at):null;
      return JSON.parse(JSON.stringify({id:d.id,item:item.id,by:d.by,role:d.role,kind,short:item.short||item.title,said:letter?'variant '+letter:said,title:item.title,answer:letter?'Variant '+letter+(pick?'':' : '+said):said,at:d.at,...(item.ticket?{ticket:item.ticket}:{}),...(item.recipient?.from?{from:item.recipient.from}:{}),...(letter&&!pick?{variant:letter}:{})}));
    });
  }
  // The requests of before that were not resolved, read and never written, copied nowhere. An answer is certain when
  // one decision names the request with the print it had, and one question only names it; any other is said uncertain:
  // no agreement is made up from it, and nothing of it is carried anywhere. None of them can be answered: what still
  // matters is asked again, as a new request.
  async function legacy({mission}={}) {
    const items=(await archived(root,'inbox',FILE)).map(item=>({...item,legacy:true,authorizes:false})).filter(item=>ID.test(item.id??'')&&item.state!=='resolved'&&(mission===undefined||item.mission===mission));
    if(!items.length)return [];
    const asked=[...await questions.list({}),...await archived(root,'questions',/^Q-\d{1,7}\.json$/)],taken=[...await decisions({}),...await archived(root,'decisions',/^D-\d{1,7}\.json$/)];
    return ordered(items.map(item=>{
      const named=asked.filter(q=>q.item===item.id),made=taken.filter(d=>d.item===item.id);
      const certain=typeof item.decision==='string'&&made.length===1&&made[0].id===item.decision&&named.length===1&&named[0].id===item.question&&made[0].seen===oldPrint(Object.fromEntries(Object.entries(item).filter(([key])=>!['legacy','authorizes'].includes(key))),answersOf(item,named[0]));
      return {...item,priority:item.priority??2,answers:[],seen:null,decision:certain?made[0].id:null,answered:certain?made[0].text:null,state:certain?'answered':'error',error:certain?null:UNCERTAIN};
    }));
  }
  // The switch-over (src/legacy-archive.mjs), made once before anything else is done here: the old stock moved to its
  // archive, the decisions and the questions these requests recorded kept in place. Until it is made, every operation
  // of the requests fails with LEGACY_ARCHIVE_FAILED, and so nothing is passed on.
  async function switched() {
    if((await readJSON(join(root,...MARKER),null))?.state==='done')return {switched:false};
    return lock(()=>switchOver({root,now,probe,keeps:async()=>{const every=await all();return {decision:sureIn(every),question:q=>!ownerAnswerOf(q)||vouchIn(every)(q)};}}));
  }
  const gated=fn=>async(...args)=>{await switched();return fn(...args);};
  // The questions these requests lean on are read after the switch too, whoever reads them (mission-read, Pilot…).
  questions?.before?.(switched);
  // Where a request is kept: the file an operational message names instead of copying its words (decision 61).
  const fileOf=id=>typeof id==='string'&&/^I-\d{1,7}$/.test(id)?path(id):null;
  return {switched,fileOf,...Object.fromEntries(Object.entries({ask,read:load,mark,liftStop,answer,settle,holding,withWaiting,list,toSettle,vouches,waitingIn,decisions,vouchedDecisions,taken,legacy}).map(([name,fn])=>[name,gated(fn)]))};
}
