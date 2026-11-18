import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readdir,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,relative} from 'node:path';
let factory;
try{factory=await import('../integrations/tickets/factory.mjs');}catch{}
const observedAt='2026-01-01T00:00:00.000Z';
const raw={id:'opaque:id/42',identifier:'DEMO-1',title:'Keep all fields',description:'Untrusted content',state:{id:'s',name:'À démarrer',type:'unstarted'},labels:[],comments:[{id:'c',body:'Comment'}],children:[],childrenComplete:false};
const fake={configured:async()=>true,list:async()=>({issues:[raw],relations:'parent',complete:true,updatedAt:observedAt,cached:true}),detail:async()=>({issue:raw,updatedAt:observedAt,cached:true}),meta:async()=>({teams:[{id:'scope'}],projects:[],states:[raw.state],updatedAt:observedAt,cached:true}),mutate:async p=>({success:true,payload:p})};
// These shared cases catch field loss, invented completeness/freshness, and accidental ID parsing.
for(const mode of ['simulated','adapter'])test('ticket contract: '+mode,async t=>{
  assert.equal(typeof factory?.createTicketFactory,'function','a single ticket factory exists');
  const root=await mkdtemp(join(tmpdir(),'ticket-contract-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const options=mode==='simulated'?{injectedTransport:fake}:{transportOptions:{provider:{getToken:async()=>'synthetic'},fetch:async(_url,init)=>{
    const {query,variables}=JSON.parse(init.body);
    const page={nodes:[],pageInfo:{hasNextPage:false,endCursor:null}};
    let data;
    if(query.includes('FabriqueConsoleIssues')){assert.deepEqual(variables.filter.team,{id:{eq:'scope'}});data={issues:{...page,nodes:[raw]}};}
    else if(query.includes('FabriqueConsoleIssue(')){assert.equal(variables.id,'opaque:id/42');data={issue:{...raw,children:page}};}
    else if(query.includes('FabriqueConsoleViewer'))data={viewer:{id:'viewer'}};
    else if(query.includes('FabriqueConsoleTeams'))data={teams:{...page,nodes:[{id:'scope'}]}};
    else if(query.includes('FabriqueConsoleProjects'))data={projects:page};
    else if(query.includes('FabriqueConsoleStates'))data={workflowStates:{...page,nodes:[raw.state]}};
    else assert.fail('Unexpected query');
    return new Response(JSON.stringify({data}),{headers:{'content-type':'application/json'}});
  }}};
  const {getTickets}=factory.createTicketFactory({root,loadConfig:async()=>({tracker:{transport:'graphql'}}),...options});
  const connector=await getTickets();assert.equal(await connector.configured(),true);
  const list=await connector.list({scope:{id:'scope'},filter:{}});
  assert.equal(list.tickets[0].id,'opaque:id/42');assert.equal(list.tickets[0].status.category,'ready');assert.equal(list.tickets[0].status.label,'À démarrer');
  assert.equal(list.complete,true);assert.equal(list.cursor,null);assert.equal(typeof list.freshness.observedAt,'string');
  const detail=await connector.detail('opaque:id/42',{include:['comments','children']});
  assert.equal(detail.ticket.description,'Untrusted content');assert.equal(detail.ticket.comments[0].body,'Comment');assert.equal(detail.ticket.untrusted,true);
  assert.equal(detail.collections.children.complete,mode==='adapter');
  const meta=await connector.meta();assert.equal(meta.scopes[0].id,'scope');assert.equal(meta.states[0].category,'ready');assert.equal(meta.states[0].name,'À démarrer');
  assert.equal(meta.capabilities.projects,true);assert.equal(meta.capabilities.documents,true);
});
test('unknown observations stay unknown; writes keep the existing payload',async()=>{
  assert.equal(typeof factory?.createTicketFactory,'function');
  const transport={...fake,list:async()=>({issues:[{...raw,state:{name:'Custom',type:'custom'}}]})};
  const {getTickets}=factory.createTicketFactory({loadConfig:async()=>({tracker:{transport:'graphql'}}),injectedTransport:transport});
  const connector=await getTickets(),list=await connector.list();
  assert.equal(list.tickets[0].status.category,'unknown');assert.equal(list.complete,false);assert.equal(list.freshness.observedAt,null);
  const payload={issueId:'opaque:id/42',comment:'Keep payload'};assert.deepEqual(await connector.mutate(payload),{success:true,payload});
  await assert.rejects(()=>connector.list({cursor:'unsupported-cursor'}),{code:'TICKET_CURSOR_UNSUPPORTED'});
});
test('production imports of the provider stay inside the factory or adapter',async()=>{
  const violations=[];
  async function walk(folder){for(const entry of await readdir(folder,{withFileTypes:true})){
    const file=join(folder,entry.name);if(entry.isDirectory())await walk(file);else if(file.endsWith('.mjs')){
      if(file.startsWith('integrations/tickets/tracker/')||file==='integrations/tickets/factory.mjs')continue;
      for(const match of (await readFile(file,'utf8')).matchAll(/(?:from\s*|import\s*\()\s*['"]([^'"]+)['"]/g)){
        const target=relative(process.cwd(),resolve(file,'..',match[1]));if(target.startsWith('integrations/tickets/tracker/')||/integrations\/tracker/.test(target))violations.push(file+': '+match[1]);
      }
    }
  }}
  for(const folder of ['src','integrations','scripts'])await walk(folder);
  assert.deepEqual(violations,[]);
});
test('every workflow category is normalized without guessing from its label',async()=>{
  const types=['backlog','triage','unstarted','started','completed','canceled','unrecognized'];
  const transport={...fake,list:async()=>({issues:types.map((type,i)=>({...raw,id:String(i),state:{name:'Done',type}})),complete:false,cursor:'remaining',updatedAt:observedAt})};
  const connector=await factory.createTicketFactory({loadConfig:async()=>({}),injectedTransport:transport}).getTickets();
  const data=await connector.list();assert.deepEqual(data.tickets.map(t=>t.status.category),['backlog','backlog','ready','active','done','canceled','unknown']);
  assert.equal(data.complete,false);assert.equal(data.cursor,'remaining');
});
test('unverified nested arrays remain incomplete',async()=>{
  const connector=await factory.createTicketFactory({loadConfig:async()=>({}),injectedTransport:fake}).getTickets();
  const data=await connector.detail(raw.id);assert.equal(data.collections.comments.complete,false);assert.equal(data.collections.children.complete,false);
});
test('the backend consumes an injected provider-neutral connector for legacy screens',async t=>{
  const {createBackend}=await import('../src/backend.mjs');
  const {withFakeHerdr}=await import('./helpers/fake-herdr.mjs');
  const root=await mkdtemp(join(tmpdir(),'ticket-backend-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const tickets={configured:async()=>true,list:async input=>{assert.deepEqual(input,{scope:{id:'scope'},filter:{search:'demo'},refresh:false});return {tickets:[{id:'opaque',status:{category:'active',label:'Doing'}}],complete:true,cursor:null,freshness:{observedAt,cached:false}};},detail:async id=>({ticket:{id,title:'Generic',status:{category:'ready',label:'Ready'}},complete:true}),meta:async()=>({scopes:[{id:'scope'}],states:[],projects:[],capabilities:{}})};
  const backend=createBackend(withFakeHerdr({root,tickets,exec:async()=>assert.fail('Provider construction must not touch credentials')}));
  const list=await backend.dispatch('ticket-list',{teamId:'scope',search:'demo'});assert.equal(list.issues[0].id,'opaque');
  const detail=await backend.dispatch('ticket-detail',{id:'opaque'});assert.equal(detail.issue.title,'Generic');
  const meta=await backend.dispatch('ticket-meta',{});assert.equal(meta.teams[0].id,'scope');
});
test('project summaries consume normalized ticket categories through injection',async()=>{
  const {createProjects}=await import('../src/projects.mjs');
  const projects=createProjects({loadConfig:async()=>({projects:[{key:'demo',teamId:'scope'}]}),getTickets:async()=>({list:async()=>({tickets:[{status:{category:'active'}},{status:{category:'done'}}],complete:true,freshness:{observedAt,cached:false}})})});
  const data=await projects.projectSummary({key:'demo'});assert.equal(data.open,1);assert.equal(data.total,2);assert.equal(data.updatedAt,observedAt);
});
test('mission ticket sheets pass opaque IDs to the connector unchanged',async()=>{
  const {createMissionActions}=await import('../src/mission.mjs');
  const actions=createMissionActions({registry:{list:async()=>[]},getTickets:async()=>({detail:async id=>{assert.equal(id,'connection:id/42');return {ticket:{id,title:'Opaque'}};}})});
  const data=await actions.sheet({issueId:'connection:id/42'});assert.equal(data.unavailable,false);
});
test('an unread collection is unknown rather than a complete empty result',async()=>{
  const connector=await factory.createTicketFactory({loadConfig:async()=>({}),injectedTransport:{...fake,list:async()=>({})}}).getTickets();
  const data=await connector.list();assert.equal(data.tickets,null);assert.equal(data.complete,false);assert.equal(data.freshness.observedAt,null);
});
