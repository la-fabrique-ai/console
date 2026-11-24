import { CommandError, type TicketRun } from "./contract.ts";
import { github, remoteError } from "./github.ts";
import { saveMission, type SavedMission } from "./missions.ts";
import { gitAt, worktree } from "./pilot.ts";

// The publication slice owns these operations and the mission lock. Runtime never calls them.
export function publishTicket(dir: string, repository: string, m: SavedMission, run: TicketRun, submittedSummary: string) {
  const ticket = m.plan!.tickets.find(t => t.id === run.id)!;
  const mission = worktree(repository, m.issueKey);
  const cwd = worktree(repository, ticket.key!, false, run.branch);
  const missionBranch = "mission/" + m.issueKey;
  if (!m.publication) {
    const commit = gitAt(cwd, "rev-parse", "HEAD").trim();
    const base = gitAt(mission, "rev-parse", "HEAD").trim();
    const previous = run.steps.findLast(s => s.commit)?.commit ?? base;
    const dirty = gitAt(cwd, "status", "--porcelain", "--untracked-files=all", "--ignore-submodules=dirty").trim();
    if (dirty || commit === previous || gitAt(cwd, "merge-base", commit, previous).trim() !== previous) {
      throw new CommandError("Commitez vos modifications sur la branche du ticket avant de demander une revue.");
    }
    m.publication = { commit, base, summary: submittedSummary };
    saveMission(dir, m);
  }

  const { commit, base, summary } = m.publication;
  try {
    const remote = github(mission);
    remote.publish(missionBranch, base);
    remote.publish(run.branch, commit);
    m.development!.pr = remote.draft(missionBranch, "main", base, m.title);
    run.pr = remote.draft(run.branch, missionBranch, commit, ticket.title);
  } catch { throw remoteError(); }

  Object.assign(run.steps.findLast(step => step.kind !== "review")!, { summary, commit });
  delete m.publication;
  saveMission(dir, m);
}

export function mergeTicket(dir: string, repository: string, m: SavedMission, run: TicketRun, sha: string) {
  m.merging = true;
  saveMission(dir, m);
  let merged: boolean;
  try { merged = github(worktree(repository, m.issueKey)).merge(run.branch, "mission/" + m.issueKey, sha, run.pr!.number); }
  catch (err) { throw err instanceof CommandError ? err : remoteError(); }
  if (merged) {
    delete m.merging;
    saveMission(dir, m);
  }
  return merged;
}
