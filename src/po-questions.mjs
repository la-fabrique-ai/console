import { fail, text, writeJSON, withLock } from './common.mjs';
import { now } from './state.mjs';
import { terminalId, terminalState, ownedTerminal } from './terminals.mjs';
import { PO_STEPS, PO_GATES, poGateNext } from './po-method.mjs';

// The questions of a PO to the user, and the answers of the user to a PO, through the tool rather than the screen
// of the terminal: the PO runs `po-ask` (a command given in its launch context) with the question and its
// exact answers; the Inbox shows it as a card; an answer chosen or written there is sent to the PO terminal with
// `hc send`, and only to the terminal that carries the label of that session. `po-ready` says that the PO has
// nothing left to do but wait for the user to close (the stage "À clôturer").
// The five phases: plan, proposed split, development, integration check, closure.
// Only an explicit option approval advances a gate; free text is never inferred as approval.
export { PO_STEPS } from './po-method.mjs';
const ID=/^[a-z0-9][a-z0-9-]{0,31}$/,ASKED_MAX=500,MAX_OPTIONS=4,QUESTION_MAX=500,OPTION_MAX=60,ANSWER_MAX=2000;

export function createPoQuestions({root,loadState,getSession,statePath,readTerminals,herdr}) {
  const liveSession=(state,sessionId)=>{
    const session=getSession(state,sessionId);
    if(session.role!=='po')fail('INVALID_ARGUMENT','Only a PO session asks questions.');
    if(session.stoppedAt)fail('SESSION_STOPPED','This session is over.');
    return session;
  };
  async function ask(input) {
    text(input.sessionId,'sessionId',200);
    if(typeof input.id!=='string'||!ID.test(input.id))fail('INVALID_ARGUMENT','Invalid question id.');
    const question=text(input.question,'question',QUESTION_MAX).trim();
    const options=input.options===undefined?[]:input.options;
    const gate=input.gate??null;
    if(gate!==null&&(typeof gate!=='string'||!Object.hasOwn(PO_GATES,gate)))fail('INVALID_ARGUMENT','Unknown PO gate.');
    if(!Array.isArray(options)||options.length>MAX_OPTIONS)fail('INVALID_ARGUMENT','options: at most four answers.');
    const answers=options.map(o=>{if(typeof o!=='string'||!o.trim()||o.length>OPTION_MAX||/[\r\n\0]/.test(o))fail('INVALID_ARGUMENT','Invalid answer.');return o.trim();});
    if(new Set(answers).size!==answers.length)fail('INVALID_ARGUMENT','Answers must differ.');
    if(gate!==null&&!answers.length)fail('INVALID_ARGUMENT','A gate needs its approval as the first option.');
    return withLock(root,async()=>{
      const state=await loadState(),session=liveSession(state,input.sessionId),current=session.question;
      // An id names one question for good: the same question asked again is the same, a new one needs a new id, so
      // an answer given to a former proposal never applies to the next.
      if(current&&current.id===input.id&&current.text===question&&JSON.stringify(current.options)===JSON.stringify(answers)&&(current.gate??null)===gate)return {asked:true,question:current};
      const used=new Set([...(Array.isArray(session.askedIds)?session.askedIds:[]),...(current?[current.id]:[])]);
      if(used.has(input.id))fail('QUESTION_ID_USED','This id already named another question: give the new question a new id.');
      session.askedIds=[...used,input.id].slice(-ASKED_MAX);
      session.question={id:input.id,text:question,options:answers,askedAt:now(),...(gate===null?{}:{gate})};
      session.readyAt=null;session.updatedAt=now();
      await writeJSON(statePath,state);
      return {asked:true,question:session.question};
    });
  }
  async function answer(input) {
    text(input.sessionId,'sessionId',200);
    if(typeof input.id!=='string'||!ID.test(input.id))fail('INVALID_ARGUMENT','Invalid question id.');
    const reply=text(input.text,'text',ANSWER_MAX).trim();
    text(input.askedAt,'askedAt',64);
    return withLock(root,async()=>{
      const state=await loadState(),session=liveSession(state,input.sessionId);
      // The answer names the question it was given to by its id and the time it was asked: an id seen again later
      // (after the history of ids moved on) never takes an answer meant for an earlier question.
      if(!session.question||session.question.id!==input.id||session.question.askedAt!==input.askedAt)fail('QUESTION_GONE','This question no longer waits for an answer.');
      const option=input.optionIndex;
      if(option!==undefined&&(!Number.isInteger(option)||option<0||option>=session.question.options.length||session.question.options[option]!==reply))fail('INVALID_ARGUMENT','The selected option must match its exact answer.');
      // The terminal that carries the label of this session, and no other, with no label of another work.
      let terminal=ownedTerminal(await readTerminals(),session),status=terminalState(terminal);
      // A done PO ended its turn and waits too. hc cannot guard done at typing time:
      // reread status and ownership immediately before sending; idle retains its atomic --if guard.
      // The remaining gap between the hc observation and the send process is unavoidable
      // with the current API (no --if done); this window is explicitly accepted.
      if(status==='done'){terminal=ownedTerminal(await readTerminals(),session);status=terminalState(terminal);}
      if(status==='historical')fail('TERMINAL_GONE','The terminal of this PO is gone: relaunch the PO from the issue.');
      if(status!=='idle'&&status!=='done')fail('QUESTION_STALE','The PO is not waiting for this answer now. Read its terminal.');
      // The answer is data: after `--`, a text that starts with a dash is never read as an option of hc.
      try{await herdr.send(terminalId(terminal),reply,{ifIdle:status==='idle'});}
      catch{fail('SEND_FAILED','The answer could not be delivered to the PO terminal. Read the terminal before sending it again.');}
      const gate=session.question.gate;
      const next=option===0?poGateNext(gate,session.step):null;
      if(next) {
        if(next!==session.step){session.step=next;session.stepAt=now();}
        if(gate==='check'){session.readyAt=now();session.stepAt=session.readyAt;}
        else session.readyAt=null;
      }
      session.question=null;session.answeredAt=now();session.updatedAt=now();
      await writeJSON(statePath,state);
      return {sent:true,terminalId:terminalId(terminal)};
    });
  }
  async function ready(input) {
    text(input.sessionId,'sessionId',200);
    return withLock(root,async()=>{
      const state=await loadState(),session=liveSession(state,input.sessionId);
      session.readyAt=now();session.question=null;session.step='close';session.stepAt=session.readyAt;session.updatedAt=now();
      await writeJSON(statePath,state);
      return {ready:true,readyAt:session.readyAt};
    });
  }
  async function step(input) {
    text(input.sessionId,'sessionId',200);
    if(!PO_STEPS.includes(input.step))fail('INVALID_ARGUMENT','Unknown step: plan, split, dev, check or close.');
    return withLock(root,async()=>{
      const state=await loadState(),session=liveSession(state,input.sessionId);
      // A PO that goes back to an earlier step after saying all was ready has resumed: it is no longer to close.
      const resumed=input.step!=='close'&&Boolean(session.readyAt);
      if(session.step!==input.step||resumed){if(resumed)session.readyAt=null;session.step=input.step;session.stepAt=now();session.updatedAt=now();await writeJSON(statePath,state);}
      return {step:session.step,stepAt:session.stepAt};
    });
  }
  return {ask,answer,ready,step};
}
