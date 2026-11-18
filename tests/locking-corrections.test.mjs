import test from 'node:test';
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, writeFile, rm, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fixture } from './helpers/backend-fixture.mjs';
import { withLock } from '../src/common.mjs';

function worker(t, root, mode, migration = false) {
  const child = fork(new URL(migration ? './helpers/migration-process.mjs' : './helpers/locking-process.mjs', import.meta.url), [root, mode, join(root, 'worktrees')], { silent: true });
  const messages = []; child.on('message', value => messages.push(value));
  t.after(() => { if (child.exitCode === null) child.kill('SIGKILL'); });
  const until = async key => {
    const deadline = Date.now()+4000;
    while (!messages.some(value => value[key])) {
      assert.ok(!messages.some(value => value.error), JSON.stringify(messages));
      if (Date.now() > deadline) throw new Error('Timed out waiting for '+key+': '+JSON.stringify(messages));
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    return messages;
  };
  return { child, until };
}

test('SIGKILL before publishing an owner cannot leave an indefinitely busy legacy lock', async t => {
  const f = await fixture(t), w = worker(t, f.home, 'orphan'); await w.until('ready');
  const dead = once(w.child, 'exit'); w.child.kill('SIGKILL'); await dead;
  let entered = false; await withLock(f.home, async () => { entered = true; });
  assert.equal(entered, true);
});

test('missing lockf executable fails explicitly instead of running an unlocked task', async t => {
  const f = await fixture(t);
  await assert.rejects(withLock(f.home, async () => assert.fail('Unlocked task ran'), { lockf: '/fixture/missing-lockf' }), { code: 'STORAGE_ERROR' });
});

test('SIGKILL inside the critical section releases ownership and lets another process proceed', async t => {
  const f = await fixture(t), first = worker(t, f.home, 'hold'); await first.until('ready'); first.child.send('start'); await first.until('entered');
  await assert.rejects(withLock(f.home, async () => assert.fail('Entered occupied lock')), { code: 'BUSY' });
  const dead = once(first.child, 'exit'); first.child.kill('SIGKILL'); await dead;
  // The test-owned marker is intentionally separate from lock recovery.
  await rm(join(f.home, 'critical'), { recursive: true });
  const second = worker(t, f.home, 'once'); await second.until('ready'); second.child.send('start'); await second.until('done');
});

test('two real processes recovering the same dead owner never overlap or delete a successor lock', async t => {
  const f = await fixture(t), dead = worker(t, f.home, 'orphan'); await dead.until('ready');
  const exited = once(dead.child, 'exit'); dead.child.kill('SIGKILL'); await exited;
  await writeFile(join(f.home, 'operation.lock', 'owner.json'), JSON.stringify({ pid: dead.child.pid }));
  const workers = [worker(t, f.home, 'once'), worker(t, f.home, 'once')];
  await Promise.all(workers.map(w => w.until('ready'))); workers.forEach(w => w.child.send('start'));
  await Promise.all(workers.map(w => w.until('done')));
  assert.equal((await readdir(f.home)).filter(name => name.startsWith('owner-observed-')).length, 2);
});

test('two real processes resume the same prepared migration after its owner is killed', async t => {
  const f = await fixture(t), preparing = worker(t, f.home, 'prepare', true);
  await preparing.until('ready'); preparing.child.send('start'); await preparing.until('prepared');
  const exited = once(preparing.child, 'exit'); preparing.child.kill('SIGKILL'); await exited;
  const workers = [worker(t, f.home, 'resume', true), worker(t, f.home, 'resume', true)];
  await Promise.all(workers.map(w => w.until('ready'))); workers.forEach(w => w.child.send('start'));
  await Promise.all(workers.map(w => w.until('done')));
  assert.equal((await f.read('config.json')).version, 2);
  assert.equal((await f.read('migrations/config-v1-v2.json')).status, 'applied');
  assert.equal((await readdir(join(f.home, 'backups'))).length, 1);
});
