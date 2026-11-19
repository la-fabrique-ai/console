import test from 'node:test';
import assert from 'node:assert/strict';
import {validateTicketSettings,ticketConnection,normalizeTicketConfig,connectorAgentContext,createTicketFactory,DEFAULT_TICKET_DRIVER,ticketDrivers} from '../integrations/tickets/factory.mjs';

test('the default connector serves configurations naming none, and existing settings are unchanged',()=>{
  assert.ok(ticketDrivers().includes(DEFAULT_TICKET_DRIVER));
  assert.deepEqual(validateTicketSettings({driver:DEFAULT_TICKET_DRIVER}),{...validateTicketSettings(undefined),driver:DEFAULT_TICKET_DRIVER});
  assert.deepEqual(validateTicketSettings({transport:'graphql'}),{transport:'graphql'});
  assert.equal(ticketConnection({tracker:{transport:'graphql'}}).driver,DEFAULT_TICKET_DRIVER);
});
test('an explicit driver is validated by the registry and kept',()=>{
  assert.deepEqual(validateTicketSettings({driver:DEFAULT_TICKET_DRIVER,transport:'graphql'}),{transport:'graphql',driver:DEFAULT_TICKET_DRIVER});
  const connection=ticketConnection({tracker:{driver:DEFAULT_TICKET_DRIVER,transport:'graphql'}},{key:'demo',teamId:'scope'});
  assert.equal(connection.driver,DEFAULT_TICKET_DRIVER);assert.deepEqual(connection.scope,{key:'demo',id:'scope'});
  assert.deepEqual(connectorAgentContext({tracker:{driver:DEFAULT_TICKET_DRIVER}}),connectorAgentContext());
  assert.deepEqual(normalizeTicketConfig({tracker:{driver:DEFAULT_TICKET_DRIVER}}).tracker,{driver:DEFAULT_TICKET_DRIVER});
});
test('an unknown driver is refused before any provider is reached',async()=>{
  for(const driver of ['nope','','__proto__',42,null])assert.throws(()=>validateTicketSettings({driver}),{code:'INVALID_CONFIG'});
  assert.throws(()=>ticketConnection({tracker:{driver:'nope'}}),{code:'INVALID_CONFIG'});
  const {getTickets}=createTicketFactory({loadConfig:async()=>({tracker:{driver:'nope'}})});
  await assert.rejects(getTickets,{code:'INVALID_CONFIG'});
});
test('a version 1 configuration keeps its chosen driver through the migration',async()=>{
  const {convertV1Config}=await import('../src/config-migration.mjs');
  const v1={version:1,tracker:{driver:DEFAULT_TICKET_DRIVER,transport:'graphql'},projects:[{key:'synthetic-nova',teamId:'team-only',repo:'/example/app',mainBranch:'main',preferredAgent:'codex',machine:null,tests:{}}]};
  assert.deepEqual(convertV1Config(v1,{worktreesRoot:'/example/worktrees'}).tracker,{driver:DEFAULT_TICKET_DRIVER,transport:'graphql'});
});
test('a runtime refuses a configuration whose driver changed after it was selected',async()=>{
  let driver=DEFAULT_TICKET_DRIVER;
  const {getTickets}=createTicketFactory({loadConfig:async()=>({tracker:{driver,transport:'graphql'}}),injectedTransport:{configured:async()=>true}});
  assert.equal(await (await getTickets()).configured(),true);
  driver='nope';
  await assert.rejects(getTickets,{code:'INVALID_CONFIG'});
});
