// A process of its own running one real environment check (M6), for the lock tests: `node environment-lock-child.mjs
// <state root> <control folder> <name>`. It waits for <control>/go, then checks; once inside the lock, its first Git
// call writes <control>/held-<name> and waits for <control>/release. No base, no docker: the project is not enrolled,
// so the check ends on DB_UNKNOWN. It prints one JSON line: {name,status,previous} or {name,error}.
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createEnvironmentCheck } from '../../src/environment-check.mjs';

const [root,control,name]=process.argv.slice(2);
const until=async(path,ms=20000)=>{const end=Date.now()+ms;while(!existsSync(path)){if(Date.now()>end)throw new Error('timeout '+path);await new Promise(r=>setTimeout(r,5));}};
const config={version:2,projects:[{key:'example',repos:[{path:join(control,'no-repo'),mainBranch:'main'}],environment:{database:{engine:'postgres',port:5461,name:'beta',user:'postgres'}}}]};
const invoke=async()=>{writeFileSync(join(control,'held-'+name),String(process.pid));await until(join(control,'release'));throw new Error('no repository');};
const check=createEnvironmentCheck({root,loadConfig:async()=>config,invoke,env:{}});
writeFileSync(join(control,'ready-'+name),String(process.pid));
await until(join(control,'go'));
try{const result=await check.check({project:'example'});console.log(JSON.stringify({name,status:result.status,cause:result.cause,previous:result.previous??null}));}
catch(error){console.log(JSON.stringify({name,error:error.code??String(error)}));}
