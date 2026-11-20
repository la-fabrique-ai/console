import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { issueDetail, openIssues } from "./linear.ts";
import { createMission, listMissions, readMission } from "./missions.ts";
import { CommandError, type Action, type Payloads, type Reply, type Results } from "./contract.ts";

interface Settings { teamKey: string; allowedIssueKeys: string[] }
type Handlers = { [A in Action]: (payload: Payloads[A]) => Results[A] | Promise<Results[A]> };

function issueNumber(key: string, teamKey: string): number {
  const parts = typeof key === "string" && /^([A-Z0-9]+)-([1-9][0-9]*)$/.exec(key);
  if (!parts || parts[1] !== teamKey || !Number.isSafeInteger(Number(parts[2]))) {
    throw new CommandError("La référence du ticket ne correspond pas à l’équipe du projet.");
  }
  return Number(parts[2]);
}

async function command<A extends Action>(action: A, json = "{}"): Promise<Reply<A>> {
  let failure = "Impossible de lire les réglages du projet.";
  try {
    const home = process.env.MISSION_CONTROL_HOME;
    if (!home) throw new CommandError("Le dossier Mission Control n’est pas configuré.");
    const dir = join(home, "missions");
    const { teamKey, allowedIssueKeys }: Settings = JSON.parse(await readFile(join(home, "settings.json"), "utf8"));
    if (!teamKey || typeof teamKey !== "string" || !Array.isArray(allowedIssueKeys)) throw new CommandError(failure);
    failure = "Les paramètres de la commande sont invalides.";
    const payload: Payloads[A] = JSON.parse(json);
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new CommandError(failure);
    const reading = "Impossible de lire les missions enregistrées.";
    const handlers: Handlers = {
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
      "missions.create": async ({ issueKey }) => {
        if (!allowedIssueKeys.includes(issueKey)) throw new CommandError("Ce ticket ne figure pas dans la liste autorisée.", "issue_not_allowed");
        const number = issueNumber(issueKey, teamKey);
        const existing = readMission(dir, issueKey);
        if (existing) return existing;
        failure = "Impossible de lire les tickets dans Linear.";
        const { title } = await issueDetail(teamKey, number);
        failure = "Impossible d’enregistrer la mission.";
        return createMission(dir, { issueKey, title, stage: "prepare" });
      },
    };
    if (!Object.hasOwn(handlers, action)) throw new CommandError("Action inconnue.");
    failure = reading;
    return { data: await handlers[action](payload) };
  } catch (cause) {
    const { code, message } = cause instanceof CommandError ? cause : new CommandError(failure);
    return { error: { code, message } };
  }
}

const reply = await command(process.argv[2] as Action, process.argv[3]);
console.log(JSON.stringify(reply));
if ("error" in reply) process.exitCode = 1;
