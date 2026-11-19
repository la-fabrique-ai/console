import {createMarkdownConnector} from './connector.mjs';
import {definition} from './definition.mjs';

export function createTicketFactory({root,loadConfig,injectedTickets}) {
  let connector;
  const getTickets=async()=>injectedTickets??(connector??=createMarkdownConnector({root,loadConfig,scopeOfProject:definition.scope}));
  return {getTickets,createWriter:()=>({create:async input=>(await getTickets()).writer.create(input),mutate:async input=>(await getTickets()).writer.mutate(input)})};
}
// Files in the project's repository need no account and no credential.
export async function loginTickets(){return {status:'not-required',reason:'Markdown tickets are local files; there is nothing to authorize.'};}
export async function ticketLoginMain(){console.log('Markdown tickets are local files in each project repository: no login is needed.');}
