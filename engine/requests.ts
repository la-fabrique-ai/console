import { randomUUID } from "node:crypto";
import { caller, refused, sendOnce, type Agent } from "./agents.ts";
import { CommandError, type Payloads, type Request } from "./contract.ts";
import { withMission, loadDetail, saveMission, visible, type SavedMission } from "./missions.ts";

export function recordRequest(m: SavedMission, agent: Agent, fields: Pick<Request, "ticketId" | "text" | "context" | "choices">) {
  const id = randomUUID();
  m.development!.requests.push({ id, from: agent.role, ...fields });
  (m.recipients ??= {})[id] = agent.terminal;
}

export function ask(dir: string, p: Payloads["request.ask"]) {
  return withMission(dir, p.issueKey, () => {
    const m = loadDetail(dir, p.issueKey), agent = caller(m, "request.ask", p.ticketId);
    const ticketId = agent.ticketId ?? p.ticketId;
    if (!m.development || (ticketId !== undefined && !m.plan?.tickets.some(t => t.id === ticketId)) ||
        typeof p.text !== "string" || !p.text.trim() || typeof p.context !== "string" || !p.context.trim() ||
        !Array.isArray(p.choices) || !p.choices.every(s => typeof s === "string" && s.trim())) throw refused();
    recordRequest(m, agent, { ticketId, text: p.text, context: p.context, choices: p.choices });
    saveMission(dir,m);
    return visible(m);
  });
}

export function answer(dir: string, p: Payloads["requests.answer"]) {
  return withMission(dir, p.issueKey, () => {
    const m = loadDetail(dir,p.issueKey);
    const request = m.development?.requests.find(r => r.id === p.requestId);
    if (!request) throw new CommandError("Cette demande est introuvable.");
    if (request.answer !== undefined) return visible(m);
    if (typeof p.text !== "string" || !p.text.trim()) throw new CommandError("Saisissez votre réponse avant de l’envoyer.");
    const terminal = m.recipients?.[request.id];
    if (!terminal) throw refused();
    const pending = m.pendingAnswers ??= {};
    const text = pending[request.id] ??= p.text;
    saveMission(dir, m);
    sendOnce(dir, terminal, request.id, { action: "requests.answer", requestId: request.id, text });
    request.answer = text;
    delete pending[request.id];
    saveMission(dir, m);
    return visible(m);
  });
}
