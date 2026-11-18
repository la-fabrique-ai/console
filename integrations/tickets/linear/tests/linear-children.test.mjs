import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {LinearClient} from '../linear.mjs';
import {LinearMCPClient,MCP_ENDPOINT} from '../linear-mcp.mjs';
import {createTicketReader} from '../../../../src/ticket-read.mjs';

const conn=(nodes=[],more=false)=>({nodes,pageInfo:{hasNextPage:more,endCursor:more?'next':null}});
const child=(extra={})=>({id:'child-uuid',identifier:'XJ-2',title:'Child task',url:'https://linear.app/example/issue/XJ-2',description:'Modèle : gpt-6.1-sol · effort high',state:{name:'Todo',type:'unstarted'},labels:conn([{name:'agent:codex'},{name:'niveau:fort'}]),inverseRelations:conn([{id:'r',type:'blocks',issue:{id:'blocker'}},{id:'r2',type:'related',issue:{id:'other'}}]),...extra});
const rootIssue=children=>({id:'parent',identifier:'XJ-1',title:'Parent',labels:conn(),comments:conn(),children});
async function directory(t){const root=await mkdtemp(join(tmpdir(),'fabrique-console-children-'));t.after(()=>rm(root,{recursive:true,force:true}));return root;}
async function graphql(t,data){const requests=[];const client=new LinearClient({root:await directory(t),provider:{getToken:async()=>'synthetic'},fetch:async(_u,init)=>{const request=JSON.parse(init.body);requests.push(request);return new Response(JSON.stringify({data:{issue:data}}),{headers:{'content-type':'application/json'}});}});return {client,requests};}
const detail=client=>createTicketReader({getTickets:async()=>client,loadConfig:async()=>({})}).detail({id:'parent'});

