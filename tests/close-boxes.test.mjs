import test from 'node:test';
import assert from 'node:assert/strict';
import { pageCloseBox, pageReopenBox, reasonOk, reopenKept, REASON_MAX } from '../mods/fabrique-console-v4-ticket/blocks.js';
import { pageBand } from '../mods/fabrique-console-v4-ticket/page.js';

// The closure box (screen 06 of « pre-close ») and the reopening box (screen 08), from the code of the page itself.
const mission = { id: 'M-9', issue: { identifier: 'PRB-41' }, base: 'origin/release', step: 'validating' };
const rows = [
  { key: 'qa', ok: true, detail: '34 passed' },
  { key: '/r/app:branch', ok: true, detail: 'no conflict' },
  { key: '/r/app:checks', ok: false, detail: '11 of 12' },
];

test('the closure box draws the checklist the engine computed and holds approval while it is not ready', () => {
  const box = pageCloseBox({ mission, check: { ready: false, seen: 'v1', rows, base: 'release' } });
  assert.equal(box.title, 'Close PRB-41?');
  assert.deepEqual(box.checklist.map((r) => [r.label, r.ok, r.detail]), [
    ['QA finished', true, '34 passed'], ['Mission branch', true, 'no conflict'], ['PR checks', false, '11 of 12'],
  ]);
  assert.equal(box.ready, false);
  assert.match(box.rows[0].text, /merge it into release with a merge commit/);
});

test('approval is offered only when the engine says ready, with the version of the list shown', () => {
  const box = pageCloseBox({ mission, check: { ready: true, seen: 'v2', rows: rows.map((r) => ({ ...r, ok: true })) } });
  assert.equal(box.ready, true);
  assert.equal(box.seen, 'v2');
  assert.match(box.rows[0].text, /merge it into release with a merge commit/, 'the base of the mission, without origin/');
});

test('loading, an error or an empty list never offers approval', () => {
  assert.equal(pageCloseBox({ mission, loading: true }).ready, false);
  assert.equal(pageCloseBox({ mission, loading: true }).status, 'Checking…');
  assert.equal(pageCloseBox({ mission, error: 'gh is missing' }).ready, false);
  assert.equal(pageCloseBox({ mission, check: { ready: true, seen: 'v', rows: [] } }).ready, false);
});

test('reopening requires a nonblank bounded reason and says Validate', () => {
  const box = pageReopenBox({ mission });
  assert.equal(box.title, 'Reopen PRB-41?');
  assert.match(box.text, /Validate, never to Develop/);
  assert.equal(reasonOk(''), false);
  assert.equal(reasonOk('   '), false);
  assert.equal(reasonOk('x'.repeat(REASON_MAX + 1)), false);
  assert.equal(reasonOk('Le tri revient à l’ancien ordre'), true);
});

test('a closed mission offers Reopen, and says merged only when the engine noted the merge', () => {
  const closed = pageBand({ mission: { ...mission, step: 'closed' } });
  assert.equal(closed.big, 'Closed');
  assert.equal(closed.button.key, 'reopen');
  const merged = pageBand({ mission: { ...mission, step: 'closed', closure: { base: 'release', repositories: [{ merge: { status: 'done' } }] } } });
  assert.equal(merged.big, 'Closed · merged into release');
});

test('a merge not proven done never says merged', () => {
  const band = pageBand({ mission: { ...mission, step: 'closed', closure: { base: 'release', repositories: [{ merge: { status: 'done' } }, { merge: { status: 'uncertain' } }] } } });
  assert.equal(band.big, 'Closed');
});

test('the reopening box belongs to its mission: another mission shown drops it', () => {
  const offer = { button: { key: 'reopen' } };
  assert.equal(reopenKept('M-9', { id: 'M-9' }, offer), true);
  assert.equal(reopenKept('M-9', { id: 'M-10' }, offer), false, 'opened on M-9, M-10 shown');
  assert.equal(reopenKept('M-9', { id: 'M-9' }, { button: { key: 'close' } }), false, 'the banner no longer offers Reopen');
  assert.equal(reopenKept(false, { id: 'M-9' }, offer), false);
});

test('once closed, Open PR opens the pull request the engine read, and only a GitHub address', () => {
  const pr = (url) => pageBand({ mission: { ...mission, step: 'closed', closure: { base: 'release', repositories: [{ merge: { status: 'done' }, pullRequest: { number: 12, url, state: 'MERGED' } }] } } });
  assert.deepEqual(pr('https://github.com/o/r/pull/12').second, { key: 'pr', label: 'Open PR', urls: ['https://github.com/o/r/pull/12'] });
  assert.equal(pr('file:///etc/passwd').second, undefined);
  assert.equal(pageBand({ mission: { ...mission, step: 'closed' } }).second, undefined);
});

test('a row of a repository names it after its label, its state alone on the right', () => {
  const box = pageCloseBox({ mission, check: { ready: false, seen: 'v', rows: [{ key: '/r/app:checks', repo: 'app', ok: false, detail: '11/12 · 1 pending' }] } });
  assert.deepEqual([box.checklist[0].label, box.checklist[0].detail], ['PR checks · app', '11/12 · 1 pending']);
});

test('several repositories: Open PRs opens the pull request of each', () => {
  const band = pageBand({ mission: { ...mission, step: 'closed', closure: { base: 'main', repositories: [
    { merge: { status: 'done' }, pullRequest: { url: 'https://github.com/o/app/pull/3' } },
    { merge: { status: 'done' }, pullRequest: { url: 'https://github.com/o/api/pull/9' } }] } } });
  assert.deepEqual(band.second, { key: 'pr', label: 'Open PRs', urls: ['https://github.com/o/app/pull/3', 'https://github.com/o/api/pull/9'] });
});
