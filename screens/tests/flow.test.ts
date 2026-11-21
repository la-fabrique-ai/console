// On screen: pick an issue, validate the request, answer Pilot's questions, see the mission.
import assert from "node:assert/strict";
import { setup } from "../../engine/tests/pilot-project.ts";
import { writeFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { test, type TestContext } from "node:test";
import { draw, screen } from "./herdr-stub.ts";

const stub = new URL("./herdr-stub.ts", import.meta.url).href;
registerHooks({
  resolve: (specifier, context, next) =>
    ["gpui-kit", "gpui-base", "herdr"].includes(specifier) ? { url: stub, shortCircuit: true } : next(specifier, context),
});
const { default: MissionControl } = await import(new URL("../mission-control/main.ts", import.meta.url).href);

const STAGES = ["Préparer", "Développer", "Tester", "Valider"];

function project(t: TestContext) {
  const project = setup(t);
  screen.env = project.env;
  screen.cliArgs = project.cliArgs;
  screen.failure = "";
  screen.slow.clear();
  return project;
}

/** Opens the window on the current project. */
function window() {

  const pending: unknown[] = [];
  let stale = true; // Herdr draws once at start, then only when the window asks for it
  const timers: ((cx: unknown) => void)[] = [];
  const cx = {
    notify() { stale = true; },
    spawn(body: (cx: unknown) => unknown) { pending.push(body(cx)); },
    timer: { every(_ms: number, body: (cx: unknown) => void) { timers.push(body); } },
  };
  const view = new MissionControl();
  view.init(undefined, cx);
  /** What the operator sees right now, replies still on their way. */
  const now = () => {
    if (stale) draw(view.render());
    stale = false;
  };
  now();
  return {
    now,
    /** What the operator sees once every engine reply has arrived. */
    async shown() {
      while (pending.length) await pending.shift();
      now();
      return screen.texts;
    },
    click(id: string) {
      const handler = screen.clicks.get(id);
      assert.ok(handler, `not on screen: ${id}`);
      handler({}, cx);
    },
    /** Writes in a field that is on screen. */
    type(placeholder: string, text: string) {
      const field = screen.fields.get(placeholder);
      assert.ok(field, `no such field on screen: ${placeholder}`);
      field.type(text, cx);
    },
    /** Time passes: the window asks the engine again. */
    tick() {
      timers.forEach((timer) => timer(cx));
    },
  };
}

test("a validated request becomes a mission, and the operator answers Pilot's questions", async (t) => {
  const { cli, calls } = project(t);
  const pilot = (action: string, payload: object) => cli(action, { issueKey: "DEMO-1", ...payload });
  const { shown, now, click, type, tick } = window();
  assert.ok((await shown()).includes("First issue"));

  click("issue-DEMO-1");
  let texts = await shown();
  assert.ok(texts.includes("**Texte original**"), "the request page shows the issue as written");
  type("Ajoutez une précision…", "Pour les joueurs seulement");
  assert.ok((await shown()).includes("Envoyer à Pilot  ↑"), "a written field turns the button into a send");
  click("validate");
  texts = await shown();
  assert.ok(texts.includes("Pour les joueurs seulement") && texts.includes("✓  Valider la demande"), "the detail joins the request, still to validate");

  let created = () => {};
  screen.slow.set("missions.create", new Promise((resolve) => { created = resolve; }));
  click("validate");
  now();
  assert.ok(!screen.fields.has("Ajoutez une précision…"), "no detail can be written once the request is on its way");
  // Another issue opened meanwhile keeps its own field.
  click("nav-issues");
  now();
  click("issue-DEMO-2");
  for (let wait = 0; wait < 100 && !screen.fields.has("Ajoutez une précision…"); wait++) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    now();
  }
  assert.ok(screen.fields.has("Ajoutez une précision…"), "the wait of one request does not freeze another page");
  click("nav-issues");
  now();
  click("issue-DEMO-1");
  now();
  created();
  texts = await shown();
  assert.ok(texts.includes("Pilot prépare ses questions"), "Pilot starts by itself");
  assert.ok(!screen.clicks.has("validate"), "nothing to validate while Pilot reads");

  await pilot("pilot.questions", { questions: [
    { id: "q1", text: "Qui reçoit les messages ?", context: "Deux publics possibles.", proposal: "Tous les joueurs." },
    { id: "q2", text: "Dans quelle langue ?", context: "Le projet en a deux.", proposal: "En français." },
  ] });
  tick();
  texts = await shown();
  assert.ok(texts.includes("QUESTION 1 SUR 2") && texts.includes("Tous les joueurs."), "the first question shows with Pilot's proposal");
  assert.ok(texts.includes("ou validez la réponse de Pilot · question 2 ensuite"));

  // Q1 stays open while Q2 is corrected, validated, then corrected again.
  const sent = () => calls().filter(([command]) => command === "send").map(([, , , message]) => message);
  click("question-q2");
  await shown();
  type("Écrivez une autre réponse…", "En anglais");
  await shown();
  click("validate");
  texts = await shown();
  assert.ok(texts.includes("QUESTION 2 SUR 2") && texts.includes("En anglais") && texts.includes("Pilot met sa réponse à jour"), "the page stays on the corrected question");
  assert.ok(!screen.clicks.has("validate"), "nothing to validate until Pilot proposes again");

  await pilot("pilot.propose", { questionId: "q2", proposal: "En anglais seulement." });
  tick();
  texts = await shown();
  assert.ok(texts.includes("PILOT · SUGGESTION MISE À JOUR") && texts.includes("En anglais seulement."));
  click("validate");
  texts = await shown();
  assert.ok(texts.includes("QUESTION 1 SUR 2"), "validating shows the question still open");
  assert.ok(texts.includes("ou validez la réponse de Pilot · c’était la dernière question"));

  click("question-q2");
  texts = await shown();
  assert.ok(texts.includes("VOTRE RÉPONSE · VALIDÉE, APRÈS VOTRE CORRECTION"), "a click on a question reopens it");
  type("Écrivez une autre réponse…", "En français aussi");
  await shown();
  let confirm = () => {};
  screen.slow.set("questions.reply", new Promise((resolve) => { confirm = resolve; }));
  click("validate");
  now();
  // While the engine has not confirmed, the page stays put and nothing can be written.
  click("question-q1");
  now();
  assert.ok(screen.texts.includes("QUESTION 2 SUR 2"), "the list does not leave a question whose correction is on its way");
  assert.ok(!screen.fields.has("Écrivez une autre réponse…"), "and there is no field to write in meanwhile");
  confirm();
  texts = await shown();
  assert.ok(texts.includes("QUESTION 2 SUR 2") && texts.includes("En français aussi"), "a second correction stays on its question, with another one open");
  click("question-q1");
  texts = await shown();
  assert.ok(texts.includes("QUESTION 1 SUR 2"));
  assert.equal(screen.fields.get("Écrivez une autre réponse…")?.value(), "", "nothing written for one question follows to another");
  click("validate");
  await shown();
  assert.deepEqual(sent().map((message) => /q\d/.exec(message)?.[0]), ["q2", "q2", "q2", "q1"], "each gesture reached Pilot once, about its own question");
  assert.ok(sent()[2].includes("En français aussi"));

  await pilot("pilot.propose", { questionId: "q2", proposal: "En français et en anglais." });
  tick();
  await shown();
  click("validate");
  texts = await shown();
  assert.ok(texts.includes("Les 2 questions ont une réponse") && texts.includes("✎") && texts.includes("Tous les joueurs."), "the recap marks the corrected answer");
  click("question-q1");
  await shown();
  click("validate");
  assert.ok((await shown()).includes("Les 2 questions ont une réponse"), "keeping an answer returns to the recap");

  click("step-0");
  texts = await shown();
  assert.ok(texts.includes("Demande validée") && texts.includes("Pour les joueurs seulement"), "the request stays readable, with its detail");

  click("nav-development");
  texts = await shown();
  assert.ok(texts.includes("First issue") && texts.includes("Préparer"), "the mission is listed with its stage");
  click("mission-DEMO-1");
  assert.ok((await shown()).includes("Les 2 questions ont une réponse"), "the mission opens where the preparation stands");
});

