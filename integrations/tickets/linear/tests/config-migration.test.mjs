import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, readdir, stat, mkdir, rename, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { writeJSON } from '../../../../src/common.mjs';
import { fixture, issue } from '../../../../tests/helpers/backend-fixture.mjs';

const options = f => ({ confirmed: true, worktreesRoot: join(f.root, 'new-worktrees') });
const journalPath = f => join(f.home, 'migrations', 'config-v1-v2.json');
const digest = text => createHash('sha256').update(text).digest('hex');

test('migration is explicit, keeps exact private backup and does not run on configuration reads', async t => {
  const f = await fixture(t);
  const original = JSON.stringify({ ...f.config, tracker: { transport: 'mcp', endpoint: 'https://mcp.linear.app/mcp' } }, null, 4)+'\n';
  await writeFile(join(f.home, 'config.json'), original);
  await f.backend.dispatch('read-config');
  assert.equal(await readFile(join(f.home, 'config.json'), 'utf8'), original);
  await assert.rejects(stat(journalPath(f)), { code: 'ENOENT' });
  await assert.rejects(f.backend.dispatch('config-migrate', { worktreesRoot: '/example/worktrees' }), { code: 'CONFIRMATION_REQUIRED' });
  const result = await f.backend.dispatch('config-migrate', options(f));
  assert.equal(result.status, 'migrated'); assert.equal(result.config.version, 2);
  assert.equal(result.sourceHash, digest(original));
  assert.equal(await readFile(result.backupPath, 'utf8'), original);
  assert.equal((await stat(result.backupPath)).mode & 0o777, 0o600);
  assert.equal((await stat(join(f.home, 'backups'))).mode & 0o777, 0o700);
  assert.equal(result.config.tracker.endpoint, 'https://mcp.linear.app/mcp');
  assert.equal(result.config.projects[0].projectId, 'characterization-project');
  assert.equal(result.config.projects[0].preferredAgent, 'codex');
  assert.equal(result.config.projects[0].repos.length, 1);
  assert.equal(result.config.projects[0].repos[0].key, 'legacy');
  assert.equal(result.config.projects[0].repos[0].path, f.repo);
  assert.equal(result.config.projects[0].repos[0].verification, 'required');
  assert.equal(result.config.projects[0].repos[0].tests.unit.terminal, false);
});

test('repeat migration neither rewrites files nor substitutes changed migration options', async t => {
  const f = await fixture(t), first = await f.backend.dispatch('config-migrate', options(f));
  const before = await Promise.all([first.backupPath, journalPath(f), join(f.home, 'config.json')].map(p => readFile(p, 'utf8')));
  const second = await f.backend.dispatch('config-migrate', { ...options(f), worktreesRoot: '/different/new-root' });
  assert.equal(second.status, 'already-migrated');
  const after = await Promise.all([first.backupPath, journalPath(f), join(f.home, 'config.json')].map(p => readFile(p, 'utf8')));
  assert.deepEqual(after, before);
});

for (const checkpoint of ['backup', 'prepared', 'config', 'applied']) test(`migration resumes after interruption immediately after ${checkpoint}`, async t => {
  const f = await fixture(t), original = await readFile(join(f.home, 'config.json'), 'utf8');
  const { createConfigMigration, writeConfigBackup } = await import('../../../../src/config-migration.mjs');
  let injected = false;
  const crash = name => { if (name === checkpoint && !injected) { injected = true; throw Object.assign(new Error('Fixture interruption'), { code: 'FIXTURE_INTERRUPTION' }); } };
  const migration = createConfigMigration({ root: f.home, io: {
    writeBackup: async (...args) => { await writeConfigBackup(...args); crash('backup'); },
    writeJSON: async (path, value) => {
      await writeJSON(path, value);
      crash(path === join(f.home, 'config.json') ? 'config' : value.status);
    },
  } });
  await assert.rejects(migration.migrate(options(f)), { code: 'FIXTURE_INTERRUPTION' });
  assert.equal(injected, true);
  const current = await f.read('config.json');
  assert.equal(current.version, ['config', 'applied'].includes(checkpoint) ? 2 : 1);
  const recovered = await createConfigMigration({ root: f.home }).migrate(options(f));
  assert.equal(recovered.config.version, 2);
  assert.equal(await readFile(recovered.backupPath, 'utf8'), original);
  assert.equal(JSON.parse(await readFile(journalPath(f), 'utf8')).status, 'applied');
  let writes = 0;
  await createConfigMigration({ root: f.home, io: { writeJSON: async () => { writes++; }, writeBackup: async () => { writes++; } } }).migrate(options(f));
  assert.equal(writes, 0);
});

