export const bucket = status => ['idle','working','blocked','done','error'].includes(status) ? status : 'unknown';
export function observedCards(sessions, terminals, agents) {
 const live=new Map(terminals.filter(t=>t.state==='live').map(t=>[t.address,t]));
 const listed=new Map(agents.map(a=>[a.address,a]));
 const cards=sessions.map(s=>{
  const candidate=live.get(s.terminalId);
  const t=candidate?.labels?.['fabrique-console.session']===s.id&&candidate?.labels?.['fabrique-console.app']==='fabrique-console'?candidate:null;
  const a=t?listed.get(s.terminalId):null;
  return {...s,address:s.terminalId,status:t?(t.reported===false?'unknown':(t.status||a?.status||'unknown')):(s.status==='historical'?'historical':'unknown'),liveVerified:!!t,lastActivity:t?.status_ms||null,model:t?.report?.model||null,machine:s.machine||'local',observedAt:t?new Date().toISOString():null};
 });
 const seen=new Set(cards.filter(c=>c.liveVerified).map(c=>c.address));
 for(const t of live.values()) if(!seen.has(t.address)&& (t.status||listed.has(t.address)||t.labels?.['fabrique-console.issue'])) {
  const a=listed.get(t.address);
  cards.push({id:t.address,address:t.address,terminalId:t.address,identifier:t.labels?.['fabrique-console.issue']||null,title:t.name||a?.title||t.address,tool:t.report?.app||a?.program?.name||'Outil inconnu',status:t.reported===false?'unknown':(t.status||a?.status||'unknown'),liveVerified:true,lastActivity:t.status_ms||null,model:t.report?.model||null,machine:t.machine||(t.address.includes('/')?t.address.split('/')[0]:'local'),branch:null,observedAt:new Date().toISOString()});
 }
 return cards;
}
