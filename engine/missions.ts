import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Mission } from "./contract.ts";

function hasCode(error: unknown, code: string) {
  return error instanceof Error && "code" in error && error.code === code;
}

function load(dir: string, file: string): Mission {
  return JSON.parse(readFileSync(join(dir, file), "utf8")) as Mission;
}

export function readMission(dir: string, key: string): Mission | undefined {
  try {
    return load(dir, key + ".json");
  } catch (error) {
    if (!hasCode(error, "ENOENT")) throw error;
  }
}

export function listMissions(dir: string): Mission[] {
  let files: string[];
  try {
    files = readdirSync(dir);
  } catch (error) {
    if (hasCode(error, "ENOENT")) return [];
    throw error;
  }
  return files.filter(file => file.endsWith(".json")).sort().map(file => load(dir, file));
}

export function createMission(dir: string, mission: Mission): Mission {
  mkdirSync(dir, { recursive: true });
  const file = mission.issueKey + ".json";
  try {
    writeFileSync(join(dir, file), JSON.stringify(mission, null, 2) + "\n", { flag: "wx" });
    return mission;
  } catch (error) {
    if (hasCode(error, "EEXIST")) return load(dir, file);
    throw error;
  }
}
