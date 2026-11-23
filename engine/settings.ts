import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CommandError } from "./contract.ts";

interface Settings { teamKey: string; allowedIssueKeys: string[]; repository: string }

export function projectSettings() {
  const home = process.env.MISSION_CONTROL_HOME;
  if (!home) throw new CommandError("Le dossier Mission Control n’est pas configuré.");
  try {
    const settings: Settings = JSON.parse(readFileSync(join(home, "settings.json"), "utf8"));
    return { home, settings };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new CommandError("Le fichier settings.json des réglages du projet est introuvable.");
    }
    throw new CommandError("Impossible de lire les réglages du projet.");
  }
}