test("the operator reads Pilot's spec, asks for a change and validates it", async (t) => {
  const { cli, calls, git } = project(t);
  const pilot = (action: string, payload: object) => cli(action, { issueKey: "DEMO-1", ...payload });
  const spec = (note: string, changed?: boolean) => pilot("pilot.spec", { note, sections: [
    { title: "Le problème", passages: [{ text: "Les liens sont muets.", source: "votre demande" }] },
    { title: "Ce que l’utilisateur pourra faire", passages: [
      { text: "Voir l’ajout d’un lien.", source: "réponse 1" },
      { text: changed ? "Voir le retrait d’un lien, doublons compris." : "Voir le retrait d’un lien.", source: "proposé par Pilot", ...(changed ? { changed } : {}) },
    ] },
  ] });
  const { shown, click, type, tick } = window();
  await shown();
  click("issue-DEMO-1");
  await shown();
  click("validate");
  await shown();
  await pilot("pilot.questions", { questions: [{ id: "q1", text: "Quels liens ?", context: "Il y en a plusieurs sortes.", proposal: "Tous." }] });
  tick();
  await shown();
  click("validate");
  let texts = await shown();
  assert.ok(texts.includes("Pilot vérifie s’il lui reste une question") && !screen.clicks.has("validate"), "the spec waits for Pilot's last word on the questions");
  await pilot("pilot.questions", { questions: [] });
  tick();
  texts = await shown();
  assert.ok(texts.includes("La question a une réponse") && texts.includes("✓  Écrire la spec"));
  assert.ok(texts.some((text) => text.startsWith("J’ai votre réponse.")), "Pilot offers the spec under the recap");

  click("validate");
  texts = await shown();
  assert.ok(texts.includes("Pilot écrit la spec"), "asking for the spec moves on to its step");
  assert.ok(!screen.clicks.has("validate"), "nothing to validate while Pilot writes");

  await spec("Voici la spec, écrite d’après votre réponse.");
  tick();
  texts = await shown();
  assert.ok(texts.includes("LA SPEC, ÉCRITE PAR PILOT · VERSION 1") && texts.includes("Voici la spec, écrite d’après votre réponse."));
  assert.ok(texts.includes("LE PROBLÈME") && texts.includes("Les liens sont muets.") && texts.includes("votre demande"), "each passage shows with its source");
  assert.ok(texts.includes("à relire") && texts.includes("Version 1") && !texts.some((text) => text.startsWith("modifié")));

  type("Demandez un changement…", "Compter aussi les doublons");
  await shown();
  click("validate");
  texts = await shown();
  assert.ok(texts.includes("VOTRE DEMANDE DE CHANGEMENT") && texts.includes("Compter aussi les doublons") && texts.includes("Pilot met la spec à jour"));
  assert.ok(!screen.clicks.has("validate"), "a version being rewritten cannot be validated");

  await spec("J’ai ajouté les doublons.", true);
  tick();
  texts = await shown();
  assert.ok(texts.includes("LA SPEC, ÉCRITE PAR PILOT · VERSION 2") && texts.includes("J’ai ajouté les doublons."));
  assert.ok(texts.includes("modifié · v2") && texts.includes("Version 2 · à relire") && texts.includes("1 passage modifié à votre demande"));

  click("validate");
  texts = await shown();
  assert.ok(texts.includes("Spec validée") && texts.includes("validée · v2"));
  assert.ok(!screen.clicks.has("validate") && !screen.fields.has("Demandez un changement…"), "a validated spec takes no more change");
  assert.ok(git("show", "mission/DEMO-1:docs/missions/DEMO-1/spec.md").includes("Voir le retrait d’un lien, doublons compris."), "the validated version is in the project");
  const sent = calls().filter(([command]) => command === "send").map(([, , , message]) => message);
  assert.deepEqual(sent.slice(-3).map((message) => JSON.parse(message).action), ["spec.write", "spec.change", "spec.validate"], "Pilot received each gesture once");

  click("step-1");
  assert.ok((await shown()).includes("Spec écrite"), "the questions stay readable, the spec is not asked twice");
});

