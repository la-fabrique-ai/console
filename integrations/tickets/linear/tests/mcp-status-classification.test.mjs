import test from 'node:test';
import assert from 'node:assert/strict';
import { LinearMCPClient,MCP_ENDPOINT } from '../linear-mcp.mjs';
import { fixture } from '../../../../tests/helpers/backend-fixture.mjs';
import { createBackend } from '../../../../src/backend.mjs';

import { withFakeHerdr } from '../../../../tests/helpers/fake-herdr.mjs';
function clientFor(root,{statuses,issues,failStatuses=false}) {
  const calls=[],fields=['id','uuid','title','status','team','teamId'];
  const tools=[
    {name:'list_issues',inputSchema:{type:'object',properties:{project:{type:'string'},team:{type:'string'},limit:{type:'number'},cursor:{type:'string'},fields:{type:'array',items:{enum:fields}}}}},
    {name:'get_issue',inputSchema:{type:'object',properties:{id:{type:'string'},fields:{type:'array',items:{enum:fields}}}}},
    {name:'list_comments',inputSchema:{type:'object',properties:{issueId:{type:'string'},limit:{type:'number'},cursor:{type:'string'}}}},
    {name:'list_issue_statuses',inputSchema:{type:'object',properties:{team:{type:'string'},limit:{type:'number'},cursor:{type:'string'}}}},
  ];
  const fetch=async(_url,init)=>{
    const request=JSON.parse(init.body);if(request.id===undefined)return new Response(null,{status:202});let result;
    if(request.method==='initialize')result={protocolVersion:'2025-11-25',capabilities:{tools:{}},serverInfo:{name:'fixture',version:'1'}};
    else if(request.method==='tools/list')result={tools};
    else {
      const {name,arguments:args}=request.params;calls.push({name,args});let data;
      if(name==='list_issues')data={issues,hasNextPage:false};
      else if(name==='get_issue')data=issues.find(i=>i.id===args.id);
      else if(name==='list_comments')data=[];
      else if(name==='list_issue_statuses'){
        if(failStatuses)return new Response(JSON.stringify({jsonrpc:'2.0',id:request.id,result:{isError:true,content:[{type:'text',text:'private failure'}]}}),{headers:{'content-type':'application/json'}});
        data=args.cursor?{states:statuses[args.team],hasNextPage:false}:{states:[],hasNextPage:true,cursor:'statuses-2'};
      }else throw new Error('Unexpected tool '+name);
      result={content:[{type:'text',text:JSON.stringify(data)}]};
    }
    return new Response(JSON.stringify({jsonrpc:'2.0',id:request.id,result}),{headers:{'content-type':'application/json'}});
  };
  const store={read:async()=>({endpoint:MCP_ENDPOINT,identity:'fixture',tokens:{access_token:'oauth-fixture',token_type:'Bearer'},clientInformation:{client_id:'fixture'}})};
  return {client:new LinearMCPClient({root,store,fetch}),calls};
}

test('missing MCP statusType reproduces unclassified Gamma and Beta and resolves by team plus exact status name in list and detail',async t=>{
  const f=await fixture(t),teams=['Gamma','Beta','Alpha','Mission','Other'],types=['started','completed','backlog','unstarted','triage'];
  const issues=teams.map((team,i)=>({id:'T-'+i,uuid:'issue-'+i,title:'Fixture',status:'À étudier',team,teamId:'team-'+i}));
  const statuses=Object.fromEntries(teams.map((_,i)=>['team-'+i,[{id:'state-'+i,name:'À étudier',type:types[i]}]]));
  const {client,calls}=clientFor(f.home,{issues,statuses}),list=await client.list();
  assert.deepEqual(list.issues.map(i=>i.state.type),types);
  assert.deepEqual(list.issues.map(i=>i.state.id),types.map((_,i)=>'state-'+i));
  assert.ok(list.issues.every(i=>i.statusClassification.source==='team-status-name'));
  assert.equal((await client.detail('T-0')).issue.state.type,'started');
  assert.equal(calls.some(c=>c.args.fields?.includes('statusType')),false);
  assert.equal(calls.filter(c=>c.name==='list_issue_statuses').length,12);
  f.config.projects[0].teamId='team-0';await f.write('config.json',f.config);
  // Exercise the existing summary path with a team-filtered fixture response.
  const only=clientFor(f.home+'/summary',{issues:[issues[0]],statuses}).client;
  const backend=createBackend(withFakeHerdr({root:f.home,tracker:only,exec:f.command}));
  const summary=await backend.dispatch('project-summary',{key:'example'});assert.equal(summary.unknown,0);assert.equal(summary.open,1);
});

test('MCP status metadata failure or an ambiguous exact name stays explicitly unknown without a guessed type',async t=>{
  const f=await fixture(t),issues=[{id:'T-1',status:'À étudier',team:'Gamma',teamId:'team-0'}];
  for(const [suffix,options,reason] of [
    ['failed',{failStatuses:true,statuses:{}},'metadata-unavailable'],
    ['ambiguous',{statuses:{'team-0':[{id:'one',name:'À étudier',type:'started'},{id:'two',name:'À étudier',type:'completed'}]}},'status-ambiguous'],
    ['exact',{statuses:{'team-0':[{id:'one',name:'à étudier',type:'started'}]}},'status-not-found'],
  ]){
    const {client}=clientFor(f.home+'/'+suffix,{issues,...options}),result=await client.list();
    assert.equal(result.issues[0].state.type,'unknown');assert.equal(result.issues[0].statusClassification.reason,reason);
  }
});
