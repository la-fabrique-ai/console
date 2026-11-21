import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { test } from "node:test";
import { setup } from "./pilot-project.ts";

for (const tool of ["claude", "codex"]) test(tool + " gets one new session and resumes the same conversation by ID", t => {
  const p = setup(t);
  const session = "44ac9115-567b-4411-8632-234c7cb14737";
  writeFileSync(p.path("bin", tool), `#!${process.execPath}
const fs = require("node:fs");
if (process.env.LINEAR_API_KEY || process.env.GH_TOKEN || process.env.MC_AGENT_ID) process.exit(91);
const input = fs.readFileSync(0,"utf8");
fs.appendFileSync(${JSON.stringify(p.path("turns"))}, JSON.stringify([process.argv.slice(2),input])+"\\n");
console.log(JSON.stringify({type:"thread.started",thread_id:${JSON.stringify(session)}}));
`, { mode: 0o700 });
  const run = spawnSync(process.execPath, [p.path("engine/agent-session.ts"), "DEMO-1", "terminal-one", tool, "Role and ticket"], {
    cwd: p.path("repo"), env: { ...p.env, GH_TOKEN: "fixture", LINEAR_API_KEY: "fixture", MC_AGENT_ID: "fixture" },
    input: (JSON.stringify({ text:"Une réponse", deliveryId:session }) + "\n").repeat(2), encoding: "utf8",
  });
  assert.equal(run.status, 0, run.stderr);
  const turns = readFileSync(p.path("turns"), "utf8").trim().split("\n").map(l => JSON.parse(l));
  assert.equal(turns.length, 2);
  const [first, next] = turns;
  assert.equal(first[1], "Role and ticket"); assert.equal(JSON.parse(next[1]).text, "Une réponse");
  if (tool === "codex") {
    for (const args of [first[0],next[0]]) {
      for (const feature of ["shell_tool","unified_exec","apps","plugins","browser_use","computer_use","multi_agent"]) {
        const index = args.indexOf(feature);
        assert.equal(args[index - 1], "--disable", feature);
      }
      assert.ok(args.includes('permissions.mission.filesystem={":minimal"="read",":workspace_roots"="read"}'));
      assert.ok(args.includes('web_search="disabled"'));
    }
    assert.ok(first[0].includes("--json")); assert.ok(first[0].includes("--ignore-rules"));
    assert.ok(next[0].includes("resume")); assert.ok(next[0].includes(session)); assert.ok(!next[0].includes("--last"));
  } else {
    assert.ok(first[0].includes("--restricted")); assert.ok(first[0].includes("--strict-mcp-config"));
    assert.equal(first[0][first[0].indexOf("--session-id") + 1], next[0][next[0].indexOf("--resume") + 1]);
  }
});
