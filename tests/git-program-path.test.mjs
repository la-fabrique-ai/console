import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fixture } from './helpers/backend-fixture.mjs';
import { createCommands } from '../src/commands.mjs';

test('an absolute Git program path cannot inherit a different repository from GIT_DIR',async t=>{
  const f=await fixture(t),path=join(f.root,'not-git');await mkdir(path);
  const previous={GIT_DIR:process.env.GIT_DIR,GIT_WORK_TREE:process.env.GIT_WORK_TREE};
  process.env.GIT_DIR=join(f.repo,'.git');process.env.GIT_WORK_TREE=path;
  try {
    const {invoke}=createCommands({exec:f.command});
    await assert.rejects(invoke(process.env.FABRIQUE_CONSOLE_TEST_GIT??'/usr/bin/git',['-C',path,'rev-parse','--show-toplevel']),error=>error.code===128);
  }finally{for(const [key,value] of Object.entries(previous))if(value===undefined)delete process.env[key];else process.env[key]=value;}
});
