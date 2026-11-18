import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fixture, issue } from './helpers/backend-fixture.mjs';
import { configV2 } from './helpers/config-v2-fixture.mjs';

function nativeConfig(f, multi = false) {
  const c = configV2(); c.projects[0].projectId = 'characterization-project';
  c.projects[0].repos[0].path = f.repo;
  c.projects[0].repos[0].tests = f.config.projects[0].tests;
  if (!multi) c.projects[0].repos.splice(1);
  return c;
}

test('V2 read-config remains complete and save preserves aliases and model tables', async t => {
  const f = await fixture(t), config = nativeConfig(f);
  await f.backend.dispatch('config-migrate', { confirmed: true, worktreesRoot: '/example/worktrees' });
  const { revision } = await f.backend.dispatch('read-config');
  const result = await f.backend.dispatch('config-save', { config, baseRevision: revision });
  assert.equal(result.config.version, 2);
  const read = await f.backend.dispatch('read-config');
  assert.deepEqual(read.config.projects[0].repos[0].aliases, ['packages', 'infra']);
  assert.equal(read.config.profiles.review.codex.standard.model, 'gpt-6.1-sol');
  assert.equal(read.config.worktreesRoot, '/example/worktrees');
  const snapshot = await f.backend.dispatch('snapshot');
  assert.equal(snapshot.config.version, 2);
  assert.equal(snapshot.projects[0].repo, f.repo);
  assert.equal(snapshot.projects[0].mainBranch, 'main');
  assert.equal(snapshot.projects[0].preferredAgent, 'codex');
  assert.equal(snapshot.projects[0].tests.unit.terminal, false);
});

test('V2 multi-repo projection never guesses a repository and QA uses the exact legacy session path', async t => {
  const f = await fixture(t), { session } = await f.backend.dispatch('launch', { issueId: issue.id, tool: 'codex' });
  await f.write('config.json', nativeConfig(f, true));
  const snapshot = await f.backend.dispatch('snapshot');
  assert.equal(snapshot.projects[0].repo, null);
  assert.deepEqual(snapshot.projects[0].tests, {});
  assert.equal(snapshot.projects[0].repos.length, 2);
  assert.equal(snapshot.sessions[0].id, session.id);
  const result = await f.backend.dispatch('qa', { sessionId: session.id, profile: 'unit' });
  assert.equal(result.run.status, 'passed');
  const c = nativeConfig(f, true); c.projects[0].repos[0].path = '/example/changed'; await f.write('config.json', c);
  await assert.rejects(f.backend.dispatch('qa', { sessionId: session.id }), { code: 'MAPPING_CHANGED' });
});

test('V2 configuration cannot silently lose fields through an old or incomplete save', async t => {
  const f = await fixture(t), c = nativeConfig(f); await f.write('config.json', c);
  const before = await readFile(f.home+'/config.json', 'utf8');
  await assert.rejects(f.backend.dispatch('config-save', { config: f.config }), { code: 'STALE_CONFIG_VERSION' });
  const truncated = structuredClone(c); delete truncated.profiles;
  await assert.rejects(f.backend.dispatch('config-save', { config: truncated }), { code: 'INVALID_CONFIG' });
  const unknown = structuredClone(c); unknown.newerSchemaField = 'must not be dropped';
  await assert.rejects(f.backend.dispatch('config-save', { config: unknown }), { code: 'INVALID_CONFIG' });
  assert.equal(await readFile(f.home+'/config.json', 'utf8'), before);
});
