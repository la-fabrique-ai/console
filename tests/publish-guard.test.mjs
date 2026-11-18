import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const repo=fileURLToPath(new URL('../',import.meta.url));
const brand=['dv','lpr'].join(''), provider=['Lin','ear'].join('');
const secret=['gh','p_','x'.repeat(36)].join('');
async function fixture(t) {
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'console-guard-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const root=path.join(dir,'export'),dictionary=path.join(dir,'private.json');
  await fs.mkdir(root);
  await fs.writeFile(dictionary,JSON.stringify(['Projet Azur Fictif','Personne Exemple']));
  return {dir,root,dictionary};
}
async function put(root,name,content='Contenu public.\n') {
  const file=path.join(root,name);await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,content);return file;
}
function run(f,dictionary=f.dictionary) {
  const env={...process.env};delete env.FABRIQUE_CONSOLE_GUARD_DICT;
  if(dictionary!==null)env.FABRIQUE_CONSOLE_GUARD_DICT=dictionary;
  const r=spawnSync(process.execPath,[path.join(repo,'scripts/publish-guard.mjs'),f.root],{encoding:'utf8',env,shell:false});
  return {...r,body:r.stdout.trim().startsWith('{')?JSON.parse(r.stdout):null};
}
function refused(r,code='guard-rejected',rule) {
  assert.equal(r.status,1,r.stderr);assert.equal(r.body?.ok,false,r.stdout+r.stderr);
  assert.equal(r.body?.error.code,code,r.stdout);
  if(rule)assert.ok(r.body.error.findings.some(f=>f.rule===rule),r.stdout);
}

