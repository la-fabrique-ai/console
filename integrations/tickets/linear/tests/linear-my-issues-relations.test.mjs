import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {LinearClient} from '../linear.mjs';
import {LinearMCPClient,MCP_ENDPOINT} from '../linear-mcp.mjs';
import {createTicketReader} from '../../../../src/ticket-read.mjs';
import {queryCost} from '../../../../tests/helpers/query-cost.mjs';

async function folder(t){const root=await mkdtemp(join(tmpdir(),'fabrique-console-relations-'));t.after(()=>rm(root,{recursive:true,force:true}));return root;}
const connection=(nodes=[],hasNextPage=false,endCursor=null)=>({nodes,pageInfo:{hasNextPage,endCursor}});
const edge=(id,type,target,inverse=false)=>({id,type,[inverse?'issue':'relatedIssue']:{id:target}});
const raw=(id,extra={})=>({id,identifier:'XJ-'+id,title:'Task '+id,team:{id:'team'},project:{id:'project',name:'Project'},parent:null,relations:connection(),inverseRelations:connection(),labels:connection(),state:{name:'Todo',type:'unstarted'},...extra});
const reader=client=>createTicketReader({getTickets:async()=>client,loadConfig:async()=>({projects:[{key:'one',teamId:'team'}]})});
async function graph(t,handler){const queries=[];const client=new LinearClient({root:await folder(t),provider:{getToken:async()=>'synthetic'},fetch:async(_url,init)=>{const request=JSON.parse(init.body);queries.push(request);return new Response(JSON.stringify({data:handler(request)}),{headers:{'content-type':'application/json'}});}});return {client,queries};}

test('GraphQL My issues counts distinct blocked targets and blocking sources after both relation pages',async t=>{
  const first=raw('1',{parent:{id:'parent'},relations:connection([edge('r1','blocks','a'),edge('r2','related','b'),edge('r3','blocks','b')],true,'out-next'),inverseRelations:connection([edge('i1','blocks','source',true)],true,'in-next')});
  const {client,queries}=await graph(t,({query,variables})=>{
    if(query.includes('FabriqueConsoleIssues('))return {issues:connection([first,raw('2')])};
    if(query.includes('inverseRelations'))return {issue:{inverseRelations:connection([edge('i2','blocks','source',true),edge('i3','duplicate','ignored',true),edge('i4','blocks','other',true)])}};
    return {issue:{relations:connection([edge('r4','blocks','b'),edge('r5','blocks','c')])}};
  });
  const data=await reader(client).myIssues({});
  assert.equal(data.relations,'full');
  for(const issues of [data.teams[0].projects[0].issues,data.activity])assert.deepEqual(issues.map(i=>[i.id,i.parentId,i.blocks,i.blockedBy]),[['1','parent',3,2],['2',null,0,0]]);
  assert.match(queries[0].query,/parent\s*\{\s*id\s*\}/);
  assert.ok(queries.some(q=>q.variables.after==='out-next'));
  assert.ok(queries.some(q=>q.variables.after==='in-next'));
  for(const field of ['relations','inverseRelations']) {
    const selections=queries.flatMap(({query})=>[...query.matchAll(new RegExp('\\b'+field+'\\s*\\(([^)]*)\\)','g'))]);
    assert.ok(selections.length>0,field+' must be requested');
    for(const match of selections)assert.match(match[1],/\bincludeArchived\s*:\s*false\b/,field+' must exclude archived relations in seeds and continuations');
  }
  for(const {query}of queries)assert.ok(queryCost(query,{nestedLimits:{labels:50}})<10000);
});

test('GraphQL does not publish full relation counts when a continuation has a repeated cursor',async t=>{
  const issue=raw('1',{relations:connection([edge('r1','blocks','a')],true,'loop')});
  const {client}=await graph(t,({query})=>query.includes('FabriqueConsoleIssues(')?{issues:connection([issue])}:{issue:{relations:connection([edge('r2','blocks','b')],true,'loop')}});
  const data=await reader(client).myIssues({});
  assert.equal(data.relations,'none');assert.equal(data.teams[0].error.code,'LINEAR_PAGINATION');assert.deepEqual(data.activity,[]);
});

test('fresh legacy list cache is not reused as verified relation data',async t=>{
  const {client,queries}=await graph(t,()=>({issues:connection([raw('1',{parent:{id:'p'}})])}));
  await client.cached(['issues-with-labels',{team:{id:{eq:'team'}}}],false,async()=>({issues:[{id:'old'}]}));
  const data=await client.list({teamId:'team'});assert.equal(data.cached,false);assert.equal(data.relations,'full');assert.equal(data.issues[0].parentId,'p');assert.equal(queries.length,1);
});

