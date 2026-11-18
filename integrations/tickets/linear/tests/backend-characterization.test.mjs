import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { validateConfig } from '../../../../src/config.mjs';
import { fixture, issue } from '../../../../tests/helpers/backend-fixture.mjs';

test('V1 absent configuration and state stay absent on reads', async t => {
  const f = await fixture(t, { configured: false });
  assert.deepEqual(await f.backend.dispatch('read-config'), {
    config: JSON.parse(JSON.stringify(validateConfig({version:1,projects:[]}))),
    revision: null,
  });
  const snapshot = await f.backend.dispatch('snapshot');
  assert.deepEqual(snapshot.sessions, []); assert.deepEqual(snapshot.projects, []);
  assert.deepEqual(snapshot.tracker, { configured: true, provider: 'mcp-oauth', transport: 'mcp', endpoint: 'https://mcp.linear.app/mcp/readonly' });
  assert.deepEqual(snapshot.warnings, []);
  await assert.rejects(stat(join(f.home, 'state.json')), { code: 'ENOENT' });
  await assert.rejects(stat(join(f.home, 'config.json')), { code: 'ENOENT' });
});

test('V1 config-save canonicalizes the repo and preserves explicit QA terminal preference', async t => {
  const f = await fixture(t);
  const result = await f.backend.dispatch('config-save', { config: { ...f.config, tracker: { transport: 'graphql' } } });
  assert.equal(result.config.version, 1);
  assert.deepEqual(result.config.tracker, { transport: 'graphql' });
  assert.equal(result.config.projects[0].repo, f.repo);
  assert.equal(result.config.projects[0].tests.unit.terminal, false);
  assert.deepEqual(await f.read('config.json'), JSON.parse(JSON.stringify(validateConfig({ ...f.config, tracker: { transport: 'graphql' } }))));
  assert.equal((await stat(join(f.home, 'config.json'))).mode & 0o777, 0o600);
});

test('Tracker read actions retain their injectable client arguments and results', async t => {
  const f = await fixture(t), filters = { teamId: 'team-filter', search: 'literal query' };
  const list=await f.backend.dispatch('ticket-list',filters);
  const {status,reference,untrusted,...listed}=list.issues[0];
  assert.deepEqual(listed,issue);assert.equal(status.category,'ready');assert.deepEqual(reference,{connection:'primary',id:issue.id});assert.equal(untrusted,true);
  assert.equal(list.updatedAt,'2026-01-01T00:00:00Z');assert.equal(list.cached,true);
  const detail=await f.backend.dispatch('ticket-detail',{id:issue.id,refresh:true});
  assert.deepEqual(detail.issue,list.issues[0]);
  const meta=await f.backend.dispatch('ticket-meta');assert.deepEqual(meta.states,[{id:'todo-state',team:{id:'characterization-team'},category:'unknown'}]);
  assert.deepEqual(f.trackerCalls,[['list',{...filters,refresh:false}],['detail',issue.id,{refresh:true}],['meta',{refresh:false}]]);
  assert.equal(f.calls.length, 0);
});

test('project-summary counts workflow types and forwards its configured project filter', async t => {
  const f = await fixture(t);
  assert.deepEqual(await f.backend.dispatch('project-summary', { key: 'example' }), {
    key: 'example', open: 1, total: 1, unknown: 0, updatedAt: '2026-01-01T00:00:00Z', cached: true, source: 'tracker', complete: true,
  });
  assert.deepEqual(f.trackerCalls, [['list', { projectId: 'characterization-project', refresh: false }]]);
});

