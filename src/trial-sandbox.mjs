// The sandbox of a trial (macOS sandbox-exec), applied once by the trial launcher (scripts/trial.mjs) to itself, the
// CLI, the herdr-core of the trial and everything they start: a sandbox cannot be lifted, and every descendant
// inherits it, detached or not. What it refuses:
//   - the network: every address, loopback included, inbound, outbound and bind; Unix sockets outside the folder
//     of the trial (the socket of the DNS resolver, the core and the Herdr in service);
//   - every write outside the folder of the trial (and /dev);
//   - every read of the real home (decision 63), but the exceptions below, each named and justified;
//   - the programs that would leave the trial or reach a secret: security, launchctl, osascript, open and the real
//     agents (started, or read so as to be copied);
//   - the services of the keychain, of LaunchServices and of Herdr; Apple events and the opening of applications;
//   - the creation of a launchd job (job-creation), whatever the way: launchctl, liblaunch or libxpc straight. launchd
//     itself refuses it to a sandboxed caller; the profile says it too, so that the validator can read it;
//   - every signal to a process outside this very sandbox (another sandbox included, even with the same profile): a
//     trial signals its own processes only.
import { sep } from 'node:path';
import { SYSTEM_EXECS, DENIED_SERVICES } from './trial-validator.mjs';

// The programs and services the validator requires refused: the profile refuses at least these.
export { SYSTEM_EXECS, DENIED_SERVICES };
const DENIED_PREFIXES=['com.apple.security.','dev.herdr'];
const inside=(path,base)=>path===base||path.startsWith(base.endsWith(sep)?base:base+sep);

// The read exceptions of decision 63: only programs, each the smallest part of the home that lets it run. A program
// outside the home (Git is /usr/bin/git, from Xcode) needs none. Never the home itself or a folder holding it.
export function readExceptions({realHome,node,hc}) {
  const list=[],add=(what,path,scope,why)=>{
    if(!inside(path,realHome))return;
    if(path===realHome||inside(realHome,path))throw new Error(`An exception of the trial can never be the home or above it (${what}).`);
    list.push({what,path,scope,why});
  };
  add('node',node,'literal','The Node that runs the launcher, the CLI and the validator: its binary only, not its folder (no npm, no global module).');
  // The binary of Herdr Core lives in its application bundle, which it reads at start (signature, Info.plist).
  const bundle=hc.match(/^(.*?\.app)\/Contents\/MacOS\/[^/]+$/)?.[1]??null;
  if(bundle)add('hc',bundle,'subpath','Herdr Core (hc, the core of the trial and its holders): its application bundle only (binary, signature, resources).');
  else add('hc',hc,'literal','Herdr Core (hc): its binary only.');
  return list;
}

const quoted=path=>{if(typeof path!=='string'||!path.startsWith('/')||/["\\\n\r\0]/.test(path))throw new Error('A path of the sandbox profile must be absolute and safe to quote: '+String(path));return '"'+path+'"';};
const service=name=>{if(!/^[A-Za-z0-9._-]+$/.test(name))throw new Error('A service name of the sandbox profile must be safe to quote: '+name);return '"'+name+'"';};
// The profile, in the order the sandbox reads it: a later rule wins over an earlier one.
// identity: a file outside the folder whose read only this profile denies, so that the launcher can tell the processes
// of this sandbox from any other (scripts/trial.mjs, sandboxIdentity). protect: files of the folder the trial reads
// but never changes (the spec of the validator, the profile itself).
export function sandboxProfile({folder,realHome,exceptions,execs,identity=null,protect=[]}) {
  const f=quoted(folder),home=quoted(realHome);
  const lines=['(version 1)','(allow default)',
    '(deny network*)',
    `(allow network* (local unix-socket (subpath ${f})) (remote unix-socket (subpath ${f})))`,
    '(deny file-write*)',
    `(allow file-write* (subpath ${f}) (subpath "/dev"))`,
    ...(protect.length?[`(deny file-write* ${protect.map(path=>`(literal ${quoted(path)})`).join(' ')})`]:[]),
    `(deny file-read* (subpath ${home}))`,
  ];
  for(const e of exceptions)lines.push(`(allow file-read* (${e.scope==='subpath'?'subpath':'literal'} ${quoted(e.path)}))`);
  lines.push(`(allow file-read* (subpath ${f}))`);
  const programs=[...new Set([...SYSTEM_EXECS,...execs])].map(path=>`(literal ${quoted(path)})`).join(' ');
  if(programs){lines.push(`(deny process-exec ${programs})`);lines.push(`(deny file-read* ${programs})`);}
  lines.push(`(deny mach-lookup ${DENIED_SERVICES.map(n=>`(global-name ${service(n)})`).join(' ')} ${DENIED_PREFIXES.map(n=>`(global-name-prefix ${service(n)})`).join(' ')})`);
  lines.push('(deny appleevent-send)','(deny lsopen)');
  lines.push('(deny signal)','(allow signal (target same-sandbox))');
  lines.push('(deny job-creation)');
  if(identity)lines.push(`(deny file-read* (literal ${quoted(identity)}))`);
  return lines.join('\n')+'\n';
}
