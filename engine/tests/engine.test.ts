import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { fileURLToPath } from "node:url";

function project(t: TestContext, linearFailure = "") {
  const home = mkdtempSync(join(tmpdir(), "mission-control-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  writeFileSync(join(home, "settings.json"), JSON.stringify({
    project: "Jiroo", teamKey: "DEMO", allowedIssueKeys: ["DEMO-1"],
  }));
  return (action: string, payload = {}, noKey = false) => {
    const child = spawnSync(process.execPath, ["--import", new URL("./linear-fixture.ts", import.meta.url).href,
      fileURLToPath(new URL("../cli.ts", import.meta.url)), action, JSON.stringify(payload)], {
      env: { MISSION_CONTROL_HOME: home, TEST_LINEAR_FAILURE: linearFailure, TEST_NO_KEY: noKey ? "1" : "" }, encoding: "utf8",
    });
    assert.equal(child.stderr, "");
    const reply = JSON.parse(child.stdout);
    assert.equal(child.status, reply.error ? 1 : 0);
    return reply;
  };
}

test("lists the open issues of the configured team across pages", t => {
  const run = project(t);
  assert.deepEqual(run("issues.list"), { data: [
    { key: "DEMO-1", title: "First issue", status: "À examiner" },
    { key: "DEMO-2", title: "Second issue", status: "À examiner" },
  ] });
});
test("opens the issue as written, including its Markdown and link", t => {
  const run = project(t);
  assert.deepEqual(run("issues.show", { key: "DEMO-2" }), { data: {
    key: "DEMO-2", title: "Second issue", status: "À examiner",
    description: "**Texte original**", url: "https://example.org/ticket/2",
  } });
  assert.equal(run("issues.show", { key: "OTHER-2" }).error.code, "failed");
});

test("explains a missing Linear key before trying HTTP", t => {
  assert.equal(project(t)("issues.list", {}, true).error.code, "linear_key_missing");
});
test("creates one mission and shows its stage on both issue screens", t => {
  const run = project(t);
  const mission = { issueKey: "DEMO-1", title: "First issue", stage: "prepare" };
  assert.deepEqual(run("missions.list", {}, true), { data: [] });
  assert.deepEqual(run("missions.create", { issueKey: "DEMO-1" }), { data: mission });
  assert.deepEqual(run("missions.create", { issueKey: "DEMO-1" }, true), { data: mission });
  assert.deepEqual(run("missions.list", {}, true), { data: [mission] });
  assert.deepEqual(run("issues.list").data.map((i: { missionStage?: string }) => i.missionStage), ["prepare", undefined]);
  assert.equal(run("issues.show", { key: "DEMO-1" }).data.missionStage, "prepare");
});

test("refuses a mission outside the operator's list before contacting Linear", t => {
  const run = project(t);
  assert.equal(run("missions.create", { issueKey: "DEMO-2" }, true).error.code, "issue_not_allowed");
  assert.deepEqual(run("missions.list", {}, true), { data: [] });
});

for (const [failure, message] of [
  ["unauthorized", "Linear refuse l’accès avec cette clé."],
  ["network", "Impossible de joindre Linear."],
  ["graphql", "Linear a rejeté la requête de lecture des tickets."],
]) {
  test(`reports the Linear ${failure} failure on screen`, t => {
    const run = project(t, failure);
    assert.deepEqual(run("issues.list"), { error: { code: "failed", message } });
  });
}
