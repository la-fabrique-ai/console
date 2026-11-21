import assert from "node:assert/strict";
import { existsSync, writeFileSync } from "node:fs";
import { test } from "node:test";
import { development } from "./develop-project.ts";

test("an older mission starts one Lead and replaces a lost terminal, then starts one ready dev on the mission tip", async t => {
  const { action, cli, state, calls, path, git, mission } = development(t);
  assert.equal((await cli("missions.list")).data.length, 1);
  assert.equal((await action("missions.show")).data.development, undefined);
  const first = await action("develop.start");
  assert.deepEqual(first.data?.development, { tickets: [], requests: [] });
  assert.equal(first.data.agents, undefined);
  const initial = state().agents.lead.id;
  assert.deepEqual(await action("develop.start"), first);
  assert.equal(calls().filter(c => c[0] === "run").length, 1);
  writeFileSync(path("live"), JSON.stringify({ terminals: [] }));
  await action("develop.start");
  const lead = state().agents.lead.id;
  assert.notEqual(lead, initial);
  for (const [id, agent] of [["1", initial], ["1", undefined], ["2", lead], ["absent", lead]] as const)
    assert.ok((await action("lead.build", { ticketId: id }, agent)).error);
  assert.ok((await action("lead.build", { issueKey: "DEMO-2", ticketId: "1" }, lead)).error);
  const built = await action("lead.build", { ticketId: "1" }, lead);
  assert.deepEqual(built.data.development.tickets.map((r: any) => [r.id, r.branch, r.steps[0].kind, r.steps[0].tool]),
    [["1", "ticket/DEMO-10", "build", "codex"]]);
  const cwd = path("Developer/worktrees/repo/DEMO-10");
  assert.equal(git("-C", cwd, "rev-parse", "HEAD"), git("-C", mission, "rev-parse", "HEAD"));
  assert.equal(git("-C", cwd, "branch", "--show-current"), "ticket/DEMO-10");
  assert.equal(calls().filter(c => c[0] === "run").length, 3);
  for (const [id, agent] of [["1", lead], ["2", lead], ["1", state().agents.dev.id]])
    assert.ok((await action("lead.build", { ticketId: id }, agent)).error);
  assert.ok((await action("develop.start", {}, state().agents.dev.id)).error);
  assert.equal(existsSync(path("linear-requests")), false);
});