test("a gesture on its way for one mission leaves another mission free", async (t) => {
  const { cli, path } = project(t);
  writeFileSync(path("settings.json"), JSON.stringify({ teamKey: "DEMO", allowedIssueKeys: ["DEMO-1", "DEMO-2"], repository: path("repo") }));
  const { shown, now, click, tick } = window();
  await shown();
  for (const key of ["DEMO-1", "DEMO-2"]) {
    click(`issue-${key}`);
    await shown();
    click("validate");
    await shown();
    await cli("pilot.questions", { issueKey: key, questions: [{ id: "q1", text: `Question de ${key}`, context: "Contexte.", proposal: "Oui." }] });
    click("nav-issues");
    await shown();
  }
  click("nav-development");
  await shown();
  click("mission-DEMO-1");
  await shown();
  let confirm = () => {};
  screen.slow.set("questions.validate", new Promise((resolve) => { confirm = resolve; }));
  click("validate");
  now();
  click("nav-development");
  now();
  click("mission-DEMO-2");
  for (let wait = 0; wait < 100 && !screen.texts.includes("Question de DEMO-2"); wait++) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    tick();
    now();
  }
  assert.ok(screen.texts.includes("Question de DEMO-2") && screen.clicks.has("validate") && screen.fields.has("Écrivez une autre réponse…"),
    "the other mission can be read and answered meanwhile");
  confirm();
  await shown();
});

