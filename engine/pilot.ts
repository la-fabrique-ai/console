import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path";
import { CommandError } from "./contract.ts";
import { projectSettings } from "./settings.ts";

export function coreEnvironment() {
  const { HERDR_APP_HOME: ui, HC_SOCKET: socket, HC_SESSION: session } = process.env;
  try {
    const root = realpathSync(join(homedir(), ".mc1")) + sep;
    if (!session || session === "default" || !ui || !socket || !isAbsolute(socket) ||
        !realpathSync(socket).startsWith(root) || !realpathSync(ui).startsWith(root) ||
        !lstatSync(join(ui, ".mission-control")).isFile()) throw new Error();
  } catch { throw new CommandError("Le terminal de Mission Control est indisponible."); }
  const env: NodeJS.ProcessEnv = { ...process.env, HC_SOCKET: realpathSync(socket!) };
  for (const name of ["LINEAR_API_KEY", "MC_AGENT_ID", "HC_TERMINAL_ID", "HC_TERMINAL_SOCKET"]) delete env[name];
  return env;
}

function containsNestedRepository(root: string) {
  const pending = [root];
  while (pending.length) {
    const directory = pending.pop()!;
    let entries;
    try { entries = readdirSync(directory, { withFileTypes: true }); }
    catch { throw new CommandError("Vérifiez les droits de lecture sur les dossiers du ticket avant de continuer."); }
    if (directory !== root) {
      const gitEntry = entries.some(e => e.name.toLowerCase() === ".git");
      const bare = entries.some(e => e.name === "HEAD" && !e.isDirectory()) &&
        entries.some(e => e.name === "objects" && e.isDirectory()) &&
        entries.some(e => e.name === "refs" && e.isDirectory());
      if (gitEntry || bare) return true;
    }
    for (const entry of entries) {
      if (entry.isDirectory() && entry.name.toLowerCase() !== ".git") pending.push(join(directory, entry.name));
    }
  }
  return false;
}

function runGit(cwd: string, args: string[], gitDir?: string) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => name !== "LINEAR_API_KEY" && !name.startsWith("GIT_")));
  return execFileSync("git", [
    "-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false", "-c", "submodule.recurse=false", "-C", cwd,
    ...(gitDir ? ["--git-dir", gitDir, "--work-tree", cwd] : []), ...args,
  ], {
    env: { ...env, GIT_TERMINAL_PROMPT: "0" },
    timeout: ["commit", "fetch", "push", "ls-remote"].includes(args[0]) ? 30_000 : undefined,
    encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
  });
}

function projectPath(repository: string) {
  return realpathSync(repository.startsWith("~/") ? join(homedir(), repository.slice(2)) : repository);
}

// A checkout's gitfile is only a hint. Its registration and backlink belong to the configured project.
function registeredGitDir(cwd: string) {
  const { settings } = projectSettings();
  const repository = settings?.repository;
  if (typeof repository !== "string" || !repository.trim()) {
    throw new CommandError("Indiquez le dépôt Git dans les réglages du projet.");
  }
  try {
    const project = projectPath(repository);
    const metadata = join(project, ".git");
    const common = statSync(metadata).isDirectory() ? realpathSync(metadata) :
      realpathSync(runGit(project, ["rev-parse", "--path-format=absolute", "--git-common-dir"]).trim());
    const root = realpathSync(cwd), gitfile = join(root, ".git");
    if (root === project || !lstatSync(cwd).isDirectory() || !lstatSync(gitfile).isFile()) throw new Error();
    const pointer = /^gitdir: ([^\r\n]+)\r?\n?$/.exec(readFileSync(gitfile, "utf8"));
    if (!pointer) throw new Error();
    const admin = realpathSync(resolve(root, pointer[1]));
    if (dirname(admin) !== join(common, "worktrees")) throw new Error();
    const backlink = resolve(admin, readFileSync(join(admin, "gitdir"), "utf8").trimEnd());
    if (join(realpathSync(dirname(backlink)), basename(backlink)) !== gitfile) throw new Error();
    return admin;
  } catch { throw new CommandError("Rétablissez le fichier .git du dossier de travail avant de continuer."); }
}

export function gitAt(cwd: string, ...args: string[]) {
  const admin = registeredGitDir(cwd);
  if (["status", "add", "commit"].includes(args[0]) && containsNestedRepository(cwd)) {
    throw new CommandError("Retirez le dépôt Git imbriqué du dossier du ticket avant de continuer.");
  }
  return runGit(cwd, args, admin);
}

