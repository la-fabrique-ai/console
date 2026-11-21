// On screen: pick an issue, validate the request, answer Pilot's questions, see the mission.
import assert from "node:assert/strict";
import { setup } from "../../engine/tests/pilot-project.ts";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
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
  screen.canned.clear();
  screen.sent.length = 0;
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
  const { shown, now, click, type, tick } = window();
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

  // The operator chose Questions on purpose, then goes to the request and back while the engine answers.
  click("step-0");
  await shown();
  click("step-1");
  await shown();
  let asked = () => {};
  screen.slow.set("spec.write", new Promise((resolve) => { asked = resolve; }));
  click("validate");
  now();
  click("step-0");
  now();
  click("step-1");
  asked();
  texts = await shown();
  assert.ok(texts.includes("La question a une réponse") && texts.includes("Pilot écrit la spec…") && !texts.includes("Spec écrite"),
    "the step the operator chose meanwhile stays on screen, and says the spec is being written");
  click("step-2");
  texts = await shown();
  assert.ok(texts.includes("Pilot écrit la spec"), "the spec has its step");
  assert.ok(!screen.clicks.has("validate"), "nothing to validate while Pilot writes");
  type("Autre chose à dire à Pilot ?", "Un brouillon");
  await shown();
  click("step-1");
  await shown();
  assert.equal(screen.fields.get("Autre chose à dire à Pilot ?")?.value() ?? "", "", "a draft does not follow to another step");
  click("step-2");
  await shown();

  await spec("Voici la spec, écrite d’après votre réponse.");
  tick();
  texts = await shown();
  assert.ok(texts.includes("LA SPEC, ÉCRITE PAR PILOT · VERSION 1") && texts.includes("Voici la spec, écrite d’après votre réponse."));
  assert.ok(texts.includes("LE PROBLÈME") && texts.includes("Les liens sont muets.") && texts.includes("votre demande"), "each passage shows with its source");
  assert.ok(texts.includes("à relire") && texts.includes("Version 1") && !texts.some((text) => text.startsWith("modifié")));

  type("Demandez un changement…", "Compter aussi les doublons");
  await shown();
  let recorded = () => {};
  screen.slow.set("spec.change", new Promise((resolve) => { recorded = resolve; }));
  click("validate");
  now();
  click("step-1");
  now();
  assert.ok(screen.texts.includes("Pilot prépare la prochaine version de la spec"), "the questions say so before the engine has recorded the change");
  click("step-2");
  recorded();
  texts = await shown();
  assert.ok(texts.includes("VOTRE DEMANDE DE CHANGEMENT") && texts.includes("Compter aussi les doublons") && texts.includes("Pilot met la spec à jour"));
  assert.ok(!screen.clicks.has("validate"), "a version being rewritten cannot be validated");
  click("step-1");
  assert.ok((await shown()).includes("Pilot prépare la prochaine version de la spec"), "meanwhile the questions say a version is on its way");
  click("step-2");
  await shown();

  await spec("J’ai ajouté les doublons.", true);
  tick();
  texts = await shown();
  assert.ok(texts.includes("LA SPEC, ÉCRITE PAR PILOT · VERSION 2") && texts.includes("J’ai ajouté les doublons."));
  assert.equal(texts[texts.indexOf("Voir le retrait d’un lien, doublons compris.") + 1], "modifié · v2", "the mark sits on the changed passage");
  assert.equal(texts.filter((text) => text === "modifié · v2").length, 1, "and on no other");
  assert.ok(texts.includes("Version 2 · à relire") && texts.indexOf("Version 2 · à relire") < texts.indexOf("Version 1"), "the version to read comes first");
  assert.ok(texts.includes("1 passage modifié à votre demande"));

  let validated = () => {};
  screen.slow.set("spec.validate", new Promise((resolve) => { validated = resolve; }));
  click("validate");
  now();
  click("step-1");
  now();
  assert.ok(screen.texts.includes("la spec est en cours de validation") && !screen.texts.includes("Pilot prépare la prochaine version de la spec"),
    "while the validation is on its way the questions do not announce another version");
  click("step-2");
  validated();
  texts = await shown();
  assert.ok(texts.includes("Spec validée") && texts.includes("validée · v2"));
  assert.ok(!screen.clicks.has("validate") && !screen.fields.has("Demandez un changement…"), "a validated spec takes no more change");
  assert.ok(git("show", "mission/DEMO-1:docs/missions/DEMO-1/spec.md").includes("Voir le retrait d’un lien, doublons compris."), "the validated version is in the project");
  assert.ok(git("show", "mission/DEMO-1:docs/missions/DEMO-1/answers.md").includes("Tous."), "with the operator's answers");
  const sent = calls().filter(([command]) => command === "send").map(([, , , message]) => JSON.parse(message).action);
  assert.deepEqual(sent, ["questions.validate", "spec.write", "spec.change", "spec.validate"], "Pilot received each gesture once, in order");

  click("step-1");
  texts = await shown();
  assert.ok(texts.includes("Spec écrite") && !screen.clicks.has("validate"), "the questions stay readable, the spec is not asked twice");
  click("question-q1");
  await shown();
  assert.ok(!screen.fields.has("Écrivez une autre réponse…") && !screen.clicks.has("validate"), "an answer the spec is written from no longer changes here");
  assert.ok(!screen.texts.includes("Écrivez une autre réponse…") && screen.texts.includes("la spec validée est écrite d’après vos réponses"), "and the page says why, with no invitation to write");
});

