import { join } from 'node:path';
import { fail, patientLock } from './common.mjs';

// Chantier 1, lot 1B: a Lead the chain put to rest has no terminal. Every message to a Lead goes through this one
// send: a Lead at rest is woken first (the same session, a new terminal, a fresh context: po-launch's `lead`), then
// told. Any other message goes as it is.
// The rest of a Lead, every message to it and every launch of it take the same lock of its mission (leadLock): a Lead
// is never closed between the moment it is found and the moment it is told or taken up, and the mission says when it
// was told last (toldAt, written before the message goes: a message whose answer is lost may have arrived), for the
// rest to start its idle time over.
// Only the id of a mission names a lock: anything else is refused before a folder is made for it.
export const MISSION_ID=/^M-\d{1,7}$/;
export const leadLock=(root,mission,task)=>{
  if(typeof mission!=='string'||!MISSION_ID.test(mission))fail('INVALID_ARGUMENT','mission must be the id of a mission.');
  return patientLock(join(root,'state','lead',mission),task);
};
// The terminals of a Lead closed by a rest, kept with its mission: a message given one of them is for the Lead.
export const CLOSED_KEPT=5;

export function createLeadWake({root,loadState,missions,leadLaunch,send,now=Date.now,lock=(mission,task)=>leadLock(root,mission,task)}) {
  const sessionOf=async id=>((await loadState()).sessions||[]).find(s=>s.id===id)||null;
  const forLead=(input,session,mission)=>input.terminal===session.terminalId||(mission?.lead?.sessionId===session.id&&(mission.lead.closedTerminals||[]).includes(input.terminal));
  const wake=async input=>{
    const first=await sessionOf(input?.sessionId);
    if(first?.role!=='lead'||!first.missionId||first.stoppedAt)return send(input);
    // A message to a dev is sent with the session of its Lead too: only a terminal of the Lead is the Lead.
    if(!forLead(input,first,await missions.read(first.missionId).catch(()=>null)))return send(input);
    return lock(first.missionId,async()=>{
      // Read again under the lock: another message, or another process, may have woken it meanwhile.
      const session=await sessionOf(first.id)||first,mission=await missions.read(first.missionId).catch(()=>null);
      const own=mission?.lead?.sessionId===session.id;
      let terminal=session.terminalId;
      if(own&&mission.lead.restedAt)terminal=(await leadLaunch({mission:mission.id},{locked:true})).session.terminalId;
      if(own)await missions.update(mission.id,m=>{if(m.lead?.sessionId!==session.id)return false;m.lead={...m.lead,toldAt:new Date(now()).toISOString()};});
      return send({...input,sessionId:session.id,terminal});
    });
  };
  // A launch of a mission by its id takes the lock; a launch by project and issue (Pilot's) does not need it:
  // po.lead keeps the mark of a rest on a terminal it takes up outside the lock.
  wake.launch=async input=>input&&Object.hasOwn(input,'mission')?lock(input.mission,()=>leadLaunch(input,{locked:true})):leadLaunch(input);
  return wake;
}
