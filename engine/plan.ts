import { CommandError, type Payloads, type Plan, type PlanTicket, type Tool } from "./contract.ts";
import type { SavedMission } from "./missions.ts";
import { text } from "./questions.ts";

function draft(m: SavedMission): Plan {
  return m.plan ??= { found: [], tickets: [], testMinutes: 0, validationMinutes: 0, advice: "", team: ["claude"] };
}

function preview({ id, title, change }: Plan["found"][number]) {
  return { id: text(id), title: text(title), change: text(change) };
}

export function foundTicket(m: SavedMission, ticket: Plan["found"][number]) {
  if (!m.spec?.validated || m.plan?.tickets.length) return;
  const plan = draft(m);
  if (!plan.found.some(entry => entry.id === ticket.id)) plan.found.push(preview(ticket));
}

function count(n: number, minimum = 0) {
  if (!Number.isSafeInteger(n) || n < minimum) throw new Error("Invalid plan estimate");
  return n;
}

function planTicket(t: PlanTicket): PlanTicket {
  if (typeof t.sensitive !== "boolean" || ![1, 2].includes(t.parallel.dev)) throw new Error("Invalid plan ticket");
  return { ...preview(t), how: text(t.how), covers: t.covers.map(text), after: t.after.map(text),
    minutes: count(t.minutes), sensitive: t.sensitive, parallel: { dev: t.parallel.dev, step: count(t.parallel.step, 1) } };
}

export function completePlan(m: SavedMission, p: Payloads["pilot.plan"]) {
  if (!m.spec?.validated || m.plan?.tickets.length) return;
  const tickets = p.tickets.map(planTicket);
  if (!tickets.length || new Set(tickets.map(t => t.id)).size !== tickets.length) throw new Error("Invalid plan tickets");
  m.plan = { ...draft(m), tickets, testMinutes: count(p.testMinutes), validationMinutes: count(p.validationMinutes), advice: text(p.advice) };
  m.planSummary = text(p.summary);
  delete m.pilotBusy;
}

export function chooseTeam(m: SavedMission, team: Tool[]) {
  if (m.plan?.launched) return;
  if (!m.plan || !Array.isArray(team) || ![1, 2].includes(team.length) ||
      !team.every(tool => tool === "claude" || tool === "codex")) throw new Error("Invalid team");
  m.plan.team = team;
}

export const incompletePlan = () => new CommandError("Le découpage des tickets n’est pas terminé.");
