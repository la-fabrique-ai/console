// A terminal owns one conversation. Only the engine's scoped tools run in the project.
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";

const [, , key, terminal, tool, first] = process.argv;
const cwd = mkdtempSync(join(tmpdir(), "mc-agent-"));
const env = Object.fromEntries(["PATH", "HOME", "USER", "LOGNAME", "TMPDIR", "LANG", "ANTHROPIC_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN", "OPENAI_API_KEY", "CODEX_HOME"]
  .flatMap(k => process.env[k] ? [[k, process.env[k]!]] : []));
const host = Object.fromEntries(["MISSION_CONTROL_HOME", "HERDR_APP_HOME", "HC_SOCKET", "HC_SESSION", "PATH", "HOME", "USER", "LOGNAME"]
  .map(k => [k, process.env[k] ?? ""]));
const server = { command: process.execPath, args: [join(import.meta.dirname, "agent-tools.ts"), key, terminal, cwd], env: host };
const config = JSON.stringify({ mcpServers: { mc: server } });
const lines = createInterface({ input: process.stdin, terminal: !!process.stdin.isTTY, output: process.stdout })[Symbol.asyncIterator]();
let session = tool === "claude" ? randomUUID().toString() : "";

function messageFields(line: string) {
  try { return JSON.parse(line); }
  catch { return undefined; }
}

async function turn(message: string, resume: boolean) {
  const args = tool === "claude" ? ["-p", "--restricted", "--strict-mcp-config", "--mcp-config", config, "--tools", "",
    "--allowedTools", "mcp__mc__command", "mcp__mc__shell", "mcp__mc__commit", "--permission-mode", "dontAsk",
    "--permission-prompts", "none", resume ? "--resume" : "--session-id", session] :
    ["-a", "never", "exec", "--ignore-user-config", "--ignore-rules", "--skip-git-repo-check", "--json",
      "-c", 'default_permissions="mission"', "-c", 'permissions.mission.filesystem={":minimal"="read",":workspace_roots"="read"}',
      "-c", "permissions.mission.network.enabled=false", "-c", 'web_search="disabled"',
      ...["shell_tool", "unified_exec", "multi_agent", "apps", "plugins", "browser_use", "computer_use"].flatMap(feature => ["--disable", feature]),
      "-c", "mcp_servers.mc.command=" + JSON.stringify(server.command), "-c", "mcp_servers.mc.args=" + JSON.stringify(server.args),
      "-c", "mcp_servers.mc.env={" + Object.entries(host).map(([k,v]) => k + "=" + JSON.stringify(v)).join(",") + "}",
      ...(resume ? ["resume", session] : []), "-"];
  const child = spawn(tool, args, { cwd, env, stdio: ["pipe", "pipe", "inherit"] });
  const done = new Promise<boolean>(resolve => {
    child.on("error", () => resolve(false));
    child.on("close", code => resolve(code === 0));
  });
  child.stdin.on("error", () => console.error("The agent did not read this input."));
  child.stdin.end(message);
  for await (const line of createInterface({ input: child.stdout })) {
    console.log(line);
    if (tool === "codex" && !resume) {
      const event = messageFields(line);
      if (event?.type === "thread.started" && typeof event.thread_id === "string") session = event.thread_id;
    }
  }
  if (!await done || !session) console.error("Agent turn failed. Waiting for the next message.");
}

try {
  await turn(first, false);
  for await (const message of { [Symbol.asyncIterator]: () => lines }) {
    const event = messageFields(message);
    if (typeof event?.deliveryId === "string" && /^[0-9a-f-]{36}$/.test(event.deliveryId)) {
      const receipts = join(host.MISSION_CONTROL_HOME, "receipts", terminal);
      mkdirSync(receipts, { recursive: true });
      try { writeFileSync(join(receipts, event.deliveryId), "", { flag: "wx" }); }
      catch (err) {
        if ((err as NodeJS.ErrnoException).code === "EEXIST") continue;
        throw err;
      }
    }
    await turn(session ? message : first + "\n\n" + message, Boolean(session));
  }
} finally { rmSync(cwd, { recursive: true, force: true }); }
