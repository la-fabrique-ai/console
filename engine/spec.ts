import { CommandError, type Payloads } from "./contract.ts";
import { saveMission, type SavedMission } from "./missions.ts";
import { commitSpec } from "./spec-files.ts";
import { unconfirmed } from "./pilot.ts";
import { text } from "./questions.ts";
import { sendGesture } from "./gesture.ts";

export function receiveSpec(m: SavedMission, { note, sections }: Payloads["pilot.spec"]) {
  const receipt = Object.keys(m.delivery ?? {}).find(key => {
    const { action } = JSON.parse(key);
    return action === "spec.write" || action === "spec.change";
  });
  if (!receipt) return;
  const requests = [...(m.spec?.requests ?? [])];
  const event = JSON.parse(receipt);
  if (event.action === "spec.change" && !m.delivery![receipt]) requests.push(event.text);
  m.spec = { version: (m.spec?.version ?? 0) + 1, note: text(note), requests,
    sections: sections.map(s => ({ title: text(s.title), passages: s.passages.map(p => ({
      text: text(p.text), source: text(p.source), ...(typeof p.changed === "boolean" ? { changed: p.changed } : {}),
    })) })) };
  delete m.delivery;
  delete m.pilotBusy;
  delete m.validationDate;
}

type SpecGesture = { action: "spec.write" } | { action: "spec.change"; text: string } | { action: "spec.validate"; repository: string };

export function specGesture(dir: string, key: string, gesture: SpecGesture) {
  const { action } = gesture;
  return sendGesture(dir, key, m => {
    const pending = Object.entries(m.delivery ?? {}).some(([msg, confirmed]) => !confirmed && JSON.parse(msg).action.startsWith("spec."));
    if (pending) throw new CommandError(unconfirmed);
    if (m.spec?.validated) {
      if (action === "spec.change") throw new CommandError("La spec a déjà été validée.");
      return;
    }
    if (action !== "spec.change" && m.questions.some(q => q.answer === undefined)) {
      throw new CommandError("Validez d’abord chaque réponse aux questions de Pilot.");
    }
    if (action === "spec.write") {
      if (m.spec || m.pilotBusy === "spec") return;
    } else {
      if (m.pilotBusy === "spec") throw new CommandError("Pilot rédige la spec. Attendez sa réponse.");
      if (!m.spec) throw new Error("No spec available");
      if (action === "spec.validate") {
        return { event: { action }, beforeNotify() {
          // A retry after the commit and before the state write must render identical files.
          const day = new Date();
          m.validationDate ??= [day.getFullYear(), day.getMonth() + 1, day.getDate()].map(n => String(n).padStart(2, "0")).join("-");
          saveMission(dir, m);
          commitSpec(gesture.repository, m, m.validationDate);
          m.spec!.validated = true;
          delete m.validationDate;
        } };
      }
      text(gesture.text);
    }
    const previousBusy = m.pilotBusy;
    m.pilotBusy = "spec";
    return { event: gesture, failed(latest) { latest.pilotBusy = previousBusy; }, confirm(latest, waiting) {
      if (waiting && action === "spec.change") latest.spec!.requests.push(gesture.text);
    } };
  });
}
