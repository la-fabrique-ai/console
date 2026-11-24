import assert from "node:assert/strict";
import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import os from "node:os";
import { test, type TestContext } from "node:test";
import { gitAt } from "../pilot.ts";
import { mergeTicket, publishTicket } from "../review.ts";
import { development } from "./develop-project.ts";
import { publication } from "./publication-project.ts";

function useGitSettings(t: TestContext, home: string) {
  const originalHome = process.env.MISSION_CONTROL_HOME;
  process.env.MISSION_CONTROL_HOME = home;
  t.after(() => {
    if (originalHome === undefined) delete process.env.MISSION_CONTROL_HOME;
    else process.env.MISSION_CONTROL_HOME = originalHome;
  });
}

function ticketCheckout(t: TestContext) {
  const p = development(t);
  const cwd = p.path("Developer/worktrees/repo/DEMO-10");
  p.git("worktree", "add", "-b", "ticket/DEMO-10", cwd, "mission/DEMO-1");
  useGitSettings(t, p.env.MISSION_CONTROL_HOME);
  return { ...p, cwd };
}

test("publication refuses an unchanged or dirty ticket, then retries both draft PRs at their original commits", t => {
  const p = publication(t);
  const home = t.mock.method(os, "homedir", () => p.path());
  syncBuiltinESMExports();
  t.after(() => { home.mock.restore(); syncBuiltinESMExports(); });
  const dir = p.path("missions"), repository = p.path("repo"), cwd = p.path("Developer/worktrees/repo/DEMO-10");
  p.git("worktree", "add", "-b", p.ticketBranch, cwd, p.missionSha);
  const m = p.state();
  m.development = { tickets: [{ id: "1", branch: p.ticketBranch,
    steps: [{ kind: "build", tool: "claude", startedAt: "2026-11-24T08:00:00Z" }] }], requests: [] };
  writeFileSync(p.path("missions/DEMO-1.json"), JSON.stringify(m));
  const publish = (summary: string) => {
    const mission = p.state();
    return publishTicket(dir, repository, mission, mission.development.tickets[0], summary);
  };
  assert.throws(() => publish("Travail terminé."), /Commitez vos modifications/);
  p.git("-C", cwd, "merge", "--ff-only", p.ticketSha);
  writeFileSync(cwd + "/dirty", "change");
  assert.throws(() => publish("Travail terminé."), /Commitez vos modifications/);
  p.git("-C", cwd, "add", "dirty");
  assert.throws(() => publish("Travail terminé."), /Commitez vos modifications/);
  p.git("-C", cwd, "restore", "--staged", "dirty");
  unlinkSync(cwd + "/dirty");

  writeFileSync(p.path("fail-at"), "2"); // The first push succeeded, but its reply was lost.
  assert.throws(() => publish("Premier résumé."), /GitHub/);
  assert.equal(p.state().publication.commit, p.ticketSha);
  p.git("-C", cwd, "commit", "--allow-empty", "-m", "Later work");
  publish("Nouveau résumé.");
  const saved = p.state(), run = saved.development.tickets[0];
  assert.deepEqual(run.steps.map((s: { commit: string; summary: string }) => [s.commit, s.summary]),
    [[p.ticketSha, "Premier résumé."]]);
  assert.equal(saved.development.pr.number, 1);
  assert.equal(run.pr.number, 2);
  const pushes = p.remoteCalls().filter(args => args.includes("push"));
  assert.deepEqual(pushes.map(args => args.at(-1)), [
    p.missionSha + ":refs/heads/" + p.missionBranch, p.ticketSha + ":refs/heads/" + p.ticketBranch,
  ]);
  assert.equal(saved.publication, undefined);

  assert.equal(mergeTicket(dir, repository, saved, run, p.ticketSha), true);
  assert.equal(p.git("-C", p.mission, "rev-parse", "HEAD^2"), p.ticketSha);
  assert.equal(p.state().merging, undefined);
});

