import { CommandError, type Payloads } from "./contract.ts";
import { type SavedMission } from "./missions.ts";
import { sendGesture } from "./gesture.ts";

export function text(value: unknown) {
  if (typeof value !== "string" || !value.trim()) throw new Error("Empty text");
  return value;
}

function question(m: SavedMission, id: string | undefined) {
  const found = m.questions.find(q => q.id === id);
  if (!found) throw new Error("Unknown question");
  return found;
}

function answersFrozen(m: SavedMission) {
  // Even an unconfirmed first request might already be in Pilot's terminal.
  return !!m.spec || m.pilotBusy === "spec" || Object.hasOwn(m.delivery ?? {}, JSON.stringify({ action: "spec.write" }));
}

function pilotReady(m: SavedMission) {
  if (m.pilotBusy !== "spec") delete m.pilotBusy;
  for (const message of Object.keys(m.delivery ?? {})) {
    if (!JSON.parse(message).action.startsWith("spec.")) delete m.delivery![message];
  }
}

export function askQuestions(m: SavedMission, incoming: Payloads["pilot.questions"]["questions"]) {
  if (answersFrozen(m)) return pilotReady(m);
  for (const entry of incoming) {
    const { id, text: label, context, proposal } = entry;
    if (!m.questions.some(q => q.id === id)) m.questions.push({
      id: text(id), text: text(label), context: text(context), proposals: [text(proposal)], replies: [],
    });
  }
  pilotReady(m);
}

export function propose(m: SavedMission, id: string, proposal: string) {
  if (answersFrozen(m)) return pilotReady(m);
  const q = question(m, id);
  q.proposals.push(text(proposal));
  delete q.answer;
  pilotReady(m);
}

export function deliver(dir: string, key: string, kind: "validate" | "reply" | "tell", id?: string, value?: string) {
  return sendGesture(dir, key, m => {
    if (kind !== "tell" && answersFrozen(m)) throw new CommandError("La rédaction de la spec a commencé. Les réponses sont figées.");
    const q = kind === "tell" ? undefined : question(m, id);
    const content = kind === "validate" ? q!.proposals.at(-1)! : text(value);
    const event = { action: kind === "tell" ? "pilot.tell" : "questions." + kind, questionId: id, text: content };
    if (kind === "validate" && q?.answer === content) return;
    if (kind === "reply" && m.delivery?.[JSON.stringify(event)] && q && q.answer === undefined && q.replies.at(-1) === content) return;
    const proposals = q?.proposals.length;
    return { event, confirm(latest, waiting) {
      if (waiting) {
        if (kind === "tell") latest.pilotBusy ??= "questions";
        else latest.pilotBusy = kind === "reply" ? "proposal" : "questions";
      }
      if (kind !== "tell") {
        const current = question(latest, id);
        if (kind === "reply") { current.replies.push(content); delete current.answer; }
        else if (current.proposals.length === proposals) current.answer = content;
      }
    } };
  });
}
