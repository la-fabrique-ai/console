import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { test, type TestContext } from "node:test";
import { setup } from "./pilot-project.ts";

const key = { issueKey: "DEMO-1" };
const question = { id: "readers", text: "Qui peut lire ?", context: "Le texte est partagé.", proposal: "Toute l’équipe." };
const payload = { ...key, note: "Première version.", sections: [{ title: "Accès", passages: [
  { text: "L’équipe peut lire.", source: "Réponse 1" }, { text: "Conserver le texte.", source: "Demande" },
] }] };

async function mission(t: TestContext, details = ["Même sur mobile."], questions = [question]) {
  const project = setup(t);
  await project.cli("missions.create", { ...key, details });
  await project.cli("pilot.questions", { ...key, questions });
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
  assert.ok((await cli("missions.show", key)).error);
  assert.ok((await cli("pilot.tell", { ...key, text: "Détail" })).error);
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
  const next = { ...key, text: "Dernière précision." };
  assert.deepEqual((await cli("spec.change", next)).data.spec.requests, [change.text, next.text]);
  unlinkSync(path("send.callback")); writeFileSync(path("offline"), "");
  assert.ok((await cli("spec.change", change)).error);
  assert.ok((await cli("spec.change", change)).error);
  assert.equal(calls().filter(row => row[0] === "send").length, 5);
  assert.equal((await cli("missions.show", key)).data.pilotBusy, undefined);
});

async function draft(t: TestContext, questions = [question], details = ["Même sur mobile."]) {
  const project = await mission(t, details, questions);
  const { cli, git, path } = project;
  git("config", "user.name", "Test Operator"); git("config", "user.email", "operator@example.invalid");
  for (const q of questions) await cli("questions.validate", { ...key, questionId: q.id });
  await cli("spec.write", key);
  await cli("pilot.spec", payload);
  const cwd = path("Developer/worktrees/repo/DEMO-1");
  const branchGit = (...args: string[]) => git("-C", cwd, ...args);
  return { ...project, cwd, branchGit };
}

