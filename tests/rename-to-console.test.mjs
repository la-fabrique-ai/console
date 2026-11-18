import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, chmod, stat, symlink, link, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../scripts/rename-to-console.mjs', import.meta.url));
async function fixture(t, files) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'rename-console-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const [name, text] of Object.entries(files)) {
    await mkdir(dirname(join(root, name)), { recursive: true });
    await writeFile(join(root, name), text);
  }
  return root;
}
function run(root, { tool = script, readOnly = false } = {}) {
  const permission = process.allowedNodeEnvironmentFlags.has('--permission') ? '--permission' : '--experimental-permission';
  const result = spawnSync(process.execPath, [...(readOnly ? [permission, '--allow-fs-read=*'] : []), tool, root], { encoding: 'utf8', shell: false });
  let report;
  try { report = JSON.parse(result.stdout); } catch {}
  return { ...result, report };
}

test('refuses the actual source worktree without modifying it', async () => {
  const root = dirname(dirname(script));
  const before = await Promise.all(['package.json', 'scripts/rename-to-console.mjs', 'tests/rename-to-console.test.mjs'].map(name => readFile(join(root, name))));
  // Even a broken guard must never be allowed to write to the real worktree.
  const result = run(root, { readOnly: true });
  assert.equal(result.status, 1);
  assert.equal(result.report.error.code, 'SOURCE_REPO');
  assert.deepEqual(await Promise.all(['package.json', 'scripts/rename-to-console.mjs', 'tests/rename-to-console.test.mjs'].map(name => readFile(join(root, name)))), before);
});

test('refuses the script source root even without Git metadata', async t => {
  const source = await fixture(t, { 'scripts/rename-to-console.mjs': await readFile(script), 'a.txt': 'd\u0076lpr' });
  const result = run(source, { tool: join(source, 'scripts/rename-to-console.mjs'), readOnly: true });
  assert.equal(result.status, 1);
  assert.equal(result.report.error.code, 'SOURCE_REPO');
  assert.equal(await readFile(join(source, 'a.txt'), 'utf8'), 'd\u0076lpr');
});

for (const marker of ['file', 'directory']) {
  test(`refuses a repository with a .git ${marker} and its nested exports`, async t => {
    const root = await fixture(t, { 'a.txt': 'd\u0076lpr', 'nested/export/a.txt': 'd\u0076lpr' });
    if (marker === 'file') await writeFile(join(root, '.git'), 'gitdir: /unused');
    else await mkdir(join(root, '.git'));
    for (const target of [root, join(root, 'nested/export')]) {
      const result = run(target);
      assert.equal(result.status, 1);
      assert.equal(result.report.error.code, 'SOURCE_REPO');
    }
    assert.equal(await readFile(join(root, 'a.txt'), 'utf8'), 'd\u0076lpr');
    assert.equal(await readFile(join(root, 'nested/export/a.txt'), 'utf8'), 'd\u0076lpr');
  });
}

test('refuses repositories nested in an export before any writes', async t => {
  const root = await fixture(t, { 'a.txt': 'd\u0076lpr', 'nested/.git': 'gitdir: /unused' });
  const result = run(root);
  assert.equal(result.status, 1);
  assert.equal(result.report.error.code, 'SOURCE_REPO');
  assert.equal(await readFile(join(root, 'a.txt'), 'utf8'), 'd\u0076lpr');
});

