import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { readFileSync, realpathSync, renameSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { test } from "node:test";
import { createInterface } from "node:readline";
import { once } from "node:events";
import { setup } from "./pilot-project.ts";
import { development } from "./develop-project.ts";

for (const tool of ["claude", "codex"]) test(tool + " gets one new session and resumes the same conversation by ID", t => {
  const p = setup(t);
  const session = "44ac9115-567b-4411-8632-234c7cb14737";
  const binary = p.path("bin", tool === "codex" ? "installed-codex" : tool);
  if (tool === "codex") symlinkSync(binary, p.path("bin", tool));
  writeFileSync(binary, `#!${process.execPath}
const fs = require("node:fs");
if (process.env.LINEAR_API_KEY || process.env.GH_TOKEN || process.env.MC_AGENT_ID) process.exit(91);
const input = fs.readFileSync(0,"utf8");
fs.appendFileSync(${JSON.stringify(p.path("turns"))}, JSON.stringify([process.argv.slice(2),input,process.argv[1],{home:process.env.HOME,user:process.env.USER,login:process.env.LOGNAME}])+"\\n");
console.log(JSON.stringify({type:"thread.started",thread_id:${JSON.stringify(session)}}));
`, { mode: 0o700 });
  const run = spawnSync(process.execPath, [p.path("engine/agent-session.ts"), "DEMO-1", "terminal-one", tool, "Role and ticket"], {
    cwd: p.path("repo"), env: { ...p.env, HOME: p.path("operator"), USER: "operator", LOGNAME: "login", GH_TOKEN: "fixture", LINEAR_API_KEY: "fixture", MC_AGENT_ID: "fixture" },
    input: (JSON.stringify({ text:"Une réponse", deliveryId:session }) + "\n").repeat(2), encoding: "utf8",
  });
  assert.equal(run.status, 0, run.stderr);
  const turns = readFileSync(p.path("turns"), "utf8").trim().split("\n").map(l => JSON.parse(l));
  assert.equal(turns.length, 2);
  const [first, next] = turns;
  for (const [args, , , identity] of turns) {
    assert.deepEqual(identity, tool === "claude" ? { home: p.path("operator"), user: "operator" } : { home: p.path("operator") });
    const host = tool === "claude" ? JSON.parse(args[args.indexOf("--mcp-config") + 1]).mcpServers.mc.env :
      Object.fromEntries([...args.find((arg: string) => arg.startsWith("mcp_servers.mc.env=")).matchAll(/(\w+)="([^"]*)"/g)]
        .map(([, key, value]) => [key, value]));
    assert.deepEqual(host, { MISSION_CONTROL_HOME: p.env.MISSION_CONTROL_HOME, HERDR_APP_HOME: p.env.HERDR_APP_HOME,
      HC_SOCKET: p.env.HC_SOCKET, HC_SESSION: p.env.HC_SESSION, PATH: p.env.PATH, HOME: p.path("operator") });
  }
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

for (const role of ["lead", "dev"]) test(role + " shows one failed turn on Development and retries the input on recovery", { timeout: 12000 }, async t => {
  const p = development(t);
  await p.action("develop.start");
  if (role === "dev") await p.action("lead.build", { ticketId: "1" }, p.state().agents.lead.id);
  const agent = p.state().agents[role];
  const fault = p.path("turn-fails"), turns = p.path("turns");
  if (role === "lead") writeFileSync(fault, "");
  writeFileSync(p.path("bin", agent.tool), `#!${process.execPath}
const fs = require("node:fs"), text = fs.readFileSync(0, "utf8");
fs.appendFileSync(${JSON.stringify(turns)}, JSON.stringify([process.argv.slice(2), text]) + "\\n");
if (fs.existsSync(${JSON.stringify(fault)})) process.exit(1);
if (text === "Original delivery") { console.log(JSON.stringify({ type:"turn.failed" })); process.exit(0); }
console.log(JSON.stringify({ type:"thread.started", thread_id:"demo-thread" }));
`, { mode: 0o700 });
  // The wrapper, not this terminal double, writes the receipt when it reads the message.
  renameSync(p.path("bin/hc"), p.path("bin/hc-original"));
  writeFileSync(p.path("bin/hc"), '#!/bin/sh\nif [ "$1" = send ]; then printf "%s" "$4" > "$MISSION_CONTROL_HOME/inbox"; else exec "$MISSION_CONTROL_HOME/bin/hc-original" "$@"; fi\n', { mode: 0o700 });
  const child = spawn(process.execPath, [p.path("engine/agent-session.ts"), "DEMO-1", agent.terminal, agent.tool, "Initial role"], { env: p.env });
  t.after(() => child.kill());
  const finished = once(child, "exit");
  const errors = createInterface({ input: child.stderr })[Symbol.asyncIterator]();
  if (role === "dev") child.stdin.write("Original delivery\n");
  async function failure() {
    assert.match((await errors.next()).value ?? "", /Agent turn failed/);
    const requests = (await p.action("missions.show")).data.development.requests;
    assert.equal(requests.length, 1);
    assert.equal(requests[0].from, role);
    assert.equal(requests[0].ticketId, agent.ticketId);
    assert.match(requests[0].text + requests[0].context, /terminal/i);
    assert.match(requests[0].choices[0], /reprendre/i);
    return requests[0];
  }
  const request = await failure();
  if (role === "lead") {
    child.stdin.write("Other input\n");
    assert.equal((await failure()).id, request.id);
    unlinkSync(fault);
  }
  const reply = role === "lead" ? await p.action("develop.start") :
    await p.action("requests.answer", { requestId: request.id, text: "Réessayez." });
  assert.ok(reply.data?.development.requests[0].answer, JSON.stringify(reply));
  child.stdin.end(readFileSync(p.path("inbox"), "utf8") + "\n");
  assert.equal((await finished)[0], 0);
  const [args, input] = JSON.parse(readFileSync(turns, "utf8").trim().split("\n").at(-1)!);
  assert.ok(input.includes(role === "lead" ? "Initial role" : "Original delivery"));
  assert.ok(input.includes(reply.data.development.requests[0].answer));
  assert.equal(args.includes("--resume") || args.includes("resume"), role === "dev");
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
  } else {
    assert.ok(turns[1][0].includes("--session-id"));
    assert.notEqual(turns[1][0].at(-1), turns[0][0].at(-1));
    assert.equal(turns[3][0][turns[3][0].indexOf("--resume") + 1], turns[1][0].at(-1));
  }
});