test("validation commits only the two current documents on the mission branch, once", async t => {
  const second = { ...question, id: "device", text: "Quel appareil ?", proposal: "Le téléphone." };
  const { cli, git, branchGit, cwd, path, calls, env } = await draft(t, [question, second]);
  Object.assign(env, { GIT_INDEX_FILE: path("inherited-index") });
  const dir = "docs/missions/DEMO-1";
  writeFileSync(cwd + "/staged", "another change"); branchGit("add", "--", "staged");
  writeFileSync(cwd + "/unstaged", "leave me alone");
  const rootStatus = git("status", "--porcelain");
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
  assert.ok(!existsSync(path("inherited-index")));
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

test("the raw mission documents preserve words and escape only structural Markdown", async t => {
  const fields = ["# titre\n## Interdit", "- liste\n---", "> citation\n### Question inventée", "[oui]: non"];
  const questions = fields.map((proposal, i) => ({ ...question, id: String(i), text: "Qui lit ?\r\n### Suite " + i, proposal }));
  const { cli, branchGit } = await draft(t, questions, fields);
  const plain = '50 % de mon_fichier avec `code` et "guillemets" ; 2 < 3.';
  const lines = ["Texte <h1>interdit</h1>", "  + liste", "1. départ", "* liste", "===", "```js", "~~~", "___", "<!-- x", "\\<h1>x</h1>", "***", "1) liste", "  1. liste", plain];
  await cli("spec.change", { ...key, text: "Préciser." });
  await cli("pilot.spec", { ...payload, sections: [{ title: "Un titre\r\n## Suite",
    passages: [...fields, lines.join("\n")].map(text => ({ text, source: "Demande" })) }] });
  assert.ok((await cli("spec.validate", key)).data?.spec.validated);
  const doc = (name: string) => branchGit("show", "HEAD:docs/missions/DEMO-1/" + name + ".md").split("\n---\n\n")[1];
  const spec = doc("spec"), answers = doc("answers");
  const escaped = ["\\# titre\n\\## Interdit", "\\- liste\n\\---", "\\> citation\n\\### Question inventée", "\\[oui]: non"];
  assert.deepEqual(spec.split("\n\n"), ["# Spec", "## Un titre ## Suite", ...escaped,
    ["Texte \\<h1>interdit\\</h1>", "  \\+ liste", "1\\. départ", "\\* liste", "\\===", "\\```js", "\\~~~", "\\___", "\\<!-- x", "\\<h1>x\\</h1>", "\\***", "1\\) liste", "  1\\. liste", plain].join("\n")]);
  assert.deepEqual(answers.split("\n\n"), ["# Answers", "## Request details", ...escaped, "## Validated answers",
    ...escaped.flatMap((answer, i) => ["### Qui lit ? ### Suite " + i, answer])]);
});

test("a missing Core target prevents publication and an empty details section is omitted", async t => {
  const { cli, env, branchGit, cwd } = await draft(t, [question], []);
  const socket = env.HC_SOCKET;
  env.HC_SOCKET = "";
  assert.ok((await cli("spec.validate", key)).error);
  assert.ok(!existsSync(cwd + "/docs")); assert.equal(branchGit("rev-list", "--count", "origin/main..HEAD"), "0");
  assert.equal((await cli("missions.show", key)).data.spec.validated, undefined);
  env.HC_SOCKET = socket;
  assert.ok((await cli("spec.validate", key)).data.spec.validated);
  assert.doesNotMatch(branchGit("show", "HEAD:docs/missions/DEMO-1/answers.md"), /## Request details/);
});

test("answers freeze from the spec request, while late callbacks still settle question work", async t => {
  const { cli, calls, git } = await mission(t);
  git("config", "user.name", "Test"); git("config", "user.email", "test@example.invalid");
  const id = { ...key, questionId: question.id };
  const initial = (await cli("questions.validate", id)).data.questions;
  await cli("spec.write", key);
  for (const phase of ["writing", "written", "validated"]) {
    if (phase === "written") await cli("pilot.spec", payload);
    if (phase === "validated") {
      assert.ok((await cli("spec.validate", key)).data?.spec.validated);
    }
    const sent = calls().length;
    assert.ok((await cli("questions.validate", id)).error);
    assert.ok((await cli("questions.reply", { ...id, text: "Autre réponse" })).error);
    assert.equal(calls().length, sent);
    for (const [action, args] of [
      ["pilot.propose", { ...id, proposal: "Autre idée" }],
      ["pilot.questions", { ...key, questions: [{ ...question, id: "late" }] }],
    ] as const) {
      const tell = (await cli("pilot.tell", { ...key, text: "Une précision" })).data;
      assert.equal(tell.pilotBusy, phase === "writing" ? "spec" : phase === "validated" ? "split" : "questions");
      const latest = (await cli(action, args)).data;
      assert.deepEqual(latest.questions, initial);
      assert.equal(latest.pilotBusy, phase === "writing" ? "spec" : phase === "validated" ? "split" : undefined);
    }
  }
});

for (const stop of ["add", "commit"]) {
  test("validation resumes on a later local day after death following git " + stop, async t => {
    const { cli, cliArgs, env, path, cwd, branchGit, calls } = await draft(t);
    appendFileSync(path("home.mjs"), `
import cp from 'node:child_process';
globalThis.Date = new Proxy(Date, {construct(target, args) {
  return Reflect.construct(target, args.length ? args : [process.env.FIXTURE_NOW]);
}});
const run = cp.execFileSync;
cp.execFileSync = (command, args, options) => {
  const result = run(command, args, options);
  if (command === "git" && args.includes(process.env.FIXTURE_STOP)) process.exit(77);
  return result;
};
syncBuiltinESMExports();
`);
    Object.assign(env, { TZ: "Europe/Paris", FIXTURE_NOW: "2026-11-21T23:30:00Z" });
    const attempt = spawnSync(process.execPath, [...cliArgs, "spec.validate", JSON.stringify(key)], {
      env: { ...env, FIXTURE_STOP: stop }, encoding: "utf8",
    });
    assert.equal(attempt.status, 77, attempt.stderr);
    const count = () => branchGit("rev-list", "--count", "origin/main..HEAD");
    assert.equal(count(), stop === "commit" ? "1" : "0");
    assert.equal((await cli("missions.show", key)).data.spec.validated, undefined);
    assert.match(readFileSync(cwd + "/docs/missions/DEMO-1/spec.md", "utf8"), /^date: 2026-11-22$/m);
    Object.assign(env, { FIXTURE_NOW: "2026-11-25T07:00:00Z" });
    assert.equal((await cli("spec.validate", key)).data?.spec.validated, true);
    assert.equal(count(), "1");
    for (const doc of ["answers", "spec"]) assert.match(branchGit("show", "HEAD:docs/missions/DEMO-1/" + doc + ".md"), /^date: 2026-11-22$/m);
    assert.equal(calls().filter(row => row[0] === "send" && JSON.parse(row.at(-1)!).action === "spec.validate").length, 1);
  });
}

test("the project signing policy applies and a signer failure leaves the spec unvalidated", async t => {
  const { cli, git, branchGit, path, calls } = await draft(t);
  const signer = path("bin/fixture-signer");
  writeFileSync(signer, '#!/bin/sh\n[ "$GIT_TERMINAL_PROMPT" = "0" ] || exit 2\ntouch "$MISSION_CONTROL_HOME/signer-called"\nexit 1\n', { mode: 0o700 });
  git("config", "gpg.format", "openpgp"); git("config", "gpg.program", signer);
  git("config", "commit.gpgSign", "true");
  assert.equal((await cli("spec.validate", key)).error?.message, "Impossible d’enregistrer la spec et les réponses sur la branche de la mission.");
  assert.ok(existsSync(path("signer-called")));
  assert.equal(branchGit("rev-list", "--count", "origin/main..HEAD"), "0");
  assert.equal((await cli("missions.show", key)).data.spec.validated, undefined);
  assert.ok(!calls().some(row => row[0] === "send" && JSON.parse(row.at(-1)!).action === "spec.validate"));
});

test("the mission checkout must be canonical, linked back to its folder and registered in the configured project", async t => {
  const { cli, git, path, cwd, branchGit } = await draft(t);
  const refused = async () => {
    assert.ok((await cli("spec.validate", key)).error);
    assert.ok(!existsSync(cwd + "/docs"));
  };
  const backlink = branchGit("rev-parse", "--absolute-git-dir") + "/gitdir";
  const original = readFileSync(backlink);
  writeFileSync(backlink, path("repo/.git") + "\n");
  await refused();
  writeFileSync(backlink, original);

  git("worktree", "move", cwd, path("relocated"));
  symlinkSync(path("relocated"), cwd);
  await refused();
  unlinkSync(cwd);

  git("clone", "-q", "--local", path("repo"), path("foreign"));
  git("-C", path("foreign"), "worktree", "add", "-q", "-b", "mission/DEMO-1", cwd);
  await refused();
});

test("a linked checkout configured as the project itself never receives the documents", async t => {
  const { cli, git, path, cwd } = await draft(t);
  const folder = path("Developer/worktrees/DEMO-1/DEMO-1");
  mkdirSync(path("Developer/worktrees/DEMO-1"));
  git("worktree", "move", cwd, folder);
  writeFileSync(path("settings.json"), JSON.stringify({ teamKey: "DEMO", allowedIssueKeys: ["DEMO-1"], repository: folder }));
  assert.ok((await cli("spec.validate", key)).error);
  assert.ok(!existsSync(folder + "/docs"));
});

test("answers stay frozen if the first spec request may already have reached Pilot", async t => {
  const { cli, path, calls } = await mission(t);
  const id = { ...key, questionId: question.id };
  await cli("questions.validate", id);
  writeFileSync(path("offline"), "");
  assert.ok((await cli("spec.write", key)).error);
  unlinkSync(path("offline"));
  const sent = calls().length;
  assert.ok((await cli("questions.reply", { ...id, text: "Changer." })).error);
  assert.equal(calls().length, sent);
  assert.equal((await cli("pilot.spec", payload)).data.questions[0].answer, question.proposal);
});

test("a signer waiting for input times out, releases the locks and leaves validation retryable", async t => {
  const { cli, git, path, branchGit } = await draft(t);
  const signer = path("bin/waiting-signer");
  writeFileSync(signer, "#!/bin/sh\nexec sleep 2\n", { mode: 0o700 });
  git("config", "gpg.format", "openpgp"); git("config", "gpg.program", signer); git("config", "commit.gpgSign", "true");
  // Run a real waiting Git process with the production deadline shortened for the fixture.
  appendFileSync(path("home.mjs"), `
import cp from 'node:child_process'; import fs from 'node:fs';
const run = cp.execFileSync;
cp.execFileSync = (command, args, options) => {
  if (command !== "git" || !args.includes("commit") || !(options.timeout > 0)) return run(command, args, options);
  try { return run(command, args, { ...options, timeout: Math.min(200, options.timeout) }); }
  catch (error) { fs.writeFileSync(process.env.MISSION_CONTROL_HOME + "/commit-result", String(error.code)); throw error; }
};
syncBuiltinESMExports();
`);
  assert.equal((await cli("spec.validate", key)).error?.message, "Impossible d’enregistrer la spec et les réponses sur la branche de la mission.");
  assert.equal(readFileSync(path("commit-result"), "utf8"), "ETIMEDOUT");
  assert.equal(branchGit("rev-list", "--count", "origin/main..HEAD"), "0");
  assert.equal((await cli("missions.show", key)).data.spec.validated, undefined);
  git("config", "commit.gpgSign", "false");
  assert.ok((await cli("spec.validate", key)).data?.spec.validated);
});
