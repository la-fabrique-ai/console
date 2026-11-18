import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { validateConfig } from '../src/config.mjs';
import { configV2 } from './helpers/config-v2-fixture.mjs';

const proposal=JSON.parse(await readFile(new URL('./fixtures/qa-profile-proposal-v2.json',import.meta.url),'utf8'));
function configuredCopy(fragment){
  const config=structuredClone(configV2()),project=config.projects[0],repository=project.repos[0];
  config.projects=fragment.projects.map(item=>({
    ...project,key:item.key,name:item.key,teamId:'fixture-'+item.key,
    repos:item.repos.map(repo=>({...repository,key:repo.key,path:repo.path,tests:structuredClone(repo.tests??{})})),
  }));
  return config;
}
function validateUnchanged(fragment){
  const before=structuredClone(fragment),copy=configuredCopy(fragment),result=validateConfig(copy);
  assert.deepEqual(fragment,before,'Validation must not mutate the delivered fragment.');
  for(const [index,project] of fragment.projects.entries())for(const [r,repo] of project.repos.entries()){
    const tests=JSON.parse(JSON.stringify(result.projects[index].repos[r].tests));
    assert.deepEqual(tests,repo.tests??{},'The exact proposed profile values must be accepted without conversion.');
  }
  return result;
}
const rows=fragment=>fragment.projects.flatMap(project=>project.repos.map(repo=>({project:project.key,repo:repo.key,tests:repo.tests??null})));

test('all proposed per-repository argv profiles validate unchanged in an isolated synthetic V2 configuration',()=>{
  const result=validateUnchanged(proposal);assert.equal(result.version,2);
  assert.deepEqual(proposal.projects.map(p=>p.key),['alpha','gamma','delta','beta','lba']);
  const repositories=proposal.projects.flatMap(project=>project.repos);
  assert.equal(repositories.length,15);assert.equal(repositories.reduce((sum,r)=>sum+Object.keys(r.tests??{}).length,0),27);
});

test('the fragment proposes no unknown settings, empty profile, shell wrapper or fabricated suite runner',()=>{
  assert.deepEqual(Object.keys(proposal),['projects']);
  for(const project of proposal.projects){
    assert.deepEqual(Object.keys(project).sort(),['key','repos']);
    for(const repo of project.repos){
      assert.ok(repo.path.startsWith('/example/repos/'),'Only portable example paths belong in the tracked fixture.');
      assert.ok(Object.keys(repo).every(key=>['key','path','tests'].includes(key)));
      if(repo.tests)assert.ok(Object.keys(repo.tests).length>=1&&Object.keys(repo.tests).length<=3);
      for(const profile of Object.values(repo.tests??{})){
        assert.deepEqual(Object.keys(profile).sort(),['argv','terminal','timeoutMs']);
        assert.ok(['node','pnpm','flutter','dart'].includes(profile.argv[0]));
        assert.equal(profile.argv.some(arg=>['-e','--eval','-c','&&',';','|'].includes(arg)),false);
        assert.equal(profile.terminal,true);assert.ok(profile.timeoutMs>=100&&profile.timeoutMs<=3600000);
      }
    }
  }
});

test('the real V2 validator still rejects shell wrappers and unsupported multi-step profile shapes',()=>{
  const shell=configuredCopy(proposal);shell.projects[0].repos[0].tests.rapide.argv=['bash','-c','echo unsafe'];
  assert.throws(()=>validateConfig(shell),{code:'INVALID_CONFIG'});
  const steps=configuredCopy(proposal);steps.projects[0].repos[0].tests.rapide.steps=[['node','--test']];
  assert.throws(()=>validateConfig(steps),{code:'INVALID_CONFIG'});
});

test('a proposal fragment cannot be mistaken for a full replacement configuration',()=>{
  assert.throws(()=>validateConfig(proposal),{code:'INVALID_CONFIG'});
});

test('the delivered private proposal contains the same profiles and validates on the synthetic copy',{skip:!process.env.FABRIQUE_CONSOLE_QA_PROFILES_PROPOSAL},async()=>{
  const path=process.env.FABRIQUE_CONSOLE_QA_PROFILES_PROPOSAL;
  assert.equal(basename(path),'fabrique-console-mc-v2-etape8a-profils.json');
  const actual=JSON.parse(await readFile(path,'utf8'));
  validateUnchanged(actual);assert.deepEqual(rows(actual),rows(proposal));
});
