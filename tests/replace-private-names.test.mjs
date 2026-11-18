import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

async function fixture(t,table,files={'note.txt':'Aster Labs / Aster / préAster / Aster2 / Aster_guide / Étoile / PréÉtoile / A.ster'}) {
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'console-names-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const root=path.join(dir,'copy'),sourceRoot=path.join(dir,'source'),namesPath=path.join(dir,'names.json');
  await fs.mkdir(root);await fs.mkdir(sourceRoot);await fs.writeFile(namesPath,JSON.stringify(table));
  for(const [name,text] of Object.entries(files)){await fs.mkdir(path.dirname(path.join(root,name)),{recursive:true});await fs.writeFile(path.join(root,name),text);}
  return {dir,root,sourceRoot,namesPath};
}
async function run(f){const {replacePrivateNames}=await import('../scripts/replace-private-names.mjs');return replacePrivateNames(f.root,f);}

test('uses longest literal names, Unicode word boundaries and stable replacements',async t=>{
  const f=await fixture(t,{'Aster':'Public','Aster Labs':'Public Studio','Étoile':'Lune','A.ster':'Literal'});
  await run(f);
  assert.equal(await fs.readFile(path.join(f.root,'note.txt'),'utf8'),'Public Studio / Public / préAster / Aster2 / Public_guide / Lune / PréÉtoile / Literal');
  const before=await fs.readFile(path.join(f.root,'note.txt'));await run(f);
  assert.deepEqual(await fs.readFile(path.join(f.root,'note.txt')),before);
});
test('renames directories and filenames together and preserves binary bytes',async t=>{
  const f=await fixture(t,{'Aster':'Public'},{'Aster/Aster-guide.txt':'Aster','asset.bin':Buffer.from([0,255,1,2])});
  await run(f);assert.equal(await fs.readFile(path.join(f.root,'Public/Public-guide.txt'),'utf8'),'Public');
  assert.deepEqual(await fs.readFile(path.join(f.root,'asset.bin')),Buffer.from([0,255,1,2]));
  assert.deepEqual(await fs.readdir(f.root),['Public','asset.bin']);
});
for(const table of [[],{},null,{'':'Public'},{'Aster':null},{'Aster':''},{'Aster':'../escape'},{'Aster':'Public','Public':'Next'},{'Aster':'Public Aster'}])test('invalid or non-idempotent tables fail before writes',async t=>{
  const f=await fixture(t,table);await assert.rejects(run(f),error=>/^names-/.test(error.code));
  assert.equal(await fs.readFile(path.join(f.root,'note.txt'),'utf8'),'Aster Labs / Aster / préAster / Aster2 / Aster_guide / Étoile / PréÉtoile / A.ster');
});
for(const files of [{'Aster.txt':'Aster','Public.txt':'keep'},{'Aster/a.txt':'Aster','public/b.txt':'keep'}])test('collisions fail before changing any contents or paths',async t=>{
  const f=await fixture(t,{'Aster':'Public'},files);await assert.rejects(run(f),{code:'names-collision'});
  for(const [name,text] of Object.entries(files))assert.equal(await fs.readFile(path.join(f.root,name),'utf8'),text);
});
for(const kind of ['symlink','hardlink','repository'])test(`refuses unsafe copies: ${kind}`,async t=>{
  const f=await fixture(t,{'Aster':'Public'});
  if(kind==='symlink')await fs.symlink(f.namesPath,path.join(f.root,'linked'));
  if(kind==='hardlink')await fs.link(path.join(f.root,'note.txt'),path.join(f.root,'linked'));
  if(kind==='repository')await fs.mkdir(path.join(f.root,'.git'));
  await assert.rejects(run(f),{code:'unsafe-file'});
  assert.equal(await fs.readFile(path.join(f.root,'note.txt'),'utf8'),'Aster Labs / Aster / préAster / Aster2 / Aster_guide / Étoile / PréÉtoile / A.ster');
});
test('the private table cannot be in the copy or the source',async t=>{
  for(const where of ['root','sourceRoot']){
    const f=await fixture(t,{'Aster':'Public'});f.namesPath=path.join(f[where],'private.json');
    await fs.writeFile(f.namesPath,'{"Aster":"Public"}');await assert.rejects(run(f),{code:'names-not-external'});
  }
});

test('keeps names coherent in regex word boundaries and ordinary literals',async t=>{
  const f=await fixture(t,{'Aster':'Public'},{'matcher.mjs':String.raw`export const name='Aster', pattern=/\bAster\b/;`});
  await run(f);
  const mod=await import('file://'+path.join(f.root,'matcher.mjs'));
  assert.equal(mod.name,'Public');assert.equal(mod.pattern.test('Public'),true);assert.equal(mod.pattern.test('Aster'),false);
});
