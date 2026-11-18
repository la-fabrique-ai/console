import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, cp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fixture, issue } from './helpers/backend-fixture.mjs';
import { configV2 } from './helpers/config-v2-fixture.mjs';

for (const multi of [false, true]) for (const name of ['fabrique-console-v2-qa', 'fabrique-console-v2-projects', 'fabrique-console-v2-settings']) {
  test(`native V2 ${multi ? 'multi' : 'mono'} repository: ${name}`, { skip: process.env.FABRIQUE_CONSOLE_NATIVE_CHECKS !== '1' }, async t => {
    const f = await fixture(t);
    const { session } = await f.backend.dispatch('launch', { issueId: issue.id, tool: 'codex' });
    const config = configV2();
    config.projects[0].key = session.projectKey;
    config.projects[0].projectId = 'characterization-project';
    config.projects[0].repos[0].path = f.repo;
    config.projects[0].repos[0].tests = f.config.projects[0].tests;
    if (!multi) config.projects[0].repos.splice(1);
    await f.write('config.json', config);
    const data = await f.backend.dispatch('snapshot');
    const values = { 'fabrique-console.snapshot': data, 'fabrique-console.session': session.id, 'fabrique-console.project': session.projectKey };
    const scratch = await mkdtemp(join(tmpdir(), 'fabrique-console-native-v2-')), mod = join(scratch, name);
    try {
      await cp(resolve('mods', name), mod, { recursive: true });
      const commonPath = join(mod, 'common.js');
      let common = await readFile(commonPath, 'utf8');
      assert.match(common, /export const snapshot=\(\)=>[^;]+;/);
      common = common.replace(/export const snapshot=\(\)=>[^;]+;/, 'export const snapshot=()=>(' + JSON.stringify(data) + ');');
      // No external call or credential access from the temporary native fixture.
      assert.match(common, /export async function api\([^]*?\n}/);
      common = common.replace(/export async function api\([^]*?\n}/, 'export async function api(){return {config:' + JSON.stringify(config) + '};}');
      await writeFile(commonPath, common);
      const mainPath = join(mod, 'main.js');
      let source = await readFile(mainPath, 'utf8');
      if (/import \{[^}]*\bshared\b[^}]*\} from 'herdr'/.test(source)) {
        source = source.replace(/import \{([^}]*)\} from 'herdr'/, (_match, imports) => "import {" + imports.replace(/\bshared\b/, 'shared as originalShared') + "} from 'herdr'");
        source += '\nconst shared=key=>(' + JSON.stringify(values) + ')[key]??null;\n';
      }
      await writeFile(mainPath, source);
      const result = spawnSync(process.env.FABRIQUE_CONSOLE_HERDR_APP || join(process.env.HOME, '.local/bin/herdr-app'), ['check', mod], {
        encoding: 'utf8', timeout: 20000,
        env: { ...process.env, HERDR_APP_HOME: join(scratch, 'app'), FABRIQUE_CONSOLE_HOME: f.home },
      });
      assert.equal(result.status, 0, result.stderr || result.stdout || result.error?.message);
    } finally { await rm(scratch, { recursive: true, force: true }); }
  });
}
