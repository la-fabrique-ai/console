import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { readSources,inspectInterface,verifyReference,renderReference } from '../scripts/interface-reference.mjs';

const root=new URL('../',import.meta.url);
async function fixture() {
  const reference=JSON.parse(await readFile(new URL('docs/backend-interface.json',root),'utf8'));
  return {reference,sources:await readSources(root)};
}
test('the backend reference covers every action and code in both directions and its Markdown is current',async()=>{
  const {reference,sources}=await fixture();verifyReference(reference,sources);
  assert.equal(await readFile(new URL('docs/backend-interface.md',root),'utf8'),renderReference(reference));
});
test('an undocumented backend action, undocumented code, or ghost entry fails reference validation',async()=>{
  const {reference,sources}=await fixture();
  const action=new Map(sources);action.set('src/backend.mjs',action.get('src/backend.mjs').replace("['read-config',","['undocumented-action',()=>{}], ['read-config',"));
  assert.throws(()=>verifyReference(reference,action),/actions/);
  const code=new Map(sources);code.set('src/projects.mjs',code.get('src/projects.mjs')+"\nfail('UNDOCUMENTED_REFUSAL','fixture');\n");
  assert.throws(()=>verifyReference(reference,code),/codes/);
  const ghost=structuredClone(reference);ghost.codes.GHOST_REFUSAL={description:'fixture',handling:'fixture'};
  assert.throws(()=>verifyReference(ghost,sources),/codes/);
  const extra=structuredClone(reference);extra.actions['ghost-action']=structuredClone(extra.actions['read-config']);
  assert.throws(()=>verifyReference(extra,sources),/actions/);
});
test('nonliteral error emission cannot be introduced without explicit documentation',async()=>{
  const {reference,sources}=await fixture(),changed=new Map(sources);
  changed.set('src/projects.mjs',changed.get('src/projects.mjs')+'\nfail(unreviewedCode(),"fixture");\n');
  assert.throws(()=>verifyReference(reference,changed),/expressions/);
  const returned=new Map(sources);returned.set('src/projects.mjs',returned.get('src/projects.mjs')+'\nconst refusalObject={code: unreviewedCode()};\n');
  assert.throws(()=>verifyReference(reference,returned),/expressions/);
  const quoted=new Map(sources);quoted.set('src/projects.mjs',quoted.get('src/projects.mjs')+'\nconst refusalObject={"code": unreviewedCode()};\n');
  assert.throws(()=>verifyReference(reference,quoted),/expressions/);
  const inventory=inspectInterface(sources,reference.nonErrorLiterals);
  assert.ok(inventory.codes.includes('BASE_REVISION_REQUIRED'));assert.ok(inventory.actions.includes('fetch-abandon'));
});
