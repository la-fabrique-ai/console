import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
let module;
try { module = await import('../linear-mcp.mjs'); } catch {}
const endpoint = 'https://mcp.linear.app/mcp/readonly';
function store(value) { return { value, async read() { return structuredClone(this.value); }, async write(v) { this.value = structuredClone(v); } }; }
async function fixture(t) { const root=await mkdtemp(join(tmpdir(),'fabrique-console-mcp-'));t.after(()=>rm(root,{recursive:true,force:true}));return root; }

test('MCP missing OAuth credentials never opens a browser or performs a network request', async t => {
  assert.equal(typeof module?.LinearMCPClient, 'function');
  const client = new module.LinearMCPClient({root:await fixture(t),store:store(null),fetch:()=>{throw new Error('must not fetch');}});
  assert.equal(await client.configured(),false);
  await assert.rejects(client.list(), error=>error.code==='LINEAR_NOT_CONFIGURED'&&/tickets:login/.test(error.message));
});

test('OAuth uses dynamic registration, read scope, PKCE and rejects an incorrect callback state', async t => {
  assert.equal(typeof module?.login, 'function');
  const storage=store(null), requests=[];
  let challenge, badStateStatus;
  const fetchMock=async(input,init={})=>{
    const url=String(input), headers={'content-type':'application/json'};
    requests.push({url,body:init.body});
    const json=value=>new Response(JSON.stringify(value),{status:200,headers});
    if(url.includes('oauth-protected-resource'))return json({resource:endpoint,authorization_servers:['https://mcp.linear.app'],scopes_supported:['read']});
    if(url.includes('oauth-authorization-server')||url.includes('openid-configuration'))return json({issuer:'https://mcp.linear.app',authorization_endpoint:'https://mcp.linear.app/authorize',token_endpoint:'https://mcp.linear.app/token',registration_endpoint:'https://mcp.linear.app/register',response_types_supported:['code'],grant_types_supported:['authorization_code','refresh_token'],token_endpoint_auth_methods_supported:['none'],code_challenge_methods_supported:['S256'],scopes_supported:['read']});
    if(url.endsWith('/register')) {
      const body=JSON.parse(init.body);assert.equal(body.scope,'read');assert.equal(body.token_endpoint_auth_method,'none');
      assert.match(body.redirect_uris[0],/^http:\/\/127\.0\.0\.1:\d+\/callback$/);
      return json({...body,client_id:'registered-fixture'});
    }
    if(url.endsWith('/token')) {
      const body=new URLSearchParams(init.body);
      assert.equal(body.get('grant_type'),'authorization_code');assert.equal(body.get('code'),'valid-code');
      assert.equal(createHash('sha256').update(body.get('code_verifier')).digest('base64url'),challenge);
      return json({access_token:'secret-access-fixture',refresh_token:'secret-refresh-fixture',expires_in:3600,token_type:'Bearer',scope:'read'});
    }
    throw new Error('Unexpected network request');
  };
  const result=await module.login({root:await fixture(t),store:storage,fetch:fetchMock,timeoutMs:5000,openUrl:async url=>{
    const authorization=new URL(url);challenge=authorization.searchParams.get('code_challenge');
    assert.equal(authorization.searchParams.get('scope'),'read');assert.equal(authorization.searchParams.get('code_challenge_method'),'S256');
    const callback=new URL(authorization.searchParams.get('redirect_uri'));
    callback.searchParams.set('code','valid-code');callback.searchParams.set('state','wrong-state');
    badStateStatus=(await fetch(callback)).status;
    callback.searchParams.set('state','é'.repeat(43));
    assert.equal((await fetch(callback)).status,400);
    callback.searchParams.set('state',authorization.searchParams.get('state'));
    assert.equal((await fetch(callback)).status,200);
  }});
  assert.equal(badStateStatus,400);
  assert.equal(result.authenticated,true);
  assert.equal(storage.value.tokens.access_token,'secret-access-fixture');
  assert.equal(storage.value.clientInformation.client_id,'registered-fixture');
  assert.doesNotMatch(JSON.stringify(result),/secret-access|secret-refresh/);
  assert.ok(requests.some(r=>r.url.endsWith('/register')));
});

test('read-only MCP client refuses mutations before connecting', async t => {
  assert.equal(typeof module?.LinearMCPClient,'function');
  const client=new module.LinearMCPClient({root:await fixture(t),store:store(null)});
  await assert.rejects(client.mutate({issueId:'x',comment:'no'}),e=>e.code==='LINEAR_READ_ONLY');
});

