import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { CommandError, type Action, type Payloads, type PlanTicket, type Tool } from "./contract.ts";
import { loadDetail, saveMission, visible, withMission, type SavedMission } from "./missions.ts";
import { coreEnvironment, gitAt, worktree } from "./pilot.ts";

export interface Agent {
  id: string; role: "lead" | "dev" | "reviewer"; tool: Tool; terminal: string; cwd: string; ticketId?: string; starting?: boolean; base?: string;
}
export const refused = () => new CommandError("Cette action n’est pas autorisée pour cet agent.");
const unavailable = () => new CommandError("Le démarrage de l’agent n’est pas confirmé. Vérifiez son terminal.");

export function caller(m: SavedMission, action: Action, ticketId?: string) {
  const agent = Object.values(m.agents ?? {}).find(a => a.id === process.env.MC_AGENT_ID);
  if (!agent || (agent.role !== "lead" && agent.ticketId !== ticketId && !(action === "request.ask" && ticketId === undefined)) ||
      !(action === "request.ask" || action === { lead: "lead.build", dev: "dev.done", reviewer: "review.verdict" }[agent.role])) throw refused();
  return agent;
}

export function sendOnce(dir: string, terminal: string, deliveryId: string, event: object) {
  if (existsSync(join(dir, "..", "receipts", terminal, deliveryId))) return;
  try {
    execFileSync("hc", ["send", "--", terminal, JSON.stringify({ ...event, deliveryId })],
      { env: coreEnvironment(), timeout: 15_000, stdio: "pipe" });
  } catch { throw new CommandError("L’envoi à l’agent n’est pas confirmé. Vérifiez son terminal."); }
}

function live(agent: Agent) {
  try {
    const { terminals } = JSON.parse(execFileSync("hc", ["ls", "--json"], { env: coreEnvironment(), encoding: "utf8", timeout: 15_000 }));
    return terminals.some((t: { name?: string; state: string; cwd: string }) =>
      t.name === agent.terminal && t.state === "live" && realpathSync(t.cwd) === realpathSync(agent.cwd));
  } catch { throw unavailable(); }
}

export function agentFor(m: SavedMission, role: Agent["role"], tool: Tool, cwd: string, ticketId?: string): Agent {
  const id = randomUUID();
  return { id, role, tool, cwd, ticketId, starting: true, terminal: [role, m.issueKey.toLowerCase(), randomUUID().slice(0, 12)].join("-") };
}

export function startAgent(dir: string, m: SavedMission, agent: Agent, recovering: boolean, ticket?: PlanTicket, commit?: string, summary?: string) {
  if (recovering && live(agent)) {
    delete agent.starting;
    saveMission(dir, m);
    return;
  }
  const roleFile = join(import.meta.dirname, "../roles", agent.role + ".md");
  const docs = "docs/missions/" + m.issueKey + "/";
  const guidance = {
    lead: "Read " + ["spec.md", "split.md", "answers.md"].map(f => docs + f).join(", ") + ". Call lead.build with ticketId.",
    dev: "Build this ticket test-first. Commit your work, then call dev.done with ticketId and summary.",
    reviewer: "Review only the supplied commit. Call review.verdict with ticketId, accepted and remarks.",
  };
  const scope = { issueKey: m.issueKey, ticketId: agent.ticketId };
  function example(action: string, payload: object) {
    return "mission-control " + action + " -\n" + JSON.stringify({ ...scope, ...payload });
  }
  const command = {
    lead: example("lead.build", { ticketId: "<ready ticket id from split.md>" }),
    dev: example("dev.done", { summary: "<résumé du travail et des tests>" }),
    reviewer: example("review.verdict", { accepted: false, remarks: ["<correction demandée>"] }),
  };
  try {
    const prompt = [readFileSync(roleFile, "utf8"), guidance[agent.role],
      "Use the command tool to run mission-control ACTION -: pass action and json (the complete JSON string for standard input). Use shell for project commands and commit for a dev commit. Reviewers can run tests in a private TMPDIR copy. Include issueKey in every call. For request.ask include text, context, choices and your ticketId if assigned.",
      command[agent.role], example("request.ask", { text: "<question>", context: "<raison>", choices: ["<choix recommandé>"] }),
      JSON.stringify({ issueKey: m.issueKey, ticket, commit, base: agent.base, summary })].join("\n");
    const core = coreEnvironment();
    execFileSync("hc", ["run", "--bg", "--no-parent", "--name", agent.terminal, "--cwd", agent.cwd, "--",
      "/usr/bin/env", "-u", "LINEAR_API_KEY", "MISSION_CONTROL_HOME=" + process.env.MISSION_CONTROL_HOME,
      "HC_SOCKET=" + core.HC_SOCKET, "HC_SESSION=" + core.HC_SESSION, "HERDR_APP_HOME=" + core.HERDR_APP_HOME,
      process.execPath, join(import.meta.dirname, "agent-session.ts"), m.issueKey, agent.terminal, agent.tool, prompt],
      { env: core, timeout: 15_000, stdio: "pipe" });
    delete agent.starting;
    saveMission(dir, m);
  } catch { throw unavailable(); }
}

