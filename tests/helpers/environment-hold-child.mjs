// M6 (b), review 1, point 2: a real environment check (src/environment-check.mjs) in a process of its own, started
// « elsewhere » than the page: `node environment-hold-child.mjs <state root> <control folder>`. It reads the
// configuration of <state root> as the engine does; once inside the kernel lock (its `.running` written), its first Git
// call writes <control>/held and waits for ever. The test kills it (SIGKILL) to leave what a check that died before
// saving leaves: its `.running`, the lock dropped by the kernel. No base, no docker, no network: it never gets further.
// A third argument, the lock program to use (review 2: one that kills this process as soon as the lock is taken).
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createEnvironmentCheck } from '../../src/environment-check.mjs';
import { createStorage } from '../../src/state.mjs';

const [root,control,lockf]=process.argv.slice(2);
const {loadConfig}=createStorage({root});
const invoke=()=>{writeFileSync(join(control,'held'),String(process.pid));return new Promise(()=>{});};
const check=createEnvironmentCheck({root,loadConfig,invoke,env:{},...(lockf?{tools:{lockf}}:{})});
setInterval(()=>{},1<<30);
await check.check({project:'example'});