test('migration keeps team scope, sessions, QA, worktrees and mutation journals unchanged', async t => {
  const f = await fixture(t); f.config.projects[0].teamId = 'characterization-team'; await f.write('config.json', f.config);
  const { session } = await f.backend.dispatch('launch', { issueId: issue.id, tool: 'codex' });
  const { run } = await f.backend.dispatch('qa', { sessionId: session.id });
  const payload = { issueId: issue.id, comment: 'Fixture approval' };
  await f.backend.dispatch('ticket-mutate', { confirmed: true, confirmedPayload: payload, payload });
  const mutation = (await readdir(join(f.home, 'mutations')))[0];
  const paths = [join(f.home, 'state.json'), join(f.home, 'qa', run.id+'.json'), join(f.home, 'mutations', mutation), join(session.worktree, '.git')];
  const before = await Promise.all(paths.map(p => readFile(p, 'utf8')));
  const result = await f.backend.dispatch('config-migrate', options(f));
  assert.equal(result.config.projects[0].teamId, 'characterization-team');
  assert.deepEqual(await Promise.all(paths.map(p => readFile(p, 'utf8'))), before);
  const snapshot = await f.backend.dispatch('snapshot');
  assert.equal(snapshot.config.version, 2); assert.equal(snapshot.projects[0].repo, f.repo);
  assert.equal(snapshot.projects[0].tests.unit.terminal, false);
  assert.equal(snapshot.sessions[0].id, session.id); assert.equal(snapshot.sessions[0].worktree, session.worktree);
  const qa = await f.backend.dispatch('qa', { sessionId: session.id });
  assert.equal(qa.run.status, 'passed');
  await assert.rejects(f.backend.dispatch('launch', { issueId: issue.id, tool: 'codex', resume: true }), { code: 'CONFIG_V2_LAUNCH_UNAVAILABLE' });
});

test('stale V1 save cannot replace or truncate a migrated V2 configuration', async t => {
  const f = await fixture(t); await f.backend.dispatch('config-migrate', options(f));
  const before = await readFile(join(f.home, 'config.json'), 'utf8');
  await assert.rejects(f.backend.dispatch('config-save', { config: f.config }), { code: 'STALE_CONFIG_VERSION' });
  assert.equal(await readFile(join(f.home, 'config.json'), 'utf8'), before);
});

test('invalid and unsupported V1 configurations cannot create a partial migration', async t => {
  const f = await fixture(t);
  for (const [source, code] of [
    [{ version: 1, projects: [{}] }, 'INVALID_CONFIG'],
    [{ ...f.config, undocumented: 'must not disappear' }, 'MIGRATION_UNSUPPORTED_FIELDS'],
  ]) {
    await f.write('config.json', source);
    const before = await readFile(join(f.home, 'config.json'), 'utf8');
    await assert.rejects(f.backend.dispatch('config-migrate', options(f)), { code });
    assert.equal(await readFile(join(f.home, 'config.json'), 'utf8'), before);
    await assert.rejects(stat(journalPath(f)), { code: 'ENOENT' });
  }
});

test('migration refuses a changed source after prepare instead of overwriting it', async t => {
  const f = await fixture(t), { createConfigMigration } = await import('../../../../src/config-migration.mjs');
  const migration = createConfigMigration({ root: f.home, io: { writeJSON: async (path, value) => {
    await writeJSON(path, value);
    if (value.status === 'prepared') throw Object.assign(new Error('Fixture interruption'), { code: 'FIXTURE_INTERRUPTION' });
  } } });
  await assert.rejects(migration.migrate(options(f)), { code: 'FIXTURE_INTERRUPTION' });
  const changed = { ...f.config, projects: [{ ...f.config.projects[0], name: 'Changed externally' }] };
  await f.write('config.json', changed);
  await assert.rejects(createConfigMigration({ root: f.home }).migrate(options(f)), { code: 'MIGRATION_CONFLICT' });
  assert.equal((await f.read('config.json')).projects[0].name, 'Changed externally');
  await assert.rejects(f.backend.dispatch('config-save', { config: f.config }), { code: 'MIGRATION_PENDING' });
});

test('migration verifies an existing backup instead of replacing its contents', async t => {
  const f = await fixture(t), raw = await readFile(join(f.home, 'config.json'), 'utf8');
  await mkdir(join(f.home, 'backups'));
  const path = join(f.home, 'backups', `config-v1-${digest(raw)}.json`);
  await writeFile(path, '{"different":true}\n');
  await assert.rejects(f.backend.dispatch('config-migrate', options(f)), { code: 'MIGRATION_CONFLICT' });
  assert.equal(await readFile(path, 'utf8'), '{"different":true}\n');
  assert.equal((await f.read('config.json')).version, 1);
});

