#!/usr/bin/env node
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { paths, withLock, readManifest, safePath, exists, fingerprint, matches, writePrivate, cli, isMain } from './install.mjs';
export async function uninstall(args = {}) {
  const { target, state } = await paths(args);
  return withLock(state, async () => {
    const manifest = await readManifest(state, target);
    const removed = [], preserved = [], remaining = [];
    // Validate all paths before deleting any; modified trees are preserved whole.
    for (const entry of manifest.entries) await safePath(path.join(target, entry.path));
    for (const entry of manifest.entries) {
      const p = path.join(target, entry.path);
      if (!await exists(p)) continue;
      let intact = false;
      try { intact = matches(await fingerprint(p), entry.files); } catch { /* symlinks or special files are local changes */ }
      if (!intact) { preserved.push(entry.path); remaining.push(entry); continue; }
      await fs.rm(p, { recursive: true });
      removed.push(entry.path);
    }
    await writePrivate(path.join(state, 'deploy.json'), JSON.stringify({ ...manifest, entries: remaining }, null, 2) + '\n');
    return { removed, preserved, privateStatePreserved: state };
  });
}
if (isMain(import.meta.url)) await cli(uninstall, 'node scripts/uninstall.mjs [--target APP_HOME] [--state PRIVATE_STATE]');
