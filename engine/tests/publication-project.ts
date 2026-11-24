import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import type { TestContext } from "node:test";
import { github } from "../github.ts";
import { development } from "./develop-project.ts";

export function publication(t: TestContext) {
  const p = development(t);
  const previous = process.env;
  process.env = { ...p.env, HOME: p.path(), TMPDIR: tmpdir() };
  t.after(() => { process.env = previous; });

  const origin = "https://github.com/demo/repo.git", bare = p.path("bare");
  p.git("init", "--bare", bare);
  p.git("push", "--quiet", bare, "main:main");
  p.git("remote", "set-url", "origin", origin);
  p.git("config", "url." + bare + ".insteadOf", origin);
  p.git("config", "protocol.allow", "never");
  p.git("config", "protocol.file.allow", "always");
  const missionBranch = "mission/DEMO-1", ticketBranch = "ticket/DEMO-10";
  const missionSha = p.git("rev-parse", missionBranch);
  const ticketSha = p.git("commit-tree", missionSha + "^{tree}", "-p", missionSha, "-m", "Ticket change");

  for (const tool of ["git", "gh"]) {
    const script = '#!/bin/sh\nexec "' + process.execPath + '" "' + p.path("engine/tests/github-fixture.ts") + '" ' + tool + ' "$@"\n';
    writeFileSync(p.path("bin", tool), script, { mode: 0o700 });
  }
  const remoteCalls = (): string[][] => readFileSync(p.path("remote-calls"), "utf8").trim().split("\n").map(line => JSON.parse(line));
  return { ...p, api: github(p.mission), missionBranch, ticketBranch, missionSha, ticketSha, remoteCalls };
}
