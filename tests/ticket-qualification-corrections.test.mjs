import test from 'node:test';
import assert from 'node:assert/strict';
import { qualifyTicket } from '../src/ticket-qualification.mjs';
import { configV2 } from './helpers/config-v2-fixture.mjs';
import { qualificationFixture,ordinaryDescription,labelNames,readyLabels } from './helpers/qualification-fixture.mjs';
import { connection,reference } from './helpers/enriched-fixture.mjs';
import { assertInterfaceShape } from './helpers/interface-shape.mjs';

const config=configV2();config.projects[0].teamId='team';config.projects[0].projectId='epic';
const state={id:'todo',name:'À faire',type:'unstarted'};
const collection=items=>({items,complete:true,total:items.length,reasons:[]});
function qualify(body,labels=readyLabels) {
  const read={status:'complete',available:true,complete:true,observedAt:'2026-11-06T21:00:00Z',source:'ticket-api-key',cached:false,
    scope:{key:'example',teamId:'team',projectId:null,includeArchived:false,linkedOutsideTeam:'identifier-state-only'},untrusted:true,
    data:{issue:{id:'one',identifier:'XJ-1',title:'Fixture',description:ordinaryDescription.replace('Connaître les éléments manquants du ticket.',body),url:null,
      updatedAt:'2026-11-06T20:00:00Z',estimate:null,projectId:'epic',milestone:null,parent:null,untrusted:true,state,
      classification:{source:'state-type',reason:null},labels:collection(labels.map((name,i)=>({id:'label-'+i,name,untrusted:true}))),
      children:collection([]),dependencies:{blocks:collection([]),blockedBy:collection([])},complete:true}},
    partialReasons:[],limits:{pageSize:50,seedSize:3,maxPages:20,maxRequests:200,maxNodes:10000,budgetMs:23000,documentBytes:262144},usage:{requests:2,nodes:8,maxComplexity:null}};
  return qualifyTicket(config,{key:'example',issueId:'one',read});
}
const rule=(result,n)=>result.ready.checks.find(check=>check.rule===n);
const emptyBodies=[
  '# Titre','## Titre','### Titre','#### Titre','##### Titre','###### Titre','###',
  'Titre\n===','Titre\n---',
  '>','> >','---','***','___','- - -','* * *',
  '-','+','1.','1. [ ]','- [ ]','- [x]',
  '[](https://example.invalid)','[ ](https://example.invalid)','![](https://example.invalid)','![ ](https://example.invalid)',
  '[][ref]\n\n[ref]: https://example.invalid',
  '\u200b','\ufeff','\u200c','\u200d','\u2060','\u00ad','\u200e','\u200f','\u202a','\u202f','\u3000',
  '&nbsp;','&#160;','&#xA0;','&ensp;','&emsp;','&thinsp;','&ZeroWidthSpace;','&zwnj;','&#8203;',
  '&NonBreakingSpace;','&NoBreak;','&ThinSpace;','&VeryThinSpace;','&shy;','&ApplyFunction;','&InvisibleTimes;','&InvisibleComma;',
  '<br>','<br/>','<br />','<hr>','<p></p>','<div>&nbsp;</div>',
];
for(const body of emptyBodies)test(`markup without meaningful body cannot fill A4: ${JSON.stringify(body)}`,()=>{
  const result=qualify(body);assert.equal(result.ready.ok,false);assert.equal(rule(result,4).result,'missing');
  assert.ok(rule(result,4).paths.includes('issue.description#need'));
});
for(const body of ['### Détails\nUn résultat à obtenir.','> Une contrainte réelle.','[Un résultat](https://example.invalid)','![Diagramme utile](https://example.invalid)','```sh\nnpm test\n```'])test(`real content remains usable: ${JSON.stringify(body)}`,()=>{
  assert.equal(qualify(body).ready.ok,true);
});

test('a root heading ends the prior section instead of lending it unrelated content',()=>{
  assert.equal(rule(qualify('# Autre partie\nCe texte appartient à une autre partie.'),4).result,'missing');
});

