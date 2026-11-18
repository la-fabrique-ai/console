import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Decision 76: the FABRIQUE_CONSOLE_AGENT barrier is kept as it is, and its limit is written as it is: the mark stops mistakes, not
// an agent that tries to get through (env -u, the mission file written directly, devs in bypassPermissions).
test('the reference says the limit of the barrier as it is, for mission-launch and inbox-answer',async()=>{
  const md=await readFile(new URL('../docs/backend-interface.md',import.meta.url),'utf8');
  for(const action of ['mission-launch','inbox-answer']) {
    const at=md.indexOf('### `'+action+'`');assert.ok(at>=0,action);
    const section=md.slice(at,md.indexOf('\n### ',at+5));
    assert.match(section,/arrête les erreurs, pas un agent qui cherche à passer/,action);
    assert.match(section,/env -u FABRIQUE_CONSOLE_AGENT/,action);
    assert.match(section,/state\/missions\/M-<n>\.json/,action);
    assert.match(section,/bypassPermissions/,action);
    assert.doesNotMatch(section,/programme écrit exprès/,action+': the old limit, narrower than the real one');
  }
});