test('launch retains the V1 state, complete core argv and historical resume workspace', async t => {
  const f = await fixture(t), { session } = await f.backend.dispatch('launch', { issueId: issue.id, tool: 'codex' });
  const key = '44dc305e9514d6c9';
  assert.equal(session.branch, `fabrique-console/char-7-codex-work-${key.slice(0, 6)}`);
  assert.equal(session.worktree, join(f.home, 'worktrees', `example-${key}`));
  assert.equal(session.baseCommit, f.base); assert.equal(session.launchUncertain, false);
  const launch = f.calls.find(v => v.args[0] === 'run');
  // Traced (M12): the key of its trace for its commands, right after its mark.
  const traceKey = (await readdir(join(f.home, 'state', 'traces')))[0].slice(0, -5);
  assert.deepEqual(launch.args.slice(0, -1), [
    'run', '--bg', '--json', '--no-parent', '--outlive-parent', '--keep', '--cwd', session.worktree,
    '--label', 'herdr.space=fabrique-console-example', '--label', `herdr.tab=fabrique-console-${session.id}`,
    '--label', 'fabrique-console.app=fabrique-console', '--label', `fabrique-console.issue=${issue.id}`,
    '--label', `fabrique-console.session=${session.id}`, '--', 'codex', '--no-daemon', '-c', 'shell_environment_policy.set.FABRIQUE_CONSOLE_AGENT="1"',
    '-c', `shell_environment_policy.set.FABRIQUE_CONSOLE_TRACE="${traceKey}"`,
  ]);
  assert.equal(launch.options.shell, false); assert.equal(launch.options.timeout, 30000);
  assert.ok(launch.args.at(-1).includes('Untrusted \\u003cexternal\\u003e text'));
  assert.equal((await f.read('state.json')).version, 1);
  f.setTerminals([]);
  const resumed = await f.backend.dispatch('launch', { issueId: issue.id, tool: 'codex', resume: true });
  assert.equal(resumed.session.id, session.id); assert.equal(resumed.session.worktree, session.worktree);
  assert.equal(resumed.reused, false);
});

test('git, QA, local reports and confirmed stop preserve the V1 persisted shapes', async t => {
  const f = await fixture(t), { session } = await f.backend.dispatch('launch', { issueId: issue.id, tool: 'claude' });
  const git = await f.backend.dispatch('git', { sessionId: session.id });
  assert.deepEqual(git, { branch: session.branch, status: '', diff: '', stat: '', commits: '' });
  const { run } = await f.backend.dispatch('qa', { sessionId: session.id, profile: 'unit' });
  assert.equal(run.sessionId, session.id); assert.equal(run.status, 'passed'); assert.equal(run.exitCode, 0);
  assert.equal(run.stdout, 'fixture-result\n'); assert.equal(run.stderr, ''); assert.equal(run.execution, 'inline');
  assert.equal(run.cwd, session.worktree); assert.equal(run.terminalId, null);
  assert.deepEqual(await f.read(`qa/${run.id}.json`), run);
  assert.equal((await f.read('state.json')).sessions[0].qaId, run.id);
  const proposal = await f.backend.dispatch('propose', { sessionId: session.id });
  assert.equal(proposal.path, join(f.home, 'reports', `${session.id}.md`));
  assert.equal(await readFile(proposal.path, 'utf8'), proposal.content);
  assert.deepEqual(proposal.proposal, { issueId: issue.id, comment: 'Local implementation report for CHAR-7. Branch: '+session.branch+'. QA: passed.' });
  assert.equal(proposal.pr.base, 'main'); assert.equal(proposal.pr.head, session.branch);
  assert.equal(f.trackerCalls.some(v => v[0] === 'mutate'), false);
  const stopped = await f.backend.dispatch('stop', { sessionId: session.id, confirmed: true });
  assert.equal(stopped.session.status, 'historical'); assert.equal(stopped.session.qa.status, 'passed');
  assert.deepEqual(f.calls.at(-1).args, ['kill', session.terminalId, '--json']);
  assert.ok((await f.read('state.json')).sessions[0].stoppedAt);
});

