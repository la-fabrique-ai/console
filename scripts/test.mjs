import { spawn } from 'node:child_process';
import { mkdtemp,mkdir,writeFile,readdir,access,rm } from 'node:fs/promises';
import { constants } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,resolve } from 'node:path';

// Restore config isolation at the executable boundary, after production has
// deliberately stripped all inherited GIT_* overrides. Never change HOME.
async function gitExecutable() {
  for(const directory of (process.env.PATH??'').split(':')) {
    const path=resolve(directory,'git');
    try{await access(path,constants.X_OK);return path;}catch{}
  }
  throw new Error('Git is required to run the tests.');
}
const root=await mkdtemp(join(tmpdir(),'fabrique-console-test-git-'));
try {
  const binary=await gitExecutable(),bin=join(root,'bin');await mkdir(bin);
  const quote=value=>"'"+value.replaceAll("'","'\\''")+"'";
  const wrapper=join(bin,'git');
  await writeFile(wrapper,'#!/bin/sh\nexec /usr/bin/env GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_SYSTEM=/dev/null GIT_CONFIG_GLOBAL=/dev/null '+quote(binary)+' "$@"\n',{mode:0o700});
  async function connectorTests(folder){
    const found=[];
    for(const entry of await readdir(folder,{withFileTypes:true})) {
      const file=join(folder,entry.name);
      if(entry.isDirectory())found.push(...await connectorTests(file));
      else if(entry.isFile()&&entry.name.endsWith('.test.mjs'))found.push(file);
    }
    return found;
  }
  const supplied=process.argv.slice(2),files=supplied.length?supplied:[...(await readdir('tests')).filter(name=>name.endsWith('.test.mjs')).sort().map(name=>join('tests',name)),...await connectorTests('integrations/tickets')];
  const inherited=Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith('GIT_')));
  const child=spawn(process.execPath,['--test',...files],{shell:false,stdio:'inherit',env:{...inherited,PATH:bin+':'+process.env.PATH,FABRIQUE_CONSOLE_TEST_GIT:wrapper}});
  const outcome=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',(code,signal)=>resolve({code,signal}));});
  process.exitCode=outcome.code??1;
}finally{await rm(root,{recursive:true,force:true});}
