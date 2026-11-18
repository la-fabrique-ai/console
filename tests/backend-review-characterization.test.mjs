import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile, rename, symlink, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fixture, issue } from './helpers/backend-fixture.mjs';
import { runWorker } from '../src/qa-worker.mjs';

const start = f => f.backend.dispatch('launch', { issueId: issue.id, tool: 'codex' });

test('V1 review requires an implementation before creating a review branch or terminal', async t => {
  const f = await fixture(t);
  await assert.rejects(f.backend.dispatch('launch', { issueId: issue.id, tool: 'claude', review: true }), { code: 'REVIEW_SOURCE_REQUIRED' });
  assert.equal(f.calls.some(v => v.args[0] === 'run'), false);
  await assert.rejects(stat(join(f.home, 'state.json')), { code: 'ENOENT' });
});

test('V1 review captures committed HEAD and tracked patch, records reviewSource and sends review instructions', async t => {
  const f = await fixture(t), { session: dev } = await start(f);
  await writeFile(join(dev.worktree, 'tracked.txt'), 'committed\n');
  await f.command('git', ['-C', dev.worktree, 'add', 'tracked.txt']);
  await f.command('git', ['-C', dev.worktree, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'implementation']);
  const head = (await f.command('git', ['-C', dev.worktree, 'rev-parse', 'HEAD'])).stdout.trim();
  await writeFile(join(dev.worktree, 'tracked.txt'), 'pending\n');
  await writeFile(join(dev.worktree, 'untracked.txt'), 'excluded\n');
  const { session: review } = await f.backend.dispatch('launch', { issueId: issue.id, tool: 'claude', review: true });
  assert.equal(review.baseCommit, head); assert.notEqual(review.branch, dev.branch);
  assert.equal(await readFile(join(review.worktree, 'tracked.txt'), 'utf8'), 'pending\n');
  await assert.rejects(stat(join(review.worktree, 'untracked.txt')), { code: 'ENOENT' });
  assert.deepEqual({ ...review.reviewSource, snapshotAt: null }, {
    sessionId: dev.id, tool: 'codex', worktree: dev.worktree, branch: dev.branch,
    head, snapshotAt: null, trackedPatchApplied: true,
  });
  assert.ok(Number.isFinite(Date.parse(review.reviewSource.snapshotAt)));
  const args = f.calls.filter(v => v.args[0] === 'run').at(-1).args;
  assert.equal(args[args.indexOf('--') + 1], 'claude');
  assert.match(args.at(-1), /^Review this issue independently.*do not implement changes\./);
  assert.ok(args.at(-1).includes('Review source snapshot: '+JSON.stringify(review.reviewSource)));
  assert.ok(args.at(-1).includes('Untracked and ignored files were excluded.'));
  assert.equal((await f.read('state.json')).sessions[1].reviewSource.head, head);
});

for (const action of ['launch', 'qa']) test(`V1 ${action} rejects a changed repository mapping before another run`, async t => {
  const f = await fixture(t), { session } = await start(f);
  const other = join(f.root, 'other'); await mkdir(other);
  await f.command('git', ['init', '-b', 'main', other]);
  f.config.projects[0].repo = other; await f.write('config.json', f.config);
  f.setTerminals([]);
  const input = action === 'launch' ? { issueId: issue.id, tool: 'codex', resume: true } : { sessionId: session.id, profile: 'unit' };
  await assert.rejects(f.backend.dispatch(action, input), { code: 'MAPPING_CHANGED' });
  assert.equal(f.calls.filter(v => v.args[0] === 'run').length, 1);
});

for (const ambiguous of [false, true]) test(`V1 project selection rejects ${ambiguous ? 'ambiguous' : 'unmapped'} issues`, async t => {
  const f = await fixture(t);
  if (ambiguous) { f.config.projects.push({ ...f.config.projects[0], key: 'second' }); await f.write('config.json', f.config); }
  else f.tracker.detail = async () => ({ issue: { ...issue, project: null, team: { id: 'foreign-team' } } });
  await assert.rejects(start(f), { code: ambiguous ? 'AMBIGUOUS_PROJECT' : 'UNMAPPED_PROJECT' });
  assert.equal(f.calls.some(v => v.args[0] === 'run'), false);
});

