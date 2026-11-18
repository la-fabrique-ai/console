import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const cli = fileURLToPath(new URL('../../../../src/cli.mjs', import.meta.url));
test('CLI keeps a single JSON envelope, exit codes and sanitized errors with a private empty home', async t => {
  const home = await mkdtemp(join(tmpdir(), 'fabrique-console-cli-characterization-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  const run = args => {
    const result = spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', env: { ...process.env, FABRIQUE_CONSOLE_HOME: home } });
    assert.equal(result.stderr, ''); assert.equal(result.stdout.trim().split('\n').length, 1);
    return { status: result.status, body: JSON.parse(result.stdout) };
  };
  assert.deepEqual(run(['read-config']), { status: 0, body: { ok: true, data: { config: {
    version: 1, owner:{id:'owner',displayName:'Responsable'},ticketConnector:'primary', tracker: { transport: 'mcp', endpoint: 'https://mcp.linear.app/mcp/readonly' }, projects: [],
  }, revision: null } } });
  for (const args of [[], ['read-config', '{'], ['read-config', '{}', 'extra']]) {
    const result = run(args); assert.equal(result.status, 1); assert.equal(result.body.ok, false); assert.equal(result.body.error.code, 'INVALID_ARGUMENT');
  }
  assert.deepEqual(run(['unknown']), { status: 1, body: { ok: false, error: { code: 'UNKNOWN_ACTION', message: 'Unknown local backend action.' } } });
  await writeFile(join(home, 'config.json'), '{invalid');
  const invalid = run(['read-config']);
  assert.equal(invalid.body.error.code, 'INVALID_DATA'); assert.doesNotMatch(JSON.stringify(invalid), /SyntaxError|stack|config.json/);
});
