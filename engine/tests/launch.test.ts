import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { test, type TestContext } from "node:test";
import { setup } from "./pilot-project.ts";

const key = { issueKey: "DEMO-1" };
const summary = "Les équipes peuvent retrouver une fiche.";
const tickets = ["Chercher", "Ouvrir", "Exporter"].map((title, i) => ({
  id: String(i + 1), title: i === 0 ? title + "\n## Suite" : title, change: "# le changement\n> exemple",
  how: "Indexer à 50 % dans nom_fichier.", covers: i === 0 ? [] : ["Les fiches", "Les accents"], after: i === 0 ? [] : [String(i)],
  minutes: 15 + i, sensitive: i === 1, parallel: { dev: i === 1 ? 2 : 1, step: i + 1 },
}));
const file = "docs/missions/DEMO-1/split.md";

async function ready(t: TestContext) {
  const project = setup(t);
  const { cli, path, git } = project;
  git("config", "user.name", "Test"); git("config", "user.email", "test@example.invalid");
  await cli("missions.create", key);
  await cli("pilot.questions", { ...key, questions: [] });
  await cli("spec.write", key);
  await cli("pilot.spec", { ...key, note: "Spec", sections: [] });
  await cli("spec.validate", key);
  await cli("pilot.plan", { ...key, tickets, summary, testMinutes: 30, validationMinutes: 10, advice: "Travailler à deux." });
  await cli("plan.team", { ...key, team: ["codex", "claude"] });
  const cwd = path("Developer/worktrees/repo/DEMO-1");
  const branch = (...args: string[]) => git("-C", cwd, ...args);
  const requests = () => readFileSync(path("linear-requests"), "utf8").trim().split("\n").map(line => JSON.parse(line));
  const writes = () => requests().filter(r => r.query.startsWith("mutation"));
  return { ...project, cwd, branch, requests, writes };
}

