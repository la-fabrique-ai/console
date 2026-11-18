import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';

const repo=fileURLToPath(new URL('../',import.meta.url));
const exporter=()=>import('../scripts/export-console.mjs');
async function fixture(t,files=['src/main.mjs']) {
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'console-export-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const sourceRoot=path.join(dir,'source'),target=path.join(dir,'public'),dictionaryPath=path.join(dir,'private.json'),namesPath=path.join(dir,'names.json');
  await fs.mkdir(path.join(sourceRoot,'export'),{recursive:true});await fs.mkdir(path.join(sourceRoot,'src'));
  await fs.writeFile(path.join(sourceRoot,'export/manifest.json'),JSON.stringify({version:1,files}));
  await fs.writeFile(path.join(sourceRoot,'src/main.mjs'),'export const ready=true;\n');
  await fs.writeFile(dictionaryPath,'["Projet Azur Fictif"]');
  await fs.writeFile(namesPath,JSON.stringify({'Nom Synthétique':'Nom Public'}));
  return {dir,sourceRoot,target,dictionaryPath,namesPath};
}
async function run(f) {const {exportConsole}=await exporter();return exportConsole(f.target,f);}
async function siblings(f) {return (await fs.readdir(f.dir)).sort();}

test('export copies only explicitly listed files without history or unlisted additions',async t=>{
  const f=await fixture(t);await fs.mkdir(path.join(f.sourceRoot,'.git'));await fs.writeFile(path.join(f.sourceRoot,'.git/config'),'private');
  await fs.writeFile(path.join(f.sourceRoot,'src/unlisted.mjs'),'private');
  await run(f);assert.deepEqual(await fs.readdir(f.target),['src']);
  assert.deepEqual(await fs.readdir(path.join(f.target,'src')),['main.mjs']);
  assert.equal(await fs.readFile(path.join(f.target,'src/main.mjs'),'utf8'),'export const ready=true;\n');
  assert.deepEqual(await siblings(f),['names.json','private.json','public','source']);
});
test('export accepts an existing empty destination',async t=>{
  const f=await fixture(t);await fs.mkdir(f.target);await run(f);assert.ok((await fs.stat(path.join(f.target,'src/main.mjs'))).isFile());
});
test('the published root is readable and traversable by other users',async t=>{
  const f=await fixture(t);await run(f);
  assert.equal((await fs.stat(f.target)).mode&0o777,0o755);
});
test('export refuses even hidden contents and preserves them',async t=>{
  const f=await fixture(t);await fs.mkdir(f.target);await fs.writeFile(path.join(f.target,'.keep'),'keep');
  await assert.rejects(run(f),{code:'target-not-empty'});assert.deepEqual(await fs.readdir(f.target),['.keep']);
  assert.equal(await fs.readFile(path.join(f.target,'.keep'),'utf8'),'keep');
});
for(const existing of [false,true])test(`guard failure leaves ${existing?'empty target intact':'no destination'} or staging files`,async t=>{
  const f=await fixture(t);if(existing)await fs.mkdir(f.target);const before=await siblings(f);
  await fs.writeFile(path.join(f.sourceRoot,'src/main.mjs'),'Projet Azur Fictif');
  await assert.rejects(run(f),{code:'guard-rejected'});assert.deepEqual(await siblings(f),before);
  if(existing)assert.deepEqual(await fs.readdir(f.target),[]);
});
test('missing dictionary aborts before publishing any files',async t=>{
  const f=await fixture(t);await fs.rm(f.dictionaryPath);const before=await siblings(f);
  await assert.rejects(run(f),{code:'dictionary-invalid'});assert.deepEqual(await siblings(f),before);
});
for(const item of ['../escape','/etc/passwd','src/../outside','src\\outside','src/','src','src/main.mjs\u0000']) {
  test('unsafe manifest entries cannot escape or recursively copy directories',async t=>{
    const f=await fixture(t,[item]);await assert.rejects(run(f));assert.deepEqual(await siblings(f),['names.json','private.json','source']);
  });
}
for(const item of ['.git/config','.claude/output/note.md','docs/local/capture.png','reference/note.md','catalog/data.json','preuves/a.txt','simulation/a.mjs','mods/example/runtime.json','config/real.local.json']) {
  test('private artifacts cannot be added to the export manifest',async t=>{
    const f=await fixture(t,[item]);await assert.rejects(run(f),{code:'manifest-invalid'});
  });
}
test('duplicate and empty manifests are rejected',async t=>{
  for(const files of [[],['src/main.mjs','src/main.mjs']]){
    const f=await fixture(t,files);await assert.rejects(run(f),{code:'manifest-invalid'});
  }
});
for(const prefix of ['','bundle/','bundle/packages/'])for(const name of ['docs/local','config/local']) {
  test(`nested private manifest paths are rejected before source reads: ${prefix}${name}`,async t=>{
    const f=await fixture(t,[`${prefix}${name}/note.txt`]);
    await assert.rejects(run(f),{code:'manifest-invalid'});
    assert.deepEqual(await siblings(f),['names.json','private.json','source']);
  });
}
test('missing listed source removes staging and preserves empty target',async t=>{
  const f=await fixture(t,['src/main.mjs','src/missing.mjs']);await fs.mkdir(f.target);const before=await siblings(f);
  await assert.rejects(run(f));assert.deepEqual(await siblings(f),before);assert.deepEqual(await fs.readdir(f.target),[]);
});
test('source symlinks and symlink directories are refused',async t=>{
  for(const directory of [false,true]) {
    const f=await fixture(t);if(directory){await fs.rename(path.join(f.sourceRoot,'src'),path.join(f.dir,'outside'));await fs.symlink(path.join(f.dir,'outside'),path.join(f.sourceRoot,'src'));}
    else {await fs.rm(path.join(f.sourceRoot,'src/main.mjs'));await fs.symlink(f.dictionaryPath,path.join(f.sourceRoot,'src/main.mjs'));}
    await assert.rejects(run(f),{code:'unsafe-file'});assert.deepEqual(await fs.readdir(f.sourceRoot),['export','src']);
  }
});
test('destination symlinks cannot redirect the export',async t=>{
  const f=await fixture(t);const outside=path.join(f.dir,'outside');await fs.mkdir(outside);await fs.symlink(outside,f.target);
  await assert.rejects(run(f),{code:'unsafe-file'});assert.deepEqual(await fs.readdir(outside),[]);
});
test('a dictionary stored inside the source is refused',async t=>{
  const f=await fixture(t);f.dictionaryPath=path.join(f.sourceRoot,'private.json');await fs.writeFile(f.dictionaryPath,'["Fictif"]');
  await assert.rejects(run(f),{code:'dictionary-not-external'});
});
test('the export CLI fails closed without the required dictionary',async t=>{
  const f=await fixture(t),env={...process.env};delete env.FABRIQUE_CONSOLE_GUARD_DICT;
  const r=spawnSync(process.execPath,[path.join(repo,'scripts/export-console.mjs'),f.target],{encoding:'utf8',shell:false,env});
  assert.equal(r.status,1,r.stderr);const body=JSON.parse(r.stdout);assert.equal(body.ok,false);assert.equal(body.error.code,'dictionary-required');
  assert.deepEqual(await siblings(f),['names.json','private.json','source']);
});
test('connector-owned export manifests keep provider file lists within each connector',async t=>{
  const f=await fixture(t),connector='integrations/tickets/example';
  await fs.mkdir(path.join(f.sourceRoot,connector),{recursive:true});
  await fs.writeFile(path.join(f.sourceRoot,'export/manifest.json'),JSON.stringify({version:1,files:['src/main.mjs'],connectorManifests:true}));
  await fs.writeFile(path.join(f.sourceRoot,connector,'export.json'),JSON.stringify({version:1,files:['entry.mjs']}));
  await fs.writeFile(path.join(f.sourceRoot,connector,'entry.mjs'),'export const adapter=true;');
  await run(f);assert.equal(await fs.readFile(path.join(f.target,connector,'entry.mjs'),'utf8'),'export const adapter=true;');
});
test('a connector export manifest cannot escape its own directory',async t=>{
  const f=await fixture(t),connector='integrations/tickets/example';await fs.mkdir(path.join(f.sourceRoot,connector),{recursive:true});
  await fs.writeFile(path.join(f.sourceRoot,'export/manifest.json'),JSON.stringify({version:1,files:['src/main.mjs'],connectorManifests:true}));
  await fs.writeFile(path.join(f.sourceRoot,connector,'export.json'),JSON.stringify({version:1,files:['../../../src/main.mjs']}));
  await assert.rejects(run(f),{code:'manifest-invalid'});await assert.rejects(fs.stat(f.target),{code:'ENOENT'});
});
test('the complete real manifest exports successfully and passes the publication guard',{skip:process.env.CONSOLE_EXPORT_CHILD==='1'},async t=>{
  const f=await fixture(t),{exportConsole}=await exporter();
  const {guardDirectory}=await import('../scripts/publish-guard.mjs');
  // The dictionary must not forbid the synthetic names present in exported regression fixtures.
  await fs.writeFile(f.dictionaryPath,JSON.stringify(['Absent synthetic '+randomUUID()]));
  const manifest=JSON.parse(await fs.readFile(path.join(repo,'export/manifest.json'),'utf8'));
  let result;
  try {result=await exportConsole(f.target,{sourceRoot:repo,dictionaryPath:f.dictionaryPath,namesPath:f.namesPath});}
  catch(error) {assert.fail(`Real export rejected: ${error.code??'unknown'}`);}
  const connectors=await fs.readdir(path.join(repo,'integrations/tickets'),{withFileTypes:true});
  let count=manifest.files.length;
  for(const entry of connectors.filter(entry=>entry.isDirectory()))count+=JSON.parse(await fs.readFile(path.join(repo,'integrations/tickets',entry.name,'export.json'),'utf8')).files.length;
  assert.equal(result.ok,true);assert.equal(result.files,count);
  const guarded=await guardDirectory(f.target,{sourceRoot:repo,dictionaryPath:f.dictionaryPath,namesPath:f.namesPath});
  assert.equal(guarded.ok,true);assert.equal(guarded.files,count);
  const child=spawnSync(process.execPath,['--test','tests/export-console.test.mjs'],{cwd:f.target,encoding:'utf8',shell:false,env:{...process.env,CONSOLE_EXPORT_CHILD:'1',FABRIQUE_CONSOLE_GUARD_DICT:'',FABRIQUE_CONSOLE_GUARD_NAMES:''}});
  assert.equal(child.status,0,'Exported tooling tests must run: '+child.stderr+'\n'+child.stdout);
});

