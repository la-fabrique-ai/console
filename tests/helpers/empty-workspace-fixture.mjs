import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { worktreeFixture } from './worktree-fixture.mjs';
import { createWorkspaceState } from '../../src/workspace-state.mjs';
import { createCommands } from '../../src/commands.mjs';
import { claimTarget } from '../../src/workspace-paths.mjs';
import { proposeCleanup } from '../../src/workspace-cleanup.mjs';

export async function emptyWorkspaceFixture(t) {
  const f=await worktreeFixture(t),plan=await f.plan(),claimedPath=await claimTarget(plan),store=createWorkspaceState(f.home),git=createCommands({exec:f.command}).git;
  const attempt={...plan,plan,preparationId:randomUUID(),issueId:plan.issue.id,role:'dev',tool:'codex',status:'failed-certain',phase:'failed-certain',goState:'requested',ownerActive:false,worker:null,claimedPath};
  const proposal=await proposeCleanup(attempt,{state:'failed-owned-empty'},git);assert.ok(proposal);
  await store.update(state=>state.attempts.push(attempt));
  return {...f,plan,store,git,attempt,proposal,id:attempt.preparationId,worktree:attempt.worktree,proof:{cleanupProposal:proposal,preparation:{planId:plan.planId}}};
}
