// Shared observation vocabulary. Absence of an observation never means an empty collection.
export function observation(data,{complete=false,cursor=null}={}) {
  return {
    complete:data.complete??complete,
    cursor:data.cursor??cursor,
    freshness:{observedAt:data.observedAt??data.updatedAt??null,cached:data.cached===true},
  };
}
export function collection(items,complete=false,cursor=null) {
  return {items:Array.isArray(items)?items:null,complete:complete===true,cursor};
}
// Compatibility with existing injected fixtures and persisted read projections.
export const ticketOf=response=>response?.ticket??response?.issue??null;
export const ticketsOf=response=>response?.tickets??response?.issues??null;
