import {ticketModel} from '../../../src/po-ticket-model.mjs';

export const CHILD_LIMIT=50;
const types=new Set(['backlog','unstarted','started','completed','canceled','triage']);
const string=value=>typeof value==='string'&&value.length?value:null;
const labelsOf=value=>(Array.isArray(value)?value:[]).map(l=>typeof l==='string'?{name:l}:{name:l?.name,...(l?.color?{color:l.color}:{})}).filter(l=>typeof l.name==='string');

export function childSummary(raw,transport,ids=new Map()) {
  const id=string(raw?.uuid??raw?.id);if(!id)return null;
  const graph=transport==='graphql',labels=labelsOf(graph?raw.labels?.nodes:raw.labels);
  const labelSource=graph?raw.labels?.nodes:raw.labels;
  // MCP arrays alone do not attest that nested lists were read whole.
  const labelsComplete=Array.isArray(labelSource)&&labels.length===labelSource.length&&(graph?raw.labels?.pageInfo?.hasNextPage===false:raw.labelsComplete===true);
  const links=graph?raw.inverseRelations?.nodes:raw.blockedBy??raw.relations?.blockedBy;
  let blockedByComplete=Array.isArray(links)&&(graph?raw.inverseRelations?.pageInfo?.hasNextPage===false:raw.blockedByComplete===true);
  const blockedBy=[];
  for(const link of Array.isArray(links)?links:[]) {
    if(graph&&link?.type!=='blocks')continue;
    const value=graph?link.issue:link,key=string(typeof value==='string'?value:value?.uuid??value?.id);
    if(key){const canonical=ids.has(key)?ids.get(key):key;blockedBy.push(canonical??key);if(!canonical)blockedByComplete=false;}
    else blockedByComplete=false;
  }
  const source=graph?raw.state:raw.state??(typeof raw.status==='object'?raw.status:{name:raw.status,type:raw.statusType});
  const state={name:string(source?.name)??'Unknown',type:types.has(source?.type)?source.type:'unknown'};
  return {id,identifier:string(raw.identifier)??string(raw.id)??id,title:string(raw.title)??'—',state,labels,labelsComplete,
    blockedBy:[...new Set(blockedBy)],blockedByComplete,url:string(raw.url),...ticketModel(raw.description,labels,{labelsComplete})};
}

export function childrenSummary(records,{transport,listComplete=false,truncated=false,unavailable=false}={}) {
  if(unavailable||!Array.isArray(records))return {children:[],childrenComplete:false,childrenReason:'unavailable'};
  const selected=records.slice(0,CHILD_LIMIT),ids=new Map();
  // Resolve readable MCP ids against the same canonical key as each listed child.
  // Conflicting aliases stay unresolved rather than naming the wrong ticket.
  for(const raw of selected){
    const id=string(raw?.uuid??raw?.id);if(!id)continue;
    for(const alias of [raw.uuid,raw.id,raw.identifier].filter(string)){
      if(!ids.has(alias))ids.set(alias,id);else if(ids.get(alias)!==id)ids.set(alias,null);
    }
  }
  const children=selected.map(raw=>childSummary(raw,transport,ids)).filter(Boolean);
  // Every child known by its own name: none dropped for want of an id, no two under the same identifier. Without that,
  // the list does not say which tickets it holds (unidentified); with it, what may lack is only their fields.
  const identified=children.length===selected.length&&new Set(children.map(c=>c.identifier)).size===children.length;
  const fieldsComplete=selected.every(c=>c?.description===null||typeof c?.description==='string')&&children.every(c=>c.labelsComplete&&c.blockedByComplete&&c.state.type!=='unknown'&&c.title!=='—'&&c.url);
  const limited=truncated||records.length>CHILD_LIMIT;
  return {children,childrenComplete:listComplete&&!limited&&identified&&fieldsComplete,childrenReason:limited?'truncated':!listComplete?'unverified':!identified?'unidentified':!fieldsComplete?'incomplete-fields':null};
}
