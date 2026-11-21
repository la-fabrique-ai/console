import { CommandError, type Payloads, type Plan, type PlanTicket, type Tool } from "./contract.ts";
import { randomUUID } from "node:crypto";
import { loadDetail, saveMission, visible, withMission, type SavedMission } from "./missions.ts";
import { commitSplit, hasCommittedSplit, localDate, markdownText, singleLine } from "./spec-files.ts";
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

function hasText(value: unknown) {
  return typeof value === "string" && value.trim().length > 0;
}

function estimate(minutes: number, field: string) {
  if (!Number.isSafeInteger(minutes) || minutes < 0) throw new CommandError("Le champ " + field + " doit contenir un nombre entier de minutes supérieur ou égal à zéro.");
  return minutes;
}

function checkedTickets(input: PlanTicket[]): PlanTicket[] {
  if (!Array.isArray(input) || !input.length) throw new CommandError("Le plan doit contenir au moins un ticket.");
  const steps = new Map<string, number>();
  return input.map((t, i) => {
    const position = i + 1;
    const invalid = (rule: string) => new CommandError("Ticket " + position + " — " + rule);
    if (t?.id !== String(position)) throw invalid("l’identifiant doit être le texte « " + position + " ».");
    for (const field of ["title", "change", "how"] as const) {
      if (!hasText(t[field])) throw invalid("le champ " + field + " doit contenir du texte.");
    }
    if (!Array.isArray(t.covers) || !t.covers.every(hasText)) throw invalid("le champ covers doit être une liste de textes non vides.");
    if (!Array.isArray(t.after) || t.after.some(id => !steps.has(id))) throw invalid("chaque dépendance doit désigner un ticket précédent.");
    if (!Number.isSafeInteger(t.minutes) || t.minutes < 1) throw invalid("le champ minutes doit être un entier positif.");
    if (typeof t.sensitive !== "boolean") throw invalid("le champ sensitive doit être un booléen.");
    if (![1, 2].includes(t.parallel?.dev)) throw invalid("le numéro du développeur doit être 1 ou 2.");
    const { dev, step } = t.parallel;
    if (!Number.isSafeInteger(step) || step < 1) throw invalid("le numéro d’étape doit être un entier positif.");
    if (t.after.some(id => step <= steps.get(id)!)) throw invalid("l’étape doit être postérieure à celles de ses dépendances.");
    steps.set(t.id, step);
    return { ...preview(t), how: t.how, covers: t.covers, after: t.after, minutes: t.minutes, sensitive: t.sensitive, parallel: { dev, step } };
  });
}

export function completePlan(m: SavedMission, p: Payloads["pilot.plan"]) {
  if (!m.spec?.validated) throw new CommandError("La spec doit être validée avant de transmettre le découpage.");
  if (m.plan?.tickets.length) return;
  const tickets = checkedTickets(p.tickets);
  for (const field of ["advice", "summary"] as const) {
    if (!hasText(p[field])) throw new CommandError("Le champ " + field + " doit contenir du texte.");
  }
  m.plan = { ...draft(m), tickets, testMinutes: estimate(p.testMinutes, "testMinutes"), validationMinutes: estimate(p.validationMinutes, "validationMinutes"), advice: p.advice };
  m.planSummary = p.summary;
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

const damagedLaunch = "Les données de reprise du lancement sont endommagées.";

export function launchPlan(dir: string, key: string, teamKey: string, repository: string) {
  return withMission(dir, key + ".operator", () => withMission(dir, key, async () => {
    const m = loadDetail(dir, key);
    const plan = m.plan;
    if (plan?.launched) return visible(m);
    if (!m.spec?.validated || !plan?.tickets.length || !m.planSummary) throw new CommandError("Le découpage des tickets n’est pas terminé.");
    plan.tickets = checkedTickets(plan.tickets);
    // Persist each UUID before the first side effect. If Linear cannot show an existing ticket,
    // preventing a duplicate on retry relies on Linear rejecting its already-used UUID.
    const resuming = Object.hasOwn(m, "launch");
    if (!resuming) {
      if (hasCommittedSplit(repository, key)) throw new CommandError(damagedLaunch);
      m.launch = { date: localDate(), children: plan.tickets.map(() => randomUUID()), comment: randomUUID() };
      saveMission(dir, m);
    }
    const journal = m.launch;
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
    if (!journal || typeof journal.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(journal.date) ||
        !Array.isArray(journal.children)) throw new CommandError(damagedLaunch);
    const ids = new Set<string>();
    for (const id of [...journal.children, journal.comment]) {
      if (typeof id !== "string" || !uuid.test(id) || ids.has(id)) throw new CommandError(damagedLaunch);
      ids.add(id);
    }
    if (ids.size !== plan.tickets.length + 1) throw new CommandError(damagedLaunch);
    commitSplit(repository, key, plan, journal.date);
    const parent = await launchInventory(key, teamKey, resuming ? journal.children : []);
    const prior = new Map<string, PlanTicket>();
    for (const [index, ticket] of plan.tickets.entries()) {
      const id = journal.children[index];
      ticket.key = parent.children.get(id) ?? await createSubTicket(parent, id, singleLine(ticket.title), description(ticket, prior));
      prior.set(ticket.id, ticket);
    }
    if (!parent.comments.has(journal.comment)) await addComment(parent.id, journal.comment, markdownText(m.planSummary));
    plan.launched = true;
    m.stage = "develop";
    delete m.pilotBusy;
    delete m.launch;
    delete m.planSummary;
    saveMission(dir, m);
    return visible(m);
  }));
}
