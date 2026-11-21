import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { agentFor, caller, refused, startAgent, sendOnce } from "./agents.ts";
import { CommandError, type Payloads, type TicketStep } from "./contract.ts";
import { github, remoteError } from "./github.ts";
import { loadDetail, saveMission, visible, withMission } from "./missions.ts";
import { recordRequest } from "./requests.ts";
import { gitAt, worktree } from "./pilot.ts";

export function done(dir: string, repository: string, p: Payloads["dev.done"]) {
  return withMission(dir, p.issueKey, () => {
    const m = loadDetail(dir, p.issueKey);
    const dev = caller(m, "dev.done", p.ticketId);
    const development = m.development!;
    const run = development.tickets.find(t => t.id === p.ticketId)!;
    const ticket = m.plan!.tickets.find(t => t.id === p.ticketId)!;
    const last = run.steps.at(-1)!;

    if (last.kind === "review" && !last.endedAt) {
      const reviewer = m.agents!.reviewer!;
      if (reviewer.starting) {
        const handoff = run.steps.at(-2)!;
        startAgent(dir, m, reviewer, true, ticket, handoff.commit, handoff.summary);
      }
      return visible(m);
    }
    const waitingForAnswer = development.requests.some(r => r.ticketId === p.ticketId && !r.answer);
    if (last.endedAt || last.kind === "review" || !p.summary?.trim() || waitingForAnswer) throw refused();

    const mission = worktree(repository, m.issueKey);
    const cwd = worktree(repository, ticket.key!, false, run.branch);
    const missionBranch = "mission/" + m.issueKey;
    if (!m.publication) {
      const commit = gitAt(cwd, "rev-parse", "HEAD").trim();
      const base = gitAt(mission, "rev-parse", "HEAD").trim();
      const previous = run.steps.findLast(s => s.commit)?.commit ?? base;
      const dirty = gitAt(cwd, "status", "--porcelain", "--untracked-files=all", "--ignore-submodules=none").trim();
      if (dirty || commit === previous || gitAt(cwd, "merge-base", commit, previous).trim() !== previous) {
        throw new CommandError("Commitez vos modifications sur la branche du ticket avant de demander une revue.");
      }
      m.publication = { commit, base, summary: p.summary };
      saveMission(dir, m);
    }

    const { commit, base, summary } = m.publication;
    try {
      const remote = github(mission);
      remote.publish(missionBranch, base);
      remote.publish(run.branch, commit);
      development.pr = remote.draft(missionBranch, "main", base, m.title);
      run.pr = remote.draft(run.branch, missionBranch, commit, ticket.title);
    } catch { throw remoteError(); }

    const tool = dev.tool === "claude" ? "codex" : "claude";
    const review = agentFor(m, "reviewer", tool, "", ticket.id);
    review.base = base;
    review.cwd = join(dirname(cwd), review.terminal);
    gitAt(mission, "worktree", "add", "--detach", review.cwd, commit);
    Object.assign(last, { endedAt: new Date().toISOString(), summary, commit });
    run.steps.push({ kind: "review", tool, startedAt: new Date().toISOString() });
    m.agents!.reviewer = review;
    delete m.publication;
    saveMission(dir, m);
    startAgent(dir, m, review, false, ticket, commit, summary);
    return visible(m);
  });
}

function finishNotice(dir: string, m: ReturnType<typeof loadDetail>) {
  if (!m.notice) return visible(m);
  const { terminal, deliveryId, event } = m.notice;
  sendOnce(dir, terminal, deliveryId, event);
  delete m.notice;
  saveMission(dir, m);
  return visible(m);
}

export function verdict(dir: string, repository: string, p: Payloads["review.verdict"]) {
  return withMission(dir,p.issueKey, () => {
    const m = loadDetail(dir,p.issueKey), agent = caller(m,"review.verdict",p.ticketId);
    const run = m.development!.tickets.find(r => r.id === agent.ticketId)!;
    const previous = run.steps.findLast(s => s.kind === "review")!;
    if (typeof p.accepted !== "boolean" || !Array.isArray(p.remarks) || !p.remarks.every(v => typeof v === "string" && v.trim()) ||
        (p.accepted ? p.remarks.length !== 0 : !p.remarks.length)) throw refused();
    if (previous.endedAt) {
      if (previous.accepted !== p.accepted) throw refused();
      return finishNotice(dir, m);
    }
    const waitForAnswer = "Attendez la réponse de l’opérateur, puis rappelez review.verdict.";
    if (m.development!.requests.some(r => r.ticketId === p.ticketId && !r.answer)) throw new CommandError(waitForAnswer);
    const sha = run.steps.at(-2)!.commit!;
    if (p.accepted) {
      m.merging = true; saveMission(dir,m);
      let merged: boolean;
      try { merged = github(worktree(repository, m.issueKey)).merge(run.branch, "mission/" + m.issueKey, sha, run.pr!.number); }
      catch (err) { throw err instanceof CommandError ? err : remoteError(); }
      if (!merged) {
        recordRequest(m, agent, {
          ticketId: run.id,
          text: "Pouvez-vous désactiver la suppression automatique des branches dans les réglages du dépôt GitHub ?",
          context: "La branche du ticket doit être conservée après la fusion.",
          choices: ["Le réglage est corrigé. Reprenez la fusion."],
        });
        saveMission(dir, m);
        throw new CommandError(waitForAnswer);
      }
    } else if (m.merging) throw refused();
    if (existsSync(agent.cwd) && !gitAt(agent.cwd, "status", "--porcelain", "--untracked-files=all").trim()) {
      gitAt(worktree(repository, m.issueKey), "worktree", "remove", agent.cwd);
    }
    delete m.merging;
    Object.assign(previous, { endedAt: new Date().toISOString(), accepted: p.accepted, remarks: p.remarks });
    const dev = m.agents!.dev!;
    if (!p.accepted) run.steps.push({ kind: "fix", tool: dev.tool, startedAt: new Date().toISOString() } satisfies TicketStep);
    m.notice = {
      deliveryId: randomUUID(), terminal: (p.accepted ? m.agents!.lead! : dev).terminal,
      event: { action: "review.verdict", issueKey: m.issueKey, ticketId: run.id, accepted: p.accepted, remarks: p.remarks, commit: sha },
    };
    saveMission(dir, m);
    return finishNotice(dir, m);
  });
}
