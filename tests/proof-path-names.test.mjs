import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir,writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fixture } from './helpers/backend-fixture.mjs';
import { captureCode } from '../src/proof-code.mjs';

const names=[':(top)x',':colon','-dash',' leading','trailing ',"a'quote",'a"quote','back\\slash','unicode-雪','line\nbreak'];
function pattern(name,directory=false) {
  if(name.includes('\n'))return '/*\n';
  let escaped=name.replaceAll('\\','\\\\');
  for(const char of ['*','?','[',']',' '])escaped=escaped.replaceAll(char,'\\'+char);
  return '/'+escaped+(directory?'/':'')+'\n';
}

for(const name of names) {
  test(`a nonignored FIFO named ${JSON.stringify(name)} is never an ignored pathspec`,async t=>{
    const f=await fixture(t);await writeFile(join(f.repo,'.gitignore'),'/x\n');
    await f.command('mkfifo',[join(f.repo,name)]);
    const observed=await captureCode(f.repo);assert.equal(observed.stateHash,null);assert.equal(observed.reason,'QA_CODE_UNREADABLE');
  });
  test(`an ignored FIFO named ${JSON.stringify(name)} remains outside the working set`,async t=>{
    const f=await fixture(t);await writeFile(join(f.repo,'.gitignore'),pattern(name));
    await f.command('mkfifo',[join(f.repo,name)]);
    assert.ok((await captureCode(f.repo)).stateHash);
  });
  test(`an ignored directory named ${JSON.stringify(name)} is checked literally`,async t=>{
    const f=await fixture(t);await writeFile(join(f.repo,'.gitignore'),pattern(name,true));
    const dir=join(f.repo,name);await mkdir(dir);await writeFile(join(dir,'ignored.txt'),'ignored\n');
    await f.command('mkfifo',[join(dir,'ignored-pipe')]);
    assert.ok((await captureCode(f.repo)).stateHash);
  });
}

test('ordinary files with every unusual name are measured and content changes are detected',async t=>{
  const f=await fixture(t);await writeFile(join(f.repo,'.gitignore'),'/x\n');
  for(const name of names)await writeFile(join(f.repo,name),'first\n');
  let previous=await captureCode(f.repo);assert.ok(previous.stateHash);
  for(const name of names) {
    await writeFile(join(f.repo,name),'second\n');const current=await captureCode(f.repo);
    assert.ok(current.stateHash);assert.notEqual(current.stateHash,previous.stateHash);previous=current;
  }
});
