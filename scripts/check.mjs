#!/usr/bin/env node
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { defaultRepo, cli, isMain, safePath, exists, sourceArtifacts } from './install.mjs';
function checked(command, args, input) {
  const r = spawnSync(command, args, { encoding: 'utf8', input, timeout: 30000, maxBuffer: 2 * 1024 * 1024 });
  if (r.error || r.status !== 0) throw new Error(`${command} ${args.join(' ')} failed: ${r.error?.message ?? r.stderr ?? r.stdout}`);
}
export async function check(args = {}) {
  const repo = await safePath(args.repo ?? defaultRepo), artifacts = await sourceArtifacts(repo);
  const modules = [];
  async function walk(folder) {
    if (!await exists(folder)) return;
    for (const item of await fs.readdir(folder, { withFileTypes: true })) {
      if (['node_modules', '.git'].includes(item.name)) continue;
      const p = path.join(folder, item.name);
      if (item.isSymbolicLink()) throw new Error(`Symlink refused: ${p}`);
      if (item.isDirectory()) await walk(p);
      else if (/\.(mjs|js)$/.test(item.name)) {
        checked(process.execPath, ['--input-type=module', '--check'], await fs.readFile(p, 'utf8'));
        modules.push(path.relative(repo, p));
      }
    }
  }
  for (const folder of ['src', 'integrations', 'scripts', 'tests', 'mods']) await walk(path.join(repo, folder));
  const mods = artifacts.filter(a => a.path.startsWith('mods/')).map(a => a.path.slice(5));
  const layouts = [];
  async function validateReferences(value, layout) {
    if (Array.isArray(value)) { for (const v of value) await validateReferences(v, layout); return; }
    if (!value || typeof value !== 'object') return;
    if (typeof value.mod === 'string') {
      const name = value.mod;
      if (!/^[\w-]+$/.test(name)) throw new Error(`Invalid mod reference ${name} in ${layout}`);
      if (name.startsWith('fabrique-console-') && !mods.includes(name)) throw new Error(`Missing mod ${name} in ${layout}`);
      if (!name.startsWith('fabrique-console-')) {
        const appHome = args.target ?? path.join(process.env.HOME, '.config/herdr-app');
        if (!await exists(path.join(appHome, 'mods', name, 'main.js'))) throw new Error(`Missing official mod ${name} in ${layout}`);
      }
    }
    for (const child of Object.values(value)) await validateReferences(child, layout);
  }
  for (const artifact of artifacts.filter(a => a.path.startsWith('layouts/') && a.path.endsWith('.json'))) {
    await validateReferences(JSON.parse(await fs.readFile(path.join(repo, artifact.path), 'utf8')), artifact.path);
    layouts.push(artifact.path);
  }
  const binary = args['herdr-app'] ?? 'herdr-app';
  for (const mod of mods) checked(binary, ['check', path.join(repo, 'mods', mod)]);
  return { modules: modules.length, mods, layouts, checksPassed: true };
}
if (isMain(import.meta.url)) await cli(check, 'node scripts/check.mjs [--repo REPO] [--target APP_HOME] [--herdr-app EXECUTABLE]');
