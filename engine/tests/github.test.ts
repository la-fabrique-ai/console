import assert from "node:assert/strict";
import { readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { test } from "node:test";
import { gitAt } from "../pilot.ts";
import { publication } from "./publication-project.ts";

test("an abandoned draft gets one new pull request, which the next attempt reuses", t => {
  const p = publication(t);
  p.api.publish(p.missionBranch, p.missionSha);
  const draft = () => p.api.draft(p.missionBranch, "main", p.missionSha, "Mission");
  assert.equal(draft().number, 1);

  const pulls = JSON.parse(readFileSync(p.path("pulls"), "utf8"));
  pulls[0].state = "CLOSED";
  writeFileSync(p.path("pulls"), JSON.stringify(pulls));
  const replacement = { number: 2, url: "https://github.com/demo/repo/pull/2" };
  assert.deepEqual(draft(), replacement);
  assert.deepEqual(draft(), replacement);
  assert.equal(p.remoteCalls().filter(args => args.includes("create")).length, 2);
});

test("remote Git operations use the gh credential helper and resolve both GitHub SSH URL forms over HTTPS", t => {
  const p = publication(t);
  p.git("config", "credential.helper", "fixture");
  assert.equal(gitAt(p.mission, "config", "--get", "credential.helper").trim(), "fixture");

  gitAt(p.mission, "fetch", "origin", "main");
  gitAt(p.mission, "push", "--dry-run", "origin", "HEAD:refs/heads/probe");
  for (const url of ["git@github.com:demo/ticket.git", "ssh://git@github.com/demo/ticket.git"]) {
    p.git("remote", "set-url", "origin", url);
    assert.equal(gitAt(p.mission, "ls-remote", "--get-url", "origin").trim(), "https://github.com/demo/ticket.git");
    assert.equal(gitAt(p.mission, "remote", "get-url", "origin").trim(), url);
  }
  for (const operation of ["ls-remote", "push", "fetch"]) {
    const args = p.remoteCalls().find(args => args.includes(operation))!;
    const helpers = args.filter(a => /^credential(?:\.https:\/\/github\.com)?\.helper=/.test(a));
    assert.deepEqual(helpers.map(a => a.slice(a.indexOf("=") + 1)), ["", "!gh auth git-credential"], operation);
  }
});

test("merge requires disabled automatic branch deletion, the same target after ready, and the merge on the mission branch", t => {
  const p = publication(t);
  p.api.publish(p.missionBranch, p.missionSha);
  p.api.publish(p.ticketBranch, p.ticketSha);
  p.api.draft(p.missionBranch, "main", p.missionSha, "Mission");
  const ticket = p.api.draft(p.ticketBranch, p.missionBranch, p.ticketSha, "Ticket");
  const merge = () => p.api.merge(p.ticketBranch, p.missionBranch, p.ticketSha, ticket.number);
  const merged = () => p.remoteCalls().filter(args => args.includes("repos/demo/repo/pulls/2/merge"));

  writeFileSync(p.path("auto-delete"), "true");
  assert.equal(merge(), false);
  assert.ok(!p.remoteCalls().some(args => args.includes("ready")));
  assert.equal(merged().length, 0);

  unlinkSync(p.path("auto-delete"));
  writeFileSync(p.path("retarget"), "after ready");
  assert.throws(merge, /GitHub/);
  assert.equal(merged().length, 0);

  const pulls = JSON.parse(readFileSync(p.path("pulls"), "utf8"));
  pulls[1].baseRefName = p.missionBranch;
  writeFileSync(p.path("pulls"), JSON.stringify(pulls));
  writeFileSync(p.path("wrong-remote"), "merge object exists, but is absent from the remote branch");
  assert.throws(merge);
  assert.equal(merged().length, 1);
  assert.equal(p.git("-C", p.mission, "rev-parse", "HEAD"), p.missionSha);
});
