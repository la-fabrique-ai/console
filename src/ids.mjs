import { join } from 'node:path';
import { fail, patientLock, readJSON, writeJSON } from './common.mjs';

// The durable names of the new model — a mission M-n, a question Q-n, an element of the Inbox I-n, a decision D-n. They outlive
// every terminal, so they are counted once, under a lock that waits, in <root>/state/ids.json.
const KINDS=['M','Q','I','D','MK'];
export async function nextId(root,kind) {
  if(!KINDS.includes(kind))fail('INVALID_ARGUMENT','Unknown kind of identifier.');
  const dir=join(root,'state'),path=join(dir,'ids.json');
  return patientLock(dir,async()=>{
    const counters=await readJSON(path,{}),n=(Number.isSafeInteger(counters[kind])?counters[kind]:0)+1;
    await writeJSON(path,{...counters,[kind]:n});
    return kind+'-'+n;
  });
}
