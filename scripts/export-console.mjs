#!/usr/bin/env node
import * as fs from 'node:fs/promises';
import path from 'node:path';
import {constants} from 'node:fs';
import {guardDirectory,PublicationError,privatePath,regularPath,repositoryRoot,isMain,publicationCli} from './publish-guard.mjs';
import {renameToConsole} from './rename-to-console.mjs';
import {replacePrivateNames} from './replace-private-names.mjs';

const fail=code=>{throw new PublicationError(code);};
async function targetState(target) {
  await regularPath(target,{missing:true});
  let stat;try {stat=await fs.lstat(target);}catch(error){if(error.code==='ENOENT')return false;throw error;}
  if(!stat.isDirectory())fail('unsafe-file');
  if((await fs.readdir(target)).length)fail('target-not-empty');
  return true;
}
function manifestFiles(manifest) {
  const files=manifest?.files;
  if(manifest?.version!==1||!Array.isArray(files)||!files.length||new Set(files).size!==files.length)fail('manifest-invalid');
  for(const file of files) {
    if(typeof file!=='string'||!file||file.includes('\\')||/[\x00-\x1f\x7f]/.test(file)||path.posix.isAbsolute(file)
      ||file.split('/').some(part=>!part||part==='.'||part==='..')||privatePath(file))fail('manifest-invalid');
  }
  return files;
}

async function connectorFiles(source) {
  const base='integrations/tickets',files=[];
  await regularPath(path.join(source,base));
  for(const entry of await fs.readdir(path.join(source,base),{withFileTypes:true})) {
    if(!entry.isDirectory())continue;
    if(!/^[a-z][a-z0-9-]*$/.test(entry.name))fail('manifest-invalid');
    const prefix=base+'/'+entry.name+'/',manifest=path.join(source,prefix,'export.json');
    await regularPath(manifest);
    if(!(await fs.lstat(manifest)).isFile())fail('manifest-invalid');
    const listed=manifestFiles(JSON.parse(await fs.readFile(manifest,'utf8')));
    files.push(...listed.map(file=>prefix+file));
  }
  return files;
}

export async function exportConsole(destination,{sourceRoot=repositoryRoot,dictionaryPath=process.env.FABRIQUE_CONSOLE_GUARD_DICT,namesPath=process.env.FABRIQUE_CONSOLE_GUARD_NAMES,rename=true}={}) {
  if(!dictionaryPath)fail('dictionary-required');
  await regularPath(sourceRoot);
  const source=await fs.realpath(sourceRoot);
  const target=path.resolve(destination);
  // Never inside the source, nor the source inside it: nothing is written into the source, even before a refusal.
  if(target===source||source.startsWith(target+path.sep)||target.startsWith(source+path.sep))fail('unsafe-file');
  await targetState(target);
  const manifest=path.join(source,'export/manifest.json');
  await regularPath(manifest);
  const spec=JSON.parse(await fs.readFile(manifest,'utf8'));
  if(spec.connectorManifests!==undefined&&spec.connectorManifests!==true)fail('manifest-invalid');
  const files=[...manifestFiles(spec),...(spec.connectorManifests?await connectorFiles(source):[])];
  if(new Set(files).size!==files.length)fail('manifest-invalid');
  // Preflight every source before creating the temporary export.
  for(const file of files) {
    const from=path.join(source,file);await regularPath(from);
    if(!(await fs.lstat(from)).isFile())fail('unsafe-file');
  }
  const staging=await fs.mkdtemp(path.join(path.dirname(target),'.console-export-'));
  try {
    for(const file of files) {
      const from=path.join(source,file),to=path.join(staging,file);
      await regularPath(from); // Recheck before copying; never dereference links.
      await fs.mkdir(path.dirname(to),{recursive:true});
      const input=await fs.open(from,constants.O_RDONLY|constants.O_NOFOLLOW);
      try {
        if(!(await input.stat()).isFile())fail('unsafe-file');
        await fs.writeFile(to,await input.readFile(),{flag:'wx',mode:0o644});
      } finally {await input.close();}
    }
    // The brand is renamed in the copy only (never in the source), then the guard checks what will be published.
    if(rename)await renameToConsole(staging);
    await replacePrivateNames(staging,{sourceRoot:source,namesPath});
    const result=await guardDirectory(staging,{sourceRoot:source,dictionaryPath});
    // A nonempty target appearing while the guard ran must remain untouched.
    await targetState(target);
    await fs.chmod(staging,0o755);
    await fs.rename(staging,target);
    return result;
  } finally {await fs.rm(staging,{recursive:true,force:true});}
}
if(isMain(import.meta.url))await publicationCli(exportConsole);
