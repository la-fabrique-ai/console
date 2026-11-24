import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { test, type TestContext } from "node:test";
import { development } from "./develop-project.ts";
import { installForge } from "./runtime-fixture.ts";

function project(t: TestContext) {
  const p = development(t), forge = installForge(p), m = p.state();
  Object.assign(m.plan.tickets[0], { title: "Chercher", change: "Filtrer les fiches", how: "Indexer le nom", covers: ["Accents"] });
  writeFileSync(p.path("missions/DEMO-1.json"), JSON.stringify(m));
  const docs = p.mission + "/docs/missions/DEMO-1";
  mkdirSync(docs, { recursive: true });
  for (const name of ["spec", "answers", "split"]) writeFileSync(docs + "/" + name + ".md", "Validated " + name);
  p.git("-C", p.mission, "add", "docs"); p.git("-C", p.mission, "commit", "-m", "Mission documents");
  return { ...p, forge };
}

test("Development assigns the first ready ticket and its committed documents once, even across concurrent clicks and reads", async t => {
  const p = project(t);
  writeFileSync(p.mission + "/docs/missions/DEMO-1/spec.md", "Local draft");
  assert.equal((await p.action("missions.show")).data.development, undefined);
  assert.equal(p.forge.calls().length, 0);
  const results = await Promise.all([p.action("develop.start"), p.action("develop.start")]);
  for (const r of results) assert.ok(r.data?.development, JSON.stringify(r));
  await p.action("missions.show");
  const assigns = p.forge.calls().filter(c => c.op === "assign");
  assert.equal(assigns.length, 1);
  const { target, stdin } = assigns[0];
  assert.equal(target, "agent-studio-lead");
  for (const value of ["Role supplied by the project.", "DEMO-10", "Filtrer les fiches", "Indexer le nom", "Accents",
    "docs/missions/DEMO-1", "Validated spec", "Validated answers", "Validated split", "PostgreSQL", "Playwright", "reviewer"]) {
    assert.ok(stdin.includes(value), value);
  }
  assert.ok(!stdin.includes("Local draft"));
  assert.equal(results[0].data.runtime, undefined);
});

test("starting without the host or the team explains which settings to fill in", async t => {
  const p = project(t), path = p.path("settings.json");
  const settings = JSON.parse(readFileSync(path, "utf8"));
  for (const key of ["runtimeHost", "runtimeTeam"]) {
    writeFileSync(path, JSON.stringify({ ...settings, [key]: undefined }));
    assert.match((await p.action("develop.start")).error?.message ?? "", /runtimeHost.*runtimeTeam/);
  }
  assert.equal(p.forge.calls().length, 0);
});

function assigned(p: ReturnType<typeof project>) {
  const [lead, dev, reviewer] = p.forge.members;
  Object.assign(lead, { task: "(no branch)", session: "working", assignedBy: "human" });
  Object.assign(dev, { task: "demo-10", session: "working", assignedBy: lead.name });
  const input = p.forge.calls().find(c => c.op === "assign").stdin;
  const ref: string = JSON.parse(input.slice(input.lastIndexOf("\n") + 1)).reference;
  function event(id: number, from: string, kind: string, body: string, reference = ref) {
    const item = { id, from, time: new Date().toISOString(), summary: "MC " + reference + " " + kind, hasBody: true };
    writeFileSync(p.path("question-" + id), JSON.stringify({ ...item, state: "open", body }));
    return item;
  }
  return { lead, dev, reviewer, event };
}

