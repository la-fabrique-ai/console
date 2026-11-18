import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir,readFile,stat,writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { enrichedFixture,connection,ticket,reference,epic,milestone,document,state } from './helpers/enriched-fixture.mjs';

test('new actions expose team epics and enriched tickets, documents on demand, while legacy reads stay unchanged',async t=>{
  const f=await enrichedFixture(t),projects=await f.read('ticket-projects');
  assert.equal(projects.complete,true);assert.equal(projects.data.projects.total,1);assert.equal(projects.data.projects.items[0].milestones.total,1);
  assert.equal(projects.data.projects.items[0].documents.items[0].content,undefined);assert.equal(f.calls.some(c=>c.operation==='Document'),false);
  const issues=await f.read();assert.equal(issues.data.issues.items[0].estimate,2);assert.equal(issues.data.issues.items[0].labels.items[0].name,'agent:codex');assert.equal(issues.data.issues.items[0].state.type,'unstarted');
  assert.equal(issues.scope.includeArchived,false);assert.equal(issues.untrusted,true);assert.equal(issues.limits.budgetMs,23000);
  const detail=await f.read('ticket-issue-enriched',{issueId:'one'});assert.equal(detail.data.issue.id,'one');assert.equal(detail.complete,true);
  const doc=await f.read('ticket-document',{projectId:'epic',documentId:'d1'});assert.match(doc.data.document.content,/rm -rf/);assert.equal(doc.untrusted,true);
  assert.equal((await f.backend.dispatch('ticket-list',{})).issues[0].id,'characterization-issue');
  assert.equal(f.credentialReads(),4,'One credential read per enriched operation');
});

test('every nested connection follows its second page, including incoming and outgoing dependency directions',async t=>{
  const relation=(id,source,target)=>({id,type:'blocks',issue:reference(source),relatedIssue:reference(target)});
  const second={Labels:connection([{id:'l2',name:'niveau:Fort'}]),Children:connection([reference('child')]),Relations:connection([relation('out','one','blocked')]),InverseRelations:connection([relation('in','blocker','one')])};
  let roots=0;
  const g=await enrichedFixture(t,{handler:(op,v)=>{
    if(op==='Issues'){roots++;return {issues:v.after?connection([ticket('two')]):connection([ticket('one',{labels:connection([],true,'label-next'),children:connection([],true,'child-next'),relations:connection([],true,'out-next'),inverseRelations:connection([],true,'in-next')})],true,'root-next')};}
    if(op in second)return {issue:{id:v.id,[op[0].toLowerCase()+op.slice(1)]:second[op]}};
    if(op==='Projects')return {team:{id:'team',projects:connection([{...epic('epic'),projectMilestones:connection([],true,'m-next'),documents:connection([],true,'d-next')}])}};
    if(op==='Milestones')return {project:{id:v.id,projectMilestones:connection([milestone('m2')])}};
    if(op==='Documents')return {project:{id:v.id,documents:connection([document('d2')])}};
  }});
  const result=await g.read(),one=result.data.issues.items[0];assert.equal(result.complete,true);assert.equal(result.data.issues.total,2);assert.equal(roots,2);
  assert.equal(one.children.items[0].identifier,'XJ-child');assert.equal(one.dependencies.blocks.items[0].identifier,'XJ-blocked');assert.equal(one.dependencies.blockedBy.items[0].identifier,'XJ-blocker');assert.equal(one.labels.items[0].name,'niveau:Fort');
  const projects=await g.read('ticket-projects');assert.equal(projects.complete,true);assert.equal(projects.data.projects.items[0].milestones.items[0].id,'m2');assert.equal(projects.data.projects.items[0].documents.items[0].id,'d2');
});

