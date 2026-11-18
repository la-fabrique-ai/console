import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const scripts = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../scripts');
async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fabrique-console-deploy-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const repo = path.join(dir, 'repo'), target = path.join(dir, 'app'), state = path.join(dir, 'private');
  await fs.mkdir(path.join(repo, 'mods/fabrique-console-test'), { recursive: true });
  await fs.mkdir(path.join(repo, 'layouts'), { recursive: true });
  await fs.writeFile(path.join(repo, 'mods/fabrique-console-test/main.js'), 'export default class Test {}\n');
  await fs.writeFile(path.join(repo, 'mods/fabrique-console-test/mod.json'), '{"place":"none"}\n');
  await fs.writeFile(path.join(repo, 'layouts/fabrique-console-test.json'), '{"root":{"type":"block","content":{"mod":"fabrique-console-test"}}}\n');
  return { dir, repo, target, state };
}
function run(script, f, extra = []) {
  return spawnSync(process.execPath, [path.join(scripts, script + '.mjs'), '--repo', f.repo, '--target', f.target, '--state', f.state, ...extra], { encoding: 'utf8' });
}
function ok(r) { assert.equal(r.status, 0, r.stderr); return JSON.parse(r.stdout); }
const read = async p => fs.readFile(p, 'utf8');

test('install copies only namespaced artifacts, records ownership and absolute runtime', async t => {
  const f = await fixture(t);
  await fs.mkdir(path.join(f.target, 'mods/agents'), { recursive: true });
  await fs.writeFile(path.join(f.target, 'mods/agents/main.js'), 'official');
  await fs.mkdir(path.join(f.repo, 'mods/agents'), { recursive: true });
  await fs.writeFile(path.join(f.repo, 'mods/agents/main.js'), 'must not copy');
  ok(run('install', f));
  assert.equal(await read(path.join(f.target, 'mods/agents/main.js')), 'official');
  assert.deepEqual(JSON.parse(await read(path.join(f.target, 'mods/fabrique-console-test/runtime.json'))), { repo: f.repo, node: process.execPath, state: f.state });
  const m = JSON.parse(await read(path.join(f.state, 'deploy.json')));
  assert.equal(m.target, f.target);
  assert.equal(m.entries.length, 2);
  assert.equal((await fs.stat(path.join(f.state, 'deploy.json'))).mode & 0o777, 0o600);
});

test('unknown collision aborts the entire deployment before writing any target artifact', async t => {
  const f = await fixture(t);
  await fs.mkdir(path.join(f.target, 'layouts'), { recursive: true });
  await fs.writeFile(path.join(f.target, 'layouts/fabrique-console-test.json'), 'unknown');
  assert.notEqual(run('install', f).status, 0);
  assert.equal(await read(path.join(f.target, 'layouts/fabrique-console-test.json')), 'unknown');
  await assert.rejects(fs.stat(path.join(f.target, 'mods/fabrique-console-test')));
});

test('upgrade backs up owned versions privately and records restoration instructions', async t => {
  const f = await fixture(t); ok(run('install', f));
  await fs.writeFile(path.join(f.repo, 'mods/fabrique-console-test/main.js'), 'export default class Updated {}\n');
  const result = ok(run('install', f));
  assert.equal(await read(path.join(result.backup, 'mods/fabrique-console-test/main.js')), 'export default class Test {}\n');
  assert.match(await read(path.join(result.backup, 'RESTORE.md')), /deploy\.json/);
  assert.equal((await fs.stat(path.join(result.backup, 'mods/fabrique-console-test/main.js'))).mode & 0o777, 0o600);
  assert.equal(await read(path.join(f.target, 'mods/fabrique-console-test/main.js')), 'export default class Updated {}\n');
});

test('locally changed owned trees block upgrades and remain untouched by uninstall', async t => {
  const f = await fixture(t); ok(run('install', f));
  await fs.writeFile(path.join(f.target, 'mods/fabrique-console-test/main.js'), 'local edits');
  assert.notEqual(run('install', f).status, 0);
  const result = ok(run('uninstall', f));
  assert.deepEqual(result.preserved, ['mods/fabrique-console-test']);
  assert.equal(await read(path.join(f.target, 'mods/fabrique-console-test/main.js')), 'local edits');
  await assert.rejects(fs.stat(path.join(f.target, 'layouts/fabrique-console-test.json')));
  assert.ok(await fs.stat(path.join(f.state, 'deploy.json')));
});

