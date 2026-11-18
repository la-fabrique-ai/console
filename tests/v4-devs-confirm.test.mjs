import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

// Decision 78: the approval button of the old Development screen opens the same confirmation box as the page of a
// ticket (screen 06); only « Approve and start » approves. No function lost: the button is offered where the box can
// be drawn, as on the page.
const source=name=>readFile(new URL('../'+name,import.meta.url),'utf8');

test('the old Development screen: its button opens the box of screen 06, Cancel writes nothing, only the confirmation approves',()=>{
  const root=fileURLToPath(new URL('..',import.meta.url));
  const child=spawnSync(process.execPath,['--experimental-vm-modules','--no-warnings',fileURLToPath(new URL('./helpers/devs-confirm-probe.mjs',import.meta.url)),root],{encoding:'utf8',timeout:20000});
  assert.equal(child.status,0,child.stderr+child.stdout);
  assert.match(child.stdout,/only the confirmation approves/);
});

test('one box for both screens: drawn by the shared file, built from pageConfirm, over the page while it can be drawn',async()=>{
  assert.match(await source('scripts/build-ui.mjs'),/V4_SHARED=\[[^\]]*'dialog\.js'/);
  for(const mod of ['mods/fabrique-console-v4-ticket/main.js','mods/fabrique-console-v4-devs/main.js']) {
    const main=await source(mod);
    assert.match(main,/import \{confirmDialog(,reasonField)?\} from '\.\/dialog\.js';/,mod);
    assert.match(main,/pageConfirm\(\{mission:m,lead\}\)/,mod);
    assert.equal((main.match(/api\(MOD,'mission-launch'/g)||[]).length,1,mod+': one call approves, behind the box');
  }
  const devs=await source('mods/fabrique-console-v4-devs/main.js');
  // Both of its approval buttons open the box; neither calls the engine itself.
  const buttons=devs.split('\n').filter(line=>line.includes("btn('launch-devs'"));
  assert.equal(buttons.length,2);for(const line of buttons){assert.match(line,/this\.launchDevs\(m,cx\)/);assert.match(line,/confirmable/);}
  assert.match(devs,/\.when\(Boolean\(confirm\),e=>e\.child\(this\.confirmBox\(m,confirm\)\)\)/);
});