test('resuming migration refuses a backup parent replaced by a symlink', async t => {
  const f = await fixture(t), { createConfigMigration } = await import('../../../../src/config-migration.mjs');
  await assert.rejects(createConfigMigration({ root: f.home, io: { writeJSON: async (path, value) => {
    await writeJSON(path, value);
    if (value.status === 'prepared') throw Object.assign(new Error('Fixture interruption'), { code: 'FIXTURE_INTERRUPTION' });
  } } }).migrate(options(f)), { code: 'FIXTURE_INTERRUPTION' });
  const moved = join(f.root, 'moved-backups'); await rename(join(f.home, 'backups'), moved);
  await symlink(moved, join(f.home, 'backups'));
  await assert.rejects(createConfigMigration({ root: f.home }).migrate(options(f)), { code: 'UNSAFE_STORAGE' });
  assert.equal((await f.read('config.json')).version, 1);
});

test('prepared migration refuses changed options and a tampered target without overwriting either', async t => {
  const f = await fixture(t), { createConfigMigration } = await import('../../../../src/config-migration.mjs');
  await assert.rejects(createConfigMigration({ root: f.home, io: { writeJSON: async (path, value) => {
    await writeJSON(path, value);
    if (path === join(f.home, 'config.json')) throw Object.assign(new Error('Fixture interruption'), { code: 'FIXTURE_INTERRUPTION' });
  } } }).migrate(options(f)), { code: 'FIXTURE_INTERRUPTION' });
  await assert.rejects(createConfigMigration({ root: f.home }).migrate({ ...options(f), worktreesRoot: '/another/root' }), { code: 'MIGRATION_CONFLICT' });
  const changed = await f.read('config.json'); changed.projects[0].color = '#abcdef'; await f.write('config.json', changed);
  await assert.rejects(createConfigMigration({ root: f.home }).migrate(options(f)), { code: 'MIGRATION_CONFLICT' });
  assert.equal((await f.read('config.json')).projects[0].color, '#abcdef');
});

test('GraphQL endpoint and later valid V2 edits survive migration and repeated calls', async t => {
  const f = await fixture(t);
  await f.write('config.json', { ...f.config, tracker: { transport: 'graphql', endpoint: 'https://api.linear.app/graphql' } });
  const result = await f.backend.dispatch('config-migrate', options(f));
  assert.deepEqual(result.config.tracker, { transport: 'graphql', endpoint: 'https://api.linear.app/graphql' });
  const changed = result.config; changed.projects[0].color = '#abcdef';
  const { revision } = await f.backend.dispatch('read-config');
  await f.backend.dispatch('config-save', { config: changed, baseRevision: revision });
  const repeated = await f.backend.dispatch('config-migrate', options(f));
  assert.equal(repeated.status, 'already-migrated'); assert.equal(repeated.config.projects[0].color, '#abcdef');
});

test('concurrent migration calls never write conflicting configurations or backups', async t => {
  const f = await fixture(t);
  const results = await Promise.allSettled([f.backend.dispatch('config-migrate', options(f)), f.backend.dispatch('config-migrate', options(f))]);
  assert.ok(results.some(v => v.status === 'fulfilled'));
  for (const result of results) if (result.status === 'rejected') assert.equal(result.reason.code, 'BUSY');
  assert.equal((await f.read('config.json')).version, 2);
  assert.equal((await readdir(join(f.home, 'backups'))).length, 1);
  assert.equal(JSON.parse(await readFile(journalPath(f), 'utf8')).status, 'applied');
});

test('migration resumes a journal created before owner and project metadata existed',async t=>{
 const f=await fixture(t);
 const {createConfigMigration}=await import('../../../../src/config-migration.mjs');
 const {canonical}=await import('../../../../src/common.mjs');
 const {revisionOf}=await import('../../../../src/durable-storage.mjs');
 const interrupted=createConfigMigration({root:f.home,io:{writeJSON:async(path,value)=>{
   await writeJSON(path,value);if(path===journalPath(f))throw new Error('interrupted');
 }}});
 await assert.rejects(interrupted.migrate(options(f)),/interrupted/);
 const journal=JSON.parse(await readFile(journalPath(f),'utf8'));
 delete journal.target.owner;delete journal.target.ticketConnector;
 for(const p of journal.target.projects){delete p.icon;delete p.leadLayout;delete p.ticketScope;}
 journal.targetHash=revisionOf(canonical(journal.target));
 await writeJSON(journalPath(f),journal);
 const result=await createConfigMigration({root:f.home}).migrate(options(f));
 assert.equal(result.status,'migrated');
 assert.equal(result.config.owner?.id,'owner');
 assert.equal((await f.backend.dispatch('snapshot')).config.owner.id,'owner');
 assert.equal((await f.read('config.json')).projects[0].repos[0].path,f.repo);
});