test('legacy sessions and QA metadata are observed without replacing their persisted data', async t => {
  const f = await fixture(t), { session } = await f.backend.dispatch('launch', { issueId: issue.id, tool: 'codex' });
  const { run } = await f.backend.dispatch('qa', { sessionId: session.id, profile: 'unit' });
  await f.write(`qa/${run.id}.terminal.json`, { terminalId: 't81' });
  const state = await readFile(join(f.home, 'state.json'), 'utf8');
  f.setTerminals([]);
  const snapshot = await f.backend.dispatch('snapshot');
  assert.equal(snapshot.sessions[0].status, 'historical'); assert.equal(snapshot.sessions[0].qa.terminalId, 't81');
  assert.equal(await readFile(join(f.home, 'state.json'), 'utf8'), state);
  f.failCore();
  const degraded = await f.backend.dispatch('snapshot');
  assert.equal(degraded.sessions[0].status, 'unknown'); assert.equal(degraded.warnings[0].code, 'HC_UNAVAILABLE');
});

test('a lost launch response is reconciled from its ownership label without spawning twice', async t => {
  const f = await fixture(t); f.loseLaunchResponse(true);
  await assert.rejects(f.backend.dispatch('launch', { issueId: issue.id, tool: 'codex' }), { code: 'LAUNCH_UNCERTAIN' });
  assert.equal((await f.read('state.json')).sessions[0].launchUncertain, true);
  f.loseLaunchResponse(false);
  const recovered = await f.backend.dispatch('launch', { issueId: issue.id, tool: 'codex' });
  assert.equal(recovered.reused, true); assert.equal(recovered.session.launchUncertain, false);
  assert.equal(f.calls.filter(v => v.args[0] === 'run').length, 1);
});

test('existing V1 applied and uncertain mutation journals prevent duplicate writes', async t => {
  const f = await fixture(t), payload = { issueId: issue.id, comment: 'Fixture approval' };
  const input = { payload, confirmedPayload: payload, confirmed: true };
  assert.deepEqual(await f.backend.dispatch('ticket-mutate', input), { success: true });
  const files = await readdir(join(f.home, 'mutations'));
  assert.equal(files.length, 1);
  const journal = await f.read(`mutations/${files[0]}`);
  assert.equal(journal.status, 'applied'); assert.ok(journal.attemptedAt); assert.ok(journal.finishedAt);
  assert.equal(journal.payloadHash, createHash('sha256').update('{"comment":"Fixture approval","issueId":"characterization-issue"}').digest('hex'));
  assert.deepEqual(await f.backend.dispatch('ticket-mutate', input), { success: true });
  assert.equal(f.trackerCalls.filter(v => v[0] === 'mutate').length, 1);
  await f.write(`mutations/${files[0]}`, { ...journal, status: 'uncertain' });
  await assert.rejects(f.backend.dispatch('ticket-mutate', input), { code: 'TICKET_MUTATION_UNCERTAIN' });
  assert.equal(f.trackerCalls.filter(v => v[0] === 'mutate').length, 1);
});

test('V1 errors retain codes and do not create session state or run commands', async t => {
  const f = await fixture(t);
  for (const [action, input, code] of [
    ['unknown', {}, 'UNKNOWN_ACTION'], ['read-config', null, 'INVALID_ARGUMENT'],
    ['launch', { issueId: issue.id, tool: 'shell' }, 'INVALID_ARGUMENT'],
    ['git', { sessionId: 'absent' }, 'NOT_FOUND'], ['qa', { sessionId: 'absent' }, 'NOT_FOUND'],
    ['stop', { sessionId: 'absent' }, 'CONFIRMATION_REQUIRED'], ['propose', { sessionId: 'absent' }, 'NOT_FOUND'],
    ['project-summary', { key: 'absent' }, 'NOT_FOUND'], ['ticket-detail', { id: '' }, 'INVALID_ARGUMENT'],
    ['ticket-mutate', { payload: { issueId: issue.id, comment: 'unapproved' } }, 'CONFIRMATION_REQUIRED'],
  ]) await assert.rejects(f.backend.dispatch(action, input), { code });
  await assert.rejects(stat(join(f.home, 'state.json')), { code: 'ENOENT' });
  assert.equal(f.calls.length, 0);
  await f.write('state.json', { version: 2, sessions: [] });
  await assert.rejects(f.backend.dispatch('snapshot'), { code: 'INVALID_DATA' });
});
