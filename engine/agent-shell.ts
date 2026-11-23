import { execFile } from "node:child_process";
import { realpathSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { Writable } from "node:stream";
import { gitAt } from "./pilot.ts";

const registry = "https://registry.npmjs.org";
const browserHosts = ["cdn.playwright.dev","playwright.download.prss.microsoft.com"];

// The shell can reach loopback for tests. This read-only mirror fetches dependency and browser files.
function downloads() {
  return createServer(async (req,res) => {
    try {
      if (!["HEAD","GET"].includes(req.method ?? "")) throw new Error();
      const path = req.url ?? "/", browser = path.startsWith("/playwright/");
      const origin = browser ? "https://" + browserHosts[0] : registry;
      let url = new URL(origin + (browser ? path.slice("/playwright".length) : path));
      for (let redirects = 0; redirects < 5; redirects++) {
        if (url.protocol !== "https:" || !(browser ? browserHosts.includes(url.host) : url.origin === registry)) throw new Error();
        const reply = await fetch(url,{ method:req.method, redirect:"manual", signal:AbortSignal.timeout(120_000) });
        if (reply.status >= 300 && reply.status < 400 && reply.headers.has("location")) {
          url = new URL(reply.headers.get("location")!,url); await reply.body?.cancel(); continue;
        }
        const type = reply.headers.get("content-type") ?? "application/octet-stream";
        res.writeHead(reply.status,{ "content-type":type });
        if (!reply.body) res.end();
        else if (!browser && type.includes("json")) {
          const address = res.socket!.localPort;
          res.end((await reply.text()).replaceAll(registry + "/", "http://127.0.0.1:" + address + "/"));
        } else await reply.body.pipeTo(Writable.toWeb(res));
        return;
      }
    } catch { /* A failed or forbidden download is a normal package-manager error. */ }
    if (!res.headersSent) res.writeHead(502);
    res.end();
  });
}

export async function runShell(folder: string, writing: boolean, temporary: string, script: string) {
  const cwd = realpathSync(folder), scratch = realpathSync(temporary);
  const node = dirname(dirname(realpathSync(process.execPath)));
  const common = realpathSync(gitAt(cwd,"rev-parse","--path-format=absolute","--git-common-dir").trim());
  const q = JSON.stringify;
  const profile = [
    "(version 1)(deny default)(import \"system.sb\")",
    "(allow process-fork process-exec sysctl-read file-read-metadata)(allow signal (target same-sandbox))",
    "(allow mach-lookup (global-name \"com.apple.system.logger\"))",
    '(allow mach-register mach-lookup (global-name-prefix "org.chromium.Chromium.MachPortRendezvousServer."))',
    "(allow network-outbound (remote ip \"localhost:*\"))(allow network-bind network-inbound (local ip \"localhost:*\"))",
    "(allow file-read* file-map-executable " + ["/bin","/usr/bin","/usr/lib","/Library/Developer/CommandLineTools","/dev/fd",node,cwd,common,scratch].map(p => "(subpath " + q(p) + ")").join(" ") + ")",
    "(allow file-write* (subpath " + q(scratch) + ")" + (writing ? " (subpath " + q(cwd) + ")" : "") + ")",
    "(deny file-write* (literal " + q(join(cwd,".git")) + ") (literal " + q(cwd) + ") (subpath " + q(common) + "))",
    "(deny process-exec (literal \"/usr/bin/gh\") (literal \"/usr/bin/security\"))",
  ].join("\n");
  const mirror = downloads();
  await new Promise<void>((resolve,reject) => { mirror.once("error",reject); mirror.listen(0,"127.0.0.1",resolve); });
  const address = mirror.address();
  if (!address || typeof address === "string") throw new Error("No download endpoint");
  const local = "http://127.0.0.1:" + address.port;
  try {
    return await new Promise<{ output:string; success:boolean }>(resolve => {
      execFile("/usr/bin/sandbox-exec",["-p",profile,"/bin/sh","-c",script],{ cwd,timeout:300_000,maxBuffer:4 * 1024 * 1024,
        env:{ HOME:scratch,TMPDIR:scratch,PATH:dirname(realpathSync(process.execPath)) + ":/usr/bin:/bin",LANG:"en_US.UTF-8",
          GIT_CONFIG_NOSYSTEM:"1",GIT_CONFIG_GLOBAL:"/dev/null",GIT_TERMINAL_PROMPT:"0",GIT_OPTIONAL_LOCKS:"0",
          npm_config_registry:local, COREPACK_NPM_REGISTRY:local, PLAYWRIGHT_DOWNLOAD_HOST:local + "/playwright",
          PLAYWRIGHT_BROWSERS_PATH:join(scratch,"browsers") } },
      (error,out,err) => resolve({ output:out + err, success:!error }));
    });
  } finally { mirror.closeAllConnections(); mirror.close(); }
}
