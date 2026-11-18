import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
let module;
try { module=await import('../linear.mjs'); } catch {}
test('Tracker integration exports a client and replaceable credential provider',()=>{
  assert.equal(typeof module?.LinearClient,'function'); assert.equal(typeof module?.KeychainProvider,'function');
});
const response=(data,status=200,headers={})=>({ok:status>=200&&status<300,status,headers:new Headers(headers),json:async()=>data});
async function client(fetch,extra={}) { assert.ok(module?.LinearClient,'client implemented');return new module.LinearClient({root:await mkdtemp(join(tmpdir(),'fabrique-console-tracker-')),provider:{getToken:async()=>'secret-fixture'},fetch,...extra}); }
test('issue pagination uses cursors and cache survives independent calls',async()=>{
  let calls=0;
  const c=await client(async(url,options)=>{calls++;const body=JSON.parse(options.body); assert.equal(url,'https://api.linear.app/graphql'); assert.equal(options.headers.Authorization,'secret-fixture');
    assert.deepEqual(body.variables.filter,{project:{id:{eq:'p1'}},priority:{eq:2},state:{id:{eq:'s1'}}});
    return response({data:{issues:{nodes:[{id:calls===1?'a':'b'}],pageInfo:{hasNextPage:calls===1,endCursor:calls===1?'next':null}}}});
  });
  const first=await c.list({projectId:'p1',priority:2,stateId:'s1'}); assert.deepEqual(first.issues.map(i=>i.id),['a','b']);
  assert.equal((await c.list({projectId:'p1',priority:2,stateId:'s1'})).cached,true); assert.equal(calls,2);
});
test('rate limits honor Retry-After; API errors cannot expose credentials',async()=>{
  let calls=0;const delays=[];
  const c=await client(async()=>++calls===1?response({},429,{'Retry-After':'2'}):response({data:{issues:{nodes:[],pageInfo:{hasNextPage:false}}}}),{sleep:async(ms)=>delays.push(ms)});
  await c.list({});assert.deepEqual(delays,[2000]);assert.equal(calls,2);
  const bad=await client(async()=>response({errors:[{message:'secret-fixture raw server error'}]}));
  await assert.rejects(()=>bad.list({}),e=>e.code==='LINEAR_API'&&!e.message.includes('secret-fixture'));
});
test('missing credentials fail clearly without calling the network',async()=>{
  const c=await client(()=>assert.fail('must not fetch'),{provider:{getToken:async()=>null}});
  assert.equal(await c.configured(),false);await assert.rejects(()=>c.list({}),{code:'LINEAR_NOT_CONFIGURED'});
});
test('Keychain reads only the dedicated service and never returns raw errors',async()=>{
  assert.ok(module?.KeychainProvider);
  let argv;
  const p=new module.KeychainProvider({exec:async(file,args)=>{assert.equal(file,'/usr/bin/security');argv=args;return {stdout:'fixture-key\n'};}});
  assert.equal(await p.getToken(),'fixture-key');assert.deepEqual(argv,['find-generic-password','-s','ai.la-fabrique.console.linear','-a','api-key','-w']);
  const missing=new module.KeychainProvider({exec:async()=>{throw Object.assign(new Error('secret-raw'),{code:44});}});assert.equal(await missing.getToken(),null);
});

test('cached data is partitioned by credential identity and cannot bypass missing credentials',async()=>{
  let token='fixture-a',calls=0;
  const c=await client(async()=>{calls++;return response({data:{issues:{nodes:[{id:`issue-${calls}`}],pageInfo:{hasNextPage:false}}}});},{provider:{getToken:async()=>token}});
  assert.equal((await c.list({})).issues[0].id,'issue-1');token='fixture-b';
  assert.equal((await c.list({})).issues[0].id,'issue-2');token=null;
  await assert.rejects(()=>c.list({}),{code:'LINEAR_NOT_CONFIGURED'});
});

test('detail loads all comments and labels and meta supplies real team state IDs',async()=>{
  const c=await client(async(url,options)=>{
    const {query,variables}=JSON.parse(options.body);
    if(query.includes('FabriqueConsoleIssue('))return response({data:{issue:{id:'i1',team:{id:'t1'},labels:{nodes:[{id:'l1'}],pageInfo:{hasNextPage:false}},comments:{nodes:[{id:'c1'}],pageInfo:{hasNextPage:true,endCursor:'c1'}}}}});
    if(query.includes('FabriqueConsoleComments'))return response({data:{issue:{comments:{nodes:[{id:variables.after?'c2':'c1'}],pageInfo:{hasNextPage:!variables.after,endCursor:variables.after?null:'c1'}}}}});
    if(query.includes('FabriqueConsoleViewer'))return response({data:{viewer:{id:'v1',name:'Fixture'}}});
    const field=query.includes('FabriqueConsoleTeams')?'teams':query.includes('FabriqueConsoleProjects')?'projects':'workflowStates';
    return response({data:{[field]:{nodes:[field==='workflowStates'?{id:'s1',name:'Todo',team:{id:'t1'}}:{id:'t1'}],pageInfo:{hasNextPage:false}}}});
  });
  const {issue}=await c.detail('DEV-1');assert.deepEqual(issue.comments.map(c=>c.id),['c1','c2']);assert.deepEqual(issue.labels,[{id:'l1'}]);
  const meta=await c.meta();assert.equal(meta.states[0].team.id,'t1');assert.equal(meta.viewer.id,'v1');
});

test('failed mutation payloads never claim success or continue to the next mutation',async()=>{
  let calls=0;const c=await client(async()=>{calls++;return response({data:{issueUpdate:{success:false,issue:null}}});});
  await assert.rejects(()=>c.mutate({issueId:'i1',stateId:'s1',comment:'Example'}),{code:'LINEAR_MUTATION_FAILED'});
  assert.equal(calls,1);
});

test('partial mutation failure is explicit and is not retried automatically',async()=>{
  let calls=0;const c=await client(async()=>++calls===1?response({data:{issueUpdate:{success:true,issue:{id:'i1'}}}}):response({data:{commentCreate:{success:false,comment:null}}}));
  await assert.rejects(()=>c.mutate({issueId:'i1',stateId:'s1',comment:'Example'}),{code:'LINEAR_MUTATION_PARTIAL'});
  assert.equal(calls,2);
});

test('team-only mappings filter Tracker issues by their explicit team ID',async()=>{
  let filter;const c=await client(async(url,options)=>{filter=JSON.parse(options.body).variables.filter;return response({data:{issues:{nodes:[],pageInfo:{hasNextPage:false}}}});});
  await c.list({teamId:'team-a',priority:3});assert.deepEqual(filter,{team:{id:{eq:'team-a'}},priority:{eq:3}});
});
