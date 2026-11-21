import { CommandError, type Payloads, type Plan, type PlanTicket, type Tool } from "./contract.ts";
import { randomUUID } from "node:crypto";
import { loadDetail, saveMission, visible, withMission, type SavedMission } from "./missions.ts";
import { commitSplit, localDate } from "./spec-files.ts";
import { addComment, createSubTicket, launchInventory } from "./linear.ts";
import { clearQuestionReceipts, text } from "./questions.ts";

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
  clearQuestionReceipts(m);
  delete m.pilotBusy;
}

export function chooseTeam(m: SavedMission, team: Tool[]) {
  if (!m.plan || !Array.isArray(team) || ![1, 2].includes(team.length) ||
      !team.every(tool => tool === "claude" || tool === "codex")) throw new Error("Invalid team");
  m.plan.team = team;
}

function description(t: PlanTicket) {
  const blocks = [t.change, t.how];
  if (t.covers.length) blocks.push(t.covers.map(point => "- " + point).join("\n"));
  if (t.after.length) blocks.push("← " + t.after.join(", "));
  blocks.push(t.minutes + " min" + (t.sensitive ? " · high-risk" : ""));
  return blocks.join("\n\n");
}

export function launchPlan(dir: string, key: string, teamKey: string, repository: string) {
  return withMission(dir, key + ".operator", () => withMission(dir, key, async () => {
    const m = loadDetail(dir, key);
    const plan = m.plan;
    if (plan?.launched) return visible(m);
    if (!m.spec?.validated || !plan?.tickets.length || !m.planSummary) throw new CommandError("Le découpage des tickets n’est pas terminé.");
    // Remember the approved draft and every remote identity before the first side effect.
    if (!m.launch) {
      m.launch = { date: localDate(), children: plan.tickets.map(() => randomUUID()), comment: randomUUID() };
      saveMission(dir, m);
    }
    commitSplit(repository, key, plan, m.launch.date);
    const parent = await launchInventory(key, teamKey);
    for (const [index, ticket] of plan.tickets.entries()) {
      const id = m.launch.children[index];
      ticket.key = parent.children.get(id) ?? await createSubTicket(parent, id, ticket.title, description(ticket));
    }
    if (!parent.comments.has(m.launch.comment)) await addComment(parent.id, m.launch.comment, m.planSummary);
    plan.launched = true;
    m.stage = "develop";
    delete m.pilotBusy;
    delete m.launch;
    delete m.planSummary;
    saveMission(dir, m);
    return visible(m);
  }));
}
