// Private stdio MCP server. The session selects the identity; model arguments cannot select it.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { loadDetail } from "./missions.ts";
import { gitAt } from "./pilot.ts";
import { runShell } from "./agent-shell.ts";

const [, , key, terminal, session] = process.argv;
const scratch = session ? join(session,"tools") : mkdtempSync(join(tmpdir(),"mc-tools-"));
mkdirSync(scratch,{ recursive: true });
function current() {
  const m = loadDetail(join(process.env.MISSION_CONTROL_HOME!,"missions"),key);
  const agent = Object.values(m.agents ?? {}).find(a => a.terminal === terminal);
  if (!agent) throw new Error("Session expired");
  return { m, agent };
}
const textField = { type: "string" };
function tool(name: string, description: string, fields: string[]) {
  return { name, description, inputSchema: { type:"object", properties:Object.fromEntries(fields.map(f => [f,textField])),
    required:fields, additionalProperties:false } };
}
const command = tool("command","Run mission-control ACTION - with the JSON string on standard input.",["action","json"]);
const shell = tool("shell","Run a shell command in the assigned project worktree. Use the private TMPDIR for caches or a writable test copy.",["script"]);
const commit = tool("commit","Stage the ticket worktree and commit its changes using this message.",["message"]);
function result(text: string, isError = false) { return { content:[{ type:"text",text }], isError }; }

async function dispatch(method: string, params: { name?: string; arguments?: Record<string,string>; protocolVersion?: string }) {
  if (method === "initialize") return { protocolVersion:params.protocolVersion, capabilities:{ tools:{} }, serverInfo:{ name:"mission-control", version:"1" } };
  if (method === "ping") return {};
  const { m, agent } = current(), args = params.arguments ?? {};
  const step = m.development?.tickets.find(r => r.id === agent.ticketId)?.steps.at(-1);
  const writing = agent.role === "dev" && step && step.kind !== "review" && !step.endedAt && !m.publication;
  if (method === "tools/list") return { tools: writing ? [command,shell,commit] : [command,shell] };
  if (method !== "tools/call") throw new Error("Unknown method");
  if (params.name === "command" && typeof args.action === "string" && typeof args.json === "string") {
    const child = spawnSync(process.execPath,[join(import.meta.dirname,"cli.ts"),args.action,"-"],{
      env:{ ...process.env, MC_AGENT_ID:agent.id },input:args.json,encoding:"utf8", maxBuffer:8 * 1024 * 1024,
    });
    return result(child.stdout?.trim() || "Engine unavailable", child.status !== 0);
  }
  if (params.name === "shell" && typeof args.script === "string") {
    const reply = await runShell(agent.cwd,!!writing,scratch,args.script);
    return result(reply.output,!reply.success);
  }
  if (params.name === "commit" && writing && typeof args.message === "string" && args.message.trim()) {
    const run = m.development!.tickets.find(r => r.id === agent.ticketId)!;
    if (gitAt(agent.cwd,"symbolic-ref","--short","HEAD").trim() !== run.branch) throw new Error("Wrong branch");
    gitAt(agent.cwd,"add","--all","--",".");
    return result(gitAt(agent.cwd,"commit","-m",args.message));
  }
  return result("This action is unavailable in this session.",true);
}

try {
  for await (const line of createInterface({ input:process.stdin })) {
    const { id, method, params } = JSON.parse(line);
    if (id === undefined) continue;
    try { console.log(JSON.stringify({ jsonrpc:"2.0", id, result:await dispatch(method,params ?? {}) })); }
    catch { console.log(JSON.stringify({ jsonrpc:"2.0", id, result:result("The operation did not finish.",true) })); }
  }
} finally { if (!session) rmSync(scratch,{recursive:true, force:true}); }
