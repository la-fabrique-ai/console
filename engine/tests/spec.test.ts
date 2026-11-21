import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, renameSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { test, type TestContext } from "node:test";
import { setup } from "./pilot-project.ts";

const key = { issueKey: "DEMO-1" };
const question = { id: "readers", text: "Qui peut lire ?", context: "Le texte est partagé.", proposal: "Toute l’équipe." };
const payload = { ...key, note: "Première version.", sections: [{ title: "Accès", passages: [
  { text: "L’équipe peut lire.", source: "Réponse 1" }, { text: "Conserver le texte.", source: "Demande" },
] }] };

async function mission(t: TestContext) {
  const project = setup(t);
  await project.cli("missions.create", { ...key, details: ["Même sur mobile."] });
  await project.cli("pilot.questions", { ...key, questions: [question] });
  return project;
}

test("the operator requests spec versions and Pilot returns sourced passages through its scoped callback", async t => {
  const { cli, calls, env, path } = await mission(t);
  const show = () => cli("missions.show", key);
  assert.equal((await show()).data.spec, undefined);
  assert.equal((await cli("missions.list")).data[0].issueKey, key.issueKey);
  assert.ok((await cli("spec.write", key)).error);
  await cli("questions.validate", { ...key, questionId: question.id });
  const [a, b] = await Promise.all([cli("spec.write", key), cli("spec.write", key)]);
  assert.equal(a.data.pilotBusy, "spec"); assert.deepEqual(a, b);
  assert.ok((await cli("spec.validate", key)).error);
  assert.ok((await cli("spec.change", { ...key, text: "Trop tôt." })).error);
  await cli("pilot.questions", { ...key, questions: [] });
  assert.equal((await show()).data.pilotBusy, "spec");
  writeFileSync(path("missions/DEMO-2.json"), readFileSync(path("missions/DEMO-1.json")));
  const pilotEnv: NodeJS.ProcessEnv = env;
  pilotEnv.MC_PILOT_ISSUE = key.issueKey;
  assert.ok((await cli("pilot.spec", { ...payload, issueKey: "DEMO-2" })).error);
  const first = (await cli("pilot.spec", payload, true)).data;
  delete pilotEnv.MC_PILOT_ISSUE;
  assert.equal(first.pilotBusy, undefined);
  assert.deepEqual(first.spec, { version: 1, note: payload.note, sections: payload.sections, requests: [] });
  const requests = ["Limiter la lecture.", "Préciser le délai."];
  for (const [i, text] of requests.entries()) {
    const change = { ...key, text };
    assert.equal((await cli("spec.change", change)).data.pilotBusy, "spec");
    assert.ok((await cli("spec.change", change)).error);
    assert.ok((await cli("spec.validate", key)).error);
    const sections = [{ title: "Accès", passages: [payload.sections[0].passages[0], { text: text.repeat(i ? 8500 : 1), source: "Correction", changed: true }] }];
    const next = (await cli("pilot.spec", { ...key, note: text, sections }, true)).data;
    assert.deepEqual(next.spec, { version: i + 2, note: text, sections, requests: requests.slice(0, i + 1) });
    assert.equal(next.pilotBusy, undefined);
    await cli("pilot.spec", { ...key, note: text, sections }, true);
    assert.equal((await show()).data.spec.version, i + 2);
  }
  assert.deepEqual(calls().filter(([cmd]) => cmd === "send").map(row => JSON.parse(row.at(-1)!)).slice(1),
    [{ action: "spec.write" }, ...requests.map(text => ({ action: "spec.change", text }))]);
});

test("a fast Pilot callback is retained and an uncertain change is not sent twice", async t => {
  const { cli, path, calls } = await mission(t);
  await cli("questions.validate", { ...key, questionId: question.id });
  writeFileSync(path("send.callback"), JSON.stringify(["pilot.spec", payload]));
  const first = (await cli("spec.write", key)).data;
  assert.equal(first.spec.version, 1); assert.equal(first.pilotBusy, undefined);
  const change = { ...key, text: "Un seul accès." };
  assert.deepEqual((await cli("spec.change", change)).data.spec.requests, [change.text]);
  unlinkSync(path("send.callback")); writeFileSync(path("offline"), "");
  assert.ok((await cli("spec.change", change)).error);
  assert.ok((await cli("spec.change", change)).error);
  assert.equal(calls().filter(row => row[0] === "send").length, 4);
  assert.equal((await cli("missions.show", key)).data.pilotBusy, undefined);
});

async function draft(t: TestContext) {
  const project = await mission(t);
  const { cli, git, path } = project;
  git("config", "user.name", "Test Operator"); git("config", "user.email", "operator@example.invalid");
  await cli("questions.validate", { ...key, questionId: question.id });
  await cli("spec.write", key);
  await cli("pilot.spec", payload);
  const cwd = path("Developer/worktrees/repo/DEMO-1");
  const branchGit = (...args: string[]) => git("-C", cwd, ...args);
  return { ...project, cwd, branchGit };
}