for(const labels of [
  ['PRÊT','Agent:CoDeX','NiVeAu:StAnDaRd','web'],
  ['pre\u0302t','agent:codex','niveau:le\u0301ger','web'],
  ['Prêt','agent:codex','niveau:FoRt','web'],
])test(`ready, agent and level labels accept case and canonical Unicode only: ${JSON.stringify(labels)}`,()=>{
  const result=qualify('Un besoin réel.',labels);assert.equal(result.ready.ok,true);assert.equal(result.selection.tool,'codex');
  assert.equal(result.selection.level,labels[2].startsWith('niveau:le')?'léger':labels[2]==='niveau:FoRt'?'fort':'standard');
});
for(const labels of [
  [' prêt',...readyLabels.slice(1)],['pret',...readyLabels.slice(1)],['prêt ','agent:codex','niveau:standard','web'],
  ['prêt','agent: codex','niveau:standard','web'],['prêt','agent:codex','niveau:leger','web'],
  [...readyLabels,'AGENT:CODEX'],[...readyLabels,'NIVEAU:STANDARD'],['prêt','agent:codex','niveau:standard','WEB'],
])test(`label normalization does not add trimming, accent folding or repository aliases: ${JSON.stringify(labels)}`,()=>{
  assert.equal(qualify('Un besoin réel.',labels).ready.ok,false);
});

test('qualification documents the internal ID contract by refusing an identifier alias as unverified',async t=>{
  const f=await qualificationFixture(t);
  f.setHandler((op,vars)=>op==='IssueScope'?{issue:{id:'one',archivedAt:null,team:{id:'team'}}}:undefined);
  const result=await f.qualify({issueId:'XJ-12'});
  assert.equal(result.ready.ok,false);assert.ok(result.ready.checks.every(check=>check.result==='unverified'));
  assert.equal(result.ready.checks[0].reasons[0],'QUALIFICATION_SCOPE_UNVERIFIED');
});

const archived=(type,team='team')=>({id:'relation',type:'blocks',issue:{...reference('archived',team),archivedAt:'2026-01-01T00:00:00Z',
  title:'Excluded title',description:'Excluded description',state:type?{id:'state-'+type,name:type,type}:null},relatedIssue:reference('one')});
for(const [type,team,want] of [
  ['completed','team','satisfied'],['canceled','team','satisfied'],['started','team','missing'],
  [null,'team','unverified'],['completed','foreign','satisfied'],['canceled','foreign','satisfied'],['unrecognized','foreign','unverified'],
])test(`an archived prerequisite is decided from its minimal state: ${type}/${team}`,async t=>{
  const f=await qualificationFixture(t);f.setIssue({inverseRelations:connection([archived(type,team)])});
  const result=await f.qualify();assert.equal(rule(result,5).result,want);assert.equal(result.ready.ok,want==='satisfied');
  const read=await f.backend.dispatch('ticket-issue-enriched',{key:'example',issueId:'one',refresh:true});
  assertInterfaceShape('EnrichedIssue',read);
  const linked=read.data.issue.dependencies.blockedBy.items[0];
  assert.deepEqual(Object.keys(linked).sort(),['identifier','state']);assert.equal(linked.identifier,'XJ-archived');
  assert.doesNotMatch(JSON.stringify(read),/Excluded title|Excluded description/);
  if(want!=='unverified')assert.equal(read.complete,true);
});

test('an archived outgoing dependency remains excluded and explicitly partial',async t=>{
  const f=await qualificationFixture(t),relation=archived('completed');
  f.setIssue({relations:connection([{...relation,issue:reference('one'),relatedIssue:relation.issue}])});
  const read=await f.backend.dispatch('ticket-issue-enriched',{key:'example',issueId:'one',refresh:true});
  assert.equal(read.complete,false);assert.deepEqual(read.data.issue.dependencies.blocks.items,[]);
  assert.ok(read.partialReasons.some(reason=>reason.reason==='archived-excluded'));assert.doesNotMatch(JSON.stringify(read),/XJ-archived|Excluded/);
});
