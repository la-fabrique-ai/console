import test from 'node:test';
import assert from 'node:assert/strict';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { qualificationFixture,ordinaryDescription,bugDescription,labelNames,readyLabels } from './helpers/qualification-fixture.mjs';
import { connection,reference } from './helpers/enriched-fixture.mjs';
import { qualifyTicket } from '../src/ticket-qualification.mjs';
import { assertInterfaceShape } from './helpers/interface-shape.mjs';

const check=(result,rule)=>result.ready.checks.find(item=>item.rule===rule);
const blocked=(id,type='unstarted',team='team',archivedAt=null)=>({id:'relation-'+id,type:'blocks',issue:{...reference(id,team),state:{id:'state-'+type,name:type,type},archivedAt},relatedIssue:reference('one')});

test('the qualification contract covers ready, missing, partial and unavailable results strictly',async t=>{
  const f=await qualificationFixture(t,{options:{limits:{maxPages:1}}});
  const ready=await f.qualify();assertInterfaceShape('TicketQualification',ready);
  const extra=structuredClone(ready);extra.selection.model='invented';
  assert.throws(()=>assertInterfaceShape('TicketQualification',extra));
  const missing=structuredClone(ready);delete missing.ready.checks[0].observedAt;
  assert.throws(()=>assertInterfaceShape('TicketQualification',missing));
  const invalid=structuredClone(ready);invalid.ready.checks[0].result='ready';
  assert.throws(()=>assertInterfaceShape('TicketQualification',invalid));
  f.setIssue({labels:labelNames(['web'])});assertInterfaceShape('TicketQualification',await f.qualify());
  f.setIssue({labels:labelNames(readyLabels),inverseRelations:connection([],true,'next')});
  const partial=await f.qualify();assert.equal(partial.source.status,'partial');assertInterfaceShape('TicketQualification',partial);
  f.setToken(null);const unavailable=await f.qualify();assert.equal(unavailable.source.status,'unavailable');assertInterfaceShape('TicketQualification',unavailable);
});

test('qualification reads six satisfied rules and selects labels without Git, HC, a mission or a worktree',async t=>{
  const f=await qualificationFixture(t),result=await f.qualify();
  assert.equal(result.ready.ok,true);assert.equal(result.ready.checks.length,6);assert.deepEqual(result.ready.missing,[]);
  assert.deepEqual(result.ready.checks.map(c=>c.result),Array(6).fill('satisfied'));
  assert.deepEqual(result.selection,{projectKey:'example',repoKey:'app',tool:'codex',level:'standard'});
  assert.equal(result.launchAllowed,false);assert.equal(result.source.complete,true);assert.equal(result.source.cached,false);
  assert.match(result.configRevision,/^[a-f0-9]{64}$/);assert.ok(Number.isFinite(Date.parse(result.observedAt)));
  assert.deepEqual(f.commands,[]);assert.deepEqual(f.trackerCalls,[]);
  for(const path of ['state.json','workspace-state.json','missions'])await assert.rejects(stat(join(f.home,path)),{code:'ENOENT'});
  await assert.rejects(stat(f.config.worktreesRoot),{code:'ENOENT'});
});

const isolated=[
  [1,'ready label',f=>f.setIssue({labels:labelNames(readyLabels.filter(n=>n!=='prêt'))})],
  [2,'repository label',f=>f.setIssue({labels:labelNames(readyLabels.filter(n=>n!=='web'))})],
  [3,'agent label',f=>f.setIssue({labels:labelNames(readyLabels.filter(n=>n!=='agent:codex'))})],
  [4,'required section body',f=>f.setIssue({description:ordinaryDescription.replace('Connaître les éléments manquants du ticket.','')})],
  [5,'open incoming dependency',f=>f.setIssue({inverseRelations:connection([blocked('before')])})],
  [6,'nonstartable status',f=>f.setIssue({state:{id:'backlog',name:'Todo',type:'backlog'}})],
];
for(const [rule,name,mutate] of isolated)test(`A4 rule ${rule} alone detects a missing ${name}`,async t=>{
  const f=await qualificationFixture(t);mutate(f);const result=await f.qualify();
  assert.equal(result.ready.ok,false);assert.equal(check(result,rule).result,'missing');
  assert.ok(result.ready.missing.some(item=>item.rule===rule));assert.ok(check(result,rule).reasons.length);
  assert.equal(result.ready.checks.filter(c=>c.result==='satisfied').length,5);
});

for(const names of [
  readyLabels.filter(n=>!n.startsWith('niveau:')),
  [...readyLabels,'agent:claude'],[...readyLabels,'agent:codex'],[...readyLabels,'niveau:fort'],
  readyLabels.map(n=>n==='agent:codex'?'agent:other':n),readyLabels.map(n=>n==='niveau:standard'?'niveau:critical':n),
])test(`agent and level require exactly one supported label: ${JSON.stringify(names)}`,async t=>{
  const f=await qualificationFixture(t);f.setIssue({labels:labelNames(names)});const result=await f.qualify();
  assert.equal(result.ready.ok,false);assert.equal(check(result,3).result,'missing');
});

