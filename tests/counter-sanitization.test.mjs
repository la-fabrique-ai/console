import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { clean, writeJSON } from '../src/common.mjs';

test('validated numeric usage counters and unknown null values survive output and persisted JSON', async t => {
  const usage = { inputTokens: 17, cachedTokens: 0, outputTokens: 5, totalTokens: 22, source: 'fixture' };
  assert.deepEqual(clean({ usage }), { usage });
  assert.deepEqual(clean({ inputTokens: null }), { inputTokens: null });
  const root = await mkdtemp(join(tmpdir(), 'fabrique-console-counters-')); t.after(() => rm(root, { recursive: true, force: true }));
  await writeJSON(join(root, 'usage.json'), { usage, accessToken: 'fixture-private' });
  assert.deepEqual(JSON.parse(await readFile(join(root, 'usage.json'), 'utf8')), { usage, accessToken: '[redacted]' });
});

test('counter names cannot exempt strings, invalid numbers, nested values or actual secrets', () => {
  for (const value of ['17', 'fixture-private', -1, 1.5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1, { accessToken: 'fixture-private' }]) {
    assert.deepEqual(clean({ inputTokens: value }), { inputTokens: '[redacted]' });
  }
  assert.deepEqual(clean({ token: 17, apiKey: 22, password: { inputTokens: 7 }, accessTokens: 3, tokenCount: 4 }), {
    token: '[redacted]', apiKey: '[redacted]', password: '[redacted]', accessTokens: '[redacted]', tokenCount: '[redacted]',
  });
  assert.deepEqual(clean([{ usage: { cachedTokens: 8 }, secret: 'fixture-private' }]), [{ usage: { cachedTokens: 8 }, secret: '[redacted]' }]);
  assert.equal(clean(['Bearer','fixture-private'].join(' ')), 'Bearer [redacted]');
});