test('uninstall leaves official files, private data and worktrees intact', async t => {
  const f = await fixture(t); ok(run('install', f));
  await fs.writeFile(path.join(f.state, 'sessions.json'), 'private');
  await fs.mkdir(path.join(f.target, 'worktrees'), { recursive: true });
  await fs.writeFile(path.join(f.target, 'worktrees/a'), 'work');
  ok(run('uninstall', f));
  assert.equal(await read(path.join(f.state, 'sessions.json')), 'private');
  assert.equal(await read(path.join(f.target, 'worktrees/a')), 'work');
  await assert.rejects(fs.stat(path.join(f.target, 'mods/fabrique-console-test')));
});

test('source and target symlinks cannot redirect deployment', async t => {
  const f = await fixture(t);
  await fs.symlink(f.repo, f.target);
  assert.notEqual(run('install', f).status, 0);
  await fs.unlink(f.target);
  await fs.symlink(path.join(f.repo, 'layouts/fabrique-console-test.json'), path.join(f.repo, 'mods/fabrique-console-test/foreign'));
  assert.notEqual(run('install', f).status, 0);
  await assert.rejects(fs.stat(path.join(f.target, 'mods/fabrique-console-test')));
});

test('tampered manifest cannot claim ownership of official files', async t => {
  const f = await fixture(t); ok(run('install', f));
  const p = path.join(f.state, 'deploy.json'), m = JSON.parse(await read(p));
  m.entries.push({ path: 'mods/agents', files: {} });
  await fs.writeFile(p, JSON.stringify(m));
  assert.notEqual(run('uninstall', f).status, 0);
  assert.ok(await fs.stat(path.join(f.target, 'mods/fabrique-console-test/main.js')));
});

test('discover emits unconfirmed suggestions without exposing remotes or changing repositories', async t => {
  const f = await fixture(t), developer = path.join(f.dir, 'Developer'), repo = path.join(developer, 'demo');
  await fs.mkdir(repo, { recursive: true });
  assert.equal(spawnSync('git', ['init', '-q', repo]).status, 0);
  assert.equal(spawnSync('git', ['-C', repo, 'remote', 'add', 'origin', 'https:'+'//fixture-token@example.invalid/private/demo.git']).status, 0);
  const before = await read(path.join(repo, '.git/config'));
  const r = run('discover', f, ['--developer', developer]);
  const result = ok(r);
  assert.equal(result.repositories[0].path, repo);
  assert.equal(result.suggestions[0].confirmed, false);
  assert.doesNotMatch(r.stdout, /fixture-token|example\.invalid/);
  assert.equal(await read(path.join(repo, '.git/config')), before);
});

test('check rejects invalid module syntax and missing layout mod references', async t => {
  const f = await fixture(t);
  ok(run('check', f, ['--herdr-app', '/usr/bin/true']));
  await fs.writeFile(path.join(f.repo, 'mods/fabrique-console-test/main.js'), 'export default class {');
  assert.notEqual(run('check', f, ['--herdr-app', '/usr/bin/true']).status, 0);
  await fs.writeFile(path.join(f.repo, 'mods/fabrique-console-test/main.js'), 'export default class Test {}');
  await fs.writeFile(path.join(f.repo, 'layouts/fabrique-console-test.json'), '{"root":{"content":{"mod":"fabrique-console-missing"}}}');
  assert.notEqual(run('check', f, ['--herdr-app', '/usr/bin/true']).status, 0);
});

test('bootstrap refuses an unknown existing app before accessing the network', async t => {
  const f = await fixture(t), apps = path.join(f.dir, 'Applications');
  await fs.mkdir(path.join(apps, 'Herdr.app'), { recursive: true });
  const result = run('bootstrap-macos', f, ['--applications', apps]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /collision|existing|existante/i);
  assert.deepEqual(await fs.readdir(path.join(apps, 'Herdr.app')), []);
});

test('untracked files named __proto__ are detected and preserved', async t => {
  const f = await fixture(t); ok(run('install', f));
  await fs.writeFile(path.join(f.target, 'mods/fabrique-console-test/__proto__'), 'unknown private data');
  assert.notEqual(run('install', f).status, 0);
  const result = ok(run('uninstall', f));
  assert.deepEqual(result.preserved, ['mods/fabrique-console-test']);
  assert.equal(await read(path.join(f.target, 'mods/fabrique-console-test/__proto__')), 'unknown private data');
});