async function mcp(t,{issues,fields}){
  const calls=[],properties={team:{type:'string'},limit:{type:'number'},cursor:{type:'string'},...(fields?{fields:{type:'array',items:{enum:fields}}}:{})};
  const client=new LinearMCPClient({root:await folder(t),store:{read:async()=>({endpoint:MCP_ENDPOINT,identity:'fixture',tokens:{access_token:'synthetic',token_type:'Bearer'},clientInformation:{client_id:'fixture'}})},fetch:async(_url,init)=>{
    const r=JSON.parse(init.body);if(r.id===undefined)return new Response(null,{status:202});let result;
    if(r.method==='initialize')result={protocolVersion:'2025-11-25',capabilities:{tools:{}},serverInfo:{name:'fixture',version:'1'}};
    else if(r.method==='tools/list')result={tools:[{name:'list_issues',inputSchema:{type:'object',properties}},
      {name:'get_issue',inputSchema:{type:'object',properties:{id:{type:'string'},fields:properties.fields}}},
      {name:'list_comments',inputSchema:{type:'object',properties:{issueId:{type:'string'}}}}]};
    else{calls.push(r.params);const {name}=r.params;assert.ok(['list_issues','get_issue','list_comments'].includes(name));const data=name==='get_issue'?issues[0]:name==='list_comments'?[]:{issues,hasNextPage:false};result={content:[{type:'text',text:JSON.stringify(data)}]};}
    return new Response(JSON.stringify({jsonrpc:'2.0',id:r.id,result}),{headers:{'content-type':'application/json'}});
  }});
  return {client,calls};
}
const mcpRaw=(id,extra={})=>({id:'XJ-'+id,uuid:id,title:'Task',teamId:'team',projectId:'project',project:'Project',status:'Todo',statusType:'unstarted',...extra});
test('MCP advertised parent is requested and passed through without an issue-by-issue read',async t=>{
  const {client,calls}=await mcp(t,{fields:['id','uuid','parentId','statusType'],issues:[mcpRaw('1',{parentId:'parent'}),mcpRaw('2',{parentId:null})]});
  const data=await reader(client).myIssues({});assert.equal(data.relations,'parent');
  assert.deepEqual(data.activity.map(i=>[i.parentId,i.blocks,i.blockedBy]),[['parent',0,0],[null,0,0]]);
  assert.equal(calls.length,1);assert.ok(calls[0].arguments.fields.includes('parentId'));
});
test('MCP parent returned without a field selector is preserved; absent fields remain explicitly unavailable',async t=>{
  for(const [extra,want,parent]of [[{parentId:'p'},'parent','p'],[{parentId:null},'parent',null],[{},'none',null]]){
    const {client,calls}=await mcp(t,{issues:[mcpRaw('1',extra)]});const data=await reader(client).myIssues({});
    assert.equal(data.relations,want);assert.equal(data.activity[0].parentId,parent);assert.equal(data.activity[0].blocks,0);assert.equal(data.activity[0].blockedBy,0);assert.equal(calls.length,1);
  }
});
test('MCP detail ignores a fresh legacy cache that predates parent and relation fields',async t=>{
  const {client,calls}=await mcp(t,{issues:[mcpRaw('1',{parentId:'parent'})]});
  await client.cached(['issue-status-v2','XJ-1'],false,async()=>({issue:{id:'legacy'}}));
  const data=await client.detail('XJ-1');
  assert.equal(data.cached,false);assert.equal(data.issue.id,'1');
  assert.deepEqual([data.issue.parentId,data.issue.blocks,data.issue.blockedBy],['parent',0,0]);
  assert.deepEqual(calls.map(c=>c.name),['get_issue','list_comments']);
});
test('My issues relation capability is conservative across readable teams and empty on total failure',async()=>{
  const make=levels=>createTicketReader({loadConfig:async()=>({projects:levels.map((_,i)=>({key:'p'+i,teamId:''+i}))}),getTickets:async()=>({list:async({scope:{id:teamId}})=>{const level=levels[Number(teamId)];if(level==='error')throw Object.assign(new Error('unavailable'),{code:'LINEAR_API'});return {issues:[],relations:level};}})});
  assert.equal((await make(['full','parent']).myIssues({})).relations,'parent');
  assert.equal((await make(['full','none']).myIssues({})).relations,'none');
  assert.equal((await make(['full','error']).myIssues({})).relations,'full');
  assert.equal((await make(['error']).myIssues({})).relations,'none');
});
