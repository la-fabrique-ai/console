import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile,readdir,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createTicketFactory,connectorAgentContext,ticketConnection,validateTicketSettings,DEFAULT_TICKET_DRIVER} from '../factory.mjs';
import {parseTicket,serializeTicket} from './store.mjs';

async function world(t) {
  const base=await mkdtemp(join(tmpdir(),'markdown-tickets-'));t.after(()=>rm(base,{recursive:true,force:true}));
  const repo=join(base,'portail'),root=join(base,'console');await mkdir(repo);await mkdir(root);
  const config={tracker:{driver:'markdown'},projects:[{key:'portail',name:'Portail',ticketScope:{connection:'primary',scopeId:'portail'},teamId:'portail',repos:[{key:'app',path:repo,mainBranch:'main'}]}]};
  const factory=createTicketFactory({root,loadConfig:async()=>config});
  const folder=join(repo,'la-fabrique','output','tickets');
  const create=input=>factory.createWriter({}).create({key:'portail',confirmed:true,operationId:randomUUID(),...input});
  return {config,factory,folder,root,create,tickets:()=>factory.getTickets()};
}

test('the registry selects the Markdown connector and keeps its driver',()=>{
  assert.deepEqual(validateTicketSettings({driver:'markdown'}),{driver:'markdown'});
  assert.throws(()=>validateTicketSettings({driver:'markdown',transport:'mcp'}),{code:'INVALID_CONFIG'});
  assert.equal(ticketConnection({tracker:{driver:'markdown'}},{key:'portail',teamId:'portail'}).driver,'markdown');
});
test('an absent folder is an empty and complete collection',async t=>{
  const w=await world(t),list=await (await w.tickets()).list({scope:{id:'portail'}});
  assert.deepEqual(list.tickets,[]);assert.equal(list.complete,true);
});
test('tickets are created, read, moved and commented as files',async t=>{
  const w=await world(t);
  const parent=(await w.create({title:'Afficher la carte',description:'## Résultat attendu\nUne carte.'})).issue;
  assert.equal(parent.identifier,'PORTAIL-1');assert.equal(parent.state.type,'backlog');assert.equal(parent.status.category,'backlog');
  const child=(await w.create({title:'Charger les tuiles',parentId:parent.id})).issue;
  assert.equal(child.identifier,'PORTAIL-2');assert.equal(child.parentId,parent.id);
  assert.deepEqual((await readdir(w.folder)).sort(),['PORTAIL-1.md','PORTAIL-2.md']);
  const connector=await w.tickets(),detail=await connector.detail(parent.id);
  assert.equal(detail.ticket.children[0].identifier,'PORTAIL-2');assert.equal(detail.collections.children.complete,true);
  assert.equal(detail.ticket.description,'## Résultat attendu\nUne carte.');assert.equal(detail.ticket.untrusted,true);
  const payload={issueId:parent.id,stateId:'active',comment:'Plan posé.'};
  const moved=await w.factory.createWriter({}).mutate({payload,confirmed:true,confirmedPayload:payload});
  assert.equal(moved.issue.state.type,'started');assert.equal(moved.issue.comments.at(-1).body,'Plan posé.');
  const text=await readFile(join(w.folder,'PORTAIL-1.md'),'utf8');
  assert.match(text,/^status: active$/m);assert.match(text,/## Commentaires\n\n### \S+ — Console\n\nPlan posé\./);
  const enriched=await connector.detail(parent.id,{include:['enriched'],scope:{id:'portail'}});
  assert.equal(enriched.status,'complete');assert.equal(enriched.data.issue.children.items[0].identifier,'PORTAIL-2');
  const meta=await connector.meta();assert.deepEqual(meta.states.map(s=>s.id),['backlog','ready','active','done','canceled']);
  const backlog=await connector.list({scope:{id:'portail'},filter:{backlog:true}});assert.deepEqual(backlog.tickets.map(i=>i.identifier),['PORTAIL-2']);
});
test('a replayed creation writes no second ticket and an unknown status is refused',async t=>{
  const w=await world(t),operationId=randomUUID();
  const first=await w.create({title:'Une fois',operationId}),again=await w.create({title:'Une fois',operationId});
  assert.equal(again.replayed,true);assert.equal(again.issue.id,first.issue.id);assert.equal((await readdir(w.folder)).length,1);
  await assert.rejects(()=>w.create({title:'Autre chose',operationId}),{code:'INVALID_ARGUMENT'});
  const payload={issueId:first.issue.id,stateId:'review'};
  await assert.rejects(()=>w.factory.createWriter({}).mutate({payload,confirmed:true,confirmedPayload:payload}),{code:'INVALID_STATE'});
  await assert.rejects(()=>w.create({title:'Sans confirmation',confirmed:false}),{code:'CONFIRMATION_REQUIRED'});
});
test('a broken file makes the collection incomplete without hiding the others',async t=>{
  const w=await world(t);await w.create({title:'Lisible'});
  await writeFile(join(w.folder,'PORTAIL-9.md'),'pas un ticket');
  const list=await (await w.tickets()).list({scope:{id:'portail'}});
  assert.equal(list.tickets.length,1);assert.equal(list.complete,false);assert.deepEqual(list.partialReasons,[{path:'PORTAIL-9.md',reason:'header-missing'}]);
  assert.equal((await w.create({title:'Suivant'})).issue.identifier,'PORTAIL-10');
});
test('a file round-trips, and titles needing quotes survive',()=>{
  const record={id:'a',key:'PORTAIL-3',title:'"Citation": oui ',status:'ready',parent:null,blockedBy:['PORTAIL-1'],labels:['agent:codex'],created:'2026-11-19T10:00:00.000Z',updated:null,description:'Texte',comments:[{at:'2026-11-19T10:05:00.000Z',author:'Lead',body:'Ok'}]};
  const parsed=parseTicket(serializeTicket(record),'PORTAIL-3.md').value;
  assert.equal(parsed.title,record.title);assert.deepEqual(parsed.blockedBy,['PORTAIL-1']);assert.deepEqual(parsed.comments,record.comments);
});
test('agents receive the absolute folder of each project',()=>{
  const context=connectorAgentContext({tracker:{driver:'markdown'},projects:[{key:'portail',repos:[{path:'/srv/portail'}]}]});
  assert.ok(context.writeInstructions.includes('/srv/portail/la-fabrique/output/tickets'));assert.ok(context.instructions.includes('lecture seule'));
});
test('a connector chosen for one driver never reads the configuration of another',async t=>{
  const w=await world(t);let driver='markdown';
  const factory=createTicketFactory({root:w.root,loadConfig:async()=>({...w.config,tracker:{driver}})});
  const connector=await factory.getTickets();assert.equal((await connector.list({scope:{id:'portail'}})).complete,true);
  driver=DEFAULT_TICKET_DRIVER;
  await assert.rejects(()=>connector.list({scope:{id:'portail'}}),{code:'CONFIG_CONFLICT'});
});
