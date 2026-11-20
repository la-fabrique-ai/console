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

function window(t: TestContext) {
  screen.home = mkdtempSync(join(tmpdir(), "mission-control-screen-"));
  t.after(() => rmSync(screen.home, { recursive: true, force: true }));
  writeFileSync(join(screen.home, "settings.json"), JSON.stringify({ teamKey: "DEMO", allowedIssueKeys: ["DEMO-1"] }));

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
    click(id: string) {
      const handler = screen.clicks.get(id);
      assert.ok(handler, `not on screen: ${id}`);
      handler({}, cx);
    },
  };
}

test("an issue becomes a mission that shows in the Development list", async (t) => {
  const { shown, click } = window(t);
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
  const { shown, click } = window(t);
  await shown();
  click("issue-DEMO-2");
  await shown();
  click("validate");
  const texts = await shown();
  assert.ok(texts.includes("Ce ticket ne figure pas dans la liste autorisée."));
  assert.ok(texts.includes("✓  Valider la demande"));
});

test("a slow reply for one issue never replaces the issue opened after it", async (t) => {
  const { shown, click } = window(t);
  await shown();
  let release = () => {};
  screen.gate = new Promise((resolve) => { release = resolve; });
  click("issue-DEMO-1");
  click("issue-DEMO-2");
  release();
  const texts = await shown();
  assert.ok(texts.includes("DEMO-2 · LA DEMANDE"));
  assert.ok(!texts.includes("DEMO-1 · LA DEMANDE"));
});
