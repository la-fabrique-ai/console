import test from 'node:test';
import assert from 'node:assert/strict';
import { APPROVAL } from '../src/mission.mjs';

// Decision 74: the seven refusals of the approval, in the words Codex recommended and the user chose, word for word.
test('the seven refusals of the approval say the words of decision 74',()=>{
  // The reapproval of M7 and the Lead waiting in its terminal: the words of decision 87 (tests/m7-wording-engine.test.mjs).
  // The environment not ready (decision 111): provisional words, tests/m6b-launch-refusal.test.mjs.
  const {notStarted:_n,noDrift:_d,driftChanged:_c,reopen:_r,waiting:_w,environment:_e,...decided}=APPROVAL;
  assert.deepEqual(decided,{
    open:'Answer the pending question or request before approving.',
    changed:'The plan has changed. Review the updated plan before approving.',
    missing:'There is no plan to approve yet.',
    started:'Development has already started. No approval is needed.',
    busy:'Another approval is being saved. Try again in a moment.',
    unsure:'The launch is not confirmed. Its status is being checked.',
    working:'The Lead is still preparing. Wait until it finishes, then approve.',
  });
});
