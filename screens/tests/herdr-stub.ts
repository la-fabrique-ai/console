// Stands in for Herdr's modules ("gpui-kit", "gpui-base", "herdr") outside the
// app: elements record their texts and click handlers, and exec runs the real
// engine against the Linear fixture of the engine tests.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

type Click = (event: unknown, cx: unknown) => void;

export const screen = { texts: [] as string[], clicks: new Map<string, Click>(), home: "" };

function element(): unknown {
  let id = "";
  const el: unknown = new Proxy({}, {
    get: (_target, method) => (...args: unknown[]) => {
      if (method === "id") id = String(args[0]);
      if (method === "on_click") screen.clicks.set(id, args[0] as Click);
      if (method === "when" && args[0]) (args[1] as (el: unknown) => void)(el);
      if (method === "child" && typeof args[0] === "string") screen.texts.push(args[0]);
      return el;
    },
  });
  return el;
}

export class View {}
export const div = element;
export const v_flex = element;
export const h_flex = element;
export const TextView = { markdown: (_id: string, text: string) => { screen.texts.push(text); return element(); } };

export const checking = () => false;
export const props = () => ({ cli: fileURLToPath(new URL("../../engine/cli.ts", import.meta.url)) });
export async function exec(_command: string, args: string[]) {
  const fixture = new URL("../../engine/tests/linear-fixture.ts", import.meta.url).href;
  const child = spawnSync(process.execPath, ["--import", fixture, ...args], { env: { MISSION_CONTROL_HOME: screen.home }, encoding: "utf8" });
  return { code: child.status, stdout: child.stdout, stderr: child.stderr };
}
