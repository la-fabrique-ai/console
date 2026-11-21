import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { test } from "node:test";
import { setup } from "./pilot-project.ts";

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
  for (const expected of ["DEMO-1", "First issue", "**Texte original**", "Keep the original copy", "pilot.questions", "context", "pilot.propose", "questionId"]) assert.ok(args.includes(expected));
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
  mkdirSync(path("missions"));
  for (const issueKey of ["DEMO-1", "DEMO-2"]) writeFileSync(path("missions", issueKey + ".json"),
    JSON.stringify({ issueKey, title: "Fixture", stage: "prepare" }));
  const fake = path("bin/claude");
  writeFileSync(fake, `#!${process.execPath}
const fs = require("node:fs"), cp = require("node:child_process");
const { env, argv } = process;
const input = fs.readFileSync(0, "utf8");
const issueKey = argv.includes("--resume") ? "DEMO-2" : "DEMO-1";
const callback = cp.spawnSync("mission-control", ["pilot.questions", "-"], {
  input: JSON.stringify({issueKey, questions: []}), encoding: "utf8"
});
fs.appendFileSync(env.MISSION_CONTROL_HOME + "/turns", JSON.stringify([argv.slice(2), input, callback.stdout]) + "\\n");
`, { mode: 0o700 });
  execFileSync(process.execPath, [path("engine/pilot-session.ts"), path("roles/pilot.md"), "Initial request"], {
    env: { ...env, MC_PILOT_ISSUE: "DEMO-1" }, input: "Operator message\n", cwd: path("repo"),
  });
  const [first, next] = readFileSync(path("turns"), "utf8").trim().split("\n").map(line => JSON.parse(line));
  assert.ok(first[0].includes("Pilot role fixture")); assert.ok(first[0].includes("dontAsk"));
  assert.equal(first[0][first[0].indexOf("--session-id") + 1], next[0][next[0].indexOf("--resume") + 1]);
  assert.equal(first[1], "Initial request"); assert.equal(next[1], "Operator message");
  assert.equal(JSON.parse(first[2]).data.issueKey, "DEMO-1");
  assert.equal(JSON.parse(next[2]).error.code, "failed", "Pilot only calls back on its own mission");
});

const q1 = { id: "q1", text: "Quelle langue ?", context: "Pour préparer les textes.", proposal: "Français" };
const question = { ...key, questionId: "q1" };

test("operator gestures reach Pilot once per exchange; callbacks update the screen", async t => {
  const { cli, calls } = setup(t);
  await cli("missions.create", key);
  const callbacks = (questions: object[]) => cli("pilot.questions", { ...key, questions }, true);
  const first = (await callbacks([q1])).data;
  assert.equal(first.pilotBusy, undefined);
  assert.deepEqual(first.questions, [{ id: "q1", text: q1.text, context: q1.context, proposals: ["Français"], replies: [] }]);
  const validate = () => cli("questions.validate", question);
  const [a, b] = await Promise.all([validate(), validate()]);
  assert.deepEqual(a, b); assert.equal(a.data.pilotBusy, "questions");
  assert.equal(a.data.questions[0].answer, "Français");
  await callbacks([{ ...q1, id: "q2", text: "Quel pays ?" }]);
  assert.equal((await validate()).data.questions.length, 2);
  const reply = { ...question, text: "Anglais\navec une traduction" };
  const [c, d] = await Promise.all([cli("questions.reply", reply), cli("questions.reply", reply)]);
  assert.deepEqual(c, d); assert.equal(c.data.pilotBusy, "proposal");
  assert.equal(c.data.questions[0].answer, undefined);
  assert.deepEqual(c.data.questions[0].replies, [reply.text]);
  const proposal = "Texte avec ' et \"\n".repeat(9000);
  const updated = (await cli("pilot.propose", { ...question, proposal }, true)).data;
  assert.deepEqual(updated.questions[0].proposals, ["Français", proposal]);
  assert.equal(updated.pilotBusy, undefined);
  const sends = calls().filter(([action]) => action === "send");
  assert.equal(sends.length, 2); assert.equal(sends[0].at(-2), first.pilotTerminal);
  assert.match(sends[0].at(-1)!, /q1.*Français/u);
  assert.match(sends[1].at(-1)!, /q1.*Anglais/u);
  for (let i = 0; i < 2; i++) assert.equal((await cli("pilot.tell", { ...key, text: "Un détail" })).data.pilotBusy, "questions");
  assert.equal(calls().filter(([action]) => action === "send").length, 4);
  assert.deepEqual((await callbacks([])).data, updated);
  assert.deepEqual((await cli("missions.show", key)).data, updated);
  await cli("questions.reply", reply);
  await cli("questions.reply", { ...reply, questionId: "q2" });
  await cli("questions.reply", reply);
  assert.equal(calls().filter(([action]) => action === "send").length, 6);
});

test("unconfirmed terminal delivery never marks a question answered or automatically resends it", async t => {
  const { cli, calls, path } = setup(t);
  await cli("missions.create", key);
  const before = (await cli("pilot.questions", { ...key, questions: [q1, { ...q1, id: "q2" }] })).data;
  writeFileSync(path("offline"), "");
  const validate = () => cli("questions.validate", question);
  const failure = await validate();
  assert.deepEqual(failure.error, { code: "failed", message: "L’envoi à Pilot n’est pas confirmé. Vérifiez son terminal." });
  assert.deepEqual((await cli("missions.show", key)).data, before);
  assert.deepEqual(await cli("questions.reply", { ...key, questionId: "q2", text: "Autre choix" }), failure);
  assert.deepEqual(await validate(), failure);
  assert.deepEqual((await cli("missions.show", key)).data, before);
  assert.equal(calls().filter(([action]) => action === "send").length, 2);
});
