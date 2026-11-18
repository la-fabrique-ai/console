import {fail} from '../../../src/common.mjs';
import {observation,collection} from '../contract.mjs';

const categories={backlog:'backlog',triage:'backlog',unstarted:'ready',started:'active',completed:'done',canceled:'canceled'};
const status=state=>({id:state?.id??null,label:state?.name??null,category:categories[state?.type]??'unknown'});
function ticket(value,connection) {
  if(!value)return null;
  return {...value,status:status(value.state),reference:{connection,id:value.id},untrusted:true};
}
export function createLinearConnector({transport,enriched,connection='primary',transportKind='graphql',trustedPagination=true}) {
  const capabilities={projects:true,documents:true,milestones:true,comments:true,children:true,enriched:true,mutate:transportKind!=='mcp'};
  function cursorCheck(cursor){if(cursor!==undefined&&cursor!==null)fail('TICKET_CURSOR_UNSUPPORTED','This connection reads whole collections; continuation cursors are unsupported.');}
  const scopeOf=scope=>({key:scope?.key??null,teamId:scope?.id??scope?.teamId??null});
  const enrichedRead=async(kind,scope,input,readOptions)=>{
    if(!scope?.teamId)fail('TEAM_NOT_CONFIGURED','A ticket scope must be configured for this read.');
    const data=await enriched(readOptions).read(kind,scope,input);
    const field=kind==='projects'?'projects':kind==='issues'?'issues':null;
    const values=field?data.data[field]:null;
    const tickets=kind==='issues'?values?.items?.map(value=>ticket(value,connection))??null:null;
    const entity=kind==='issue'?ticket(data.data.issue,connection):null;
    return {...data,...observation(data),cursor:values?.cursor??null,...(field?{collection:values}:{}),...(kind==='issues'?{tickets}:kind==='issue'?{ticket:entity}:{})};
  };
  const list=async({scope,filter={},cursor=null,include=[],refresh=false,readOptions,...legacy}={})=>{
    cursorCheck(cursor);
    if(include.includes('projects')||include.includes('enriched'))return enrichedRead(include.includes('projects')?'projects':'issues',scopeOf(scope),{...filter,refresh},readOptions);
    const input={...legacy,...filter,...(scope?.id?{teamId:scope.id}:{}),refresh};
    const {backlog,...args}=input;
    const data=backlog===true?await transport.backlog(args):await transport.list(args);
    const tickets=Array.isArray(data.issues)?data.issues.map(value=>ticket(value,connection)):null;
    return {...data,...observation(data,{complete:trustedPagination&&transportKind!=='mcp'}),tickets,issues:tickets};
  };
  const detail=async(id,{include=[],scope,refresh=false,readOptions,projectId}={})=>{
    if(include.includes('enriched')||include.includes('document'))return enrichedRead(include.includes('document')?'document':'issue',scopeOf(scope),{...(projectId?{projectId}:{}),...(include.includes('document')?{documentId:id}:{issueId:id}),refresh},readOptions);
    const data=await transport.detail(id,{refresh}),value=ticket(data.issue,connection);
    return {...data,...observation(data,{complete:trustedPagination&&transportKind!=='mcp'}),ticket:value,issue:value,collections:{
      comments:collection(value?.comments,data.commentsComplete??(trustedPagination&&Array.isArray(value?.comments))),
      children:collection(value?.children,value?.childrenComplete===true),
      labels:collection(value?.labels,value?.labelsComplete===true),
    }};
  };
  const meta=async options=>{
    const data=await transport.meta(options);
    return {...data,...observation(data,{complete:trustedPagination&&transportKind!=='mcp'}),scopes:data.teams??[],
      states:(data.states??[]).map(state=>({...state,category:status(state).category})),capabilities:{...capabilities,mutate:capabilities.mutate&&data.readOnly!==true}};
  };
  return {configured:()=>transport.configured(),list,detail,meta,
    // Existing write semantics stay here until lot E replaces the write contract.
    mutate:payload=>transport.mutate(payload),create:payload=>transport.create(payload),forgetBacklog:teamId=>transport.forgetBacklog?.(teamId)};
}
