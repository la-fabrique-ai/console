import { execFileSync } from "node:child_process";
import { gitAt } from "./pilot.ts";
import { CommandError } from "./contract.ts";

export const remoteError = () => new CommandError("GitHub n’a pas confirmé l’opération. Relancez la même action.");
interface Pull {
  number: number; url: string; headRefName: string; baseRefName: string; headRefOid: string;
  isDraft: boolean; isCrossRepository: boolean; state: string; mergeCommit?: { oid: string };
}
export function github(cwd: string) {
  const remote = gitAt(cwd, "config", "--get", "remote.origin.url").trim();
  const repo = /^(?:https:\/\/github\.com\/|(?:ssh:\/\/git@github\.com\/|git@github\.com:))([\w.-]+\/[\w.-]+?)(?:\.git)?$/.exec(remote)?.[1];
  if (!repo) throw remoteError();
  const env = { ...process.env, GH_REPO: repo, GH_PROMPT_DISABLED: "1" };
  delete (env as NodeJS.ProcessEnv).LINEAR_API_KEY;
  function gh(...args: string[]) {
    return execFileSync("gh", args, { cwd, env, encoding: "utf8", timeout: 30_000, stdio: ["ignore","pipe","pipe"] }).trim();
  }
  function find(head: string, base: string): Pull | undefined {
    const pulls: Pull[] = JSON.parse(gh("pr","list","--head",head,"--base",base,"--state","all","--json",
      "number,url,headRefName,baseRefName,headRefOid,isCrossRepository,isDraft,state,mergeCommit"));
    const matches = pulls.filter(p => !p.isCrossRepository && p.baseRefName === base && p.headRefName === head);
    if (matches.length > 1) throw remoteError();
    return matches[0];
  }
  return {
    publish(branch: string, commit: string) {
      const ref = "refs/heads/" + branch;
      if (gitAt(cwd,"ls-remote","--refs","origin",ref).split(/\s+/)[0] !== commit) gitAt(cwd,"push","origin",commit + ":" + ref);
    },
    draft(head: string, base: string, commit: string, title: string) {
      let pr = find(head,base);
      if (!pr) {
        gh("pr","create","--draft","--head",head,"--base",base,"--title",title,"--body","");
        pr = find(head,base);
      }
      if (!pr || !pr.isDraft || pr.state !== "OPEN" || pr.headRefOid !== commit) throw remoteError();
      return { number: pr.number, url: pr.url };
    },
    merge(head: string, base: string, sha: string, number: number) {
      let pr = find(head,base);
      if (!pr || pr.number !== number || pr.headRefOid !== sha) throw remoteError();
      if (pr.state === "OPEN") {
        if (gh("api","repos/" + repo,"--jq",".delete_branch_on_merge") !== "false") throw remoteError();
        if (pr.isDraft) gh("pr","ready",String(number));
        gh("api","--method","PUT","repos/" + repo + "/pulls/" + number + "/merge","-f","merge_method=merge","-f","sha=" + sha);
        pr = find(head,base);
      }
      if (pr?.state !== "MERGED" || !pr.mergeCommit || !/^[0-9a-f]{40}$/.test(pr.mergeCommit.oid)) throw remoteError();
      gitAt(cwd,"fetch","--no-tags","origin","refs/heads/" + base);
      if (gitAt(cwd,"rev-parse",pr.mergeCommit.oid + "^2").trim() !== sha) throw remoteError();
      gitAt(cwd,"merge","--ff-only",pr.mergeCommit.oid);
    },
  };
}
