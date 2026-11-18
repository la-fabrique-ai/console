// The isolation suite of the trial mode (tests/trial-isolation.suite.mjs), run where it must run: in the sandbox of
// the trial launcher (scripts/trial.mjs), on a short folder of /private/tmp removed afterwards. Whatever the suite does,
// even after a regression, it can neither read nor write the real home: the sandbox refuses it. As a second proof,
// ~/Developer/worktrees and ~/.config/herdr-app are listed before and after (a new entry fails the test), and a
// listener of this test on 127.0.0.1, which the suite tries to reach, must never be reached.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { userInfo } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const real=userInfo().homedir,LAUNCHER=fileURLToPath(new URL('../scripts/trial.mjs',import.meta.url));
const watched=[join(real,'Developer','worktrees'),join(real,'.config','herdr-app'),join(real,'.config','herdr-app','mockups')];
function entries() {
  const seen=new Set(),list=dir=>{try{return readdirSync(dir,{withFileTypes:true});}catch{return [];}};
  for(const dir of watched)for(const entry of list(dir))seen.add(join(dir,entry.name));
  // One level more under ~/Developer/worktrees: a worktree lands at <project>/<name>.
  for(const dir of list(watched[0]))if(dir.isDirectory())for(const entry of list(join(watched[0],dir.name)))seen.add(join(watched[0],dir.name,entry.name));
  return seen;
}
const launch=(folder,command)=>new Promise((resolve,reject)=>{
  const child=spawn(process.execPath,[LAUNCHER,folder,'--',...command],{stdio:['ignore','pipe','pipe']});
  let said='';child.stdout.on('data',d=>{said+=d;});child.stderr.on('data',d=>{said+=d;});
  child.once('error',reject);child.once('close',code=>resolve({code,said}));
});

test('the trial isolation suite passes in the sandbox of the launcher and leaves the real home untouched',async t=>{
  const parent=realpathSync(mkdtempSync('/private/tmp/dvt-'));
  t.after(()=>rmSync(parent,{recursive:true,force:true}));
  const folder=join(parent,'e'),before=entries();
  let hits=0;const server=createServer((req,res)=>{hits++;res.end('real');});
  await new Promise(done=>server.listen(0,'127.0.0.1',done));t.after(()=>server.close());
  // A first run makes the folder of the trial; the port of the listener is then given to the suite through it.
  const made=await launch(folder,['/usr/bin/true']);
  assert.equal(made.code,0,made.said);
  writeFileSync(join(folder,'canary.json'),JSON.stringify({http:{port:server.address().port}}));
  const {code,said}=await launch(folder,[process.execPath,'--test',join(folder,'mc','tests','trial-isolation.suite.mjs')]);
  assert.deepEqual([...entries()].filter(path=>!before.has(path)),[],'new entries under the real home');
  assert.equal(hits,0,'the listener of the test was reached from the trial');
  assert.equal(code,0,'the isolation suite failed:\n'+said);
  assert.match(said,/(ℹ|#) fail 0\b/);
});
