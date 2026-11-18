import {connectorAgentContext} from '../integrations/tickets/factory.mjs';
import { join, dirname } from 'node:path';
import { readFile, writeFile, rename, mkdir, stat } from 'node:fs/promises';
import { fail, patientLock } from './common.mjs';
import { checkBudgets, budgetBlocks } from './mission-budgets.mjs';
import { createDevLane, launchedBefore, validLane } from './dev-lane.mjs';
import { createQuestionRegistry } from './questions.mjs';
import { createRequestRegistry } from './requests.mjs';
import { createConversation, unstick, once, surely, STILL_MS } from './conversation.mjs';
import { askHint, blockHint, stopToLead, STUCK } from './agent-texts.mjs';
import { isLead } from './state.mjs';
import { createMissionRegistry, stopAfterOf, missionActive, approvedOnly, copyRefusal, NOT_APPROVED, launchSettled, noteDrift, noteSeen, withEnvironment, devStarted } from './mission.mjs';
import { poSpace } from './po-launch.mjs';
import { leadLock, CLOSED_KEPT } from './lead-wake.mjs';
import { planRows, hasPlan } from './plan.mjs';
import { T } from '../ui/v3/texts.js';
import { W } from '../ui/v4/words.js';
import { devFlow, reviewerFor, reviewTask, fixMessage, reportAsk, validationAsk, qaTask, serverOfPlan, devTask, devArgv, poTab, ownValue, stepOf } from '../ui/v3/view.js';

// The chain of the devs of an issue, run by the watcher (lot 1 of v3-equipe): it no longer needs the Issue page open.
// Every few seconds, for each mission whose devs were launched: read the reports of its agents, launch the review of a
// dev that reported, send the findings back to a dev to fix, close the tabs of a ticket accepted, ask once for a
// missing report, launch the next ticket of the plan, then the QA agent and the Validation when every ticket developed
// in this delivery is accepted.
//
// The tickets, their order and what each waits for come from the plan its Lead recorded in the mission (v2), and from
// nothing else. One dev at a time: the next ticket starts when the one before is accepted and merged into the branch
// of the issue, and its dev seen stopped. A mission without a recorded plan is of the old format, or not planned yet:
// nothing of it is run.
// The tabs of the reviewers and of the QA are made in the window (src/herdr.mjs, `window`); the tab the user looks at is shown
// again after a launch. The dev is not: it is a terminal of herdr-core, asked for by the lane of the mission and by
// nothing else (dev-lane.mjs), found by its address, and stopped by the lane.
//
// A launch and a step of the chain run under the lock of the lane of their mission, from their first reading to their
// last writing: `launch` and `tick` take it, and what runs under it (`launchLocked`, `tickLocked`) never does.
//
// Each action is claimed once (a key, under a lock, in <root>/state/devchain-<mission>.json), so the watcher and a
// click on the page never do the same thing twice. The same file keeps the lane, and the story the page shows.
const EFF=['','low','medium','high'],LOG_MAX=60,DETAIL_EVERY_MS=60000;
// A reviewer whose tab is gone this long after its launch, without a verdict, was cut: launched again, this many times at
// most (ticket M9). Less than that, the window may only be slow to show a tab just made.
const REVIEW_GRACE_MS=60000,REVIEW_AGAIN_MAX=2;
// How long a reviewer whose launch was lost may take to show before its absence is said in the Inbox (M9 review 3).
const REVIEW_UNSEEN_MS=5*60000;
const BASE_LINE=/^\s*(?:[-*]\s*)?(?:\*\*)?(?:Branche de base|Base)(?:\*\*)?\s*:\s*`?([A-Za-z0-9._\/-]{1,120})`?\s*$/mi;
const DEV_TAB=/^([A-Z][A-Z0-9]*-\d+) · dev$/,WORK_NAME=/^(?:QA · )?([A-Z][A-Z0-9]*-\d+)(?: · (?:dev|revue(?: \d)?))?$/,WORK_TAB=/^[A-Z][A-Z0-9]*-\d+ · (dev|revue)/;
export const baseOfPlan=description=>BASE_LINE.exec(String(description||''))?.[1]||null;
const clock=(d=new Date())=>String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0');
const agentName=tool=>ownValue(T.issue.agentName,tool)||tool;

