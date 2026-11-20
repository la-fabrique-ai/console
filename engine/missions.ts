import { randomUUID } from "node:crypto";
import { linkSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Mission } from "./contract.ts";

function hasCode(error: unknown, code: string) {
  return error instanceof Error && "code" in error && error.code === code;
}

function load(dir: string, file: string): Mission {
  const { issueKey, title, stage } = JSON.parse(readFileSync(join(dir, file), "utf8"));
  if (typeof issueKey !== "string" || issueKey + ".json" !== file || typeof title !== "string" ||
      !["prepare", "develop", "test", "validate"].includes(stage)) throw new Error("Invalid mission file");
  return { issueKey, title, stage };
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
  const pending = join(dir, randomUUID() + ".tmp");
  const file = mission.issueKey + ".json";
  try {
    writeFileSync(pending, JSON.stringify(mission, null, 2) + "\n", { flag: "wx" });
    // Publish the complete file only if no other CLI process has already created it.
    try {
      linkSync(pending, join(dir, file));
    } catch (error) {
      if (!hasCode(error, "EEXIST")) throw error;
      return load(dir, file);
    }
    return mission;
  } finally {
    rmSync(pending, { force: true });
  }
}
