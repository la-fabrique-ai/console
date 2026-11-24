import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CommandError, type PlanTicket, type Payloads, type TicketRun } from "./contract.ts";
import { loadDetail, saveMission, visible, withMission, type SavedMission } from "./missions.ts";
import { gitAt, worktree } from "./pilot.ts";
import type { Settings } from "./settings.ts";

export interface Runtime {
  host: string; team: string; ticketId: string; ref: string;
  assignment?: "uncertain" | "confirmed";
  verdicts?: number[];
}

function forge(r: Runtime, args: string[], input = "") {
  return execFileSync("ssh", ["-T", "-o", "BatchMode=yes", "-o", "ConnectTimeout=5", "-o", "ForwardAgent=no",
    "-o", "ClearAllForwardings=yes", "--", r.host, "forge", "team", ...args], {
    input, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], timeout: 15000, killSignal: "SIGKILL",
  });
}

function handoff(settings: Settings, m: SavedMission, ticket: PlanTicket, r: Runtime) {
  const cwd = worktree(settings.repository, m.issueKey), folder = "docs/missions/" + m.issueKey;
  const files = Object.fromEntries(["spec.md", "answers.md", "split.md"].map(name => {
    const path = folder + "/" + name;
    return [path, gitAt(cwd, "show", "HEAD:" + path)];
  }));
  const role = readFileSync(join(import.meta.dirname, "../roles/runtime-lead.md"), "utf8");
  return role + "\n" + JSON.stringify({ reference: r.ref, mission: m.issueKey, ticket,
    task: ticket.key!.toLowerCase(), files, done: "Run the project tests with PostgreSQL and Playwright. Obtain the team's independent reviewer verdict." });
}

interface Member { name: string; team: string; role: string; task: string | null; present: boolean; session: string; assignedBy: string | null }
interface InboxItem { id: number; from: string; summary: string; time: string }
interface Status { members: Member[]; inbox: InboxItem[] }

function status(r: Runtime): Status {
  const result = JSON.parse(forge(r, ["status", "--json", "--quick"]));
  if (!Array.isArray(result.members) || !Array.isArray(result.inbox)) throw new Error();
  return result;
}

function live(m: Member) { return ["working", "idle", "done"].includes(m.session); }

function step(run: TicketRun, kind: "build" | "fix" | "review", time: string) {
  const last = run.steps.at(-1);
  if (!last || last.endedAt || last.kind !== kind) {
    if (last && !last.endedAt) last.endedAt = time;
    run.steps.push({ kind, startedAt: time, tool: "claude" });
  }
  return run.steps.at(-1)!;
}

function readQuestion(r: Runtime, item: InboxItem) {
  if (!Number.isSafeInteger(item.id) || item.id < 1) throw new Error();
  const q = JSON.parse(forge(r, ["question", String(item.id), "--json"]));
  if (q.id !== item.id || q.from !== item.from || q.summary !== item.summary || q.time !== item.time ||
      !Number.isFinite(Date.parse(q.time)) || (q.body !== null && typeof q.body !== "string")) throw new Error();
  return q;
}

