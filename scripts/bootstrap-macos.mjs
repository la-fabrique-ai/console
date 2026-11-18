#!/usr/bin/env node
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { safePath, exists, cli, isMain } from './install.mjs';
export const release = Object.freeze({ executableSha256: 'c5b7f631979405fdae7ca0a05704087af1740fd3e66dbf39a1567e546f291d32', version: '0.1.12', sha256: '006a4f68409a79548d1aa6c5f99da8911b7d14910ef2ac6bd1a3dce634ca5d03', url: 'https://releases.herdr.dev/app/0.1.12/herdr-app-macos-aarch64.tar.gz' });
function command(program, args) {
  const r = spawnSync(program, args, { encoding: 'utf8', timeout: 120000, maxBuffer: 4 * 1024 * 1024 });
  if (r.error || r.status !== 0) throw new Error(`${program} failed: ${r.error?.message ?? r.stderr}`);
  return r.stdout.trim();
}
function plist(app, key) { return command('/usr/libexec/PlistBuddy', ['-c', `Print :${key}`, path.join(app, 'Contents/Info.plist')]); }
async function validateApp(app) {
  if (plist(app, 'CFBundleIdentifier') !== 'dev.herdr.app' || plist(app, 'CFBundleShortVersionString') !== release.version) throw new Error('Existing app collision: expected official dev.herdr.app 0.1.12');
  const binary = path.join(app, 'Contents/MacOS', plist(app, 'CFBundleExecutable'));
  await safePath(binary);
  await fs.access(binary, fs.constants.X_OK);
  const hash = crypto.createHash('sha256').update(await fs.readFile(binary)).digest('hex');
  if (hash !== release.executableSha256) throw new Error('Existing app collision: executable differs from pinned official release');
  // Executable bytes are pinned against the checksum-verified official archive.
  // Certificate-signed releases must additionally pass native signature verification.
  const signature = spawnSync('/usr/bin/codesign', ['-dvv', app], { encoding: 'utf8' });
  const description = signature.stderr + signature.stdout;
  if (/^Authority=Developer ID Application:/m.test(description)) command('/usr/bin/codesign', ['--verify', '--deep', '--strict', app]);
  else if (!/^Signature=adhoc$/m.test(description) && !/code object is not signed at all/.test(description)) throw new Error('Cannot determine official app signature (macOS sandbox may hide certificate authorities; rerun outside the sandbox)');
  return binary;
}
export async function bootstrap(args = {}) {
  const applications = await safePath(args.applications ?? path.join(os.homedir(), 'Applications'));
  if (applications === '/Applications' || applications.startsWith('/Applications/')) throw new Error('System /Applications is protected');
  const destination = path.join(applications, 'Herdr.app');
  await safePath(destination);
  if (await exists(destination)) {
    let binary;
    try { binary = await validateApp(destination); } catch (error) { throw new Error(`Existing app collision; preserved: ${error.message}`); }
    const coreVersion = command('hc', ['--version']);
    return { installed: false, app: destination, binary, version: release.version, coreVersion };
  }
  if (process.platform !== 'darwin' || process.arch !== 'arm64') throw new Error('Official bootstrap requires macOS arm64');
  // Require the independent core to exist; do not migrate or rewrite its state.
  const coreVersion = command('hc', ['--version']);
  await fs.mkdir(applications, { recursive: true });
  const stage = await fs.mkdtemp(path.join(applications, '.fabrique-console-bootstrap-'));
  try {
    const archive = path.join(stage, 'release.tar.gz');
    if (args.archive) await fs.copyFile(await safePath(args.archive), archive, fs.constants.COPYFILE_EXCL);
    else command('/usr/bin/curl', ['--fail', '--location', '--proto', '=https', '--tlsv1.2', '--output', archive, release.url]);
    const checksum = crypto.createHash('sha256').update(await fs.readFile(archive)).digest('hex');
    if (checksum !== release.sha256) throw new Error('Official release checksum mismatch');
    const listing = command('/usr/bin/tar', ['-tzf', archive]).split('\n');
    if (!listing.length || listing.some(p => p.startsWith('/') || p.split('/').includes('..'))) throw new Error('Unsafe archive paths');
    const unpacked = path.join(stage, 'unpacked');
    await fs.mkdir(unpacked);
    command('/usr/bin/tar', ['-xzf', archive, '-C', unpacked]);
    let app = path.join(unpacked, 'Herdr.app');
    if (!await exists(app)) {
      const children = await fs.readdir(unpacked, { withFileTypes: true });
      const candidates = children.filter(c => c.isDirectory()).map(c => path.join(unpacked, c.name, 'Herdr.app'));
      const found = [];
      for (const candidate of candidates) if (await exists(candidate)) found.push(candidate);
      if (found.length !== 1) throw new Error('Official archive does not contain a unique Herdr.app');
      app = found[0];
    }
    await validateApp(app);
    const signature = spawnSync('/usr/bin/codesign', ['-dvv', app], { encoding: 'utf8' });
    if (!/^Authority=Developer ID Application:/m.test(signature.stderr + signature.stdout)) {
      // Reproduce the official installer's development-build preparation, on the staged copy only.
      const bin = path.join(os.homedir(), '.local/bin');
      command('/usr/libexec/PlistBuddy', ['-c', `Add :LSEnvironment:PATH string ${bin}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin`, path.join(app, 'Contents/Info.plist')]);
      command('/usr/bin/codesign', ['--force', '--sign', '-', app]);
    }
    if (await exists(destination)) throw new Error('Existing app collision appeared during bootstrap');
    await fs.rename(app, destination);
    return { installed: true, app: destination, binary: path.join(destination, 'Contents/MacOS', plist(destination, 'CFBundleExecutable')), version: release.version, checksum, coreVersion };
  } finally { await fs.rm(stage, { recursive: true, force: true }); }
}
if (isMain(import.meta.url)) await cli(bootstrap, 'node scripts/bootstrap-macos.mjs [--applications ~/Applications] [--archive VERIFIED_RELEASE_ARCHIVE]');