test('the transition never substitutes configured preferredAgent or an implicit level/ready label',async t=>{
  const f=await qualificationFixture(t);f.setIssue({labels:labelNames(['web'])});const result=await f.qualify();
  assert.equal(result.ready.ok,false);assert.equal(result.selection.tool,null);assert.equal(result.selection.level,null);
  assert.equal(check(result,1).result,'missing');assert.equal(check(result,3).result,'missing');
});

test('several aliases for one repository are accepted but two configured keys are ambiguous',async t=>{
  const f=await qualificationFixture(t);f.setIssue({labels:labelNames([...readyLabels,'packages','infra'])});
  assert.equal((await f.qualify()).ready.ok,true);
  f.setIssue({labels:labelNames([...readyLabels,'specs'])});const result=await f.qualify();
  assert.equal(check(result,2).result,'missing');assert.equal(result.selection.repoKey,null);
});

test('a mono repository needs no repository label and a custom started state name is allowed',async t=>{
  const f=await qualificationFixture(t);f.config.projects[0].repos.splice(1);await f.write('config.json',f.config);
  f.setIssue({labels:labelNames(readyLabels.filter(n=>n!=='web')),state:{id:'doing',name:'En atelier',type:'started'}});
  assert.equal((await f.qualify()).ready.ok,true);
});

for(const description of [null,'', '```md\n'+ordinaryDescription+'\n```','<!--\n'+ordinaryDescription+'\n-->'])test(`empty or quoted templates cannot satisfy A4 sections: ${String(description).slice(0,12)}`,async t=>{
  const f=await qualificationFixture(t);f.setIssue({description});assert.equal(check(await f.qualify(),4).result,'missing');
});

test('unfilled template examples and empty checkbox bullets are missing rather than completed requirements',async t=>{
  const f=await qualificationFixture(t);f.setIssue({description:"## Besoin *\nPourquoi on le fait, pour qui. Lien vers l'epic.\n## Résultat attendu *\nCe que l'utilisateur voit ou peut faire à la fin. Ce qui est exclu.\n## Critères d'acceptation *\n- [ ]\n## Vérification *\nÀ remplir\n"});
  assert.equal(check(await f.qualify(),4).result,'missing');
});

for(const value of ['TODO.','**À compléter**','`TBD`'])test(`formatting or punctuation does not turn a placeholder into a filled section: ${value}`,async t=>{
  const f=await qualificationFixture(t);f.setIssue({description:ordinaryDescription.replace('Connaître les éléments manquants du ticket.',value)});
  assert.equal(check(await f.qualify(),4).result,'missing');
});

test('duplicate mandatory sections are unverified rather than choosing the convenient occurrence',async t=>{
  const f=await qualificationFixture(t);f.setIssue({description:ordinaryDescription+'\n## Besoin\nAutre besoin contradictoire.\n'});
  assert.equal(check(await f.qualify(),4).result,'unverified');
});

for(const type of ['Bug','Investigation'])test(`${type} uses A2 sections instead of requiring ordinary A1 headings`,async t=>{
  const f=await qualificationFixture(t);f.setIssue({labels:labelNames([...readyLabels,type]),description:bugDescription});
  assert.equal((await f.qualify()).ready.ok,true);
  f.setIssue({description:bugDescription.replace('## Reproduction\nOuvrir la fixture et lire son état.\n','')});
  assert.equal(check(await f.qualify(),4).result,'missing');
});

test('outgoing blocks do not block this ticket and completed/canceled incoming dependencies are closed',async t=>{
  const f=await qualificationFixture(t);f.setIssue({
    relations:connection([{id:'out',type:'blocks',issue:reference('one'),relatedIssue:reference('later')}]),
    inverseRelations:connection([blocked('done','completed'),blocked('canceled','canceled','foreign-team')]),
  });
  const result=await f.qualify();assert.equal(result.ready.ok,true);assert.equal(check(result,5).result,'satisfied');
});

test('an unknown dependency state is unverified, even when the connection itself was fully read',async t=>{
  const f=await qualificationFixture(t);f.setIssue({inverseRelations:connection([blocked('unknown','unrecognized','foreign-team')])});
  assert.equal(check(await f.qualify(),5).result,'unverified');
});

test('an archived incoming dependency cannot disappear as if no prerequisite existed',async t=>{
  const f=await qualificationFixture(t);f.setIssue({inverseRelations:connection([blocked('archived-secret','unstarted','foreign-team','2026-01-01T00:00:00Z')])});
  const result=await f.qualify();assert.equal(result.ready.ok,false);assert.equal(check(result,5).result,'missing');
  assert.doesNotMatch(JSON.stringify(result),/archived-secret/);
});

