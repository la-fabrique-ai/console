import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import { join, basename } from 'node:path';
import { fixture } from './helpers/backend-fixture.mjs';
import { createConfigMigration, writeConfigBackup } from '../src/config-migration.mjs';
import { writeJSON } from '../src/common.mjs';

function observedFS(events, { afterSync, afterLink, failWrite } = {}) {
  return {
    ...fs,
    open: async (path, ...args) => {
      const handle = await fs.open(path, ...args);
      return new Proxy(handle, { get(target, key) {
        if (key === 'sync') return async () => {
          await target.sync(); events.push({ op: 'sync', path }); await afterSync?.(path);
        };
        if (key === 'writeFile') return async (...values) => {
          if (failWrite?.(path)) throw Object.assign(new Error('Fixture disk full'), { code: 'ENOSPC' });
          return target.writeFile(...values);
        };
        const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value;
      } });
    },
    link: async (source, dest) => { await fs.link(source, dest); events.push({ op: 'link', path: dest }); await afterLink?.(dest); },
    rename: async (source, dest) => {
      const value = JSON.parse(await fs.readFile(source, 'utf8'));
      await fs.rename(source, dest); events.push({ op: 'rename', path: dest, status: value.status });
    },
  };
}

test('migration forces backup, prepared journal, configuration and applied journal to disk in order', async t => {
  const f = await fixture(t), events = [];
  await createConfigMigration({ root: f.home, io: { fs: observedFS(events) } }).migrate({ confirmed: true, worktreesRoot: join(f.root, 'worktrees') });
  const find = (predicate, after = -1) => events.findIndex((event, index) => index > after && predicate(event));
  const backupFile = find(e => e.op === 'sync' && basename(e.path).startsWith('config-v1-'));
  const backupLink = find(e => e.op === 'link' && e.path.includes('/backups/'), backupFile);
  const backupDir = find(e => e.op === 'sync' && e.path === join(f.home, 'backups'), backupLink);
  const prepared = find(e => e.op === 'rename' && e.status === 'prepared', backupDir);
  const preparedDir = find(e => e.op === 'sync' && e.path === join(f.home, 'migrations'), prepared);
  const config = find(e => e.op === 'rename' && e.path === join(f.home, 'config.json'), preparedDir);
  const configDir = find(e => e.op === 'sync' && e.path === f.home, config);
  const applied = find(e => e.op === 'rename' && e.status === 'applied', configDir);
  const appliedDir = find(e => e.op === 'sync' && e.path === join(f.home, 'migrations'), applied);
  assert.ok([backupFile, backupLink, backupDir, prepared, preparedDir, config, configDir, applied, appliedDir].every(i => i >= 0), JSON.stringify(events));
  for (const publication of [prepared, config, applied]) assert.ok(events.slice(0, publication).some(e => e.op === 'sync' && e.path.startsWith(events[publication].path+'.')));
});

test('external edit during temporary configuration preparation is detected immediately before publication', async t => {
  const f = await fixture(t), original = await fs.readFile(join(f.home, 'config.json'), 'utf8');
  const edited = { ...f.config, projects: [{ ...f.config.projects[0], name: 'External edit' }] };
  let injected = false;
  const observed = observedFS([], { afterSync: async path => {
    if (basename(path).startsWith('config.json.') && path.endsWith('.tmp') && !injected) {
      injected = true; await fs.writeFile(join(f.home, 'config.json'), JSON.stringify(edited));
    }
  } });
  await assert.rejects(createConfigMigration({ root: f.home, io: { fs: observed } }).migrate({ confirmed: true, worktreesRoot: join(f.root, 'worktrees') }), { code: 'MIGRATION_CONFLICT' });
  assert.equal(injected, true); assert.equal((await f.read('config.json')).projects[0].name, 'External edit');
  const backup = (await fs.readdir(join(f.home, 'backups')))[0];
  assert.equal(await fs.readFile(join(f.home, 'backups', backup), 'utf8'), original);
  assert.equal((await f.read('migrations/config-v1-v2.json')).status, 'prepared');
});

test('disk full inside a configuration temporary write leaves V1 intact and migration resumable', async t => {
  const f = await fixture(t), original = await fs.readFile(join(f.home, 'config.json'), 'utf8');
  const observed = observedFS([], { failWrite: path => basename(path).startsWith('config.json.') });
  await assert.rejects(createConfigMigration({ root: f.home, io: { fs: observed } }).migrate({ confirmed: true, worktreesRoot: join(f.root, 'worktrees') }), { code: 'ENOSPC' });
  assert.equal(await fs.readFile(join(f.home, 'config.json'), 'utf8'), original);
  assert.equal((await f.read('migrations/config-v1-v2.json')).status, 'prepared');
  await createConfigMigration({ root: f.home }).migrate({ confirmed: true, worktreesRoot: join(f.root, 'worktrees') });
  assert.equal((await f.read('config.json')).version, 2);
});

test('backup publication detects a parent changed to a symlink after the link operation', async t => {
  const f = await fixture(t), folder = join(f.home, 'backups'); let injected = false;
  const observed = observedFS([], { afterLink: async () => {
    if (injected) return; injected = true;
    await fs.rename(folder, join(f.home, 'moved-backups'));
    await fs.symlink(join(f.home, 'moved-backups'), folder);
  } });
  await assert.rejects(writeConfigBackup(join(folder, 'fixture.json'), '{"fixture":true}\n', { fs: observed }), { code: 'UNSAFE_STORAGE' });
  assert.equal(injected, true);
});

test('a failed backup fsync never permits configuration replacement or a prepared journal', async t => {
  const f = await fixture(t), original = await fs.readFile(join(f.home, 'config.json'), 'utf8');
  const observed = observedFS([], { afterSync: async path => {
    if (basename(path).startsWith('config-v1-')) throw Object.assign(new Error('Fixture synchronization failure'), { code: 'EIO' });
  } });
  await assert.rejects(createConfigMigration({ root: f.home, io: { fs: observed } }).migrate({ confirmed: true, worktreesRoot: join(f.root, 'worktrees') }), { code: 'EIO' });
  assert.equal(await fs.readFile(join(f.home, 'config.json'), 'utf8'), original);
  assert.ok(!(await fs.readdir(f.home)).includes('migrations'));
});

test('resume forces an already published configuration to disk before marking the journal applied', async t => {
  const f = await fixture(t);
  const input = { confirmed: true, worktreesRoot: join(f.root, 'worktrees') };
  await assert.rejects(createConfigMigration({ root: f.home, io: { writeJSON: async (path, value) => {
    await writeJSON(path, value);
    if (path === join(f.home, 'config.json')) throw Object.assign(new Error('Fixture publication interruption'), { code: 'FIXTURE_PAUSE' });
  } } }).migrate(input), { code: 'FIXTURE_PAUSE' });
  const events = [];
  await createConfigMigration({ root: f.home, io: { fs: observedFS(events) } }).migrate(input);
  const sync = events.findIndex(e => e.op === 'sync' && e.path === join(f.home, 'config.json'));
  const directory = events.findIndex((e, i) => i > sync && e.op === 'sync' && e.path === f.home);
  const applied = events.findIndex(e => e.op === 'rename' && e.status === 'applied');
  assert.ok(sync >= 0 && directory > sync && applied > directory, JSON.stringify(events));
});