test("the operator sees the plan with one dev and with two, then launches it", async (t) => {
  const { cli, path } = project(t);
  const pilot = (action: string, payload: object) => cli(action, { issueKey: "DEMO-1", ...payload });
  const writes = () => (existsSync(path("linear-requests")) ? readFileSync(path("linear-requests"), "utf8").trim().split("\n") : [])
    .filter((line) => JSON.parse(line).query.startsWith("mutation")).length;
  const { shown, now, click, tick } = window();
  await shown();
  click("issue-DEMO-1");
  await shown();
  click("validate");
  await shown();
  await pilot("pilot.questions", { questions: [] });
  tick();
  await shown();
  click("validate");
  await shown();
  await pilot("pilot.spec", { note: "Voici la spec.", sections: [{ title: "Le problème", passages: [{ text: "Les liens sont muets.", source: "votre demande" }] }] });
  tick();
  await shown();
  click("validate");
  let texts = await shown();
  assert.ok(texts.includes("Pilot découpe la spec en tickets"), "validating the spec moves on to the split");

  await pilot("pilot.ticket", { ticket: { id: "1", title: "Afficher les ajouts", change: "Le fil montre un lien ajouté." } });
  tick();
  texts = await shown();
  assert.ok(texts.includes("Pilot découpe · 1 ticket trouvé") && texts.includes("Afficher les ajouts") && texts.includes("TICKET 2"), "the split grows on screen");

  const ticket = (id: string, title: string, minutes: number, after: string[], dev: number, step: number, sensitive = false) =>
    ({ id, title, change: `Change ${id}.`, how: `Comment ${id}.`, covers: [`Point ${id}`], after, minutes, sensitive, parallel: { dev, step } });
  // The slower dev is not the same at each step: 30 against 10, then 20 against 45.
  await pilot("pilot.plan", { tickets: [ticket("1", "Afficher les ajouts", 30, [], 1, 1), ticket("2", "Écrire le guide", 10, [], 2, 1),
    ticket("3", "Afficher les retraits", 20, ["1"], 1, 2, true), ticket("4", "Traduire le guide", 45, ["2"], 2, 2)],
    testMinutes: 10, validationMinutes: 5, advice: "Un second dev fait gagner trente minutes.", summary: "Le fil montre les liens." });
  tick();
  texts = await shown();
  assert.ok(texts.includes("Le plan est prêt : 4 tickets") && texts.includes("Approuver et lancer le dev"));
  assert.ok(texts.includes("Environ 2 h avec 1 dev, test et validation compris · 1 h 30 avec 2 devs en parallèle"), "each step lasts as long as its slower dev");
  assert.ok(texts.includes("Sensible") && texts.includes("après 1") && texts.includes("Un second dev fait gagner trente minutes."));

  click("ticket-3");
  texts = await shown();
  assert.ok(texts.includes("TICKET 3 SUR 4") && texts.includes("~20 min · sensible : relu deux fois") && texts.includes("Le ticket 1"), "a click on a ticket shows its detail");
  click("estimate");
  await shown();

  let chosen = () => {};
  screen.slow.set("plan.team", new Promise((resolve) => { chosen = resolve; }));
  click("add-dev");
  now();
  assert.ok(!screen.texts.includes("Création des tickets dans le tracker…"), "choosing the team never looks like a launch");
  assert.ok(screen.texts.includes("Approuver et lancer le dev") && !screen.clicks.has("launch"), "the launch waits for the team to be recorded: no click is lost");
  assert.ok(!screen.clicks.has("dev-1") && !screen.clicks.has("add-dev") && !screen.clicks.has("team-2"), "and so does any other choice of the team");
  chosen();
  texts = await shown();
  assert.ok(texts.includes("Approuver et lancer les devs") && texts.includes("ÉTAPE 2") && texts.includes("Dev 2") && texts.includes("≈ 1 h 30"), "two devs: one line each, by steps");
  assert.ok(texts.includes("Environ 1 h 30 avec 2 devs en parallèle, test et validation compris · 2 h avec 1 dev"));
  const tools = () => screen.texts.filter((text) => text === "Claude" || text === "Codex").slice(0, 2);
  assert.deepEqual(tools(), ["Claude", "Codex"]);
  let toggled = () => {};
  screen.slow.set("plan.team", new Promise((resolve) => { toggled = resolve; }));
  click("dev-2");
  now();
  assert.ok(!screen.clicks.has("team-1") && !screen.clicks.has("remove-dev"), "with two devs too, the team waits for the choice on its way");
  toggled();
  await shown();
  assert.deepEqual(tools(), ["Claude", "Claude"], "each dev's tool is the operator's choice");
  click("remove-dev");
  texts = await shown();
  assert.ok(texts.includes("Approuver et lancer le dev") && texts.includes("≈ 2 h"));
  click("team-2");
  await shown();
  assert.equal(writes(), 0, "looking at the plan and choosing the team writes nothing to the tracker");

  // A launch the engine refuses says why, and can be tried again.
  const settings = { teamKey: "DEMO", repository: path("repo") };
  writeFileSync(path("settings.json"), JSON.stringify({ ...settings, allowedIssueKeys: [] }));
  const until = async (ready: () => boolean) => {
    for (let wait = 0; wait < 100 && !ready(); wait++) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      tick();
      now();
    }
    assert.ok(ready(), "the screen never got there");
  };
  // The operator opens the mission again before the refusal arrives: it still reaches the page.
  let refused = () => {};
  screen.slow.set("plan.launch", new Promise((resolve) => { refused = resolve; }));
  click("launch");
  now();
  click("nav-development");
  now();
  click("mission-DEMO-1");
  refused();
  texts = await shown();
  assert.ok(texts.includes("Ce ticket ne figure pas dans la liste autorisée.") && screen.clicks.has("launch"), "the refusal shows in the banner, the launch stays possible");
  assert.equal(writes(), 0);
  writeFileSync(path("settings.json"), JSON.stringify({ ...settings, allowedIssueKeys: ["DEMO-1"] }));

  // A reading of the list made before the launch is answered after it: the stage does not go back.
  let late = () => {};
  screen.slow.set("missions.list", new Promise((resolve) => { late = resolve; }));
  click("nav-development");
  now();
  click("mission-DEMO-1");
  await until(() => screen.clicks.has("launch"));
  click("launch");
  await until(() => screen.texts.includes("Développement"));
  assert.ok(screen.clicks.has("develop-now"), "the launch opens the development: the operator sees the page move on");
  // The operator goes back to the list: the old reading is answered there, and changes nothing.
  click("nav-development");
  late();
  texts = await shown();
  assert.ok(texts.includes("Développer") && !texts.includes("Préparer"), "in the list too the mission keeps the stage of its launch");
  click("mission-DEMO-1");
  texts = await shown();
  assert.ok(texts.includes("Développement") && !texts.includes("C’est parti : 4 tickets créés dans le tracker"), "a launched mission opens on its development");
  click("step-3");
  now();
  texts = screen.texts;
  assert.ok(texts.includes("C’est parti : 4 tickets créés dans le tracker") && texts.some((text) => text.endsWith("rattachés à DEMO-1")));
  assert.equal(writes(), 5, "the launch creates the four sub-tickets and one comment");
  assert.equal(texts[texts.indexOf("DEMO-1") + 1], "Développer", "the menu shows the new stage without leaving the page");
  for (const id of ["launch", "add-dev", "remove-dev", "dev-1", "team-1", "ticket-1", "estimate"]) assert.ok(!screen.clicks.has(id), `nothing changes after the launch: ${id}`);
});

