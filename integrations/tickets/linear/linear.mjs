// Official schema: https://github.com/linear/linear/blob/master/packages/sdk/src/schema.graphql
import { join } from 'node:path';
import { rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { AppError, fail, exec as defaultExec, commandOptions, readJSON, writeJSON, text } from '../../../src/common.mjs';
import {CHILD_LIMIT,childrenSummary} from './linear-children.mjs';

export class KeychainProvider {
  constructor({exec=defaultExec}={}) {this.exec=exec;}
  async getToken() {
    try {const {stdout}=await this.exec('/usr/bin/security',['find-generic-password','-s','ai.la-fabrique.console.linear','-a','api-key','-w'],{...commandOptions,timeout:10000});return stdout.trim()||null;}
    catch {return null;}
  }
}
const pageInfo='pageInfo { hasNextPage endCursor }';
const relationFields=`relations(first:3,includeArchived:false){nodes{id type relatedIssue{id}} ${pageInfo}} inverseRelations(first:3,includeArchived:false){nodes{id type issue{id}} ${pageInfo}}`;
const issueFields=`id identifier title description url priority priorityLabel createdAt updatedAt branchName state { id name type color } team { id key name } project { id name } assignee { id name } parent { id } ${relationFields}`;
const relationLevel=i=>Array.isArray(i.relations?.nodes)&&Array.isArray(i.inverseRelations?.nodes)?'full':Object.hasOwn(i,'parent')?'parent':'none';
const relationCount=(connection,target)=>new Set((connection?.nodes??[]).filter(r=>r.type==='blocks').map(r=>{
  const id=r[target]?.id;if(typeof id!=='string'||!id)fail('LINEAR_API','Linear returned an invalid issue relation.');return id;
})).size;
const coverage=issues=>issues.reduce((level,i)=>['none','parent','full'].indexOf(relationLevel(i))<['none','parent','full'].indexOf(level)?relationLevel(i):level,'full');
// labelsComplete is false when a ticket has more labels than were read: nothing can then be counted on them.
const normalizeIssue=i=>({...i,parentId:typeof i.parent?.id==='string'?i.parent.id:null,
  blocks:relationLevel(i)==='full'?relationCount(i.relations,'relatedIssue'):0,blockedBy:relationLevel(i)==='full'?relationCount(i.inverseRelations,'issue'):0,
  labels:i.labels?.nodes??i.labels??[],labelsComplete:i.labels?.pageInfo?.hasNextPage!==true,comments:i.comments?.nodes??i.comments??[]});
export class LinearClient {
  constructor({root,provider=new KeychainProvider(),fetch=globalThis.fetch,sleep=ms=>new Promise(r=>setTimeout(r,ms)),ttlMs=60000,timeoutMs=15000}={}) {
    this.root=root;this.provider=provider;this.fetch=fetch;this.sleep=sleep;this.ttlMs=ttlMs;this.timeoutMs=timeoutMs;
  }
  async configured() {return !!(await this.provider.getToken());}
  async query(query,variables={}) {
    const token=await this.provider.getToken();if(!token) fail('LINEAR_NOT_CONFIGURED','Linear is not configured. Add a personal API key to the dedicated macOS Keychain item.');
    for(let attempt=0;attempt<3;attempt++) {
      let response;
      try {response=await this.fetch('https://api.linear.app/graphql',{method:'POST',headers:{'Content-Type':'application/json',Authorization:token},body:JSON.stringify({query,variables}),signal:AbortSignal.timeout(this.timeoutMs)});}
      catch {fail('LINEAR_UNAVAILABLE','Linear could not be reached within the request timeout.');}
      if(response.status===429) {
        if(attempt===2) fail('LINEAR_RATE_LIMIT','Linear rate limit reached. Retry later.');
        const header=response.headers.get('retry-after');const seconds=Number(header);
        const delay=header&&Number.isFinite(seconds)?seconds*1000:header?Date.parse(header)-Date.now():1000*2**attempt;
        if(delay>60000) fail('LINEAR_RATE_LIMIT','Linear requested a longer retry delay. Retry later.');
        await this.sleep(Math.max(0,Number.isFinite(delay)?delay:1000));continue;
      }
      if(response.status===401||response.status===403) fail('LINEAR_AUTH','Linear rejected the configured credentials or permissions.');
      if(!response.ok) fail('LINEAR_UNAVAILABLE','Linear returned an unsuccessful HTTP response.');
      let body;try {body=await response.json();}catch {fail('LINEAR_API','Linear returned invalid JSON.');}
      if(body.errors?.length||!body.data) fail('LINEAR_API','Linear returned a GraphQL error. Check access rights and retry.');
      return body.data;
    }
  }
  async cacheFile(key) {
    const token=await this.provider.getToken();
    if(!token)fail('LINEAR_NOT_CONFIGURED','Linear is not configured. Add a personal API key to the dedicated macOS Keychain item.');
    return join(this.root,'cache',createHash('sha256').update(JSON.stringify([token,key])).digest('hex')+'.json');
  }
  async cached(key,refresh,load) {
    const file=await this.cacheFile(key);
    const previous=await readJSON(file,null);
    if(!refresh&&previous&&Date.now()-Date.parse(previous.updatedAt)<this.ttlMs) return {...previous.data,cached:true,updatedAt:previous.updatedAt};
    const data=await load();const updatedAt=new Date().toISOString();await writeJSON(file,{updatedAt,data});return {...data,cached:false,updatedAt};
  }
  async pages(query,variables,key,startAfter=null) {
    const nodes=[];let after=startAfter;const seen=new Set(startAfter?[startAfter]:[]);
    for(let count=0;count<200;count++) {
      const data=await this.query(query,{...variables,after});const connection=key(data);
      if(!connection||!Array.isArray(connection.nodes)) fail('LINEAR_API','Linear returned an invalid connection.');
      nodes.push(...connection.nodes);
      if(!connection.pageInfo?.hasNextPage) return nodes;
      after=connection.pageInfo.endCursor;
      if(!after||seen.has(after)) fail('LINEAR_PAGINATION','Linear returned an invalid pagination cursor.');seen.add(after);
    }
    fail('LINEAR_PAGINATION','Linear pagination exceeded the local safety limit. Narrow the filter.');
  }
  async completeRelations(issue) {
    const result={...issue};
    for(const field of ['relations','inverseRelations']) {
      const seed=issue[field];if(seed===undefined)continue;
      if(!seed||!Array.isArray(seed.nodes)||typeof seed.pageInfo?.hasNextPage!=='boolean')fail('LINEAR_API','Linear returned an invalid relation connection.');
      if(!seed.pageInfo.hasNextPage)continue;
      const after=seed.pageInfo.endCursor;if(typeof after!=='string'||!after)fail('LINEAR_PAGINATION','Linear returned an invalid relation cursor.');
      const target=field==='relations'?'relatedIssue':'issue';
      const query=`query FabriqueConsoleIssueRelationPage($id:String!,$after:String){issue(id:$id){${field}(first:50,after:$after,includeArchived:false){nodes{id type ${target}{id}} ${pageInfo}}}}`;
      const rest=await this.pages(query,{id:issue.id},data=>data.issue?.[field],after);
      result[field]={nodes:[...seed.nodes,...rest],pageInfo:{hasNextPage:false,endCursor:null}};
    }
    return result;
  }
  async issueList(query,filter) {
    const issues=[];
    for(const issue of await this.pages(query,{filter},data=>data.issues))issues.push(await this.completeRelations(issue));
    return {issues:issues.map(normalizeIssue),relations:coverage(issues)};
  }
  async list({search,projectId,teamId,priority,stateId,mine=false,refresh=false}={}) {
    const filter={};
    if(projectId) filter.project={id:{eq:text(projectId,'projectId',200)}};
    if(teamId) filter.team={id:{eq:text(teamId,'teamId',200)}};
    if(stateId) filter.state={id:{eq:text(stateId,'stateId',200)}};
    if(priority!==undefined&&priority!==null&&priority!=='') {if(!Number.isInteger(priority)||priority<0||priority>4) fail('INVALID_ARGUMENT','Priority must be an integer from 0 to 4.');filter.priority={eq:priority};}
    if(mine) {const {viewer}=await this.query('query FabriqueConsoleViewer { viewer { id } }');filter.assignee={id:{eq:viewer.id}};}
    // Title/description/identifier filtering uses supported IssueFilter fields, preserving relation filters.
    if(search) {text(search,'search',300);filter.or=[{title:{containsIgnoreCase:search}},{description:{containsIgnoreCase:search}}];if(/^[a-zA-Z]+-\d+$/.test(search)) {const [key,number]=search.split('-');filter.or.push({number:{eq:Number(number)},team:{key:{eqIgnoreCase:key}}});}}
    // The cache key carries the shape of what is kept: lists kept before the labels were read whole are not reused.
    return this.cached(['issues-relations-v1',filter],refresh,()=>this.issueList(`query FabriqueConsoleIssues($filter:IssueFilter,$after:String){issues(first:50,after:$after,filter:$filter){nodes{${issueFields} labels(first:50){nodes{id name color} pageInfo{hasNextPage}}} ${pageInfo}}}`,filter));
  }
  async detail(id,{refresh=false}={}) {
    text(id,'issue id',200);
    return this.cached(['issue-children-v1',id],refresh,async()=>{
      const data=await this.query(`query FabriqueConsoleIssue($id:String!){issue(id:$id){${issueFields} labels(first:50){nodes{id name color} ${pageInfo}} comments(first:50){nodes{id body createdAt updatedAt user{id name}} ${pageInfo}} children(first:${CHILD_LIMIT},includeArchived:false){nodes{id identifier title description url state{name type} labels(first:20){nodes{name color} ${pageInfo}} inverseRelations(first:20,includeArchived:false){nodes{type issue{id}} ${pageInfo}}} ${pageInfo}}}}`,{id});
      if(!data.issue) fail('NOT_FOUND','The Linear issue was not found.');
      const complete=await this.completeRelations(data.issue),result=normalizeIssue(complete);
      if(data.issue.comments?.pageInfo?.hasNextPage) result.comments=await this.pages(`query FabriqueConsoleComments($id:String!,$after:String){issue(id:$id){comments(first:50,after:$after){nodes{id body createdAt updatedAt user{id name}} ${pageInfo}}}}`,{id},d=>d.issue.comments);
      if(data.issue.labels?.pageInfo?.hasNextPage) result.labels=await this.pages(`query FabriqueConsoleLabels($id:String!,$after:String){issue(id:$id){labels(first:50,after:$after){nodes{id name color} ${pageInfo}}}}`,{id},d=>d.issue.labels);
      Object.assign(result,childrenSummary(data.issue.children?.nodes,{transport:'graphql',listComplete:data.issue.children?.pageInfo?.hasNextPage===false,truncated:data.issue.children?.pageInfo?.hasNextPage===true}));
      return {issue:result,relations:relationLevel(complete)};
    });
  }
  // The issues of a team that belong to no project and are still in Backlog: what the Issues page lists.
  backlogKey(teamId) {return ['backlog-relations-v1',{team:{id:{eq:text(teamId,'teamId',200)}},project:{null:true},state:{type:{eq:'backlog'}}}];}
  async backlog({teamId,refresh=false}={}) {
    const [,filter]=this.backlogKey(teamId);
    return this.cached(this.backlogKey(teamId),refresh,()=>this.issueList(`query FabriqueConsoleBacklog($filter:IssueFilter,$after:String){issues(first:50,after:$after,filter:$filter){nodes{${issueFields} labels(first:50){nodes{id name color} pageInfo{hasNextPage}}} ${pageInfo}}}`,filter));
  }
  // After a write, the lists kept for the team (its backlog, every issue) are dropped: the next read goes to Linear.
  async forgetBacklog(teamId) {
    await rm(await this.cacheFile(this.backlogKey(teamId)),{force:true});
    await rm(await this.cacheFile(['issues-relations-v1',{team:{id:{eq:text(teamId,'teamId',200)}}}]),{force:true});
  }
  // A new issue in a team, in the state given (its Backlog) or the team's default one. The id, chosen by the
  // caller, lets a lost answer be reconciled by reading the issue: Linear refuses a second issue with the same id.
  async create({teamId,title,stateId=null,id=null}) {
    const input={teamId:text(teamId,'teamId',200),title:text(title,'title',255),...(stateId?{stateId:text(stateId,'stateId',200)}:{}),...(id?{id:text(id,'id',36)}:{})};
    const data=await this.query(`mutation FabriqueConsoleCreate($input:IssueCreateInput!){issueCreate(input:$input){success issue{${issueFields}}}}`,{input});
    if(data.issueCreate?.success!==true||!data.issueCreate.issue)fail('LINEAR_MUTATION_FAILED','Linear did not confirm the issue creation. Refresh the backlog before another attempt.');
    return {success:true,issue:normalizeIssue(data.issueCreate.issue)};
  }
  async meta({refresh=false}={}) {
    return this.cached(['meta'],refresh,async()=>{
      const {viewer}=await this.query('query FabriqueConsoleViewer { viewer { id name } }');
      const teams=await this.pages(`query FabriqueConsoleTeams($after:String){teams(first:50,after:$after){nodes{id key name} ${pageInfo}}}`,{},d=>d.teams);
      const projects=await this.pages(`query FabriqueConsoleProjects($after:String){projects(first:50,after:$after){nodes{id name} ${pageInfo}}}`,{},d=>d.projects);
      const states=await this.pages(`query FabriqueConsoleStates($after:String){workflowStates(first:50,after:$after){nodes{id name type color team{id}} ${pageInfo}}}`,{},d=>d.workflowStates);
      return {viewer,teams,projects,states};
    });
  }
  async mutate(payload) {
    // Authorization and exact confirmation are enforced by the action dispatcher.
    const results={};
    if(payload.stateId) {
      results.state=await this.query('mutation FabriqueConsoleState($id:String!,$input:IssueUpdateInput!){issueUpdate(id:$id,input:$input){success issue{id identifier state{id name}}}}',{id:payload.issueId,input:{stateId:payload.stateId}});
      if(results.state.issueUpdate?.success!==true)fail('LINEAR_MUTATION_FAILED','Linear did not confirm the state update. Refresh the issue before another attempt.');
    }
    if(payload.comment) {
      try {
        results.comment=await this.query('mutation FabriqueConsoleComment($input:CommentCreateInput!){commentCreate(input:$input){success comment{id}}}',{input:{issueId:payload.issueId,body:payload.comment}});
        if(results.comment.commentCreate?.success!==true)fail('LINEAR_MUTATION_FAILED','Linear did not confirm the comment creation. Refresh the issue before another attempt.');
      }catch(error) {
        if(results.state)fail('LINEAR_MUTATION_PARTIAL','The issue state changed, but the comment was not confirmed. Refresh Linear before retrying; do not repeat the whole payload.');
        throw error;
      }
    }
    return {success:true,results};
  }
}