test("Development follows building, review, refusal, corrections and explicit acceptance from the Lead Inbox", async t => {
  const p = project(t);
  await p.action("develop.start");
  const { lead, dev, reviewer, event } = assigned(p);
  const read = async () => (await p.action("missions.show")).data.development.tickets[0];
  p.forge.status();
  const building = await read();
  assert.equal(building?.branch, "agent/demo-10");
  assert.deepEqual(building.steps.map((s: any) => [s.kind,s.tool]), [["build","claude"]]);
  assert.ok(Number.isFinite(Date.parse(building.steps[0].startedAt)));
  Object.assign(reviewer, { task: "(no branch)", assignedBy: lead.name, session: "working" });
  p.forge.status();
  const reviewing = await read();
  assert.deepEqual(reviewing.steps.map((s: any) => s.kind), ["build","review"]);
  assert.equal(reviewing.steps[0].startedAt, building.steps[0].startedAt);
  const refusal = event(3, lead.name, "REFUSED", JSON.stringify({ summary:"Recherche testée", remarks:["Corriger le tri."] }));
  Object.assign(reviewer, { task:null, session:"none", assignedBy:null }); p.forge.status([refusal]);
  const fixing = await read();
  assert.deepEqual(fixing.steps.map((s: any) => s.kind), ["build","review","fix"]);
  assert.equal(fixing.steps[0].summary, "Recherche testée");
  assert.deepEqual(fixing.steps[1].remarks, ["Corriger le tri."]); assert.equal(fixing.steps[1].accepted,false);
  const accepted = event(4, lead.name, "ACCEPTED", JSON.stringify({ summary:"Tri corrigé. Tests PostgreSQL et Playwright réussis.", remarks:[] }));
  const wrong = event(5, dev.name, "ACCEPTED", JSON.stringify({ summary:"Erreur", remarks:[] }));
  const old = event(6, lead.name, "ACCEPTED", "Autre mission", "other");
  p.forge.status([refusal, wrong, old]); assert.deepEqual(await read(), fixing);
  Object.assign(dev,{ task:null,session:"none" }); Object.assign(lead,{ task:null,session:"none" });
  p.forge.status([refusal,accepted]);
  const finished = await read();
  assert.deepEqual(finished.steps.map((s: any) => s.kind), ["build","review","fix","review"]);
  assert.equal(finished.steps.at(-1).accepted,true);
  assert.equal(finished.steps[2].summary, "Tri corrigé. Tests PostgreSQL et Playwright réussis.");
  assert.equal(finished.steps.at(-1).endedAt,accepted.time);
  assert.deepEqual(await read(),finished);
  assert.equal((await p.action("develop.start")).data.development.tickets.length,1);
  assert.ok(p.forge.calls().every(c => ["assign","status","question"].includes(c.op)));
  assert.equal(p.forge.calls().filter(c => c.op === "assign").length,1);
});

for (const outcome of ["delivered", "ack lost", "undelivered"]) test("a runtime question is answered once, " + outcome, async t => {
  const p = project(t);
  await p.action("develop.start");
  const { dev, event } = assigned(p);
  const q = event(21, dev.name, "QUESTION Quel tri ?", "Pour les résultats.");
  const other = event(22, dev.name, "QUESTION Autre projet ?", "Contexte", "elsewhere");
  p.forge.status([q,other]);
  const detail = (await p.action("missions.show")).data.development;
  assert.equal(detail.requests.length,1);
  const [request] = detail.requests;
  assert.deepEqual([request.from,request.ticketId,request.text,request.context], ["dev","1","Quel tri ?","Pour les résultats."]);
  if (outcome !== "delivered") writeFileSync(p.path(outcome === "ack lost" ? "lose-answer" : "dead-answer"), "");
  const text = "Par ordre alphabétique.\nAvec les accents et les apostrophes.";
  const answer = () => p.action("requests.answer",{ requestId:request.id, text });
  const results = await Promise.all([answer(),answer()]);
  if (outcome === "delivered") {
    for (const result of results) assert.equal(result.data?.development.requests[0].answer,text);
  } else {
    for (const result of results) assert.ok(result.error);
    const shown = (await p.action("missions.show")).data.development.requests;
    assert.equal(shown[0].answer,undefined);
    assert.match(shown[0].context,/vérifiez/i);
  }
  const sends = p.forge.calls().filter(c => c.op === "answer");
  assert.equal(sends.length,1); assert.equal(sends[0].target,"21");
  assert.equal(JSON.parse(sends[0].stdin).body,text);
});