test("back in the list while a gesture is answered, the stage shown is the latest one", async (t) => {
  const { cli } = project(t);
  const { shown, now, click, tick } = window();
  await shown();
  click("issue-DEMO-1");
  await shown();
  click("validate");
  await shown();
  await cli("pilot.questions", { issueKey: "DEMO-1", questions: [] });
  tick();
  await shown();
  // Elsewhere the mission has reached the test stage; the answer to this gesture, asked before, still says "prepare".
  const tested = JSON.stringify({ data: [{ issueKey: "DEMO-1", title: "First issue", stage: "test" }] });
  let answered = () => {};
  screen.slow.set("spec.write", new Promise((resolve) => { answered = resolve; }));
  click("validate");
  now();
  screen.canned.set("missions.list", [tested, tested]);
  click("nav-development");
  await new Promise((resolve) => setImmediate(resolve));
  now();
  assert.ok(screen.texts.includes("Tester"), "the list shows what it just read");
  answered();
  const texts = await shown();
  assert.ok(texts.includes("Tester") && !texts.includes("Préparer"), "the older answer of the gesture does not stay on screen: the list is read once more");
});

test("when the reading after a gesture fails, the clock corrects the stage", async (t) => {
  const { cli } = project(t);
  const { shown, now, click, tick } = window();
  await shown();
  click("issue-DEMO-1");
  await shown();
  click("validate");
  await shown();
  await cli("pilot.questions", { issueKey: "DEMO-1", questions: [] });
  tick();
  await shown();
  const tested = JSON.stringify({ data: [{ issueKey: "DEMO-1", title: "First issue", stage: "test" }] });
  const failed = JSON.stringify({ error: { code: "failed", message: "Impossible de lire les missions enregistrées." } });
  let answered = () => {};
  screen.slow.set("spec.write", new Promise((resolve) => { answered = resolve; }));
  click("validate");
  now();
  screen.canned.set("missions.list", [tested, failed, tested]);
  click("nav-development");
  await new Promise((resolve) => setImmediate(resolve));
  answered();
  let texts = await shown();
  assert.ok(texts.includes("Préparer"), "the gesture's older answer shows while the reading that should correct it has failed");
  tick();
  texts = await shown();
  assert.ok(texts.includes("Tester") && !texts.includes("Préparer"), "the next tick reads the list again and corrects the stage");
});