test("ticket Git refuses a replaced root .git", async t => {
  const p = ticketCheckout(t);
  const root = p.cwd + "/.git", saved = p.path("ticket-gitfile");
  const registered = p.git("-C", p.cwd, "rev-parse", "--absolute-git-dir");
  // Withdraw the checkout pointer after validation, just as Git starts. Discovery would now fail.
  const { execFileSync } = await import("node:child_process");
  const probe = `import cp from "node:child_process"; import fs from "node:fs";
    import { syncBuiltinESMExports } from "node:module";
    const [folder, saved] = process.argv.slice(1), run = cp.execFileSync;
    cp.execFileSync = (cmd, args, options) => {
      if (cmd === "git" && args.includes("--absolute-git-dir")) fs.renameSync(folder + "/.git", saved);
      return run(cmd, args, options);
    };
    syncBuiltinESMExports();
    const { gitAt } = await import("./engine/pilot.ts");
    console.log(gitAt(folder, "rev-parse", "--absolute-git-dir").trim());`;
  assert.equal(execFileSync(process.execPath, ["--input-type=module", "-e", probe, p.cwd, saved],
    { env: p.env, encoding: "utf8" }).trim(), registered);
  renameSync(p.path("origin/.git"), root);
  const advice = "Rétablissez le fichier .git du dossier de travail avant de continuer.";
  for (const args of [["rev-parse", "--absolute-git-dir"], ["status", "--porcelain"], ["add", "--all"], ["commit", "--allow-empty", "-m", "Replacement"]]) {
    assert.throws(() => gitAt(p.cwd, ...args), { message: advice }, args[0]);
  }
  renameSync(root, p.path("origin/.git"));
  // Even a legitimate sibling checkout cannot substitute its registration.
  writeFileSync(root, readFileSync(p.mission + "/.git"));
  assert.throws(() => gitAt(p.cwd, "rev-parse", "HEAD"), { message: advice });
  renameSync(saved, root);
  assert.equal(gitAt(p.cwd, "rev-parse", "--absolute-git-dir").trim(), registered);
});

test("ticket Git refuses nested repository metadata before inspecting or staging", async t => {
  const p = ticketCheckout(t);
  const nested = p.cwd + "/vendor/example";
  mkdirSync(nested, { recursive: true });
  const { rmSync } = await import("node:fs");
  const advice = "Retirez le dépôt Git imbriqué du dossier du ticket avant de continuer.";
  // Inert metadata is sufficient. Nothing executable is installed in the fixture.
  for (const shape of ["directory", "gitfile", "bare"]) {
    if (shape === "directory") p.git("init", "-q", nested);
    else if (shape === "gitfile") writeFileSync(nested + "/.git", "gitdir: missing\n");
    else p.git("init", "--bare", "-q", nested);
    for (const args of [["status", "--porcelain"], ["add", "--all", "--", "."], ["commit", "-m", "Test"]]) {
      assert.throws(() => gitAt(p.cwd, ...args), { message: advice });
    }
    rmSync(nested, { recursive: true });
    mkdirSync(nested);
  }
  const { chmodSync } = await import("node:fs");
  chmodSync(nested, 0);
  try { assert.throws(() => gitAt(p.cwd, "status", "--porcelain"), /droits de lecture/); }
  finally { chmodSync(nested, 0o700); }
  assert.doesNotThrow(() => gitAt(p.cwd, "status", "--porcelain"));
});

test("missing project settings identify what is missing before Git inspects the checkout", async t => {
  const p = development(t);
  useGitSettings(t, p.env.MISSION_CONTROL_HOME);
  const inspect = () => gitAt(p.mission, "rev-parse", "HEAD");
  unlinkSync(p.path("settings.json"));
  const missingFile = "Le fichier settings.json des réglages du projet est introuvable.";
  assert.throws(inspect, { message: missingFile });
  assert.equal((await p.action("missions.show")).error?.message, missingFile);

  writeFileSync(p.path("settings.json"), "{}");
  assert.throws(inspect, { message: "Indiquez le dépôt Git dans les réglages du projet." });
  delete process.env.MISSION_CONTROL_HOME;
  assert.throws(inspect, { message: "Le dossier Mission Control n’est pas configuré." });
});

test("engine Git overrides filesystem monitoring at its common command boundary", t => {
  const p = ticketCheckout(t);
  p.git("config", "core.fsmonitor", "true");
  assert.equal(gitAt(p.cwd, "config", "--bool", "--get", "core.fsmonitor").trim(), "false");
});