test('MCP discovery reads every tools page using the authenticated SDK transport', async t => {
  const calls=[];
  const storage=store({endpoint,identity:'identity-a',tokens:{access_token:'private-access',token_type:'Bearer'},clientInformation:{client_id:'client-a'},redirectUrl:'http://127.0.0.1:12345/callback'});
  const fetchMock=async(input,init)=>{
    assert.equal(new Headers(init.headers).get('authorization'),['Bearer','private-access'].join(' '));
    const request=JSON.parse(init.body);calls.push(request);
    if(request.id===undefined)return new Response(null,{status:202});
    let result;
    if(request.method==='initialize')result={protocolVersion:'2025-11-25',capabilities:{tools:{}},serverInfo:{name:'fixture',version:'1'}};
    else if(request.method==='tools/list')result=request.params?.cursor?{tools:[{name:'fixture_second',inputSchema:{type:'object'}}]}:{tools:[{name:'fixture_first',inputSchema:{type:'object'}}],nextCursor:'page-2'};
    else throw new Error('Unexpected method');
    return new Response(JSON.stringify({jsonrpc:'2.0',id:request.id,result}),{headers:{'content-type':'application/json'}});
  };
  const client=new module.LinearMCPClient({root:await fixture(t),store:storage,fetch:fetchMock});
  assert.deepEqual((await client.discover()).map(t=>t.name),['fixture_first','fixture_second']);
  assert.equal(calls.filter(c=>c.method==='tools/list').length,2);
});
const knownTools = [
  {name:'list_issues',inputSchema:{type:'object',properties:{query:{type:'string'},project:{type:'string'},team:{type:'string'},priority:{type:'number'},state:{type:'string'},assignee:{type:'string'},limit:{type:'number',maximum:250},cursor:{type:'string'},fields:{type:'array',items:{enum:['id','uuid','title','description','priority','url','gitBranchName','createdAt','updatedAt','status','statusType','labels','assignee','assigneeId','project','projectId','team','teamId']}}}}},
  {name:'get_issue',inputSchema:{type:'object',properties:{id:{type:'string'},fields:{type:'array',items:{enum:['id','uuid','title','description','priority','status','statusType','labels','team','teamId']}}},required:['id']}},
  {name:'list_comments',inputSchema:{type:'object',properties:{issueId:{type:'string'},limit:{type:'number'},cursor:{type:'string'}}}},
  {name:'get_user',inputSchema:{type:'object',properties:{query:{type:'string'}},required:['query']}},
  {name:'list_projects',inputSchema:{type:'object',properties:{limit:{type:'number',maximum:50},cursor:{type:'string'}}}},
  {name:'list_teams',inputSchema:{type:'object',properties:{limit:{type:'number'},cursor:{type:'string'}}}},
  {name:'list_issue_statuses',inputSchema:{type:'object',properties:{team:{type:'string'}},required:['team']}},
];
function mcpServer(handler,{tools=knownTools}={}) {
  const calls=[];
  const fetchMock=async(input,init)=>{
    const request=JSON.parse(init.body);calls.push(request);
    if(request.id===undefined)return new Response(null,{status:202});
    let result;
    if(request.method==='initialize')result={protocolVersion:'2025-11-25',capabilities:{tools:{}},serverInfo:{name:'Tracker fixture',version:'1'}};
    else if(request.method==='tools/list')result={tools};
    else if(request.method==='tools/call')result={content:[{type:'text',text:JSON.stringify(await handler(request.params.name,request.params.arguments))}]};
    else throw new Error('Unexpected method');
    return new Response(JSON.stringify({jsonrpc:'2.0',id:request.id,result}),{headers:{'content-type':'application/json'}});
  };
  return {calls,fetch:fetchMock};
}
function credentials(identity='one'){return {version:1,endpoint,identity,tokens:{access_token:'private-'+identity,token_type:'Bearer',issuer:'https://mcp.linear.app'},clientInformation:{client_id:'client-'+identity,issuer:'https://mcp.linear.app'},redirectUrl:'http://127.0.0.1:12345/callback'};}

