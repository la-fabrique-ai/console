import { CommandError, type Payloads, type Plan, type PlanTicket, type Tool } from "./contract.ts";
import { randomUUID } from "node:crypto";
import { loadDetail, saveMission, visible, withMission, type SavedMission } from "./missions.ts";
import { commitSplit, localDate, markdownText, singleLine } from "./spec-files.ts";
import { addComment, createSubTicket, launchInventory } from "./linear.ts";
import { clearQuestionReceipts, text } from "./questions.ts";

function draft(m: SavedMission): Plan {
  return m.plan ??= { found: [], tickets: [], testMinutes: 0, validationMinutes: 0, advice: "", team: ["claude"] };
}

function preview({ id, title, change }: Plan["found"][number]) {
  return { id: text(id), title: text(title), change: text(change) };
}

export function foundTicket(m: SavedMission, ticket: Plan["found"][number]) {
  if (!m.spec?.validated) throw new CommandError("La spec doit être validée avant de transmettre le découpage.");
  if (m.plan?.tickets.length) return;
  const plan = draft(m);
  if (!plan.found.some(entry => entry.id === ticket.id)) plan.found.push(preview(ticket));
}

function count(n: number, minimum = 0) {
  if (!Number.isSafeInteger(n) || n < minimum) throw new CommandError("Les estimations et les étapes doivent être des nombres entiers valides.");
  return n;
}

function planTicket(t: PlanTicket): PlanTicket {
  if (typeof t.sensitive !== "boolean" || ![1, 2].includes(t.parallel.dev)) throw new Error("Invalid plan ticket");
  if (!Number.isSafeInteger(t.minutes) || t.minutes < 1) throw new CommandError("La durée de chaque ticket doit être un nombre entier positif de minutes.");
  return { ...preview(t), how: text(t.how), covers: t.covers.map(text), after: t.after.map(text),
    minutes: t.minutes, sensitive: t.sensitive, parallel: { dev: t.parallel.dev, step: count(t.parallel.step, 1) } };
}

export function completePlan(m: SavedMission, p: Payloads["pilot.plan"]) {
  if (!m.spec?.validated) throw new CommandError("La spec doit être validée avant de transmettre le découpage.");
  if (m.plan?.tickets.length) return;
  if (!Array.isArray(p.tickets) || !p.tickets.length) throw new CommandError("Le plan doit contenir au moins un ticket.");
  const tickets = p.tickets.map(planTicket);
  const steps = new Map<string, number>();
  for (const [i, t] of tickets.entries()) {
    if (t.id !== String(i + 1)) throw new CommandError("Les tickets doivent être numérotés dans l’ordre à partir de 1.");
    for (const id of t.after) {
      const step = steps.get(id);
      if (step === undefined) throw new CommandError("Chaque dépendance doit désigner un ticket précédent.");
      if (t.parallel.step <= step) throw new CommandError("Placez chaque ticket à une étape postérieure à celles de ses dépendances.");
    }
    steps.set(t.id, t.parallel.step);
  }
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

function description(t: PlanTicket, prior: Map<string, PlanTicket>) {
  const blocks = ["**Ce que ça change**\n" + markdownText(t.change), "**Comment**\n" + markdownText(t.how)];
  if (t.covers.length) blocks.push("**Couvre, dans la spec**\n" + t.covers.map(point => "- " + markdownText(point)).join("\n"));
  if (t.after.length) blocks.push("**Attend**\n" + t.after.map(id => {
    const dependency = prior.get(id)!;
    return "- " + dependency.key + " — " + markdownText(singleLine(dependency.title));
  }).join("\n"));
  blocks.push("**Taille** : environ " + t.minutes + " min" +
    (t.sensitive ? "\n**Sensible** : approche relue avant le code, deux revues" : ""));
  return blocks.join("\n\n");
}

export function launchPlan(dir: string, key: string, teamKey: string, repository: string) {
  return withMission(dir, key + ".operator", () => withMission(dir, key, async () => {
    const m = loadDetail(dir, key);
    const plan = m.plan;
    if (plan?.launched) return visible(m);
    if (!m.spec?.validated || !plan?.tickets.length || !m.planSummary) throw new CommandError("Le découpage des tickets n’est pas terminé.");
    // Remember the approved draft and every remote identity before the first side effect.
    const resuming = Object.hasOwn(m, "launch");
    if (!resuming) {
      m.launch = { date: localDate(), children: plan.tickets.map(() => randomUUID()), comment: randomUUID() };
      saveMission(dir, m);
    }
    const journal = m.launch;
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
    if (!journal || typeof journal.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(journal.date) ||
        !Array.isArray(journal.children) || journal.children.length !== plan.tickets.length ||
        ![...journal.children, journal.comment].every(id => typeof id === "string" && uuid.test(id)) ||
        new Set([...journal.children, journal.comment]).size !== plan.tickets.length + 1) {
      throw new CommandError("Les données de reprise du lancement sont endommagées.");
    }
    commitSplit(repository, key, plan, journal.date);
    const parent = await launchInventory(key, teamKey, resuming ? journal.children : []);
    const prior = new Map<string, PlanTicket>();
    for (const [index, ticket] of plan.tickets.entries()) {
      const id = journal.children[index];
      ticket.key = parent.children.get(id) ?? await createSubTicket(parent, id, singleLine(ticket.title), description(ticket, prior));
      prior.set(ticket.id, ticket);
    }
    if (!parent.comments.has(journal.comment)) await addComment(parent.id, journal.comment, m.planSummary);
    plan.launched = true;
    m.stage = "develop";
    delete m.pilotBusy;
    delete m.launch;
    delete m.planSummary;
    saveMission(dir, m);
    return visible(m);
  }));
}