test("a refused correction never lands on another question", async (t) => {
  const { cli, path } = project(t);
  const { shown, now, click, type, tick } = window();
  await shown();
  click("issue-DEMO-1");
  await shown();
  click("validate");
  await shown();
  await cli("pilot.questions", { issueKey: "DEMO-1", questions: [
    { id: "q1", text: "Première ?", context: "Contexte.", proposal: "Oui." }, { id: "q2", text: "Seconde ?", context: "Contexte.", proposal: "Non." }] });
  tick();
  await shown();
  click("question-q2");
  await shown();
  type("Écrivez une autre réponse…", "Pour la seconde seulement");
  await shown();
  writeFileSync(path("offline"), ""); // Pilot's terminal cannot be reached: the engine will refuse
  let refused = () => {};
  screen.slow.set("questions.reply", new Promise((resolve) => { refused = resolve; }));
  click("validate");
  now();
  click("nav-development");
  now();
  click("mission-DEMO-1"); // opened again: the page is back on the first open question
  refused();
  await shown();
  tick();
  const texts = await shown();
  assert.ok(texts.includes("QUESTION 1 SUR 2"));
  assert.equal(screen.fields.get("Écrivez une autre réponse…")?.value(), "", "what was written for the second question is not offered for the first");
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
  click("validate");
  for (let wait = 0; wait < 100 && !screen.texts.includes("La question a une réponse"); wait++) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    now();
  }
  assert.ok(screen.texts.includes("La question a une réponse"), "and its answer goes through while the first one still waits");
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
  click("step-0");
  await shown();
  click("step-1");
  await shown();
  click("validate");
  assert.ok((await shown()).includes("LA SPEC"), "asking for the spec moves on to its step, also from a step chosen by hand");
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

test("the operator follows a ticket from the Lead's start to accepted, and answers a dev's request in place", async (t) => {
  project(t);
  const ticket = { id: "1", key: "DEMO-2", title: "Links in the feed", change: "Added links show in the feed.", how: "A new entry type.", covers: ["A link shows when added"],
    after: [], minutes: 45, sensitive: false, parallel: { dev: 1, step: 1 } };
  const mission = { issueKey: "DEMO-1", title: "First issue", stage: "develop" };
  const said = (development?: object) => JSON.stringify({ data: { ...mission, details: [], questions: [],
    plan: { found: [], tickets: [ticket], testMinutes: 20, validationMinutes: 15, advice: "", team: ["codex"], launched: true }, ...(development ? { development } : {}) } });
  const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
  const sentOf = (action: string) => screen.sent.filter(([name]) => name === action).map(([, payload]) => JSON.parse(payload!));
  screen.canned.set("missions.list", Array(40).fill(JSON.stringify({ data: [mission] })));
  screen.canned.set("missions.show", [said()]);
  const { shown, now, click, type, tick } = window();
  await shown();
  click("nav-development");
  await shown();
  click("mission-DEMO-1");
  let texts = await shown();
  assert.ok(texts.includes("Le développement n’a pas démarré") && texts.includes("Développement"), "a mission launched before opens on its development, not started yet");

  screen.canned.set("develop.start", [said({ tickets: [], requests: [] })]);
  click("start-develop");
  texts = await shown();
  assert.deepEqual(sentOf("develop.start"), [{ issueKey: "DEMO-1" }]);
  assert.ok(texts.includes("Le Lead prend la mission") && !screen.clicks.has("start-develop"), "once the Lead is started the button is gone");

  screen.canned.set("missions.show", [said({ tickets: [], requests: [{ id: "r0", from: "lead", ticketId: "1", text: "Par où commencer ?", context: "c", choices: [] }] })]);
  tick();
  texts = await shown();
  assert.ok(texts.includes("Vous attend") && !texts.includes("DEMO-2 vous attend"), "a ticket the Lead asks about before its start waits for the operator, and no dev holds it yet");
  // The Lead that asked may have lost its terminal: it can be started again, and what is being written stays.
  const waiting = said({ tickets: [], requests: [{ id: "r0", from: "lead", ticketId: "1", text: "Par où commencer ?", context: "c", choices: [] }] });
  type("Répondez autrement…", "Par le fil");
  screen.canned.set("develop.start", [waiting]);
  screen.canned.set("missions.show", [waiting]);
  click("restart-lead");
  texts = await shown();
  assert.ok(texts.includes("Par le fil") && sentOf("develop.start").length === 2, "starting the Lead again sends no answer and keeps the draft");
  const build = { kind: "build", tool: "codex", startedAt: ago(12) };
  const run = (steps: object[], more = {}) => ({ id: "1", branch: "ticket/DEMO-2", steps, ...more });
  screen.canned.set("missions.show", Array(2).fill(said({ tickets: [run([build])], requests: [] })));
  tick();
  texts = await shown();
  assert.ok(texts.includes("En cours : DEMO-2 en construction") && texts.includes("Codex construit") && texts.includes("12 min"), "the dev's work shows by itself, with the time it has taken");
  const later = Date.now() + 2 * 60_000;
  t.mock.method(Date, "now", () => later);
  tick();
  now(); // before any reading is answered: the clock alone redraws
  texts = screen.texts;
  assert.ok(texts.includes("14 min") && !screen.texts.includes("12 min"), "the time spent goes on while the engine has nothing new to say");
  t.mock.restoreAll();
  await shown();

  const request = { id: "r1", from: "dev", ticketId: "1", text: "Faut-il aussi les liens retirés ?", context: "La spec ne le dit pas.", choices: ["Oui, les deux", "Non, seulement les ajouts"] };
  const asked = said({ tickets: [run([build])], requests: [request] });
  screen.canned.set("missions.show", [asked]);
  tick();
  texts = await shown();
  assert.ok(texts.includes("À vous : une demande du dev sur DEMO-2") && texts.includes("Vous attend") && texts.includes(request.text) && texts.includes("Recommandé"),
    "a request takes the banner and the right column, its ticket waits for the operator");
  click("ticket-1");
  now();
  assert.ok(screen.texts.includes("DÉROULÉ") && !screen.clicks.has("choice-0"), "the operator can still look at a ticket");
  click("see-request");
  now();
  assert.ok(screen.clicks.has("choice-0"), "the banner brings the request back");

  // What is written answers the request on screen: when another one takes its place, the draft does not follow.
  type("Répondez autrement…", "Oui pour les deux");
  now();
  screen.canned.set("requests.answer", [JSON.stringify({ error: { code: "failed", message: "Réponse refusée." } })]);
  screen.canned.set("missions.show", [asked]);
  click("send-reply");
  texts = await shown();
  assert.ok(texts.includes("Réponse refusée.") && texts.includes("Oui pour les deux"));
  const other = { ...request, id: "r2", text: "Et les liens en double ?" };
  const later3 = { ...request, id: "r3" };
  screen.canned.set("missions.show", [said({ tickets: [run([build])], requests: [{ ...request, answer: "Oui, les deux" }, other] })]);
  tick();
  texts = await shown();
  assert.ok(texts.includes(other.text) && !texts.includes("Oui pour les deux") && !texts.includes("Réponse refusée.") && !screen.clicks.has("send-reply"),
    "a draft never lands on another request, nor does the refusal of its answer");
  screen.canned.set("requests.answer", [said({ tickets: [run([build])], requests: [{ ...request, answer: "Oui, les deux" }, { ...other, answer: "Oui, les deux" }, later3] })]);
  assert.ok(screen.clicks.has("restart-lead"), "a Lead that asked and lost its terminal can still be started again");
  click("choice-0");
  texts = await shown();
  assert.deepEqual(sentOf("requests.answer"), [{ issueKey: "DEMO-1", requestId: "r1", text: "Oui pour les deux" }, { issueKey: "DEMO-1", requestId: "r2", text: "Oui, les deux" }],
    "a proposed answer is sent once, for the request on screen");
  screen.sent.length = 0;

  // A refused answer comes back to its field; the answer then reaches the engine once.
  const refusal = JSON.stringify({ error: { code: "failed", message: "L’envoi au dev n’est pas confirmé." } });
  screen.canned.set("requests.answer", [refusal, said({ tickets: [run([build])], requests: [{ ...later3, answer: "Seulement les ajouts pour l’instant" }] })]);
  const again = said({ tickets: [run([build])], requests: [later3] });
  screen.canned.set("missions.show", [again, again]);
  type("Répondez autrement…", "Seulement les ajouts pour l’instant");
  now();
  click("send-reply");
  now();
  assert.ok(!screen.clicks.has("choice-0") && !screen.clicks.has("send-reply"), "one answer at a time: nothing else can be sent while it is on its way");
  texts = await shown();
  assert.ok(texts.includes("L’envoi au dev n’est pas confirmé.") && texts.includes("Seulement les ajouts pour l’instant"), "the refusal shows and the text is back in its field");
  click("send-reply");
  texts = await shown();
  const answer = { issueKey: "DEMO-1", requestId: "r3", text: "Seulement les ajouts pour l’instant" };
  assert.deepEqual(sentOf("requests.answer"), [answer, answer], "one call for the refused answer, one for the second try");
  assert.ok(texts.includes("VOS RÉPONSES") && texts.includes("En cours : DEMO-2 en construction") && !screen.clicks.has("send-reply"), "once answered, the request leaves the banner and the work goes on");

  const built = { ...build, endedAt: ago(8), summary: "Feed entry for added links", commit: "abcdef1234" };
  const refused = { kind: "review", tool: "claude", startedAt: ago(8), endedAt: ago(5), accepted: false, remarks: ["Le retrait d’un lien n’est pas testé"] };
  screen.canned.set("missions.show", [said({ tickets: [run([built, refused, { kind: "fix", tool: "codex", startedAt: ago(5) }], { pr: { number: 7, url: "u" } })], requests: [] })]);
  tick();
  texts = await shown();
  assert.ok(texts.includes("En cours : DEMO-2 en correction") && texts.includes("Relecture · corrections demandées") && texts.includes("Codex corrige · tour 1"), "fixes asked by the reviewer show as a round");
  click("ticket-1");
  now();
  assert.ok(screen.texts.includes("– Le retrait d’un lien n’est pas testé") && screen.texts.some((text) => text.includes("commit abcdef1")), "the ticket's panel gives the reviewer's remarks and the commit reviewed");
  click("ticket-1");
  now();
  // The window cannot know the Lead's terminal is gone: the operator can always start it again.
  screen.canned.set("develop.start", [said({ tickets: [run([built, refused, { kind: "fix", tool: "codex", startedAt: ago(5) }])], requests: [] })]);
  click("restart-lead");
  await shown();
  assert.deepEqual(sentOf("develop.start"), [{ issueKey: "DEMO-1" }], "starting the Lead again is one call");

  const accepted = [built, refused, { kind: "fix", tool: "codex", startedAt: ago(5), endedAt: ago(3), commit: "bcdef12345" },
    { kind: "review", tool: "claude", startedAt: ago(3), endedAt: ago(1), accepted: true, remarks: [] }];
  screen.canned.set("missions.show", [said({ tickets: [run(accepted, { pr: { number: 7, url: "u" } })], requests: [], pr: { number: 6, url: "u" } })]);
  tick();
  texts = await shown();
  assert.ok(texts.includes("Le ticket est accepté") && texts.includes("DEMO-2 accepté et fusionné") && texts.some((text) => text.startsWith("PR #6 vers main")),
    "an accepted ticket is merged into the mission branch; the mission's PR stays the operator's");
  // A question of the Lead still open once every ticket is accepted: its terminal can still be started again to receive the answer.
  screen.canned.set("missions.show", [said({ tickets: [run(accepted, { pr: { number: 7, url: "u" } })], requests: [{ id: "r9", from: "lead", text: "Et ensuite ?", context: "c", choices: [] }] })]);
  tick();
  await shown();
  assert.ok(screen.clicks.has("restart-lead"));
});
