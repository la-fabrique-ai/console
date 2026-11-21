import { CommandError } from "./contract.ts";
import { loadDetail, saveMission, visible, withMission, type SavedMission } from "./missions.ts";
import { pilotSender, unconfirmed } from "./pilot.ts";

interface Gesture {
  event: { action: string; questionId?: string; text?: string };
  beforeNotify?(): void;
  failed?(mission: SavedMission): void;
  confirm?(mission: SavedMission, waiting: boolean): void;
}

export function sendGesture(dir: string, key: string, prepare: (mission: SavedMission) => Gesture | undefined) {
  return withMission(dir, key + ".operator", async () => {
    const attempt = await withMission(dir, key, () => {
      const m = loadDetail(dir, key);
      const gesture = prepare(m);
      if (!gesture) return;
      const message = JSON.stringify(gesture.event);
      if (gesture.event.action !== "pilot.tell" && m.delivery?.[message] === false) throw new CommandError(unconfirmed);
      const send = gesture.beforeNotify ? (line: string) => pilotSender(m.pilotTerminal)(line) : pilotSender(m.pilotTerminal);
      gesture.beforeNotify?.();
      (m.delivery ??= {})[message] = false;
      saveMission(dir, m);
      return { send, message, gesture };
    });
    if (!attempt) return visible(loadDetail(dir, key));
    const { send, message, gesture } = attempt;
    try { send(message); }
    catch (error) {
      if (gesture.failed) await withMission(dir, key, () => {
        const m = loadDetail(dir, key);
        if (m.delivery?.[message] === false) { gesture.failed!(m); saveMission(dir, m); }
      });
      throw error;
    }
    return withMission(dir, key, () => {
      const m = loadDetail(dir, key);
      const waiting = m.delivery?.[message] === false;
      if (waiting) m.delivery![message] = true;
      gesture.confirm?.(m, waiting);
      saveMission(dir, m);
      return visible(m);
    });
  });
}
