import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { test, type TestContext } from "node:test";
import { gitAt } from "../pilot.ts";
import { development } from "./develop-project.ts";

async function project(t: TestContext, team?: string[]) {
  const p = development(t), id = { ticketId: "1" };
  p.git("init", "--bare", p.path("bare"));
  p.git("push", p.path("bare"), "main:main");
  p.git("remote", "set-url", "origin", "https://github.com/demo/repo.git");
  p.git("config", "url." + p.path("bare") + ".insteadOf", "https://github.com/demo/repo.git");
  for (const tool of ["gh","git"]) writeFileSync(p.path("bin",tool),
    '#!/bin/sh\nexec "' + process.execPath + '" "' + p.path("engine/tests/github-fixture.ts") + '" ' + tool + ' "$@"\n', { mode: 0o700 });
  if (team) {
    const m = p.state(); m.plan.team = team;
    writeFileSync(p.path("missions/DEMO-1.json"), JSON.stringify(m));
  }
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

test("the same dev handoff finishes an unconfirmed reviewer start, without another checkout or PR", async t => {
  const p = await project(t); p.commit();
  writeFileSync(p.path("offline"),"before launch");
  assert.ok((await p.done()).error);
  const agent = p.state().agents.reviewer;
  const { unlinkSync } = await import("node:fs"); unlinkSync(p.path("offline"));
  writeFileSync(p.path("lose-start"),"lost after launch");
  assert.ok((await p.done()).error);
  const before = p.calls().filter(c => c[0] === "run").length;
  assert.equal((await p.done()).data?.development.tickets[0].steps.at(-1).kind,"review");
  assert.equal(p.state().agents.reviewer.terminal,agent.terminal);
  assert.equal(p.state().agents.reviewer.cwd,agent.cwd);
  assert.equal(p.calls().filter(c => c[0] === "run").length,before);
  assert.equal(p.log().filter(a => a.includes("create")).length,2);
});

for (const accepted of [true,false]) test("an interrupted verdict reaches the original recipient once: " + accepted, async t => {
  const p = await project(t); p.commit(); await p.done();
  const recipient = p.state().agents[accepted ? "lead" : "dev"];
  writeFileSync(p.path("offline"),"before send");
  assert.ok((await p.verdict(accepted)).error);
  const { unlinkSync } = await import("node:fs"); unlinkSync(p.path("offline"));
  writeFileSync(p.path("lose-send"),"lost after receipt");
  assert.ok((await p.verdict(accepted)).error);
  assert.ok((await p.verdict(accepted)).data);
  assert.ok((await p.verdict(accepted)).data);
  const sends = readFileSync(p.path("delivered"),"utf8").trim().split("\n").map(l => JSON.parse(l));
  assert.equal(sends.length,1); assert.equal(sends[0][2],recipient.terminal);
  assert.deepEqual(JSON.parse(sends[0][3]).remarks,accepted ? [] : ["Corriger le résultat."]);
  assert.equal(p.log().filter(c => c.includes("repos/demo/repo/pulls/2/merge")).length,accepted ? 1 : 0);
});

test("a single Claude dev, fresh Codex reviewer and Lead receive only their commands and the exact assigned context", async t => {
  const p = await project(t, ["claude"]), sha = p.commit();
  p.git("config", "push.followTags", "true");
  p.git("tag", "-a", "unrelated-tag", "-m", "Keep local", sha);
  await p.done();
  assert.equal(p.git("--git-dir",p.path("bare"),"tag","--list"), "");
  const { lead, dev, reviewer } = p.state().agents;
  const launch = (name: string) => p.calls().find(a => a[0] === "run" && a.includes(name))!;
  const assigned = p.state().plan.tickets[0];
  for (const [agent,tool,action] of [[lead,"claude","lead.build"],[dev,"claude","dev.done"],[reviewer,"codex","review.verdict"]]) {
    const args = launch(agent.terminal);
    assert.ok(args, agent.role + " terminal");
    assert.equal(args.at(-2),tool);
    const prompt = args.at(-1)!;
    assert.ok(prompt.includes(agent.role + " role fixture"));
    for (const permitted of [action,"request.ask"]) assert.ok(prompt.includes("mission-control " + permitted + " -"));
    const context = JSON.parse(prompt.split("\n").at(-1)!);
    assert.equal(context.issueKey,"DEMO-1");
    if (agent === lead) {
      for (const doc of ["spec.md","split.md","answers.md"]) assert.ok(prompt.includes("docs/missions/DEMO-1/" + doc));
    } else assert.deepEqual(context.ticket,assigned);
    if (agent === reviewer) {
      assert.equal(context.commit,sha); assert.equal(context.base,p.git("-C",p.mission,"rev-parse","HEAD"));
      assert.equal(context.summary,"Travail terminé.");
    }
  }
  // Both missions and their ticket IDs exist. Each owns distinct terminal identities.
  const other = p.state(); other.issueKey = "DEMO-2";
  for (const agent of Object.values(other.agents) as {id:string}[]) agent.id += "-other";
  writeFileSync(p.path("missions/DEMO-2.json"),JSON.stringify(other));
  for (const agent of [lead,dev,reviewer]) {
    for (const [action,owner] of [["lead.build",lead],["dev.done",dev],["review.verdict",reviewer]] as const) {
      const payload = {ticketId:"1",summary:"Travail terminé.",accepted:false,remarks:["Un point."]};
      if (agent !== owner) assert.equal((await p.action(action,payload,agent.id)).error?.message,"Cette action n’est pas autorisée pour cet agent.");
      assert.equal((await p.action(action,{...payload,issueKey:"DEMO-2"},agent.id)).error?.message,"Cette action n’est pas autorisée pour cet agent.");
    }
    if (agent !== lead) assert.equal((await p.action("request.ask",{ticketId:"2",text:"?",context:"?",choices:[]},agent.id)).error?.message,
      "Cette action n’est pas autorisée pour cet agent.");
  }
  await p.verdict(true);
  assert.equal(existsSync(reviewer.cwd),false);
  const next = await p.action("lead.build",{ticketId:"2"},lead.id);
  assert.equal(next.data?.development.tickets[1].steps[0].tool,"claude");
  assert.equal(p.git("-C",p.state().agents.dev.cwd,"rev-parse","HEAD"),p.git("-C",p.mission,"rev-parse","HEAD"));
});

test("the merge checks the target immediately before and verifies the merge on the remote mission afterwards", async t => {
  const p = await project(t); p.commit(); await p.done();
  writeFileSync(p.path("retarget"),"after ready");
  assert.ok((await p.verdict(true)).error);
  assert.equal(p.log().filter(c => c.includes("repos/demo/repo/pulls/2/merge")).length,0);
  const prs = JSON.parse(readFileSync(p.path("pulls"),"utf8"));
  prs[1].baseRefName = "mission/DEMO-1"; writeFileSync(p.path("pulls"),JSON.stringify(prs));
  writeFileSync(p.path("wrong-remote"),"merge object exists on the host, absent on the mission branch");
  const before = p.git("-C",p.mission,"rev-parse","HEAD");
  assert.ok((await p.verdict(true)).error);
  assert.equal(p.git("-C",p.mission,"rev-parse","HEAD"),before);
  assert.equal(p.state().development.tickets[0].steps.at(-1).accepted,undefined);
});

test("automatic branch deletion blocks the merge with a specific explanation", async t => {
  const p = await project(t); p.commit(); await p.done();
  writeFileSync(p.path("auto-delete"),"true");
  const reply = await p.verdict(true);
  assert.match(reply.error?.message, /réponse.*review\.verdict/i);
  const detail = (await p.action("missions.show")).data;
  const [request] = detail.development.requests;
  assert.equal(request.from, "reviewer");
  assert.equal(request.ticketId, "1");
  assert.match(request.text, /suppression automatique.*GitHub/i);
  await p.verdict(true);
  assert.equal((await p.action("missions.show")).data.development.requests.length, 1);
  assert.ok(!p.log().some(c => c.includes("ready") || c.includes("repos/demo/repo/pulls/2/merge")));
  await p.action("requests.answer", { requestId: request.id, text: "Réglage corrigé." });
  const { unlinkSync } = await import("node:fs");
  unlinkSync(p.path("auto-delete"));
  assert.ok((await p.verdict(true)).data.development.tickets[0].steps.at(-1).accepted);
});

test("reworded retries finish the same handoff and verdict with the original text", async t => {
  const p = await project(t);
  const sha = p.commit();
  const handoff = (summary: string) => p.action("dev.done", { ticketId: "1", summary }, p.dev);
  writeFileSync(p.path("fail-at"), "1");
  assert.match((await handoff("Premier résumé")).error?.message, /request\.ask/);
  writeFileSync(p.path("offline"), "reviewer has not started");
  assert.match((await handoff("Deuxième résumé")).error?.message, /request\.ask/);
  const { unlinkSync } = await import("node:fs");
  unlinkSync(p.path("offline"));
  const resumed = await handoff("Troisième résumé");
  assert.equal(resumed.data?.development.tickets[0].steps[0].summary, "Premier résumé");
  assert.deepEqual(await handoff("Reçu"), resumed);
  const reviewer = p.state().agents.reviewer;
  const start = p.calls().findLast(args => args[0] === "run" && args.includes(reviewer.terminal))!;
  assert.equal(JSON.parse(start.at(-1)!.split("\n").at(-1)!).summary, "Premier résumé");
  const reject = (remark: string) => p.action("review.verdict",
    { ticketId: "1", accepted: false, remarks: [remark] }, reviewer.id);
  writeFileSync(p.path("offline"), "before send");
  assert.match((await reject("Première remarque")).error?.message, /request\.ask/);
  unlinkSync(p.path("offline"));
  const fixed = await reject("Autres mots");
  const steps = fixed.data?.development.tickets[0].steps;
  assert.deepEqual(steps.map((s: any) => s.kind), ["build", "review", "fix"]);
  assert.equal(steps[0].commit, sha);
  assert.deepEqual(steps[1].remarks, ["Première remarque"]);
  assert.deepEqual(await reject("Encore autrement"), fixed);
  assert.ok((await p.verdict(true)).error);
  const delivered = readFileSync(p.path("delivered"), "utf8").trim().split("\n");
  assert.equal(delivered.length, 1);
  assert.deepEqual(JSON.parse(JSON.parse(delivered[0])[3]).remarks, ["Première remarque"]);
});

test("a dev can ask the operator about its own ticket during review", async t => {
  const p = await project(t);
  p.commit();
  await p.done();
  const question = { ticketId: "1", text: "Quel ordre souhaitez-vous ?", context: "Le tri reste à préciser.", choices: [] };
  const asked = await p.action("request.ask", question, p.dev);
  const request = asked.data?.development.requests[0];
  assert.equal(request?.from, "dev", JSON.stringify(asked));
  assert.equal(request.ticketId, "1");
});

test("a handoff refuses nested repository metadata before Git inspects or stages the ticket", async t => {
  const p = await project(t);
  p.commit();
  const nested = p.cwd + "/vendor/example";
  mkdirSync(nested, { recursive: true });
  const { rmSync } = await import("node:fs");
  const advice = "Retirez le dépôt Git imbriqué du dossier du ticket avant de continuer.";
  // Inert metadata is sufficient. Nothing executable is installed in the fixture.
  for (const shape of ["directory", "gitfile", "bare"]) {
    if (shape === "directory") p.git("init", "-q", nested);
    else if (shape === "gitfile") writeFileSync(nested + "/.git", "gitdir: missing\n");
    else p.git("init", "--bare", "-q", nested);
    assert.equal((await p.done()).error?.message, advice, shape);
    for (const args of [["add", "--all", "--", "."], ["commit", "-m", "Test"]]) {
      assert.throws(() => gitAt(p.cwd, ...args), { message: advice });
    }
    rmSync(nested, { recursive: true });
    mkdirSync(nested);
  }
  assert.ok((await p.done()).data);
  const reviewFolder = p.state().agents.reviewer.cwd;
  mkdirSync(reviewFolder + "/manual/.git", { recursive: true });
  assert.ok((await p.verdict(false)).data, "keep an externally modified review checkout");
  assert.ok(existsSync(reviewFolder + "/manual/.git"));
});

test("engine Git overrides filesystem monitoring at its common command boundary", async t => {
  const p = await project(t);
  p.git("config", "core.fsmonitor", "true");
  assert.equal(gitAt(p.cwd, "config", "--bool", "--get", "core.fsmonitor").trim(), "false");
});