test('renames installation identities, nested resources and references together', async t => {
  const root = await fixture(t, {
    'mods/d\u0076lpr-v4-test/main.js': "export const home=process.env.D\u0056LPR_MC_HOME; const trace=process.env.D\u0056LPR_TRACE; const shared='d\u0076lpr.snapshot'; const app='d\u0076lpr-mission-control';\n",
    'layouts/d\u0076lpr-v4-test.json': '{"mod":"d\u0076lpr-v4-test","preview":"layouts/d\u0076lpr-v4-test.svg"}\n',
    'layouts/d\u0076lpr-v4-test.svg': '<text>D\u0056LPR Mission Control</text>\n',
    'integrations/d\u0076lpr-keychain.swift': 'let service = "dev.d\u0076lpr.mission-control.l\u0069near-mcp"\n',
    'scripts/d\u0076lpr-report.mjs': '#!/usr/bin/env node\nconsole.log(".d\u0076lpr/qa.json");\n',
    'docs/usage.md': '~/.config/d\u0076lpr-mission-control .d\u0076lpr/ d\u0076lpr.app=d\u0076lpr-mission-control D\u0076lprIssue d\u0056lPrTest install:d\u0076lpr update:d\u0076lpr uninstall:d\u0076lpr l\u0069near:login\n',
    '.d\u0076lpr-fixtures/d\u0076lpr.txt': 'd\u0076lpr',
  });
  await chmod(join(root, 'scripts/d\u0076lpr-report.mjs'), 0o755);
  const result = run(root);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(await readFile(join(root, 'mods/fabrique-console-v4-test/main.js'), 'utf8'), "export const home=process.env.FABRIQUE_CONSOLE_HOME; const trace=process.env.FABRIQUE_CONSOLE_TRACE; const shared='fabrique-console.snapshot'; const app='fabrique-console';\n");
  assert.deepEqual(JSON.parse(await readFile(join(root, 'layouts/fabrique-console-v4-test.json'))), { mod: 'fabrique-console-v4-test', preview: 'layouts/fabrique-console-v4-test.svg' });
  assert.equal(await readFile(join(root, 'layouts/fabrique-console-v4-test.svg'), 'utf8'), '<text>Fabrique Console</text>\n');
  assert.equal(await readFile(join(root, 'integrations/fabrique-console-keychain.swift'), 'utf8'), 'let service = "ai.la-fabrique.console.l\u0069near-mcp"\n');
  assert.equal(await readFile(join(root, 'docs/usage.md'), 'utf8'), '~/.config/fabrique-console .fabrique-console/ fabrique-console.app=fabrique-console FabriqueConsoleIssue FabriqueConsoleTest install:console update:console uninstall:console tickets:login\n');
  assert.equal(await readFile(join(root, '.fabrique-console-fixtures/fabrique-console.txt'), 'utf8'), 'fabrique-console');
  assert.equal((await stat(join(root, 'scripts/fabrique-console-report.mjs'))).mode & 0o777, 0o755);
  assert.equal(result.report.remainingOccurrences, 0);
  assert.ok(result.report.renamed.some(entry => entry.from === 'mods/d\u0076lpr-v4-test' && entry.to === 'mods/fabrique-console-v4-test'));
  assert.ok(result.report.touchedFiles.includes('scripts/fabrique-console-report.mjs'));
});

for (const [input, output] of [
  ['d\u0076lprHome', 'fabriqueConsoleHome'],
  ['myd\u0076lpr', 'myfabriqueConsole'],
  ['d\u0076lpr2', 'fabriqueConsole2'],
  ['v2d\u0076lpr', 'v2fabriqueConsole'],
  ['d\u0076lpr_x', 'fabrique_console_x'],
  ['x_d\u0076lpr', 'x_fabrique_console'],
  ['D\u0056LPR-x', 'FABRIQUE-CONSOLE-x'],
  ['dev.d\u0076lpr.worker', 'ai.la-fabrique.console.worker'],
  ['dev.d\u0076lpr.any.suffix', 'ai.la-fabrique.console.any.suffix'],
  ['DEV.D\u0056LPR.Worker', 'ai.la-fabrique.console.Worker'],
]) {
  test(`renames ${input} consistently in paths and content and stays idempotent`, async t => {
    const root = await fixture(t, { [`${input}.txt`]: input });
    const first = run(root);
    assert.equal(first.status, 0, first.stdout);
    assert.deepEqual(await readdir(root), [`${output}.txt`]);
    assert.equal(await readFile(join(root, `${output}.txt`), 'utf8'), output);
    const second = run(root);
    assert.equal(second.status, 0, second.stdout);
    assert.deepEqual(second.report.touchedFiles, []);
    assert.deepEqual(second.report.renamed, []);
  });
}

