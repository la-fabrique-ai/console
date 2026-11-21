import { execFileSync } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { join, parse } from "node:path";
import { CommandError, type Mission, type MissionDetail } from "./contract.ts";

// Per-message delivery confirmations last until Pilot calls back.
export type SavedMission = MissionDetail & { delivery?: Record<string, boolean>; validationDate?: string; planSummary?: string;
  launch?: { date: string; children: string[]; comment: string } };
export function visible({ delivery: _receipt, validationDate: _date, planSummary: _summary, launch: _launch, ...mission }: SavedMission): MissionDetail { return mission; }

export function summary({ issueKey, title, stage }: Mission): Mission { return { issueKey, title, stage }; }

function hasCode(error: unknown, code: string) {
  return error instanceof Error && "code" in error && error.code === code;
}

function load(dir: string, file: string): SavedMission {
  const saved: Mission & Partial<SavedMission> = JSON.parse(readFileSync(join(dir, file), "utf8"));
  return { details: [], questions: [], ...saved, issueKey: parse(file).name };
}

export function readMission(dir: string, key: string, suffix = ".json"): SavedMission | undefined {
  try {
    return load(dir, key + suffix);
  } catch (error) {
    if (!hasCode(error, "ENOENT")) throw error;
  }
}

export function loadDetail(dir: string, key: string, includeStarting = false): SavedMission {
  const mission = (includeStarting ? readMission(dir, key, ".starting") : undefined) ?? readMission(dir, key);
  if (!mission) throw new CommandError("Mission introuvable.");
  return mission;
}

export function listMissions(dir: string): Mission[] {
  let files: string[];
  try {
    files = readdirSync(dir);
  } catch (error) {
    if (hasCode(error, "ENOENT")) return [];
    throw error;
  }
  return files.filter(file => file.endsWith(".json")).sort().map(file => summary(load(dir, file)));
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

export function saveMission(dir: string, mission: SavedMission, starting = false) {
  const base = join(dir, mission.issueKey);
  const file = starting || existsSync(base + ".starting") ? base + ".starting" : base + ".json";
  writeFileSync(file + ".tmp", JSON.stringify(mission, null, 2) + "\n");
  renameSync(file + ".tmp", file);
  if (mission.pilotTerminal && file.endsWith(".starting")) renameSync(file, base + ".json");
}
