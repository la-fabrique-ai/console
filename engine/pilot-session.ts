// One Herdr terminal, one Claude conversation. Print mode never opens a trust or permission dialog.
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { delimiter, join } from "node:path";
import { createInterface } from "node:readline";

const [, , role, first] = process.argv;
const session = randomUUID();
const lines = createInterface({ input: process.stdin, terminal: Boolean(process.stdin.isTTY), output: process.stdout });
const env = { ...process.env, MC_PILOT_NODE: process.execPath, PATH: [join(import.meta.dirname, "bin"), process.env.PATH].join(delimiter) };
const args = ["-p", "--permission-mode", "dontAsk", "--permission-prompts", "none", "--restricted",
  "--strict-mcp-config", "--tools", "Read,Glob,Grep,Bash", "--allowedTools",
  "Read", "Glob", "Grep", "Bash(mission-control pilot.questions *)", "Bash(mission-control pilot.propose *)",
  "--append-system-prompt", readFileSync(role, "utf8")];
function turn(message: string, resume: boolean) {
  spawnSync("claude", [...args, resume ? "--resume" : "--session-id", session], {
    env, input: message, stdio: ["pipe", "inherit", "inherit"],
  });
}
const input = lines[Symbol.asyncIterator]();
turn(first, false);
for await (const message of { [Symbol.asyncIterator]: () => input }) turn(message, true);
