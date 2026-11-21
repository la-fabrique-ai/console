import { CommandError, type Payloads } from "./contract.ts";
import { loadDetail, saveMission, visible, withMission, type SavedMission } from "./missions.ts";
import { pilotSender, unconfirmed } from "./pilot.ts";

function text(value: unknown) {
  if (typeof value !== "string" || !value.trim()) throw new Error("Empty text");
  return value;
}

function question(m: SavedMission, id: string | undefined) {
  const found = m.questions.find(q => q.id === id);
  if (!found) throw new Error("Unknown question");
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

export function deliver(dir: string, key: string, kind: "validate" | "reply" | "tell", id?: string, value?: string) {
  // Only operator gestures queue behind the transport. Callbacks use the shorter mission lock.
  return withMission(dir, key + ".operator", async () => {
    const attempt = await withMission(dir, key, () => {
      const m = loadDetail(dir, key);
      const q = kind === "tell" ? undefined : question(m, id);
      const content = kind === "validate" ? q!.proposals.at(-1)! : text(value);
      const action = kind === "tell" ? "pilot.tell" : "questions." + kind;
      const message = JSON.stringify({ action, questionId: id, text: content });
      const confirmed = m.delivery?.[message];
      if (kind === "validate" && q?.answer === content) return;
      if (kind !== "tell" && confirmed === false) throw new CommandError(unconfirmed);
      if (kind === "reply" && confirmed && q && q.answer === undefined && q.replies.at(-1) === content) return;
      const send = pilotSender(m.pilotTerminal);
      (m.delivery ??= {})[message] = false;
      saveMission(dir, m);
      return { send, message, content, proposals: q?.proposals.length };
    });
    if (!attempt) return visible(loadDetail(dir, key));
    const { send, message, content, proposals } = attempt;
    send(message);
    return withMission(dir, key, () => {
      const m = loadDetail(dir, key);
      if (m.delivery?.[message] === false) {
        m.delivery[message] = true;
        if (kind === "tell") m.pilotBusy ??= "questions";
        else m.pilotBusy = kind === "reply" ? "proposal" : "questions";
      }
      if (kind !== "tell") {
        const q = question(m, id);
        if (kind === "reply") { q.replies.push(content); delete q.answer; }
        else if (q.proposals.length === proposals) q.answer = content;
      }
      saveMission(dir, m);
      return visible(m);
    });
  });
}
