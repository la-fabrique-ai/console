import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

// The probe runs the real Issue page class in a child process (vm modules need their flag).
test('the Issue page offers an answer only after a fresh read for that question succeeded',()=>{
  const root=fileURLToPath(new URL('..',import.meta.url));
  const child=spawnSync(process.execPath,['--experimental-vm-modules','--no-warnings',fileURLToPath(new URL('./helpers/issue-page-probe.mjs',import.meta.url)),root],{encoding:'utf8',timeout:20000});
  assert.equal(child.status,0,child.stderr||child.stdout);
  assert.match(child.stdout,/a failed refresh after a success offers nothing/);
});
