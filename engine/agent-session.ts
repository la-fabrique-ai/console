// A terminal owns one conversation. Only the engine's scoped tools run in the project.
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";

const [, , key, terminal, tool, first] = process.argv;
const cwd = mkdtempSync(join(tmpdir(), "mc-agent-"));
const env = Object.fromEntries(["PATH", "HOME", "TMPDIR", "LANG", "ANTHROPIC_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN", "OPENAI_API_KEY", "CODEX_HOME"]
  .flatMap(k => process.env[k] ? [[k, process.env[k]!]] : []));
const host = Object.fromEntries(["MISSION_CONTROL_HOME", "HERDR_APP_HOME", "HC_SOCKET", "HC_SESSION", "PATH"]
  .map(k => [k, process.env[k] ?? ""]));
const server = { command: process.execPath, args: [join(import.meta.dirname, "agent-tools.ts"), key, terminal, cwd], env: host };
const config = JSON.stringify({ mcpServers: { mc: server } });
const lines = createInterface({ input: process.stdin, terminal: !!process.stdin.isTTY, output: process.stdout })[Symbol.asyncIterator]();
let session = tool === "claude" ? randomUUID().toString() : "";

async function turn(message: string, resume: boolean) {
  const args = tool === "claude" ? ["-p", "--restricted", "--strict-mcp-config", "--mcp-config", config, "--tools", "",
    "--allowedTools", "mcp__mc__command", "mcp__mc__shell", "mcp__mc__commit", "--permission-mode", "dontAsk",
    "--permission-prompts", "none", resume ? "--resume" : "--session-id", session] :
    ["-a", "never", "exec", "--ignore-user-config", "--ignore-rules", "--skip-git-repo-check", "--json",
      "-c", 'sandbox_mode="read-only"', "--disable", "shell_tool", "--disable", "unified_exec", "--disable", "multi_agent",
      "-c", "mcp_servers.mc.command=" + JSON.stringify(server.command), "-c", "mcp_servers.mc.args=" + JSON.stringify(server.args),
      "-c", "mcp_servers.mc.env={" + Object.entries(host).map(([k,v]) => k + "=" + JSON.stringify(v)).join(",") + "}",
      ...(resume ? ["resume", session] : []), "-"];
  const child = spawn(tool, args, { cwd, env, stdio: ["pipe", "pipe", "inherit"] });
  const done = new Promise<void>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", code => code === 0 ? resolve() : reject(new Error("Agent turn failed")));
  });
  child.stdin.end(message);
  for await (const line of createInterface({ input: child.stdout })) {
    console.log(line);
    if (tool === "codex" && !resume) {
      const event = JSON.parse(line);
      if (event.type === "thread.started" && typeof event.thread_id === "string") session = event.thread_id;
    }
  }
  await done;
  if (!session) throw new Error("Missing agent session");
}

try {
  await turn(first, false);
  for await (const message of { [Symbol.asyncIterator]: () => lines }) await turn(message, true);
} finally { rmSync(cwd, { recursive: true, force: true }); }
