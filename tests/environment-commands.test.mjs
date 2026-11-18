// M6 (a): the commands environment-check {project} and environment-enroll {project, container, docker?, socket?}.
// The enrollment is the user's (decisions 70 and 76): refused from a session of an agent the tool launched, before
// anything is read or written. The check reads only; its result lives in the state folder of Mission Control.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBackend } from '../src/backend.mjs';
import { configV2 } from './helpers/config-v2-fixture.mjs';
import { sampleEnvironment } from './helpers/environment-sample.mjs';

function fixture(t,{environment=sampleEnvironment()}={}) {
  const dir=realpathSync(mkdtempSync(join(tmpdir(),'mc-env-c-')));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const root=join(dir,'state');mkdirSync(root);
  const config=configV2();config.projects[0].repos.splice(1);config.projects[0].repos[0].path=join(dir,'repo');
  if(environment)config.projects[0].environment=environment;
  writeFileSync(join(root,'config.json'),JSON.stringify(config));
  return {dir,root};
}

test('environment-enroll from a session of an agent: AGENT_SESSION, nothing read, nothing written',async t=>{
  const {root}=fixture(t);
  const backend=createBackend({root,env:{FABRIQUE_CONSOLE_AGENT:'1'},traceAgents:false});
  await assert.rejects(backend.dispatch('environment-enroll',{project:'example',container:'beta-db'}),{code:'AGENT_SESSION'});
  assert.equal(existsSync(join(root,'environment')),false);
});

test('environment-check through the backend: a project without environment is « not declared », never green',async t=>{
  const {root}=fixture(t,{environment:null});
  const backend=createBackend({root,env:{},traceAgents:false});
  const result=await backend.dispatch('environment-check',{project:'example'});
  assert.equal(result.status,'not-declared');assert.equal(result.green,false);
  assert.deepEqual(JSON.parse(readFileSync(join(root,'environment','example','last.json'),'utf8')).status,'not-declared');
  await assert.rejects(backend.dispatch('environment-check',{project:'nope'}),{code:'NOT_FOUND'});
  await assert.rejects(backend.dispatch('environment-check',{project:'../x'}),{code:'INVALID_ARGUMENT'});
});
