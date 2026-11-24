import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { test } from "node:test";
import { setup } from "./pilot-project.ts";

for (const tool of ["claude", "codex"]) test(tool + " gets one new session and resumes the same conversation by ID", t => {
  const p = setup(t);
  const session = "44ac9115-567b-4411-8632-234c7cb14737";
  const binary = p.path("bin", tool === "codex" ? "installed-codex" : tool);
  if (tool === "codex") symlinkSync(binary, p.path("bin", tool));
  writeFileSync(binary, `#!${process.execPath}
const fs = require("node:fs");
if (process.env.LINEAR_API_KEY || process.env.GH_TOKEN || process.env.MC_AGENT_ID) process.exit(91);
const input = fs.readFileSync(0,"utf8");
fs.appendFileSync(${JSON.stringify(p.path("turns"))}, JSON.stringify([process.argv.slice(2),input,process.argv[1]])+"\\n");
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
    const installed = realpathSync(binary);
    assert.equal(first[2], installed);
    assert.equal(next[2], installed);
    for (const args of [first[0],next[0]]) {
      for (const feature of ["shell_tool","unified_exec","apps","plugins","browser_use","computer_use","multi_agent"]) {
        const index = args.indexOf(feature);
        assert.equal(args[index - 1], "--disable", feature);
      }
      assert.ok(args.includes('permissions.mission.filesystem={":minimal"="read",":workspace_roots"="read",' + JSON.stringify(installed) + '="read"}'));
      assert.ok(args.includes('mcp_servers.mc.default_tools_approval_mode="approve"'));
      assert.ok(args.includes('permissions.mission.network.enabled=false'));
      assert.ok(args.includes('web_search="disabled"'));
    }
    assert.ok(first[0].includes("--json")); assert.ok(first[0].includes("--ignore-rules"));
    assert.ok(next[0].includes("resume")); assert.ok(next[0].includes(session)); assert.ok(!next[0].includes("--last"));
  } else {
    assert.ok(first[0].includes("--restricted")); assert.ok(first[0].includes("--strict-mcp-config"));
    assert.equal(first[0][first[0].indexOf("--session-id") + 1], next[0][next[0].indexOf("--resume") + 1]);
  }
});

for (const tool of ["claude", "codex"]) test(tool + " keeps processing terminal input after failed turns", t => {
  const p = setup(t);
  const session = "bf698558-c45b-4399-a688-adfb1930c105";
  writeFileSync(p.path("bin", tool), `#!${process.execPath}
const fs = require("node:fs"), file = ${JSON.stringify(p.path("turns"))};
const input = fs.readFileSync(0, "utf8");
fs.appendFileSync(file, JSON.stringify([process.argv.slice(2), input]) + "\\n");
if (input === "Initial role" || input === "Failed turn") process.exit(1);
console.log("diagnostic");
console.log(JSON.stringify({type:"thread.started", thread_id:${JSON.stringify(session)}}));
`, { mode: 0o700 });
  const run = spawnSync(process.execPath, [p.path("engine/agent-session.ts"), "DEMO-1", "term", tool, "Initial role"], {
    cwd: p.path("repo"), env: p.env, input: 'Plain text\nFailed turn\n{"text":"Après"}\n', encoding: "utf8", timeout: 5000,
  });
  assert.equal(run.status, 0, run.stderr);
  const turns = readFileSync(p.path("turns"), "utf8").trim().split("\n").map(l => JSON.parse(l));
  assert.equal(turns.length, 4);
  assert.match(turns[1][1], /Plain text$/);
  assert.equal(turns[3][1], '{"text":"Après"}');
  if (tool === "codex") {
    assert.ok(!turns[1][0].includes("resume"));
    assert.ok(turns[1][1].includes("Initial role"));
    assert.ok(turns[3][0].includes(session));
  } else assert.equal(turns[3][0][turns[3][0].indexOf("--resume") + 1], turns[0][0].at(-1));
});
