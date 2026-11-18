import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { withLock } from '../../src/common.mjs';
const root=process.argv[2];
try {
  await withLock(root,async()=>{
    process.send({entered:true});
    await new Promise(resolve=>process.once('message',resolve));
    await writeFile(join(root,'owner-write'),'fixture');
  });
  process.send({done:true});
}catch(error){process.send({done:true,error:error.code||error.message});}
process.disconnect();
