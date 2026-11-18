import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { fixture, issue } from './helpers/backend-fixture.mjs';
import { configV2 } from './helpers/config-v2-fixture.mjs';
import { validateConfig } from '../src/config.mjs';
import { canonical } from '../src/common.mjs';
import { createConfigMigration } from '../src/config-migration.mjs';

const migrate = f => f.backend.dispatch('config-migrate', { confirmed: true, worktreesRoot: join(f.root, 'worktrees') });

test('config-save cannot replace V1 by V2 even with an empty valid project list', async t => {
  const f = await fixture(t), before = await readFile(join(f.home, 'config.json'), 'utf8');
  const config = configV2(); config.projects = [];
  await assert.rejects(f.backend.dispatch('config-save', { config }), { code: 'MIGRATION_REQUIRED' });
  assert.equal(await readFile(join(f.home, 'config.json'), 'utf8'), before);
});

test('V2 save requires its current read revision and refuses a stale but valid complete document', async t => {
  const f = await fixture(t); await migrate(f);
  const first = await f.backend.dispatch('read-config');
  assert.match(first.revision, /^[a-f0-9]{64}$/);
  const firstRaw = await readFile(join(f.home, 'config.json'), 'utf8');
  const second = structuredClone(first.config); second.projects[0].name = 'New name';
  await assert.rejects(f.backend.dispatch('config-save', { config: second }), { code: 'BASE_REVISION_REQUIRED' });
  const saved = await f.backend.dispatch('config-save', { config: second, baseRevision: first.revision });
  assert.notEqual(saved.revision, first.revision);
  const stale = structuredClone(first.config); stale.projects = [];
  await assert.rejects(f.backend.dispatch('config-save', { config: stale, baseRevision: first.revision }), { code: 'CONFIG_CONFLICT' });
  assert.equal((await f.backend.dispatch('read-config')).config.projects[0].name, 'New name');
  const backups = await readdir(join(f.home, 'backups'));
  assert.ok(backups.includes('config-save-'+first.revision+'.json'));
  assert.equal(await readFile(join(f.home, 'backups', 'config-save-'+first.revision+'.json'), 'utf8'), firstRaw);
});

test('absent configuration has null revision and permits an explicitly based initial V2 save', async t => {
  const f = await fixture(t, { configured: false });
  assert.equal((await f.backend.dispatch('read-config')).revision, null);
  const config = configV2(); config.projects = [];
  const saved = await f.backend.dispatch('config-save', { config, baseRevision: null });
  assert.equal(saved.config.version, 2); assert.match(saved.revision, /^[a-f0-9]{64}$/);
});

test('V1 reads expose their raw-byte revision while saves keep their legacy compatibility', async t => {
  const f = await fixture(t);
  assert.equal((await f.backend.dispatch('read-config')).revision, createHash('sha256').update(await readFile(join(f.home, 'config.json'))).digest('hex'));
  f.config.projects[0].name = 'Legacy save';
  assert.equal((await f.backend.dispatch('config-save', { config: f.config })).config.projects[0].name, 'Legacy save');
});

test('a second real editor process cannot replace a V2 saved after both editors read it', async t => {
  const f = await fixture(t); await migrate(f);
  const start = () => {
    const child = fork(new URL('./helpers/config-save-process.mjs', import.meta.url), [f.home], { silent: true });
    t.after(() => { if (child.exitCode === null) child.kill('SIGKILL'); });
    return child;
  };
  const first = start(), second = start();
  const [a, b] = await Promise.all([once(first, 'message'), once(second, 'message')]);
  assert.equal(a[0].revision, b[0].revision);
  const saved = once(first, 'message'); first.send('First editor'); assert.deepEqual((await saved)[0], { done: true });
  const rejected = once(second, 'message'); second.send('Stale editor');
  assert.deepEqual((await rejected)[0], { done: true, error: 'CONFIG_CONFLICT' });
  assert.equal((await f.read('config.json')).projects[0].name, 'First editor');
});

