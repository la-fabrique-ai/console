import {readFileSync} from 'node:fs';
import {AppError,fail} from '../../../src/common.mjs';

const instructions=readFileSync(new URL('./agent-instructions.md',import.meta.url),'utf8').trim();
const readInstructions=readFileSync(new URL('./agent-read-instructions.md',import.meta.url),'utf8').trim();
export const definition={
  id:'linear',
  scope:project=>({key:project.key,id:project.teamId??(!project.projectId?project.ticketScope?.scopeId:null)??null}),
  agentContext:()=>({instructions:readInstructions,writeInstructions:instructions}),
  configInput(input){
    if(!input||typeof input!=='object'||Array.isArray(input))return input;
    if(input.linear!==undefined&&input.tracker!==undefined&&JSON.stringify(input.linear)!==JSON.stringify(input.tracker))fail('INVALID_CONFIG','Conflicting ticket connection settings.');
    const {linear,...rest}=input;
    return {...rest,...(input.tracker!==undefined||linear!==undefined?{tracker:input.tracker!==undefined?input.tracker:linear}:{})};
  },
  settings(settings={transport:'mcp'}){
    if(!settings||typeof settings!=='object'||Array.isArray(settings)||Object.keys(settings).some(k=>!['transport','endpoint'].includes(k)))fail('INVALID_CONFIG','Invalid ticket connection settings.');
    if(!['graphql','mcp'].includes(settings.transport))fail('INVALID_CONFIG','Ticket transport must be mcp or graphql.');
    const endpoint=settings.endpoint??'https://mcp.linear.app/mcp/readonly';
    if(settings.transport==='mcp'&&!['https://mcp.linear.app/mcp/readonly','https://mcp.linear.app/mcp'].includes(endpoint))fail('INVALID_CONFIG','Use an official ticket MCP endpoint.');
    if(settings.transport==='graphql'&&settings.endpoint!==undefined&&settings.endpoint!=='https://api.linear.app/graphql')fail('INVALID_CONFIG','Use the official ticket GraphQL endpoint.');
    return settings.transport==='mcp'?{transport:'mcp',endpoint}:{transport:'graphql',...(settings.endpoint!==undefined?{endpoint:settings.endpoint}:{})};
  },
  backendOptions(options){
    const {linear,linearReadOptions,...rest}=options;
    return {...rest,transport:options.transport??options.tracker??linear,trustedPagination:options.trustedPagination??Boolean(linear??options.tracker),ticketReadOptions:options.ticketReadOptions??options.trackerReadOptions??linearReadOptions??{}};
  },
  factoryOptions:options=>({...options,injectedTransport:options.injectedTransport??options.injectedLinear,...(options.injectedLinear&&!options.injectedTransport&&options.trustedPagination===undefined?{trustedPagination:true}:{})}),
  mission(mission){
    if(!mission||!Array.isArray(mission.tickets))return mission;
    return {...mission,tickets:mission.tickets.map(ticket=>ticket.tracker===undefined&&ticket.linear!==undefined?{...ticket,tracker:ticket.linear}:ticket)};
  },
  ticketState:record=>record?.tracker??record?.linear,
  action:name=>typeof name==='string'&&name.startsWith('linear-')?'ticket-'+name.slice(7):name,
  error(error){
    if(typeof error?.code!=='string')return error;
    if(!error.code.startsWith('LINEAR_'))return error instanceof AppError&&/linear/i.test(error.message)?new AppError(error.code,error.message.replaceAll('Linear','the tracker').replaceAll('tickets:login','tickets:login')):error;
    const code=error.code.replace(/^LINEAR_/,'TICKET_');
    // Provider errors never carry transport output or credential material through the engine.
    return new AppError(code,error instanceof AppError?error.message.replaceAll('Linear','the tracker').replaceAll('tickets:login','tickets:login'):{
      TICKET_NOT_CONFIGURED:'The ticket connection is not configured. Run npm run tickets:login.',
      TICKET_TIMEOUT:'The ticket service did not answer in time.',
      TICKET_SCOPE:'The ticket scope could not be verified.',
      TICKET_INCOMPLETE:'The ticket service returned an incomplete collection.',
    }[code]??'The ticket connection could not complete this operation.');
  },
  async runtime(){return import('./runtime.mjs');},
};