test('keeps package, lockfile and CLI consistent and is byte-idempotent', async t => {
  const root = await fixture(t, {
    'package.json': JSON.stringify({ name: 'd\u0076lpr-herdr-mission-control', scripts: { 'install:d\u0076lpr': 'node scripts/install.mjs', 'l\u0069near:login': 'node scripts/l\u0069near-login.mjs' } }),
    'package-lock.json': JSON.stringify({ name: 'd\u0076lpr-herdr-mission-control', lockfileVersion: 3, packages: { '': { name: 'd\u0076lpr-herdr-mission-control' }, 'node_modules/example': { name: 'example', integrity: 'sha512-unchanged' } } }),
  });
  assert.equal(run(root).status, 0);
  const pkg = JSON.parse(await readFile(join(root, 'package.json')));
  const lock = JSON.parse(await readFile(join(root, 'package-lock.json')));
  assert.equal(pkg.name, '@la-fabrique-ai/console');
  assert.deepEqual(pkg.bin, { 'fabrique-console': 'src/cli.mjs' });
  assert.deepEqual(pkg.scripts, { 'install:console': 'node scripts/install.mjs', 'tickets:login': 'node scripts/l\u0069near-login.mjs' });
  assert.equal(lock.name, pkg.name);
  assert.equal(lock.packages[''].name, pkg.name);
  assert.deepEqual(lock.packages[''].bin, pkg.bin);
  assert.equal(lock.packages['node_modules/example'].integrity, 'sha512-unchanged');
  const before = await Promise.all(['package.json', 'package-lock.json'].map(file => readFile(join(root, file))));
  const second = run(root);
  assert.equal(second.status, 0);
  assert.deepEqual(second.report.touchedFiles, []);
  assert.deepEqual(second.report.renamed, []);
  assert.deepEqual(await Promise.all(['package.json', 'package-lock.json'].map(file => readFile(join(root, file)))), before);
});

test('refuses destination collisions before modifying any file', async t => {
  const root = await fixture(t, { 'a.txt': 'd\u0076lpr', 'mods/d\u0076lpr-one/main.js': 'old', 'mods/fabrique-console-one/user.txt': 'keep' });
  const result = run(root);
  assert.equal(result.status, 1);
  assert.equal(result.report.error.code, 'COLLISION');
  assert.equal(await readFile(join(root, 'a.txt'), 'utf8'), 'd\u0076lpr');
  assert.equal(await readFile(join(root, 'mods/fabrique-console-one/user.txt'), 'utf8'), 'keep');
  assert.ok((await readdir(join(root, 'mods'))).includes('d\u0076lpr-one'));
});

test('lists precise exceptions without changing local state, metadata, dependencies or itself', async t => {
  const files = Object.fromEntries(['node_modules/pkg/index.js', '.state/data.json', '.claude/output/notes.md', 'docs/local/private.txt', 'mods/d\u0076lpr-test/herdr.d.ts', 'mods/d\u0076lpr-test/runtime.json', 'scripts/rename-to-console.mjs', 'tests/rename-to-console.test.mjs', '.env'].map(file => [file, 'd\u0076lpr D\u0056LPR']));
  const root = await fixture(t, { ...files, 'mods/d\u0076lpr-test/main.js': 'd\u0076lpr', 'tests/fixtures/state/d\u0076lpr.json': 'd\u0076lpr' });
  const result = run(root);
  assert.equal(result.status, 0, result.stdout);
  for (const file of Object.keys(files)) {
    const dest = file.replace('mods/d\u0076lpr-test/', 'mods/fabrique-console-test/');
    assert.equal(await readFile(join(root, dest), 'utf8'), 'd\u0076lpr D\u0056LPR');
    assert.ok(result.report.exceptions.some(entry => entry.path === dest || dest.startsWith(entry.path + '/')), dest);
  }
  assert.equal(await readFile(join(root, 'tests/fixtures/state/fabrique-console.json'), 'utf8'), 'fabrique-console');
  assert.equal(result.report.remainingOccurrences, 0);
});

test('refuses symlinks and never touches their targets', async t => {
  const root = await fixture(t, { 'a.txt': 'd\u0076lpr', 'external/secret.txt': 'd\u0076lpr' });
  await symlink(join(root, 'external'), join(root, 'link'));
  const result = run(root);
  assert.equal(result.status, 1);
  assert.equal(result.report.error.code, 'SYMLINK');
  assert.equal(await readFile(join(root, 'a.txt'), 'utf8'), 'd\u0076lpr');
  assert.equal(await readFile(join(root, 'external/secret.txt'), 'utf8'), 'd\u0076lpr');
  const viaLink = run(join(root, 'link'));
  assert.equal(viaLink.status, 1);
  assert.equal(viaLink.report.error.code, 'SYMLINK');
});