for (const spelling of ['symlink', 'dot']) test(`existing QA and report mapping survive conversion of a ${spelling} path`, async t => {
  const f = await fixture(t);
  const alias = join(f.root, 'alias');
  if (spelling === 'symlink') await symlink(f.repo, alias);
  f.config.projects[0].repo = spelling === 'symlink' ? alias : f.repo+'/./';
  await f.write('config.json', f.config);
  const { session } = await f.backend.dispatch('launch', { issueId: issue.id, tool: 'codex' });
  assert.equal((await f.backend.dispatch('qa', { sessionId: session.id })).run.status, 'passed');
  await migrate(f);
  assert.equal((await f.backend.dispatch('qa', { sessionId: session.id })).run.status, 'passed');
  const state = await f.read('state.json'); delete state.sessions[0].mainBranch; await f.write('state.json', state);
  assert.equal((await f.backend.dispatch('propose', { sessionId: session.id })).pr.base, 'main');
  assert.equal((await f.read('state.json')).sessions[0].repo, session.repo);
});

test('pure V2 validation refuses different keys for normalized duplicate paths', () => {
  for (const path of ['/example/app', '/example/x/../app', '/example/app/./']) {
    const config = configV2(); config.projects[0].repos[1].path = path;
    assert.throws(() => validateConfig(config), { code: 'INVALID_CONFIG' });
  }
});

for (const kind of ['symlink', 'worktree']) test(`V2 save refuses duplicate physical Git identity through a ${kind}`, async t => {
  const f = await fixture(t); await migrate(f);
  const { config, revision } = await f.backend.dispatch('read-config');
  const alias = join(f.root, 'second-repo');
  if (kind === 'symlink') await symlink(f.repo, alias);
  else await f.command('git', ['-C', f.repo, 'worktree', 'add', '-b', 'fixture-other', alias]);
  config.projects[0].repos.push({ ...config.projects[0].repos[0], key: 'other', path: alias });
  const before = await readFile(join(f.home, 'config.json'), 'utf8');
  await assert.rejects(f.backend.dispatch('config-save', { config, baseRevision: revision }), { code: 'INVALID_CONFIG' });
  assert.equal(await readFile(join(f.home, 'config.json'), 'utf8'), before);
});

test('conversion rejects a dangling noncanonical repository before writing a migration journal', async t => {
  const f = await fixture(t); f.config.projects[0].repo = join(f.root, 'missing'); await f.write('config.json', f.config);
  await assert.rejects(migrate(f), { code: 'INVALID_CONFIG' });
  assert.equal((await f.read('config.json')).version, 1);
  assert.ok(!(await readdir(f.home)).includes('migrations'));
});

test('conversion allows two distinct V1 projects to share one physical repository', async t => {
  const f = await fixture(t);
  f.config.projects.push({ ...f.config.projects[0], key: 'other', projectId: 'other-project' });
  await f.write('config.json', f.config);
  const result = await migrate(f);
  assert.equal(result.config.projects.length, 2);
  assert.equal(result.config.projects[0].repos[0].path, f.repo);
  assert.equal(result.config.projects[1].repos[0].path, f.repo);
});

test('resuming a prepared target revalidates physical repository identities before publication', async t => {
  const f = await fixture(t), { writeJSON } = await import('../src/common.mjs');
  await assert.rejects(createConfigMigration({ root: f.home, io: { writeJSON: async (path, value) => {
    await writeJSON(path, value); if (value.status === 'prepared') throw Object.assign(new Error('Fixture pause'), { code: 'FIXTURE_PAUSE' });
  } } }).migrate({ confirmed: true, worktreesRoot: '/example/worktrees' }), { code: 'FIXTURE_PAUSE' });
  const alias = join(f.root, 'alias'); await symlink(f.repo, alias);
  const journal = await f.read('migrations/config-v1-v2.json');
  journal.target.projects[0].repos.push({ ...journal.target.projects[0].repos[0], key: 'alias', path: alias });
  journal.targetHash = createHash('sha256').update(canonical(journal.target)).digest('hex');
  await f.write('migrations/config-v1-v2.json', journal);
  await assert.rejects(migrate(f), { code: 'INVALID_CONFIG' });
  assert.equal((await f.read('config.json')).version, 1);
});

test('V2 validation rejects __proto__ as a QA profile instead of storing it', () => {
  const config = configV2();
  config.projects[0].repos[0].tests = JSON.parse('{"__proto__":{"argv":["node","--test"]}}');
  assert.throws(() => validateConfig(config), { code: 'INVALID_CONFIG' });
});