test('700 realistic issues are complete in fourteen pages, without per-ticket request fanout',async t=>{
  const f=await enrichedFixture(t,{handler:(op,v)=>{
    if(op!=='Issues')return;
    const start=Number(v.after??0),items=Array.from({length:50},(_,i)=>ticket(String(start+i),{parent:(start+i)%5===0?reference('parent'):null,children:connection((start+i)%7===0?[reference('child')]:[]),relations:connection((start+i)%3===0?[{id:'rel-'+(start+i),type:'blocks',issue:reference(String(start+i)),relatedIssue:reference('other')}]:[])}));
    return {issues:connection(items,start<650,start<650?String(start+50):null)};
  }});
  const result=await f.read();assert.equal(result.complete,true);assert.equal(result.data.issues.total,700);assert.equal(f.calls.length,14);assert.ok(result.usage.nodes<10000);assert.equal(result.usage.requests,14);
  t.diagnostic('700 tickets : '+result.usage.requests+' requêtes, '+result.usage.nodes+' occurrences d’entités.');
});

test('a nested page cap and repeated cursor propagate partiality and never turn an unknown total into zero',async t=>{
  for(const options of [{maxPages:1},{}]){
    const f=await enrichedFixture(t,{options:{limits:options},handler:(op,v)=>{
      if(op==='Issues')return {issues:connection([ticket('one',{labels:connection([],true,'again')})])};
      if(op==='Labels')return {issue:{id:v.id,labels:connection([{id:'same',name:'test'}],true,'again')}};
    }});
    const result=await f.read();assert.equal(result.status,'partial');assert.equal(result.complete,false);assert.equal(result.data.issues.total,null);
    assert.equal(result.data.issues.items[0].labels.total,null);assert.ok(result.partialReasons.some(r=>/page-limit|invalid-cursor/.test(r.reason)));
  }
});

test('budget expiration emits the partial JSON envelope before the outer action timeout and leaves no cache',async t=>{
  const f=await enrichedFixture(t,{options:{budgetMs:70},handler:()=>new Promise(()=>{})}),start=performance.now();
  const envelope=JSON.parse(JSON.stringify({ok:true,data:await f.read()}));
  assert.equal(envelope.ok,true);assert.equal(envelope.data.status,'partial');assert.equal(envelope.data.data.issues.total,null);assert.equal(envelope.data.data.issues.items,null);
  assert.ok(envelope.data.partialReasons.some(r=>r.reason==='deadline'));assert.ok(performance.now()-start<1500);
  assert.equal((await files(f.home)).some(file=>file.includes('/linear-enriched/')&&file.endsWith('.json')),false);
});

test('GraphQL rate and complexity limits produce explicit partial reads instead of complete empty lists',async t=>{
  for(const code of ['RATELIMITED','QUERY_COMPLEXITY_LIMIT_EXCEEDED']){
    const f=await enrichedFixture(t,{handler:()=>new Response(JSON.stringify({errors:[{message:'private diagnostic',extensions:{code}}]}),{status:400,headers:{'retry-after':'120'}})});
    const result=await f.read();assert.equal(result.complete,false);assert.equal(result.data.issues.total,null);assert.ok(result.partialReasons.some(r=>r.reason===(code==='RATELIMITED'?'rate-limit':'complexity-limit')));assert.doesNotMatch(JSON.stringify(result),/private diagnostic/);
  }
});

test('foreign linked tickets expose only identifier and state and archived tickets stay excluded',async t=>{
  const foreign={...reference('foreign','elsewhere'),title:'Must not expose',url:'https://linear.app/private'};
  const f=await enrichedFixture(t,{handler:op=>op==='Issues'?{issues:connection([ticket('one',{parent:foreign,children:connection([foreign]),relations:connection([{id:'r',type:'blocks',issue:reference('one'),relatedIssue:foreign}])}),ticket('archived',{archivedAt:'2026-01-01T00:00:00Z'})])}:undefined});
  const result=await f.read(),one=result.data.issues.items[0];assert.equal(result.data.issues.total,1);
  for(const value of [one.parent,one.children.items[0],one.dependencies.blocks.items[0]])assert.deepEqual(Object.keys(value).sort(),['identifier','state']);
  assert.equal(result.scope.linkedOutsideTeam,'identifier-state-only');assert.equal(result.scope.includeArchived,false);assert.doesNotMatch(JSON.stringify(result),/Must not expose|private/);
  const query=f.calls[0];assert.equal(query.variables.filter.team.id.eq,'team');
});