test('reports unsupported legacy binary content before writes without corrupting bytes', async t => {
  const binary = Buffer.from([0, ...Buffer.from('d\u0076lpr'), 255]);
  const root = await fixture(t, { 'a.txt': 'd\u0076lpr', 'image.bin': binary });
  const result = run(root);
  assert.equal(result.status, 1);
  assert.equal(result.report.error.code, 'BINARY_LEGACY');
  assert.equal(result.report.remainingOccurrences, 1);
  assert.equal(await readFile(join(root, 'a.txt'), 'utf8'), 'd\u0076lpr');
  assert.deepEqual(await readFile(join(root, 'image.bin')), binary);
});

test('refuses hardlinked copies before they can change the original source', async t => {
  const root = await fixture(t, { 'a.txt': 'd\u0076lpr', 'original.txt': 'd\u0076lpr' });
  await link(join(root, 'original.txt'), join(root, 'copy.txt'));
  const result = run(root);
  assert.equal(result.status, 1);
  assert.equal(result.report.error.code, 'HARDLINK');
  assert.equal(await readFile(join(root, 'a.txt'), 'utf8'), 'd\u0076lpr');
  assert.equal(await readFile(join(root, 'original.txt'), 'utf8'), 'd\u0076lpr');
});

test('prevalidates malformed manifests before touching other files', async t => {
  const root = await fixture(t, { 'a.txt': 'd\u0076lpr', 'package.json': '{invalid' });
  const result = run(root);
  assert.equal(result.status, 1);
  assert.equal(result.report.error.code, 'INVALID_JSON');
  assert.equal(await readFile(join(root, 'a.txt'), 'utf8'), 'd\u0076lpr');
});

test('refuses a partially renamed manifest that would overwrite an existing command', async t => {
  const root = await fixture(t, { 'a.txt': 'd\u0076lpr', 'package.json': JSON.stringify({ name: 'd\u0076lpr-herdr-mission-control', scripts: { 'install:d\u0076lpr': 'node scripts/install.mjs', 'install:console': 'node custom-install.mjs' } }) });
  const result = run(root);
  assert.equal(result.status, 1);
  assert.equal(result.report.error.code, 'COLLISION');
  assert.equal(await readFile(join(root, 'a.txt'), 'utf8'), 'd\u0076lpr');
  assert.equal(JSON.parse(await readFile(join(root, 'package.json'))).scripts['install:console'], 'node custom-install.mjs');
});

test('refuses an existing CLI pointing elsewhere without overwriting its owner', async t => {
  const root = await fixture(t, { 'package.json': JSON.stringify({ name: '@la-fabrique-ai/console', bin: { 'fabrique-console': 'custom.mjs' } }) });
  const result = run(root);
  assert.equal(result.status, 1);
  assert.equal(result.report.error.code, 'COLLISION');
  assert.equal(JSON.parse(await readFile(join(root, 'package.json'))).bin['fabrique-console'], 'custom.mjs');
});

test('produces deterministic reports and leaves every byte unchanged on a second pass', async t => {
  const files = { 'mods/d\u0076lpr-test/main.js': '\uFEFFexport const label="d\u0076lpr.app";\r\n', 'docs/d\u0076lpr.txt': 'D\u0056LPR_NATIVE_CHECKS=1\n', 'image.bin': Buffer.from([0, 255, 1, 2]) };
  const first = await fixture(t, files), other = await fixture(t, files);
  const one = run(first), two = run(other);
  assert.equal(one.status, 0);
  assert.deepEqual(one.report, two.report);
  const names = ['mods/fabrique-console-test/main.js', 'docs/fabrique-console.txt', 'image.bin'];
  const bytes = await Promise.all(names.map(name => readFile(join(first, name))));
  assert.equal(bytes[0].toString(), '\uFEFFexport const label="fabrique-console.app";\r\n');
  const repeated = run(first);
  assert.equal(repeated.status, 0);
  assert.deepEqual(repeated.report.touchedFiles, []);
  assert.deepEqual(repeated.report.renamed, []);
  assert.deepEqual(await Promise.all(names.map(name => readFile(join(first, name)))), bytes);
});
