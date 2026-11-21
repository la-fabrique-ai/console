import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { issueDetail, openIssues } from "./linear.ts";
import { listMissions, readMission, loadDetail, saveMission, summary, visible, withMission, type SavedMission } from "./missions.ts";
import { CommandError, type Action, type Payloads, type Reply, type Results } from "./contract.ts";

import { askQuestions, propose, deliver } from "./questions.ts";
import { receiveSpec, specGesture } from "./spec.ts";
import { chooseTeam, completePlan, foundTicket, launchPlan } from "./plan.ts";
import { startPilot } from "./pilot.ts";

interface Settings { teamKey: string; allowedIssueKeys: string[]; repository: string }
type Handlers = { [A in Action]: (payload: Payloads[A]) => Results[A] | Promise<Results[A]> };

function issueNumber(key: unknown, teamKey: string): number {
  const parts = typeof key === "string" && /^([A-Z0-9]+)-([1-9][0-9]*)$/.exec(key);
  if (!parts || !Number.isSafeInteger(Number(parts[2]))) {
    throw new Error("Invalid issue key");
  }
  if (parts[1] !== teamKey) throw new CommandError("Ce ticket n’appartient pas à l’équipe configurée.");
  return Number(parts[2]);
}

async function command<A extends Action>(action: A, json = "{}"): Promise<Reply<A>> {
  let failure = "Impossible de lire les réglages du projet.";
  try {
    const home = process.env.MISSION_CONTROL_HOME;
    if (!home) throw new CommandError("Le dossier Mission Control n’est pas configuré.");
    const dir = join(home, "missions");
    const { teamKey, allowedIssueKeys, repository }: Settings = JSON.parse(await readFile(join(home, "settings.json"), "utf8"));
    if (!teamKey || typeof teamKey !== "string" || !Array.isArray(allowedIssueKeys)) throw new CommandError(failure);
    const reading = "Impossible de lire les missions enregistrées.";
    failure = reading;
    const payload: Payloads[A] = JSON.parse(json === "-" ? readFileSync(0, "utf8") : json);
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new CommandError(failure);
    if (process.env.MC_PILOT_ISSUE && (!(action === "pilot.questions" || action === "pilot.propose" || action === "pilot.spec" ||
        action === "pilot.ticket" || action === "pilot.plan") ||
        !("issueKey" in payload) || payload.issueKey !== process.env.MC_PILOT_ISSUE)) {
      throw new Error("Invalid Pilot callback");
    }
    if (action.startsWith("plan.") || action.startsWith("questions.") || action.startsWith("pilot.") || action.startsWith("spec.")) {
      issueNumber("issueKey" in payload ? payload.issueKey : undefined, teamKey);
    }
    function update(key: string, change: (mission: SavedMission) => void) {
      return withMission(dir, key, () => {
        const mission = loadDetail(dir, key, true);
        if (mission.launch || mission.plan?.launched) return visible(mission);
        change(mission);
        saveMission(dir, mission);
        return visible(mission);
      });
    }
    const handlers: Handlers = {
      "questions.validate": p => deliver(dir, p.issueKey, "validate", p.questionId),
      "questions.reply": p => deliver(dir, p.issueKey, "reply", p.questionId, p.text),
      "pilot.tell": p => deliver(dir, p.issueKey, "tell", undefined, p.text),
      "pilot.questions": p => update(p.issueKey, m => askQuestions(m, p.questions)),
      "pilot.propose": p => update(p.issueKey, m => propose(m, p.questionId, p.proposal)),
      "spec.write": p => specGesture(dir, p.issueKey, { action: "spec.write" }),
      "spec.change": p => specGesture(dir, p.issueKey, { action: "spec.change", text: p.text }),
      "spec.validate": p => specGesture(dir, p.issueKey, { action: "spec.validate", repository }),
      "pilot.spec": p => update(p.issueKey, m => receiveSpec(m, p)),
      "pilot.ticket": p => update(p.issueKey, m => foundTicket(m, p.ticket)),
      "pilot.plan": p => update(p.issueKey, m => completePlan(m, p)),
      "plan.team": p => update(p.issueKey, m => chooseTeam(m, p.team)),
      "plan.launch": p => {
        if (!allowedIssueKeys.includes(p.issueKey)) throw new CommandError("Ce ticket ne figure pas dans la liste autorisée.", "issue_not_allowed");
        return launchPlan(dir, p.issueKey, teamKey, repository);
      },
      "missions.list": () => listMissions(dir),
      "issues.list": async () => {
        failure = "Impossible de lire les tickets dans Linear.";
        const issues = await openIssues(teamKey);
        failure = reading;
        const stages = new Map(listMissions(dir).map(m => [m.issueKey, m.stage]));
        return issues.map(i => ({ ...i, missionStage: stages.get(i.key) }));
      },
      "issues.show": async ({ key }) => {
        const number = issueNumber(key, teamKey);
        const mission = readMission(dir, key);
        failure = "Impossible de lire les tickets dans Linear.";
        return { ...await issueDetail(teamKey, number), missionStage: mission?.stage };
      },
      "missions.show": ({ issueKey }) => {
        issueNumber(issueKey, teamKey);
        return visible(loadDetail(dir, issueKey));
      },
      "missions.create": async ({ issueKey, details = [] }) => {
        if (!allowedIssueKeys.includes(issueKey)) throw new CommandError("Ce ticket ne figure pas dans la liste autorisée.", "issue_not_allowed");
        const number = issueNumber(issueKey, teamKey);
        return withMission(dir, issueKey + ".operator", async () => {
          const existing = readMission(dir, issueKey);
          if (existing) return summary(existing);
          if (!Array.isArray(details) || !details.every(d => typeof d === "string")) throw new Error("Invalid details");
          const pending = readMission(dir, issueKey, ".starting");
          const firstIssue = pending ? undefined : await issueDetail(teamKey, number);
          const terminal = await startPilot(repository, issueKey, !!pending, async () => {
            const issue = firstIssue ?? await issueDetail(teamKey, number);
            const mission = pending ?? { issueKey, title: issue.title, stage: "prepare", details, questions: [] };
            if (!pending) await withMission(dir, issueKey, () => saveMission(dir, { ...mission, pilotBusy: "questions" }, true));
            return { title: issue.title, description: issue.description, details: mission.details };
          });
          return withMission(dir, issueKey, () => {
            const mission = loadDetail(dir, issueKey, true);
            mission.pilotTerminal = terminal;
            saveMission(dir, mission);
            return summary(mission);
          });
        });
      },
    };
    if (!Object.hasOwn(handlers, action)) throw new Error("Unknown action");
    return { data: await handlers[action](payload) };
  } catch (cause) {
    const { code, message } = cause instanceof CommandError ? cause : new CommandError(failure);
    return { error: { code, message } };
  }
}

const reply = await command(process.argv[2] as Action, process.argv[3]);
console.log(JSON.stringify(reply));
if ("error" in reply) process.exitCode = 1;
