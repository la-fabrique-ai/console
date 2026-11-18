import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { withLock } from '../../src/common.mjs';

const [root, mode] = process.argv.slice(2);
const wait = () => new Promise(resolve => process.once('message', resolve));
try {
  if (mode === 'orphan') {
    await mkdir(join(root, 'operation.lock'));
    process.send({ ready: true }); await wait();
  } else {
    process.send({ ready: true }); await wait();
    let completed = false;
    for (let attempt = 0; attempt < 100 && !completed; attempt++) {
      try {
        await withLock(root, async () => {
          await mkdir(join(root, 'critical'));
          await writeFile(join(root, 'owner-observed-'+process.pid), 'entered');
          process.send({ entered: true });
          if (mode === 'hold') await wait();
          else await new Promise(resolve => setTimeout(resolve, 50));
          await rm(join(root, 'critical'), { recursive: true });
        }); completed = true;
      } catch (error) {
        if (error.code !== 'BUSY') throw error;
        await new Promise(resolve => setTimeout(resolve, 10));
      }
    }
    if (!completed) throw new Error('Lock did not become available');
    process.send({ done: true });
  }
} catch (error) { process.send({ error: error.code || error.message }); process.exitCode = 1; }
process.disconnect();
