import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { type TestContext } from "node:test";
import { setup } from "./pilot-project.ts";

export function development(t: TestContext) {
  const p = setup(t), issueKey = "DEMO-1", mission = p.path("Developer/worktrees/repo", issueKey);
  p.git("config", "user.name", "Test"); p.git("config", "user.email", "test@example.invalid");
  p.git("worktree", "add", "-b", "mission/" + issueKey, mission, "HEAD");
  p.git("-C", mission, "commit", "--allow-empty", "-m", "Plan");
  mkdirSync(p.path("missions"));
  const tickets = ["1", "2"].map((id, i) => ({ id, key: "DEMO-" + (10 + i), title: id, after: i ? ["1"] : [], parallel: { dev: 2 } }));
  const file = p.path("missions", issueKey + ".json");
  writeFileSync(file, JSON.stringify({ issueKey, title: "Mission", stage: "develop", plan: { launched: true, team: ["claude", "codex"], tickets } }));
  const state = () => JSON.parse(readFileSync(file, "utf8"));
  const action = (name: string, body: object = {}, identity?: string) => p.cli(name, { issueKey, ...body }, true, identity);
  return { ...p, issueKey, mission, state, action };
}