export function startDevelopment(dir: string, repository: string, key: string) {
  return withMission(dir, key, () => {
    const m = loadDetail(dir, key);
    if (!m.plan?.launched || m.stage !== "develop") throw new CommandError("Validez le plan avant de démarrer le Lead.");
    if (m.agents?.lead?.starting) {
      startAgent(dir, m, m.agents.lead, true);
      m.development ??= { tickets: [], requests: [] };
      saveMission(dir, m);
      return visible(m);
    }
    if (m.agents?.lead && live(m.agents.lead)) {
      m.development ??= { tickets: [], requests: [] };
      saveMission(dir, m);
      return visible(m);
    }
    const agent = agentFor(m, "lead", "claude", worktree(repository, key));
    (m.agents ??= {}).lead = agent;
    saveMission(dir, m);
    startAgent(dir, m, agent, false);
    m.development ??= { tickets: [], requests: [] };
    saveMission(dir, m);
    return visible(m);
  });
}

export function build(dir: string, repository: string, p: Payloads["lead.build"]) {
  return withMission(dir, p.issueKey, () => {
    const m = loadDetail(dir, p.issueKey);
    caller(m, "lead.build", p.ticketId);
    const d = m.development, ticket = m.plan?.tickets.find(t => t.id === p.ticketId);
    if (ticket && m.agents?.dev?.starting && m.agents.dev.ticketId === ticket.id) {
      startAgent(dir, m, m.agents.dev, true, ticket);
      return visible(m);
    }
    const accepted = (id: string) => d?.tickets.find(r => r.id === id)?.steps.at(-1)?.accepted === true;
    if (!m.plan?.launched || !d || !ticket?.key || !/^[A-Z0-9]+-[1-9]\d*$/.test(ticket.key) || ticket.key === m.issueKey ||
        d.requests.some(r => r.ticketId === ticket.id && !r.answer) || d.tickets.some(r => r.id === ticket.id || !accepted(r.id)) || !ticket.after.every(accepted)) {
      throw new CommandError("Ce ticket ne peut pas encore démarrer.");
    }
    const mission = worktree(repository, m.issueKey), branch = "ticket/" + ticket.key;
    const cwd = join(dirname(mission), ticket.key);
    try { gitAt(mission, "worktree", "add", "--no-track", "-b", branch, cwd, "HEAD"); }
    catch { throw new CommandError("Impossible de préparer le dossier de travail du dev."); }
    const tool = m.plan.team.length === 1 ? m.plan.team[0] : m.plan.team[ticket.parallel.dev - 1];
    const agent = agentFor(m, "dev", tool, cwd, ticket.id);
    m.agents!.dev = agent;
    delete m.agents!.reviewer;
    d.tickets.push({ id: ticket.id, branch, steps: [{ kind: "build", tool, startedAt: new Date().toISOString() }] });
    saveMission(dir, m);
    startAgent(dir, m, agent, false, ticket);
    return visible(m);
  });
}