test('bootstrap recognizes the pinned official existing app without modifying it', { skip: process.platform !== 'darwin' || !process.env.FABRIQUE_CONSOLE_OFFICIAL_APP }, async t => {
  const apps = path.dirname(process.env.FABRIQUE_CONSOLE_OFFICIAL_APP);
  const binary = path.join(apps, 'Herdr.app/Contents/MacOS/Herdr');
  try { await fs.access(binary); } catch { t.skip('Official app is not installed'); return; }
  const f = await fixture(t), before = await fs.stat(binary);
  const result = ok(run('bootstrap-macos', f, ['--applications', apps]));
  assert.equal(result.installed, false);
  assert.equal(result.version, '0.1.12');
  const after = await fs.stat(binary);
  assert.equal(after.mtimeMs, before.mtimeMs);
});

test('namespaced layout previews deploy, back up and uninstall with their layouts', async t => {
  const f = await fixture(t);
  await fs.writeFile(path.join(f.repo, 'layouts/fabrique-console-test.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  ok(run('install', f));
  assert.equal(await read(path.join(f.target, 'layouts/fabrique-console-test.svg')), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  await fs.writeFile(path.join(f.repo, 'layouts/fabrique-console-test.svg'), '<svg/>');
  const result = ok(run('install', f));
  assert.equal(await read(path.join(result.backup, 'layouts/fabrique-console-test.svg')), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  ok(run('uninstall', f));
  await assert.rejects(fs.stat(path.join(f.target, 'layouts/fabrique-console-test.svg')));
});

test('Herdr generated type and editor files allow upgrades while backups retain them', async t => {
  const f = await fixture(t); ok(run('install', f));
  for (const name of ['jsconfig.json', 'gpui-kit.d.ts', 'herdr.d.ts']) await fs.writeFile(path.join(f.target, 'mods/fabrique-console-test', name), 'generated by Herdr');
  const result = ok(run('install', f));
  assert.equal(await read(path.join(result.backup, 'mods/fabrique-console-test/herdr.d.ts')), 'generated by Herdr');
  ok(run('uninstall', f));
  await assert.rejects(fs.stat(path.join(f.target, 'mods/fabrique-console-test')));
});

test('an install leaves in place what did not change, so that Herdr does not reload it', async t => {
  const f = await fixture(t);
  ok(run('install', f));
  const inode = async () => (await fs.stat(path.join(f.target, 'mods/fabrique-console-test'))).ino, first = await inode();
  ok(run('install', f));
  assert.equal(await inode(), first, 'nothing changed: the folder stays');
  await fs.writeFile(path.join(f.repo, 'mods/fabrique-console-test/more.js'), 'changed');
  ok(run('install', f));
  assert.notEqual(await inode(), first, 'changed: it is replaced');
  assert.equal(await read(path.join(f.target, 'mods/fabrique-console-test/more.js')), 'changed');
  assert.ok(JSON.parse(await read(path.join(f.state, 'deploy.json'))).entries.some(e => e.path === 'mods/fabrique-console-test' && e.files.some?.(x => String(x.path ?? x[0]).includes('more.js')) !== false));
});

test('install generates Lead layouts from private configuration and preserves collision checks',async t=>{
 const f=await fixture(t);
 await fs.writeFile(path.join(f.repo,'layouts/fabrique-console-v4-lead.json'),'{}');
 await fs.mkdir(f.state,{recursive:true});
 const config={version:1,owner:{id:'owner-42',displayName:'Responsable'},ticketConnector:'primary',projects:[{key:'synthetic-orbit',name:'Orbit',color:'#123456',icon:'◆',leadLayout:'generated',ticketScope:{connection:'primary',scopeId:'scope'},repo:'/example/app',mainBranch:'main',machine:null,preferredAgent:'codex'}]};
 await fs.writeFile(path.join(f.state,'config.json'),JSON.stringify(config),{mode:0o600});
 ok(run('install',f));
 const layout=path.join(f.target,'layouts/fabrique-console-v4-lead-synthetic-orbit.json');
 assert.equal(JSON.parse(await read(layout)).colors.accent,'#123456');
 assert.ok(JSON.parse(await read(path.join(f.state,'deploy.json'))).entries.some(e=>e.path==='layouts/fabrique-console-v4-lead-synthetic-orbit.json'));
 await fs.writeFile(layout,'edited');
 const refused=run('install',f);assert.notEqual(refused.status,0);assert.match(refused.stderr,/modified/);assert.equal(await read(layout),'edited');
});
