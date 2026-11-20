// Copies the screens into a Herdr App home: types stripped, one layout that
// shows the Mission Control window and tells it where the engine is.
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { join, resolve } from "node:path";

const home = process.env.HERDR_APP_HOME;
if (!home) {
  // Without it Herdr's commands reach the default installation, which is not ours.
  console.error("HERDR_APP_HOME is not set. Source the environment of the separate Herdr first.");
  process.exit(1);
}

const source = join(import.meta.dirname, "mission-control");
const mod = join(home, "mods", "mission-control");
mkdirSync(mod, { recursive: true });
writeFileSync(join(mod, "main.js"), stripTypeScriptTypes(readFileSync(join(source, "main.ts"), "utf8")));
copyFileSync(join(source, "mod.json"), join(mod, "mod.json"));

const layout = {
  id: "root",
  type: "column",
  background: "#12151D",
  children: [{
    id: "mission-control",
    type: "block",
    content: { mod: "mission-control", props: { cli: resolve(import.meta.dirname, "../engine/cli.ts") } },
  }],
};
writeFileSync(join(home, "layouts", "mission-control.json"), JSON.stringify(layout, null, 2) + "\n");
console.log(`Screens installed in ${home}`);
