import { sameOwnerRecord } from './owner.mjs';
import { T } from '../ui/v3/texts.js';
import { UNCERTAIN, ownerAnswerOf } from './requests.mjs';
import { routedQuestion, relayedDecision, answerText, handoverText, delegateAsk, LOG, STUCK } from './agent-texts.mjs';

// The questions of a mission on their way, one step per pass of the watcher: a file of an agent becomes a question, the
// Lead is told, an answer goes to the one who asked, once, and the question is over when that agent works again. Nothing
// here decides: the Lead and the user do. An answer that cannot be delivered is tried three times, then said in the Inbox.
const TRIES=3,UNSURE_MS=60000;
// What the Lead was given and has not acted on after a quarter of an hour is said in the Inbox.
export const STILL_MS=15*60000;

// What made a ticket stuck is over (its answer in the hands of the Lead, its agent back, its branch merged): that cause
// only is settled, the others stay said.
export async function unstick(inbox,mission,ticket,cause) {
  for(const it of (await inbox.list({mission})).filter(i=>i.type==='stuck'&&i.ticket===ticket&&(i.cause||'answer')===cause&&i.state!=='resolved'))
    await inbox.mark(it.id,{state:'resolved'});
}

// A send that fails without saying the message did not go may have gone: a delay that passed, a process killed, an
// error that says nothing. Only a refusal that is known (SEND_FAILED: the tool answered that it did not send, or never
// ran) is a failure; anything else is a doubt (SEND_UNSURE).
const KNOWN_NOT_SENT=['SEND_FAILED','INVALID_ARGUMENT','NOT_FOUND'];
export const surely=send=>async message=>{
  try{return await send(message);}
  catch(error){if(KNOWN_NOT_SENT.includes(error?.code))throw error;throw Object.assign(new Error('This message may have been sent.'),{code:'SEND_UNSURE'});}
};
// A message that must go once: claimed, sent, marked as sent, then recorded. A pass that finds it claimed finishes what
// the mark proves; once the send has happened, nothing can claim it back. Its reservation is given back only when it is
// known that nothing went (an error before the send, or a refusal that is known). A send that is not known to have
// failed keeps its reservation: the doubt is said at once, and nothing is sent again by itself.
export async function once(key,{act,record,failure,doubt},{id,claim,unclaim,claimedAt},now=Date.now) {
  if(await claim(id,key)) {
    try{await act();}
    catch(error){
      if(error?.code==='SEND_UNSURE'){await doubt();return;}
      await unclaim(id,key);await failure(String(error.message||error));return;
    }
    await claim(id,key+'|sent');
    await record();
    return;
  }
  if(await claimedAt(id,key+'|sent')){await record();return;}
  const at=await claimedAt(id,key);
  if(at!==null&&now()-at>=UNSURE_MS)await doubt();
}
// A request left to the Lead: its message goes once, by the same way as every other (once). `target` gives the terminal
// of the Lead, launched again if it is gone. Sent for sure, the request is over. Not sure, it is said in the Inbox, once:
// the alert is written before the mark that says it was, so that a stop between the two says it again on the next pass
// (the same words again make no second alert).
export function createHandover({inbox,send,now=Date.now}) {
  const post=surely(send);
  return (item,{waits,target,claims,log=async()=>{}})=>{
    const key='delegate|'+item.id,context={id:item.mission,...claims};
    return once(key,{
      act:async()=>{const to=await target();await post({...to,text:delegateAsk(item,waits?item.recipient.question:null,{file:inbox.fileOf(item.id)})});},
      record:async()=>{await inbox.mark(item.id,{state:'resolved'},{when:['answered']});await log(item.mission,LOG.delegated(item),'run');},
      failure:why=>log(item.mission,LOG.delegateFailed(item),'fail',why),
      doubt:async()=>{
        if(await claims.claimedAt(item.mission,key+'|unsure')!==null)return;
        await inbox.ask({type:'stuck',cause:'unsure',mission:item.mission,project:item.project,issue:item.issue,ticket:item.ticket,question:null,title:STUCK.unsureTitle(item.ticket||item.id),text:item.title,recommendation:STUCK.recommendation,why:STUCK.unsure,blocked:item.ticket?[item.ticket]:[],proofs:[]});
        await claims.claim(item.mission,key+'|unsure');
      },
    },context,now);
  };
}