for (const action of ['launch', 'stop']) test(`V1 ${action} refuses a terminal address reassigned to another session`, async t => {
  const f = await fixture(t), { session } = await start(f);
  f.setTerminals([{ id: session.terminalId, state: 'live', reported: true, status: 'working', labels: { 'fabrique-console.app': 'fabrique-console', 'fabrique-console.session': 'another-session' } }]);
  const input = action === 'launch' ? { issueId: issue.id, tool: 'codex', resume: true } : { sessionId: session.id, confirmed: true };
  await assert.rejects(f.backend.dispatch(action, input), { code: 'TERMINAL_OWNERSHIP' });
  assert.equal(f.calls.some(v => v.args[0] === 'kill'), false);
});

test('V1 live launch is reused and historical launch requires explicit resume', async t => {
  const f = await fixture(t), first = await start(f), reused = await start(f);
  assert.equal(reused.reused, true); assert.equal(reused.session.id, first.session.id);
  assert.equal(f.calls.filter(v => v.args[0] === 'run').length, 1);
  f.setTerminals([]);
  await assert.rejects(start(f), { code: 'RESUME_REQUIRED' });
});

test('V1 terminal QA keeps worker argv and independent metadata until the real worker finishes', async t => {
  const f = await fixture(t); f.config.projects[0].tests.unit.terminal = true; await f.write('config.json', f.config);
  const { session } = await start(f), { run } = await f.backend.dispatch('qa', { sessionId: session.id, profile: 'unit' });
  assert.equal(run.execution, 'terminal'); assert.equal(run.status, 'running'); assert.equal(run.terminalId, 't2');
  const args = f.calls.filter(v => v.args[0] === 'run').at(-1).args;
  assert.deepEqual(args.slice(args.indexOf('--') + 1), [process.execPath, fileURLToPath(new URL('../src/qa-worker.mjs', import.meta.url)), f.home, run.id]);
  assert.deepEqual(await f.read(`qa/${run.id}.terminal.json`), { terminalId: 't2' });
  const result = await runWorker(f.home, run.id);
  assert.equal(result.status, 'passed'); assert.equal(result.stdout, 'fixture-result\n');
  assert.equal((await f.backend.dispatch('snapshot')).sessions[0].qa.terminalId, 't2');
});

for (const uncertain of [false, true]) test(`V1 QA rejects a ${uncertain ? 'lost and uncertain' : 'still running'} previous worker`, async t => {
  const f = await fixture(t); f.config.projects[0].tests.unit.terminal = true; await f.write('config.json', f.config);
  const { session } = await start(f), { run } = await f.backend.dispatch('qa', { sessionId: session.id });
  if (uncertain) { f.setTerminals([]); await rm(join(f.home, 'qa', `${run.id}.terminal.json`)); }
  await assert.rejects(f.backend.dispatch('qa', { sessionId: session.id }), { code: uncertain ? 'QA_UNCERTAIN' : 'QA_RUNNING' });
  assert.equal(f.calls.filter(v => v.args[0] === 'run').length, 2);
});

for (const code of ['WORKTREE_MISSING', 'UNSAFE_WORKTREE', 'WORKTREE_CHANGED']) test(`V1 Git inspection rejects ${code}`, async t => {
  const f = await fixture(t), { session } = await start(f);
  if (code === 'WORKTREE_CHANGED') await f.command('git', ['-C', session.worktree, 'switch', '-c', 'different-branch']);
  else {
    const moved = session.worktree+'-moved'; await rename(session.worktree, moved);
    if (code === 'UNSAFE_WORKTREE') await symlink(moved, session.worktree);
  }
  await assert.rejects(f.backend.dispatch('git', { sessionId: session.id }), { code });
});

test('V1 launch refuses an unmanaged worktree at its deterministic path', async t => {
  const f = await fixture(t);
  await mkdir(join(f.home, 'worktrees', 'example-44dc305e9514d6c9'), { recursive: true });
  await assert.rejects(start(f), { code: 'WORKTREE_COLLISION' });
  assert.equal(f.calls.some(v => v.args[0] === 'run'), false);
});

test('V1 state mutations verify the issue team before journaling and writing', async t => {
  const f = await fixture(t), payload = { issueId: issue.id, stateId: 'todo-state' };
  const input = { payload, confirmedPayload: payload, confirmed: true };
  assert.deepEqual(await f.backend.dispatch('ticket-mutate', input), { success: true });
  assert.deepEqual(f.trackerCalls, [['detail', issue.id, { refresh: true }], ['meta', { refresh: true }], ['mutate', payload]]);
  const rejected = { ...payload, stateId: 'foreign-state' };
  await assert.rejects(f.backend.dispatch('ticket-mutate', { payload: rejected, confirmedPayload: rejected, confirmed: true }), { code: 'INVALID_STATE' });
  assert.equal(f.trackerCalls.filter(v => v[0] === 'mutate').length, 1);
});