test("approval commits only the safe split, creates ordered children, comments last and freezes the mission", async t => {
  const { cli, calls, writes, requests, branch, cwd, git } = await ready(t);
  const before = calls(), rootStatus = git("status", "--porcelain");
  writeFileSync(cwd + "/other", "staged by someone else"); branch("add", "other");
  const [first, again] = await Promise.all([cli("plan.launch", key), cli("plan.launch", key)]);
  assert.equal(first.data?.stage, "develop"); assert.deepEqual(again, first);
  const m = first.data;
  assert.equal(m.plan.launched, true); assert.deepEqual(m.plan.team, ["codex", "claude"]);
  assert.deepEqual(m.plan.tickets.map((t: { key: string }) => t.key), ["DEMO-10", "DEMO-11", "DEMO-12"]);
  assert.equal(m.launch, undefined); assert.equal(m.planSummary, undefined);
  assert.equal(branch("diff", "--name-only", "HEAD^", "HEAD"), file);
  assert.equal(branch("rev-list", "--count", "origin/main..HEAD"), "2");
  assert.equal(branch("status", "--porcelain"), "A  other"); assert.equal(git("status", "--porcelain"), rootStatus);
  const doc = branch("show", "HEAD:" + file);
  assert.match(doc, /^---\ntitle: DEMO-1 — Split\nstatus: validated\ndate: \d{4}-\d\d-\d\d\nauthor: Pilot\n---/);
  for (const value of ["Chercher ## Suite", "\\# le changement\n\\> exemple", tickets[0].how, "codex", "claude", "Travailler à deux."]) assert.ok(doc.includes(value), value);
  const firstSection = doc.split("## Ticket 2")[0];
  assert.doesNotMatch(firstSection, /### Coverage|### Dependencies/);
  assert.match(doc, /### Coverage/);
  const mutations = writes();
  assert.equal(mutations.length, 4);
  assert.equal(new Set(mutations.map(r => r.variables.input.id)).size, 4);
  for (const [i, ticket] of tickets.entries()) {
    const { query, variables: { input } } = mutations[i];
    assert.match(query, /issueCreate\(input: \$input\)/);
    const description = ["**Ce que ça change**\n\\# le changement\n\\> exemple", "**Comment**\nIndexer à 50 % dans nom_fichier.",
      ...(i ? ["**Couvre, dans la spec**\n- Les fiches\n- Les accents",
        "**Attend**\n- " + (i === 1 ? "DEMO-10 — Chercher ## Suite" : "DEMO-11 — Ouvrir")] : []),
      "**Taille** : environ " + ticket.minutes + " min" + (i === 1 ? "\n**Sensible** : approche relue avant le code, deux revues" : "")].join("\n\n");
    assert.deepEqual(input, { id: input.id, teamId: "team", parentId: "parent", title: i ? ticket.title : "Chercher ## Suite", description });
  }
  assert.match(mutations[3].query, /commentCreate\(input: \$input\)/);
  assert.deepEqual(mutations[3].variables.input, { id: mutations[3].variables.input.id, issueId: "parent", body: summary });
  const all = requests();
  for (const [action, data] of [["plan.team", { team: ["claude"] }], ["plan.launch", {}],
    ["pilot.tell", { text: "Autre" }], ["pilot.ticket", { ticket: tickets[0] }]] as const) {
    assert.deepEqual(await cli(action, { ...key, ...data }), first);
  }
  assert.deepEqual(requests(), all); assert.deepEqual(calls(), before);
});

for (const [fault, count] of [["after-commit", 0], ["after-two", 2], ["after-comment", 4], ["lost-answer", 1]] as const) {
  test("a second launch recovers after " + fault + " without repeating a write", async t => {
    const { cli, cliArgs, env, requests, writes, branch } = await ready(t);
    const stopped = spawnSync(process.execPath, [...cliArgs, "plan.launch", JSON.stringify(key)], {
      env: { ...env, TEST_LAUNCH_FAULT: fault }, encoding: "utf8",
    });
    assert.equal(stopped.status, fault === "lost-answer" ? 1 : 73, stopped.stdout + stopped.stderr);
    if (fault === "lost-answer") assert.match(JSON.parse(stopped.stdout).error.message, /Linear n’a pas confirmé/);
    const snapshot = branch("rev-parse", "HEAD");
    assert.equal(branch("diff", "--name-only", "HEAD^", "HEAD"), file); assert.equal(writes().length, count);
    const pending = (await cli("missions.show", key)).data;
    assert.equal(pending.stage, "prepare"); assert.equal(pending.plan.launched, undefined);
    assert.ok(pending.plan.tickets.every((t: { key?: string }) => !t.key));
    assert.deepEqual((await cli("plan.team", { ...key, team: ["claude"] })).data, pending);
    const previous = requests().length;
    const launched = (await cli("plan.launch", key)).data;
    assert.equal(launched.stage, "develop"); assert.equal(launched.plan.launched, true);
    assert.deepEqual(launched.plan.tickets.map((t: { key: string }) => t.key), ["DEMO-10", "DEMO-11", "DEMO-12"]);
    assert.equal(branch("rev-parse", "HEAD"), snapshot);
    const resumed = requests().slice(previous), firstWrite = resumed.findIndex(r => r.query.startsWith("mutation"));
    const reads = firstWrite < 0 ? resumed : resumed.slice(0, firstWrite);
    for (const field of ["children(", "comments("]) assert.ok(reads.some(r => r.query.includes(field)));
    assert.deepEqual(writes().map(r => Object.keys(r.variables.input).includes("issueId") ? "comment" : r.variables.input.title),
      ["Chercher ## Suite", "Ouvrir", "Exporter", "comment"]);
  });
}

test("local scope and a signing failure prevent every tracker request; parent identity is checked before writes", async t => {
  const { cli, path, git, branch, env, requests, writes } = await ready(t);
  const before = requests(), head = branch("rev-parse", "HEAD");
  const settings = (teamKey: string, allowedIssueKeys: string[]) =>
    writeFileSync(path("settings.json"), JSON.stringify({ teamKey, allowedIssueKeys, repository: path("repo") }));
  for (const [team, list] of [["DEMO", []], ["OTHER", ["DEMO-1"]]] as const) {
    settings(team, [...list]);
    assert.equal((await cli("plan.launch", key)).error.message, team === "DEMO" ? "Ce ticket ne figure pas dans la liste autorisée." : "Ce ticket n’appartient pas à l’équipe configurée.");
    assert.deepEqual(requests(), before); assert.equal(branch("rev-parse", "HEAD"), head);
  }
  settings("DEMO", ["DEMO-1"]);
  git("config", "gpg.format", "openpgp"); git("config", "gpg.program", "/usr/bin/false"); git("config", "commit.gpgSign", "true");
  assert.equal((await cli("plan.launch", key)).error.message, "Impossible d’enregistrer le découpage sur la branche de la mission.");
  assert.deepEqual(requests(), before); assert.equal(branch("rev-parse", "HEAD"), head);
  git("config", "commit.gpgSign", "false");
  Object.assign(env, { TEST_LAUNCH_FAULT: "other-team" });
  assert.equal((await cli("plan.launch", key)).error.message, "Ticket introuvable dans Linear.");
  assert.equal(requests().length, before.length + 1); assert.equal(writes().length, 0);
});

test("a missing child is retried with its original ID, and unrelated children and comments are kept", async t => {
  const { cli, env, path, writes } = await ready(t);
  writeFileSync(path("tracker.json"), JSON.stringify({ children: [{ id: "original", identifier: "DEMO-5" }], comments: [{ id: "prior" }] }));
  const fixture: NodeJS.ProcessEnv = env;
  fixture.TEST_LAUNCH_FAULT = "before-write";
  assert.ok((await cli("plan.launch", key)).error);
  const attempted = writes()[0].variables.input.id;
  delete fixture.TEST_LAUNCH_FAULT;
  const result = (await cli("plan.launch", key)).data;
  assert.deepEqual(result.plan.tickets.map((t: { key: string }) => t.key), ["DEMO-11", "DEMO-12", "DEMO-13"]);
  assert.equal(writes().length, 5);
  assert.equal(writes()[1].variables.input.id, attempted);
  const remote = JSON.parse(readFileSync(path("tracker.json"), "utf8"));
  assert.deepEqual(remote.children[0], { id: "original", identifier: "DEMO-5" });
  assert.equal(remote.comments.length, 2); assert.equal(remote.comments[0].id, "prior");
});

test("a damaged launch journal never reaches Git or the tracker on repeated launches", async t => {
  const { cli, path, requests, branch } = await ready(t);
  const file = path("missions/DEMO-1.json"), saved = JSON.parse(readFileSync(file, "utf8"));
  const before = requests(), head = branch("rev-parse", "HEAD");
  const ids = ["1", "2", "3", "4"].map(d => d.repeat(8) + "-1234-4123-a123-123456789abc");
  const valid = { date: "2026-11-21", children: ids.slice(0, 3), comment: ids[3] };
  for (const launch of [null, {}, { ...valid, children: ids.slice(0, 2) }, { ...valid, children: ["bad", ...ids.slice(1,3)] },
    { ...valid, children: [ids[0], ids[0], ids[2]] }, { ...valid, comment: ids[0] }, { ...valid, comment: null },
    { ...valid, date: "x\n---" }]) {
    writeFileSync(file, JSON.stringify({ ...saved, launch }));
    for (let i = 0; i < 2; i++) assert.equal((await cli("plan.launch", key)).error?.message, "Les données de reprise du lancement sont endommagées.");
    assert.deepEqual(requests(), before); assert.equal(branch("rev-parse", "HEAD"), head);
  }
});
