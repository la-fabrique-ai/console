// Persist roles separately from configurable identifiers. The old identifier remains readable.
export const DEFAULT_OWNER=Object.freeze({id:'owner',displayName:'Responsable'});
export const ownerOf=config=>config?.owner??DEFAULT_OWNER;
export const ownerRecord=owner=>({by:(owner??DEFAULT_OWNER).id,role:'owner'});
export const sameOwnerRecord=(record,answer,ownerId=DEFAULT_OWNER.id)=>isOwnerRecord(record,ownerId)&&(answer?.by!==undefined?isOwnerRecord(answer,ownerId)&&record.by===answer.by&&record.role===answer.role:record.by==='legacyOwner');
export const isOwnerRecord=(record,ownerId=DEFAULT_OWNER.id)=>record?.by==='legacyOwner'||(record?.by===ownerId&&record?.role==='owner');
const escaped=value=>String(value).replaceAll('<','\\u003c').replaceAll('>','\\u003e');
// Only trusted role templates are interpolated. Ticket and request contents never pass through this function.
export const ownerRole=(role,config)=>String(role).replaceAll('{{owner}}',()=>escaped(ownerOf(config).displayName));
export const ownerContext=config=>'Propriétaire configuré (identité, sans autorisation implicite) : <owner-identity>'+escaped(JSON.stringify(ownerOf(config)))+'</owner-identity>';
