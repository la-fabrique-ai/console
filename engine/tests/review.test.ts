import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { test, type TestContext } from "node:test";
import { development } from "./develop-project.ts";

async function project(t: TestContext) {
  const p = development(t), id = { ticketId: "1" };
  p.git("init", "--bare", p.path("bare"));
  p.git("push", p.path("bare"), "main:main");
  p.git("remote", "set-url", "origin", "https://github.com/demo/repo.git");
  p.git("config", "url." + p.path("bare") + ".insteadOf", "https://github.com/demo/repo.git");
  for (const tool of ["gh","git"]) writeFileSync(p.path("bin",tool),
    '#!/bin/sh\nexec "' + process.execPath + '" "' + p.path("engine/tests/github-fixture.ts") + '" ' + tool + ' "$@"\n', { mode: 0o700 });
  await p.action("develop.start");
  await p.action("lead.build", id, p.state().agents.lead.id);
  const dev = p.state().agents.dev.id, cwd = p.path("Developer/worktrees/repo/DEMO-10");
  const done = () => p.action("dev.done", { ...id, summary: "Travail terminé." }, dev);
  const verdict = (accepted: boolean, reviewer = p.state().agents.reviewer.id) => p.action("review.verdict",
    { ...id, accepted, remarks: accepted ? [] : ["Corriger le résultat."] }, reviewer);
  const commit = () => { p.git("-C", cwd, "commit", "--allow-empty", "-m", "Work"); return p.git("-C", cwd, "rev-parse", "HEAD"); };
  const log = () => readFileSync(p.path("remote-calls"),"utf8").trim().split("\n").map(s => JSON.parse(s) as string[]);
  return { ...p, dev, cwd, done, verdict, commit, log };
}

test("review refuses dirty or unchanged work; a fix goes once to the dev and its new commit gets a fresh opposite reviewer", async t => {
  const p = await project(t);
  assert.ok((await p.done()).error);
  const sha = p.commit();
  writeFileSync(p.cwd + "/dirty","new");
  assert.ok((await p.done()).error);
  p.git("-C",p.cwd,"add","dirty"); assert.ok((await p.done()).error);
  p.git("-C",p.cwd,"restore","--staged","dirty");
  const { unlinkSync } = await import("node:fs"); unlinkSync(p.cwd + "/dirty");
  const reviewed = await p.done();
  assert.equal(reviewed.data?.development.tickets[0].steps[0].commit,sha,JSON.stringify(reviewed));
  const first = p.state().agents.reviewer;
  assert.equal(first.tool,"claude");
  assert.equal(p.git("-C",first.cwd,"rev-parse","HEAD"),sha);
  assert.ok((await p.verdict(false,p.dev)).error);
  assert.ok((await p.verdict(false)).data); await p.verdict(false);
  assert.ok((await p.done()).error); p.commit(); assert.ok((await p.done()).data);
  assert.notEqual(p.state().agents.reviewer.id,first.id);
  assert.ok((await p.verdict(true,first.id)).error);
  const result = (await p.verdict(true)).data;
  assert.deepEqual(result.development.tickets[0].steps.map((s: any) => s.kind),["build","review","fix","review"]);
  assert.equal(result.development.tickets[0].steps.at(-1).accepted,true);
  assert.equal(p.calls().filter(a => a[0] === "send").length,2);
  assert.equal(existsSync(p.path("linear-requests")),false);
});

test("every remote reply can be lost: the same two callbacks publish only the pinned heads and merge the ticket once", async t => {
  let total = 1;
  for (let fault = 0; fault <= total; fault++) {
    const p = await project(t), main = p.git("rev-parse","main"), sha = p.commit();
    writeFileSync(p.path("fail-at"),String(fault));
    let result = await p.done();
    if (result.error) { p.commit(); result = await p.done(); }
    assert.equal(result.data?.development.tickets[0].steps[0].commit,sha,JSON.stringify(result));
    result = await p.verdict(true);
    if (result.error) result = await p.verdict(true);
    assert.equal(result.data?.development.tickets[0].steps.at(-1).accepted,true,JSON.stringify(result));
    const calls = p.log();
    if (!fault) total = calls.length;
    const pushes = calls.filter(a => a.includes("push"));
    assert.deepEqual(pushes.map(a => a.at(-1)), [p.git("-C",p.mission,"rev-parse","HEAD^1") + ":refs/heads/mission/DEMO-1",sha + ":refs/heads/ticket/DEMO-10"]);
    assert.ok(pushes.every(a => !a.some(v => v.startsWith("+") || v.includes("--force"))));
    const prs = JSON.parse(readFileSync(p.path("pulls"),"utf8"));
    assert.deepEqual(prs.map((r: any) => [r.headRefName,r.baseRefName,r.isDraft,r.state]),
      [["mission/DEMO-1","main",true,"OPEN"],["ticket/DEMO-10","mission/DEMO-1",false,"MERGED"]]);
    assert.equal(calls.filter(a => a.includes("create")).length,2);
    assert.equal(calls.filter(a => a.includes("repos/demo/repo/pulls/2/merge")).length,1);
    assert.equal(p.git("-C",p.mission,"rev-parse","HEAD^2"),sha);
    assert.equal(p.git("--git-dir",p.path("bare"),"rev-parse","main"),main);
    assert.equal(p.calls().filter(a => a[0] === "send").length,1);
  }
});