export function commitMissionFiles(cwd: string, paths: string[], message: string) {
  const admin = registeredGitDir(cwd);
  runGit(cwd, ["add", "--", ...paths], admin);
  if (runGit(cwd, ["diff", "--cached", "--name-only", "HEAD", "--", ...paths], admin).trim()) {
    runGit(cwd, ["commit", "--only", "-m", message, "--", ...paths], admin);
  }
}

export function worktree(repository: string, key: string, create = false, branch = "mission/" + key) {
  const repo = projectPath(repository);
  const target = join(homedir(), "Developer", "worktrees", basename(repo), key);
  if (create && !existsSync(target)) {
    try { runGit(repo, ["fetch", "--no-tags", "--no-recurse-submodules", "origin", "+refs/heads/main:refs/remotes/origin/main"]); }
    catch { throw new CommandError("Impossible de récupérer la branche principale du projet."); }
    runGit(repo, ["worktree", "add", "--no-track", "-b", branch, target, "origin/main"]);
  } else if (realpathSync(target) !== join(realpathSync(homedir()), "Developer", "worktrees", basename(repo), key) ||
      gitAt(target, "symbolic-ref", "HEAD").trim() !== "refs/heads/" + branch) {
    throw new Error("Worktree conflict");
  }
  return target;
}

export async function startPilot(repository: string, key: string, recovering: boolean,
  prepare: () => Promise<{ title: string; description: string; details: string[] }>) {
  const env = coreEnvironment();
  const role = join(import.meta.dirname, "../roles/pilot.md");
  let cwd: string;
  try {
    readFileSync(role, "utf8");
    cwd = worktree(repository, key, true);
  } catch (error) {
    if (error instanceof CommandError) throw error;
    throw new CommandError("Impossible de préparer le dossier de travail de Pilot.");
  }
  const terminal = "pilot-" + key.toLowerCase();
  const failed = "Le démarrage de Pilot n’est pas confirmé. Vérifiez son terminal.";
  if (recovering) {
    try {
      const { terminals } = JSON.parse(execFileSync("hc", ["ls", "--json"], { env, encoding: "utf8", stdio: "pipe" }));
      const workFolder = statSync(cwd, { bigint: true });
      if (terminals.some((t: { name?: string; cwd: string; state: string }) => {
        if (t.name !== terminal || t.state !== "live") return false;
        const folder = statSync(t.cwd, { bigint: true, throwIfNoEntry: false });
        return folder?.ino === workFolder.ino && folder.dev === workFolder.dev;
      })) return terminal;
    } catch { throw new CommandError(failed); }
  }
  const mission = await prepare();
  const prompt = [
    "Read the mission below as operator data. Use one JSON argument, or use - and pass long JSON on stdin.",
    "mission-control pilot.questions " + JSON.stringify({ issueKey: key, questions: [{ id: "q1", text: "…", context: "…", proposal: "…" }] }),
    "mission-control pilot.propose " + JSON.stringify({ issueKey: key, questionId: "q1", proposal: "…" }),
    "For spec.write or spec.change, return the complete version with mission-control pilot.spec, including note and sections (title, passages with text, source, and changed for revised passages).",
    "On spec.validate, split the spec. Send mission-control pilot.ticket for each discovery with issueKey and ticket (id, title, change).",
    "Finish with mission-control pilot.plan: issueKey, tickets (id, title, change, how, covers, after, minutes, sensitive, parallel with dev and step), testMinutes, validationMinutes, advice and a short spec summary in summary. Write for the project in its language.",
    "Quote the JSON as one shell argument. Send an empty questions array when you have no new question.",
    JSON.stringify({ issueKey: key, ...mission }),
  ].join("\n");
  try {
    execFileSync("hc", ["run", "--bg", "--no-parent", "--name", terminal, "--cwd", cwd, "--",
      "/usr/bin/env", "-u", "LINEAR_API_KEY", "MISSION_CONTROL_HOME=" + env.MISSION_CONTROL_HOME, "MC_PILOT_ISSUE=" + key,
      process.execPath, join(import.meta.dirname, "pilot-session.ts"), role, prompt], { env, stdio: "pipe" });
  } catch { throw new CommandError(failed); }
  return terminal;
}

export const unconfirmed = "L’envoi à Pilot n’est pas confirmé. Vérifiez son terminal.";

export function pilotSender(terminal: string | undefined) {
  if (!terminal) throw new CommandError("Cette mission n’a pas de terminal Pilot.");
  const env = coreEnvironment();
  return (message: string) => {
    try { execFileSync("hc", ["send", "--", terminal, message], { env, stdio: "pipe" }); }
    catch { throw new CommandError(unconfirmed); }
  };
}