function follow(m: SavedMission, r: Runtime, ticket: PlanTicket, current: Status) {
  const work = m.development!, lead = "agent-" + r.team + "-lead", task = ticket.key!.toLowerCase();
  const team = current.members.filter(a => a.team === r.team);
  const dev = team.find(a => a.role === "dev" && a.task === task && a.assignedBy === lead);
  const reviewer = team.find(a => a.role === "reviewer" && a.task === "(no branch)" && a.assignedBy === lead);
  let run = work.tickets.find(t => t.id === ticket.id);
  function ticketRun() {
    if (!run) {
      run = { id: ticket.id, branch: "agent/" + task, steps: [] };
      work.tickets.push(run);
    }
    return run;
  }
  const prefix = "MC " + r.ref + " ";
  for (const item of current.inbox) {
    if (item.from !== lead || !item.summary.startsWith(prefix) || r.verdicts?.includes(item.id)) continue;
    const kind = item.summary.slice(prefix.length);
    if (kind !== "ACCEPTED" && kind !== "REFUSED") continue;
    const q = readQuestion(r, item);
    const { summary, remarks } = JSON.parse(q.body);
    const accepted = kind === "ACCEPTED";
    if (typeof summary !== "string" || !summary.trim() || !Array.isArray(remarks) ||
        !remarks.every(x => typeof x === "string" && x.trim()) || (!accepted && !remarks.length)) throw new Error();
    const t = ticketRun();
    if (t.steps.at(-1)?.accepted) break;
    let build = t.steps.findLast(s => s.kind !== "review");
    if (!build || t.steps.at(-1)?.accepted === false) build = step(t, build ? "fix" : "build", q.time);
    build.summary = summary;
    Object.assign(step(t, "review", q.time), { endedAt: q.time, accepted, remarks });
    (r.verdicts ??= []).push(item.id);
    r.assignment = "confirmed";
  }
  if (run?.steps.at(-1)?.accepted) return;
  const now = new Date().toISOString();
  if (dev && live(dev)) {
    r.assignment = "confirmed";
    const t = ticketRun(), last = t.steps.at(-1);
    if (!last) step(t, "build", now);
    if (reviewer && live(reviewer) && !t.steps.at(-1)?.endedAt) step(t, "review", now);
    else if (!reviewer && last?.accepted === false) step(t, "fix", now);
  }
}

export function showDevelopment(dir: string, key: string) {
  const saved = loadDetail(dir, key);
  if (!saved.runtime) return visible(saved);
  return withMission(dir, key, () => {
    const m = loadDetail(dir, key), r = m.runtime!;
    const ticket = m.plan!.tickets.find(t => t.id === r.ticketId)!;
    if (!m.development!.tickets.find(t => t.id === ticket.id)?.steps.at(-1)?.accepted) {
      follow(m, r, ticket, status(r));
      saveMission(dir, m);
    }
    return visible(m);
  });
}

export function startDevelopment(dir: string, settings: Settings, key: string) {
  return withMission(dir, key, () => {
    const m = loadDetail(dir, key);
    if (m.stage !== "develop" || !m.plan?.launched) throw new CommandError("Validez le plan avant de lancer le développement.");
    const { runtimeHost: host, runtimeTeam: team } = settings;
    if (!host || !team || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(host) || !/^[a-z0-9][a-z0-9-]*$/.test(team)) {
      throw new CommandError("Indiquez l’hôte (runtimeHost) et l’équipe (runtimeTeam) dans les réglages du projet.");
    }
    if (m.runtime?.assignment) return visible(m);
    const runs = m.development?.tickets ?? [];
    if (runs.some(run => !run.steps.at(-1)?.accepted)) throw new CommandError("Vérifiez le ticket déjà en cours avant de lancer l’équipe runtime.");
    const ticket = m.plan.tickets.find(t => !runs.some(run => run.id === t.id) &&
      t.after.every(id => runs.some(run => run.id === id && run.steps.at(-1)?.accepted)));
    if (!ticket) return visible(m);
    if (!ticket.key || !/^[A-Z0-9]+-[1-9]\d*$/.test(ticket.key)) throw new CommandError("Vérifiez la clé du ticket dans le plan.");
    const r = m.runtime ??= { host, team, ticketId: ticket.id, ref: randomUUID() };
    const instruction = handoff(settings, m, ticket, r);
    m.development ??= { tickets: [], requests: [] };
    r.assignment = "uncertain";
    saveMission(dir, m);
    forge(r, ["assign", "agent-" + r.team + "-lead"], instruction);
    r.assignment = "confirmed";
    saveMission(dir, m);
    return visible(m);
  });
}

export function answerRuntime(_dir: string, _p: Payloads["requests.answer"]): never {
  throw new CommandError("Cette demande est introuvable.");
}
