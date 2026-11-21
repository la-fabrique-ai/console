import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { setup } from "./pilot-project.ts";

const key = { issueKey: "DEMO-1" };
const first = { id: "1", title: "Rechercher", change: "Trouver une fiche." };
const ticket = { ...first, how: "Indexer les fiches.", covers: ["Recherche"], after: [], minutes: 30,
  sensitive: true, parallel: { dev: 1, step: 1 } };
const complete = { ...key, tickets: [ticket], testMinutes: 10, validationMinutes: 5,
  advice: "Une personne suffit.", summary: "Les fiches sont consultables." };

test("Pilot streams a local draft after validation and the operator can choose one or two tools", async t => {
  const { cli, calls, git, path, env } = setup(t);
  git("config", "user.name", "Test"); git("config", "user.email", "dev@example.invalid");
  await cli("missions.create", key);
  await cli("pilot.questions", { ...key, questions: [] });
  await cli("spec.write", key);
  await cli("pilot.spec", { ...key, note: "La spec.", sections: [] });
  const old = (await cli("missions.show", key)).data;
  assert.ok(old.spec); assert.equal(old.plan, undefined);
  assert.equal((await cli("missions.list")).data[0].stage, "prepare");
  await cli("pilot.plan", complete);
  assert.equal((await cli("missions.show", key)).data.plan, undefined);
  assert.equal((await cli("spec.validate", key)).data.pilotBusy, "split");
  const sends = calls();
  const pilot: NodeJS.ProcessEnv = env;
  pilot.MC_PILOT_ISSUE = key.issueKey;
  assert.ok((await cli("pilot.ticket", { issueKey: "DEMO-2", ticket: first })).error);
  assert.ok((await cli("plan.launch", key)).error);
  const partial = await cli("pilot.ticket", { ...key, ticket: first });
  assert.deepEqual(partial.data.plan.found, [first]); assert.deepEqual(partial.data.plan.team, ["claude"]);
  assert.equal(partial.data.pilotBusy, "split"); assert.deepEqual(partial.data.plan.tickets, []);
  assert.deepEqual(await cli("pilot.ticket", { ...key, ticket: first }), partial);
  delete pilot.MC_PILOT_ISSUE;
  assert.ok((await cli("plan.launch", key)).error);
  for (const team of [[], ["other"], ["claude", "codex", "claude"]]) assert.ok((await cli("plan.team", { ...key, team })).error);
  const team = ["codex", "codex"];
  assert.deepEqual((await cli("plan.team", { ...key, team })).data.plan.team, team);
  pilot.MC_PILOT_ISSUE = key.issueKey;
  const long = { ...ticket, how: "Indexation. ".repeat(15000) };
  const done = (await cli("pilot.plan", { ...complete, tickets: [{ ...long, key: "FAKE-1" }] }, true)).data;
  assert.equal(done.pilotBusy, undefined); assert.equal(done.stage, "prepare");
  assert.deepEqual(done.plan, { found: [first], tickets: [long], testMinutes: 10, validationMinutes: 5, advice: complete.advice, team });
  assert.equal(done.planSummary, undefined);
  assert.deepEqual((await cli("pilot.plan", complete)).data, done);
  assert.deepEqual((await cli("pilot.ticket", { ...key, ticket: { ...first, id: "2" } })).data, done);
  delete pilot.MC_PILOT_ISSUE;
  assert.deepEqual((await cli("plan.team", { ...key, team: ["claude"] })).data.plan.tickets, [long]);
  assert.deepEqual(calls(), sends);
  assert.equal(existsSync(path("Developer/worktrees/repo/DEMO-1/docs/missions/DEMO-1/split.md")), false);
  const queries = readFileSync(path("linear-requests"), "utf8").trim().split("\n").map(line => JSON.parse(line).query);
  assert.equal(queries.length, 1); assert.match(queries[0], /query Issues/);
});
