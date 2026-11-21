import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { setup } from "./pilot-project.ts";

test("the named tracker actions confirm the requested IDs and recover every page of the parent", t => {
  const { path, env } = setup(t);
  const ids = Array.from({ length: 4 }, () => randomUUID());
  const script = `
    const { launchInventory, createSubTicket, addComment } = await import(process.argv[1]);
    const [a, b, c, d] = process.argv.slice(2);
    const parent = await launchInventory("DEMO-1", "DEMO");
    for (const id of [a,b]) await createSubTicket(parent, id, "Le titre", "Le texte");
    for (const id of [c,d]) await addComment(parent.id, id, "Résumé");
    const again = await launchInventory("DEMO-1", "DEMO");
    console.log(JSON.stringify([[...again.children], [...again.comments]]));
  `;
  const proc = spawnSync(process.execPath, ["--import", path("engine/tests/linear-fixture.ts"), "--input-type=module",
    "-e", script, path("engine/linear.ts"), ...ids], { env, encoding: "utf8" });
  assert.equal(proc.status, 0, proc.stderr);
  assert.deepEqual(JSON.parse(proc.stdout), [[[ids[0], "DEMO-10"], [ids[1], "DEMO-11"]], ids.slice(2)]);
  const requests = readFileSync(path("linear-requests"), "utf8").trim().split("\n").map(line => JSON.parse(line));
  assert.deepEqual(requests.filter(r => r.query.includes("mutation")).map(r => r.variables.input.id), ids);
});