// What a ticket took (lot 6), from the times the chain claimed its steps: dev (launch to first report), rounds of
// review (reports reviewed), fixes asked, review (last report to acceptance), all (launch to acceptance). Minutes.
export function metricsOf(done){
  const out={},min=ms=>Math.max(0,Math.round(ms/60000));
  for(const [key,at] of Object.entries(done||{})){
    // A mark without a time is work taken up from its reports: nobody knows how long it took.
    const [kind,ticket]=key.split('|');if(typeof at!=='number'||!ticket||!/^[A-Z][A-Z0-9]*-\d+$/.test(ticket))continue;
    const m=out[ticket]||(out[ticket]={launched:null,reports:[],fixes:0,accepted:null});
    if(kind==='dev')m.launched=at;else if(kind==='done')m.reports.push(at);else if(kind==='fix')m.fixes++;else if(kind==='ok')m.accepted=m.accepted==null?at:Math.max(m.accepted,at);
  }
  for(const [ticket,m] of Object.entries(out)){
    const reports=m.reports.sort((a,b)=>a-b),first=reports[0],last=reports.at(-1);
    out[ticket]={rounds:reports.length,fixes:m.fixes,devMin:m.launched!=null&&first!=null?min(first-m.launched):null,reviewMin:m.accepted!=null&&last!=null?min(m.accepted-last):null,totalMin:m.launched!=null&&m.accepted!=null?min(m.accepted-m.launched):null};
  }
  return out;
}
// The time of each step of a ticket (ticket M8), in the order the page draws them (ui/v4/line.js, timelineOf): its dev,
// then, delivery after delivery, each review whose verdict is known, with the fix after the reviews that asked for
// changes, then the reviews of its last delivery still under way. The steps come from the marks the chain keeps for
// good, not from the reports: an agent replaces its file at every round (src/dev-report.mjs), the marks stay. dev|…
// (the dev asked of the core), done|<ticket>|<commit>|<at> (a delivery seen, one per round), rev|… (a reviewer
// launched), verdict|… (its verdict seen; the acceptance, the fix sent or the dev found gone, seen in the same pass,
// end it as well), fix|… (the corrections sent), notab|… (no dev to send them to). The reports still on disk only add
// what no mark says (a verdict taken up without its mark, a delivery not marked yet). Each time is the difference of
// the minutes of the clock at its two instants, as the journal writes its hours and minutes: both always agree. A step
// under way runs to `now`. A mark without a time (work taken up from its reports), or none, gives the step no time
// (null): nothing is invented. A watcher started again finds the same marks: a step keeps its start, and is counted
// once. Each review and fix names its delivery (`commit`, and `delivered`, the time of its file), the dev step none:
// the page ties a time to the round its line belongs to, never to the place of the line (decision 90). Each review whose
// verdict is known says it (`verdict`, ticket M9), from said|… (the verdict the chain saw, kept for good): the trace of
// the reviews keeps every round, though each file holds only the last.
const TICKET=/^[A-Z][A-Z0-9]*-\d+$/,JUDGED=['accepted','changes_requested'];
// How many remarks a review numbered, by the rule of the page (ui/v4/nav.js, reportDigest: two numbered marks at least,
// « (1) … (2) … »), which the engine cannot load: kept for good with its round (M9 review, E4), its file replaced after.
export function remarkCount(text) {
  const marks=[...String(text||'').replace(/\s+/g,' ').trim().matchAll(/(?:^|[\s:;])\((\d)\)\s+/g)];
  return marks.length>=2?marks.length:0;
}
export function timingsOf(done,reports,{now=Date.now()}={}) {
  const marks=done||{},list=Array.isArray(reports)?reports:[],out={};
  const time=v=>typeof v==='number'&&Number.isFinite(v)?v:null,minute=ms=>Math.floor(ms/60000),has=k=>marks[k]!==undefined;
  const span=(from,to)=>from!=null&&to!=null&&to>=from?minute(to)-minute(from):null;
  const ticketOf=k=>k.split('|')[1];
  const ids=new Set([...Object.keys(marks).filter(k=>k.startsWith('dev|')||k.startsWith('done|')).map(ticketOf),...list.map(r=>r?.ticket)]);
  for(const id of ids){
    if(typeof id!=='string'||!TICKET.test(id))continue;
    const own=list.filter(r=>r&&r.ticket===id&&!r.unreadable&&r.at);
    // Each delivery once, by its commit and the time of its file: every one the chain marked, and the one on disk.
    const deliveries=new Map(),head='done|'+id+'|';
    for(const k of Object.keys(marks))if(k.startsWith(head)){const rest=k.slice(head.length),cut=rest.indexOf('|');if(cut>0)deliveries.set(rest,{commit:rest.slice(0,cut),at:rest.slice(cut+1)});}
    for(const r of own)if(r.kind==='dev'&&r.commit&&!deliveries.has(r.commit+'|'+r.at))deliveries.set(r.commit+'|'+r.at,{commit:r.commit,at:String(r.at)});
    const devs=[...deliveries.values()].sort((x,y)=>String(x.at).localeCompare(String(y.at)));
    if(!has('dev|'+id)&&!devs.length)continue;
    const of=d=>id+'|'+d.commit+'|'+d.at,seen=d=>time(marks['done|'+of(d)]);
    const steps=[{step:'dev',minutes:span(time(marks['dev|'+id]),devs.length?seen(devs[0]):now)}],running=[];
    devs.forEach((d,i)=>{
      const next=devs[i+1]||null,k=of(d),round={commit:d.commit,delivered:d.at},accepted=has('ok|'+id+'|'+d.commit),fix=has('fix|'+k)||has('notab|'+k);
      // The report of a review on disk counts for this delivery when it is on its commit and came after it, before the
      // next one (ui/v3/view.js, devFlow).
      const report=n=>own.find(r=>r.kind==='review-'+n&&JUDGED.includes(r.verdict)&&r.commit===d.commit&&String(r.at)>=String(d.at)&&(!next||String(r.at)<String(next.at)))||null;
      const ends=[marks['ok|'+id+'|'+d.commit],marks['fix|'+k],marks['notab|'+k]].map(time).filter(v=>v!=null);
      const judged=[];let asked=fix;
      for(const n of ['1','2']){
        const launched=marks['rev|'+k+'|'+n],r=report(n),verdict=has('verdict|'+k+'|'+n);
        if(launched===undefined&&!r)continue;
        if(r?.verdict==='changes_requested')asked=true;
        if(verdict||r||accepted||fix){
          const end=[time(marks['verdict|'+k+'|'+n]),...ends].filter(v=>v!=null);
          // Its verdict (ticket M9): the one the chain kept when it saw it, else its report on disk, else the acceptance
          // of its round; nothing else tells it (a verdict seen before the chain kept it, its file replaced since): null.
          const said=marks['said|'+k+'|'+n],word=JUDGED.includes(said)?said:r?.verdict||(accepted?'accepted':null);
          // What the chain kept of it besides (M9 review): the number of remarks of a review that asked for changes
          // (E4), and the verdict the user decided when the reviewer left it to him, with its provenance (E5).
          const remarks=marks['remarks|'+k+'|'+n],decided=marks['decided|'+k+'|'+n];
          judged.push({step:'review-'+n,minutes:span(time(launched),end.length?Math.min(...end):null),verdict:word,end:end.length?Math.min(...end):Infinity,
            ...(word==='changes_requested'&&Number.isInteger(remarks)&&remarks>0?{remarks}:{}),...(decided&&typeof decided.answer==='string'?{decided:{by:decided.by,role:decided.role,answer:decided.answer}}:{})});
          // A verdict seen, the ticket not accepted, and a new delivery after it: changes were asked.
          if(verdict&&!accepted&&next)asked=true;
        }
        else if(!next)running.push({step:'review-'+n,minutes:span(time(launched),now),...round});
      }
      for(const j of judged.sort((x,y)=>x.end-y.end))steps.push({step:j.step,minutes:j.minutes,...round,verdict:j.verdict,...(j.remarks?{remarks:j.remarks}:{}),...(j.decided?{decided:j.decided}:{})});
      // One fix for a delivery, however many of its reviews asked for changes: from the corrections sent to the next
      // delivery seen. Corrections never sent (no dev to send them to, the message failed) have no start.
      if(judged.length&&asked)steps.push({step:'fix',minutes:span(time(marks['fix|'+k]),next?seen(next):now),...round});
    });
    out[id]=[...steps,...running];
  }
  return out;
}
// The last launch of the QA agent of a mission, as its chain claimed it (qa|<tickets>): a correction ticket brings a new
// one. A launch taken up from the reports has no time: launched, at an hour nobody knows. Never launched: null.
export function qaLaunchOf(done) {
  const keys=Object.entries(done||{}).filter(([key])=>key.startsWith('qa|'));
  if(!keys.length)return null;
  const times=keys.map(([,at])=>at).filter(at=>typeof at==='number'&&Number.isFinite(at));
  return {launchedAt:times.length?new Date(Math.max(...times)).toISOString():null};
}
// Whether a commit and all the work under it are on a branch: in its history, or brought there by a rebase (each change
// found again under another hash). Anything that cannot be read answers no: what is not proven stays unproven.
export function gitOnBranch({invoke}) {
  return async({path,commit,branch})=>{
    if(!/^[0-9a-f]{7,64}$/.test(String(commit))||typeof branch!=='string'||!branch||branch.startsWith('-'))return false;
    const git=args=>invoke('git',['-C',path,...args],{timeout:30000});
    try{await git(['merge-base','--is-ancestor',commit,branch]);return true;}catch{}
    try{
      // A merge carries changes of its own that a comparison of patches does not see: with one in the way, nothing is proven.
      if((await git(['rev-list','--merges','--max-count=1',branch+'..'+commit])).stdout.trim())return false;
      const lines=(await git(['cherry',branch,commit])).stdout.trim().split('\n').filter(Boolean);
      return lines.length>0&&lines.every(line=>/^- [0-9a-f]{7,64}$/.test(line));
    }catch{return false;}
  };
}
// What the reports of a mission taken up prove is done, as the marks of the chain: nothing that happened is launched,
// merged or announced again. What they do not prove stays to do: a dev report without its review gets its review, a
// ticket with a folder of its own and not yet on the branch of the issue goes through the merge, and the checks run again
// unless the report of the QA came after the last review of every ticket. A ticket neither on the branch nor in a folder
// stays accepted: nobody can merge it from here, and nothing says it was.
export function historyMarks(rows,flow,{step,proven=new Set(),hasFolder=()=>false,qaAt=null}) {
  const timed=at=>Date.parse(at||'')||true,marks=[];
  for(const r of rows) {
    const f=flow[r.id];if(!f?.dev)continue;
    const c=f.dev.commit,at=f.dev.at||'';
    marks.push(['dev|'+r.id,true],['done|'+r.id+'|'+c+'|'+at,timed(f.dev.at)]);
    // A verdict taken up was not seen now: a mark without a time, and its review has no time (ticket M8).
    f.reviews.forEach((v,n)=>{if(v)marks.push(['rev|'+r.id+'|'+c+'|'+at+'|'+(n+1),true]);if(v?.verdict)marks.push(['verdict|'+r.id+'|'+c+'|'+at+'|'+(n+1),true]);if(JUDGED.includes(v?.verdict))marks.push(['said|'+r.id+'|'+c+'|'+at+'|'+(n+1),v.verdict]);if(v?.verdict==='changes_requested'&&remarkCount(v.summary))marks.push(['remarks|'+r.id+'|'+c+'|'+at+'|'+(n+1),remarkCount(v.summary)]);});
    if(f.stage==='accepted') {
      marks.push(['ok|'+r.id+'|'+c,timed(f.reviews.at(-1)?.at)]);
      if(proven.has(r.id))marks.push(['merge|'+r.id+'|'+c,true],['merged|'+r.id+'|'+c,true]);
      else if(!hasFolder(r.id))marks.push(['merge|'+r.id+'|'+c,true]);
    }
  }
  const checked=r=>flow[r.id]?.dev?flow[r.id].stage==='accepted'&&flow[r.id].reviews.every(v=>String(v?.at||'')<=qaAt):closed(r);
  const due=dueOf(rows);
  if(['qa','validating'].includes(step)&&qaAt&&due.length&&due.every(checked)) {
    const set=due.map(r=>r.id).join(',');
    marks.push(['qa|'+set,true],['validation|'+set,true],['check|'+set,true]);
  }
  return marks;
}
// Texts: the macOS notification (wording by Codex, chosen by the user, 2026-11-09), the note to the PO for the tracker.
const N={title:id=>'FABRIQUE_CONSOLE · '+id,waits:name=>'Reply needed: '+name};
// A line of the note (decision 61): references only, the ticket, the code of the situation and, where there is more to
// say, the file that keeps it (the chain's own file, whose journal has the detail). Nothing of a text the chain did not
// write itself goes into a line: the reason git gives, the names of files in conflict stay in the journal. A line of
// another form (a {note} of an older version) gives null: it is kept aside, never sent.
const TICKET_ID=/^[A-Z][A-Z0-9]{0,9}-\d{1,7}$/,HEX=/^[0-9a-f]{7,64}$/,CODE=/^[A-Z][A-Z0-9_]{1,40}$/;
const NOTES={
  canceled:()=>'annulé dans le tracker, son dev est arrêté ; la série continue sans lui',
  reported:x=>'dev rendu'+(HEX.test(String(x.commit))?' (commit '+x.commit.slice(0,8)+')':'')+', revue lancée',
  conflict:(x,file)=>'conflit en fusionnant sa branche dans celle de l\'issue, à résoudre avec le propriétaire ; les fichiers en conflit sont dans '+file+' (journal)',
  refused:(x,file)=>'fusion refusée'+(CODE.test(String(x.reason))?' ('+x.reason+')':'')+' ; la raison est dans '+file+' (journal). Répare-la si tu peux, sinon remonte-la au propriétaire.',
  accepted:x=>'accepté par la revue'+(x.notes===true?' (remarques notées pour la Validation)':''),
  fixing:()=>'corrections demandées par la revue, renvoyées au dev',
};
const codeOf=error=>{const named=String(error?.code??'');return CODE.test(named)?named:null;};
export function noteLine(entry,file) {
  if(!entry||typeof entry!=='object'||!TICKET_ID.test(String(entry.ticket))||!Object.hasOwn(NOTES,entry.kind))return null;
  return entry.ticket+' : '+NOTES[entry.kind](entry,file);
}
// A report as a task names it (decision 61): its summary is the path of its file, never its words; its commits and
// repositories only when they are such (a hash, a name of folder), else nothing.
const REPO=/^(?:\.|[\w.-]{1,100}(?:\/[\w.-]{1,100}){0,4})$/;
const hex=value=>HEX.test(String(value))?value:null,repoOf=value=>typeof value==='string'&&REPO.test(value)&&!value.split('/').some(part=>/^\.\.?$/.test(part)&&value!=='.')?value:null;
export function asRead(report,path) {
  if(!report)return report;
  const repositories=(Array.isArray(report.repositories)?report.repositories:[]).map(x=>({repo:repoOf(x?.repo),commit:hex(x?.commit),baseCommit:hex(x?.baseCommit)})).filter(x=>x.repo&&x.commit&&x.baseCommit);
  return {...report,commit:hex(report.commit),baseCommit:hex(report.baseCommit),repo:repoOf(report.repo),repositories,summary:'dans '+path+' (champ summary)'};
}
// A macOS notification, best effort: a failure never stops the chain. It answers whether it was shown (false: it failed).
export function macNotify({invoke}){
  const quote=t=>'"'+String(t).replace(/[\\"]/g,' ').slice(0,200)+'"';
  return async(title,text)=>{try{await invoke('/usr/bin/osascript',['-e','display notification '+quote(text)+' with title '+quote(title)],{timeout:10000});return true;}catch{return false;}};
}
// What a mission without the plan of its Lead is answered, before anything is written.
const OLD_FORMAT='This mission has no plan recorded by its Lead (lead-plan): it is of the old format, or not planned yet. Nothing was launched and nothing was changed. Record its plan first.';
// Told to the Lead when a dev is asked before the user approved the plan (ticket M5): the gate is src/mission.mjs's.
export { NOT_APPROVED };
// Told to the agent that asks for the first dev of a mission whose project declares an environment that is not green
// (decision 111), in French; provisional words, to be written by Codex.
export const ENVIRONMENT_HELD='Lancement refusé : l’environnement du projet n’est pas prêt (son contrôle n’est pas vert). le propriétaire doit relancer le contrôle sur l’écran Prepare. Rien n’est lancé ; ne relance pas le contrôle toi-même.';
const closed=r=>['completed','canceled'].includes(r.state?.type),canceled=r=>r.state?.type==='canceled';
// The steps of a mission before any dev of it is launched.
const BEFORE_DEVS=['requested','delegated','analysing'];
// The refusals of the gate of every launch of a dev, said in the journal of the mission once per ticket and approval:
// no approval, a ticket outside its frozen copy (decision 77), or asked with another tool, model or effort than the
// approved ones (M7 review).
const GATE=['NOT_APPROVED','NOT_IN_COPY','COPY_CHANGED','NOT_AS_APPROVED'];
const GATE_REASON={NOT_IN_COPY:'not-in-copy',COPY_CHANGED:'copy-changed',NOT_AS_APPROVED:'not-as-approved'};
// The journal of a launch, in the words of decision 87: a launch failed before any dev (its code in parentheses, none
// without a code), a launch whose fate was unknown checked by what proves it (the ticket sequence on, or the stage of
// the mission past Prepare; never « the dev left »), or checked not started; a launch the gate blocks, never said
// failed, with its reason in the words of the interface (the agent is told its own, in French: src/mission.mjs, COPY).
// The stage of a mission past Prepare, by its step, as the bar of the page names it.
const STAGE={building:1,qa:1,validating:2,validated:3,closed:3};
export const JOURNAL={
  notStarted:code=>'Launch failed'+(code?' ('+code+')':'')+'. No dev was started. You can request the launch again.',
  sequence:'Launch checked: the ticket sequence is enabled.',stage:stage=>'Launch checked: the mission is in '+stage+'.',
  noStart:'Launch checked: no dev start was recorded. You can request the launch again.',
  blocked:ticket=>'Launch blocked for '+ticket+'.',
  refused:{NOT_IN_COPY:'This ticket is not covered by your approval.',COPY_CHANGED:'This ticket differs from its approved version.',NOT_AS_APPROVED:'The requested tool, model or effort differs from your approval.'}};
// The key a refusal is said once by: its code, its ticket and the approval it was refused under. A mission that could
// not be read gives none: nothing is said now, the next pass says it (never twice under two keys, M7 review).
export const gateKey=(error,ticket,mission)=>mission?'refused|'+error.code+'|'+ticket+'|'+(mission.approval?.at||''):null;
// A sub-ticket as the chain records it in its mission, and as the gate compares it with the copy: one rule for both.
const ticketOfRow=r=>({title:r.content||null,level:r.level||null,dev:r.agent||null,model:r.model||null,effort:EFF[r.effort]||null,deps:r.waits||[]});
// The tickets that count for the end of a delivery: those developed in it (a ticket of design, deferred, associated or
// integrated by another one is not), and a sub-ticket the plan does not name, unless it is kept out of the copy
// (`outside`, decision 84): such a one never starts, so it holds neither the end nor a launch; whether to cancel it in
// the tracker stays the user's call, and nothing here touches it.
const dueOf=rows=>rows.filter(r=>r.here!==false&&!r.keptOut);
// Decision 85: a ticket kept out whose dev the lane still holds (launched before the reapproval that removed it) is
// never reviewed nor merged, whatever it reports; the delivery waits until its dev stops, and its work stays on its
// branch and in its folder (stopping a dev never removes them).
const keptOutHeld=(rows,lane)=>rows.some(r=>r.keptOut&&lane?.ticket===r.id);
// What proves that the turn of a dev is over (decision 86): an explicit list, never "anything but working".
const TURN_OVER=['idle','done','blocked'];
// The pause of a mission (M11, decisions 32 and 43): asked (`requested`, the agent at work finishes its turn) or
// effective (`paused`, nothing runs), with the instant it was asked; null is no pause.
const ISO=x=>typeof x==='string'&&Number.isFinite(Date.parse(x));
// `agents` / `unreadable` (M11 review 2): the state of the agents could not be read at all (Herdr, the lane, the tracker
// failed the pass), dated from the instant the pause was asked.
const WAIT_ROLES=['dev','reviewer','qa','agents'],WAIT_WHY=['working','unknown','not-seen','foreign','unreadable'];
const validWait=w=>Boolean(w)&&typeof w==='object'&&WAIT_ROLES.includes(w.role)&&WAIT_WHY.includes(w.why)&&(w.ticket===null||typeof w.ticket==='string')&&ISO(w.since);
const validPause=p=>p===null||(Boolean(p)&&typeof p==='object'&&!Array.isArray(p)&&['requested','paused'].includes(p.state)&&ISO(p.at)&&(p.pausedAt===undefined||ISO(p.pausedAt))&&(p.waiting===undefined||(Array.isArray(p.waiting)&&p.waiting.every(validWait))));
// What keeps a pause asked (M11 review 1): what may still run, each with the instant it was first seen. One that is not
// an agent seen at work (a launch not confirmed, a state not known, a terminal not the dev) for five minutes raises an
// alert on the page; the pause is never made effective on a delay.
const PAUSE_ALERT_MS=5*60000;
// The refusal of a launch in pause, to the Lead, in French like the other refusals of a launch (texts of Codex, decision
// 110). The pause is said in the journal (« Recent activity », decision 106 point 6), once each, at its instant: asked,
// effective, lifted (texts of Codex, decision 110). A pause is offered in Develop only
// (decision 106 point 7): asked out of it (a Validation made just before it), it is refused and nothing is written.
const PAUSE_LOG={requested:'Pause requested',paused:'Paused',resumed:'Resumed'};
const PAUSE={notDevelop:'Pause is only available in Develop. The mission was not paused.',refused:'Lancement refusé : la mission est en pause. Rien n\'a été lancé. Attends que le propriétaire clique sur « Resume ».',
  steps:'Changement d\'étape refusé : la mission est en pause. Rien n\'a été modifié. Attends que le propriétaire clique sur « Resume ».',
  // A QA agent asked of the window whose tab never showed (M11 review 1): never made again before it shows.
  qaUnsure:'QA launch not confirmed. No second QA agent started.'};
const LEAD_SEEN_MS=60000,JOURNAL_SHORT=10;
// Chantier 1 (lot 1B, point 31): a Lead idle this long in Develop or Validate is put to rest, its tab closed. It is woken
// again, fresh, by the next message it must read (lead-wake.mjs). Never in Prepare, where the user talks with it.
export const LEAD_REST_MS=15*60000;
// A watcher silent longer than this has not seen the Lead: its idle time starts over (restarts, pauses of the watcher).
const LEAD_GAP_MS=5*60000;
// What happened since the Lead last woke, at the end of the next message it must read (lot 1B): no progress note on a
// timer any more. The lines are made by noteLine from references only (decision 61).
export const withNews=(text,lines)=>lines.length?text+'\n\nPour mémoire, depuis ton dernier réveil (rien à faire de plus, ni dans le tracker) : '+lines.join(' · ')+'.':text;
// A merge refused or in conflict waits for the Lead (lot 1B): it is told at once, with the other lines kept, when it is
// not busy (or woken from its rest). Every other line waits for its next wake.
const URGENT=new Set(['conflict','refused']);
export const actionNote=lines=>'À traiter (une fusion attend ton action ; le reste est pour mémoire, rien à écrire dans le tracker) : '+lines.join(' · ')+'.';
const REST={rested:'Lead mis au repos (inactif depuis 15 min) ; il sera relancé au prochain besoin',failed:'Le Lead n\'a pas pu être mis au repos'};
const validIdle=x=>Boolean(x)&&typeof x==='object'&&!Array.isArray(x)&&typeof x.terminal==='string'&&Number.isFinite(x.since)&&(x.seen===undefined||Number.isFinite(x.seen));
// What the lane of the devs says when it stops (provisional texts, to be written by Codex): to the caller of a
// command, and in the Inbox, once.
const LANE={
  unreadable:'The state of the dev chain of this mission cannot be read. Nothing is launched until its file is repaired.',
  tracker:'The tracker could not be read. Nothing was launched.',
  old:'This mission was started before the current dev series. The tool launches and stops none of its devs.',
  oldTitle:'Dev series on hold',oldRecommendation:'Stop its dev terminals by hand, close this mission, and take what is left of its work up in a new mission.',
  doubtTitle:ticket=>'Dev not confirmed · '+ticket,doubt:'A dev was asked for this ticket and its terminal is not there. Nothing is tried again on its own.',doubtRecommendation:'Launch its dev again.',
  doubtCanceledRecommendation:'To skip this canceled ticket, reopen it in the tracker, launch its dev again, then cancel it again. The series will continue once its dev is confirmed stopped.',
  foreignTitle:'Unexpected dev terminal',foreign:'A terminal runs under the name of the dev of this mission and is not the dev the series knows. No dev is launched or stopped meanwhile.',foreignRecommendation:'Close that terminal, or let it end.'};
// What the journal says of a ticket stopped (M10): « PRB-149 stopped, Lead called » in the words of the mockup (screen
// 12, decision 43); the others, and the title of the stop in the Inbox when no migration is named, are provisional texts.
// A mission held at the end of Develop, as the user asked (chantier 1, point 16): said once in the journal and notified
// (provisional texts, to be written by Codex).
const HELD={log:'Develop finished · stopped here as asked: no QA, no Validation',notify:'Develop finished. Stopped here as you asked.'};
const STOP_LOG={stopped:ticket=>ticket+' stopped, Lead called',goes:ticket=>ticket+' running again',leadFailed:ticket=>ticket+' stopped: the Lead could not be told',leadUnsure:ticket=>ticket+' stopped: message to the Lead not confirmed, not sent again',
  title:ticket=>ticket+' is stopped',migrationTitle:migration=>'Migration '+migration+' fails locally',
  // The tries of the Lead (screen 12); failsAgain, for a stop that is not a migration, is not on the mockup (text of Codex, decision 110).
  migrationAgain:ticket=>ticket+': the migration fails again',failsAgain:ticket=>ticket+': the same failure again',
  tryRunning:(n,text)=>'Lead: try '+n+(text?', '+text:''),lastFails:n=>'Lead: try '+n+' fails, asks you'};
const SPACE_FAILED='L\'espace Herdr de la mission n\'a pas pu être créé.';
// The step of a mission that a session of the first version stands at (the Issue page still moves it).
// The refusals of a ticket that are a matter of its turn: the series goes on, and the chain starts it when it comes.
const TURN=['waits','serial','rank','over','already','doubt','blocked','old'];
// The code a launch not started is said with: the reason of a refusal for good (not-in-copy: NOT_IN_COPY), else the
// failure of the ticket itself before the core was asked.
const refusalCode=reason=>/^[a-z]+(-[a-z]+)*$/.test(String(reason||''))?String(reason).toUpperCase().replaceAll('-','_'):'TICKET_FAILED';
// Something said once in the journal: claimed, then said; said or not, it never fails what asked for it. A journal that
// fails gives the claim back, for the next pass to say it.
export async function sayOnce({claim,unclaim,say},key){
  try{
    if(!await claim(key))return false;
    try{await say();return true;}catch{await Promise.resolve().then(()=>unclaim(key)).catch(()=>{});return false;}
  }catch{return false;}
}
export function createDevChain({root,loadState,loadConfig=async()=>({}),invoke,herdr,kernel=herdr.kernel,lock=undefined,wait=undefined,detail,reports,send,ensureWorktree,ticketBranch=null,ticketMerge=null,setStep,window=herdr.window,notify=macNotify({invoke}),now=Date.now,missions=createMissionRegistry({root,now}),questions=createQuestionRegistry({root,now,loadConfig}),inbox=createRequestRegistry({root,now,notify,questions,missions,loadConfig}),leadLaunch=null,restLock=leadLock,validation=null,onBranch=gitOnBranch({invoke}),environment=null,environmentHold=null,budgetCheck=null}) {
  const conversation=createConversation({questions,inbox,send,leadLaunch,now});
  // Every agent is told how to ask rather than guess, when the command to report with is known; a dev, how to say that
  // its ticket stopped (M10).
  const withAsk=async(task,{cmd,...where})=>task+'\n\n'+connectorAgentContext(await loadConfig()).instructions+(cmd?'\n'+askHint({cmd,...where})+(where.from==='dev'?'\n'+blockHint({cmd,...where}):''):'');
  const dir=join(root,'state'),lockDir=join(root,'state','devchain');
  const file=id=>join(dir,'devchain-'+id+'.json');
  const safe=id=>{if(typeof id!=='string'||!/^[\w.-]{1,200}$/.test(id))fail('INVALID_ARGUMENT','sessionId is required.');return id;};
  // The state of a chain, read strictly: no file is a mission nothing was launched for; a file that cannot be read, or
  // is not what the chain writes, blocks (nothing is decided on an empty state made up in its place). A file without
  // a lane that carries a launch is of a mission started by the mechanism of before (`old`): its lane is not guessed.
  // `pause` (M11): null, or the pause the user asked for, {state:'requested'|'paused',at,pausedAt?}, kept here for good:
  // it holds after the tool starts again (decision 32).
  const empty=()=>({done:{},log:[],seen:{},paths:{},bases:{},on:false,digest:[],withheld:[],digestAt:0,settled:false,lane:null,laneSeq:0,old:false,pause:null,leadIdle:null});
  async function load(id){
    let raw,d;
    try{raw=await readFile(file(id),'utf8');}catch(error){if(error.code==='ENOENT')return empty();fail('INVALID_DATA',LANE.unreadable);}
    try{d=JSON.parse(raw);}catch{fail('INVALID_DATA',LANE.unreadable);}
    const plain=x=>Boolean(x)&&typeof x==='object'&&!Array.isArray(x),maybe=(x,ok)=>x===undefined||ok(x);
    // A pause the file says wrongly is never taken for no pause (M11): the chain stops there, as for any other field.
    if(!plain(d)||![d.done,d.seen,d.paths,d.bases].every(x=>maybe(x,plain))||![d.log,d.digest,d.withheld].every(x=>maybe(x,Array.isArray))||!maybe(d.lane,validLane)||!maybe(d.pause,validPause))fail('INVALID_DATA',LANE.unreadable);
    const old=d.lane===undefined&&launchedBefore(d);
    // The budget check kept (lot 1D): only well-formed exclusions are read back, and an episode is an integer.
    const kept=plain(d.budgetCheck)&&Array.isArray(d.budgetCheck.blocked)?d.budgetCheck:{blocked:[],episode:0,unavailable:false};
    const budgetCheck={...kept,blocked:kept.blocked.filter(b=>plain(b)&&typeof b.role==='string'&&(b.ticket==null||typeof b.ticket==='string')&&Array.isArray(b.terminals)&&b.terminals.every(t=>typeof t==='string')),episode:Number.isInteger(kept.episode)?kept.episode:0,unavailable:kept.unavailable===true};
    return {done:d.done||{},log:d.log||[],seen:d.seen||{},paths:d.paths||{},bases:d.bases||{},on:Boolean(d.on),digest:d.digest||[],withheld:d.withheld||[],digestAt:d.digestAt||0,settled:Boolean(d.settled),lane:old?undefined:d.lane??null,laneSeq:Number.isInteger(d.laneSeq)?d.laneSeq:0,old,pause:d.pause??null,leadIdle:validIdle(d.leadIdle)?d.leadIdle:null,budgetCheck};
  }
  // What the page shows of a chain that cannot be read: nothing, rather than no page. Nothing is decided on it.
  const shown_=async id=>{try{return await load(id);}catch(error){if(error.code==='INVALID_DATA')return empty();throw error;}};
  // The file of a mission of the mechanism of before keeps no lane: it stays what it is.
  async function save(id,{old,...data}){await mkdir(dir,{recursive:true});const tmp=file(id)+'.'+process.pid+'.tmp';await writeFile(tmp,JSON.stringify(data)+'\n');await rename(tmp,file(id));}
  const change=(id,fn)=>patientLock(lockDir,async()=>{const d=await load(id);const r=await fn(d);await save(id,d.old?{...d,lane:undefined,laneSeq:undefined}:d);return r;},lock?{lock}:{});
  // True for the one caller that claims the key first.
  // `at`: the instant it is claimed at, the one its line of the journal says (ticket M8).
  const claim=(id,key,at=now())=>change(id,d=>{if(d.done[key])return false;d.done[key]=at;return true;});
  // A mark and the line of the journal it stands for, in one write (M10 review 2): a watcher cut between the two can
  // never leave the mark without its line.
  const claimSay=(id,key,text,tone='ok',detailText='',at=now())=>change(id,d=>{if(d.done[key])return false;d.done[key]=at;d.log=[...d.log,{at:clock(new Date(at)),text,tone,detail:detailText}].slice(-LOG_MAX);return true;});
  // The lane of the devs: the one place a dev terminal is asked for, and the only writer of the lane.
  const lane=createDevLane({root,kernel,load,change,now,...(lock?{lock}:{}),...(wait?{wait}:{})});
  // A line for the next note to the PO (lot 7): {ticket,kind,…}, references only (noteLine).
  const tell=(id,entry)=>change(id,d=>{d.digest=[...d.digest,entry].slice(-30);});
  // The lines kept since the Lead last woke (lot 1B) are told with its next message, never on a timer; a line of another
  // form (a queue left by an older version) is kept aside (withheld), never sent.
  // A Lead put to rest by the chain (lot 1B): its session lives on, its terminal is gone until it is needed again.
  const rested=(m,s)=>s?.role==='lead'&&Boolean(m?.lead?.restedAt)&&m.lead.sessionId===s.id;
  // The Lead as the chain sees it: its live terminal, or, at rest, a Lead to be woken by the message it is sent (the
  // send of the backend wakes it: lead-wake.mjs). A Lead at rest is never busy and never seen.
  const leadOf=(m,s,agents)=>{
    const live=s.terminalId?agents.find(a=>a.address===s.terminalId)||null:null;
    return live||(rested(m,s)?{address:s.terminalId,status:'rested',rested:true,tab:null}:null);
  };

  // A Lead idle long in Develop or Validate is put to rest once: its tab closed, the mission says when. Its idle time
  // starts over as soon as it works again; a close that fails is said, and tried again after another idle time.
  // The missions this chain has seen its Lead idle in (this watcher): a watcher started again counts from its own
  // first pass, whatever an earlier one saw (it may have missed the Lead at work in between).
  const watched=new Set();
  async function rest(id,m,s){
    if(s?.role!=='lead'||!s.terminalId||BEFORE_DEVS.includes(m.step)||m.lead?.restedAt||m.lead?.sessionId!==s.id)return;
    let view;try{view=await window.ls();}catch{return;}
    const agent=view.agents.find(a=>a.address===s.terminalId)||null,stored=(await load(id)).leadIdle,at=now();
    const first=!watched.has(id);watched.add(id);
    // Told since it was seen idle (lead-wake.mjs says when): what it does with the message is not idle time.
    const told=Date.parse(m.lead?.toldAt||'')||0,was=stored&&!first&&told<stored.since?stored:null;
    // Busy, gone, or on screen (the user may be typing to it): its idle time starts over.
    const onScreen=Boolean(agent?.tab)&&view.shown?.tab===agent.tab;
    if(!agent||!['idle','done'].includes(agent.status)||onScreen){if(stored)await change(id,d=>{d.leadIdle=null;});return;}
    // Seen idle again after the watcher stopped for a while, or by another terminal: counted from now.
    if(!was||was.terminal!==s.terminalId||at-(was.seen??was.since)>LEAD_GAP_MS){await change(id,d=>{d.leadIdle={terminal:s.terminalId,since:at,seen:at};});return;}
    // The last time seen is written once a minute at most: the watcher passes every few seconds.
    if(at-was.since<LEAD_REST_MS){if(at-(was.seen??was.since)>=LEAD_SEEN_MS)await change(id,d=>{d.leadIdle={...was,seen:at};});return;}
    // Under the lock of every message to the Lead: none reaches it between the last look and the close.
    const outcome=await restLock(root,m.id,async()=>{
      const now_=await missions.read(m.id).catch(()=>null);
      if(!now_||now_.lead?.sessionId!==s.id||now_.lead.restedAt||(Date.parse(now_.lead.toldAt||'')||0)>=was.since)return 'told';
      // What was seen before the lock may be gone: a launch meanwhile may have opened another terminal in the same tab.
      // The session, its terminal, its tab and its status are read again; anything else than the Lead seen, still idle
      // and not on screen, starts its idle time over.
      const session=((await loadState()).sessions||[]).find(x=>x.id===s.id)||null;
      let look;try{look=await window.ls();}catch{return 'told';}
      const still=look.agents.find(a=>a.address===s.terminalId)||null;
      if(session?.terminalId!==s.terminalId||!still||still.tab!==agent.tab||!['idle','done'].includes(still.status)||look.shown?.tab===still.tab)return 'told';
      if(look.agents.some(a=>a.tab===agent.tab&&a.address!==s.terminalId))return 'told';
      // Written before the tab is closed: a close whose answer is lost, or a watcher cut right after, still leaves a
      // Lead to be woken, never a mission that points at a dead terminal.
      const restedAt=new Date(at).toISOString();
      await missions.update(m.id,x=>{if(x.lead?.sessionId!==s.id||x.lead.restedAt)return false;x.lead={...x.lead,restedAt,closedTerminals:[...(x.lead.closedTerminals||[]).filter(t=>t!==s.terminalId),s.terminalId].slice(-CLOSED_KEPT)};});
      try{await window.run('tab.close',{id:agent.tab,confirmed:true});return 'rested';}
      catch(e){
        // Refused by the window: nothing was closed. Not sure: the window says. Still there, the rest is undone and tried
        // again after another idle time. A window that does not answer either leaves the Lead at rest: waking it finds
        // its terminal if it still lives.
        let closed=false;
        if(!e?.refused){try{closed=!(await window.ls()).agents.some(a=>a.address===s.terminalId);}catch{closed=true;}}
        if(closed)return 'rested';
        await missions.update(m.id,x=>{if(x.lead?.restedAt!==restedAt)return false;delete x.lead.restedAt;});
        return {failed:String(e.message||e)};
      }
    });
    if(outcome==='told'){await change(id,d=>{d.leadIdle=null;});return;}
    if(outcome.failed){await change(id,d=>{d.leadIdle={terminal:s.terminalId,since:now(),seen:now()};});await log(id,REST.failed,'fail',outcome.failed);return;}
    await change(id,d=>{d.leadIdle=null;});
    await log(id,REST.rested,'todo');
  }

  const unclaim=(id,key)=>change(id,d=>{delete d.done[key];});
  // A line of the journal at the clock of the chain; `at`: the instant of the mark it tells, when it tells one.
  const log=(id,text,tone='ok',detailText='',at=now())=>change(id,d=>{d.log=[...d.log,{at:clock(new Date(at)),text,tone,detail:detailText}].slice(-LOG_MAX);});
  // The chain of an adopted session moves to the file of its mission, once: its keys and its story go with it.
  const moved=new Set();
  async function settle(m){
    const from=m.adoptedFrom||m.resumedFrom;
    if(!from||moved.has(m.id))return;
    await patientLock(lockDir,async()=>{
      try{await stat(file(m.id));}
      catch{try{await rename(file(from),file(m.id));}catch(e){if(e.code!=='ENOENT')throw e;}}
    },lock?{lock}:{});
    // Work taken up from a stopped session has a chain to walk, whatever became of its file.
    if(m.resumedFrom)await change(m.id,d=>{d.on=true;});
    moved.add(m.id);
  }
  // What a call works on: its mission, the session that leads it, and the name of its chain (the session's own, only
  // for a session of the first version, which has no mission: it is read, never run, and gets no mission from here).
  // Its mission and its session, read only: nothing is moved nor started (M6 b engine review 1, point 3).
  async function found(input){
    const sessions=(await loadState()).sessions||[];
    let mission=null,asked=null;
    if(input?.mission!==undefined)mission=await missions.read(input.mission);
    else{
      const sid=safe(input?.sessionId);
      asked=sessions.find(x=>x.id===sid&&isLead(x))||null;
      if(!asked)fail('NOT_FOUND','PO session not found.');
      mission=await missions.ofSession(sid);
    }
    return {sessions,mission,asked};
  }
  // The chain of a mission with a plan as settle would leave it, read only: its own file, else the one of the session
  // it comes from while it is not moved yet.
  // Whether settle has still to be made for a mission with a plan: adopted or resumed, and not settled by this process.
  const unsettled=m=>Boolean(hasPlan(m)&&(m.adoptedFrom||m.resumedFrom)&&!moved.has(m.id));
  async function chainOf(m){
    const from=m.adoptedFrom||m.resumedFrom;
    if(!from||moved.has(m.id))return load(m.id);
    try{await stat(file(m.id));return load(m.id);}catch{}
    return /^[\w.-]{1,200}$/.test(from)?load(from):load(m.id);
  }
  // `write: false`: read only (M6 b engine, fusion review point 3): the chain of an adopted or resumed mission is read
  // where it is, neither moved nor started; it is settled only by a caller that may write.
  async function work(input,known=null,{write=true}={}){
    const {sessions,mission,asked}=known??await found(input);
    // A mission without a plan is left as it is: its chain is neither moved nor started. The chain of the session it
    // comes from, still under the name of that session, is read there.
    let kept=mission?.id??asked.id;
    if(mission&&hasPlan(mission)&&write)await settle(mission);
    else if(mission&&!moved.has(mission.id)){
      const from=mission.adoptedFrom||mission.resumedFrom;
      if(from&&/^[\w.-]{1,200}$/.test(from)){try{await stat(file(mission.id));}catch{kept=from;}}
    }
    return {id:mission?.id??asked.id,kept,mission,session:mission?sessions.find(x=>x.id===mission.lead?.sessionId)||null:asked};
  }
  // Where the chain stands. A PO of the first version still moves its own steps; a Lead's step is its mission's.
  const stepIn=(m,s)=>s.role==='po'?stepOf(s):!missionActive(m)?'close':m.step==='validating'?'check':'dev';
  // The Herdr space of a mission, found by its name, whatever the terminal of its Lead has become. Herdr gives the
  // name of a space launched by label as its id, and the one of a space made by name as its name. Made when missing.
  async function homeOf(m,s,spaces,agents){
    const name=m.project?poSpace({key:m.project},m.issue,s):null,named=name?(spaces||[]).find(x=>x.id===name||x.name===name):null,tab=s.terminalId?poTab(agents,s.terminalId):null;
    if(tab&&(!named||tab.space===named.id))return tab;
    if(named)return {space:named.id,tab:null};
    if(!name)throw new Error('This mission has no project.');
    const made=await window.run('space.new',{name,folder:s.worktree||s.repo});
    if(!made?.space)throw new Error('Herdr did not say which space it made.');
    return {space:made.space,tab:null};
  }
  // What the mission keeps of a step of its chain: where each ticket stands, and when its Lead was last seen.
  async function record(m,rows,flow,own,lead,waiting){
    const chain=await load(m.id),marks=chain.done,metrics=metricsOf(marks),at=now();
    // The base of a ticket: the one its dev reported from, else the one noted before it was launched.
    const noted=r=>chain.bases[r.id]?.repositories||[],base=r=>flow[r.id]?.dev?.baseCommit||(noted(r).find(x=>x.repo==='.')||(noted(r).length===1?noted(r)[0]:null))?.commit||null;
    // Canceled after its launch, its dev seen stopped: said canceled. Before that it is said where it stands.
    const gone=ruleOf(rows,flow,marks,chain.lane).stopped;
    const stage=r=>{const f=flow[r.id];return f?.dev&&marks['merged|'+r.id+'|'+f.dev.commit]?'merged':gone(r)?'canceled':f?.stage||(marks['dev|'+r.id]?'dev':'todo');};
    const refused=r=>{const c=flow[r.id]?.dev?.commit;return Boolean(c)&&!marks['merged|'+r.id+'|'+c]&&Object.keys(marks).some(k=>k.startsWith('mergefail|'+r.id+'|'+c+'|'));};
    // A sub-ticket the plan does not name whose dev the lane holds is said running (decision 85): a removal shown for
    // approval then says its dev runs, never that it « never starts ».
    const tickets=rows.map(r=>({id:r.id,uid:r.uid||null,n:r.n??null,...ticketOfRow(r),kind:r.kind||null,delivery:r.delivery||null,integratedBy:r.integratedBy||null,state:stage(r),...(refused(r)?{mergeRefused:true}:{}),...(!r.planned&&chain.lane?.ticket===r.id?{running:true}:{}),tracker:r.state?.type||null,worktree:own.get(r.id)||null,branch:flow[r.id]?.dev?.branch||null,baseCommit:base(r),bases:noted(r),baseAt:chain.bases[r.id]?.at||null,rounds:metrics[r.id]?.rounds||0,waitingAnswer:waiting.get(r.id)||null}));
    const seen=lead&&!lead.rested&&(!m.lead?.lastSeen||at-Date.parse(m.lead.lastSeen)>=LEAD_SEEN_MS);
    if(!seen&&JSON.stringify(tickets)===JSON.stringify(m.tickets))return;
    await missions.update(m.id,x=>{x.tickets=tickets;noteSeen(x,tickets.map(t=>t.id));noteDrift(x,new Date(at).toISOString());if(seen)x.lead={...x.lead,lastSeen:new Date(at).toISOString()};});
  }
  // The issue, read again from the tracker once a minute: its sub-tickets give the state of the tickets of the plan.
  const issues=new Map();
  async function issueOf(s){
    const kept=issues.get(s.issueId);
    if(kept&&Date.now()-kept.at<DETAIL_EVERY_MS)return kept.issue;
    const issue=(await detail({id:s.issueId,refresh:Boolean(kept)}))?.issue||kept?.issue||null;
    issues.set(s.issueId,{at:Date.now(),issue});
    return issue;
  }
  // The tickets of a mission are those of the plan its Lead recorded, in the order of their ranks; the tracker gives
  // their state, and the sub-tickets the plan does not name. Before a plan is recorded, only those sub-tickets show.
  const rowsOf=(issue,s,m)=>{
    const out=new Set(Array.isArray(m?.approval?.outside)?m.approval.outside:[]);
    return planRows(hasPlan(m)?m.plan:null,issue?.children,s.tickets).map(r=>!r.planned&&out.has(r.id)?{...r,keptOut:true}:r);
  };
  // Shows again what the user looked at, after tabs were made.
  async function restore(shown,made=null){if(!shown)return;try{if(made){const now_=(await window.ls()).shown;if(!now_||!made.has(now_.name))return;}await window.run('space.select',{id:shown.space});if(shown.tab)await window.run('tab.select',{id:shown.tab});}catch{}}

  // A ticket is over by one rule, whoever asks. One developed in this delivery: accepted and merged once the chain ran
  // it (launched, or reported), whatever the tracker says (a reviewer moves it to Done before the merge, and a ticket
  // launched and moved to Done by hand has neither a review nor a merge), or canceled in the tracker (decision 46);
  // and, in both cases, its dev seen stopped: the lane no longer holds it (the lane is freed on a stop seen in the
  // core, and on nothing else). By its state in the tracker when the chain
  // never ran it. One that is not developed here (design, deferred, associated): by its state in the tracker
  // alone. One integrated by another ticket: when that ticket is over. What a ticket waits for is named by its
  // identifier; a wait that names no ticket is never over.
  function ruleOf(rows,flow,marks,lane){
    const byId=new Map(rows.map(r=>[r.id,r]));
    const run=r=>Boolean(flow[r.id]?.dev)||Boolean(marks['dev|'+r.id]);
    const merged=r=>flow[r.id]?.stage==='accepted'&&(!ticketMerge||Boolean(marks['merged|'+r.id+'|'+flow[r.id].dev.commit]));
    // Its work is finished: on the branch of the issue. Dropped: canceled with an agent the chain ran, its work not on
    // the branch of the issue: nothing more is run on it. Either way its dev has nothing left to do, and is stopped.
    const finished=r=>run(r)&&merged(r),dropped=r=>r.here!==false&&canceled(r)&&run(r)&&!merged(r);
    const free=r=>lane?.ticket!==r.id;
    // Launched then canceled in the tracker (decision 46): over once its dev was seen stopped, and not before.
    const stopped=r=>dropped(r)&&free(r);
    const ran=r=>run(r)?(merged(r)&&free(r))||stopped(r):closed(r);
    const overOf=(r,seen)=>{
      if(r.here!==false)return ran(r);
      if(closed(r))return true;
      if(r.delivery!=='integrated'||seen.has(r.id))return false;
      const by=byId.get(r.integratedBy);
      return Boolean(by)&&overOf(by,seen.add(r.id));
    };
    const over=r=>overOf(r,new Set());
    const waitsOver=r=>(r.waits||[]).every(w=>{const t=byId.get(String(w));return Boolean(t)&&over(t);});
    return {over,waitsOver,stopped,run,finished,dropped,
      // The ticket of the plan whose turn it is: the first by its rank that the chain never ran, still open, its
      // identity read, and waiting for nothing. No other ticket of the plan starts before it.
      first:()=>dueOf(rows).find(r=>r.planned&&Boolean(r.uid)&&!run(r)&&!closed(r)&&waitsOver(r))||null,
      // The tickets launched and not over, by their rank: a free lane goes to the first of them and to no other (a
      // ticket canceled then opened again takes its place by its rank), and to a ticket never run only when there is none.
      held:()=>dueOf(rows).filter(r=>run(r)&&!over(r))};
  }
  // Launches a dev: the worktree of the issue (rebased when no agent of it is at work), then the terminal of the ticket,
  // shown beside the Lead. Asked by the Lead, or by the chain when the turn of a ticket comes. One dev at a time: a
  // ticket starts only when what it waits for is over and the lane of the mission is its own to take. A ticket of the
  // plan starts with the agent, the model and the effort its plan gives it; a ticket whose identity nobody read in the
  // tracker, or one the plan does not develop in this delivery, is not launched.
  const validTickets=input=>(Array.isArray(input?.tickets)?input.tickets:[]).filter(t=>t&&/^[A-Z][A-Z0-9]{0,9}-\d{1,7}$/.test(String(t.identifier))&&['claude','codex'].includes(t.tool)&&typeof t.model==='string'&&t.model&&EFF.includes(t.effort)&&t.effort);
  // What a launch is refused for before anything is written, made or launched; else its mission and its session.
  // Every refusal is read before anything is written (M6 b engine review 1, point 3): the chain of an adopted or resumed
  // mission is read where it is, and moved only once nothing refuses. `then` runs with the environment kept as read
  // (withEnvironment) and its result is the launch's.
  // `then` absent: the first pass, before the lock of the lane, which writes nothing at all (M6 b engine, fusion review
  // point 3): the chain is settled (moved, started) only once the check under the lock has let the launch by.
  // `kept`: the environment is already held green by the caller for the whole of the launch (the watcher).
  async function launchable(input,then=null,{kept=false}={}){
    if(!validTickets(input).length)fail('INVALID_ARGUMENT','tickets are required.');
    await inbox.switched();
    const known=await found(input),m=known.mission,s=m?known.sessions.find(x=>x.id===m.lead?.sessionId)||null:known.asked;
    if(s?.stoppedAt)fail('SESSION_STOPPED','This session is over.');
    if(!hasPlan(m))fail('MISSION_FORMAT_OLD',OLD_FORMAT);
    // No dev without the frozen copy of the plan the user approved: the one gate of every launch, asked by the Lead (a
    // launch, a fix, a resume), by dev-launch, or by the chain on its own.
    approvedOnly(m);
    if(!s)fail('NOT_FOUND','This mission has no Lead yet.');
    // Launched by the mechanism of before: nothing of its lane is guessed, nothing is launched, and nothing resets it.
    const d=await chainOf(m);
    if(d.old)fail('DEV_LANE_OLD',LANE.old);
    // In pause (M11), asked or effective, no dev starts: neither the chain on its own, nor the Lead, nor a resume.
    if(d.pause)fail('MISSION_PAUSED',PAUSE.refused);
    // Until a dev of the mission has left (its durable proof, devStarted, never its step): the environment its project
    // declares, green or nothing starts (decision 111), kept green until the launch is done (M6 b engine review 1): no
    // check starts in between. Order of the locks: the lane of the mission, then the environment.
    const go=async()=>{if(!then)return {id:m.id,m,s};const {id}=await work(input,known);return then({id,m,s});};
    if(devStarted(m)||kept)return go();
    return withEnvironment({read:environment,hold:environmentHold},m,async({held})=>{
      if(held)fail('ENVIRONMENT_NOT_READY',ENVIRONMENT_HELD);
      return go();
    });
  }
  // The launch a caller asks for: under the lock of the lane of its mission, for the whole of it.
  async function launch(input){
    const {id}=await launchable(input);
    return lane.withLane(id,()=>launchLocked(input,{auto:false}));
  }
  // A dev the gate refuses is not launched, and it is said in the journal of the mission, once per ticket, refusal and
  // approval (M5 review 2): never in silence, never at every pass, never said launched.
  // A journal that fails never turns the refusal into a failure of the launch (M5 review, minor 5): the claim is given
  // back, and the next pass says it.
  async function refusedOnce(id,ticket,error,mission){
    if(!GATE.includes(error?.code))return;
    const key=gateKey(error,ticket,mission||await missions.read(id).catch(()=>null));
    if(!key)return;
    await sayOnce({claim:k=>claim(id,k),unclaim:k=>unclaim(id,k),say:()=>log(id,JOURNAL.blocked(ticket),'fail',JOURNAL.refused[error.code]||String(error.message||error.code))},key);
  }
  // The launch the user approved, said not started (M5 review 2): asked of a Lead (or unknown), and the launch the Lead
  // asked for failed before any dev was asked of the core (the worktree, the Herdr space, the tracker). The chain is set
  // back off as it was, so that nothing takes it for a dev that left; said once in the journal of the mission; the
  // approval may then be asked again by a click. A ticket refused on its own (it waits, it is not its turn) leaves the
  // series on, as before: the chain starts it when its turn comes.
  async function notStarted(id,reason,{seq}){
    const undone=await change(id,d=>{if(d.laneSeq!==seq)return false;d.on=false;return true;});
    if(!undone)return;
    const at=new Date(now()).toISOString(),code=/^[A-Z][A-Z0-9_]{1,40}$/.test(String(reason||''))?reason:null;
    // « asking » too (M5 review, minor 2): the Lead may fail before the click has written « asked »; the click then
    // leaves the failure as it is (src/mission.mjs).
    await missions.update(id,x=>{
      if(!['asking','asked','unknown'].includes(x.launch?.state)||!BEFORE_DEVS.includes(x.step))return false;
      x.launch={...x.launch,state:'failed',settled:'not-started',settledAt:at,...(code?{reason:code}:{})};
      x.log=[...(x.log||[]),{at,text:JOURNAL.notStarted(code)}].slice(-60);
    });
  }
  // Under the lock of the lane, taken by the caller: never takes it. `auto`: the chain on its own, which never asks
  // again for a dev it asked for and did not see.
  // A launch that returns with no dev asked of the core is not started either (M7, decision 80): every ticket failed on
  // its own before the core was asked (its branch, its questions, its conversation) or was refused for good (outside its
  // copy, given otherwise by the plan, never read in the tracker…). A ticket refused for its turn (it waits, it is not
  // its turn, the lane holds another) keeps the series on: the chain starts it when its turn comes.
  async function launchLocked(input,{auto=false,kept=false}={}){
    const at={id:null,on:true,seq:null};let out;
    try{out=await launchOnce(input,{auto,kept},at);}
    catch(error){if(!auto&&at.id&&!at.on)await notStarted(at.id,error?.code,at).catch(()=>{});throw error;}
    const list=Array.isArray(out?.launched)?out.launched:[];
    if(!auto&&at.id&&!at.on&&list.length&&!list.some(x=>x.launched||TURN.includes(x.reason)))await notStarted(at.id,refusalCode(list[0].reason),at).catch(()=>{});
    return out;
  }
  async function launchOnce(input,{auto=false,kept=false}={},at={}){
    return launchable(input,x=>launchKept(input,{auto},at,x),{kept});
  }
  async function launchKept(input,{auto=false}={},at={},{id,m,s}){
    const F=T.issue.follow,L=T.issue.devSteps,tickets=validTickets(input);
    at.id=id;
    const sid=s.id,fresh=input?.fresh!==false,resume=input?.resume===true,{agents,shown,spaces}=await window.ls();
    await change(id,d=>{if(fresh)d.log=[];at.on=d.on;at.seq=d.laneSeq;d.on=true;});
    await log(id,F.clicked(tickets.length),'run');
    let home;
    try{home=await homeOf(m,s,spaces,agents);}
    catch{await log(id,F.wtFailed,'fail',SPACE_FAILED);fail('NO_SPACE',SPACE_FAILED);}
    // The tracker says which tickets are canceled: unread, nothing is launched.
    const issue=await issueOf(s).catch(()=>null);
    if(!issue)fail('TRACKER_UNAVAILABLE',LANE.tracker);
    const base=baseOfPlan(issue?.description)||s.base||null;
    const rows=rowsOf(issue,s,m),rep=await reports({sessionId:sid}).catch(()=>null),flow=devFlow(rows,Array.isArray(rep?.reports)?rep.reports:[]);
    const busy=agents.some(a=>WORK_TAB.test(String(a.tab_name||''))&&a.status==='working');
    let wt;
    try{wt=await ensureWorktree({sessionId:sid,...(base?{base}:{}),rebase:!busy});}
    catch(e){await log(id,F.wtFailed,'fail',String(e.message||e));throw e;}
    for(const rb of wt.rebased||[])await log(id,F.rebased(rb.result,String(rb.repo).split('/').pop(),wt.base),rb.result==='rebased'?'ok':'fail');
    await log(id,wt.created?.length?L.worktreeMade:L.worktreeFound,'ok',wt.path+' · '+wt.branch);
    await missions.update(id,x=>{x.worktree=wt.path;x.branch=wt.branch;x.base=wt.base??null;});
    const launched=[],madeNames=new Set();
    for(const t of tickets){
      const name=T.issue.devTabName(t.identifier),row=rows.find(r=>r.id===t.identifier),refuse=reason=>launched.push({identifier:t.identifier,launched:false,reason});
      // Its identity was never read in the tracker (neither when the plan was recorded nor now): nothing starts on it.
      if(!row?.uid){refuse('unverified');continue;}
      if(row.here===false){refuse('not-developed');continue;}
      // Canceled in the tracker: no agent is launched on it, nor launched again (the chain stops the one it has).
      if(canceled(row)){refuse('canceled');continue;}
      // Outside the frozen copy of the plan the user approved, or changed since (decision 77): nothing starts on it.
      // Asked with the tool, the model and the effort approved, and no other (M7 review): dev-launch replaces none of them.
      // A ticket of the plan is the copy's once the gate lets it by: what it is asked with is checked against the plan
      // just below (plan-differs); a sub-ticket the plan does not name, against what its approval kept.
      const outside=copyRefusal(m,t.identifier,row.planned?{}:{asked:{tool:t.tool,model:t.model,effort:t.effort},row:ticketOfRow(row)});
      if(outside){refuse(GATE_REASON[outside.code]);await refusedOnce(id,t.identifier,outside,m);continue;}
      // The plan says who develops a ticket and with what; to take another model, the Lead says so in its plan.
      if(row.planned&&(row.asked.agent!==t.tool||row.asked.model!==t.model||row.asked.effort!==t.effort)){refuse('plan-differs');continue;}
      // The lane and the core, read now, under the lock: nobody else decides between this reading and the request.
      const view=await lane.look(id),rule=ruleOf(rows,flow,(await load(id)).done,view.lane);
      if(!rule.waitsOver(row)){refuse('waits');continue;}
      // Accepted and merged: nothing is left to launch on it, and its agent back would be a second dev.
      if(rule.finished(row)){refuse('over');continue;}
      // Whose turn it is: the ticket of the lane and no other; a free lane goes to the first ticket launched and not
      // over, by rank, and with none of them to the first of the plan that is ready, whatever the list asked.
      const verdict=lane.decide(view,t.identifier,{auto,resume});
      if(verdict!=='go'&&verdict!=='again'){refuse(verdict);continue;}
      if(view.state==='free'){
        const held=rule.held(),turn=!held.length&&row.planned?rule.first():null;
        if(held.length&&held[0].id!==row.id){refuse('serial');continue;}
        if(turn&&turn.id!==row.id){refuse('rank');continue;}
      }
      // The answer handed to the Lead while its agent had no tab goes with the task, in the same worktree: as the
      // conversation gives it (conversation.resumed), never read here.
      try{
        const handed=resume?(await questions.list({mission:id})).filter(q=>q.ticket===t.identifier&&q.state==='delivered'&&q.delivery?.via==='lead').at(-1)??null:null;
        const joined=await conversation.resumed(handed,{id,mission:m});
        // Its own worktree and branch, from the branch of the issue as it is now (lot 3); merged back once accepted.
        // However long the folder takes, the lock of the lane is held: nobody asks for a dev meanwhile.
        const own=ticketBranch?await ticketBranch({sessionId:sid,ticket:t.identifier}):null,folder=own?.path||wt.path;
        // The base of the ticket, noted before its dev starts: where the branch of the issue stood in each repository.
        const bases=(Array.isArray(own?.repositories)?own.repositories:[]).filter(x=>typeof x?.baseCommit==='string'&&x.baseCommit).map(x=>({repo:String(x.repo??'.'),commit:x.baseCommit}));
        await change(id,d=>{d.paths={...d.paths,[t.identifier]:folder};if(bases.length&&!d.bases?.[t.identifier])d.bases={...d.bases,[t.identifier]:{at:new Date(now()).toISOString(),branch:wt.branch??null,repositories:bases}};});
        // The lane reads itself and the core again, notes the dev asked, then asks the core for it: the one request.
        // The pause read again right before it (M11 review 1): written under this same lock, it cannot change between.
        const before=await load(id);if(before.pause)fail('MISSION_PAUSED',PAUSE.refused);
        const asked=before.done['dev|'+t.identifier];
        const got=await lane.request(id,{ticket:t.identifier,auto,resume,cwd:folder,space:home.space,argv:devArgv(t.tool,t.model,t.effort,await withAsk(devTask(t.identifier,s.identifier,folder,wt.command||null,own?{branch:own.branch,issueBranch:own.issueBranch}:null)+(joined?'\n\n'+joined:''),{cmd:wt.command,worktree:folder,ticket:t.identifier,from:'dev'}))});
        if(!got.launched){
          if(got.reason!=='uncertain'){refuse(got.reason);continue;}
          // Nobody knows what became of the request: the lane stays asked, and the next pass reads the core.
          launched.push({identifier:t.identifier,launched:false,reason:got.message});await log(id,F.launchFailed(t.identifier),'fail',got.message);continue;
        }
        // The durable proof that a dev of the mission left (M6 b engine review 1, point 2): written once, at the first
        // launch that succeeded; from then on the environment no longer holds a launch. A write that fails leaves the
        // next launch checked, nothing else.
        await missions.update(id,x=>{if(devStarted(x))return false;x.devStartedAt=new Date(now()).toISOString();}).catch(()=>{});
        // The name its tab shows; refused, it is asked again at the next pass.
        try{await window.run('tab.rename',{id:got.tab,name});}catch{}
        // The line of the first launch says the instant the dev step starts at (ticket M8); a launch again, its own.
        const mark=asked==null?(await load(id)).done['dev|'+t.identifier]:null;
        launched.push({identifier:t.identifier,launched:true});madeNames.add(name);await log(id,F.launched(t.identifier,agentName(t.tool),t.model),'ok',L.tab(name),typeof mark==='number'?mark:now());
      }catch(e){
        launched.push({identifier:t.identifier,launched:false,reason:String(e.message||e)});await log(id,F.launchFailed(t.identifier),'fail',String(e.message||e));
      }
    }
    if(launched.some(x=>x.launched))await missions.setStep(id,'building','devs lancés : '+launched.filter(x=>x.launched).map(x=>x.identifier).join(', '));
    // From the button, the PO tab is shown; from the chain, what the user was looking at.
    if(fresh)await restore(home);else if(madeNames.size)await restore(shown,madeNames);
    return {worktree:wt,launched};
  }

  // What a step of the conversation is given, with the chain running or not.
  // `marks`: the chain its marks and lines are written in, when it is not yet the mission's own (M6 b engine): the chain
  // of an adopted or resumed mission not settled yet, written where it is, neither moved nor started.
  const talking=({id,m,s,list,lead,tab,marks=id,budget=null})=>{
    const at=x=>x===id?marks:x;
    return {id,mission:m,session:s,reports:list,lead,tab,canLaunchLead:!budgetBlocks(budget,'lead'),claim:(x,...r)=>claim(at(x),...r),unclaim:(x,...r)=>unclaim(at(x),...r),log:(x,...r)=>log(at(x),...r),tell:(x,...r)=>tell(at(x),...r),claimedAt:async(mission,key)=>(await load(at(mission))).done[key]??null};
  };
  // The questions of a mission whose chain does not run. The window is read only when one is under way.
  async function talkOnly(id,m,s,kept=id,{marks=id,budget=null}={}){
    const [rep,asked]=await Promise.all([reports({sessionId:s.id}),questions.list({mission:id})]),list=Array.isArray(rep?.reports)?rep.reports:[];
    if(!list.some(r=>r.kind==='ask')&&asked.every(q=>q.state==='resolved')&&!(await inbox.toSettle({mission:id})).length)return;
    const {agents}=await window.ls(),lead=leadOf(m,s,agents);
    // In pause (M11 review 1) what the agents ask is kept and nothing is carried: no answer, no Lead made again.
    const held=Boolean((await load(kept)).pause);
    await (held?conversation.hold:conversation.step)(talking({id,m,s,list,lead,tab:name=>agents.find(a=>a.tab_name===name)||null,marks,budget}));
  }

  // Before any dev is launched: the tickets of the plan, or before a plan is recorded the sub-tickets the tracker has.
  // Nothing is launched from here. The tracker down, it is not asked again before the next minute.
  const unread=new Map();
  async function planned(m,s){
    if(Date.now()-(unread.get(s.issueId)||0)<DETAIL_EVERY_MS)return;
    let issue=null;
    // A plan recorded shows its tickets whatever the tracker answers: only their state there stays unknown.
    const alone=()=>hasPlan(m)?record(m,rowsOf(null,s,m),{},new Map(),null,new Map()).catch(()=>{}):null;
    try{issue=await issueOf(s);}catch{unread.set(s.issueId,Date.now());await alone();return;}
    unread.delete(s.issueId);
    // A list the tracker gave only in part says nothing of the tickets it does not show. A whole list is the truth, even empty;
    // so is a whole list whose labels and links the tracker's MCP cannot vouch for (incomplete-fields): it names every ticket.
    // A child it could not name (unidentified) makes it a list read in part.
    if(!issue||(issue.childrenComplete===false&&issue.childrenReason!=='incomplete-fields')){await alone();return;}
    await record(m,rowsOf(issue,s,m),{},new Map(),null,new Map()).catch(()=>{});
  }

  // What a step is answered before anything of the chain is read under its lock: nothing to run (no mission, no Lead,
  // a mission closed), or a mission the chain refuses whole. Nothing is written but, once, the Inbox element that says
  // a mission of the mechanism of before is blocked, and what to do by hand.
  async function standing(input,{write=true}={}){
    // The relay starts only once the old stock is archived (requests.switched); failed, it is said and nothing runs.
    await inbox.switched();
    const {id,kept,mission:m,session:s}=await work(input,null,{write});
    if(!m)return {out:{ran:false}};
    // A Lead whose session is stopped runs nothing more; a launch of its mission whose fate is unknown is still
    // established (decision 72): that Lead launches no dev any more.
    if(!s||s.stoppedAt){if(missionActive(m))await settleLaunch(id,m,null,await shown_(kept));return {out:{ran:false}};}
    const chain=await load(kept);
    if(stepIn(m,s)==='close')return {out:{ran:false}};
    // Devs launched and no plan: a mission of the old format. It is said, and nothing of it is run, read or written.
    // Its chain may carry no mark of it (never set on, or its file gone): its step past the preparation says its devs
    // were launched, and a rank or a dependency on its tickets says a split was read, which only a plan gives now.
    if(!hasPlan(m)&&(chain.on||!BEFORE_DEVS.includes(m.step)||(m.tickets||[]).some(t=>t?.n!=null||(Array.isArray(t?.deps)&&t.deps.length>0))))return {out:{ran:false,refused:'MISSION_FORMAT_OLD'}};
    // Its devs launched by the mechanism of before: its lane is not rebuilt from its marks and nothing of it is run,
    // for good (no command resets it: its devs are stopped by hand). Not a byte of its chain is written.
    if(chain.old){
      if(!(await inbox.list({mission:id})).some(i=>i.type==='stuck'&&i.cause==='lane-old'))await inbox.ask({type:'stuck',cause:'lane-old',mission:id,project:m.project??null,issue:m.issue?.identifier??null,ticket:null,question:null,title:LANE.oldTitle,text:LANE.old,recommendation:LANE.oldRecommendation,why:LANE.old,blocked:[],proofs:[]});
      return {out:{ran:false,refused:'DEV_LANE_OLD'}};
    }
    return {id,kept,m,s,chain};
  }
  // A launch whose fate is unknown (decision 72): what became of it, established once (src/mission.mjs, launchSettled),
  // written only if it is still the launch that was read, and said in the journal of the mission. Nothing is sent.
  async function settleLaunch(id,m,s,chain){
    if(!['unknown','asking'].includes(m.launch?.state))return;
    let lead=null;
    if(!s||s.stoppedAt)lead='stopped';
    else if(!chain.on&&BEFORE_DEVS.includes(m.step))try{const a=(await window.ls()).agents.find(x=>x.address===s.terminalId);lead=a?a.status||'idle':'absent';}catch{return;}
    const state=launchSettled(m,{chainOn:Boolean(chain.on),lead,now:now()});
    if(!state)return;
    const at=new Date(now()).toISOString(),text=state!=='asked'?JOURNAL.noStart:chain.on?JOURNAL.sequence:JOURNAL.stage(W.stepBar[STAGE[m.step]]||String(m.step));
    await missions.update(id,x=>{if(x.launch?.state!==m.launch.state||x.launch?.at!==m.launch.at)return false;x.launch={...x.launch,state,settled:state==='asked'?'started':'not-started',settledAt:at};x.log=[...(x.log||[]),{at,text}].slice(-60);});
  }
  // A ticket stopped, said by its dev (M10): from the instant it said it. The stop is written in the Inbox first, then
  // marked (the same words again make no second request); the Lead is told once (once: claimed, sent, marked; a send
  // that is not sure is never made again), and only then is the Lead said on it, nothing for the user for now, and the
  // journal says it once (onIt).
  // Panne: a watcher started again finds the marks and asks nothing more, and the instant stays the one of the dev.
  // Over when its dev delivers after it, or when the Lead lifts it (lead-block); a stop said before the last delivery
  // of its dev is over already and is never opened.
  // The stop said for a block, by its ticket and its instant: lifted, whatever was written on it since (its tries).
  async function lift(id,b){
    // Found and lifted in one step under the lock of the register (M10 review 2): a stop the Lead wrote again between a
    // reading and the lift is the one lifted, never left open.
    await inbox.liftStop({mission:id,ticket:b.ticket,since:new Date(Date.parse(b.at)).toISOString()});
  }
  // The Lead told for sure: the stop of this instant is written again with the Lead on it and nothing for the user for
  // now, on the stop as it is (`expect`: what the Lead wrote on it meanwhile is kept, and a stop it already took or that
  // was lifted is left as it is), then « Lead called » is said once. The rewrite keeps the instant and notifies nobody.
  async function onIt(id,b){
    const since=new Date(Date.parse(b.at)).toISOString();
    for(let round=0;round<3;round++){
      const it=(await inbox.list({mission:id})).find(i=>i.type==='stuck'&&i.cause==='blocked'&&i.ticket===b.ticket&&i.since===since&&i.state!=='resolved');
      if(!it||it.owner)break;
      const {type,cause,mission,project,issue,ticket,title,text,blocked,proofs,migration,tries,forUser}=it;
      try{await inbox.ask({type,cause,mission,project,issue,ticket,question:null,title,text,blocked,proofs,since:it.since,...(migration?{migration}:{}),...(tries?{tries}:{}),owner:'lead',forUser:forUser??false,expect:it.id});break;}
      catch(e){if(e?.code!=='STOP_CHANGED')throw e;}
    }
    await claimSay(id,'stopcall|'+b.name,STOP_LOG.stopped(b.ticket),'wait',String(b.reason||'').slice(0,140));
  }
  // What the Lead tries on a stop (lead-block), said in « Recent activity » in the words of the mockup (screen 12), each
  // once (M10 review): a try running at its instant; a try that fails the same way at its instant, or now when it was
  // said running before; the last try failed when the Lead asks the user. Its text is the Lead's, for display only.
  async function triesSaid(id,b){
    const since=new Date(Date.parse(b.at)).toISOString();
    const it=(await inbox.list({mission:id})).find(i=>i.type==='stuck'&&i.cause==='blocked'&&i.ticket===b.ticket&&i.since===since&&i.state!=='resolved');
    const tries=Array.isArray(it?.tries)?it.tries:[];
    for(const [i,x] of tries.entries()){
      const n=i+1,base=b.name+'|'+n,when=Number.isFinite(Date.parse(x?.at))?Date.parse(x.at):now();
      if(x?.outcome==='running')await claimSay(id,'tryrun|'+base,STOP_LOG.tryRunning(n,String(x.text||'').slice(0,140)),'run','',when);
      if(x?.outcome==='same'){
        const ran=(await load(id)).done['tryrun|'+base]!==undefined;
        // The last try failed with the Lead asking the user: that alone is said for it (state 57).
        if(x.last===true&&it.forUser===true)await claimSay(id,'tryask|'+base,STOP_LOG.lastFails(n),'wait','',ran?now():when);
        else await claimSay(id,'trysame|'+base,it.migration?STOP_LOG.migrationAgain(b.ticket):STOP_LOG.failsAgain(b.ticket),'fail','',ran?now():when);
      }
    }
  }
  async function stops({id,m,s,list,lead,rows,quiet=false}){
    const blocks=list.filter(r=>r.kind==='block'&&!r.unreadable&&rows.some(x=>x.id===r.ticket)&&Number.isFinite(Date.parse(r.at)));
    if(!blocks.length)return;
    const marks=(await load(id)).done,delivered=ticket=>list.filter(r=>r.ticket===ticket&&r.kind==='dev'&&r.commit).map(r=>String(r.at||'')).sort().at(-1)||'';
    for(const b of blocks){
      const key='stop|'+b.name,over=delivered(b.ticket)>String(b.at)||canceled(rows.find(x=>x.id===b.ticket)||{});
      // Lifted first, then marked (M10 review): a watcher stopped between the two lifts it again at its next start, and
      // the journal says it once. Only the stop of this instant is lifted, never a later stop of the same ticket.
      if(over){if(marks[key]!==undefined&&marks['stopover|'+b.name]===undefined){await lift(id,b);await claimSay(id,'stopover|'+b.name,STOP_LOG.goes(b.ticket),'run');}continue;}
      if(marks['stopover|'+b.name]!==undefined)continue;
      // Written without anybody on it (M10 review): « the Lead is on it » is said only once the Lead was told for sure.
      if(marks[key]===undefined){
        await inbox.ask({type:'stuck',cause:'blocked',mission:id,project:m.project??null,issue:m.issue?.identifier??null,ticket:b.ticket,question:null,title:b.migration?STOP_LOG.migrationTitle(b.migration):STOP_LOG.title(b.ticket),text:b.reason||STOP_LOG.title(b.ticket),blocked:[b.ticket],proofs:[],
          since:new Date(Date.parse(b.at)).toISOString(),...(b.migration?{migration:b.migration}:{})});
        await claim(id,key);
      }
      // Lead absent: nothing is reserved, the request goes when it comes back. A send refused is made again at the next
      // pass; a send not sure is never made again, said once, and the stop keeps nobody on it. In pause (M11 review 1)
      // the stop is shown, and the Lead is told after Resume: nothing wakes it meanwhile.
      await triesSaid(id,b);
      if(!lead||quiet)continue;
      const file=b.path||join(s.worktree,'.fabrique-console',b.name),post=surely(send);
      await once('stoplead|'+b.name,{act:()=>post({sessionId:s.id,terminal:lead.address,text:stopToLead({mission:id,ticket:b.ticket,file})}),record:()=>onIt(id,b),
        failure:why=>log(id,STOP_LOG.leadFailed(b.ticket),'fail',why),doubt:()=>claimSay(id,'stopunsure|'+b.name,STOP_LOG.leadUnsure(b.ticket),'fail')},
        {id,claim,unclaim,claimedAt:async(mission,k)=>(await load(mission)).done[k]??null},now);
    }
  }
  // One step of the chain of one mission, under the lock of its lane for the whole of it. The watcher does not wait
  // for a lane that is busy: it skips the mission (`patient:false`).
  async function tick(input,{patient=true}={}){
    const at=await standing(input,{write:false});
    if(at.out)return at.out;
    return lane.withLane(at.id,async()=>{
      // A pass that fails (Herdr, the tracker, the reports not readable) leaves an asked pause with its cause (M11 review 2).
      try{return await tickLocked(input);}catch(error){await pauseBlind(at.kept).catch(()=>{});throw error;}
    },{patient});
  }
  // Under the lock of the lane, taken by the caller: never takes it.
  // The chain of an adopted or resumed mission, not settled yet, that would walk toward a first dev (M6 b engine, fusion
  // review point 3): settled only once the environment is read green under the lock, and kept as read for the whole
  // pass, to its launch. Not green, only the launch waits: neither settled, moved nor started; the next pass reads it
  // again. The exchanges go on meanwhile (the questions taken in, told to the Lead, the answers carried, the Lead made
  // again if need be), written in the chain where it is, which they neither move nor start.
  async function tickLocked(input){
    const first=await standing(input,{write:false});
    if(first.out)return first.out;
    const m=first.m,gated=unsettled(m)&&!devStarted(m)&&(Boolean(m.resumedFrom)||(await chainOf(m)).on);
    const budget=await checkBudgets(budgetCheck,{mission:m,load:()=>load(first.kept),claimSay:(_id,...args)=>claimSay(first.kept,...args),
      updateBudgetCheck:async fn=>{
        // Budget controls are serialized by the lane lock. Skip a chain write when their state is unchanged.
        const current=(await load(first.kept)).budgetCheck??{blocked:[],episode:0,unavailable:false};
        if(JSON.stringify(fn(current))===JSON.stringify(current))return current;
        return change(first.kept,d=>(d.budgetCheck=fn(d.budgetCheck??{blocked:[],episode:0,unavailable:false})));
      }});
    if(!gated)return walk(input,{budget});
    let refused=false;
    const out=await withEnvironment({read:environment,hold:environmentHold},m,async({held})=>{if(held){refused=true;return null;}return walk(input,{kept:true,budget});});
    if(!refused)return out;
    await talkOnly(first.id,m,first.s,first.kept,{marks:first.kept,budget});
    return {ran:false,refused:'ENVIRONMENT_NOT_READY'};
  }
  async function walk(input,{kept:envKept=false,budget=null}={}){
    const at=await standing(input),F=T.issue.follow;
    if(at.out)return at.out;
    const {id,kept,m,s}=at;let chain=at.chain;const sid=s.id;
    await settleLaunch(id,m,s,chain);
    await rest(id,m,s).catch(()=>{});
    // No dev launched yet, and still a Lead who asked the user something: its answer must reach it all the same.
    if(!chain.on||!s.worktree){await talkOnly(id,m,s,kept,{budget});await planned(m,s);await settlePause(id,kept,[],s,{});return {ran:false};}
    const issue=await issueOf(s);if(!issue){await pauseBlind(kept);return {ran:false};}
    const rows=rowsOf(issue,s,m);if(!rows.length){await talkOnly(id,m,s,kept,{budget});await settlePause(id,kept,[],s,{});return {ran:false};}
    const rep=await reports({sessionId:sid}),list=Array.isArray(rep?.reports)?rep.reports:[],cmd=rep?.command||null,flow=devFlow(rows,list);
    const {agents,shown,spaces}=await window.ls(),lead=leadOf(m,s,agents);
    // The lane and the core, read under the lock: a dev asked for and alive there is seen; one asked for that the core
    // does not show is a doubt, said once, and nothing is tried again on its own (rule 1 of decision 48).
    let view=await lane.look(id);
    // In pause (M11), read again right before anything would start: what was asked while this pass ran holds too.
    const pausedNow=async()=>Boolean((await load(kept)).pause);
    const said=async()=>{
      const marks=(await load(id)).done;
      // A canceled ticket is not launched as it is: what to do says the way round, from the moment it is canceled (the
      // element already said is brought up to date once, without a second notification).
      const gone=view.state==='doubt'&&canceled(rows.find(r=>r.id===view.lane.ticket)||{}),first=view.state==='doubt'&&await claim(id,'doubt|'+view.lane.ticket+'|'+view.lane.launch);
      if(first||(gone&&await claim(id,'doubtcanceled|'+view.lane.ticket+'|'+view.lane.launch))){
        if(first)await log(id,F.launchFailed(view.lane.ticket),'fail',LANE.doubt);
        if(gone)await claim(id,'doubtcanceled|'+view.lane.ticket+'|'+view.lane.launch);
        await inbox.ask({type:'stuck',cause:'dev',mission:id,project:m.project??null,issue:m.issue?.identifier??null,ticket:view.lane.ticket,question:null,title:LANE.doubtTitle(view.lane.ticket),text:LANE.doubt,recommendation:gone?LANE.doubtCanceledRecommendation:LANE.doubtRecommendation,why:LANE.doubt,blocked:[view.lane.ticket],proofs:[]});
      }
      if(view.state==='foreign'&&await claim(id,'foreign|'+view.terminal.address))await inbox.ask({type:'stuck',cause:'lane',mission:id,project:m.project??null,issue:m.issue?.identifier??null,ticket:null,question:null,title:LANE.foreignTitle,text:LANE.foreign,recommendation:LANE.foreignRecommendation,why:LANE.foreign,blocked:[],proofs:[]});
      // What was said and is no longer so is settled: the dev seen or its lane freed, the unexpected terminal gone.
      for(const key of Object.keys(marks)){
        const [kind,ticket,launch]=key.split('|');
        if(kind==='doubt'&&!(view.state==='doubt'&&view.lane.ticket===ticket&&String(view.lane.launch)===launch)&&await claim(id,'settled|'+key))await unstick(inbox,id,ticket,'dev');
        if(kind==='foreign'&&view.state!=='foreign'&&await claim(id,'settled|'+key))await unstick(inbox,id,null,'lane');
      }
    };
    await said();
    let home=null;
    // Made or found the first time a tab needs it, never for a step that opens nothing.
    const spaceOf=async()=>(home||(home=await homeOf(m,s,spaces,agents))).space;
    // A tab by its name: a reviewer, the QA. The dev of a ticket is the terminal of the lane and no other, found by its
    // address whatever its tab is called; a tab that bears the name of a dev and is not that terminal is not a dev.
    const tab=name=>{
      const dev=DEV_TAB.exec(name);
      if(!dev)return agents.find(a=>a.tab_name===name)||null;
      if(view.state!=='live'||view.lane.ticket!==dev[1])return null;
      const inWindow=agents.find(a=>a.address===view.terminal.address);
      return {address:view.terminal.address,space:inWindow?.space??null,tab:inWindow?.tab??null,tab_name:name,status:inWindow?.status||view.terminal.status||'unknown'};
    };
    // The name of the tab of the dev, asked again while the window does not show it under it.
    if(view.state==='live'){const inWindow=agents.find(a=>a.address===view.terminal.address),name=T.issue.devTabName(view.lane.ticket);if(inWindow&&inWindow.tab_name!==name)try{await window.run('tab.rename',{id:inWindow.tab,name});}catch{}}
    const own=new Map();
    for(const r of rows){
      let at=chain.paths[r.id]||null;
      if(!at&&ticketBranch){const guess=join(dirname(s.worktree),s.identifier+'-'+r.id);try{if((await stat(guess)).isDirectory())at=guess;}catch{}}
      own.set(r.id,at||s.worktree);
    }
    const home_=r=>own.get(r)||s.worktree;
    // Taken up from a stopped session: once, before anything is walked, what its reports prove is marked as done.
    if(m.resumedFrom&&!chain.settled){
      const qaAt=validation?(await validation({sessionId:sid}).catch(()=>null))?.qa?.at??null:null;
      const proven=new Set();
      for(const r of rows){
        const f=flow[r.id];if(f?.stage!=='accepted')continue;
        const parts=Array.isArray(f.dev.repositories)&&f.dev.repositories.length?f.dev.repositories:[f.dev],checks=await Promise.all(parts.map(x=>onBranch({path:join(s.worktree,x.repo||'.'),commit:x.commit,branch:s.branch})));
        if(checks.every(Boolean))proven.add(r.id);
      }
      const marks=historyMarks(rows,flow,{step:m.step,proven,hasFolder:ticket=>own.get(ticket)!==s.worktree,qaAt});
      await change(id,d=>{for(const [key,value] of marks)d.done[key]=d.done[key]??value;d.settled=true;});
      chain=await load(id);
    }
    // In pause (M11 review 1) nothing wakes an agent: the questions of the agents are kept, the answers of the user and
    // the messages of the conversation wait for Resume, and no Lead is made again.
    const quiet=await pausedNow();
    const waiting=await (quiet?conversation.hold:conversation.step)(talking({id,m,s,list,lead,tab,budget}));
    await stops({id,m,s,list,lead,rows,quiet});
    const made=new Set();let before=null;
    // What the window shows right before the first tab the chain makes: what the user gets back.
    const look=async()=>{if(!before)before=(await window.ls().catch(()=>null))?.shown||shown;};
    // A dev tab that changed state since the last look is told in the story; one that is gone, too.
    // Every tab of the issue (devs, reviewers, QA) by its name: one that starts waiting for the user is notified (lot 5).
    const seen={},mine=name=>{const m=WORK_NAME.exec(name);return m&&(rows.some(r=>r.id===m[1])||m[1]===s.identifier);};
    for(const a of agents){const name=String(a.tab_name||'');if(mine(name))seen[name]=a.status||'unknown';}
    for(const [name,st] of Object.entries(seen)){
      const was=chain.seen[name],m=DEV_TAB.exec(name);
      if(was!==undefined&&was!==st&&m)await log(id,F.changed(m[1],ownValue(T.issue.devStatus,st)||st),st==='blocked'?'wait':st==='working'?'run':'ok');
      // An agent waiting for the answer to its question waits for its Lead: the user hears of it only through the Inbox.
      if(st==='blocked'&&was!=='blocked'&&!waiting.has(WORK_NAME.exec(name)?.[1]))await notify(N.title(s.identifier),N.waits(name));
    }
    for(const name of Object.keys(chain.seen)){const m=DEV_TAB.exec(name);if(!(name in seen)&&m)await log(id,F.closed(m[1]),'todo');}
    await change(id,d=>{d.seen=seen;});
    // A ticket launched then canceled in the tracker (decision 46 of the owner): the tabs of its reviewers are closed,
    // and closed again if one comes back; its dev is stopped by the lane, below, and until the core says it stopped
    // the ticket holds the series. Then it is over, and nothing more is run on it.
    const dropped=ruleOf(rows,flow,chain.done,view.lane).dropped;
    for(const r of rows.filter(dropped))for(const name of [T.issue.reviewTabName(r.id,1),T.issue.reviewTabName(r.id,2)]){
      const t=tab(name);if(t)try{await window.run('tab.close',{id:t.tab,confirmed:true});}catch{}
    }
    // The verdicts the user decided, read once per pass when a ticket needs them; a register that cannot be read says none.
    let decided=null;
    const verdicts=async()=>decided??(decided=((await inbox.taken({mission:id}).catch(()=>[]))||[]).filter(d=>d&&d.kind==='verdict'&&d.ticket&&typeof d.answer==='string'&&Number.isFinite(Date.parse(d.at))));
    for(const r of rows){
      const f=flow[r.id];if(!f?.dev||dropped(r)||r.keptOut)continue;
      // What this pass sees of the ticket is seen at one instant: its marks and the lines of the journal that tell them
      // (ticket M8). A verdict is marked when first seen, unless the pass that saw it already acted on it.
      const c=f.dev.commit,at=f.dev.at||'',seen=now();
      for(let n=1;n<=f.need;n++){const key='verdict|'+r.id+'|'+c+'|'+at+'|'+n;if(f.reviews[n-1]?.verdict&&chain.done[key]===undefined&&!['ok|'+r.id+'|'+c,'fix|'+r.id+'|'+c+'|'+at,'notab|'+r.id+'|'+c+'|'+at].some(k=>chain.done[k]!==undefined))await claim(id,key,seen);}
      // The verdict itself, kept for good once seen (ticket M9): the file of the review is replaced at the next round.
      for(let n=1;n<=f.need;n++){const v=f.reviews[n-1]?.verdict;if(JUDGED.includes(v)&&chain.done['said|'+r.id+'|'+c+'|'+at+'|'+n]===undefined)await claim(id,'said|'+r.id+'|'+c+'|'+at+'|'+n,v);}
      // How many remarks a review that asked for changes made, kept as its verdict is (M9 review, E4).
      for(let n=1;n<=f.need;n++){const v=f.reviews[n-1],count=v?.verdict==='changes_requested'?remarkCount(v.summary):0,key='remarks|'+r.id+'|'+c+'|'+at+'|'+n;if(count&&chain.done[key]===undefined)await claim(id,key,count);}
      // A verdict the reviewer left to the user and that he decided (M9 review, E5): his answer is kept with the review its
      // request comes from (its provenance, `review-1` or `review-2`, M9 review 2), never guessed from the hours of the
      // reports, and with whom it comes from, beside what the reviewer writes after it. A decision of before the delivery
      // is another round's; one whose request names no review of this ticket is given to none.
      for(const d of (await verdicts()).filter(d=>d.ticket===r.id&&Date.parse(d.at)>=Date.parse(at))){
        const n=Number(/^review-([12])$/.exec(String(d.from??''))?.[1]);
        if(!(n>=1&&n<=f.need))continue;
        const key='decided|'+r.id+'|'+c+'|'+at+'|'+n;
        if(chain.done[key]===undefined)await claim(id,key,{by:d.by,role:d.role,answer:String(d.answer),item:d.item??null,at:d.at});
      }
      if(await claim(id,'done|'+r.id+'|'+c+'|'+at,seen)){await log(id,F.devReported(r.id,c.slice(0,8)),'ok',String(f.dev.summary||'').slice(0,140),seen);await tell(id,{ticket:r.id,kind:'reported',commit:HEX.test(String(c))?c:null});}
      // The review of that commit: one reviewer, two for a strong ticket. A reviewer cut in the middle of its review (its
      // tab gone, no verdict, a minute at least after its launch) is launched again, once per cut and by one watcher (the
      // mark again|… is claimed first), twice at most; its round is the same: the review keeps the start of its first
      // launch and counts once (ticket M9).
      for(let n=1;n<=f.need;n++){
        const key='rev|'+r.id+'|'+c+'|'+at+'|'+n,name=T.issue.reviewTabName(r.id,n);
        // Its verdict came: a stop said for a reviewer that did not show is over (M9 review 3).
        // Lifted first, then marked (M10 review): a watcher stopped between the two lifts it at its next start.
        if(f.reviews[n-1]){if(Object.keys(chain.done).some(k=>k.startsWith('unseen|')&&k.includes(key.slice(4)))&&chain.done['seenover|'+key.slice(4)]===undefined){await unstick(inbox,id,r.id,'reviewer');await claim(id,'seenover|'+key.slice(4),seen);}continue;}
        let again=null;
        // In pause no reviewer starts (M11), the first one nor one launched again; what proves a launch of before is
        // still settled above and below.
        if((await load(id)).done[key]===undefined&&await pausedNow())continue;
        if(!(await claim(id,key,seen))){
          const marks=(await load(id)).done,tries=Object.keys(marks).filter(k=>k.startsWith('again|'+key.slice(4)+'|')).sort((a,b)=>Number(a.split('|').at(-1))-Number(b.split('|').at(-1))),last=Math.max(...[marks[key],...tries.map(k=>marks[k])].map(v=>typeof v==='number'?v:-Infinity));
          // Each attempt is known by its own terminal (M9 review 3, decision 98): the one tab.new answered with, kept as
          // term|<attempt>. Tabs of the same name are told apart by it, never by their name alone: a shell of an attempt
          // of before that shows again is that attempt's, not the reviewer of the last one.
          const attempts=[key,...tries],termOf=k=>typeof marks['term|'+k]==='string'?marks['term|'+k]:null,named=agents.filter(a=>a.tab_name===name);
          // A launch whose answer was lost (lost|…) may still show, however late: until the window shows its tab, the
          // absence of that reviewer is not proven and no other is made, whatever the delay (M9 review 2). Only a tab
          // whose terminal is no other attempt's settles it (M9 review 3), and its terminal is then that attempt's.
          // So does a launch tab.new answered with its terminal (M10 review, P1): until the window shows the tab of that
          // terminal, its absence is not proven either (it may only be slow to show) and it is never taken for a cut.
          // A launch asked of the window and never answered (the watcher cut right after tab.new, M10 review 2: asking|…) is
          // the same doubt: it may have made the reviewer.
          const doubts=attempts.filter(k=>(marks['lost|'+k]!==undefined||marks['asking|'+k]!==undefined||termOf(k)!==null)&&marks['shown|'+k]===undefined);
          for(const k of doubts){
            const term=termOf(k),others=new Set(attempts.filter(x=>x!==k).map(termOf).filter(Boolean)),own=term?named.find(a=>a.address===term):named.find(a=>!others.has(a.address));
            // Its own terminal shows: it was made. A lost one is given the terminal of the tab that settles it, once.
            if(!own||(!term&&!(await claim(id,'term|'+k,own.address))))continue;
            await claim(id,'shown|'+k,seen);marks['term|'+k]=own.address;marks['shown|'+k]=seen;
            if(marks['unseen|'+k]!==undefined)await unstick(inbox,id,r.id,'reviewer');
          }
          // Still not shown five minutes after its launch: a stop, said once in the Inbox from the instant of that launch
          // (M9 review 3, decision 98; M10). Nothing is launched again (decision 48, rule 1).
          const unseen=doubts.filter(k=>marks['shown|'+k]===undefined),launchOf=k=>typeof marks['lost|'+k]==='number'?marks['lost|'+k]:typeof marks['asking|'+k]==='number'?marks['asking|'+k]:typeof marks[k]==='number'?marks[k]:null;
          // The request first, then its mark: the same words again make no second request, and a stop between the two
          // says it at the next pass.
          for(const k of unseen)if(launchOf(k)!==null&&now()-launchOf(k)>=REVIEW_UNSEEN_MS&&marks['unseen|'+k]===undefined){
            await inbox.ask({type:'stuck',cause:'reviewer',mission:id,project:m.project??null,issue:m.issue?.identifier??null,ticket:r.id,question:null,title:STUCK.reviewerTitle(r.id),text:STUCK.reviewer,recommendation:STUCK.reviewerRecommendation,why:STUCK.reviewer,blocked:[r.id],proofs:[],since:new Date(launchOf(k)).toISOString()});
            await claim(id,'unseen|'+k,seen);
          }
          if(unseen.length)continue;
          // The reviewer of the last attempt, by its terminal (an attempt of before this rule has none: the tab of the
          // name). The tab alone proves nothing (M9 review): a reviewer that stopped leaves its shell there. It is cut
          // when its tab is gone or when the window shows a shell in it, no agent; any other status, known or not, is
          // alive. A tab of the name that is not it is of an attempt of before: closed, never a second reviewer.
          const mine=termOf(attempts.at(-1)),there=mine?named.find(a=>a.address===mine)||null:named[0]||null;
          if(mine)for(const a of named.filter(a=>a.address!==mine))try{await window.run('tab.close',{id:a.tab,confirmed:true});agents.splice(agents.indexOf(a),1);}catch{}
          if(f.stage!=='review'||(there&&there.shell!==true)||made.has(name)||now()-last<REVIEW_GRACE_MS)continue;
          if(budgetBlocks(budget,'reviewer',r.id,mine))continue;
          if(tries.length>=REVIEW_AGAIN_MAX){if(await claim(id,'gone|'+key.slice(4),seen))await log(id,F.reviewGone(r.id),'fail','',seen);continue;}
          if(await pausedNow())continue;
          again='again|'+key.slice(4)+'|'+(tries.length+1);
          if(!(await claim(id,again,seen)))continue;
        }
        const rv=reviewerFor(r.agent,n),attempt=again||key;let asked=false,launched=false,term=null;
        try{
          // Every tab of the name the window shows is of an attempt of before: closed first.
          for(const old of agents.filter(a=>a.tab_name===name))await window.run('tab.close',{id:old.tab,confirmed:true});
          await look();await claim(id,'asking|'+attempt,seen);asked=true;const answer=await window.run('tab.new',{name,space:await spaceOf(),folder:s.worktree,trace:{mission:id,ticket:r.id,role:'review-'+n},argv:devArgv(rv.tool,rv.model,rv.effort,await withAsk(reviewTask(r.id,s.identifier,s.worktree,asRead(f.dev,join(s.worktree,'.fabrique-console',r.id+'.dev.json')),n,agentName(r.agent),f.need,cmd),{cmd,worktree:s.worktree,ticket:r.id,from:'review-'+n}))});
          // Its terminal, as the window answered it (`{terminal:"t9"}` or `{terminal:{id:"t7"}}`): what this attempt is
          // known by. An answer that names none leaves the doubt to the window, as a lost one does.
          const said=typeof answer?.terminal==='string'?answer.terminal:answer?.terminal?.id;term=typeof said==='string'&&said?said:null;launched=true;
          made.add(name);await log(id,(again?F.reviewRelaunched:F.reviewLaunched)(r.id,agentName(rv.tool),rv.model),'run','',seen);
          await claim(id,term?'term|'+attempt:'lost|'+attempt,term||seen);
        }catch(e){
          // Launched for sure, then a write failed (M10 review 3): the reviewer exists. Its reservation and asking|… stay;
          // its terminal is written if it can be, else asking|… keeps the doubt. Nothing is given back.
          if(launched){try{await claim(id,term?'term|'+attempt:'lost|'+attempt,term||seen);}catch{}continue;}
          // A tab.new whose answer is lost may have made the reviewer (M9 review): its mark stays, the attempt counts in
          // the cap, and the doubt is marked (lost|…): nothing is made again before the window shows that tab (M9 review
          // 2). Only what was refused, or never asked, is given back.
          if(!(asked&&e?.uncertain)){await unclaim(id,attempt);await unclaim(id,'asking|'+attempt);}
          else await claim(id,'lost|'+attempt,seen);
          await log(id,F.launchFailed(r.id),'fail',String(e.message||e));
        }
      }
      // Accepted: its branch is merged into the branch of the issue, once per commit; a conflict waits for the user.
      if(f.stage==='accepted'&&ticketMerge&&!chain.done['merged|'+r.id+'|'+c]&&await claim(id,'merge|'+r.id+'|'+c)){
        try{
          const m=await ticketMerge({sessionId:sid,ticket:r.id});
          if(m?.status==='merged'){await claim(id,'merged|'+r.id+'|'+c);await log(id,F.merged(r.id),'ok');await unstick(inbox,id,r.id,'merge');}
          else{const files=(m?.conflicts||[]).map(x=>x.repo+' : '+(x.files||[]).slice(0,5).join(', ')).join(' · ');
            await log(id,F.mergeConflict(r.id),'fail',files);await notify(N.title(s.identifier),F.mergeConflict(r.id));await tell(id,{ticket:r.id,kind:'conflict'});}
        }catch(e){
          await unclaim(id,'merge|'+r.id+'|'+c);
          // A merge refused (its branch no longer comes from its base, a stale report…) is said once per commit and reason,
          // to the journal, to the user and to the Lead, who repairs it or brings it up; it is tried again in silence, so
          // that a repair merges at the next turn.
          const why=String(e.message||e);
          if(await claim(id,'mergefail|'+r.id+'|'+c+'|'+(e.code||why).slice(0,80))){await log(id,F.mergeRefused(r.id),'fail',why);await notify(N.title(s.identifier),F.mergeRefused(r.id));await tell(id,{ticket:r.id,kind:'refused',reason:codeOf(e)});}
          // Still refused a quarter of an hour after it was first said: in the Inbox, once per commit.
          else {
            const first=Math.min(...Object.entries(chain.done).filter(([k])=>k.startsWith('mergefail|'+r.id+'|'+c+'|')).map(([,v])=>v));
            if(now()-first>=STILL_MS&&await claim(id,'still|merge|'+r.id+'|'+c))await inbox.ask({type:'stuck',cause:'merge',mission:id,project:m.project??null,issue:m.issue?.identifier??null,ticket:r.id,question:null,title:STUCK.mergeTitle(r.id),text:why,recommendation:STUCK.mergeRecommendation,why:STUCK.merge,blocked:[r.id],proofs:[]});
          }
        }
      }
      if(f.stage==='accepted'&&await claim(id,'ok|'+r.id+'|'+c,seen)){await log(id,F.accepted(r.id),'ok','',seen);await tell(id,{ticket:r.id,kind:'accepted',notes:f.reviews.some(v=>v?.notes?.length)});}
      // A ticket accepted: the tabs of its reviewers close once they are not working; its work stays in its commits.
      // Its dev is stopped by the lane once its work is merged, below.
      if(f.stage==='accepted')for(const name of [T.issue.reviewTabName(r.id,1),T.issue.reviewTabName(r.id,2)]){
        const t=tab(name);if(t&&t.status!=='working'){try{await window.run('tab.close',{id:t.tab,confirmed:true});await log(id,F.tabClosed(name),'todo');}catch{}}
      }
      // The corrections a review asked for are sent once to each dev of the ticket: the mark `fix|…` says they were
      // asked, and `fixto|…` the launch of the lane whose dev they were sent to. A new dev on the ticket (canceled then
      // opened again) is another launch: whatever became of the answer of its launch, it is told them once it is seen,
      // and a mark made for the dev of before does not stand for it. Both marks are written before the message goes,
      // and put back as they were when it fails.
      // In pause the corrections wait (M11): sent once after Resume.
      if(f.stage==='fix'&&!(await pausedNow())){
        const key='fix|'+r.id+'|'+c+'|'+at,to='fixto|'+r.id+'|'+c+'|'+at,d=tab(T.issue.devTabName(r.id)),marks=(await load(id)).done;
        if(!d){if(!marks[key]&&await claim(id,'notab|'+r.id+'|'+c+'|'+at,seen))await log(id,F.fixNoTab(r.id),'fail','',seen);}
        else if(!marks[key]||(marks[to]!==undefined&&marks[to]!==view.lane.launch)){
          const launch=view.lane.launch;
          await change(id,x=>{x.done[key]=x.done[key]??seen;x.done[to]=launch;});
          try{await send({sessionId:sid,terminal:d.address,text:fixMessage(r.id,HEX.test(String(c))?c:'',f.reviews.map((v,i)=>v&&asRead(v,join(s.worktree,'.fabrique-console',r.id+'.review-'+(i+1)+'.json'))),cmd,home_(r.id))});await log(id,F.fixSent(r.id),'wait','',seen);await tell(id,{ticket:r.id,kind:'fixing'});}
          catch(e){await change(id,x=>{if(marks[key]===undefined){delete x.done[key];delete x.done[to];}else x.done[to]=marks[to];});await log(id,F.fixFailed(r.id),'fail',String(e.message||e));}
        }
      }
    }
    // A dev that ended its turn without its report is asked for it, once. A dev stopped on its ticket is left to the
    // Lead (M10 review): never told to finish and commit while its stop is open.
    const halted=new Set((await inbox.list({mission:id})).filter(i=>i.type==='stuck'&&i.cause==='blocked'&&i.state!=='resolved').map(i=>i.ticket));
    for(const r of (await pausedNow())?[]:rows){
      const d=tab(T.issue.devTabName(r.id));if(!d||!['done','idle'].includes(d.status)||flow[r.id]?.dev||waiting.has(r.id)||halted.has(r.id)||dropped(r)||r.keptOut)continue;
      if(!(await claim(id,'ask|'+r.id)))continue;
      try{await send({sessionId:sid,terminal:d.address,text:reportAsk(r.id,home_(r.id),cmd)});await log(id,F.reportAsked(r.id),'wait');}
      catch(e){await unclaim(id,'ask|'+r.id);await log(id,F.fixFailed(r.id),'fail',String(e.message||e));}
    }
    // The lane is freed when the work of its ticket is finished (accepted and merged) or dropped (canceled): its dev is
    // stopped at once, working or not (rule 3 of decision 48), and the lane is free only if the core, read again, says
    // it stopped. Else it stays held, and the stop is asked again at the next pass.
    const holder=view.lane&&view.state!=='foreign'?rows.find(r=>r.id===view.lane.ticket)||null:null,ended=holder?ruleOf(rows,flow,(await load(id)).done,view.lane):null;
    // A ticket kept out (decisions 85 and 86) is stopped only on a turn proven over (idle, done, blocked) or a terminal
    // gone (no longer live, and no other in its place). Its status is read again here, after every answer delivered
    // above: unknown, error, or what was read before an answer reached it, and it waits for the next pass.
    const outDone=async r=>{
      if(!r?.keptOut)return false;
      const again=await lane.look(id);
      if(again.lane?.ticket!==r.id)return false;
      if(again.state!=='live')return again.state!=='foreign';
      const inWindow=(await window.ls().catch(()=>null))?.agents?.find(a=>a.address===again.terminal.address);
      return TURN_OVER.includes(inWindow?.status||again.terminal.status||'unknown');
    };
    if(holder&&(ended.finished(holder)||ended.dropped(holder)||await outDone(holder))){
      const freed=await lane.release(id);
      if(freed.freed){
        if(ended.dropped(holder))await tell(id,{ticket:holder.id,kind:'canceled'});
        else await log(id,F.tabClosed(T.issue.devTabName(holder.id)),'todo');
      }
      view=await lane.look(id);await said();
    }
    // A ticket is over when accepted and, with ticket branches, merged into the branch of the issue, and its dev stopped.
    const marks=(await load(id)).done;
    const rule=ruleOf(rows,flow,marks,view.lane),due=dueOf(rows);
    // In pause (M11) neither the QA agent nor the Validation: they come after Resume.
    const allOver=due.length&&due.every(rule.over)&&!keptOutHeld(rows,view.lane)&&!(await pausedNow());
    // Held at the end of Develop (point 16): neither the QA agent nor the Validation, and the Lead is not woken; said
    // once per set of tickets, whatever restarts. Set back to Validate (mission-stop-after), it goes on below.
    if(allOver&&stopAfterOf(await missions.read(id))==='develop'){
      const set=due.map(r=>r.id).join(',');
      if(!(await missions.read(id)).heldAt)await missions.update(id,x=>{if(x.heldAt||stopAfterOf(x)!=='develop')return false;x.heldAt=new Date(now()).toISOString();});
      // The mark and its line in one write (claimSay); the notification kept apart, marked once shown: a watcher cut in
      // between, or a notification that failed (false), notifies again at a next pass (twice at worst, never not at all).
      await claimSay(id,'held|'+set,HELD.log,'ok');
      if(!(await load(id)).done['heldnote|'+set]&&await notify(N.title(s.identifier),HELD.notify)!==false)await claim(id,'heldnote|'+set);
    }
    // Work under way again (a correction ticket added after the hold): the mission is no longer held.
    else if(due.length&&!due.every(rule.over)&&(await missions.read(id)).heldAt)await missions.update(id,x=>{if(!x.heldAt)return false;delete x.heldAt;});
    else if(allOver){
      // Every ticket developed in this delivery accepted: the QA agent starts once and writes the test plan; the Lead
      // takes the issue to Validation. A ticket of design, deferred, associated or integrated by another holds nothing.
      // Keyed by the tickets: a correction ticket added in Validation (lot 8) brings QA and the Validation back.
      const set=due.map(r=>r.id).join(',');
      const qaName=T.issue.qaTabName(s.identifier),oldQa=tab(qaName),qaKey='qa|'+set;
      // A QA launch whose answer was lost, or whose tab was never seen, may have made a QA agent (M11 review 1, as the
      // reviewer in M10): reconciled first, and while one stays in doubt no QA agent is made, for no set of tickets.
      const qaDoubts=await qaReconcile(id,agents,qaName);
      for(const k of qaDoubts)await claimSay(id,'qaunsure|'+k,PAUSE.qaUnsure,'fail');
      if(!budgetBlocks(budget,'qa')&&!qaDoubts.length&&oldQa?.status!=='working'&&!(await load(id)).done[qaKey]&&!(await pausedNow())&&await claim(id,qaKey)){
        // Marked as asked before tab.new; launched for sure, it keeps its reservation whatever write fails after it; its
        // answer lost, it keeps it too, as a doubt (lost|…). Only what was refused, or never asked, is given back.
        let asked=false,launched=false,term=null;
        try{
          // Reuse the configured standard Claude review model; no profile (including V1) means Sonnet.
          const model=(await loadConfig()).profiles?.review?.claude?.standard?.model??'claude-sonnet-5-5';
          if(oldQa)await window.run('tab.close',{id:oldQa.tab,confirmed:true});await look();
          await claim(id,'asking|'+qaKey);asked=true;
          const answer=await window.run('tab.new',{name:qaName,space:await spaceOf(),folder:s.worktree,trace:{mission:id,ticket:s.identifier,role:'qa'},argv:devArgv('claude',model,'high',await withAsk(qaTask(s.identifier,s.worktree,due.map(r=>r.id),baseOfPlan(issue.description)||s.base||null,serverOfPlan(issue.description,{repo:s.repo,worktree:s.worktree})),{cmd,worktree:s.worktree,ticket:s.identifier,from:'qa'}))});
          const said=typeof answer?.terminal==='string'?answer.terminal:answer?.terminal?.id;term=typeof said==='string'&&said?said:null;launched=true;
          made.add(qaName);await claim(id,term?'term|'+qaKey:'lost|'+qaKey,term||now());await log(id,F.qaLaunched,'run');await missions.setStep(id,'qa','agent QA lancé');
        }catch(e){
          if(launched){try{await claim(id,term?'term|'+qaKey:'lost|'+qaKey,term||now());}catch{}}
          else if(asked&&e?.uncertain)await claim(id,'lost|'+qaKey);
          else {await unclaim(id,qaKey);if(asked)await unclaim(id,'asking|'+qaKey);}
          await log(id,F.launchFailed('QA'),'fail',String(e.message||e));
        }
      }
      // The Lead told, then the step: each kept once done, each tried again while it fails. With no terminal to tell,
      // it waits for the next step of the chain that finds one.
      if(lead&&await claim(id,'validation|'+set)){
        try{
          const d=await load(id),goes=x=>noteLine(x,file(id))!==null,lines=d.digest.filter(goes).map(x=>noteLine(x,file(id))),withheld=d.digest.filter(x=>!goes(x)),taken=d.digest.length;
          await send({sessionId:sid,terminal:s.terminalId,text:withNews(validationAsk(s.identifier,due.map(r=>r.id)),lines)});await log(id,F.allAccepted,'ok');
          await change(id,d=>{d.digest=d.digest.slice(taken);d.withheld=[...d.withheld,...withheld].slice(-30);});
        }
        catch(e){await unclaim(id,'validation|'+set);await log(id,F.validationFailed,'fail',String(e.message||e));}
      }
      if((await load(id)).done['validation|'+set]&&await claim(id,'check|'+set)){
        try{if(s.role==='po')await setStep({sessionId:sid,step:'check'});await missions.setStep(id,'validating','Validation demandée');}
        catch(e){await unclaim(id,'check|'+set);await log(id,F.validationFailed,'fail',String(e.message||e));}
      }
    }
    // A merge that waits for the Lead: told once, when it is not in the middle of a turn, or woken from its rest.
    const fresh=await load(id),goes=x=>noteLine(x,file(id))!==null;
    if(!fresh.pause&&fresh.digest.some(x=>URGENT.has(x?.kind)&&goes(x))&&['idle','done','rested'].includes(lead?.status)){
      const lines=fresh.digest.filter(goes).map(x=>noteLine(x,file(id))),kept=fresh.digest.filter(x=>!goes(x));
      try{
        await send({sessionId:sid,terminal:s.terminalId,text:actionNote(lines)});
        await change(id,d=>{d.digest=d.digest.slice(fresh.digest.length);d.withheld=[...d.withheld,...kept].slice(-30);});
      }catch{}
    }
    // What the user looked at is shown again only if the window now shows a tab the chain just made.
    if(made.size)await restore(before||shown,made);
    // The next ticket starts on its own, one at a time, when the lane is free: the first of the tickets launched and
    // not over, by its rank (canceled then opened again, it takes its place on its own: rule 2 of decision 48), if no
    // report of it waits for a review or a merge: it has none, or its review asked for corrections, and its dev has
    // work to do. While its report waits for a review or a merge no dev starts, its own or another's. With none of
    // them, the first of the plan, by its rank, whose waits are over. Its agent, model and effort are those of the
    // plan. A dev asked for and not seen is never asked again from here.
    // In Validation, a sub-ticket added since (a correction of a problem the user found) takes its turn the same way.
    const checking=stepIn(m,s)==='check',latest=(await load(id)).done,turn=ruleOf(rows,flow,latest,view.lane);
    const able=r=>Boolean(r.uid)&&turn.waitsOver(r)&&!closed(r)&&['claude','codex'].includes(r.agent)&&r.model&&EFF[r.effort];
    const ready=r=>(r.planned||checking)&&able(r)&&!flow[r.id]?.stage&&!latest['dev|'+r.id];
    const again=r=>able(r)&&[undefined,null,'fix'].includes(flow[r.id]?.stage);
    // A dev seen stopped can resume its own ticket; an unobserved launch stays in doubt.
    // A question or an explicit block still waits for its answer, even if its dev has stopped.
    const available=['free','gone'].includes(view.state),held=available?turn.held():[];
    let resumed=null,next=!available||await pausedNow()?null:held.length?(again(held[0])&&!waiting.has(held[0].id)&&!halted.has(held[0].id)?held[0]:null):due.find(ready)||null;
    // A dev that stops again after the chain resumed it on its own is not resumed a second time (M15 review): said once
    // in the journal, it waits for the user. Simple first: one automatic resume per ticket.
    if(next&&view.state==='gone'&&held.length&&next.id===held[0].id){
      if((await load(id)).done['autoresume|'+next.id]){if(await claim(id,'autoresume-stop|'+next.id))await log(id,F.resumeStopped(next.id),'fail');next=null;}
      else if(await claim(id,'autoresume|'+next.id))resumed='autoresume|'+next.id;else next=null;
    }
    // The gate first (no approval, a ticket outside its copy): refused, said once in the journal, never said launched.
    if(next&&!budgetBlocks(budget,'dev',next.id)){
      const gate=await Promise.resolve().then(()=>approvedOnly(m)).then(()=>copyRefusal(m,next.id,{asked:{tool:next.agent,model:next.model,effort:EFF[next.effort]},row:next.planned?null:ticketOfRow(next)}),error=>error);
      if(gate)await refusedOnce(id,next.id,gate,m);
      // Before any dev of the mission left: the environment read, and kept as read from the line « unblocked » to the
      // launch (M6 b engine review 1): not green, nothing is said nor launched; the next pass reads it again.
      else await withEnvironment(devStarted(m)||envKept?{}:{read:environment,hold:environmentHold},m,async({held:notGreen})=>{
        if(notGreen)return;
        await log(id,F.unblocked(next.id),'run');
        await launchLocked({mission:id,fresh:false,resume:held.length>0,tickets:[{identifier:next.id,tool:next.agent,model:next.model,effort:EFF[next.effort]}]},{auto:true,kept:envKept}).catch(error=>refusedOnce(id,next.id,error).catch(()=>{}));
      });
    }
    // The mark of the automatic resume is given back when nothing was asked of the core (refused, not green, failed
    // before the request): the lane kept in the chain file holds no new launch (read locally, never from the core). A launch asked, even with its answer lost, keeps it (M15 review 2).
    if(resumed&&(await load(id)).lane?.launch===view.lane?.launch)await unclaim(id,resumed).catch(()=>{});
    await record(m,rows,flow,own,lead,waiting);
    await settlePause(id,kept,rows,s,flow);
    return {ran:true};
  }
  // The QA launches asked of the window whose tab was never seen (M11 review 1, as the reviewers in M10): a tab of the
  // name that is its own terminal, or for a launch whose answer was lost one that is no other launch's, settles it,
  // once. What is still in doubt may have made a QA agent: no other is made, and the pause is not said effective.
  async function qaReconcile(id,agents,qaName){
    const marks=(await load(id)).done,attempts=Object.keys(marks).filter(k=>k.startsWith('asking|qa|')).map(k=>k.slice(7));
    const termOf=k=>typeof marks['term|'+k]==='string'?marks['term|'+k]:null,named=agents.filter(a=>a.tab_name===qaName),out=[];
    for(const k of attempts){
      if(marks['shown|'+k]!==undefined)continue;
      const term=termOf(k),others=new Set(attempts.filter(x=>x!==k).map(termOf).filter(Boolean)),own=term?named.find(a=>a.address===term):named.find(a=>!others.has(a.address));
      if(own&&(term||await claim(id,'term|'+k,own.address))){await claim(id,'shown|'+k);continue;}
      out.push(k);
    }
    return out;
  }
  // The reviewers asked of the window for the round of now, whose tab was never seen and whose verdict has not come
  // (asking|, lost| or term| with no shown|): each may be at work.
  const reviewerDoubts=(marks,flow)=>{
    const attempts=new Set(Object.keys(marks).flatMap(k=>{const x=/^(?:asking|lost|term)\|((?:rev|again)\|.+)$/.exec(k);return x?[x[1]]:[];})),out=[];
    for(const k of attempts){
      if(marks['shown|'+k]!==undefined)continue;
      const [,ticket,c,at,n]=k.split('|'),f=flow[ticket];
      if(f?.dev&&(f.dev.commit!==c||(f.dev.at||'')!==at))continue;
      if(f?.reviews?.[Number(n)-1])continue;
      out.push(ticket);
    }
    return out;
  };
  // A pause asked becomes effective once nothing of the mission may run (M11, M11 review 1): the dev of the lane and
  // every tab of a reviewer or of the QA agent of the issue, each proven at the end of its turn (TURN_OVER, decision 86)
  // or gone, and no launch whose fate is not known (a dev asked for and not seen, a reviewer or a QA agent asked of the
  // window and never seen). Anything else keeps it asked, and says what it waits for (`waiting`): its role, its ticket,
  // why (working, unknown, not-seen, foreign) and since when. Under the lock of the lane, at the end of a pass.
  async function settlePause(id,kept,rows,s,flow){
    const p0=(await load(kept)).pause;
    if(p0?.state!=='requested')return;
    const ls=await window.ls().catch(()=>null),v=ls?await lane.look(id).catch(()=>null):null;if(!ls||!v)return pauseBlind(kept);
    const agents=Array.isArray(ls.agents)?ls.agents:[],out=[],why=st=>st==='working'?'working':'unknown';
    if(v.state==='doubt')out.push({role:'dev',ticket:v.lane.ticket,why:'not-seen'});
    else if(v.state==='foreign'||v.state==='old')out.push({role:'dev',ticket:v.lane?.ticket??null,why:v.state==='foreign'?'foreign':'unknown'});
    else if(v.state==='live'){const st=agents.find(a=>a.address===v.terminal.address)?.status||v.terminal.status||'unknown';if(!TURN_OVER.includes(st))out.push({role:'dev',ticket:v.lane.ticket,why:why(st)});}
    const busy=a=>a.shell!==true&&!TURN_OVER.includes(a.status||'unknown');
    for(const r of rows)for(const n of [1,2])for(const a of agents.filter(x=>x.tab_name===T.issue.reviewTabName(r.id,n)&&busy(x)))out.push({role:'reviewer',ticket:r.id,why:why(a.status)});
    const qaName=T.issue.qaTabName(s.identifier);
    for(const a of agents.filter(x=>x.tab_name===qaName&&busy(x)))out.push({role:'qa',ticket:s.identifier,why:why(a.status)});
    for(const ticket of reviewerDoubts((await load(kept)).done,flow))out.push({role:'reviewer',ticket,why:'not-seen'});
    if((await qaReconcile(kept,agents,qaName)).length)out.push({role:'qa',ticket:s.identifier,why:'not-seen'});
    const at=new Date(now()).toISOString(),key=w=>w.role+'|'+w.ticket+'|'+w.why,since=new Map((p0.waiting||[]).map(w=>[key(w),w.since]));
    const waiting=[...new Map(out.map(w=>[key(w),{...w,since:since.get(key(w))||at}])).values()];
    await change(kept,d=>{
      if(d.pause?.state!=='requested'||d.pause.at!==p0.at)return;
      if(waiting.length){d.pause={...d.pause,waiting};return;}
      const {waiting:_,...rest}=d.pause;d.pause={...rest,state:'paused',pausedAt:at};
      said(d,'paused',rest.at,now());
    });
  }
  // A pass that could not read the state of the agents (M11 review 2): an asked pause says so, dated from the instant it
  // was asked, so its alert comes after five minutes as for any cause that is not an agent seen at work. What it waited
  // for before is kept; nothing is made effective, nothing resumes.
  async function pauseBlind(kept){
    await change(kept,d=>{
      if(d.pause?.state!=='requested')return;
      const w=(d.pause.waiting||[]).filter(x=>x.why!=='unreadable');
      d.pause={...d.pause,waiting:[...w,{role:'agents',ticket:null,why:'unreadable',since:d.pause.at}]};
    });
  }
  // A line of the pause in the journal, once for the pause asked at `pauseAt` (its mark keeps the exact instant: Resume
  // never takes it away).
  function said(d,kind,pauseAt,at){
    const key='pause|'+kind+'|'+pauseAt;
    if(d.done[key]!==undefined)return;
    d.done[key]=at;d.log=[...d.log,{at:clock(new Date(at)),text:PAUSE_LOG[kind],tone:kind==='resumed'?'run':'wait',detail:''}].slice(-LOG_MAX);
  }
  // « Pause » and « Resume » (M11; simulation/CONTRAT.md § 2 quater), clicks of the user on the screen. The pause is
  // written for good in the file of the chain, under the lock of the lane of the mission (M11 review 1): the lock every
  // start is made under (a dev, a reviewer, the QA agent, the corrections, the answers carried). Confirmed, it was
  // written while no pass ran, and every pass after it reads it: nothing starts after it. The agent at work finishes its
  // turn. Asked twice it changes nothing. Resume lifts it, asked or effective, and starts nothing itself: the next pass
  // takes up where the series stopped. A lane held longer than its patience answers DEV_LANE_BUSY: nothing is written.
  async function paused(raw){
    if(!raw||typeof raw!=='object'||Array.isArray(raw)||Object.keys(raw).some(k=>k!=='mission'))fail('INVALID_ARGUMENT','Expected {mission}.');
    const {id,kept,mission}=await work({mission:raw.mission});
    if(!missionActive(mission))fail('MISSION_OVER','This mission is over.');
    return {id,kept};
  }
  // What the page is told: the state, its instants, and while it is asked what it waits for, the agent it names, and an
  // alert once a cause that is not an agent seen at work lasts (PAUSE_ALERT_MS). Never made effective on a delay.
  const pauseShown=p=>{
    if(!p)return {state:'none'};
    const w=p.state==='requested'&&Array.isArray(p.waiting)?p.waiting:[],first=w.find(x=>x.why==='working');
    const alert=w.some(x=>x.why!=='working'&&now()-Date.parse(x.since)>=PAUSE_ALERT_MS);
    return {state:p.state,at:p.at,...(p.pausedAt?{pausedAt:p.pausedAt}:{}),...(w.length?{waiting:w.map(x=>({...x}))}:{}),...(first?{agent:{role:first.role}}:{}),...(alert?{alert:true}:{})};
  };
  // Under the lock, the step is read again (M11 review 2): a Validation (or a closure) made just before the click took
  // the mission out of Develop, where alone « Resume » is drawn; the pause is then refused (PAUSE_NOT_DEVELOP), never
  // left with no way to lift it on the screen.
  async function pause(input){
    const {id,kept}=await paused(input);
    return lane.withLane(id,async()=>{
      const m=await missions.read(id);
      if(!missionActive(m))fail('MISSION_OVER','This mission is over.');
      const ms=now(),at=new Date(ms).toISOString(),p=await change(kept,d=>{
        if(d.pause)return d.pause;
        if(m.step!=='building')fail('PAUSE_NOT_DEVELOP',PAUSE.notDevelop);
        d.pause={state:'requested',at};said(d,'requested',at,ms);return d.pause;
      });
      return {mission:id,pause:pauseShown(p)};
    });
  }
  async function resume(input){
    const {id,kept}=await paused(input);
    return lane.withLane(id,async()=>{await change(kept,d=>{if(d.pause)said(d,'resumed',d.pause.at,now());d.pause=null;});return {mission:id,pause:pauseShown(null)};});
  }
  // A change of step asked from outside the chain (the Lead's Validation, its closure: M11 review 1), made under the
  // lock of the lane, the pause read right before it: refused in pause (MISSION_PAUSED), nothing written. The task never
  // takes the lock of the lane itself.
  // A task under the lock of the lane of a mission, paused or not (mission-stop-after, chantier 1 point 16).
  async function underLane(mission,task){const m=await missions.read(mission);return lane.withLane(m.id,task);}
  async function unpaused(mission,task){
    const {id,kept}=await work({mission});
    return lane.withLane(id,async()=>{if((await load(kept)).pause)fail('MISSION_PAUSED',PAUSE.steps);return task();});
  }
  // Every mission under way, whatever its terminals; one that fails does not stop the others, and one whose lane is
  // busy (a launch, another step) is skipped: the next pass takes it.
  // A mission closed (lead-close, at the user's request) keeps no agent: its Lead's tab is closed once the Lead is idle or
  // done (it may still be writing its last summary), and never again after (closedOutAt). Simple first: nothing else.
  const CLOSE_OUT_SINCE='2026-11-17T20:00:00.000Z';
  async function closeOut(){
    let view=null;
    for(const m of await missions.list({}).catch(()=>[])){
      // Only a mission whose closure was asked from this version on: an older one may have its terminal given to another.
      if(m.step!=='closed'||!m.lead?.sessionId||m.lead.closedOutAt||!(Date.parse(m.closeAskedAt||'')>=Date.parse(CLOSE_OUT_SINCE)))continue;
      const s=((await loadState()).sessions||[]).find(x=>x.id===m.lead.sessionId)||null;
      try{view??=await window.ls();}catch{return;}
      const agent=s?.terminalId?view.agents.find(a=>a.address===s.terminalId)||null:null;
      if(agent&&!['idle','done'].includes(agent.status))continue;
      // A tab shared with another terminal is left as it is: only the Lead's own tab is closed.
      if(agent?.tab&&!view.agents.some(a=>a.tab===agent.tab&&a.address!==agent.address))try{await window.run('tab.close',{id:agent.tab,confirmed:true});}catch{continue;}
      await missions.update(m.id,x=>{if(!x.lead||x.lead.closedOutAt)return false;x.lead={...x.lead,closedOutAt:new Date(now()).toISOString()};});
    }
  }
  async function tickAll(){
    const out=[],why=e=>String(e.message||e).slice(0,300);
    await closeOut().catch(()=>{});
    for(const m of await missions.list({active:true}))try{out.push({mission:m.id,...await tick({mission:m.id},{patient:false})});}catch(e){out.push(e?.code==='DEV_LANE_BUSY'?{mission:m.id,ran:false,skipped:'busy'}:{mission:m.id,error:why(e)});}
    return {missions:out};
  }
  // What the page shows: the reports, the story, whether the chain runs, when its QA agent was last launched.
  // Read only: the chain of an adopted or resumed mission is shown as settle would leave it, never moved from here.
  async function read(input){
    const {kept,mission:m,session:s}=await work(input,null,{write:false});
    const chain=await shown_(kept),rep=s?await reports({sessionId:s.id}):{reports:[],command:null};
    return {...rep,log:chain.log,on:chain.on||Boolean(m?.resumedFrom&&unsettled(m)),metrics:metricsOf(chain.done),timings:timingsOf(chain.done,rep.reports,{now:now()}),qa:qaLaunchOf(chain.done),pause:pauseShown(chain.pause)};
  }
  // What the list of the missions shows of a chain.
  async function brief(id){const chain=await shown_(id);return {on:chain.on,journal:chain.log.slice(-JOURNAL_SHORT)};}
  // Forgets the issues kept from the tracker (the next tick reads them again).
  const forget=()=>issues.clear();
  return {launch,tick,tickAll,read,brief,forget,pause,resume,unpaused,underLane};
}