test("a request that needs no question says so instead of waiting", async (t) => {
  const { cli } = project(t);
  const { shown, click, tick } = window();
  await shown();
  click("issue-DEMO-1");
  await shown();
  click("validate");
  assert.ok((await shown()).includes("Pilot prépare ses questions"));
  await cli("pilot.questions", { issueKey: "DEMO-1", questions: [] });
  tick();
  assert.ok((await shown()).includes("Pilot n’a pas de question"));
});

test("a reading slower than the clock still reaches the screen", async (t) => {
  const { cli } = project(t);
  const { shown, now, click, tick } = window();
  await shown();
  click("issue-DEMO-1");
  await shown();
  click("validate");
  await shown();
  await cli("pilot.questions", { issueKey: "DEMO-1", questions: [{ id: "q1", text: "Qui ?", context: "Deux publics.", proposal: "Tous." }] });

  let release = () => {};
  screen.slow.set("missions.show", new Promise((resolve) => { release = resolve; }));
  tick();
  screen.slow.set("missions.show", new Promise(() => {})); // a second reading would never answer
  tick();
  release();
  await new Promise((resolve) => setImmediate(resolve));
  now();
  assert.ok(screen.texts.includes("QUESTION 1 SUR 1"), "the clock did not discard the reading on its way");
});

test("a ticket outside the operator's list is refused on its request page", async (t) => {
  project(t);
  const { shown, click } = window();
  await shown();
  click("issue-DEMO-2");
  await shown();
  click("validate");
  const texts = await shown();
  assert.ok(texts.includes("Ce ticket ne figure pas dans la liste autorisée."));
  assert.ok(texts.includes("✓  Valider la demande"));
});

test("a slow reply for one issue never replaces the issue opened after it", async (t) => {
  project(t);
  const { shown, now, click } = window();
  await shown();
  let release = () => {};
  screen.slow.set("issues.show", new Promise((resolve) => { release = resolve; }));
  click("issue-DEMO-1");
  now();
  click("nav-issues");
  now();
  click("issue-DEMO-2");
  release();
  const texts = await shown();
  assert.ok(texts.includes("DEMO-2 · LA DEMANDE"));
  assert.ok(!texts.includes("DEMO-1 · LA DEMANDE"));
});

test("a mission is listed and opens on its page while Linear does not answer", async (t) => {
  project(t);
  const first = window();
  await first.shown();
  first.click("issue-DEMO-1");
  await first.shown();
  first.click("validate");
  await first.shown();

  // A window opened later knows nothing yet; Linear keeps it waiting, then fails.
  const answered = () => new Promise((resolve) => setImmediate(resolve));
  const releases: (() => void)[] = [];
  const keepWaiting = () => screen.slow.set("issues.list", new Promise((resolve) => { releases.push(resolve); }));
  screen.failure = "network";
  keepWaiting();
  const { shown, now, click } = window();
  await answered();
  now();
  assert.ok(screen.texts.includes("Chargement…"), "the issues are still loading");
  assert.ok(screen.texts.includes("DEMO-1"), "the mission is already in the menu");

  keepWaiting();
  click("nav-development");
  await answered();
  now();
  assert.ok(screen.texts.includes("First issue"), "the missions are listed before Linear answers");
  click("mission-DEMO-1");
  releases.forEach((release) => release());
  const texts = await shown();
  assert.ok(texts.includes("First issue"), "the page header carries the mission's title");
  const header = texts.slice(texts.indexOf("Jiroo · DEMO-1") + 1).filter((text) => text !== "›");
  assert.deepEqual(header.slice(0, 4), STAGES, "and its line of stages");
  assert.ok(texts.includes("Pilot prépare ses questions"), "the questions never wait for Linear");
  click("step-0");
  assert.ok((await shown()).includes("Impossible de joindre Linear."), "the request says why the issue cannot be read");
});
