import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
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

test("a Lead still marked starting is relaunched when its terminal is absent or finished", async t => {
  const p = development(t);
  await p.action("develop.start");
  for (const present of [false, true]) {
    const m = p.state(), lead = m.agents.lead;
    lead.starting = true;
    writeFileSync(p.path("missions/DEMO-1.json"), JSON.stringify(m));
    const terminals = present ? [{ name: lead.terminal, cwd: lead.cwd, state: "finished" }] : [];
    writeFileSync(p.path("live"), JSON.stringify({ terminals }));
    const launches = () => p.calls().filter(c => c[0] === "run" && c.includes(lead.terminal)).length;
    const before = launches();
    assert.ok((await p.action("develop.start")).data);
    assert.equal(launches(), before + 1);
    assert.equal(p.state().agents.lead.starting, undefined);
  }
});

for (const outcome of ["confirmed", "unconfirmed", "unconfirmed then failed"]) {
  test("a replacement Lead resolves the removed Lead's request when " + outcome, async t => {
    const p = development(t);
    await p.action("develop.start");
    const lead = p.state().agents.lead;
    writeFileSync(p.path("bin/claude"), "#!/bin/sh\nexit 1\n", { mode: 0o700 });
    function failTurn(terminal: string) {
      const run = spawnSync(process.execPath, [p.path("engine/agent-session.ts"), p.issueKey, terminal, "claude", "Role"],
        { env: p.env, input: "", encoding: "utf8" });
      assert.equal(run.status, 0, run.stderr);
    }
    failTurn(lead.terminal);
    const [failure] = (await p.action("missions.show")).data.development.requests;
    assert.equal(failure.answer, undefined);
    writeFileSync(p.path("live"), JSON.stringify({ terminals: [] }));
    if (outcome !== "confirmed") writeFileSync(p.path("lose-start"), "");
    let result = await p.action("develop.start");
    const replacement = p.state().agents.lead;
    assert.notEqual(replacement.terminal, lead.terminal);
    if (outcome !== "confirmed") {
      assert.ok(result.error);
      if (outcome === "unconfirmed then failed") failTurn(replacement.terminal);
      const pending = (await p.action("missions.show")).data.development.requests;
      assert.deepEqual(pending, [failure]);
      result = await p.action("develop.start");
    }
    assert.deepEqual(result.data?.development.requests, [{ ...failure, answer: failure.choices[0] }]);
    const sends = p.calls().filter(c => c[0] === "send").map(c => [c[2], JSON.parse(c[3]).requestId]);
    assert.deepEqual(sends, outcome === "unconfirmed then failed" ? [[replacement.terminal, failure.id]] : []);
    assert.ok((await p.action("lead.build", { ticketId: "1" }, lead.id)).error);
    assert.equal(p.calls().filter(c => c[0] === "run").length, 2);
  });
}

test("a failed dev launch resumes the same build and adopts a live terminal after a lost start reply", async t => {
  const p = development(t);
  await p.action("develop.start");
  const lead = p.state().agents.lead;
  const build = () => p.action("lead.build", { ticketId:"1" },lead.id);
  writeFileSync(p.path("offline"),"refused");
  assert.ok((await build()).error);
  const dev = p.state().agents.dev;
  const { unlinkSync } = await import("node:fs");
  unlinkSync(p.path("offline"));
  writeFileSync(p.path("lose-start"),"after launch");
  assert.ok((await build()).error);
  const after = p.calls().filter(c => c[0] === "run").length;
  assert.equal((await build()).data?.development.tickets.length,1);
  assert.equal(p.state().agents.dev.terminal,dev.terminal);
  assert.equal(p.calls().filter(c => c[0] === "run").length,after);
  assert.ok((await build()).error);
});

test("the dev worktree has its own actionable failure", async t => {
  const p = development(t);
  await p.action("develop.start");
  p.git("branch","ticket/DEMO-10","HEAD");
  const r = await p.action("lead.build",{ticketId:"1"},p.state().agents.lead.id);
  assert.equal(r.error.message,"Impossible de préparer le dossier de travail du dev.");
});
