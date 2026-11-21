// Stands in for Herdr's modules ("gpui-kit", "gpui-base", "herdr") outside the
// app. `draw` keeps the texts and click handlers of what a render really
// attached to its root, and exec runs the real engine against the Linear
// fixture of the engine tests.
import { spawnSync } from "node:child_process";

type Click = (event: unknown, cx: unknown) => void;
interface Drawn { id: string; texts: string[]; click?: Click; field?: string; children: Drawn[] }
interface Field { value(): string; set_value(next: string): void; on(event: string, handler: Click): boolean; type(text: string, cx: unknown): void }

export const screen = {
  texts: [] as string[],
  clicks: new Map<string, Click>(),
  /** The fields drawn right now, by placeholder. */
  fields: new Map<string, Field>(),
  env: {} as NodeJS.ProcessEnv,
  cliArgs: [] as string[],
  /** "network": Linear cannot be reached (see the engine's Linear fixture). */
  failure: "",
  /** Answers given in place of the engine's, one per call of the action: what another window or agent made of the state. */
  canned: new Map<string, string[]>(),
  /** The next call of an action waits for its promise before answering: a slow reply. */
  slow: new Map<string, Promise<void>>(),
};

const drawn = new WeakMap<object, Drawn>();

function element(text?: string, field?: string): object {
  const node: Drawn = { id: "", texts: text ? [text] : [], field, children: [] };
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
  screen.fields = new Map();
  const walk = (node: Drawn) => {
    screen.texts.push(...node.texts);
    if (node.click) screen.clicks.set(node.id, node.click);
    if (node.field !== undefined) screen.fields.set(node.field, states.get(node.field)!);
    node.children.forEach(walk);
  };
  walk(drawn.get(root)!);
}

export class View {}
export const div = () => element();
export const v_flex = div;
export const h_flex = div;
export const TextView = { markdown: (_id: string, text: string) => element(text) };

const states = new Map<string, Field>();
export const InputState = {
  new({ placeholder = "" } = {}): Field {
    let value = "";
    const handlers: Click[] = [];
    const state: Field = {
      value: () => value,
      set_value(next) { value = next; },
      on(_event, handler) { handlers.push(handler); return true; },
      type(text, cx) { value = text; handlers.forEach((handler) => handler({}, cx)); },
    };
    states.set(placeholder, state);
    return state;
  },
};
export const Input = { new: (state: Field) => element(state.value(), [...states].find(([, other]) => other === state)![0]) };

export const checking = () => false;
export const props = () => ({ engine: "engine.sh" });
export async function exec(_command: string, [, ...args]: string[]) {
  const gate = screen.slow.get(args[0]);
  screen.slow.delete(args[0]);
  const said = screen.canned.get(args[0])?.shift();
  if (said !== undefined) {
    await gate;
    return { code: 0, stdout: said, stderr: "" };
  }
  const child = spawnSync(process.execPath, [...screen.cliArgs, ...args], { env: { ...screen.env, TEST_LINEAR_FAILURE: screen.failure }, encoding: "utf8" });
  await gate;
  return { code: child.status, stdout: child.stdout, stderr: child.stderr };
}
