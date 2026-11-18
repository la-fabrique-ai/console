import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { qualificationInput } from './helpers/qualification-input.mjs';
import { qualifyTicket } from '../src/ticket-qualification.mjs';
const command=promisify(execFile),script=fileURLToPath(new URL('./helpers/qualify-adversarial-process.mjs',import.meta.url));
function qualify(body) {const {config,input}=qualificationInput(body);return qualifyTicket(config,input);}
const check=result=>result.ready.checks.find(check=>check.rule===4);
for(const [kind,size,want,ok] of [['link',1000,'satisfied',true],['html',100000,'unverified',false],['brackets',100000,'unverified',false],['heading',4000,'missing',false],['line',5000,'unverified',false],['total',17000,'unverified',false],['nested',2000,'missing',false],['backticks',2000,'missing',false]])test(`adversarial ${kind} is bounded and oversized data never qualifies as filled`,async()=>{
  const {stdout}=await command(process.execPath,[script,kind,String(size)],{timeout:2500,maxBuffer:100000});
  const result=JSON.parse(stdout);assert.ok(result.elapsed<500,`${kind} took ${result.elapsed}ms`);
  assert.equal(result.ok,ok);assert.equal(result.check.result,want);assert.equal(result.check.rule,4);
  assert.deepEqual(result.check.reasons,want==='satisfied'?[]:[want==='unverified'?'QUALIFICATION_DESCRIPTION_LIMIT':'QUALIFICATION_SECTIONS_MISSING']);
});

for(const body of [',','—','/','•','%','$','&','@','!!!','§','©','☀','🔧','&amp;','&lt;','&gt;','&quot;','&#0;','\u0001','\u007f','\u2800','\u0301',
  '[^1]','[^1]: ','[^empty]','[^empty]: ', '![ ](https://example.invalid)', '[ ](https://example.invalid)',
  '[TODO](https://example.invalid)','![TBD](https://example.invalid)'])test(`punctuation, entities, controls and empty notes cannot supply actual text: ${JSON.stringify(body)}`,()=>{
  const result=qualify(body);assert.equal(result.ready.ok,false);assert.equal(check(result).result,'missing');
});

for(const body of ['<https://example.com>','`<br>`','    # commentaire','[^1]: une note remplie','```js\n()=>{}\n```','&#65;'])test(`safe real content remains accepted: ${JSON.stringify(body)}`,()=>{
  assert.equal(qualify(body).ready.ok,true);
});

test('an unknown level two heading ends the mandatory section before unrelated content',()=>{
  const result=qualify('## Autre partie\nCe contenu ne remplit pas Besoin.');assert.equal(check(result).result,'missing');
  assert.ok(check(result).paths.includes('issue.description#need'));
});
test('a level three heading does not end the mandatory section but does not itself fill it',()=>{
  assert.equal(check(qualify('### Sous-partie')).result,'missing');
  assert.equal(check(qualify('### Sous-partie\nLe besoin réel est décrit.')).result,'satisfied');
});
