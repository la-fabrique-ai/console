// Stands in for Herdr's modules ("gpui-kit", "gpui-base", "herdr") outside the
// app. `draw` keeps the texts and click handlers of what a render really
// attached to its root, and exec runs the real engine against the Linear
// fixture of the engine tests.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

type Click = (event: unknown, cx: unknown) => void;
interface Drawn { id: string; texts: string[]; click?: Click; children: Drawn[] }

export const screen = {
  texts: [] as string[],
  clicks: new Map<string, Click>(),
  home: "",
  /** The next engine call waits for this before answering: a slow reply. */
  gate: Promise.resolve(),
};

const drawn = new WeakMap<object, Drawn>();

function element(text?: string): object {
  const node: Drawn = { id: "", texts: text ? [text] : [], children: [] };
  const el: object = new Proxy({}, {
    get: (_target, method) => (...args: unknown[]) => {
      if (method === "id") node.id = String(args[0]);
      if (method === "on_click") node.click = args[0] as Click;
      if (method === "when" && args[0]) (args[1] as (el: object) => void)(el);
      if (method === "child" || method === "children") {
        for (const child of method === "child" ? [args[0]] : args[0] as unknown[]) {
          if (typeof child === "string") node.texts.push(child);
          else node.children.push(drawn.get(child as object)!);
        }
      }
      return el;
    },
  });
  drawn.set(el, node);
  return el;
}

export function draw(root: object) {
  screen.texts = [];
  screen.clicks = new Map();
  const walk = (node: Drawn) => {
    screen.texts.push(...node.texts);
    if (node.click) screen.clicks.set(node.id, node.click);
    node.children.forEach(walk);
  };
  walk(drawn.get(root)!);
}

export class View {}
export const div = () => element();
export const v_flex = div;
export const h_flex = div;
export const TextView = { markdown: (_id: string, text: string) => element(text) };

export const checking = () => false;
export const props = () => ({ engine: "engine.sh" });
export async function exec(_command: string, [, ...args]: string[]) {
  const gate = screen.gate;
  screen.gate = Promise.resolve();
  const fixture = new URL("../../engine/tests/linear-fixture.ts", import.meta.url).href;
  const cli = fileURLToPath(new URL("../../engine/cli.ts", import.meta.url));
  const child = spawnSync(process.execPath, ["--import", fixture, cli, ...args], { env: { MISSION_CONTROL_HOME: screen.home }, encoding: "utf8" });
  await gate;
  return { code: child.status, stdout: child.stdout, stderr: child.stderr };
}
