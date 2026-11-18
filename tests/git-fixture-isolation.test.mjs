import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,writeFile,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const run=promisify(execFile);
for(const scope of ['global','system'])test(`Git fixtures ignore inherited ${scope} configuration`,async t=>{
  const root=await mkdtemp(join(tmpdir(),'fabrique-console-git-isolation-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const config=join(root,'fixture-config');await writeFile(config,'[fixture]\n personal = inherited-fixture-value\n');
  const env={...process.env,GIT_CONFIG_GLOBAL:scope==='global'?config:'/dev/null',GIT_CONFIG_SYSTEM:scope==='system'?config:'/dev/null',GIT_CONFIG_NOSYSTEM:'0'};
  let code=0;try{await run('git',['config','--get','fixture.personal'],{env,shell:false});}catch(error){code=error.code;}
  assert.equal(code,1,'The test Git launcher must not load either inherited configuration file.');
});