test('MCP list maps verified filters, paginates and normalizes real Tracker response fields', async t => {
  const server=mcpServer((name,args)=>{
    assert.equal(name,'list_issues');
    assert.equal(args.query,'search');assert.equal(args.project,'project-uuid');assert.equal(args.priority,2);assert.equal(args.state,'state-uuid');assert.equal(args.assignee,'me');
    return args.cursor?{issues:[{id:'ABC-2',uuid:'issue-two',title:'Second',status:'Done',statusType:'completed',priority:{value:4,name:'Low'},team:'ABC',teamId:'team-uuid'}],hasNextPage:false}:{issues:[{id:'ABC-1',uuid:'issue-one',title:'First',gitBranchName:'abc-1-feature',status:'Started',statusType:'started',priority:{value:2,name:'High'},project:'Project',projectId:'project-uuid',assignee:'User',assigneeId:'user-uuid',labels:['bug'],team:'ABC',teamId:'team-uuid'}],hasNextPage:true,cursor:'next'};
  });
  const client=new module.LinearMCPClient({root:await fixture(t),store:store(credentials()),fetch:server.fetch});
  const result=await client.list({search:'search',projectId:'project-uuid',priority:2,stateId:'state-uuid',mine:true});
  assert.equal(result.issues.length,2);
  assert.equal(result.issues[0].id,'issue-one');assert.equal(result.issues[0].identifier,'ABC-1');
  assert.equal(result.issues[0].priority,2);assert.equal(result.issues[0].priorityLabel,'High');assert.equal(result.issues[0].state.type,'started');
  assert.deepEqual(result.issues[0].project,{id:'project-uuid',name:'Project'});assert.deepEqual(result.issues[0].assignee,{id:'user-uuid',name:'User'});
  assert.equal(result.issues[0].labels[0].name,'bug');assert.equal(result.issues[0].branchName,'abc-1-feature');
  assert.equal(server.calls.filter(c=>c.method==='tools/call').length,2);
});

test('MCP details include every comments page and metadata preserves UUIDs and team states', async t => {
  const server=mcpServer((name,args)=>{
    if(name==='get_issue')return {id:'ABC-1',uuid:'issue-one',title:'Complete',description:'Full description',status:'Started',statusType:'started',priority:{value:1,name:'Urgent'},team:'ABC',teamId:'team-uuid'};
    if(name==='list_comments')return args.cursor?{comments:[{id:'comment-2',body:'Second'}],hasNextPage:false}:{comments:[{id:'comment-1',body:'First',author:{id:'user-uuid',name:'User'}}],hasNextPage:true,cursor:'comments-next'};
    if(name==='get_user')return {id:'user-uuid',name:'User'};
    if(name==='list_teams')return {teams:[{id:'team-uuid',key:'ABC',name:'Team'}],hasNextPage:false};
    if(name==='list_projects')return {projects:[{id:'P-ABC-1',uuid:'project-uuid',name:'Project'}],hasNextPage:false};
    if(name==='list_issue_statuses'){assert.equal(args.team,'team-uuid');return [{id:'state-uuid',name:'Started',type:'started'}];}
    throw new Error('Unexpected tool');
  });
  const client=new module.LinearMCPClient({root:await fixture(t),store:store(credentials()),fetch:server.fetch});
  const {issue}=await client.detail('ABC-1');
  assert.equal(issue.description,'Full description');assert.equal(issue.comments.length,2);assert.equal(issue.comments[0].user.name,'User');
  const meta=await client.meta();assert.equal(meta.viewer.id,'user-uuid');assert.equal(meta.projects[0].id,'project-uuid');
  assert.deepEqual(meta.states[0].team,{id:'team-uuid'});
});

test('MCP cache is private and partitioned by OAuth identity; missing credentials cannot read it', async t => {
  const root=await fixture(t), storage=store(credentials('one'));
  let loads=0;
  const server=mcpServer(()=>({issues:[{id:'ABC-'+(++loads),uuid:'issue-'+loads,title:'Visible'}],hasNextPage:false}));
  const client=new module.LinearMCPClient({root,store:storage,fetch:server.fetch});
  assert.equal((await client.list()).issues[0].id,'issue-1');
  assert.equal((await client.list()).cached,true);assert.equal(loads,1);
  storage.value=credentials('two');assert.equal((await client.list()).issues[0].id,'issue-2');
  storage.value=null;await assert.rejects(client.list(),e=>e.code==='LINEAR_NOT_CONFIGURED');
});