test('scope is checked before loading a foreign document content or enriched issue',async t=>{
  const f=await enrichedFixture(t,{handler:(op,v)=>{
    if(op==='ProjectScope')return {project:{id:v.id,teams:connection([{id:'other'}])}};
    if(op==='IssueScope')return {issue:{id:v.id,team:{id:'other'},archivedAt:null}};
  }});
  await assert.rejects(f.read('ticket-document',{projectId:'foreign',documentId:'d1'}),{code:'TICKET_SCOPE'});
  await assert.rejects(f.read('ticket-issue-enriched',{issueId:'foreign'}),{code:'TICKET_SCOPE'});
  assert.equal(f.calls.some(c=>['Document','DocumentScope','Issue'].includes(c.operation)),false);
});

test('document truncation is partial, text stays untrusted and unsafe URLs are nulled',async t=>{
  const f=await enrichedFixture(t,{handler:(op,v)=>op==='Document'?{document:{...document(v.id),url:'https://linear.app.evil.test/leak',content:'é'.repeat(140000),archivedAt:null,project:{id:'epic'}}}:undefined});
  const result=await f.read('ticket-document',{projectId:'epic',documentId:'d1'});
  assert.equal(result.status,'partial');assert.equal(result.data.document.truncated,true);assert.ok(Buffer.byteLength(result.data.document.content)<=256*1024);assert.equal(result.data.document.url,null);assert.equal(result.untrusted,true);
});

test('missing key makes enriched reads unavailable while legacy OAuth-compatible reads still work',async t=>{
  const f=await enrichedFixture(t,{token:null}),result=await f.read();
  assert.equal(result.status,'unavailable');assert.equal(result.available,false);assert.equal(result.complete,false);assert.equal(f.calls.length,0);
  assert.equal((await f.backend.dispatch('ticket-list',{})).issues.length,1);
});

test('one operation pins the API key across pages, cache is private and old identities are purged after rotation',async t=>{
  let f;
  f=await enrichedFixture(t,{handler:(op,v)=>{
    if(op==='Issues'){if(!v.after){f.setToken('rotated-fixture-credential');return {issues:connection([ticket('one')],true,'next')};}return {issues:connection([ticket('two')])};}
  }});
  const result=await f.read();assert.equal(result.complete,true);assert.equal(f.credentialReads(),1);assert.ok(f.calls.every(c=>c.authorization==='arbitrary-fixture-credential'));
  const oldFiles=(await files(f.home)).filter(p=>p.includes('/linear-enriched/')&&p.endsWith('.json'));assert.equal(oldFiles.length,1);
  await f.read();for(const old of oldFiles)await assert.rejects(stat(old),{code:'ENOENT'});
  const cached=await f.read();assert.equal(cached.cached,true);
  for(const p of (await files(f.home)).filter(p=>p.includes('/linear-enriched/')&&p.endsWith('.json')))assert.equal((await stat(p)).mode&0o777,0o600);
  const all=await files(f.home);for(const p of all){assert.doesNotMatch(p,/arbitrary-fixture-credential|rotated-fixture-credential/);assert.doesNotMatch(await readFile(p,'utf8'),/arbitrary-fixture-credential|rotated-fixture-credential/);}
  assert.doesNotMatch(JSON.stringify(result),/arbitrary-fixture-credential|rotated-fixture-credential/);
  f.setToken(null);assert.equal((await f.read()).status,'unavailable');
});

async function files(root){const out=[];for(const item of await readdir(root,{withFileTypes:true})){const path=join(root,item.name);if(item.isDirectory())out.push(...await files(path));else out.push(path);}return out;}

