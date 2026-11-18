import test from 'node:test';
import assert from 'node:assert/strict';
import { qualificationInput } from './helpers/qualification-input.mjs';
import { qualifyTicket } from '../src/ticket-qualification.mjs';
const rule=result=>result.ready.checks.find(check=>check.rule===4);
function qualify(body) {const {config,input}=qualificationInput(body);return qualifyTicket(config,input);}
const valid=qualificationInput('Un besoin réel.').input.read.data.issue.description;
function description(value) {
  const {config,input}=qualificationInput('Unused');input.read.data.issue.description=value;
  return qualifyTicket(config,input);
}
function limited(result) {
  assert.equal(result.ready.ok,false);assert.equal(rule(result).result,'unverified');
  assert.deepEqual(rule(result).reasons,['QUALIFICATION_DESCRIPTION_LIMIT']);
}

for(const body of ['[](<a)b>)','[](<http://x.example/a)b>)','[](<a\\>b)c>)','[]( <a)b> )'])test(`an empty angle destination contributes no text: ${body}`,()=>{
  const result=qualify(body);assert.equal(result.ready.ok,false);assert.equal(rule(result).result,'missing');
});

test('an angle destination with a nonempty label retains the actual label',()=>{
  assert.equal(qualify('[Résultat attendu](<a)b>)').ready.ok,true);
});

test('a bare carriage return reveals the following unknown heading instead of filling the prior section',()=>{
  const result=qualify('![]()\r## Autre\rtexte réel');
  assert.equal(result.ready.ok,false);assert.equal(rule(result).result,'missing');
  assert.ok(rule(result).paths.includes('issue.description#need'));
});

test('a duplicate mandatory heading after a bare carriage return remains ambiguous',()=>{
  const result=qualify('texte\r## Besoin\rAutre besoin.');
  assert.equal(result.ready.ok,false);assert.equal(rule(result).result,'unverified');
  assert.deepEqual(rule(result).reasons,['QUALIFICATION_SECTIONS_AMBIGUOUS']);
});

for(const body of ['Liste vérifiable\\. Cas limites\\.','TODO\\.','**À compléter\\.**'])test(`escaped punctuation does not complete an unchanged placeholder: ${body}`,()=>{
  const result=qualify(body);assert.equal(result.ready.ok,false);assert.equal(rule(result).result,'missing');
});

test('escaped punctuation in actual text and literal inline code stay usable',()=>{
  assert.equal(qualify('Un vrai résultat\\. Cas concret\\.').ready.ok,true);
  assert.equal(qualify('`<br>`').ready.ok,true);
});

for(const size of [32768,32769])test(`the full raw description boundary is enforced at ${size} UTF-16 units`,()=>{
  const text=valid+'\n'.repeat(size-valid.length);assert.equal(text.length,size);
  const result=description(text);
  if(size===32768){assert.equal(result.ready.ok,true);assert.equal(rule(result).result,'satisfied');}
  else limited(result);
});

for(const [name,ending] of [['LF','\n'],['CRLF','\r\n'],['CR','\r']])for(const size of [4096,4097])test(`the ${size}-unit line boundary is measured without its ${name} terminator`,()=>{
  const text=valid.replace('Un besoin réel.','a'.repeat(size)).replaceAll('\n',ending);
  const result=description(text);
  if(size===4096){assert.equal(result.ready.ok,true);assert.equal(rule(result).result,'satisfied');}
  else limited(result);
});

for(const size of [32768,32769])test(`a surrogate pair is neither truncated nor undercounted at the ${size}-unit document boundary`,()=>{
  const text=valid+'\n'.repeat(size-valid.length-2)+'🔧';assert.equal(text.length,size);
  const result=description(text);
  if(size===32768)assert.equal(result.ready.ok,true);else limited(result);
});
for(const size of [4096,4097])test(`a surrogate pair is fully counted at the ${size}-unit line boundary`,()=>{
  const body='a'.repeat(size-2)+'🔧';assert.equal(body.length,size);
  const result=qualify(body);if(size===4096)assert.equal(result.ready.ok,true);else limited(result);
});

const long='a'.repeat(4097);
for(const [place,text] of [
  ['after a valid section',valid+'\n'+long],['before the first section',long+'\n'+valid],
  ['inside an optional section',valid+'\n## Livrable\n'+long],['inside code',valid+'\n```txt\n'+long+'\n```'],
  ['inside a comment',valid+'\n<!--\n'+long+'\n-->'],
])test(`an oversized line ${place} cannot be hidden by earlier valid content`,()=>limited(description(text)));
