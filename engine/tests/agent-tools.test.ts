import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { test } from "node:test";
import { development } from "./develop-project.ts";

test("the session's tools constrain project writes, callbacks and commits to the assigned agent", async t => {
  const p = development(t);
  await p.action("develop.start"); const lead = p.state().agents.lead;
  await p.action("lead.build",{ ticketId: "1" },lead.id);
  const dev = p.state().agents.dev;
  function call(agent: { terminal: string }, name: string, args: object) {
    const message = { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } };
    const run = spawnSync(process.execPath, [p.path("engine/agent-tools.ts"),"DEMO-1",agent.terminal], {
      env: { ...p.env, LINEAR_API_KEY: "private", GH_TOKEN: "private" }, input: JSON.stringify(message) + "\n", encoding: "utf8",
    });
    assert.equal(run.status,0,run.stderr);
    return JSON.parse(run.stdout).result;
  }
  const shell = (agent: typeof dev, script: string) => call(agent,"shell",{ script });
  const first = shell(dev,'printf ok > built && node -e "process.stdout.write(process.version)"');
  assert.equal(first.isError,false,JSON.stringify(first));
  assert.equal(readFileSync(dev.cwd + "/built","utf8"),"ok");
  for (const script of ['echo bad > "' + p.mission + '/bad"', 'cat "' + p.path("settings.json") + '"',
    'echo bad >> .git', 'test -n "$LINEAR_API_KEY"', 'test -n "$GH_TOKEN"']) assert.equal(shell(dev,script).isError,true,script);
  assert.equal(shell(lead,'echo bad > bad').isError,true);
  assert.equal(existsSync(p.mission + "/bad"),false);
  assert.equal(call(lead,"commit",{ message:"No" }).isError,true);
  assert.equal(call(dev,"commit",{ message:"Deliver" }).isError,false);
  assert.equal(p.git("-C",dev.cwd,"show","HEAD:built"),"ok");
  assert.equal(call(dev,"command",{ action:"lead.build",json:JSON.stringify({issueKey:"DEMO-1",ticketId:"2"}) }).isError,true);
  const payload = { issueKey:"DEMO-1",text:"Quelle option ?",context:"Choix.",choices:["Une"] };
  assert.equal(call(dev,"command",{ action:"request.ask",json:JSON.stringify(payload) }).isError,false);
  assert.equal(p.state().development.requests[0].from,"dev");
  const m = p.state(); m.agents.reviewer = { ...dev, role:"reviewer", terminal:"review-test", id:"reviewer" };
  writeFileSync(p.path("missions/DEMO-1.json"),JSON.stringify(m));
  assert.equal(shell(m.agents.reviewer,"cat built").isError,false);
  assert.equal(shell(m.agents.reviewer,"echo bad > built").isError,true);
  assert.equal(call(m.agents.reviewer,"commit",{message:"No"}).isError,true);
});
