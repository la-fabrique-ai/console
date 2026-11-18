export const workflowTypes=new Set(['backlog','unstarted','started','completed','canceled','triage']);
export const string=value=>typeof value==='string'?value:null;
export const finite=value=>typeof value==='number'&&Number.isFinite(value)?value:null;
export function linearURL(value){
  try{const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password&&(!url.port||url.port==='443')&&(url.hostname==='linear.app'||url.hostname.endsWith('.linear.app'))?url.href:null;}catch{return null;}
}
export const stateShape=state=>({id:string(state?.id),name:string(state?.name),type:workflowTypes.has(state?.type)?state.type:'unknown'});
export function linkedShape(issue,teamId){
  if(!issue||issue.archivedAt)return null;
  const state=stateShape(issue.state),identifier=string(issue.identifier)??string(issue.id);
  return issue.team?.id===teamId?{id:string(issue.id),identifier,state,untrusted:true}:{identifier,state};
}
export const milestoneShape=value=>({id:value.id,name:string(value.name),description:string(value.description),progress:finite(value.progress),status:string(value.status),targetDate:string(value.targetDate),createdAt:string(value.createdAt),updatedAt:string(value.updatedAt),untrusted:true});
export const documentShape=value=>({id:value.id,title:string(value.title),createdAt:string(value.createdAt),updatedAt:string(value.updatedAt),url:linearURL(value.url),untrusted:true});
export const labelShape=value=>({id:value.id,name:string(value.name),untrusted:true});
