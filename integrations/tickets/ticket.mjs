// The Console's common ticket payload. A connector that speaks it returns `Ticket` values only; the engine still
// reads its earlier issue shape, which `engineIssue` and `enrichedIssue` derive here, in one place. The payload
// grows when a Console feature needs a field, not before.
//
// Ticket = {
//   ref: {connection, id},                 opaque: never parsed, never derived from key
//   key: string|null,                      the identifier people read (PORTAIL-12)
//   scope: {id, key, name},                the one area of the ticket system a Console project works in
//   url: string|null,
//   title: string, description: string|null (Markdown),
//   status: {id, label, category},         category: backlog|ready|active|done|canceled|unknown
//   parent: TicketLink|null, children: Collection<TicketLink>,
//   relations: {blocks: Collection<TicketLink>, blockedBy: Collection<TicketLink>},
//   labels: Collection<{id, name, color}>,
//   comments: Collection<{id, author: {id, name}|null, body, createdAt, updatedAt}>,
//   createdAt, updatedAt: ISO 8601|null,
//   untrusted: true,
// }
// TicketLink = {ref, key, title, status}; Collection<T> = {items: T[]|null, complete: boolean, cursor: null}.
// Unknown is null; a collection not verified whole has complete:false; items:null was not read, [] is read and empty.

export const CATEGORIES=Object.freeze(['backlog','ready','active','done','canceled','unknown']);
const ENGINE_TYPES={backlog:'backlog',ready:'unstarted',active:'started',done:'completed',canceled:'canceled'};

export const items=(collection,map=value=>value)=>Array.isArray(collection?.items)?collection.items.map(map):null;
export const engineState=status=>({id:status?.id??null,name:status?.label??null,type:ENGINE_TYPES[status?.category]??'unknown'});
const engineLink=(link,scopeId)=>({id:link.ref.id,identifier:link.key,title:link.title??null,state:link.status?engineState(link.status):null,team:{id:scopeId}});

// The issue shape the engine's lists, details and missions read today.
export function engineIssue(ticket) {
  const scopeId=ticket.scope.id,blocks=items(ticket.relations?.blocks),blockedBy=items(ticket.relations?.blockedBy);
  return {
    id:ticket.ref.id,identifier:ticket.key,title:ticket.title,description:ticket.description,url:ticket.url,priority:null,
    state:engineState(ticket.status),team:{id:scopeId},project:null,assignee:null,
    labels:items(ticket.labels,label=>({id:label.id,name:label.name,...(label.color?{color:label.color}:{})}))??[],labelsComplete:ticket.labels.complete===true,
    comments:items(ticket.comments,comment=>({id:comment.id,body:comment.body,createdAt:comment.createdAt,updatedAt:comment.updatedAt,user:comment.author}))??[],
    commentsComplete:ticket.comments.complete===true,
    children:items(ticket.children,link=>engineLink(link,scopeId))??[],childrenComplete:ticket.children.complete===true,
    parent:ticket.parent?{id:ticket.parent.ref.id}:null,parentId:ticket.parent?.ref.id??null,
    blocks:blocks?.length??0,blockedBy:blockedBy?.length??0,createdAt:ticket.createdAt,updatedAt:ticket.updatedAt,
    status:ticket.status,reference:ticket.ref,common:ticket,untrusted:true,
  };
}

const enrichedCollection=(collection,map)=>{
  const values=items(collection,map),complete=collection?.complete===true&&values!==null;
  return {items:values,complete,total:complete?values.length:null,cursor:null,reasons:complete?[]:['unverified']};
};
const enrichedLink=link=>({id:link.ref.id,identifier:link.key,state:engineState(link.status),untrusted:true});
// The issue shape of the enriched reads (qualification, mission preparation).
export function enrichedIssue(ticket) {
  const issue={id:ticket.ref.id,identifier:ticket.key,title:ticket.title,description:ticket.description,url:ticket.url,updatedAt:ticket.updatedAt,
    estimate:null,projectId:null,milestone:null,parent:ticket.parent?enrichedLink(ticket.parent):null,untrusted:true,
    state:engineState(ticket.status),classification:ticket.status.category==='unknown'?{source:'unresolved',reason:'status-not-found'}:{source:'state-type',reason:null},
    labels:enrichedCollection(ticket.labels,label=>({id:label.id,name:label.name,untrusted:true})),
    children:enrichedCollection(ticket.children,enrichedLink),
    dependencies:{blocks:enrichedCollection(ticket.relations?.blocks,enrichedLink),blockedBy:enrichedCollection(ticket.relations?.blockedBy,enrichedLink)}};
  issue.complete=issue.labels.complete&&issue.children.complete&&issue.dependencies.blocks.complete&&issue.dependencies.blockedBy.complete&&issue.classification.source!=='unresolved';
  return issue;
}
