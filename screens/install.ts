// Copies the screens into the Herdr App home of the separate installation:
// types stripped, one layout that shows the Mission Control window and tells
// it how to run the engine.
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { join } from "node:path";

const home = process.env.HERDR_APP_HOME;
if (!home || !existsSync(join(home, ".mission-control"))) {
  // Only a home marked as ours is written to: any other is someone's own Herdr App.
  console.error("HERDR_APP_HOME must name the separate installation (the home that holds a .mission-control file). Source its env.sh first.");
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
    content: { mod: "mission-control", props: { engine: join(import.meta.dirname, "engine.sh") } },
  }],
};
writeFileSync(join(home, "layouts", "mission-control.json"), JSON.stringify(layout, null, 2) + "\n");
console.log(`Screens installed in ${home}`);
