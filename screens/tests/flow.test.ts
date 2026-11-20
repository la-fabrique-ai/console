// Slice 1 on screen: pick an issue, ask for its development, see the mission.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { draw, screen } from "./herdr-stub.ts";

const stub = new URL("./herdr-stub.ts", import.meta.url).href;
registerHooks({
  resolve: (specifier, context, next) =>
    ["gpui-kit", "gpui-base", "herdr"].includes(specifier) ? { url: stub, shortCircuit: true } : next(specifier, context),
});
const { default: MissionControl } = await import(new URL("../mission-control/main.ts", import.meta.url).href);

function project(t: TestContext) {
  screen.home = mkdtempSync(join(tmpdir(), "mission-control-screen-"));
  screen.failure = "";
  screen.slow.clear();
  t.after(() => rmSync(screen.home, { recursive: true, force: true }));
  writeFileSync(join(screen.home, "settings.json"), JSON.stringify({ teamKey: "DEMO", allowedIssueKeys: ["DEMO-1"] }));
}

/** Opens the window on the current project. */
function window() {

  const pending: unknown[] = [];
  const cx = { notify() {}, spawn(body: (cx: unknown) => unknown) { pending.push(body(cx)); } };
  const view = new MissionControl();
  view.init(undefined, cx);
  return {
    /** What the operator sees once every engine reply has arrived. */
    async shown() {
      while (pending.length) await pending.shift();
      draw(view.render());
      return screen.texts;
    },
    /** What the operator sees right now, replies still on their way. */
    now() {
      draw(view.render());
    },
    click(id: string) {
      const handler = screen.clicks.get(id);
      assert.ok(handler, `not on screen: ${id}`);
      handler({}, cx);
    },
  };
}

test("an issue becomes a mission that shows in the Development list", async (t) => {
  project(t);
  const { shown, click } = window();
  assert.ok((await shown()).includes("First issue"));

  click("issue-DEMO-1");
  let texts = await shown();
  assert.ok(texts.includes("**Texte original**"), "the request page shows the issue as written");
  assert.ok(texts.includes("✓  Valider la demande"));

  click("validate");
  texts = await shown();
  assert.ok(texts.includes("Mission créée"));
  assert.ok(!screen.clicks.has("validate"), "a created mission cannot be created again");

  click("nav-development");
  texts = await shown();
  assert.ok(texts.includes("First issue") && texts.includes("Préparer"), "the mission is listed with its stage");
  click("mission-DEMO-1");
  assert.ok((await shown()).includes("Mission créée"), "the mission opens on its page");
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
  assert.ok(texts.includes("First issue") && texts.includes("Préparer"), "the page keeps the title and the stage");
  assert.ok(texts.includes("Impossible de joindre Linear."));
});
