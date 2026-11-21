import { execFileSync } from "node:child_process";
import { closeSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CommandError, type Mission, type MissionDetail } from "./contract.ts";

export function summary({ issueKey, title, stage }: Mission): Mission { return { issueKey, title, stage }; }

export function readMission(dir: string, key: string): MissionDetail | undefined {
  try {
    const saved: Mission & Partial<MissionDetail> = JSON.parse(readFileSync(join(dir, key + ".json"), "utf8"));
    return { details: [], questions: [], ...saved };
  } catch (e) {
    if (!(e instanceof Error && "code" in e && e.code === "ENOENT")) throw e;
  }
}

export function loadDetail(dir: string, key: string): MissionDetail {
  const mission = readMission(dir, key);
  if (!mission) throw new CommandError("Mission introuvable.");
  return mission;
}

export function listMissions(dir: string): Mission[] {
  let files: string[];
  try {
    files = readdirSync(dir);
  } catch (e) {
    if (e instanceof Error && "code" in e && e.code === "ENOENT") return [];
    throw e;
  }
  return files.filter(f => f.endsWith(".json")).sort().map(f => summary(loadDetail(dir, f.slice(0, -5))));
}

// macOS lockf locks the shared file descriptor. Closing it releases the lock even on process exit.
export async function withMission<T>(dir: string, key: string, update: () => T | Promise<T>): Promise<T> {
  mkdirSync(dir, { recursive: true });
  const fd = openSync(join(dir, key + ".lock"), "a");
  try {
    execFileSync("/usr/bin/lockf", ["-s", "3"], { stdio: ["ignore", "ignore", "ignore", fd] });
    return await update();
  } finally { closeSync(fd); }
}

export function saveMission(dir: string, mission: MissionDetail) {
  const file = join(dir, mission.issueKey + ".json");
  writeFileSync(file + ".tmp", JSON.stringify(mission, null, 2) + "\n");
  renameSync(file + ".tmp", file);
}