test('GraphQL detail returns children with labels, blocker IDs and an allowed model proposal',async t=>{
  const {client,requests}=await graphql(t,rootIssue(conn([child()])));const {issue}=await detail(client);
  assert.equal(issue.childrenComplete,true);assert.equal(issue.childrenReason,null);
  assert.deepEqual(issue.children[0],{id:'child-uuid',identifier:'XJ-2',title:'Child task',state:{name:'Todo',type:'unstarted'},labels:[{name:'agent:codex'},{name:'niveau:fort'}],labelsComplete:true,blockedBy:['blocker'],blockedByComplete:true,url:'https://linear.app/example/issue/XJ-2',model:'gpt-6.1-sol',effort:'high',modelIssue:null});
  assert.match(requests[0].query,/children\(first:\d+/);assert.equal(requests.length,1);
});

test('truncated children or nested label/dependency pages are never presented as complete',async t=>{
  for(const [children,want] of [[conn([child()],true),'truncated'],[conn([child({labels:conn([],true)})]),'incomplete-fields'],[conn([child({inverseRelations:conn([],true)})]),'incomplete-fields']]) {
    const {client}=await graphql(t,rootIssue(children));const {issue}=await detail(client);
    assert.equal(issue.childrenComplete,false);assert.equal(issue.childrenReason,want);
  }
});

test('unknown models, wrong family, invalid effort, ambiguous lines and code examples never become an active proposal',async t=>{
  for(const [description,labels,reason] of [
    ['Modèle : unknown-model · effort high',conn([{name:'agent:codex'}]),true],
    ['Modèle : gpt-6.1-sol · effort high',conn([{name:'agent:claude'}]),true],
    ['Modèle : gpt-6.1-sol · effort ultra',conn(),true],
    ['Modèle : gpt-6.1-sol · effort high\nModèle : gpt-6-luna · effort low',conn(),true],
    ['```\nModèle : unknown-model · effort high\n```',conn(),false],
    ['No model proposed.',conn(),false],
  ]) {
    const {client}=await graphql(t,rootIssue(conn([child({description,labels})])));const c=(await detail(client)).issue.children[0];
    assert.equal(c.model,null);assert.equal(c.effort,null);assert.equal(Boolean(c.modelIssue),reason);
  }
});

test('a cached issue from the former shape cannot hide newly requested children',async t=>{
  const {client,requests}=await graphql(t,rootIssue(conn()));
  await client.cached(['issue-relations-v1','parent'],false,async()=>({issue:{id:'old'}}));
  const {issue}=await detail(client);assert.equal(issue.id,'parent');assert.equal(issue.childrenComplete,true);assert.equal(requests.length,1);
});

async function mcp(t,{parentFilter=false,children=[],more=false,statusCatalog=false,childrenError=false}={}) {
  const calls=[],fields=['id','uuid','title','description','url','status','statusType','labels','labelsComplete','parentId','blockedBy','blockedByComplete'];
  const tools=[{name:'get_issue',inputSchema:{type:'object',properties:{id:{type:'string'},fields:{type:'array',items:{enum:fields}}}}},{name:'list_comments',inputSchema:{type:'object',properties:{issueId:{type:'string'}}}},{name:'list_issues',inputSchema:{type:'object',properties:{...(parentFilter?{parentId:{type:'string'}}:{}),limit:{type:'number'},fields:{type:'array',items:{enum:fields}}}}}];
  if(statusCatalog)tools.push({name:'list_issue_statuses',inputSchema:{type:'object',properties:{team:{type:'string'}}}});
  const client=new LinearMCPClient({root:await directory(t),store:{read:async()=>({endpoint:MCP_ENDPOINT,identity:'fixture',tokens:{access_token:'synthetic',token_type:'Bearer'},clientInformation:{client_id:'fixture'}})},fetch:async(_u,init)=>{
    const r=JSON.parse(init.body);if(r.id===undefined)return new Response(null,{status:202});let result;
    if(r.method==='initialize')result={protocolVersion:'2025-11-25',capabilities:{tools:{}},serverInfo:{name:'fixture',version:'1'}};
    else if(r.method==='tools/list')result={tools};
    else {const {name,arguments:args}=r.params;calls.push({name,args});const data=name==='get_issue'?{id:'XJ-1',uuid:'parent',title:'Parent',status:'Todo',statusType:'unstarted',teamId:'team'}:name==='list_comments'?[]:name==='list_issue_statuses'?[{id:'todo',name:'Todo',type:'unstarted'}]:{issues:children,hasNextPage:more,cursor:more?'next':null};const failed=childrenError&&name==='list_issues';result={...(failed?{isError:true}:{}),content:[{type:'text',text:JSON.stringify(failed?{error:childrenError}:data)}]};}
    return new Response(JSON.stringify({jsonrpc:'2.0',id:r.id,result}),{headers:{'content-type':'application/json'}});
  }});return {client,calls};
}

test('MCP without an advertised parent filter reports children unavailable, not an authoritative empty list',async t=>{
  const {client,calls}=await mcp(t);const {issue}=await detail(client);
  assert.deepEqual(issue.children,[]);assert.equal(issue.childrenComplete,false);assert.equal(issue.childrenReason,'unavailable');
  assert.equal(calls.some(c=>c.name==='list_issues'),false);
});

test('MCP child status type is resolved by the exact team catalog when not returned in the list',async t=>{
  const c={id:'XJ-2',uuid:'child',parentId:'parent',title:'Task',url:'https://linear.app/example/issue/XJ-2',status:'Todo',labels:[],labelsComplete:true,blockedBy:[],blockedByComplete:true,description:null};
  const {client,calls}=await mcp(t,{parentFilter:true,statusCatalog:true,children:[c]});const {issue}=await detail(client);
  assert.deepEqual(issue.children[0].state,{name:'Todo',type:'unstarted'});assert.equal(issue.childrenComplete,true);
  assert.equal(calls.find(c=>c.name==='list_issue_statuses').args.team,'team');
});

test('a child explicit teamId takes precedence over its parent team during status classification',async t=>{
  const c={id:'XJ-2',uuid:'child',parentId:'parent',teamId:'other-team',title:'Task',url:'https://linear.app/example/issue/XJ-2',status:'Todo',labels:[],blockedBy:[],description:null};
  const {client,calls}=await mcp(t,{parentFilter:true,statusCatalog:true,children:[c]});await detail(client);
  assert.equal(calls.find(c=>c.name==='list_issue_statuses').args.team,'other-team');
});

test('missing or unreadable model source is unverified, not a complete no-model decision',async t=>{
  for(const description of [undefined,{text:'different format'}]) {
    const {client}=await graphql(t,rootIssue(conn([child({description})])));const {issue}=await detail(client);
    assert.equal(issue.childrenComplete,false);assert.equal(issue.children[0].model,null);assert.ok(issue.children[0].modelIssue);
  }
});

test('Claude model proposals are supported without translating their family or effort',async t=>{
  const {client}=await graphql(t,rootIssue(conn([child({description:'Modèle : claude-sonnet-5-5 · effort medium',labels:conn([{name:'agent:Claude'}])})])));
  const c=(await detail(client)).issue.children[0];assert.equal(c.model,'claude-sonnet-5-5');assert.equal(c.effort,'medium');assert.equal(c.modelIssue,null);
});

test('MCP advertised parent filter returns the same child contract and explicitly marks truncation',async t=>{
  const record={id:'XJ-2',uuid:'child-uuid',parentId:'parent',title:'Child task',url:'https://linear.app/example/issue/XJ-2',description:'Modèle : gpt-6.1-sol · effort high',status:'Todo',statusType:'unstarted',labels:[{name:'agent:codex'},{name:'niveau:fort'}],labelsComplete:true,blockedBy:['blocker'],blockedByComplete:true};
  for(const more of [false,true]) {
    const {client,calls}=await mcp(t,{parentFilter:true,children:[record],more});const {issue}=await detail(client);
    assert.equal(issue.childrenComplete,!more);assert.equal(issue.children[0].model,'gpt-6.1-sol');assert.deepEqual(issue.children[0].blockedBy,['blocker']);
    const call=calls.find(c=>c.name==='list_issues');assert.equal(call.args.parentId,'parent');
    assert.ok(call.args.fields.includes('description'));assert.ok(call.args.fields.includes('blockedBy'));
  }
});

test('MCP child arrays require explicit completeness attestation before labels, dependencies or models are verified',async t=>{
  for(const [flags,labelsComplete,blockedByComplete] of [[{},false,false],[{labelsComplete:true},true,false],[{blockedByComplete:true},false,true],[{labelsComplete:'true',blockedByComplete:null},false,false]]) {
    const record={id:'XJ-2',uuid:'child',title:'Task',url:'https://linear.app/example/issue/XJ-2',description:'Modèle : gpt-6.1-sol · effort high',status:'Todo',statusType:'unstarted',labels:[{name:'agent:codex'}],blockedBy:[],...flags};
    const {client,calls}=await mcp(t,{parentFilter:true,children:[record]});const {issue}=await detail(client),c=issue.children[0];
    assert.equal(c.labelsComplete,labelsComplete);assert.equal(c.blockedByComplete,blockedByComplete);
    assert.equal(issue.childrenComplete,false);assert.equal(issue.childrenReason,'incomplete-fields');
    assert.equal(c.model,labelsComplete?'gpt-6.1-sol':null);assert.equal(Boolean(c.modelIssue),!labelsComplete);
    const request=calls.find(c=>c.name==='list_issues');assert.ok(request.args.fields.includes('labelsComplete'));assert.ok(request.args.fields.includes('blockedByComplete'));
  }
});

test('MCP dependency aliases resolve to the same child id used by the page',async t=>{
  const base={title:'Task',url:'https://linear.app/example/issue/XJ-2',description:null,status:'Todo',statusType:'unstarted',labels:[],labelsComplete:true,blockedByComplete:true};
  const records=[{...base,id:'XJ-3',uuid:'task-uuid',blockedBy:['XJ-2',{id:'XJ-2'},{uuid:'blocker-uuid',id:'XJ-2'}]},{...base,id:'XJ-2',uuid:'blocker-uuid',blockedBy:[]}];
  const {client}=await mcp(t,{parentFilter:true,children:records});const {issue}=await detail(client);
  assert.deepEqual(issue.children[0].blockedBy,['blocker-uuid']);assert.equal(issue.children[1].id,'blocker-uuid');assert.equal(issue.childrenComplete,true);
});

test('agent label spacing does not reject a matching model family',async t=>{
  const {client}=await graphql(t,rootIssue(conn([child({description:'Modèle : claude-sonnet-5-5 · effort medium',labels:conn([{name:'agent: Claude '}])})])));
  const c=(await detail(client)).issue.children[0];assert.equal(c.model,'claude-sonnet-5-5');assert.equal(c.modelIssue,null);
});

test('a failed MCP child read keeps the parent readable and children explicitly unavailable',async t=>{
  const secret='synthetic-child-token',rawError='Upstream rejected Bearer '+secret;
  const {client}=await mcp(t,{parentFilter:true,childrenError:rawError});const {issue}=await detail(client);
  assert.equal(issue.id,'parent');assert.deepEqual(issue.children,[]);assert.equal(issue.childrenComplete,false);assert.equal(issue.childrenReason,'unavailable');
  assert.equal(JSON.stringify(issue).includes(secret),false);assert.equal(JSON.stringify(issue).includes(rawError),false);
});

test('MCP does not reuse cached completeness from before explicit nested-list attestations',async t=>{
  const {client,calls}=await mcp(t,{parentFilter:true});
  await client.cached(['issue-children-v1','parent'],false,async()=>({issue:{id:'parent',children:[{id:'stale'}],childrenComplete:true,childrenReason:null}}));
  const {issue}=await detail(client);assert.deepEqual(issue.children,[]);assert.equal(issue.childrenComplete,true);
  assert.equal(calls.filter(c=>c.name==='get_issue').length,1);
});

test('an ambiguous child dependency alias stays raw and explicitly incomplete rather than naming either UUID',async t=>{
  const base={title:'Task',url:'https://linear.app/example/issue/XJ-2',description:null,status:'Todo',statusType:'unstarted',labels:[],labelsComplete:true,blockedByComplete:true};
  const records=[{...base,id:'XJ-3',uuid:'task',blockedBy:['XJ-2']},{...base,id:'XJ-2',uuid:'first',blockedBy:[]},{...base,id:'XJ-2',uuid:'second',blockedBy:[]}];
  const {client}=await mcp(t,{parentFilter:true,children:records});const {issue}=await detail(client);
  assert.deepEqual(issue.children[0].blockedBy,['XJ-2']);assert.equal(issue.children[0].blockedByComplete,false);
  // Two children under the same identifier: the list does not say which ticket is which.
  assert.equal(issue.childrenComplete,false);assert.equal(issue.childrenReason,'unidentified');
});

test('a child without a readable id makes the list unidentified, not merely short of fields',async t=>{
  const base={title:'Task',url:'https://linear.app/example/issue/XJ-2',description:null,status:'Todo',statusType:'unstarted',labels:[],blockedBy:[]};
  const {client}=await mcp(t,{parentFilter:true,children:[{...base,id:'XJ-2',uuid:'first'},{...base,identifier:'XJ-3'}]});const {issue}=await detail(client);
  assert.deepEqual(issue.children.map(c=>c.identifier),['XJ-2']);
  assert.equal(issue.childrenComplete,false);assert.equal(issue.childrenReason,'unidentified');
});
