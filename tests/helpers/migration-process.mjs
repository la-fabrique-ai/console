import { join } from 'node:path';
import { createConfigMigration } from '../../src/config-migration.mjs';
import { writeJSON } from '../../src/common.mjs';
const [root, mode, worktreesRoot] = process.argv.slice(2);
const wait = () => new Promise(resolve => process.once('message', resolve));
process.send({ ready: true }); await wait();
try {
  const io = mode === 'prepare' ? { writeJSON: async (path, value, options) => {
    await writeJSON(path, value, options);
    if (value.status === 'prepared') { process.send({ prepared: true }); await wait(); }
  } } : {};
  for (let attempt = 0; ; attempt++) {
    try {
      const result = await createConfigMigration({ root, io }).migrate({ confirmed: true, worktreesRoot });
      process.send({ done: true, status: result.status }); break;
    } catch (error) {
      if (error.code !== 'BUSY' || attempt >= 100) throw error;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  }
} catch (error) { process.send({ error: error.code || error.message }); process.exitCode = 1; }
process.disconnect();
