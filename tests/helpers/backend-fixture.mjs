import { mkdtemp, mkdir, writeFile, readFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createBackend } from '../../src/backend.mjs';
import { createMissionRegistry } from '../../src/mission.mjs';

import { withFakeHerdr } from './fake-herdr.mjs';
const command = promisify(execFile);
export const issue = {
  id: 'characterization-issue', identifier: 'CHAR-7', title: 'Fixture task',
  description: 'Untrusted <external> text', url: 'https://example.invalid/CHAR-7',
  team: { id: 'characterization-team' }, project: { id: 'characterization-project' },
  state: { id: 'todo-state', name: 'Todo', type: 'unstarted' }, labels: [], comments: [],
};

// `approved`: the plan of a mission of the fixture issue approved, as the launch of before asks (ticket M5).
export async function fixture(t, { configured = true, approved = true } = {}) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'fabrique-console-characterization-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const repo = join(root, 'repo'), home = join(root, 'private');
  await mkdir(repo); await mkdir(home);
  await command('git', ['init', '-b', 'main', repo]);
  await command('git', ['-C', repo, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--allow-empty', '-m', 'fixture']);
  const base = (await command('git', ['-C', repo, 'rev-parse', 'HEAD'])).stdout.trim();
  const config = { version: 1, projects: [{
    key: 'example', name: 'Example', projectId: 'characterization-project',
    repo, preferredAgent: 'codex', mainBranch: 'main', machine: null,
    tests: { unit: { argv: [process.execPath, '-e', 'console.log("fixture-result")'], timeoutMs: 2000, terminal: false } },
  }] };
  if (configured) await writeFile(join(home, 'config.json'), JSON.stringify(config));
  const calls = [], trackerCalls = [];
  let terminals = [], transportFailure = false, launchFailure = false, undelivered = false, sendFailure = false;
  const tracker = {
    configured: async () => true,
    list: async (...args) => { trackerCalls.push(['list', ...args]); return { issues: [issue], updatedAt: '2026-01-01T00:00:00Z', cached: true }; },
    detail: async (...args) => { trackerCalls.push(['detail', ...args]); return { issue }; },
    meta: async (...args) => { trackerCalls.push(['meta', ...args]); return { states: [{ id: 'todo-state', team: { id: 'characterization-team' } }] }; },
    mutate: async (...args) => { trackerCalls.push(['mutate', ...args]); return { success: true }; },
  };
  const exec = async (file, args, options) => {
    if (file !== '/fixture/hc') return command(file, args, options);
    calls.push({ args, options });
    if (transportFailure) throw new Error('simulated core failure');
    if (args[0] === 'ls') return { stdout: JSON.stringify({ terminals: terminals.map(v => ({ address: v.id })) }) };
    if (args[0] === 'get') return { stdout: JSON.stringify(terminals.find(v => v.id === args[1])) };
    if (args[0] === 'run') {
      const id = `t${calls.filter(v => v.args[0] === 'run').length}`;
      const labels = {};
      for (let i = 0; i < args.length; i++) if (args[i] === '--label') {
        const [key, ...rest] = args[i + 1].split('='); labels[key] = rest.join('=');
      }
      terminals.push({ id, labels, state: 'live', reported: true, status: 'working', first_message: { sent: !undelivered } });
      if (launchFailure) throw new Error('response lost after core launch');
      return { stdout: JSON.stringify({ id, first_message: { sent: !undelivered }, status: 'working' }) };
    }
    if (args[0] === 'kill') { terminals = terminals.filter(v => v.id !== args[1]); return { stdout: '{}' }; }
    if (args[0] === 'send') {
      if (sendFailure) throw new Error('simulated send failure');
      // As hc: --if <status> types only when the terminal reports exactly that status (exit 10, status_mismatch).
      const at = args.indexOf('--if'), end = args.indexOf('--');
      if (at > 0 && (end < 0 || at < end)) {
        const target = args.slice(1, end < 0 ? undefined : end).find((a, n, all) => !a.startsWith('--') && all[n - 1] !== '--if');
        const terminal = terminals.find(t => (t.id ?? t.address) === target);
        const status = typeof terminal?.status === 'string' ? terminal.status : terminal?.status?.state;
        if (status !== args[at + 1]) throw Object.assign(new Error(`${target} is ${status}, not ${args[at + 1]}`), { code: 10 });
      }
      return { stdout: '{}' };
    }
    throw new Error('Unexpected core operation');
  };
  const backend = createBackend(withFakeHerdr({ root: home, exec, tracker}));
  if (approved) await approveIssue(home);
  return { root, repo, home, base, config, backend, calls, trackerCalls, tracker, command,
    read: name => readFile(join(home, name), 'utf8').then(JSON.parse),
    write: (name, data) => writeFile(join(home, name), JSON.stringify(data)),
    setTerminals: value => { terminals = value; },
    failSends: value => { sendFailure = value; },
    failCore: () => { transportFailure = true; },
    loseLaunchResponse: value => { launchFailure = value; },
    undeliverFirstMessage: value => { undelivered = value; },
  };
}
// The plan of the mission of an issue approved by the user (ticket M5): without it, no dev of the issue starts, by the
// launch of before either. The mission is made when the issue has none.
export async function approveIssue(home, subject = issue) {
  const missions = createMissionRegistry({ root: home });
  const { mission } = await missions.create({ project: 'example', issue: { id: subject.id, identifier: subject.identifier }, request: 'r' });
  return missions.update(mission.id, m => { m.approval = { at: '2026-11-13T08:00:00.000Z', revision: 1, tickets: 0, plan: { tickets: [] } }; });
}