test('undiscovered or incompatible tools fail without sending an invented tool call', async t => {
  const server=mcpServer(()=>{throw new Error('Must not call');},{tools:[{name:'write_everything',inputSchema:{type:'object'}}]});
  const client=new module.LinearMCPClient({root:await fixture(t),store:store(credentials()),fetch:server.fetch});
  await assert.rejects(client.list(),e=>e.code==='LINEAR_MCP_UNSUPPORTED');
  assert.equal(server.calls.filter(c=>c.method==='tools/call').length,0);
});

test('OAuth callback state rejects Unicode without throwing and accepts only equal bytes', () => {
  assert.equal(typeof module?.validOAuthState,'function');
  assert.equal(module.validOAuthState('abc','abc'),true);
  assert.equal(module.validOAuthState('abc','abd'),false);
  assert.equal(module.validOAuthState('é'.repeat(43),'a'.repeat(43)),false);
});

test('failed OAuth login preserves an existing Keychain session until successful authorization', async t => {
  assert.equal(typeof module?.authorizeSession,'function');
  const original=credentials(),storage=store(original),root=await fixture(t);
  await assert.rejects(module.authorizeSession({root,store:storage,redirectUrl:'http://127.0.0.1:12345/callback',state:'fixture',code:Promise.resolve('code'),authorize:async provider=>{
    await provider.saveDiscoveryState({authorizationServerUrl:'https://mcp.linear.app'});
    await provider.saveClientInformation({client_id:'new-client'});
    throw new Error('rejected secret-refresh-fixture');
  }}),error=>error.code==='LINEAR_AUTH'&&!error.message.includes('secret-refresh'));
  assert.deepEqual(storage.value,original);
});

test('simultaneous MCP clients serialize token refresh and reload the rotated Keychain credentials', async t => {
  const root=await fixture(t),initial=credentials(),storage=store(initial);
  storage.value.tokens.refresh_token='initial-refresh';
  storage.value.discovery={authorizationServerUrl:'https://mcp.linear.app',authorizationServerMetadata:{issuer:'https://mcp.linear.app',authorization_endpoint:'https://mcp.linear.app/authorize',token_endpoint:'https://mcp.linear.app/token',registration_endpoint:'https://mcp.linear.app/register',response_types_supported:['code'],grant_types_supported:['authorization_code','refresh_token'],token_endpoint_auth_methods_supported:['none'],code_challenge_methods_supported:['S256']},resourceMetadata:{resource:endpoint,authorization_servers:['https://mcp.linear.app'],scopes_supported:['read']}};
  let refreshCalls=0;
  const base=mcpServer(()=>({issues:[],hasNextPage:false}));
  const fetchMock=async(input,init)=>{
    if(String(input).endsWith('/token')){
      refreshCalls++;
      const params=new URLSearchParams(init.body);assert.equal(params.get('grant_type'),'refresh_token');assert.equal(params.get('refresh_token'),'initial-refresh');
      await new Promise(r=>setTimeout(r,20));
      return new Response(JSON.stringify({access_token:'rotated-access',refresh_token:'rotated-refresh',token_type:'Bearer',scope:'read'}),{headers:{'content-type':'application/json'}});
    }
    if(new Headers(init.headers).get('authorization')!==['Bearer','rotated-access'].join(' '))return new Response('',{status:401,headers:{'WWW-Authenticate':['Bearer','scope="read"'].join(' ')}});
    return base.fetch(input,init);
  };
  const one=new module.LinearMCPClient({root,store:storage,fetch:fetchMock});
  const two=new module.LinearMCPClient({root,store:storage,fetch:fetchMock});
  const results=await Promise.all([one.list({refresh:true}),two.list({refresh:true})]);
  assert.equal(results.length,2);assert.equal(refreshCalls,1);assert.equal(storage.value.tokens.refresh_token,'rotated-refresh');
});

test('ticket adapter keeps an MCP list without pagination evidence incomplete',async t=>{
  const {createTicketFactory}=await import('../../factory.mjs');
  const server=mcpServer(()=>({issues:[{id:'DEMO-1',uuid:'opaque',status:'Started',statusType:'started'}]}));
  const {getTickets}=createTicketFactory({root:await fixture(t),loadConfig:async()=>({tracker:{transport:'mcp',endpoint}}),transportOptions:{store:store(credentials()),fetch:server.fetch}});
  const data=await (await getTickets()).list();assert.equal(data.complete,false);assert.equal(data.tickets[0].status.category,'active');
});
