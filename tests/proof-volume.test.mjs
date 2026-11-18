import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir,writeFile,readFile } from 'node:fs/promises';
import { join,delimiter } from 'node:path';
import { pathToFileURL } from 'node:url';
import { fixture } from './helpers/backend-fixture.mjs';
import { captureCode } from '../src/proof-code.mjs';

async function directories(root,count,{prefix,files=false}={}) {
  for(let start=0;start<count;start+=100)await Promise.all(Array.from({length:Math.min(100,count-start)},async(_,offset)=>{
    const folder=join(root,prefix+(start+offset));await mkdir(folder);
    if(files)await writeFile(join(folder,'code.txt'),'fixture\n');
  }));
}

test('3000 populated directories need bounded Git processes while the explicit 10000-entry traversal limit remains unknown',async t=>{
  const f=await fixture(t);await directories(f.repo,3000,{prefix:'code-',files:true});
  const bin=join(f.root,'counted-bin'),counter=join(f.root,'git-count');await mkdir(bin);await writeFile(counter,'0\n');
  const originalGit=process.env.FABRIQUE_CONSOLE_TEST_GIT??(await f.command('which',['git'])).stdout.trim();
  const quote=value=>"'"+value.replaceAll("'","'\\''")+"'";
  await writeFile(join(bin,'git'),[
    '#!/bin/sh',`task_count=$(/bin/cat ${quote(counter)})`,'task_count=$((task_count+1))',
    `printf '%s\\n' "$task_count" > ${quote(counter)}`,
    'if [ "$task_count" -gt 32 ]; then exit 125; fi',`exec ${quote(originalGit)} "$@"`,'',
  ].join('\n'),{mode:0o700});
  const previousPath=process.env.PATH,start=performance.now();let measured;
  process.env.PATH=bin+delimiter+previousPath;
  // Prove bounded subprocess cost rather than relying on scheduler load. The
  // ordinary production deadline remains 8 s; only this volume probe allows 30.
  try{measured=await captureCode(f.repo,{deadline:Date.now()+30000});}
  finally{process.env.PATH=previousPath;}
  const calls=Number(await readFile(counter,'utf8'));
  t.diagnostic('3000 directories / 3000 files, two samples: '+Math.round(performance.now()-start)+' ms, '+calls+' Git processes');
  assert.ok(calls<=32,'Git process cost must stay bounded independently of the 3000 directories.');
  assert.ok(measured.stateHash,'The full volume must remain measurable, without one Git process per directory.');
  assert.equal(measured.sha,f.base);assert.equal(measured.dirty,true);
  // 3000 directories + 3000 files + 4001 empty directories exceed the declared cap.
  await directories(f.repo,4001,{prefix:'extra-'});
  const overLimit=await captureCode(f.repo);assert.equal(overLimit.stateHash,null);assert.equal(overLimit.reason,'QA_CODE_UNREADABLE');
});

test('an untracked empty directory leaves the Git working-set fingerprint unchanged',async t=>{
  const f=await fixture(t),before=await captureCode(f.repo);await mkdir(join(f.repo,'empty'));
  const after=await captureCode(f.repo);assert.ok(after.stateHash);assert.equal(after.stateHash,before.stateHash);assert.equal(after.dirty,false);
});

test('ignored populated directories are pruned while a nonignored special file is still detected',async t=>{
  const f=await fixture(t);await writeFile(join(f.repo,'.gitignore'),'cache/\n');await mkdir(join(f.repo,'cache'));
  await directories(join(f.repo,'cache'),3000,{prefix:'ignored-',files:true});
  await f.command('mkfifo',[join(f.repo,'cache','ignored-pipe')]);
  const known=await captureCode(f.repo);assert.ok(known.stateHash);
  await mkdir(join(f.repo,'nested'));await mkdir(join(f.repo,'nested','deep'));
  await f.command('mkfifo',[join(f.repo,'nested','deep','unknown-pipe')]);
  assert.equal((await captureCode(f.repo)).stateHash,null);
});

test('compacted ignored contents cannot hide a special file unignored by a negation',async t=>{
  const f=await fixture(t);await writeFile(join(f.repo,'.gitignore'),'partial/*\n!partial/keep-pipe\n');
  await mkdir(join(f.repo,'partial'));await writeFile(join(f.repo,'partial','ignored.txt'),'ignored\n');
  assert.ok((await captureCode(f.repo)).stateHash);
  await f.command('mkfifo',[join(f.repo,'partial','keep-pipe')]);
  assert.equal((await captureCode(f.repo)).stateHash,null);
});

test('replacing a regular file with a FIFO exactly before open cannot block the observer',async t=>{
  const f=await fixture(t),target=join(f.repo,'race.txt'),marker=join(f.root,'swapped');
  await writeFile(target,'regular\n');await f.command('git',['-C',f.repo,'add','race.txt']);
  await f.command('git',['-C',f.repo,'-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-m','fixture']);
  const wrapper=join(f.root,'race-fs.mjs'),loader=join(f.root,'race-loader.mjs');
  // Fault injection changes the filesystem at the real open boundary; the
  // actual kernel open/fstat remain in use, including their nonblocking flags.
  await writeFile(wrapper,`import * as fs from 'node:fs/promises';import{execFileSync}from'node:child_process';export * from 'node:fs/promises';let swapped=false;
    export async function open(path,...args){if(path===${JSON.stringify(target)}&&!swapped){swapped=true;await fs.unlink(path);execFileSync('mkfifo',[path]);await fs.writeFile(${JSON.stringify(marker)},'swapped');}return fs.open(path,...args);}`);
  const codeURL=new URL('../src/proof-code.mjs',import.meta.url).href;
  await writeFile(loader,`export async function resolve(name,context,next){if(name==='node:fs/promises'&&context.parentURL===${JSON.stringify(codeURL)})return {url:${JSON.stringify(pathToFileURL(wrapper).href)},shortCircuit:true};return next(name,context);}`);
  const script=`import{captureCode}from ${JSON.stringify(codeURL)};console.log(JSON.stringify(await captureCode(${JSON.stringify(f.repo)})));`;
  const result=await f.command(process.execPath,['--loader',pathToFileURL(loader).href,'--input-type=module','-e',script],{timeout:3000});
  assert.equal(await readFile(marker,'utf8'),'swapped');assert.equal(JSON.parse(result.stdout).stateHash,null);
});
