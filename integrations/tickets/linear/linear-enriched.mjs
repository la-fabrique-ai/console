import { KeychainProvider } from './linear.mjs';
import { fail } from '../../../src/common.mjs';
import { EnrichedReadTransport,ReadInterrupted } from './linear-enriched-transport.mjs';
import { EnrichedPages,READ_LIMITS,unknownCollection } from './linear-enriched-pages.mjs';
import { enrichedCache,assertNoCredential } from './linear-enriched-cache.mjs';
import { string,finite,stateShape,workflowTypes,linkedShape,milestoneShape,documentShape,labelShape,linearURL } from './linear-enriched-shapes.mjs';

export class LinearEnrichedClient {
  constructor({root,exec,provider=new KeychainProvider({exec}),...options}){Object.assign(this,{root,provider,options});}
  async read(kind,scope,input){
    const transport=new EnrichedReadTransport({...this.options,maxRequests:this.options.limits?.maxRequests}),pages=new EnrichedPages(transport,this.options.limits);
    const data=kind==='projects'?{projects:unknownCollection()}:kind==='issues'?{issues:unknownCollection()}:kind==='issue'?{issue:null}:{document:null};
    const response={status:'partial',available:true,complete:false,observedAt:null,source:'ticket-api-key',cached:false,scope:{...scope,projectId:input.projectId??null,includeArchived:false,linkedOutsideTeam:'identifier-state-only'},untrusted:true,data,partialReasons:pages.partialReasons,limits:{...pages.limits,budgetMs:transport.budgetMs},usage:{requests:0,nodes:0,maxComplexity:null}};
    let credential,cache;
    const request=(operation,variables)=>transport.request(operation,variables);
    const scoped=(object,id)=>{if(!object||object.id!==id)fail('LINEAR_SCOPE','Linear n’a pas confirmé l’appartenance de la ressource demandée.');return object;};
    async function projectScope(id){
      const teams=await pages.collect({path:'scope.project.teams',load:async after=>{
        const result=await request('projectScope',{id,first:50,after});return scoped(result.project,id).teams;
      }});
      if(!teams.complete)throw new ReadInterrupted('scope-unverified');
      if(!teams.items.some(team=>team.id===scope.teamId))fail('LINEAR_SCOPE','Ce projet Linear ne fait pas partie de l’équipe configurée.');
    }
    let states;
    async function classifiedState(value,path){
      if(workflowTypes.has(value?.type))return {state:stateShape(value),classification:{source:'state-type',reason:null}};
      states??=pages.collect({path:'scope.states',load:async after=>{
        const result=await request('states',{teamId:scope.teamId,first:50,after});return scoped(result.team,scope.teamId).states;
      }});
      const metadata=await states,matches=metadata.complete?metadata.items.filter(state=>value?.id?state.id===value.id:state.name===value?.name):[];
      if(matches.length===1&&workflowTypes.has(matches[0].type))return {state:stateShape(matches[0]),classification:{source:value?.id?'team-status-id':'team-status-name',reason:null}};
      pages.note(path,'unknown-status');
      return {state:stateShape(value),classification:{source:'unresolved',reason:metadata.complete?'status-not-found':'metadata-incomplete'}};
    }
    async function issueShape(raw,path){
      if(raw.team?.id!==scope.teamId)fail('LINEAR_SCOPE','Un ticket reçu ne fait pas partie de l’équipe configurée.');
      if(raw.parent?.archivedAt)pages.note(path+'.parent','archived-excluded');
      const result={id:raw.id,identifier:string(raw.identifier),title:string(raw.title),description:string(raw.description),url:linearURL(raw.url),updatedAt:string(raw.updatedAt),estimate:finite(raw.estimate),projectId:string(raw.project?.id),milestone:raw.projectMilestone?{id:raw.projectMilestone.id,name:string(raw.projectMilestone.name),targetDate:string(raw.projectMilestone.targetDate),untrusted:true}:null,parent:linkedShape(raw.parent,scope.teamId),untrusted:true};
      Object.assign(result,await classifiedState(raw.state,path+'.state'));
      for(const field of ['labels','children','relations','inverseRelations']){
        const values=await pages.collect({path:path+'.'+field,seed:raw[field],load:async after=>{
          const data=await request(field,{id:raw.id,first:50,after});return scoped(data.issue,raw.id)[field];
        }});
        let items=null;
        if(values.items){
          if(field==='labels')items=values.items.map(labelShape);
          else if(field==='children')items=values.items.map(value=>linkedShape(value,scope.teamId)).filter(Boolean);
          else items=values.items.filter(value=>value.type==='blocks').map(value=>{
            if((field==='relations'?value.issue?.id:value.relatedIssue?.id)!==raw.id)fail('LINEAR_SCOPE','Une dépendance reçue ne correspond pas au ticket demandé.');
            const linked=field==='relations'?value.relatedIssue:value.issue;
            if(linked?.archivedAt) {
              if(field==='inverseRelations') {
                // the user: an archived prerequisite exposes the same minimal
                // projection as an out-of-team link, never its detailed data.
                return {identifier:string(linked.identifier)??string(linked.id),state:stateShape(linked.state)};
              }
              const output=field==='relations'?'blocks':'blockedBy';
              pages.note(path+'.dependencies.'+output,'archived-excluded');
              values.complete=false;values.total=null;
              if(!values.reasons.includes('archived-excluded'))values.reasons.push('archived-excluded');
            }
            return linkedShape(linked,scope.teamId);
          }).filter(Boolean);
        }
        const collection=pages.finish(values,items);
        if(field==='relations'||field==='inverseRelations'){result.dependencies??={};result.dependencies[field==='relations'?'blocks':'blockedBy']=collection;}
        else result[field]=collection;
      }
      result.complete=!raw.parent?.archivedAt&&result.labels.complete&&result.children.complete&&result.dependencies.blocks.complete&&result.dependencies.blockedBy.complete&&result.classification.source!=='unresolved';
      return result;
    }
    async function projectShape(raw,path){
      const result={id:raw.id,name:string(raw.name),url:linearURL(raw.url),progress:finite(raw.progress),progressSource:'tracker',startDate:string(raw.startDate),targetDate:string(raw.targetDate),createdAt:string(raw.createdAt),updatedAt:string(raw.updatedAt),untrusted:true};
      // Project status types are a different vocabulary from issue workflows.
      result.state={id:string(raw.status?.id),name:string(raw.status?.name),type:string(raw.status?.type)};
      for(const [field,operation,output,project] of [['projectMilestones','milestones','milestones',milestoneShape],['documents','documents','documents',documentShape]]){
        const values=await pages.collect({path:path+'.'+output,seed:raw[field],load:async after=>{
          const result=await request(operation,{id:raw.id,first:50,after});return scoped(result.project,raw.id)[field];
        }});
        result[output]=pages.finish(values,values.items?.map(project)??null);
      }
      result.complete=result.milestones.complete&&result.documents.complete;return result;
    }
    try{
      credential=await transport.bounded(()=>this.provider.getToken());
      if(typeof credential!=='string'||!credential.trim()){
        response.available=false;response.status='unavailable';pages.note('credentials','api-key-unavailable');return response;
      }
      transport.token=credential;
      const cacheInput=Object.fromEntries(Object.entries(input).filter(([key])=>key!=='refresh'));
      const assertActive=()=>{if(transport.controller.signal.aborted||transport.remaining()<=0)throw new ReadInterrupted('deadline');};
      for(;;){
        assertActive();
        try{cache=await transport.bounded(()=>enrichedCache(this.root,credential,[kind,scope,cacheInput],{assertActive}));break;}
        catch(error){if(error?.code!=='BUSY')throw error;}
        await transport.bounded(()=>transport.sleep(Math.min(25,transport.remaining())));
      }
      if(!input.refresh){const previous=await transport.bounded(()=>cache.get());if(previous)return previous;}
      if(input.projectId)await projectScope(input.projectId);
      if(kind==='projects'){
        const values=await pages.collect({path:'projects',load:async after=>{
          const result=await request('projects',{teamId:scope.teamId,first:50,after});return scoped(result.team,scope.teamId).projects;
        }});
        const items=values.items?[]:null;
        for(const [index,raw] of (values.items??[]).entries())items.push(await projectShape(raw,'projects['+index+']'));
        data.projects=pages.finish(values,items);
      }else if(kind==='issues'){
        const filter={team:{id:{eq:scope.teamId}},...(input.projectId?{project:{id:{eq:input.projectId}}}:{})};
        const values=await pages.collect({path:'issues',load:async after=>(await request('issues',{filter,first:50,after})).issues});
        const items=values.items?[]:null;
        for(const [index,raw] of (values.items??[]).entries())if(!raw.archivedAt)items.push(await issueShape(raw,'issues['+index+']'));
        data.issues=pages.finish(values,items);
      }else if(kind==='issue'){
        const checked=(await request('issueScope',{id:input.issueId})).issue;
        if(!checked||checked.team?.id!==scope.teamId||checked.archivedAt)fail('LINEAR_SCOPE','Ce ticket actif ne fait pas partie de l’équipe configurée.');
        const raw=(await request('issue',{id:checked.id})).issue;
        if(!raw||raw.id!==checked.id||raw.archivedAt)fail('LINEAR_SCOPE','Le ticket demandé a changé de portée.');
        const counted=await pages.collect({path:'issue',seed:{nodes:[raw],pageInfo:{hasNextPage:false,endCursor:null}}});
        if(counted.items?.length)data.issue=await issueShape(raw,'issue');
      }else{
        const checked=(await request('documentScope',{id:input.documentId})).document;
        if(!checked||checked.project?.id!==input.projectId||checked.archivedAt)fail('LINEAR_SCOPE','Ce document actif ne fait pas partie du projet Linear demandé.');
        const raw=(await request('document',{id:checked.id})).document;
        if(!raw||raw.id!==checked.id||raw.project?.id!==input.projectId||raw.archivedAt)fail('LINEAR_SCOPE','Le document demandé a changé de portée.');
        const content=string(raw.content),bytes=content===null?null:Buffer.from(content,'utf8'),truncated=bytes!==null&&bytes.length>READ_LIMITS.documentBytes;
        data.document={...documentShape(raw),content:truncated?bytes.subarray(0,READ_LIMITS.documentBytes).toString('utf8').replace(/\uFFFD$/u,''):content,truncated};
        if(truncated)pages.note('document.content','document-truncated');
      }
      response.complete=pages.partialReasons.length===0;response.status=response.complete?'complete':'partial';
      response.observedAt=new Date().toISOString();response.usage={requests:transport.requests,nodes:pages.nodes,maxComplexity:transport.maxComplexity};
      assertNoCredential(response,credential);
      if(response.complete)await transport.bounded(()=>cache.put(response));
      return response;
    }catch(error){
      if(!(error instanceof ReadInterrupted))throw error;
      pages.note(kind,error.reason);response.complete=false;response.status='partial';return response;
    }finally{
      response.observedAt??=new Date().toISOString();response.usage={requests:transport.requests,nodes:pages.nodes,maxComplexity:transport.maxComplexity};
      transport.close();
    }
  }
}
