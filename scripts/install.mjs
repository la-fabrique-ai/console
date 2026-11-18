#!/usr/bin/env node
import * as fs from 'node:fs/promises';
import {projectLayoutArtifacts} from './build-ui.mjs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const defaultRepo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const exists = async p => { try { return await fs.lstat(p); } catch (e) { if (e.code === 'ENOENT') return null; throw e; } };
export async function safePath(p) {
  const absolute = path.resolve(p);
  let current = path.parse(absolute).root;
  for (const part of absolute.slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    const info = await exists(current);
    if (info?.isSymbolicLink() && !['/tmp', '/var'].includes(current)) throw new Error(`Symlink refused: ${current}`);
  }
  return absolute;
}
export function options(argv = process.argv.slice(2)) {
  const out = {};
  const names = new Set(['repo', 'target', 'state', 'developer', 'herdr-app', 'applications', 'archive', 'output']);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--help') { out.help = true; continue; }
    const key = argv[i].replace(/^--/, '');
    if (!argv[i].startsWith('--') || !names.has(key) || !argv[i + 1] || argv[i + 1].startsWith('--')) throw new Error(`Unknown or incomplete option: ${argv[i]}`);
    out[key] = argv[++i];
  }
  return out;
}
export async function cli(fn, usage) {
  try {
    const args = options();
    if (args.help) { console.log(usage); return; }
    console.log(JSON.stringify(await fn(args), null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
export const isMain = url => process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(url);
export const herdrGeneratedFiles = new Set(['jsconfig.json', 'gpui-kit.d.ts', 'herdr.d.ts']);
export async function fingerprint(root) {
  const isMod = path.basename(path.dirname(root)) === 'mods';
  const files = Object.create(null);
  async function walk(p, key) {
    const stat = await fs.lstat(p);
    if (stat.isSymbolicLink()) throw new Error(`Symlink refused: ${p}`);
    if (stat.isDirectory()) {
      files[key] = 'directory';
      for (const name of (await fs.readdir(p)).sort()) {
        const child = path.join(p, name);
        // Herdr rewrites these exact top-level regular files. Never exempt symlinks or nested files.
        if (isMod && key === '.' && herdrGeneratedFiles.has(name) && (await fs.lstat(child)).isFile()) continue;
        await walk(child, key === '.' ? name : `${key}/${name}`);
      }
    } else if (stat.isFile()) files[key] = crypto.createHash('sha256').update(await fs.readFile(p)).digest('hex');
    else throw new Error(`Special file refused: ${p}`);
  }
  await walk(root, '.');
  return files;
}
export const matches = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const validArtifact = p => /^mods\/fabrique-console-[\w-]+$/.test(p) || /^layouts\/fabrique-console-[\w-]+\.(json|svg)$/.test(p);
export async function readManifest(state, target) {
  const manifestPath = path.join(state, 'deploy.json');
  await safePath(manifestPath);
  if (!await exists(manifestPath)) return { version: 1, target, entries: [] };
  const m = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  if (m.version !== 1 || m.target !== target || !Array.isArray(m.entries)) throw new Error('Invalid ownership manifest or target mismatch');
  const seen = new Set();
  for (const e of m.entries) {
    if (!validArtifact(e.path) || seen.has(e.path) || !e.files || !Object.keys(e.files).length) throw new Error('Invalid ownership manifest entry');
    seen.add(e.path);
    // Older deployments may have recorded Herdr's generated editor files.
    if (e.path.startsWith('mods/')) for (const name of herdrGeneratedFiles) delete e.files[name];
    for (const [p, hash] of Object.entries(e.files)) {
      if ((p !== '.' && (path.posix.normalize(p) !== p || p.startsWith('/') || p.split('/').includes('..') || p.includes('\\'))) || !/^(directory|[a-f0-9]{64})$/.test(hash)) throw new Error('Invalid ownership manifest fingerprint');
    }
  }
  return m;
}
export async function writePrivate(file, content) {
  await safePath(file);
  const tmp = `${file}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(tmp, content, { mode: 0o600, flag: 'wx' });
  try { await fs.rename(tmp, file); } finally { await fs.rm(tmp, { force: true }); }
}
export async function withLock(state, action) {
  await safePath(state);
  await fs.mkdir(state, { recursive: true, mode: 0o700 });
  await fs.chmod(state, 0o700);
  const lock = path.join(state, '.deploy-lock');
  try { await fs.mkdir(lock, { mode: 0o700 }); } catch (e) { if (e.code === 'EEXIST') throw new Error('Deployment locked; another operation or interrupted deployment requires inspection'); throw e; }
  try { return await action(); } finally { await fs.rmdir(lock); }
}
export async function paths(args) {
  const repo = await safePath(args.repo ?? defaultRepo);
  const target = await safePath(args.target ?? path.join(os.homedir(), '.config/herdr-app'));
  const state = await safePath(args.state ?? path.join(os.homedir(), '.config/fabrique-console'));
  if (state === target || state.startsWith(target + path.sep) || target.startsWith(state + path.sep)) throw new Error('Deployment target and private state must be separate');
  return { repo, target, state };
}
export async function sourceArtifacts(repo) {
  const artifacts = [];
  for (const kind of ['mods', 'layouts']) {
    const folder = path.join(repo, kind);
    await safePath(folder);
    if (!await exists(folder)) continue;
    for (const name of (await fs.readdir(folder)).sort()) {
      const p = `${kind}/${name}`;
      if (!validArtifact(p)) continue;
      const stat = await fs.lstat(path.join(repo, p));
      if ((kind === 'mods' && !stat.isDirectory()) || (kind === 'layouts' && !stat.isFile())) throw new Error(`Invalid artifact: ${p}`);
      artifacts.push({ path: p, files: await fingerprint(path.join(repo, p)) });
    }
  }
  return artifacts;
}
export async function privateCopy(source, dest) {
  await fs.mkdir(path.dirname(dest), { recursive: true, mode: 0o700 });
  await fs.cp(source, dest, { recursive: true, errorOnExist: true, force: false });
  async function secure(p) {
    const s = await fs.lstat(p);
    if (s.isSymbolicLink()) throw new Error(`Symlink refused: ${p}`);
    await fs.chmod(p, s.isDirectory() ? 0o700 : 0o600);
    if (s.isDirectory()) for (const n of await fs.readdir(p)) await secure(path.join(p, n));
  }
  await secure(dest);
}
export async function makeBackup(state, target, manifest) {
  if (!manifest.entries.length) return null;
  const root = path.join(state, 'backups');
  await safePath(root);
  await fs.mkdir(root, { recursive: true, mode: 0o700 });
  const backup = path.join(root, `${new Date().toISOString().replace(/[:.]/g, '-')}-${crypto.randomUUID()}`);
  await fs.mkdir(backup, { mode: 0o700 });
  for (const entry of manifest.entries) if (await exists(path.join(target, entry.path))) await privateCopy(path.join(target, entry.path), path.join(backup, entry.path));
  await writePrivate(path.join(backup, 'deploy.json'), JSON.stringify(manifest, null, 2) + '\n');
  await writePrivate(path.join(backup, 'RESTORE.md'), `# Restore FABRIQUE_CONSOLE deployment\n\nTarget: ${target}\n\nKeep this backup private. Stop deployment operations. Compare every current FABRIQUE_CONSOLE artifact with the hashes in the current private deploy.json before replacing it. Preserve edited or unknown files separately; never overwrite them. Copy the mods/ and layouts/ artifacts in this backup back to the target, remove only newly introduced artifacts whose hashes still match the current manifest, then restore this backup's deploy.json to ${path.join(state, 'deploy.json')}. No official files, sessions, credentials or worktrees belong to this backup.\n`);
  return backup;
}
export async function install(args = {}) {
  const { repo, target, state } = await paths(args);
  let sources = await sourceArtifacts(repo);
  if (await exists(path.join(repo,'layouts/fabrique-console-v4-lead.json'))) {
    const configPath=await safePath(path.join(state,'config.json'));
    const examplePath=path.join(repo,'config/projects.example.json');
    const configFile=await exists(configPath)?configPath:await exists(examplePath)?examplePath:null;
    // Project resources belong to the same ownership transaction as the other layouts.
    const generated=configFile?projectLayoutArtifacts(JSON.parse(await fs.readFile(configFile,'utf8'))):{};
    sources=sources.filter(e=>!/^layouts\/fabrique-console-v4-lead-.+\.(json|svg)$/.test(e.path));
    sources.push(...Object.entries(generated).map(([name,content])=>({path:'layouts/'+name,content})));
  }
  if (!sources.length) throw new Error('No FABRIQUE_CONSOLE mods or layouts found');
  return withLock(state, async () => {
    const old = await readManifest(state, target);
    const owned = new Map(old.entries.map(e => [e.path, e]));
    // Complete collision and integrity preflight before touching the target.
    for (const p of new Set([...sources.map(e => e.path), ...owned.keys()])) {
      const dest = path.join(target, p);
      await safePath(dest);
      if (await exists(dest)) {
        if (!owned.has(p)) throw new Error(`Unknown collision: ${p}`);
        if (!matches(await fingerprint(dest), owned.get(p).files)) throw new Error(`Owned artifact modified: ${p}`);
      }
    }
    await fs.mkdir(target, { recursive: true });
    const transaction = await fs.mkdtemp(path.join(target, '.fabrique-console-install-'));
    const changed = [], moved = [];
    let backup = null, safeToClean = true;
    try {
      const next = { version: 1, target, repo, entries: [] };
      for (const source of sources) {
        const staged = path.join(transaction, 'new', source.path);
        await fs.mkdir(path.dirname(staged), { recursive: true });
        if(source.content!==undefined)await fs.writeFile(staged,source.content,{flag:'wx'});
        else await fs.cp(path.join(repo, source.path), staged, { recursive: true, errorOnExist: true, force: false });
        if (source.path.startsWith('mods/')) await fs.writeFile(path.join(staged, 'runtime.json'), JSON.stringify({ repo, node: process.execPath, state }) + '\n');
        next.entries.push({ path: source.path, files: await fingerprint(staged) });
      }
      // Recheck immediately before mutation; detect changes during staging.
      for (const p of new Set([...sources.map(e => e.path), ...owned.keys()])) {
        const dest = path.join(target, p);
        await safePath(dest);
        if (await exists(dest)) {
          if (!owned.has(p)) throw new Error(`Unknown collision: ${p}`);
          if (!matches(await fingerprint(dest), owned.get(p).files)) throw new Error(`Owned artifact modified: ${p}`);
        }
      }
      backup = await makeBackup(state, target, old);
      for (const p of new Set([...sources.map(e => e.path), ...owned.keys()])) {
        const dest = path.join(target, p), previous = path.join(transaction, 'old', p);
        // What did not change stays in place: Herdr reloads every mod replaced, and too many reloads exhaust its memory.
        const wanted = next.entries.find(e => e.path === p);
        if (wanted && owned.has(p) && await exists(dest) && matches(owned.get(p).files, wanted.files)) continue;
        if (await exists(dest)) { await fs.mkdir(path.dirname(previous), { recursive: true }); await fs.rename(dest, previous); moved.push(p); }
        const staged = path.join(transaction, 'new', p);
        if (await exists(staged)) { await fs.mkdir(path.dirname(dest), { recursive: true }); await fs.rename(staged, dest); changed.push(p); }
      }
      await writePrivate(path.join(state, 'deploy.json'), JSON.stringify(next, null, 2) + '\n');
      return { installed: next.entries.map(e => e.path), backup, manifest: path.join(state, 'deploy.json') };
    } catch (error) {
      try {
        for (const p of changed.reverse()) await fs.rm(path.join(target, p), { recursive: true, force: true });
        for (const p of moved.reverse()) await fs.rename(path.join(transaction, 'old', p), path.join(target, p));
      } catch (rollbackError) {
        safeToClean = false;
        throw new Error(`${error.message}; rollback incomplete, preserve ${transaction}: ${rollbackError.message}`);
      }
      throw error;
    } finally { if (safeToClean) await fs.rm(transaction, { recursive: true, force: true }); }
  });
}
if (isMain(import.meta.url)) await cli(install, 'node scripts/install.mjs [--target APP_HOME] [--state PRIVATE_STATE] [--repo REPO]');
