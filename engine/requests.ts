import { randomUUID } from "node:crypto";
import { caller, received, refused, sendOnce, type Agent } from "./agents.ts";
import { CommandError, type Payloads, type Request } from "./contract.ts";
import { withMission, loadDetail, readMission, saveMission, visible, type SavedMission } from "./missions.ts";

export function recordRequest(m: SavedMission, agent: Agent, fields: Pick<Request, "ticketId" | "text" | "context" | "choices">) {
  const id = randomUUID();
  m.development!.requests.push({ id, from: agent.role, ...fields });
  (m.recipients ??= {})[id] = agent.terminal;
  return id;
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

export function awaitingReviewAnswer(dir: string, m: SavedMission, reviewer: Agent, request: Request) {
  // The reviewer's receipt can outlive a lost reply from its terminal to requests.answer.
  return request.ticketId === reviewer.ticketId && request.answer === undefined &&
    !(m.pendingAnswers?.[request.id] && received(dir, reviewer.terminal, request.id));
}

export async function reportTurnFailure(dir: string, key: string, terminal: string) {
  return withMission(dir, key, () => {
    const m = readMission(dir, key);
    const agent = Object.values(m?.agents ?? {}).find(a => a.terminal === terminal);
    if (!m || !agent) return;
    const work = m.development ??= { tickets: [], requests: [] };
    const open = work.requests.find(r => r.id === agent.failedRequest && r.answer === undefined);
    if (open) {
      // A replacement Lead can report its first failure after the launch reply was lost.
      if (m.recipients?.[open.id] !== terminal) {
        (m.recipients ??= {})[open.id] = terminal;
        saveMission(dir, m);
      }
      return open.id;
    }
    const name = agent.tool === "claude" ? "Claude Code" : "Codex";
    agent.failedRequest = recordRequest(m, agent, {
      ticketId: agent.ticketId, text: "Pouvez-vous vérifier le terminal de l’agent, puis confirmer la reprise ?",
      context: name + " n’a pas terminé son tour. Corrigez l’erreur affichée dans son terminal.",
      choices: ["Reprendre le tour."],
    });
    saveMission(dir, m);
    return agent.failedRequest;
  });
}

export function answer(dir: string, p: Payloads["requests.answer"]) {
  return withMission(dir, p.issueKey, () => answerRequest(dir, loadDetail(dir, p.issueKey), p));
}

// Both the answer button and a live Lead's restart button hold the mission lock.
export function answerRequest(dir: string, m: SavedMission, p: Pick<Payloads["requests.answer"], "requestId" | "text">) {
  const request = m.development?.requests.find(r => r.id === p.requestId);
  if (!request) throw new CommandError("Cette demande est introuvable.");
  if (request.answer !== undefined) return visible(m);
  if (typeof p.text !== "string" || !p.text.trim()) throw new CommandError("Saisissez votre réponse avant de l’envoyer.");
  const terminal = m.recipients?.[request.id];
  if (!terminal) throw refused();
  const pending = m.pendingAnswers ??= {};
  const text = pending[request.id] ??= p.text;
  saveMission(dir, m);
  const reply = { action: "requests.answer", requestId: request.id, text };
  const reviewer = m.agents?.reviewer;
  const step = m.development!.tickets.find(t => t.id === request.ticketId)?.steps.at(-1);
  const resumesReview = reviewer && reviewer.ticketId === request.ticketId && step?.kind === "review" && !step.endedAt &&
    !m.development!.requests.some(r => r.id !== request.id && awaitingReviewAnswer(dir, m, reviewer, r));
  if (resumesReview) {
    if (terminal !== reviewer.terminal) sendOnce(dir, terminal, request.id, reply);
    sendOnce(dir, reviewer.terminal, request.id, {
      ...reply, issueKey: m.issueKey, ticketId: request.ticketId, question: request.text, resume: "review.verdict",
      instruction: "If your verdict was waiting for the operator, repeat your review.verdict call with its accepted value and remarks.",
    });
  } else {
    sendOnce(dir, terminal, request.id, reply);
  }
  request.answer = text;
  delete pending[request.id];
  saveMission(dir, m);
  return visible(m);
}
