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
  attemptedAnswers?: string[];
  problem?: string;
}

function forge(r: Runtime, args: string[], input = "") {
  const { PATH, HOME, USER, LANG, SSH_AUTH_SOCK } = process.env;
  return execFileSync("ssh", ["-T", "-o", "BatchMode=yes", "-o", "ConnectTimeout=5", "-o", "ForwardAgent=no",
    "-o", "ClearAllForwardings=yes", "-o", "StrictHostKeyChecking=yes", "-o", "UseKeychain=no", "--", r.host, "forge", "team", ...args], {
    env: { PATH, HOME, USER, LANG, SSH_AUTH_SOCK }, input, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], timeout: 15000, killSignal: "SIGKILL",
  });
}

function handoff(settings: Settings, m: SavedMission, ticket: PlanTicket, r: Runtime) {
  const cwd = worktree(settings.repository, m.issueKey), folder = "docs/missions/" + m.issueKey;
  const commit = gitAt(cwd, "rev-parse", "HEAD").trim();
  const files = Object.fromEntries(["spec.md", "answers.md", "split.md"].map(name => {
    const path = folder + "/" + name;
    return [path, gitAt(cwd, "show", commit + ":" + path)];
  }));
  const role = readFileSync(join(import.meta.dirname, "../roles/runtime-lead.md"), "utf8");
  return role + "\n" + JSON.stringify({ reference: r.ref, mission: m.issueKey, ticket,
    task: ticket.key!.toLowerCase(), files });
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

function holders(r: Runtime, ticket: PlanTicket, current: Status) {
  const members = current.members.filter(a => a.team === r.team);
  const name = "agent-" + r.team + "-lead", task = ticket.key!.toLowerCase();
  return { members, task, lead: members.find(a => a.role === "lead" && a.name === name),
    dev: members.find(a => a.role === "dev" && a.task === task && a.assignedBy === name),
    reviewer: members.find(a => a.role === "reviewer" && a.task === "(no branch)" && a.assignedBy === name) };
}

function follow(m: SavedMission, r: Runtime, ticket: PlanTicket, inbox: InboxItem[], team: ReturnType<typeof holders>) {
  const work = m.development!, { task, dev, reviewer } = team;
  let run = work.tickets.find(t => t.id === ticket.id);
  function ticketRun() {
    if (!run) {
      run = { id: ticket.id, branch: "agent/" + task, steps: [] };
      work.tickets.push(run);
    }
    return run;
  }
  const prefix = "MC " + r.ref + " ";
  for (const item of inbox) {
    if (!item.summary.startsWith(prefix)) continue;
    const kind = item.summary.slice(prefix.length);
    const sender = team.members.find(a => a.name === item.from);
    if (kind.startsWith("QUESTION ") && sender && ["lead", "dev", "reviewer"].includes(sender.role)) {
      const id = "forge-" + item.id, text = kind.slice(9).trim();
      if (!text || work.requests.some(q => q.id === id)) continue;
      const q = readQuestion(r, item);
      if (q.state === "open") {
        work.requests.push({ id, from: sender.role as "lead" | "dev" | "reviewer", ticketId: ticket.id,
          text, context: q.body ?? "", choices: [] });
        r.assignment = "confirmed";
      }
      continue;
    }
    if (item.from !== team.lead?.name || r.verdicts?.includes(item.id)) continue;
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
  if (r.assignment !== "confirmed" || run?.steps.at(-1)?.accepted) return;
  const now = new Date().toISOString();
  if (dev && live(dev)) {
    const t = ticketRun(), last = t.steps.at(-1);
    if (!last) step(t, "build", now);
    if (!reviewer && last?.accepted === false) step(t, "fix", now);
  }
  if (reviewer && live(reviewer)) {
    const t = ticketRun();
    if (!t.steps.length) step(t, "build", now);
    if (!t.steps.at(-1)?.endedAt) step(t, "review", now);
  }
}

const connection = "Vérifiez la connexion SSH à l’hôte runtime et l’accès de votre clé, puis réessayez.";
const missingTeam = "Vérifiez que l’équipe runtime configurée existe sur cet hôte.";
const missingMember = "Vérifiez que les conteneurs du Lead, du dev et du relecteur sont présents sur l’hôte runtime.";
const dead = "Vérifiez la session du ticket dans runtime, puis confirmez qu’elle a repris.";
const busy = "Vérifiez la tâche en cours dans l’équipe runtime et libérez le Lead avant de lancer le ticket.";
const uncertain = "La remise du ticket reste incertaine. Vérifiez dans runtime si le Lead l’a reçu.";

function refresh(dir: string, m: SavedMission, r: Runtime, ticket: PlanTicket, settings?: Settings, reply?: string) {
  const work = m.development!, before = JSON.stringify(m);
  const last = () => work.tickets.find(t => t.id === ticket.id)?.steps.at(-1);
  const problem = work.requests.find(q => q.id === r.problem);
  try {
    if (!last()?.accepted) {
      const current = status(r), team = holders(r, ticket, current);
      if (r.assignment) follow(m, r, ticket, current.inbox, team);
      if (!last()?.accepted) {
        const { members, lead, dev, reviewer } = team;
        if (!members.length) throw new CommandError(missingTeam);
        if (!lead?.present || !["dev","reviewer"].every(role => members.some(a => a.role === role && a.present))) {
          throw new CommandError(missingMember);
        }
        if (r.assignment) {
          if (r.assignment === "uncertain") throw new CommandError(uncertain);
          const currentStep = last();
          if (!live(lead) || lead.task !== "(no branch)" || lead.assignedBy !== "human" ||
              [dev, reviewer].some(a => a && (!a.present || !live(a))) || (currentStep && !dev && !reviewer) ||
              (currentStep?.kind === "review" && !currentStep.endedAt && !reviewer)) throw new CommandError(dead);
        } else {
          if (!settings) return visible(m); // A read cannot start a ticket.
          if (lead.task !== null) throw new CommandError(busy);
          let input: string;
          try { input = handoff(settings, m, ticket, r); }
          catch { throw new CommandError("Vérifiez les trois fichiers validés dans le dossier de la mission et le fichier de rôle du Lead."); }
          if (Buffer.byteLength(input) > 65536) throw new CommandError("Raccourcissez la consigne et les documents de la mission pour respecter la limite de 64 Kio de runtime.");
          r.assignment = "uncertain";
          saveMission(dir, m);
          try { forge(r, ["assign", lead.name], input); }
          catch { throw new CommandError(uncertain); }
          r.assignment = "confirmed";
        }
      }
    }
    if (problem) {
      problem.answer = reply ?? "Le suivi de l’équipe a repris.";
      delete r.problem;
    }
  } catch (err) {
    const text = err instanceof CommandError ? err.message : connection;
    if (problem) problem.text = text;
    else {
      r.problem = randomUUID();
      work.requests.push({ id: r.problem, ticketId: ticket.id, from: "lead", text,
        context: "Mission Control attend de pouvoir confirmer le suivi du ticket.", choices: ["Vérifier de nouveau."] });
    }
  }
  if (JSON.stringify(m) !== before) saveMission(dir, m);
  return visible(m);
}

export function showDevelopment(dir: string, key: string) {
  const saved = loadDetail(dir, key);
  if (!saved.runtime) return visible(saved);
  return withMission(dir, key, () => {
    const m = loadDetail(dir, key), r = m.runtime!;
    return refresh(dir, m, r, m.plan!.tickets.find(t => t.id === r.ticketId)!);
  });
}

function destination(settings: Settings) {
  const { runtimeHost: host, runtimeTeam: team } = settings;
  if (typeof host !== "string" || typeof team !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(host) || !/^[a-z0-9][a-z0-9-]*$/.test(team)) {
    throw new CommandError("Indiquez l’hôte (runtimeHost) et l’équipe (runtimeTeam) dans les réglages du projet.");
  }
  return { host, team };
}

function operatorRefresh(dir: string, m: SavedMission, settings: Settings, reply?: string) {
  const r = m.runtime!, ticket = m.plan!.tickets.find(t => t.id === r.ticketId)!;
  const check = () => refresh(dir, m, r, ticket, settings, reply);
  if (r.assignment) return check();
  Object.assign(r, destination(settings));
  return withMission(dir, "runtime-assign", check);
}

export function startDevelopment(dir: string, settings: Settings, key: string) {
  return withMission(dir, key, () => {
    const m = loadDetail(dir, key);
    if (m.stage !== "develop" || !m.plan?.launched) throw new CommandError("Validez le plan avant de lancer le développement.");
    if (m.runtime) return operatorRefresh(dir, m, settings);
    const target = destination(settings);
    const runs = m.development?.tickets ?? [];
    if (runs.some(run => !run.steps.at(-1)?.accepted)) throw new CommandError("Vérifiez le ticket déjà en cours avant de lancer l’équipe runtime.");
    const ticket = m.plan.tickets.find(t => !runs.some(run => run.id === t.id) &&
      t.after.every(id => runs.some(run => run.id === id && run.steps.at(-1)?.accepted)));
    if (!ticket) return visible(m);
    if (!ticket.key || !/^[A-Z0-9]+-[1-9]\d*$/.test(ticket.key)) throw new CommandError("Vérifiez la clé du ticket dans le plan.");
    m.runtime = { ...target, ticketId: ticket.id, ref: randomUUID() };
    m.development ??= { tickets: [], requests: [] };
    return operatorRefresh(dir, m, settings);
  });
}

const verifyAnswer = "Vérifiez dans la boîte de réception de runtime si l’agent a reçu votre réponse.";
const missedAnswer = "La réponse a été enregistrée dans runtime. Vérifiez le terminal de l’agent pour la lui transmettre.";

export function answerRuntime(dir: string, settings: Settings, p: Payloads["requests.answer"]) {
  return withMission(dir, p.issueKey, () => {
    const m = loadDetail(dir, p.issueKey), r = m.runtime;
    const request = m.development?.requests.find(q => q.id === p.requestId);
    if (!r || !request) throw new CommandError("Cette demande est introuvable.");
    if (request.answer !== undefined) return visible(m);
    if (typeof p.text !== "string" || !p.text.trim() || Buffer.byteLength(p.text) > 262144) {
      throw new CommandError("Saisissez une réponse de 256 Kio au maximum.");
    }
    if (r.problem === request.id) return operatorRefresh(dir, m, settings, p.text);
    if (r.attemptedAnswers?.includes(request.id)) throw new CommandError(request.context);
    const id = Number(/^forge-([0-9]+)$/.exec(request.id)?.[1]);
    const ticket = m.plan!.tickets.find(t => t.id === r.ticketId)!;
    let current: Status;
    try { current = status(r); } catch { throw new CommandError(verifyAnswer); }
    const item = current.inbox.find(q => q.id === id);
    const agent = holders(r, ticket, current)[request.from];
    if (!item || item.summary.trimEnd() !== "MC " + r.ref + " QUESTION " + request.text || !agent?.present ||
        agent.name !== item.from || !live(agent) || (request.from === "lead" && (agent.task !== "(no branch)" || agent.assignedBy !== "human"))) {
      throw new CommandError(verifyAnswer);
    }
    const originalContext = request.context;
    (r.attemptedAnswers ??= []).push(request.id);
    request.context = verifyAnswer;
    saveMission(dir, m);
    try {
      const receipt = JSON.parse(forge(r, ["answer", String(id), "--json"],
        JSON.stringify({ summary: "Réponse de l’opérateur.", body: p.text })));
      if (receipt.id !== id || receipt.to !== agent.name || typeof receipt.delivered !== "boolean") throw new Error();
      if (!receipt.delivered) {
        request.context = missedAnswer;
        saveMission(dir, m);
        throw new Error();
      }
    } catch { throw new CommandError(request.context); }
    request.answer = p.text;
    request.context = originalContext;
    saveMission(dir, m);
    return visible(m);
  });
}
