import {LinearClient,KeychainProvider} from './linear.mjs';
import {LinearMCPClient,login,MCP_ENDPOINT} from './linear-mcp.mjs';
import {LinearEnrichedClient} from './linear-enriched.mjs';
import {createLinearConnector} from './connector.mjs';
import {createLinearWriter} from './linear-write.mjs';

// The only bridge to the current connection config. Lot C can replace this function.
export function ticketConnection(config,project=null) {
  return {id:'primary',driver:'linear',transport:'graphql',...config.tracker,...(project?{scope:{key:project.key,id:project.teamId??null}}:{})};
}
export function createTicketFactory({root,exec,loadConfig,injectedTickets,injectedTransport,transportOptions={},enrichedOptions={},trustedPagination:trusted=undefined}) {
  let selected,key;
  const getTickets=async()=>{
    if(injectedTickets)return injectedTickets;
    const connection=ticketConnection(await loadConfig()),next=JSON.stringify(connection);
    if(next!==key){
      const injected=injectedTransport;
      const transport=injected??(connection.transport==='mcp'?new LinearMCPClient({root,endpoint:connection.endpoint,...transportOptions}):new LinearClient({root,provider:new KeychainProvider({exec}),...transportOptions}));
      selected=createLinearConnector({transport,connection:connection.id,transportKind:trusted===true&&injectedTransport?(injectedTransport instanceof LinearMCPClient?'mcp':'graphql'):connection.transport,trustedPagination:trusted??!injectedTransport,
        enriched:options=>new LinearEnrichedClient({root,exec,...enrichedOptions,...options})});
      selected.connection={transport:connection.transport,provider:connection.transport==='mcp'?'mcp-oauth':'keychain',...(connection.endpoint?{endpoint:connection.endpoint}:{})};
      key=next;
    }
    return selected;
  };
  return {getTickets,createWriter:context=>createLinearWriter({...context,getLinear:getTickets})};
}
export function loginTickets(options){return login({endpoint:MCP_ENDPOINT,...options});}
export {loginMain as ticketLoginMain} from './login.mjs';