test("validation commits only the two current documents on the mission branch, once", async t => {
  const { cli, git, branchGit, cwd, path, calls } = await draft(t);
  const dir = "docs/missions/DEMO-1";
  writeFileSync(cwd + "/staged", "another change"); branchGit("add", "--", "staged");
  writeFileSync(cwd + "/unstaged", "leave me alone");
  const rootStatus = git("status", "--porcelain");
  const second = { ...question, id: "device", text: "Quel appareil ?", proposal: "Le téléphone." };
  await cli("pilot.questions", { ...key, questions: [second] });
  assert.ok((await cli("spec.validate", key)).error);
  await cli("questions.validate", { ...key, questionId: second.id });
  await cli("spec.change", { ...key, text: "Préciser le public." });
  await cli("pilot.spec", { ...payload, sections: [{ title: "Public", passages: [
    { text: "Seulement les membres.", source: "Réponse 1", changed: true }] }] });
  renameSync(path("bin/hc"), path("bin/hc-original"));
  writeFileSync(path("bin/hc"), '#!/bin/sh\ngit -C "$MISSION_CONTROL_HOME/Developer/worktrees/repo/DEMO-1" show HEAD:docs/missions/DEMO-1/spec.md > "$MISSION_CONTROL_HOME/at-notification" || exit 1\nexec "$MISSION_CONTROL_HOME/bin/hc-original" "$@"\n', { mode: 0o700 });
  const [a, b] = await Promise.all([cli("spec.validate", key), cli("spec.validate", key)]);
  assert.equal(a.data?.spec.validated, true); assert.deepEqual(a, b);
  assert.ok((await cli("spec.change", { ...key, text: "Encore." })).error);
  assert.deepEqual((await cli("pilot.spec", payload)).data.spec, a.data.spec);
  assert.equal(branchGit("symbolic-ref", "--short", "HEAD"), "mission/DEMO-1");
  assert.equal(branchGit("rev-list", "--count", "origin/main..HEAD"), "1");
  assert.deepEqual(branchGit("diff", "--name-only", "origin/main", "HEAD").split("\n"), [dir + "/answers.md", dir + "/spec.md"]);
  const doc = (name: string) => branchGit("show", "HEAD:" + dir + "/" + name + ".md");
  for (const file of ["spec", "answers"]) {
    assert.match(doc(file), /^---\ntitle: .+\nstatus: validated\ndate: \d{4}-\d\d-\d\d\nauthor: .+\n---/);
    assert.equal(readFileSync(cwd + "/" + dir + "/" + file + ".md", "utf8").trim(), doc(file));
  }
  assert.equal(readFileSync(path("at-notification"), "utf8").trim(), doc("spec"));
  assert.match(doc("spec"), /## Public\n\nSeulement les membres\./);
  assert.doesNotMatch(doc("spec"), /Réponse 1|changed|Première version|L’équipe peut lire/);
  assert.doesNotMatch(branchGit("log", "-1", "--format=%B"), /Claude|Codex|Pilot/i);
  for (const content of [question.text, question.proposal, second.text, second.proposal, "Même sur mobile."]) assert.ok(doc("answers").includes(content));
  assert.equal(branchGit("status", "--porcelain"), "A  staged\n?? unstaged");
  assert.equal(git("status", "--porcelain"), rootStatus); assert.ok(!existsSync(path("repo/docs")));
  assert.deepEqual(calls().filter(row => row[0] === "send").map(row => JSON.parse(row.at(-1)!)).at(-1), { action: "spec.validate" });
  assert.equal(calls().filter(row => row[0] === "send" && JSON.parse(row.at(-1)!).action === "spec.validate").length, 1);
});

test("a failed notification keeps the committed spec validated and is never sent a second time", async t => {
  const { cli, path, calls, branchGit } = await draft(t);
  writeFileSync(path("offline"), "");
  assert.ok((await cli("spec.validate", key)).error);
  assert.equal((await cli("missions.show", key)).data.spec.validated, true);
  unlinkSync(path("offline"));
  assert.ok((await cli("spec.validate", key)).error);
  assert.equal(branchGit("rev-list", "--count", "origin/main..HEAD"), "1");
  assert.equal(calls().filter(row => row[0] === "send" && JSON.parse(row.at(-1)!).action === "spec.validate").length, 1);
});

test("validation refuses a different branch or a document directory pointing outside Pilot's worktree", async t => {
  const { cli, cwd, path, branchGit, calls } = await draft(t);
  branchGit("switch", "-q", "-c", "other");
  assert.ok((await cli("spec.validate", key)).error); assert.ok(!existsSync(cwd + "/docs"));
  branchGit("switch", "-q", "mission/DEMO-1");
  mkdirSync(path("outside")); symlinkSync(path("outside"), cwd + "/docs");
  assert.ok((await cli("spec.validate", key)).error);
  assert.ok(!existsSync(path("outside/missions")));
  unlinkSync(cwd + "/docs");
  writeFileSync(cwd + "/.git", "gitdir: " + path("repo/.git") + "\n");
  assert.ok((await cli("spec.validate", key)).error);
  assert.ok(!existsSync(cwd + "/docs"));
  assert.equal((await cli("missions.show", key)).data.spec.validated, undefined);
  assert.equal(calls().filter(row => row[0] === "send" && JSON.parse(row.at(-1)!).action === "spec.validate").length, 0);
});

test("the screen sees Pilot writing during delivery and until its spec callback", async t => {
  const { cli, path } = await mission(t);
  await cli("questions.validate", { ...key, questionId: question.id });
  writeFileSync(path("send.callback"), JSON.stringify(["missions.show", key]));
  await cli("spec.write", key);
  const during = () => JSON.parse(readFileSync(path("send.callback.result"), "utf8")).data;
  assert.equal(during().pilotBusy, "spec");
  await cli("pilot.spec", payload);
  await cli("spec.change", { ...key, text: "Changer le délai." });
  assert.equal(during().pilotBusy, "spec");
  assert.deepEqual((await cli("pilot.spec", payload)).data.spec.requests, ["Changer le délai."]);
});
