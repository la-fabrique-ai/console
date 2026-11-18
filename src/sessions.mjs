import { fail, writeJSON, withLock } from './common.mjs';
import { now } from './state.mjs';
import { legacyProjects } from './config.mjs';
import { terminalId, labels, terminalState, ownedTerminal } from './terminals.mjs';

export function createSessions({root,getTickets,loadConfig,loadState,readTerminals,qaFor,observeQA,getSession,statePath,herdr}) {
  const observedSession=async(session,terminals)=>{
    const terminal=terminals?.find(t=>labels(t)['fabrique-console.session']===session.id&&labels(t)['fabrique-console.app']==='fabrique-console');
    return {...session,status:terminals?terminalState(terminal):'unknown',qa:observeQA(await qaFor(session),terminals)};
  };
  async function snapshot(input) {
    const tickets=await getTickets();
    const config=await loadConfig(),state=await loadState();const warnings=[];let terminals;
    try {terminals=await readTerminals();}catch(error){warnings.push({code:error.code,message:error.message});}
    const sessions=await Promise.all(state.sessions.map(s=>observedSession(s,terminals)));
    return {config,projects:legacyProjects(config),sessions,tracker:{configured:await tickets.configured(),...tickets.connection},warnings};
  }
  async function stop(input) {
    if(input.confirmed!==true)fail('CONFIRMATION_REQUIRED','Stopping a session requires confirmed: true.');
    return withLock(root,async()=>{
      const state=await loadState(),session=getSession(state,input.sessionId);const terminals=await readTerminals();
      // Several terminals claiming the session, or one carrying the labels of another work, stop nothing.
      const terminal=ownedTerminal(terminals,session);
      if(!terminal&&terminals.some(t=>terminalId(t)===session.terminalId))fail('TERMINAL_OWNERSHIP','The terminal ID belongs to another session; it was not stopped.');
      if(terminal&&terminalState(terminal)!=='historical') {
        try {await herdr.kill(terminalId(terminal));}catch{fail('STOP_FAILED','The owned session terminal could not be stopped.');}
      }
      session.stoppedAt=now();session.updatedAt=now();session.launchUncertain=false;await writeJSON(statePath,state);
      return {session:{...session,status:'historical',qa:await qaFor(session)}};
    });
  }
  return {observedSession,snapshot,stop};
}
