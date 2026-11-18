#!/usr/bin/env node
// Offline source-tree rename only: no installs, state migration, keychain or shell commands.
// Run: node scripts/rename-to-console.mjs <folder>
// The tool and its regression fixtures deliberately retain the old vocabulary.
// Link checks happen during inventory: the export tree must stay static throughout the run.
import { lstat, readdir, readFile, writeFile, rename, realpath } from 'node:fs/promises';
import { resolve, join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const SELF = 'scripts/rename-to-console.mjs';
const TEST = 'tests/rename-to-console.test.mjs';
const PACKAGE = '@la-fabrique-ai/console';
const BIN = { 'fabrique-console': 'src/cli.mjs' };
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const legacyCount = text => (text.match(/d\u0076lpr/gi) ?? []).length;

// Long identities precede the generic prefix, so the transform is idempotent.
function replaceText(text) {
  return text
    .replace(/dev\.d\u0076lpr\.mission-control/gi, 'ai.la-fabrique.console')
    .replace(/dev\.d\u0076lpr\./gi, 'ai.la-fabrique.console.')
    .replace(/D\u0056LPR Mission Control/gi, 'Fabrique Console')
    .replace(/d\u0076lpr-(?:herdr-)?mission-control/gi, 'fabrique-console')
    .replace(/D\u0056LPR_MC_HOME/g, 'FABRIQUE_CONSOLE_HOME')
    .replace(/\b(install|update|uninstall):d\u0076lpr\b/g, '$1:console')
    .replace(/\bl\u0069near:login\b/g, 'tickets:login')
    .replace(/D\u0056LPR_/g, 'FABRIQUE_CONSOLE_')
    .replace(/d\u0076lpr/gi, (value, offset, source) => {
      const before = source[offset - 1] ?? '', after = source[offset + value.length] ?? '';
      if (value === 'D\u0056LPR') return before === '-' || after === '-' ? 'FABRIQUE-CONSOLE' : 'FABRIQUE_CONSOLE';
      if (value !== 'd\u0076lpr') return 'FabriqueConsole';
      if (before === '_' || after === '_') return 'fabrique_console';
      return /[\p{L}\p{N}$]/u.test(before + after) ? 'fabriqueConsole' : 'fabrique-console';
    });
}

// Root-relative local data only: fixture directories called state/cache remain sources.
const LOCAL = ['.claude/output', 'docs/local', '.local', '.superpowers', '.mcp-auth',
  'state', 'cache', 'logs', 'backups', 'coverage', 'config/local'];
function exception(path) {
  const parts = path.split('/'), name = parts.at(-1);
  if (path === SELF || path === TEST) return 'rename tool and regression fixtures';
  if (parts.includes('node_modules')) return 'third-party dependencies';
  if (parts.includes('.state')) return 'official runtime state';
  if (parts.includes('.swift-module-cache')) return 'compiler cache';
  if (LOCAL.some(prefix => path === prefix || path.startsWith(prefix + '/'))) return 'private or generated local data';
  if (/^\.env(?:\.|$)/.test(name) && name !== '.env.example') return 'local environment';
  if (/\.(pem|key|p12|keychain[^/]*)$/.test(name)) return 'credential material';
  if (/^config\/[^/]+\.local\./.test(path)) return 'local configuration';
  if (/^mods\/[^/]+\/(?:runtime\.json|herdr\.d\.ts|gpui-kit\.d\.ts|jsconfig\.json)$/.test(path)) return 'injected runtime or official generated file';
  return null;
}

function failure(code, path) {
  // Paths only: never include source text, tokens or subprocess diagnostics.
  const error = new Error(code);
  error.code = code;
  error.path = path;
  return error;
}

async function inventory(root) {
  const entries = [], exceptions = [];
  async function visit(path) {
    if (basename(path) === '.git') throw failure('SOURCE_REPO', path);
    const reason = exception(path);
    if (reason) { exceptions.push({ path, reason }); return; }
    const absolute = join(root, path), info = await lstat(absolute);
    if (info.isSymbolicLink()) throw failure('SYMLINK', path);
    const entry = { path, directory: info.isDirectory() };
    if (entry.directory) {
      entries.push(entry);
      for (const name of (await readdir(absolute)).sort(compare)) await visit(path ? path + '/' + name : name);
    } else if (info.isFile()) {
      if (info.nlink > 1) throw failure('HARDLINK', path);
      entry.bytes = await readFile(absolute);
      // latin1 is used solely to count ASCII legacy tokens in non-text files.
      entry.occurrences = legacyCount(entry.bytes.toString('latin1'));
      try {
        entry.text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(entry.bytes);
        if (entry.text.includes('\0')) entry.text = null;
      } catch { entry.text = null; }
      entries.push(entry);
    } else throw failure('UNSUPPORTED_FILE', path);
  }
  for (const name of (await readdir(root)).sort(compare)) await visit(name);
  return { entries, exceptions };
}

function packageText(path, text) {
  if (path !== 'package.json' && path !== 'package-lock.json') return replaceText(text);
  let pkg;
  try { pkg = JSON.parse(text); } catch { throw failure('INVALID_JSON', path); }
  function validateKeys(value) {
    if (!value || typeof value !== 'object') return;
    const keys = Object.keys(value).map(replaceText);
    if (new Set(keys).size !== keys.length) throw failure('COLLISION', path);
    for (const child of Object.values(value)) validateKeys(child);
  }
  validateKeys(pkg);
  // Do not add a command to unrelated packages passed in as fixtures/subtrees.
  const ours = ['d\u0076lpr-herdr-mission-control', 'fabrique-console', PACKAGE].includes(pkg.name);
  let changed = replaceText(text);
  if (!ours) return changed;
  pkg = JSON.parse(changed);
  pkg.name = PACKAGE;
  function cliBin(bin) {
    if (typeof bin === 'string') {
      if (bin !== BIN['fabrique-console']) throw failure('COLLISION', path);
      return { ...BIN };
    }
    if (bin?.['fabrique-console'] && bin['fabrique-console'] !== BIN['fabrique-console']) throw failure('COLLISION', path);
    return { ...bin, ...BIN };
  }
  if (path === 'package.json') pkg.bin = cliBin(pkg.bin);
  else if (pkg.packages?.['']) {
    pkg.packages[''].name = PACKAGE;
    pkg.packages[''].bin = cliBin(pkg.packages[''].bin);
  }
  // Preserve bytes on repeated runs, including files already named for Console.
  if (JSON.stringify(JSON.parse(changed)) !== JSON.stringify(pkg)) changed = JSON.stringify(pkg, null, 2) + '\n';
  return changed;
}

export async function renameToConsole(folder) {
  const requested = resolve(folder);
  const rootInfo = await lstat(requested);
  if (rootInfo.isSymbolicLink()) throw failure('SYMLINK', '.');
  if (!rootInfo.isDirectory()) throw failure('NOT_DIRECTORY', '.');
  const root = await realpath(requested);
  const source = await realpath(fileURLToPath(new URL('..', import.meta.url)));
  if (root === source) throw failure('SOURCE_REPO', '.');
  for (let folder = root; ; folder = dirname(folder)) {
    try {
      await lstat(join(folder, '.git'));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      if (dirname(folder) === folder) break;
      continue;
    }
    throw failure('SOURCE_REPO', '.');
  }
  const { entries, exceptions } = await inventory(root);
  const destinations = new Map();
  // Include exclusions in collision checks; renames may not overwrite private data either.
  for (const entry of [...entries, ...exceptions]) {
    const target = entry.reason ? entry.path.split('/').map((part, i, parts) => i === parts.length - 1 ? part : replaceText(part)).join('/') : replaceText(entry.path);
    const key = target.normalize('NFC').toLowerCase();
    if (destinations.has(key)) throw failure('COLLISION', target);
    destinations.set(key, entry.path);
  }
  const binaryLegacy = entries.filter(entry => !entry.directory && entry.text === null && entry.occurrences);
  if (binaryLegacy.length) {
    const error = failure('BINARY_LEGACY', binaryLegacy[0].path);
    error.remainingOccurrences = binaryLegacy.reduce((sum, entry) => sum + entry.occurrences, 0);
    throw error;
  }
  // Prepare all content changes before the first write (including JSON validation).
  for (const entry of entries) {
    entry.target = replaceText(entry.path);
    if (!entry.directory && entry.text !== null) entry.output = packageText(entry.path, entry.text);
  }
  const touchedFiles = entries.filter(entry => !entry.directory &&
    (entry.path !== entry.target || (entry.output !== undefined && entry.output !== entry.text))).map(entry => entry.target).sort(compare);
  for (const entry of entries) {
    if (entry.output !== undefined && entry.output !== entry.text) await writeFile(join(root, entry.path), entry.output);
  }
  // Children first; their original parents still exist when their basename changes.
  const renamed = [];
  for (const entry of [...entries].sort((a, b) => b.path.split('/').length - a.path.split('/').length || compare(a.path, b.path))) {
    if (basename(entry.path) === basename(entry.target)) continue;
    await rename(join(root, entry.path), join(root, dirname(entry.path), basename(entry.target)));
    renamed.push({ from: entry.path, to: entry.target });
  }
  const after = await inventory(root);
  const remaining = after.entries.flatMap(entry => {
    const count = legacyCount(entry.path) + (entry.directory ? 0 : entry.occurrences);
    return count ? [{ path: entry.path, occurrences: count }] : [];
  });
  return {
    ok: remaining.length === 0,
    touchedFiles,
    renamed: renamed.sort((a, b) => compare(a.from, b.from)),
    remainingOccurrences: remaining.reduce((sum, entry) => sum + entry.occurrences, 0),
    remaining,
    exceptions: after.exceptions,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let report;
  try {
    if (process.argv.length !== 3 || !process.argv[2]) throw failure('USAGE', 'node scripts/rename-to-console.mjs <folder>');
    report = await renameToConsole(process.argv[2]);
  } catch (error) {
    const code = ['SOURCE_REPO', 'SYMLINK', 'HARDLINK', 'NOT_DIRECTORY', 'COLLISION', 'BINARY_LEGACY', 'INVALID_JSON', 'UNSUPPORTED_FILE', 'USAGE'].includes(error.code) ? error.code : 'FILESYSTEM_ERROR';
    report = { ok: false, error: { code, ...(error.path && code !== 'FILESYSTEM_ERROR' ? { path: error.path } : {}) }, ...(error.remainingOccurrences ? { remainingOccurrences: error.remainingOccurrences } : {}) };
  }
  process.stdout.write(JSON.stringify(report) + '\n');
  if (!report.ok) process.exitCode = 1;
}
