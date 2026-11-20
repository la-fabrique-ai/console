import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { issueDetail, issueNumber, openIssues } from "./linear.ts";
import { createMission, listMissions, readMission } from "./missions.ts";
import type { Action, ErrorCode, Reply } from "./contract.ts";

function error(message: string, code: ErrorCode = "failed") {
  return { error: { code, message } };
}

async function command(action: string, json = "{}"): Promise<Reply<Action>> {
  const home = process.env.MISSION_CONTROL_HOME;
  if (!home) return error("Le dossier Mission Control n’est pas configuré.");
  const dir = join(home, "missions");
  let failure = "Impossible de lire les réglages du projet.";
  try {
    const { teamKey, allowedIssueKeys } = JSON.parse(await readFile(join(home, "settings.json"), "utf8"));
    if (typeof teamKey !== "string" || !/^[A-Z0-9]+$/.test(teamKey) ||
        !Array.isArray(allowedIssueKeys) || !allowedIssueKeys.every(key => issueNumber(key, teamKey) !== undefined)) {
      return error(failure);
    }
    failure = "Les paramètres de la commande sont invalides.";
    const payload = JSON.parse(json);
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return error(failure);
    failure = "Impossible de lire les missions enregistrées.";
    if (action === "missions.list") return { data: listMissions(dir) };
    if (action !== "issues.list" && action !== "issues.show" && action !== "missions.create") return error("Action inconnue.");

    const key = action === "missions.create" ? payload.issueKey : payload.key;
    if (action === "missions.create" && !allowedIssueKeys.includes(key)) {
      return error("Ce ticket ne figure pas dans la liste autorisée.", "issue_not_allowed");
    }
    const number = issueNumber(key, teamKey);
    if (action !== "issues.list" && number === undefined) {
      return error("La référence du ticket ne correspond pas à l’équipe du projet.");
    }
    const existing = number === undefined ? undefined : readMission(dir, key);
    if (action === "missions.create" && existing) return { data: existing };
    if (!process.env.LINEAR_API_KEY?.trim()) return error("La clé d’accès à Linear est absente.", "linear_key_missing");

    failure = "Impossible de lire les tickets dans Linear.";
    if (action === "issues.list") {
      const issues = await openIssues(teamKey);
      failure = "Impossible de lire les missions enregistrées.";
      const stages = new Map(listMissions(dir).map(m => [m.issueKey, m.stage]));
      return { data: issues.map(i => ({ ...i, missionStage: stages.get(i.key) })) };
    }
    const issue = await issueDetail(teamKey, number!);
    if (!issue) return error("Ticket introuvable dans Linear.");
    if (action === "issues.show") return { data: { ...issue, missionStage: existing?.stage } };
    failure = "Impossible d’enregistrer la mission.";
    return { data: createMission(dir, { issueKey: issue.key, title: issue.title, stage: "prepare" }) };
  } catch {
    // Only our own operation messages cross the CLI boundary.
    return error(failure);
  }
}

const reply = await command(process.argv[2], process.argv[3]);
console.log(JSON.stringify(reply));
if ("error" in reply) process.exitCode = 1;
