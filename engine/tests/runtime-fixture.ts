import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { setup } from "./pilot-project.ts";

export function installForge(p: ReturnType<typeof setup>) {
  const path = p.path;
  const members = ["lead", "dev", "reviewer"].map(role => ({
    name: "agent-studio-" + (role === "dev" ? "dev-1" : role), team: "studio", role,
    present: true, session: "none", task: null as string | null, assignedBy: null as string | null, waitingOn: null,
  }));
  const settings = JSON.parse(readFileSync(path("settings.json"), "utf8"));
  writeFileSync(path("settings.json"), JSON.stringify({ ...settings, runtimeHost: "forge-test", runtimeTeam: "studio" }));
  const status = (inbox: object[] = []) => writeFileSync(path("status.json"), JSON.stringify({ members, inbox, mirrors: [] }));
  status();
  writeFileSync(path("roles/runtime-lead.md"), "Role supplied by the project. Run PostgreSQL and Playwright tests and obtain the reviewer verdict.");
  writeFileSync(path("bin/ssh"), `#!${process.execPath}
const fs = require("node:fs"), home = ${JSON.stringify(path(""))};
const args = process.argv.slice(2), stdin = fs.readFileSync(0, "utf8");
if (process.env.LINEAR_API_KEY || process.env.GH_TOKEN) process.exit(86);
const host = args.indexOf("forge-test");
if (host < 0 || !args.includes("BatchMode=yes") || !args.some(a => a.startsWith("ConnectTimeout="))) process.exit(81);
const [forge,team,op,target,...rest] = args.slice(host + 1).join(" ").split(" ");
fs.appendFileSync(home + "/forge-calls", JSON.stringify({ op,target,rest,stdin })+"\\n");
if (forge !== "forge" || team !== "team" || fs.existsSync(home + "/offline")) process.exit(82);
const status = JSON.parse(fs.readFileSync(home + "/status.json"));
if (op === "status" && target === "--json" && rest.includes("--quick")) console.log(JSON.stringify(status));
else if (op === "assign" && target === "agent-studio-lead" && !rest.length) {
  Object.assign(status.members[0],{ task:"(no branch)", session:"working", assignedBy:"human" });
  fs.writeFileSync(home + "/status.json",JSON.stringify(status));
  if (fs.existsSync(home + "/lose-assign")) process.exit(83);
} else if (op === "question" && rest[0] === "--json") {
  console.log(fs.readFileSync(home + "/question-" + target, "utf8"));
} else if (op === "answer" && rest[0] === "--json") {
  const q = JSON.parse(fs.readFileSync(home + "/question-" + target));
  if(q.state !== "open") process.exit(85);
  q.state = "answered"; fs.writeFileSync(home + "/question-" + target, JSON.stringify(q));
  status.inbox = status.inbox.filter(i => i.id !== Number(target));
  fs.writeFileSync(home + "/status.json",JSON.stringify(status));
  if (fs.existsSync(home + "/lose-answer")) process.exit(83);
  console.log(JSON.stringify({id:q.id,to:q.from,delivered:!fs.existsSync(home + "/dead-answer")}));
} else process.exit(84);
`, { mode: 0o700 });
  const calls = () => existsSync(path("forge-calls")) ? readFileSync(path("forge-calls"), "utf8").trim().split("\n").map(line => JSON.parse(line)) : [];
  return { status, calls, members };
}