test('partial labels and a partial incoming dependency connection never yield ready',async t=>{
  const f=await qualificationFixture(t,{options:{limits:{maxPages:1}}});
  f.setIssue({labels:connection(labelNames(readyLabels).nodes.slice(0,3),true,'next')});
  let result=await f.qualify();assert.equal(result.ready.ok,false);assert.equal(check(result,2).result,'unverified');assert.equal(check(result,3).result,'unverified');
  f.setIssue({labels:labelNames(readyLabels),inverseRelations:connection([],true,'next')});
  result=await f.qualify();assert.equal(result.ready.ok,false);assert.equal(check(result,5).result,'unverified');
});

test('an unrelated partial graph remains explicitly nonverified even if the six known facts are satisfied',async t=>{
  const f=await qualificationFixture(t,{options:{limits:{maxPages:1}}});f.setIssue({children:connection([],true,'next')});
  const result=await f.qualify();assert.equal(result.ready.ok,false);assert.equal(result.source.complete,false);assert.ok(result.ready.missing.length);
});

test('missing read credentials leave all six rules unverified without a credential or MCP fallback',async t=>{
  const f=await qualificationFixture(t,{token:null}),result=await f.qualify();
  assert.equal(result.ready.ok,false);assert.ok(result.ready.checks.every(c=>c.result==='unverified'));
  assert.deepEqual(f.commands,[]);assert.deepEqual(f.trackerCalls,[]);assert.equal(f.calls.length,0);
});

test('qualification refreshes a stale ready cache when Tracker has removed the ready label',async t=>{
  const f=await qualificationFixture(t);
  const cached=await f.backend.dispatch('ticket-issue-enriched',{key:'example',issueId:'one'});assert.equal(cached.complete,true);
  const before=f.calls.length;f.setIssue({labels:labelNames(readyLabels.filter(n=>n!=='prêt'))});
  const result=await f.qualify();assert.ok(f.calls.length>before);assert.equal(result.ready.ok,false);assert.equal(check(result,1).result,'missing');assert.equal(result.source.cached,false);
});

test('configuration changed during the read invalidates the mapping observation',async t=>{
  const f=await qualificationFixture(t);f.setHandler(async op=>{
    if(op==='Issue'){f.config.projects[0].name='Changed during read';await f.write('config.json',f.config);}
  });
  const result=await f.qualify();assert.equal(result.ready.ok,false);assert.equal(check(result,2).result,'unverified');
});

test('a read deadline emits an unverified qualification rather than a ready cached fallback',async t=>{
  const f=await qualificationFixture(t,{options:{budgetMs:50}});
  f.setHandler(()=>new Response(JSON.stringify({errors:[{extensions:{code:'RATELIMITED'}}]}),{status:400,headers:{'retry-after':'120'}}));
  const result=await f.qualify();assert.equal(result.ready.ok,false);assert.equal(result.ready.verified,false);assert.equal(result.source.complete,false);
});

test('pure qualification is deterministic and accepts frozen source/configuration without mutation',async t=>{
  const f=await qualificationFixture(t),read=await f.backend.dispatch('ticket-issue-enriched',{key:'example',issueId:'one',refresh:true});
  const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};
  const config=freeze(structuredClone(f.config)),source=freeze(structuredClone(read)),before=JSON.stringify({config,source});
  const input={key:'example',issueId:'one',read:source},first=qualifyTicket(config,input),second=qualifyTicket(config,input);
  assert.equal(first.ready.ok,true);assert.deepEqual(first,second);assert.equal(JSON.stringify({config,source}),before);
});

test('qualification refuses V1 configuration and unknown project keys without any Tracker read',async t=>{
  const f=await qualificationFixture(t);await assert.rejects(f.qualify({key:'unknown'}),{code:'NOT_FOUND'});
  await f.write('config.json',{version:1,projects:[]});await assert.rejects(f.qualify(),{code:'CONFIG_V2_REQUIRED'});assert.equal(f.calls.length,0);
});

test('a foreign issue cannot be qualified through a locally chosen project key',async t=>{
  const f=await qualificationFixture(t);f.setHandler(op=>op==='IssueScope'?{issue:{id:'one',archivedAt:null,team:{id:'foreign'}}}:undefined);
  const result=await f.qualify();assert.equal(result.ready.ok,false);assert.ok(result.ready.checks.every(c=>c.result==='unverified'));
});

for(const input of [{tool:'claude'},{model:'other'},{effort:'high'},{role:'review'},{profile:'fort'},{refresh:false},{issue:{id:'other'}}])test(`qualification rejects caller policy overrides: ${Object.keys(input)}`,async t=>{
  const f=await qualificationFixture(t);await assert.rejects(f.qualify(input),{code:'INVALID_ARGUMENT'});assert.equal(f.calls.length,0);
});
