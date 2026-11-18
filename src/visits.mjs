import { join } from 'node:path';
import { fail, patientLock, readJSON, writeJSON } from './common.mjs';
import { W } from '../ui/v4/words.js';

// Ticket M14, « Since your last visit »: what happened on a mission while the user was not looking at its page.
//
// The engine keeps, apart from the mission (state/visits/M-<n>.json), one cursor per mission: `upTo`, the instant of
// the last fact the page of the ticket showed and acknowledged, and `at`, when it acknowledged it (the title « Since
// yesterday, 7:10 pm »). A reading never moves it: mission-read only reads. Only the explicit acknowledgement of the
// screen does (mission-visit-seen, a command of the screens, refused from a session of an agent), which the page sends
// after it drew the recap, and only while it is visible. What was accepted after `upTo` stays to show: an answer lost,
// a page closed or the tool started again loses no fact, and a fact shown and acknowledged never comes back. A cursor
// that cannot be read is unknown, never « nothing »: the recap is said unavailable, and it is never written over.
const ID=/^M-\d{1,7}$/,TICKET=/^[A-Z][A-Z0-9]*-\d+$/,ISO=/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/;
const instant=value=>typeof value==='string'&&ISO.test(value)&&Number.isFinite(Date.parse(value))?Date.parse(value):NaN;
// What readJSON gives back for a file that does not exist: a file that holds `null` is not absent, it is unreadable.
const ABSENT=Symbol('absent');
const missionId=mission=>{if(typeof mission!=='string'||!ID.test(mission))fail('INVALID_ARGUMENT','Expected a mission identifier (M-<n>).');return mission;};
export function createVisits({root,now=Date.now}) {
  const dir=join(root,'state','visits'),lockDir=join(root,'state','visits-lock'),pathOf=mission=>join(dir,missionId(mission)+'.json');
  // {upTo, at}, both null before the first acknowledgement (no file). A file that is not a cursor (`null` included) is
  // unreadable: never nothing.
  async function load(path) {
    const kept=await readJSON(path,ABSENT);
    if(kept===ABSENT)return {upTo:null,at:null};
    if(!kept||typeof kept!=='object'||Array.isArray(kept)||!Number.isFinite(instant(kept.upTo))||!Number.isFinite(instant(kept.at)))fail('INVALID_DATA','The visits of this mission cannot be read.');
    return {upTo:kept.upTo,at:kept.at};
  }
  const read=mission=>load(pathOf(mission));
  // The acknowledgement of the screen: the cursor goes to `upTo`, never back (two pages may acknowledge in any order),
  // never beyond the present (an instant to come is brought back to now: a fact to come is never acknowledged).
  async function seen(mission,upTo) {
    const path=pathOf(mission),to=instant(upTo);
    if(!Number.isFinite(to))fail('INVALID_ARGUMENT','upTo must be an ISO instant.');
    return patientLock(lockDir,async()=>{
      const t=now(),kept=await load(path),record={upTo:new Date(Math.max(Math.min(to,t),instant(kept.upTo)||-Infinity)).toISOString(),at:new Date(t).toISOString()};
      await writeJSON(path,record);
      return record;
    });
  }
  return {read,seen};
}

// When each ticket was accepted, from the marks the chain keeps for good (src/dev-chain.mjs: ok|<ticket>|<commit>, the
// instant it claimed the acceptance). A ticket accepted again after a fix counts once, at its last acceptance. A mark
// without a time (work taken up from its reports) has no instant: it is never shown as new.
export function acceptedOf(done) {
  const out={};
  for(const [key,at] of Object.entries(done&&typeof done==='object'?done:{})){
    const [kind,ticket]=key.split('|');
    if(kind!=='ok'||!TICKET.test(ticket||'')||typeof at!=='number'||!Number.isFinite(at))continue;
    out[ticket]=Math.max(out[ticket]??at,at);
  }
  return out;
}
// The marks of the chain of a mission, read only. Absent (nothing launched yet): none. A file that cannot be read, or
// that is not the chain's (`null` included), throws: unknown is not nothing.
export async function chainDone(root,mission) {
  const d=await readJSON(join(root,'state','devchain-'+missionId(mission)+'.json'),ABSENT);
  if(d===ABSENT)return {};
  if(!d||typeof d!=='object'||Array.isArray(d)||(d.done!==undefined&&(!d.done||typeof d.done!=='object'||Array.isArray(d.done))))fail('INVALID_DATA','The chain of this mission cannot be read.');
  return d.done||{};
}
// What the engine says of a ticket accepted, in the words of the page (ui/v4/words.js): its fixing rounds, then how
// many reviews it had (review 1, review 2), from its steps (ticket M8). Nothing known: no note.
const S=W.page.side.since;
export function noteOf(steps) {
  const list=Array.isArray(steps)?steps:[];
  const reviews=new Set(list.filter(s=>/^review-[12]$/.test(s?.step)&&s.verdict).map(s=>s.step)).size,fixes=list.filter(s=>s?.step==='fix').length;
  const parts=[fixes?S.fixes(fixes):'',reviews?S.reviews(reviews):''].filter(Boolean);
  return parts.length?parts.join(', '):null;
}
// Every fact the recap can tell: each ticket accepted (at its last acceptance) and each verdict left to the user that
// still waits, the newest first.
export function factsOf({done={},timings={},items=[]}={}) {
  const events=[];
  for(const [ticket,at] of Object.entries(acceptedOf(done))){
    const note=noteOf(timings?.[ticket]);
    events.push({kind:'accepted',ticket,at:new Date(at).toISOString(),...(note?{note}:{})});
  }
  for(const item of Array.isArray(items)?items:[]){
    const at=Date.parse(item?.createdAt);
    if(item?.kind!=='verdict'||item.answer||!TICKET.test(item.ticket||'')||!Number.isFinite(at))continue;
    events.push({kind:'verdict',ticket:item.ticket,at:new Date(at).toISOString(),note:S.leftToYou,item:item.id});
  }
  return events.sort((a,b)=>b.at.localeCompare(a.at));
}
// What mission-read says of the visit (simulation/CONTRAT.md: visit, overnight). `visit.upTo` is the cursor (null before
// the first acknowledgement ever). `overnight`: the facts after the cursor, the newest first; before the first
// acknowledgement, every fact of the mission (all came after its creation): a first visit shows what happened, and the
// page acknowledges only what it drew. Absent when nothing happened since.
export function sinceVisit({record={upTo:null,at:null},...sources}={}) {
  const facts=factsOf(sources),cursor=instant(record?.upTo),first=!Number.isFinite(cursor),from=first?-Infinity:cursor;
  const events=facts.filter(e=>Date.parse(e.at)>from),visit={since:first?null:record.at,upTo:first?null:record.upTo};
  return events.length?{visit,overnight:{accepted:events.filter(e=>e.kind==='accepted').length,since:visit.since,events}}:{visit};
}
