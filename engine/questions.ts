import { CommandError, type Payloads } from "./contract.ts";
import { saveMission, type SavedMission } from "./missions.ts";
import { sendPilot, unconfirmed } from "./pilot.ts";

function text(value: string) {
  if (typeof value !== "string" || !value.trim()) throw new CommandError("Le texte est vide.");
  return value;
}

function question(m: SavedMission, id: string) {
  const found = m.questions.find(q => q.id === id);
  if (!found) throw new CommandError("Question introuvable.");
  return found;
}

function pilotReady(m: SavedMission) {
  delete m.pilotBusy;
  delete m.delivery;
}

export function askQuestions(m: SavedMission, incoming: Payloads["pilot.questions"]["questions"]) {
  for (const entry of incoming) {
    const { id, text: label, context, proposal } = entry;
    if (!m.questions.some(q => q.id === id)) m.questions.push({
      id: text(id), text: text(label), context: text(context), proposals: [text(proposal)], replies: [],
    });
  }
  pilotReady(m);
}

export function propose(m: SavedMission, id: string, proposal: string) {
  const q = question(m, id);
  q.proposals.push(text(proposal));
  delete q.answer;
  pilotReady(m);
}

export function answer(dir: string, m: SavedMission, id: string, kind: "validate" | "reply", value?: string) {
  const q = question(m, id);
  const content = kind === "validate" ? q.proposals.at(-1)! : text(value!);
  if (kind === "validate" && q.answer === content) return;
  const message = JSON.stringify({ action: "questions." + kind, questionId: id, text: content });
  const confirmed = m.delivery?.[message];
  if (confirmed === false) throw new CommandError(unconfirmed);
  if (confirmed && kind === "reply" && q.answer === undefined && q.replies.at(-1) === content) return;
  // A second process must not retry a paste if hc or this process loses its acknowledgement.
  sendPilot(m.pilotTerminal, message, () => {
    (m.delivery ??= {})[message] = false;
    saveMission(dir, m);
  });
  m.delivery![message] = true;
  if (kind === "validate") {
    q.answer = content;
    m.pilotBusy = "questions";
  } else {
    q.replies.push(content);
    delete q.answer;
    m.pilotBusy = "proposal";
  }
}

export function tell(m: SavedMission, message: string) {
  sendPilot(m.pilotTerminal, JSON.stringify({ action: "pilot.tell", text: text(message) }));
  m.pilotBusy ??= "questions";
}
