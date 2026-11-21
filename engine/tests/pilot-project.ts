import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TestContext } from "node:test";

export function setup(t: TestContext) {
  const root = mkdtempSync(join(tmpdir(), "mc-prepare-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const path = (...p: string[]) => join(root, ...p);
  for (const dir of ["roles", ".mc1", ".mc1/ui", ".mc1/run", "bin", "repo"]) mkdirSync(path(dir));
  cpSync(join(import.meta.dirname, ".."), path("engine"), { recursive: true });
  writeFileSync(path("roles/pilot.md"), "Pilot role fixture");
  writeFileSync(path(".mc1/ui/.mission-control"), "");
  writeFileSync(path(".mc1/run/core.sock"), "stand-in socket");
  const git = (...args: string[]) => execFileSync("git", ["-C", path("repo"), ...args], { encoding: "utf8" }).trim();
  git("init", "-q", "-b", "main");
  git("config", "commit.gpgSign", "false"); // The fixture never uses the operator’s signing key.
  git("-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-q", "--allow-empty", "-m", "Base");
  git("update-ref", "refs/remotes/origin/main", "HEAD");
  writeFileSync(path("repo/dirty"), "operator work");
  writeFileSync(path("settings.json"), JSON.stringify({ teamKey: "DEMO", allowedIssueKeys: ["DEMO-1"], repository: path("repo") }));
  writeFileSync(path("bin/hc"), `#!${process.execPath}
const fs = require("node:fs");
if ("LINEAR_API_KEY" in process.env) process.exit(96);
const home = process.env.MISSION_CONTROL_HOME, args = process.argv.slice(2);
fs.appendFileSync(home + "/calls", JSON.stringify(process.argv.slice(2)) + "\\n");
if (args[0] === "ls") console.log(fs.readFileSync(home + "/live", "utf8"));
const callback = home + "/" + args[0] + ".callback";
if (fs.existsSync(callback)) {
  const [action, payload] = JSON.parse(fs.readFileSync(callback));
  const call = (a, p) => require("node:child_process").execFileSync(process.execPath,
    [home + "/engine/cli.ts", a, JSON.stringify(p)], { timeout: 2500, encoding: "utf8" });
  fs.writeFileSync(callback + ".result", call(action, payload));
  fs.writeFileSync(callback + ".screen", call(args[0] === "run" ? "missions.list" : "missions.show", {issueKey: payload.issueKey}));
}
if (args[0] !== "ls" && fs.existsSync(home + "/offline")) process.exit(1);
`, { mode: 0o700 });
  const env = { MISSION_CONTROL_HOME: root, HC_SESSION: "mc1",
    HERDR_APP_HOME: path(".mc1/ui"), HC_SOCKET: path(".mc1/run/core.sock"), PATH: path("bin") + ":/usr/bin:/bin" };
  writeFileSync(path("home.mjs"), `import os from 'node:os'; import {syncBuiltinESMExports} from 'node:module';
os.homedir = () => process.env.MISSION_CONTROL_HOME; syncBuiltinESMExports();`);
  const cliArgs = ["--import", path("home.mjs"), "--import", path("engine/tests/linear-fixture.ts"), path("engine/cli.ts")];
  const cli = (action: string, payload: object = {}, fromStdin = false) => new Promise<any>((resolve, reject) => {
    const child = spawn(process.execPath, [...cliArgs, action, fromStdin ? "-" : JSON.stringify(payload)], { env });
    let out = "", err = "";
    child.stdout.on("data", data => out += data); child.stderr.on("data", data => err += data);
    child.on("error", reject);
    child.on("close", code => { try {
      assert.equal(err, ""); const result = JSON.parse(out); assert.equal(code, result.error ? 1 : 0); resolve(result);
    } catch (e) { reject(e); } });
    child.stdin.end(fromStdin ? JSON.stringify(payload) : undefined);
  });
  const calls = (): string[][] => readFileSync(path("calls"), "utf8").trim().split("\n").map(line => JSON.parse(line));
  return { cli, cliArgs, path, calls, git, env };
}
