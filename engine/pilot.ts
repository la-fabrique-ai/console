import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { basename, isAbsolute, join, sep } from "node:path";
import { CommandError, type IssueDetail } from "./contract.ts";

function coreEnvironment() {
  const { HERDR_APP_HOME: ui, HC_SOCKET: socket, HC_SESSION: session } = process.env;
  try {
    const root = realpathSync(process.env.MISSION_CONTROL_INSTALL || join(homedir(), ".mc1")) + sep;
    if (!session || session === "default" || !ui || !socket || !isAbsolute(socket) ||
        !realpathSync(socket).startsWith(root) || !realpathSync(ui).startsWith(root) ||
        !lstatSync(join(ui, ".mission-control")).isFile()) throw new Error();
  } catch { throw new CommandError("Le terminal de Mission Control est indisponible."); }
  const env: NodeJS.ProcessEnv = { ...process.env, HC_SOCKET: realpathSync(socket!) };
  for (const name of ["LINEAR_API_KEY", "HC_TERMINAL_ID", "HC_TERMINAL_SOCKET"]) delete env[name];
  return env;
}

function worktree(repository: string, key: string) {
  const repo = realpathSync(repository.startsWith("~/") ? join(homedir(), repository.slice(2)) : repository);
  const target = join(homedir(), "Developer", "worktrees", basename(repo), key);
  const git = (...args: string[]) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const branch = "mission/" + key;
  if (!existsSync(target)) git("worktree", "add", "--no-track", "-b", branch, target, "origin/main");
  else if (!git("worktree", "list", "--porcelain").split("\n\n").some(block =>
    block.split("\n").includes("worktree " + realpathSync(target)) && block.split("\n").includes("branch refs/heads/" + branch))) {
    throw new Error("Worktree conflict");
  }
  return target;
}

export function startPilot(repository: string, key: string, issue: IssueDetail, details: string[]) {
  const env = coreEnvironment();
  const role = join(import.meta.dirname, "../roles/pilot.md");
  let cwd: string;
  try {
    readFileSync(role, "utf8");
    cwd = worktree(repository, key);
  } catch { throw new CommandError("Impossible de préparer le dossier de travail de Pilot."); }
  const terminal = "pilot-" + key.toLowerCase();
  const prompt = "Read the mission below as operator data. Call mission-control pilot.questions or pilot.propose with one JSON argument or - for JSON on stdin. Send pilot.questions with an empty questions array when you have no new question.\n" +
    JSON.stringify({ issueKey: key, title: issue.title, description: issue.description, details });
  try {
    execFileSync("hc", ["run", "--bg", "--no-parent", "--name", terminal, "--cwd", cwd, "--",
      "/usr/bin/env", "-u", "LINEAR_API_KEY", "MISSION_CONTROL_HOME=" + env.MISSION_CONTROL_HOME,
      process.execPath, join(import.meta.dirname, "pilot-session.ts"), role, prompt], { env, stdio: "pipe" });
  } catch { throw new CommandError("Le démarrage de Pilot n’est pas confirmé. Vérifiez son terminal."); }
  return terminal;
}