test('the actual CLI emits its partial envelope within 30 seconds using the production 23 second budget',async t=>{
  const f=await enrichedFixture(t),preload=join(f.root,'fake-read.mjs');
  const providerURL=new URL('../linear.mjs',import.meta.url).href;
  await writeFile(preload,`import {KeychainProvider} from ${JSON.stringify(providerURL)};\nimport {setTimeout as delay} from 'node:timers/promises';\nKeychainProvider.prototype.getToken=async()=> 'preload-fixture-credential';\nlet page=0;globalThis.fetch=async(_url,init)=>{await delay(3000,undefined,{signal:init.signal});return new Response(JSON.stringify({data:{issues:{nodes:[],pageInfo:{hasNextPage:true,endCursor:String(++page)}}}}));};\n`);
  const start=performance.now(),cli=fileURLToPath(new URL('../../../../src/cli.mjs',import.meta.url));
  const result=await f.command(process.execPath,['--import',preload,cli,'ticket-issues-enriched','{"key":"example"}'],{env:{...process.env,FABRIQUE_CONSOLE_HOME:f.home},timeout:29000});
  const envelope=JSON.parse(result.stdout);assert.equal(result.stderr,'');assert.equal(result.stdout.trim().split('\n').length,1);
  assert.equal(envelope.ok,true);assert.equal(envelope.data.status,'partial');assert.equal(envelope.data.limits.budgetMs,23000);
  assert.ok(envelope.data.partialReasons.some(item=>item.reason==='deadline'));assert.ok(performance.now()-start<29000);
});

test('request and entity caps are explicit and never yield a complete empty collection',async t=>{
  for(const [limits,reason] of [[{maxNodes:1},'node-limit'],[{maxRequests:1},'request-limit']]){
    const f=await enrichedFixture(t,{options:{limits},handler:op=>op==='Issues'?{issues:connection([ticket()],true,'next')}:undefined});
    const result=await f.read();assert.equal(result.status,'partial');assert.equal(result.data.issues.total,null);assert.ok(result.partialReasons.some(item=>item.reason===reason));
  }
});

test('an unrecognized GraphQL status resolves only from this team metadata or remains explicitly partial',async t=>{
  const f=await enrichedFixture(t,{handler:op=>op==='Issues'?{issues:connection([ticket('one',{state:{id:'todo',name:'Renamed',type:'unknown'}})])}:undefined});
  const resolved=await f.read();assert.equal(resolved.complete,true);assert.equal(resolved.data.issues.items[0].classification.source,'team-status-id');assert.equal(resolved.data.issues.items[0].state.type,'unstarted');
  const g=await enrichedFixture(t,{handler:op=>op==='Issues'?{issues:connection([ticket('one',{state:{id:'missing',name:'À faire',type:'future-type'}})])}:undefined});
  const unknown=await g.read();assert.equal(unknown.complete,false);assert.equal(unknown.data.issues.total,null);assert.equal(unknown.data.issues.items[0].state.type,'unknown');
});

test('the entity budget counts scope checks and document roots as well as connection nodes',async t=>{
  const f=await enrichedFixture(t),result=await f.read('ticket-document',{projectId:'epic',documentId:'d1'});
  assert.equal(result.usage.nodes,6,'Project + team, document scope + project, document content + project');
  const capped=await enrichedFixture(t,{options:{limits:{maxNodes:3}}}),partial=await capped.read('ticket-document',{projectId:'epic',documentId:'d1'});
  assert.equal(partial.status,'partial');assert.equal(partial.data.document,null);assert.ok(partial.partialReasons.some(item=>item.reason==='node-limit'));
});

test('ticket inclusions retain normalized statuses and explicit continuation cursors',async t=>{
  const f=await enrichedFixture(t,{options:{limits:{maxPages:1}},handler:op=>op==='Issues'?{issues:connection([ticket()],true,'next-page')}:undefined});
  const data=await f.read();assert.equal(data.complete,false);assert.equal(data.cursor,'next-page');assert.equal(data.data.issues.cursor,'next-page');
  assert.equal(data.tickets[0].status.category,'ready');assert.equal(data.tickets[0].status.label,'À faire');
  assert.equal(data.freshness.observedAt,data.observedAt);
});