test('private names are replaced only in the copy, in paths and contents after brand renaming',async t=>{
  const f=await fixture(t,['src/fabrique-console-Projet Azur Fictif.mjs']);
  await fs.writeFile(f.namesPath,JSON.stringify({'Projet Azur Fictif':'Projet Public'}));
  await fs.writeFile(path.join(f.sourceRoot,'src/fabrique-console-Projet Azur Fictif.mjs'),'Projet Azur Fictif');
  await run(f);
  assert.equal(await fs.readFile(path.join(f.target,'src/fabrique-console-Projet Public.mjs'),'utf8'),'Projet Public');
  assert.equal(await fs.readFile(path.join(f.sourceRoot,'src/fabrique-console-Projet Azur Fictif.mjs'),'utf8'),'Projet Azur Fictif');
});
for(const value of [undefined,'missing','inside-source','inside-target'])test(`private names table fails closed: ${value??'no variable'}`,async t=>{
  const f=await fixture(t);await fs.mkdir(f.target);
  let code='names-invalid';
  if(value===undefined){f.namesPath='';code='names-required';}
  if(value==='missing')await fs.rm(f.namesPath);
  if(value==='inside-source'||value==='inside-target'){
    f.namesPath=path.join(value==='inside-source'?f.sourceRoot:f.target,'names.json');
    await fs.writeFile(f.namesPath,'{"Old Example":"New Example"}');code=value==='inside-target'?'target-not-empty':'names-not-external';
  }
  const before=await siblings(f);
  await assert.rejects(run(f),{code});assert.deepEqual(await siblings(f),before);
});
test('an export target inside the source is refused before anything is written',async t=>{
  const f=await fixture(t),{exportConsole}=await exporter();
  const inside=path.join(f.sourceRoot,'nested-export');
  await assert.rejects(exportConsole(inside,{sourceRoot:f.sourceRoot,dictionaryPath:f.dictionaryPath,rename:false}),{code:'unsafe-file'});
  await assert.rejects(fs.stat(inside),{code:'ENOENT'});
  assert.deepEqual((await fs.readdir(f.sourceRoot)).filter(n=>n.startsWith('.console-export-')),[]);
});
