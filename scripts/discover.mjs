#!/usr/bin/env node
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { cli, isMain, safePath, exists, withLock, writePrivate } from './install.mjs';
export async function discover(args = {}) {
  const developer = await safePath(args.developer ?? path.join(os.homedir(), 'Developer'));
  const repositories = [];
  if (await exists(developer)) for (const item of (await fs.readdir(developer, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!item.isDirectory() || item.isSymbolicLink()) continue;
    const folder = path.join(developer, item.name);
    if (!await exists(path.join(folder, '.git'))) continue;
    // Never inspect or emit remotes. Disable optional Git index writes.
    const git = spawnSync('git', ['-C', folder, 'rev-parse', '--is-inside-work-tree'], { encoding: 'utf8', env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' }, timeout: 10000 });
    if (git.status === 0 && git.stdout.trim() === 'true') repositories.push({ name: item.name, path: folder });
  }
  const result = { repositories, suggestions: repositories.map(r => ({ repository: r.path, suggestedName: r.name, trackerProjectId: null, confirmed: false })) };
  const state = await safePath(args.state ?? path.join(os.homedir(), '.config/fabrique-console'));
  // Discovery writes only its private report; it never modifies repositories or configured mappings.
  const output = path.join(state, 'discovery.json');
  await withLock(state, () => writePrivate(output, JSON.stringify(result, null, 2) + '\n'));
  return { ...result, report: output };
}
if (isMain(import.meta.url)) await cli(discover, 'node scripts/discover.mjs [--developer ~/Developer] [--state PRIVATE_STATE]');
