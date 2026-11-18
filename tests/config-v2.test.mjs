import test from 'node:test';
import assert from 'node:assert/strict';
import * as configuration from '../src/config.mjs';
import { configV2 } from './helpers/config-v2-fixture.mjs';

test('V2 validates several explicit repositories, aliases, scopes and model profiles without losing fields', () => {
  const input = configV2();
  const expected=structuredClone(input);expected.owner={id:'owner',displayName:'Responsable'};expected.ticketConnector='primary';
  Object.assign(expected.projects[0],{icon:'folder',leadLayout:'generic',ticketScope:{connection:'primary',scopeId:input.projects[0].projectId}});
  assert.deepEqual(JSON.parse(JSON.stringify(configuration.validateConfig(input))), expected);
  assert.equal(input.projects[0].repos[0].aliases.length, 2);
});

test('V2 mono-repository accepts no labels and marks unverified mapping by default', () => {
  const input = configV2(); input.projects[0].repos.splice(1);
  delete input.projects[0].repos[0].labels; delete input.projects[0].repos[0].aliases; delete input.projects[0].repos[0].verification;
  const repo = configuration.validateConfig(input).projects[0].repos[0];
  assert.deepEqual(repo.labels, []); assert.deepEqual(repo.aliases, []); assert.equal(repo.verification, 'required');
});

const invalid = [
  ['relative worktree root', c => { c.worktreesRoot = '../escape'; }],
  ['remote machine before remote support', c => { c.projects[0].machine = 'ai-dev'; }],
  ['unknown kind', c => { c.projects[0].kind = 'anything'; }],
  ['invalid color', c => { c.projects[0].color = 'red; code()'; }],
  ['unknown top-level field', c => { c.program = '/bin/sh'; }],
  ['missing repos', c => { delete c.projects[0].repos; }],
  ['relative repository', c => { c.projects[0].repos[0].path = 'app'; }],
  ['duplicate project key', c => { c.projects.push(structuredClone(c.projects[0])); }],
  ['duplicate repository key', c => { c.projects[0].repos[1].key = 'app'; }],
  ['invalid alias', c => { c.projects[0].repos[0].aliases = ['']; }],
  ['option-like branch', c => { c.projects[0].repos[0].mainBranch = '--force'; }],
  ['shell QA wrapper', c => { c.projects[0].repos[0].tests.quick.argv = ['sh', '-c', 'false']; }],
  ['invalid QA terminal', c => { c.projects[0].repos[0].tests.quick.terminal = 'yes'; }],
  ['invalid WIP', c => { c.wip.dev = -1; }],
  ['invalid concurrency', c => { c.wip.maxParallelDevs = 0; }],
  ['unknown confirmation', c => { c.launch.confirm = 'never'; }],
  ['missing model profiles', c => { delete c.profiles; }],
  ['unlisted model', c => { c.profiles.dev.codex.standard.model = 'arbitrary-model'; }],
  ['model from another family', c => { c.profiles.dev.codex.standard.model = 'claude-opus-5-5'; }],
  ['unlisted effort', c => { c.profiles.dev.codex.standard.effort = 'unbounded'; }],
  ['profile executable injection', c => { c.profiles.dev.codex.standard.argv = ['sh']; }],
  ['unlisted role', c => { c.profiles.admin = {}; }],
  ['unlisted level', c => { c.profiles.dev.codex.custom = c.profiles.dev.codex.standard; }],
];
for (const [name, mutate] of invalid) test(`V2 rejects ${name}`, () => {
  const input = configV2(); mutate(input);
  assert.throws(() => configuration.validateConfig(input), { code: 'INVALID_CONFIG' });
});

test('V2 permits explicit wave configuration and empty unconfigured profiles without authorizing a launch', () => {
  const input = configV2(); input.launch.confirm = 'wave'; input.profiles = { version: 'unconfigured', dev: {}, review: {} };
  assert.equal(configuration.validateConfig(input).launch.confirm, 'wave');
});
