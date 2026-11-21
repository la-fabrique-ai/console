import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";

function setup(t: TestContext) {
  const root = mkdtempSync(join(tmpdir(), "mc-prepare-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const path = (...p: string[]) => join(root, ...p);
  for (const dir of ["roles", "ui", "run", "bin", "repo"]) mkdirSync(path(dir));
  cpSync(join(import.meta.dirname, ".."), path("engine"), { recursive: true });
  writeFileSync(path("roles/pilot.md"), "Pilot role fixture");
  writeFileSync(path("ui/.mission-control"), "");
  writeFileSync(path("run/core.sock"), "stand-in socket");
  const git = (...args: string[]) => execFileSync("git", ["-C", path("repo"), ...args], { encoding: "utf8" }).trim();
  git("init", "-q", "-b", "main");
  git("-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-q", "--allow-empty", "-m", "Base");
  git("update-ref", "refs/remotes/origin/main", "HEAD");
  writeFileSync(path("repo/dirty"), "operator work");
  writeFileSync(path("settings.json"), JSON.stringify({ teamKey: "DEMO", allowedIssueKeys: ["DEMO-1"], repository: path("repo") }));
  writeFileSync(path("bin/hc"), `#!${process.execPath}
const fs = require("node:fs");
fs.appendFileSync(process.env.MISSION_CONTROL_HOME + "/calls", JSON.stringify(process.argv.slice(2)) + "\\n");
if (fs.existsSync(process.env.MISSION_CONTROL_HOME + "/offline")) process.exit(1);
`, { mode: 0o700 });
  const env = { MISSION_CONTROL_HOME: root, MISSION_CONTROL_INSTALL: root, HC_SESSION: "mc1",
    HERDR_APP_HOME: path("ui"), HC_SOCKET: path("run/core.sock"), PATH: path("bin") + ":/usr/bin:/bin" };
  writeFileSync(path("home.mjs"), `import os from 'node:os'; import {syncBuiltinESMExports} from 'node:module';
os.homedir = () => process.env.MISSION_CONTROL_HOME; syncBuiltinESMExports();`);
  const cli = (action: string, payload: object = {}, fromStdin = false) => new Promise<any>((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", path("home.mjs"), "--import", path("engine/tests/linear-fixture.ts"),
      path("engine/cli.ts"), action, fromStdin ? "-" : JSON.stringify(payload)], { env });
    let out = "", err = "";
    child.stdout.on("data", data => out += data); child.stderr.on("data", data => err += data);
    child.on("error", reject);
    child.on("close", code => { try {
      assert.equal(err, ""); const result = JSON.parse(out); assert.equal(code, result.error ? 1 : 0); resolve(result);
    } catch (e) { reject(e); } });
    child.stdin.end(fromStdin ? JSON.stringify(payload) : undefined);
  });
  const calls = (): string[][] => readFileSync(path("calls"), "utf8").trim().split("\n").map(line => JSON.parse(line));
  return { cli, path, calls, git, env };
}

const key = { issueKey: "DEMO-1" };

test("two validations launch one Pilot from origin/main in a dedicated worktree", async t => {
  const { cli, calls, path, git } = setup(t);
  const request = { ...key, details: ["Keep the original copy"] };
  const [a, b] = await Promise.all([cli("missions.create", request), cli("missions.create", request)]);
  assert.deepEqual(a, { data: { ...key, title: "First issue", stage: "prepare" } });
  assert.deepEqual(b, a);
  const { data: mission } = await cli("missions.show", key);
  const [launch] = calls();
  assert.equal(calls().length, 1); assert.equal(launch[0], "run");
  assert.ok(launch.includes(mission.pilotTerminal));
  assert.deepEqual(mission.details, request.details); assert.equal(mission.pilotBusy, "questions");
  assert.deepEqual(mission.questions, []); assert.deepEqual((await cli("missions.list")).data, [a.data]);
  assert.equal(launch[launch.indexOf("--cwd") + 1], path("Developer/worktrees/repo/DEMO-1"));
  assert.equal(git("rev-parse", "mission/DEMO-1"), git("rev-parse", "origin/main"));
  assert.equal(git("status", "--porcelain"), "?? dirty");
  const args = launch.join(" ");
  for (const expected of ["DEMO-1", "First issue", "**Texte original**", "Keep the original copy"]) assert.ok(args.includes(expected));
});

test("never contacts hc or creates a worktree with a missing or default Core target", async t => {
  const { cli, env, git, path } = setup(t);
  for (const socket of ["", path("../default.sock")]) {
    env.HC_SOCKET = socket;
    assert.equal((await cli("missions.create", key)).error.code, "failed");
  }
  assert.throws(() => readFileSync(path("calls")), { code: "ENOENT" });
  assert.equal(git("branch", "--list", "mission/*"), "");
});

test("Pilot handles two turns in one Claude session without permission prompts and can call back", t => {
  const { path, env } = setup(t);
  const fake = path("bin/claude");
  writeFileSync(fake, `#!${process.execPath}
const fs = require("node:fs"), cp = require("node:child_process");
const { env, argv } = process;
const input = fs.readFileSync(0, "utf8");
const callback = cp.spawnSync("mission-control", ["pilot.questions", "-"], {input: "{}", encoding: "utf8"});
fs.appendFileSync(env.MISSION_CONTROL_HOME + "/turns", JSON.stringify([argv.slice(2), input, callback.stdout]) + "\\n");
`, { mode: 0o700 });
  execFileSync(process.execPath, [path("engine/pilot-session.ts"), path("roles/pilot.md"), "Initial request"], {
    env, input: "Operator message\n", cwd: path("repo"),
  });
  const [first, next] = readFileSync(path("turns"), "utf8").trim().split("\n").map(line => JSON.parse(line));
  assert.ok(first[0].includes("Pilot role fixture")); assert.ok(first[0].includes("dontAsk"));
  assert.equal(first[0][first[0].indexOf("--session-id") + 1], next[0][next[0].indexOf("--resume") + 1]);
  assert.equal(first[1], "Initial request"); assert.equal(next[1], "Operator message");
  assert.equal(JSON.parse(first[2]).error.code, "failed"); // The callback reached the actual CLI with an empty payload.
});
