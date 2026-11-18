import { fail } from './common.mjs';

export const terminalId=t=>t?.id??t?.address??t?.terminal_id??t?.terminal?.id??t?.terminal?.address;
export const labels=t=>Array.isArray(t.labels)?Object.fromEntries(t.labels.map(label=>typeof label==='string'?label.split(/=(.*)/s).slice(0,2):[label.key,label.value])):t.labels??{};
export function terminalState(t) {
  if(!t) return 'historical';
  if(t.state==='finished'||t.state==='exited'||t.exited===true) return 'historical';
  if(t.reported===false)return 'unknown';
  const status=typeof t.status==='string'?t.status:t.status?.status??t.status?.state??t.agent?.status;
  return ['working','blocked','idle','done','error'].includes(status)?status:'unknown';
}
// The terminal of a session: the one that carries its label. Labels that contradict the session (another role,
// another issue) or several claimants are a local inconsistency, never silently resolved. The sessions of the first
// version name no role, and their terminals carry no role label: one that does belongs to another work.
export function ownedTerminal(terminals,session) {
  const claimants=terminals.filter(t=>labels(t)['fabrique-console.session']===session.id&&labels(t)['fabrique-console.app']==='fabrique-console');
  if(claimants.length>1)fail('TERMINAL_OWNERSHIP','Several terminals claim this session. Inspect herdr-core before retrying.');
  const terminal=claimants[0]||null,own=terminal?labels(terminal):{};
  if(terminal&&((own['fabrique-console.role']&&own['fabrique-console.role']!==session.role)||(own['fabrique-console.issue']&&session.issueId&&own['fabrique-console.issue']!==session.issueId)))fail('TERMINAL_OWNERSHIP','The terminal of this session carries the labels of another work. Inspect local session state.');
  return terminal;
}
export function parsed(stdout) {try {return JSON.parse(stdout);}catch{fail('HC_PROTOCOL','hc returned invalid JSON.');}}