export function createConversation({questions,inbox,send:rawSend,leadLaunch=null,now=Date.now}) {
  const send=surely(rawSend),handover=createHandover({inbox,send:rawSend,now});
  const ownerAnswer=(answer,item)=>Boolean(item?.answer)&&sameOwnerRecord(answer,item.answer,item.to);
  const tabOf=(from,ticket,identifier)=>{
    if(from==='dev')return T.issue.devTabName(ticket);
    if(from==='qa')return T.issue.qaTabName(identifier);
    const review=/^review-([12])$/.exec(from);
    return review?T.issue.reviewTabName(ticket,Number(review[1])):null;
  };
  async function take({id,session:s,reports,log}) {
    const known=new Set((await questions.list({mission:id})).map(q=>q.source));
    for(const a of reports) {
      if(a.kind!=='ask'||a.unreadable||!a.question||known.has(a.name))continue;
      const {question,created}=await questions.ensure({mission:id,ticket:a.ticket,from:a.from,fromTab:tabOf(a.from,a.ticket,s.identifier),question:a.question,options:a.options||[],askedAt:a.at,source:a.name});
      if(created)await log(id,LOG.asked(question),'wait',question.question.slice(0,140));
    }
  }
  const raiseStuck=(q,title,why,{id,mission:m},{recommendation=STUCK.recommendation,cause='answer'}={})=>inbox.ask({type:'stuck',cause,mission:id,project:m.project,issue:m.issue?.identifier??null,ticket:q.ticket,question:null,title:title(q.ticket),text:STUCK.text(q),recommendation,why,blocked:[q.ticket],proofs:[]});
  // A message claimed long ago with nothing to prove it went: it is said, never sent again blindly. The mark comes last:
  // a crash before it says it again on the next pass, and saying it twice changes nothing.
  async function unsure(q,context) {
    const waiting=await inbox.waitingIn(q.id);
    if(waiting)await inbox.mark(waiting.id,{state:'error',error:STUCK.unsure});
    if(q.ticket)await raiseStuck(q,STUCK.unsureTitle,STUCK.unsure,context,{cause:'unsure'});
    await questions.progress(q.id,x=>{if(x.unsure)return false;x.unsure=true;return true;});
  }
  // A question that carries an answer of the user the requests did not record as it is (a question of before the requests,
  // words changed since, a request changed since): nothing of it is delivered nor relayed. It is said uncertain, in the Inbox for its ticket; the alert comes before
  // the mark, so that a crash between the two says it again on the next pass.
  async function uncertain(q,context) {
    if(q.unsure)return;
    if(q.ticket)await raiseStuck(q,STUCK.uncertainTitle,UNCERTAIN,context,{cause:'uncertain'});
    await questions.progress(q.id,x=>{if(x.unsure)return false;x.unsure=true;return true;});
  }
  const sendOnce=(key,steps,context)=>once(key,steps,context,now);
  // The Lead is told once. One that is gone is launched again with its folder, then told.
  const route=(q,context)=>{
    const {id,session:s,lead,log}=context;
    if(!lead&&context.canLaunchLead===false)return;
    return sendOnce('route|'+q.id,{
      act:async()=>{
        let target={sessionId:s.id,terminal:s.terminalId};
        if(!lead) {
          if(!leadLaunch)throw new Error('The Lead of this mission is gone.');
          const launched=await leadLaunch({mission:id});
          target={sessionId:launched.session.id,terminal:launched.session.terminalId};
          await log(id,LOG.relaunched(q),'run');
        }
        await send({...target,text:routedQuestion(q,{file:questions.fileOf(q.id)})});
      },
      record:async()=>{await questions.progress(q.id,x=>{if(x.routedAt)return false;x.routedAt=questions.stamp();return true;});await log(id,LOG.routed(q),'run');},
      failure:why=>log(id,LOG.routeFailed(q),'fail',why),
      doubt:()=>unsure(q,context),
    },context);
  };
  // A decision of the user on the question of an agent goes to the Lead, who passes it on. The Lead can answer from the
  // moment it is told: the question is open again before the message leaves, and given back if it cannot.
  const relay=(q,item,context)=>{
    const {id,session:s,lead,log}=context,terminal=lead.address;
    return sendOnce('relay|'+q.id,{
      act:async()=>{
        await questions.progress(q.id,x=>{
          if(x.state==='open'&&ownerAnswer(x.legacyOwner,item))return false;
          if(x.state!=='answered'||!ownerAnswer(x.answer,item))throw new Error('This question no longer carries the recorded owner decision.');
          x.legacyOwner=x.answer;x.answer=null;x.state='open';x.routedAt=x.routedAt||questions.stamp();return true;
        });
        await send({sessionId:s.id,terminal,text:relayedDecision(q)});
      },
      record:async()=>{await questions.progress(q.id,x=>{if(x.relayedAt)return false;x.relayedAt=questions.stamp();return true;});await log(id,LOG.relayed(q),'run');},
      failure:async why=>{await questions.progress(q.id,x=>{if(x.state!=='open'||!x.legacyOwner)return false;x.answer=x.legacyOwner;x.legacyOwner=null;x.state='answered';return true;});await failed(q,terminal,why,context);},
      doubt:()=>unsure(q,context),
    },context);
  };
  async function failed(q,terminal,why,context) {
    const after=await questions.progress(q.id,x=>{x.delivery={at:null,terminal,attempts:(x.delivery?.attempts||0)+1};return true;});
    await context.log(context.id,LOG.deliveryFailed(q,after.delivery.attempts),'fail',why);
    if(after.delivery.attempts<TRIES)return;
    const waiting=await inbox.waitingIn(after.id);
    if(waiting)await inbox.mark(waiting.id,{state:'error',error:STUCK.error});
    if(after.ticket)await raiseStuck(after,STUCK.title,STUCK.why,context);
  }
  const deliver=(q,context)=>{
    const {id,session:s,lead,tab,log}=context,own=(q.from==='lead'?lead?.address:tab(q.fromTab)?.address)??null;
    // The agent that asked has no tab any more: the answer goes to the Lead, who launches it again with it. Only with no
    // Lead either does the delivery fail, and after three tries the ticket is said stuck in the Inbox.
    const handover=!own&&q.from!=='lead'&&Boolean(lead?.address),terminal=own??(handover?lead.address:null),ticket=(context.mission?.tickets||[]).find(t=>t.id===q.ticket)||null;
    return sendOnce('deliver|'+q.id,{
      act:async()=>{if(!terminal)throw new Error('no terminal');const file=questions.fileOf(q.id);await send({sessionId:s.id,terminal,text:handover?handoverText(q,{ticket,file}):answerText(q,{file})});},
      record:async()=>{
        await questions.progress(q.id,x=>{if(x.state!=='answered')return false;x.state='delivered';x.delivery={at:questions.stamp(),terminal,attempts:(x.delivery?.attempts||0)+1,...(handover?{via:'lead'}:{})};return true;});
        const carried=await inbox.waitingIn(q.id);
        if(carried?.answer&&!carried.answer.left)await inbox.mark(carried.id,{state:'delivered'},{when:['answered']});
        await log(id,handover?LOG.handedOver(q):LOG.delivered(q),'ok');
        // In the hands of the Lead now: the ticket said stuck in the Inbox is no longer stuck.
        if(handover&&q.ticket)await unstick(inbox,id,q.ticket,'answer');
      },
      failure:why=>failed(q,terminal,why,context),
      doubt:()=>unsure(q,context),
    },context);
  };
  // Delivered and taken in: the agent works again, or has reported since. What was seen is kept first: a crash after it
  // is finished by the next pass, even if the agent has stopped working by then.
  async function acknowledge(q,context) {
    const {id,reports,lead,tab,log,claim,claimedAt}=context,agent=q.from==='lead'?lead:tab(q.fromTab),newer=reports.some(r=>r.kind!=='ask'&&r.ticket===q.ticket&&r.at&&q.delivery?.at&&r.at>q.delivery.at);
    const handed=q.delivery?.via==='lead'&&Boolean(q.ticket);
    if(agent?.status!=='working'&&!newer&&!(await claimedAt(id,'acked|'+q.id))) {
      // Given to the Lead: its agent still missing a quarter of an hour later is said in the Inbox, once; an agent back,
      // even idle, is no longer missing (its answer is not taken in for all that).
      if(handed&&!agent&&now()-Date.parse(q.delivery.at)>=STILL_MS&&await claim(id,'waited|'+q.id))await raiseStuck(q,STUCK.waitTitle,STUCK.wait,context,{recommendation:STUCK.waitRecommendation,cause:'agent'});
      if(handed&&agent)await unstick(inbox,id,q.ticket,'agent');
      return;
    }
    await claim(id,'acked|'+q.id);
    if(handed)await unstick(inbox,id,q.ticket,'agent');
    const carried=await inbox.waitingIn(q.id);
    if(carried?.answer&&!carried.answer.left)await inbox.mark(carried.id,{state:'resolved'});
    await questions.progress(q.id,x=>{x.state='resolved';return true;});
    await log(id,LOG.acked(q),'ok');
  }
  // One pass: what waits for an answer, by ticket. One question that fails does not stop the others.
  async function step(context) {
    const {id}=context;
    // Nothing is read to be passed on before the old stock is archived (requests.switched): failed, nothing runs.
    await inbox.switched();
    await take(context);
    // The answers of the user still to carry: what a crash left undone is done now, each file under its own condition
    // (requests.settle). One left to the Lead is told to it, once; a Lead that is gone is launched again first.
    for(const item of await inbox.toSettle({mission:id}))try{
      const {waits}=await inbox.settle(item.id);
      if(item.answer.left&&!(context.canLaunchLead===false&&!context.lead))await handover(item,{waits,claims:context,log:context.log,target:async()=>{
        if(context.lead)return {sessionId:context.session.id,terminal:context.session.terminalId};
        if(!leadLaunch)throw new Error('The Lead of this mission is gone.');
        const launched=await leadLaunch({mission:id});
        return {sessionId:launched.session.id,terminal:launched.session.terminalId};
      }});
    }catch{}
    const vouched=await inbox.vouches({mission:id});
    for(const q of await questions.list({mission:id}))try{
      if(ownerAnswerOf(q)&&!['delivered','resolved'].includes(q.state)&&!vouched(q)){await uncertain(q,context);continue;}
      const item=await inbox.waitingIn(q.id);
      if(q.state==='open'&&q.from!=='lead'&&!q.routedAt&&!q.unsure)await route(q,context);
      // Its Lead gone before passing it on: the decision is not lost, it goes straight to the agent.
      else if(q.state==='open'&&q.legacyOwner&&!context.lead&&!q.unsure)await questions.progress(q.id,x=>{if(x.state!=='open'||!x.legacyOwner)return false;x.answer=x.legacyOwner;x.legacyOwner=null;x.state='answered';return true;});
      else if(context.lead&&!q.relayedAt&&!q.unsure&&q.from!=='lead'&&(q.delivery?.attempts||0)<TRIES&&vouched(q)&&((q.state==='answered'&&ownerAnswer(q.answer,item))||(q.state==='open'&&q.legacyOwner)))await relay(q,item,context);
      // Three tries spent on a tab that is gone: once a Lead is there, the answer still goes to it.
      else if(q.state==='answered'&&!q.unsure&&((q.delivery?.attempts||0)<TRIES||(q.from!=='lead'&&Boolean(context.lead?.address)&&!context.tab(q.fromTab)?.address)))await deliver(q,context);
      else if(q.state==='delivered')await acknowledge(q,context);
    }catch{}
    return waitingOf(id);
  }
  const waitingOf=async id=>new Map((await questions.list({mission:id})).filter(q=>q.ticket&&q.state!=='resolved').map(q=>[q.ticket,q.id]));
  // A pass in pause (M11 review 1): what the agents asked is taken in, for the Inbox; nothing is carried, sent or
  // launched (no answer delivered, no Lead made again) before Resume. What waits for an answer, by ticket.
  async function hold(context) {
    await inbox.switched();
    await take(context);
    return waitingOf(context.id);
  }
  // The answer a dev launched again is given with its task: that of the question handed to the Lead while it had no tab.
  // One that carries an answer of the user goes only if the requests recorded it as it is, for this question and the
  // version of its request (requests.vouches): any other is joined to nothing, and its question is said uncertain, once;
  // an alert that cannot be written does not hold the dev back, and joins nothing either. The text, or null.
  async function resumed(q,{id,mission}) {
    if(!q)return null;
    if(q.answer&&(!ownerAnswerOf(q)||(await inbox.vouches({mission:id}))(q)))return answerText(q,{file:questions.fileOf(q.id)});
    await uncertain(q,{id,mission}).catch(()=>{});
    return null;
  }
  return {step,hold,resumed};
}
