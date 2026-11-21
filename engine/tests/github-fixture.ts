// Executed as gh or git inside the disposable project. Every remote call can lose its reply.
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [tool, ...args] = process.argv.slice(2);
const root = process.env.MISSION_CONTROL_HOME!, log = join(root, "remote-calls");
const flags = (name: string) => args[args.indexOf(name) + 1];
const git = (...a: string[]) => execFileSync("/usr/bin/git", a, { encoding: "utf8", stdio: ["ignore","pipe","pipe"] }).trim();
let output = "";
if (tool === "git") {
  output = git(...args);
  if (!args.some(a => ["push","fetch","ls-remote"].includes(a))) { console.log(output); process.exit(0); }
} else {
  const origin = join(root, "bare");
  const ref = (name: string) => git("--git-dir", origin, "rev-parse", name);
  const file = join(root, "pulls");
  const prs = existsSync(file) ? JSON.parse(readFileSync(file,"utf8")) : [];
  const head = flags("--head"), base = flags("--base");
  if (args[0] === "pr" && args[1] === "list") {
    output = JSON.stringify(prs.filter((p: any) => p.headRefName === head && p.baseRefName === base)
      .map((p: any) => ({ ...p, headRefOid: ref(p.headRefName) })));
  } else if (args[1] === "create" && args.includes("--draft")) {
    const number = prs.length + 1;
    prs.push({ number, url: "https://github.com/demo/repo/pull/" + number, headRefName: head, baseRefName: base,
      isDraft: true, state: "OPEN", isCrossRepository: false });
  } else if (args[1] === "ready" && args[2] === "2") {
    prs[1].isDraft = false;
    if (existsSync(join(root,"retarget"))) prs[1].baseRefName = "main";
  }
  else if (args[0] === "api" && args.includes("repos/demo/repo/pulls/2/merge")) {
    const pr = prs[1], sha = ref(pr.headRefName);
    if (pr.isDraft || pr.state !== "OPEN" || !args.includes("sha=" + sha) || !args.includes("merge_method=merge")) process.exit(92);
    const parent = ref(pr.baseRefName);
    const merge = git("-C", root + "/repo", "commit-tree", ref(sha + "^{tree}"), "-p", parent, "-p", sha, "-m", "Merge");
    if (!existsSync(join(root,"wrong-remote"))) git("-C", root + "/repo", "push", origin, merge + ":refs/heads/" + pr.baseRefName);
    pr.state = "MERGED"; pr.mergeCommit = { oid: merge };
  } else if (args[0] === "api" && args.includes("repos/demo/repo")) output = String(existsSync(join(root,"auto-delete")));
  else process.exit(93);
  writeFileSync(file, JSON.stringify(prs));
}
appendFileSync(log, JSON.stringify([tool,...args]) + "\n");
if (existsSync(join(root,"fail-at")) && readFileSync(log,"utf8").trim().split("\n").length === Number(readFileSync(join(root,"fail-at")))) process.exit(74);
console.log(output);