test('a clean export passes with a nonempty external synthetic dictionary',async t=>{
  const f=await fixture(t);await put(f.root,'src/main.mjs','export const ready=true;\n');
  const r=run(f);assert.equal(r.status,0,r.stderr);assert.equal(r.body.ok,true);assert.equal(r.body.files,1);
});
for(const [label,name,text] of [
  ['accent in dictionary','José','Jose'],
  ['accent in scanned text','Jose','José'],
  ['format character in dictionary','Pro\u200bjet Azur','Projet Azur'],
  ['format character in scanned text','Projet Azur','Pro\u200bjet Azur'],
  ['hyphen separator','Projet Azur','Projet-Azur'],
  ['underscore separator','Projet Azur','projet_azur'],
  ['separators in dictionary','Projet_- . Azur','projet azur'],
  ['mixed separators in scanned text','Projet Azur','PROJET_-.  AZUR'],
  ['compatibility decomposition','Projet Azur','Ｐｒｏｊｅｔ Ａｚｕｒ']
])for(const location of ['content','path'])test(`private names use canonical matching: ${label} in ${location}`,async t=>{
  const f=await fixture(t);await fs.writeFile(f.dictionary,JSON.stringify([name]));
  await put(f.root,location==='path'?`${text}.txt`:'public.txt',location==='content'?text:'Contenu public.');
  const r=run(f);refused(r,'guard-rejected','private-name');
  assert.ok(r.body.error.findings.some(finding=>finding.rule==='private-name'&&finding.location===location),r.stdout);
  assert.ok(!r.stdout.includes(name));assert.ok(!r.stdout.includes(text));assert.equal(r.stderr,'');
});
for(const [name,text,rule] of [
  ['private content','Projet Azur Fictif','private-name'],
  ['private content with different case','PERSONNE EXEMPLE','private-name'],
  ['brand content',brand.toUpperCase(),'brand'],
  ['provider outside connector',provider,'ticket-system'],
  ['known token format',secret,'secret'],
  ['private key header',['-----BEGIN ','PRIVATE KEY-----'].join(''),'secret']
])test(`guard rejects ${name} without disclosing the match`,async t=>{
  const f=await fixture(t);await put(f.root,'src/main.mjs',text);
  const r=run(f);refused(r,'guard-rejected',rule);assert.ok(!r.stdout.includes(text));assert.equal(r.stderr,'');
});
for(const [name,rule] of [
  ['Projet Azur Fictif/clean.txt','private-name'],
  [brand.toUpperCase()+'/clean.txt','brand'],
  [provider+'/clean.txt','ticket-system'],
  ['.git/config','private-path'],['docs/local/a.txt','private-path'],
  ['mods/panel/runtime.json','private-path']
])test(`guard rejects prohibited path (${rule})`,async t=>{
  const f=await fixture(t);await put(f.root,name);refused(run(f),'guard-rejected',rule);
});
test('empty prohibited directories are scanned too',async t=>{
  const f=await fixture(t);await fs.mkdir(path.join(f.root,'Personne Exemple'));refused(run(f),'guard-rejected','private-name');
});
test('provider names are allowed only under a connector root',async t=>{
  const f=await fixture(t);await put(f.root,`integrations/tickets/${provider.toLowerCase()}/README.md`,provider);
  assert.equal(run(f).status,0);await put(f.root,'docs/integrations/tickets/demo.md',provider);refused(run(f),'guard-rejected','ticket-system');
});
test('connector exception never permits brand, private names or secrets',async t=>{
  for(const text of [brand,'Projet Azur Fictif',secret]) {
    const f=await fixture(t);await put(f.root,'integrations/tickets/demo/main.mjs',text);refused(run(f));
  }
});
for(const [name,content,code] of [
  ['missing variable',null,'dictionary-required'],['empty JSON array','[]','dictionary-invalid'],
  ['empty file','','dictionary-invalid'],['blank name','[" "]','dictionary-invalid'],
  ['nonstring name','[12]','dictionary-invalid'],['malformed JSON','{','dictionary-invalid']
])test(`guard fails closed for ${name}`,async t=>{
  const f=await fixture(t);if(content!==null)await fs.writeFile(f.dictionary,content);
  refused(run(f,content===null?null:f.dictionary),code);
});
test('unreadable dictionary fails closed without its path in output',async t=>{
  const f=await fixture(t);refused(run(f,path.join(f.dir,'absent.json')),'dictionary-invalid');
});
for(const name of ['AB','é','a\u200bb','\u200b','__a..','𐐀𐐁'])test('dictionary entries shorter than three canonical characters fail clearly',async t=>{
  const f=await fixture(t);await fs.writeFile(f.dictionary,JSON.stringify(['Nom valide',name]));
  await put(f.root,'public.txt');const r=run(f);refused(r,'dictionary-entry-too-short');
  assert.ok(!r.stdout.includes(name));assert.ok(!r.stdout.includes(f.dictionary));assert.equal(r.stderr,'');
});
test('three canonical characters remain valid dictionary entries',async t=>{
  const f=await fixture(t);await fs.writeFile(f.dictionary,JSON.stringify(['Été']));
  await put(f.root,'public.txt');assert.equal(run(f).status,0);
  await put(f.root,'public.txt','ETE');refused(run(f),'guard-rejected','private-name');
});
for(const [label,text] of [
  ['JWT',['eyJhbGciOiJIUzI1NiJ9','eyJzdWIiOiJmaWN0aWYifQ','c2lnbmF0dXJl'].join('.')],
  ['Bearer',['Bearer','synthetic-token_123+/=='].join(' ')],
  ['password assignment',['pass','word=synthetic'].join('')],
  ['credential URL',['https:','//','synthetic:example@host.invalid/path'].join('')],
  ['Google API key',['AI','za','x'.repeat(35)].join('')]
])for(const location of label==='credential URL'?['content']:['content','path'])test(`guard rejects ${label} in ${location} without disclosing it`,async t=>{
  const f=await fixture(t);
  await put(f.root,location==='path'?text+'.txt':'public.txt',location==='content'?text:'Contenu public.');
  const r=run(f);refused(r,'guard-rejected','secret');
  assert.ok(r.body.error.findings.some(finding=>finding.rule==='secret'&&finding.location===location),r.stdout);
  assert.ok(!r.stdout.includes(text));assert.equal(r.stderr,'');
});
test('dictionary inside the scanned export is refused',async t=>{
  const f=await fixture(t);const file=await put(f.root,'dictionary.json','["Exemple fictif"]');
  refused(run(f,file),'dictionary-not-external');
});
test('dictionary inside the source repository is refused',async t=>{
  const f=await fixture(t);refused(run(f,path.join(repo,'tests/fixtures/publish-guard-dictionary.example.json')),'dictionary-not-external');
});
test('links cannot hide files from the guard',async t=>{
  const f=await fixture(t);await fs.symlink(f.dictionary,path.join(f.root,'linked'));refused(run(f),'unsafe-file');
});
test('binary extensions and wide encoded text do not bypass content checks',async t=>{
  const f=await fixture(t);await put(f.root,'asset.bin',Buffer.from(brand.toUpperCase(),'utf16le'));refused(run(f),'guard-rejected','brand');
});
test('license exceptions require an exact path and exact contents',async t=>{
  const f=await fixture(t),rel='vendor/herdr-sim/LICENSE';
  const license=await fs.readFile(path.join(repo,rel));await put(f.root,rel,license);
  await fs.writeFile(f.dictionary,'["SOFTWARE"]');assert.equal(run(f).status,0);
  await put(f.root,rel,Buffer.concat([license,Buffer.from('\nSOFTWARE changed\n')]));refused(run(f),'guard-rejected','private-name');
  await put(f.root,rel,license);await put(f.root,'vendor/other/LICENSE',license);refused(run(f),'guard-rejected','private-name');
});
for(const name of ['docs/local','config/local'])test('empty private directories cannot be published',async t=>{
  const f=await fixture(t);await fs.mkdir(path.join(f.root,name),{recursive:true});refused(run(f),'guard-rejected','private-path');
});
for(const prefix of ['bundle/','bundle/packages/'])for(const name of ['docs/local','config/local']) {
  for(const empty of [true,false])test(`nested private directories are rejected: ${prefix}${name} (${empty?'empty':'file'})`,async t=>{
    const f=await fixture(t),relative=prefix+name;
    if(empty)await fs.mkdir(path.join(f.root,relative),{recursive:true});
    else await put(f.root,relative+'/note.txt');
    refused(run(f),'guard-rejected','private-path');
  });
}
test('similarly named public directories remain allowed',async t=>{
  const f=await fixture(t);
  for(const name of ['bundle/docs/locality','bundle/config/local-example','bundle/mydocs/local'])await put(f.root,name+'/note.txt');
  assert.equal(run(f).status,0);
});

test('the exact native gradient API is allowed while surrounding provider references stay forbidden',async t=>{
  const f=await fixture(t);
  await put(f.root,'main.js',['Background.li','near_gradient(0, [])'].join(''));
  assert.equal(run(f).status,0);
  await put(f.root,'main.js',['Background.li','near_gradient(0, []); // ',provider].join(''));
  refused(run(f),'guard-rejected','ticket-system');
});
