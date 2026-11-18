import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { auth } from '@modelcontextprotocol/sdk/client/auth.js';
import { createServer } from 'node:http';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { spawn } from 'node:child_process';
import * as fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import os from 'node:os';
import { AppError, fail, privateDir, readJSON, writeJSON, withLock, text } from '../../../src/common.mjs';
import {CHILD_LIMIT,childrenSummary} from './linear-children.mjs';

export const MCP_ENDPOINT = 'https://mcp.linear.app/mcp/readonly';
const authMessage = 'Linear OAuth is not configured or must be renewed. Run npm run tickets:login.';
const notConfigured = () => fail('LINEAR_NOT_CONFIGURED',authMessage);
const defaultRoot = () => process.env.FABRIQUE_CONSOLE_HOME??join(os.homedir(),'.config/fabrique-console');
function endpointURL(endpoint) {
  if (![MCP_ENDPOINT,'https://mcp.linear.app/mcp'].includes(endpoint)) fail('INVALID_ARGUMENT','Use the official Linear MCP endpoint.');
  return new URL(endpoint);
}
async function processJSON(command,args,input,{timeoutMs=30000}={}) {
  return new Promise((resolve,reject)=>{
    const child=spawn(command,args,{stdio:['pipe','pipe','pipe'],shell:false});
    let output='',size=0;
    const timer=setTimeout(()=>{child.kill('SIGKILL');reject(new AppError('LINEAR_KEYCHAIN','The dedicated Keychain helper timed out.'));},timeoutMs);
    child.on('error',()=>{clearTimeout(timer);reject(new AppError('LINEAR_KEYCHAIN','The dedicated Keychain helper could not run.'));});
    child.stdout.on('data',chunk=>{size+=chunk.length;if(size>2_000_000)child.kill('SIGKILL');else output+=chunk;});
    child.stderr.on('data',()=>{});
    child.on('close',code=>{clearTimeout(timer);if(code!==0)return reject(new AppError('LINEAR_KEYCHAIN','The dedicated Keychain helper failed. Check macOS Keychain access.'));try{resolve(output.trim()?JSON.parse(output):null);}catch{reject(new AppError('LINEAR_KEYCHAIN','The dedicated Keychain helper returned invalid data.'));}});
    child.stdin.on('error',()=>{});child.stdin.end(input===undefined?'':JSON.stringify(input));
  });
}
export class MCPKeychainStore {
  constructor({root=defaultRoot(),run=processJSON}={}){this.root=root;this.run=run;}
  async binary() {
    if(process.platform!=='darwin')fail('LINEAR_KEYCHAIN','Linear OAuth credentials require macOS Keychain.');
    const source=fileURLToPath(new URL('./keychain-write.swift',import.meta.url));
    const hash=createHash('sha256').update(await fs.readFile(source)).digest('hex').slice(0,20);
    const folder=join(this.root,'bin'), binary=join(folder,`linear-keychain-${hash}`);
    await privateDir(folder);
    try{const s=await fs.lstat(binary);if(!s.isFile()||s.isSymbolicLink())fail('LINEAR_KEYCHAIN','Unsafe Keychain helper.');return binary;}catch(e){if(e.code!=='ENOENT')throw e;}
    await withLock(join(this.root,'keychain-build'),async()=>{
      try{await fs.access(binary);return;}catch{}
      const temp=`${binary}.${randomUUID()}.tmp`;
      try{await processJSON('/usr/bin/swiftc',['-O',source,'-o',temp],undefined,{timeoutMs:60000});await fs.chmod(temp,0o700);await fs.rename(temp,binary);}finally{await fs.rm(temp,{force:true});}
    });
    return binary;
  }
  async read(){return this.run(await this.binary(),[],{action:'read'});}
  async write(value){await this.run(await this.binary(),[],{action:'write',value});}
}
export class MCPOAuthProvider {
  constructor({endpoint=MCP_ENDPOINT,store=new MCPKeychainStore(),redirectUrl,openUrl,interactive=false}={}) {
    endpointURL(endpoint);Object.assign(this,{endpoint,store,callback:redirectUrl,openUrl,interactive});this.record=null;
  }
  async load(){this.record=await this.store.read();if(this.record?.endpoint!==this.endpoint)this.record=null;return this.record;}
  async save(){await this.store.write(this.record);}
  get redirectUrl(){return this.callback??this.record?.redirectUrl;}
  get clientMetadata(){return {client_name:'Fabrique Console',redirect_uris:[String(this.redirectUrl)],grant_types:['authorization_code','refresh_token'],response_types:['code'],token_endpoint_auth_method:'none',scope:'read'};}
  state(){return this.expectedState;}
  async clientInformation(){return this.record?.clientInformation;}
  async saveClientInformation(clientInformation){this.record.clientInformation=clientInformation;await this.save();}
  async tokens(){return this.record?.tokens;}
  async saveTokens(tokens){this.record.tokens=tokens;this.record.expiresAt=tokens.expires_in?Date.now()+tokens.expires_in*1000:null;await this.save();}
  async redirectToAuthorization(url){if(!this.interactive)notConfigured();await this.openUrl(url);}
  async saveCodeVerifier(code){if(!this.interactive)notConfigured();this.verifier=code;}
  async codeVerifier(){if(!this.verifier)notConfigured();return this.verifier;}
  async saveDiscoveryState(discovery){this.record.discovery=discovery;await this.save();}
  async discoveryState(){return this.record?.discovery;}
  async invalidateCredentials(scope){if(scope==='all'){this.record={version:1,endpoint:this.endpoint,identity:randomUUID(),redirectUrl:String(this.redirectUrl)};}else if(scope==='client')delete this.record.clientInformation;else if(scope==='tokens')delete this.record.tokens;else if(scope==='verifier')this.verifier=undefined;else if(scope==='discovery')delete this.record.discovery;await this.save();}
}
function safeFetch(fetchImpl) {
  return (input,init={})=>fetchImpl(input,{...init,signal:init.signal?AbortSignal.any([init.signal,AbortSignal.timeout(20000)]):AbortSignal.timeout(20000)});
}
export function validOAuthState(actual,expected){
  if(typeof actual!=='string'||typeof expected!=='string'||!expected)return false;
  const a=Buffer.from(actual),b=Buffer.from(expected);
  return a.length===b.length&&timingSafeEqual(a,b);
}
async function withMCPLock(root,task){
  const deadline=Date.now()+60000;
  for(;;){
    try{return await withLock(join(root,'mcp-oauth'),task);}
    catch(error){if(error.code!=='BUSY'||Date.now()>deadline)throw error;await new Promise(resolve=>setTimeout(resolve,40));}
  }
}
export async function authorizeSession({root=defaultRoot(),endpoint=MCP_ENDPOINT,store=new MCPKeychainStore({root}),redirectUrl,openUrl,state,code,fetch=globalThis.fetch,authorize=auth}={}){
  endpointURL(endpoint);
  // Dynamic registration, discovery and tokens stay in memory until the whole grant succeeds.
  const pending={value:null,async read(){return this.value;},async write(value){this.value=value;}};
  const provider=new MCPOAuthProvider({endpoint,store:pending,redirectUrl,openUrl,interactive:true});
  provider.expectedState=state;
  provider.record={version:1,endpoint,identity:randomUUID(),redirectUrl:String(redirectUrl)};
  try{
    const result=await authorize(provider,{serverUrl:endpoint,scope:'read',fetchFn:safeFetch(fetch)});
    if(result==='REDIRECT')await authorize(provider,{serverUrl:endpoint,scope:'read',authorizationCode:await code,fetchFn:safeFetch(fetch)});
    if(!provider.record.tokens?.access_token)notConfigured();
    if(provider.record.tokens.scope&&provider.record.tokens.scope.split(/\s+/).some(scope=>scope!=='read'))fail('LINEAR_AUTH','Linear returned unexpected OAuth permissions. The previous session was preserved.');
    await withMCPLock(root,()=>store.write(provider.record));
    return {authenticated:true,endpoint,scope:'read'};
  }catch(error){if(error instanceof AppError)throw error;fail('LINEAR_AUTH','Linear OAuth could not complete. Retry npm run tickets:login.');}
  finally{provider.verifier=undefined;pending.value=null;}
}
export async function login({root=defaultRoot(),endpoint=MCP_ENDPOINT,store=new MCPKeychainStore({root}),fetch=globalThis.fetch,openUrl=url=>processJSON('/usr/bin/open',[String(url)]),timeoutMs=300000}={}) {
  endpointURL(endpoint);
  const expectedState=randomBytes(32).toString('base64url');
  let resolveCode,rejectCode;
  const codePromise=new Promise((resolve,reject)=>{resolveCode=resolve;rejectCode=reject;});
  codePromise.catch(()=>{});
  const server=createServer((request,response)=>{
    response.setHeader('Cache-Control','no-store');response.setHeader('Referrer-Policy','no-referrer');response.setHeader('Content-Security-Policy',"default-src 'none'");
    let incoming;try{incoming=new URL(request.url??'/',`http://127.0.0.1:${server.address().port}`);}catch{response.writeHead(400);response.end('Invalid OAuth callback.');return;}
    const state=incoming.searchParams.get('state')??'';
    const correctState=validOAuthState(state,expectedState);
    if(request.method!=='GET'||request.headers.host!==`127.0.0.1:${server.address().port}`||incoming.pathname!=='/callback'||incoming.searchParams.getAll('state').length!==1||!correctState){response.writeHead(400);response.end('Invalid OAuth callback.');return;}
    if(incoming.searchParams.has('error')){response.writeHead(400);response.end('Linear authorization was declined.');rejectCode(new AppError('LINEAR_AUTH','Linear authorization was declined.'));return;}
    const code=incoming.searchParams.get('code');
    if(!code||code.length>8192||incoming.searchParams.getAll('code').length!==1){response.writeHead(400);response.end('Invalid OAuth callback.');return;}
    response.writeHead(200,{'Content-Type':'text/plain; charset=utf-8'});response.end('Linear authorization received. You may return to Fabrique Console.');resolveCode(code);
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const timer=setTimeout(()=>rejectCode(new AppError('LINEAR_AUTH_TIMEOUT','Linear authorization timed out. Run npm run tickets:login again.')),timeoutMs);
  try{return await authorizeSession({root,endpoint,store,redirectUrl:`http://127.0.0.1:${server.address().port}/callback`,openUrl,state:expectedState,code:codePromise,fetch});}
  finally{clearTimeout(timer);server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
}
export class LinearMCPClient {
  constructor({root=defaultRoot(),endpoint=MCP_ENDPOINT,store=new MCPKeychainStore({root}),fetch=globalThis.fetch,ttlMs=60000}={}){endpointURL(endpoint);Object.assign(this,{root,endpoint,store,fetch,ttlMs});this.provider=new MCPOAuthProvider({endpoint,store});}
  async configured(){const record=await this.provider.load();return !!(record?.tokens?.access_token||record?.tokens?.refresh_token);}
  async session(task){return withMCPLock(this.root,()=>this.sessionUnlocked(task));}
  async sessionUnlocked(task){
    const provider=new MCPOAuthProvider({endpoint:this.endpoint,store:this.store});
    await provider.load();
    if(!provider.record?.tokens?.access_token&&!provider.record?.tokens?.refresh_token)notConfigured();
    const client=new Client({name:'fabrique-console',version:'0.1.0'},{capabilities:{}});
    const transport=new StreamableHTTPClientTransport(endpointURL(this.endpoint),{authProvider:provider,fetch:safeFetch(this.fetch),reconnectionOptions:{maxRetries:0,initialReconnectionDelay:1000,maxReconnectionDelay:1000,reconnectionDelayGrowFactor:1}});
    try{await client.connect(transport,{timeout:20000});return await task(client);}catch(error){if(error instanceof AppError)throw error;if(error.name==='UnauthorizedError'||error.code===401)notConfigured();fail('LINEAR_MCP_UNAVAILABLE','Linear MCP could not complete the request. Check connectivity and authorization.');}finally{await client.close().catch(()=>{});}
  }
  async tools(client){
    const tools=[],seen=new Set();let cursor;
    for(let i=0;i<100;i++){const result=await client.listTools(cursor?{cursor}:undefined,{timeout:20000});tools.push(...result.tools);if(!result.nextCursor)return tools;if(seen.has(result.nextCursor))fail('LINEAR_PAGINATION','Linear MCP repeated a tool cursor.');seen.add(result.nextCursor);cursor=result.nextCursor;}
    fail('LINEAR_PAGINATION','Linear MCP tool catalog exceeded the safety limit.');
  }
  async discover(){return this.session(client=>this.tools(client));}
  async cached(key,refresh,load){return withMCPLock(this.root,()=>this.cachedUnlocked(key,refresh,load));}
  async cachedUnlocked(key,refresh,load){
    const provider=new MCPOAuthProvider({endpoint:this.endpoint,store:this.store});
    const record=await provider.load();
    if(!record?.tokens?.access_token&&!record?.tokens?.refresh_token)notConfigured();
    const identity=record.identity??createHash('sha256').update(record.tokens.access_token??record.tokens.refresh_token).digest('hex');
    const digest=createHash('sha256').update(JSON.stringify([this.endpoint,identity,record.clientInformation?.client_id,key])).digest('hex');
    const file=join(this.root,'cache',`linear-mcp-${digest}.json`),previous=await readJSON(file,null);
    if(!refresh&&previous&&Date.now()-Date.parse(previous.updatedAt)<this.ttlMs)return {...previous.data,cached:true,updatedAt:previous.updatedAt};
    const data=await this.sessionUnlocked(async client=>load(client,await this.tools(client)));
    const updatedAt=new Date().toISOString();await writeJSON(file,{updatedAt,data});return {...data,cached:false,updatedAt};
  }
  schema(catalog,name){const tool=catalog.find(t=>t.name===name);if(!tool?.inputSchema||tool.inputSchema.type!=='object')fail('LINEAR_MCP_UNSUPPORTED',`The authenticated Linear MCP server does not expose the supported read tool ${name}.`);return tool.inputSchema;}
  async call(client,catalog,name,args){
    const schema=this.schema(catalog,name),properties=schema.properties??{};
    for(const required of schema.required??[])if(args[required]===undefined)fail('LINEAR_MCP_UNSUPPORTED','A required Linear MCP tool argument changed. Refresh or update the integration.');
    for(const [key,value] of Object.entries(args)){
      const property=properties[key];if(!property)fail('LINEAR_MCP_UNSUPPORTED','A supported Linear MCP tool argument changed. Refresh or update the integration.');
      const types=Array.isArray(property.type)?property.type:[property.type];
      const type=Array.isArray(value)?'array':value===null?'null':typeof value;
      if(property.type&&!types.includes(type)&&!(type==='number'&&types.includes('integer')&&Number.isInteger(value)))fail('LINEAR_MCP_UNSUPPORTED','A Linear MCP argument type changed.');
      if(property.enum&&!property.enum.includes(value))fail('LINEAR_MCP_UNSUPPORTED','A Linear MCP argument enumeration changed.');
    }
    const result=await client.callTool({name,arguments:args},undefined,{timeout:20000});
    if(result.isError)fail('LINEAR_MCP_API','Linear MCP rejected the read request. Check identifiers and access rights.');
    if(result.structuredContent!==undefined)return result.structuredContent;
    const blocks=result.content?.filter(c=>c.type==='text')??[];
    if(blocks.length!==1)fail('LINEAR_MCP_API','Linear MCP returned an unsupported response format.');
    try{return JSON.parse(blocks[0].text);}catch{fail('LINEAR_MCP_API','Linear MCP returned invalid structured data.');}
  }
  fields(catalog,name){
    const allowed=this.schema(catalog,name).properties?.fields?.items?.enum;
    const desired=['id','uuid','title','description','priority','url','gitBranchName','createdAt','updatedAt','status','statusType','labels','assignee','assigneeId','project','projectId','team','teamId','parentId'];
    return Array.isArray(allowed)?{fields:desired.filter(f=>allowed.includes(f))}:{};
  }
  async pages(client,catalog,name,args,key){
    const schema=this.schema(catalog,name),properties=schema.properties??{},all=[],seen=new Set();let cursor;
    for(let i=0;i<200;i++){
      const pagination={};if(properties.limit)pagination.limit=Math.min(100,properties.limit.maximum??100);if(cursor){if(!properties.cursor)fail('LINEAR_PAGINATION','Linear MCP cannot continue this result set.');pagination.cursor=cursor;}
      const data=await this.call(client,catalog,name,{...args,...pagination});
      const items=Array.isArray(data)?data:data?.[key];
      if(!Array.isArray(items))fail('LINEAR_MCP_API','Linear MCP returned an invalid result list.');
      all.push(...items);
      if(Array.isArray(data)||!data.hasNextPage)return Object.assign(all,{complete:data?.hasNextPage===false});
      cursor=data.cursor;if(typeof cursor!=='string'||!cursor||seen.has(cursor))fail('LINEAR_PAGINATION','Linear MCP returned an invalid pagination cursor.');seen.add(cursor);
    }
    fail('LINEAR_PAGINATION','Linear MCP pagination exceeded the local safety limit. Narrow the filter.');
  }
  async classifyIssues(client,catalog,issues,{teamId}={}){
    const types=new Set(['backlog','unstarted','started','completed','canceled','triage']),byTeam=new Map();
    for(const issue of issues){
      if(types.has(issue.state?.type))continue;
      // MCP can omit statusType (not advertised in its fields enum) and provide
      // no status id. Resolve the exact name within THIS team, never by a global
      // name heuristic. Failure leaves the existing summary explicitly unknown.
      const team=issue.team?.id??issue.team?.name??teamId;
      let reason='team-unavailable';
      if(team){
        if(!byTeam.has(team)){
          try{byTeam.set(team,await this.pages(client,catalog,'list_issue_statuses',{team},'states'));}
          catch{byTeam.set(team,null);}
        }
        const states=byTeam.get(team);
        if(states){
          const matches=states.filter(state=>issue.state?.id?state.id===issue.state.id:state.name===issue.state?.name);
          if(matches.length===1&&types.has(matches[0].type)){
            issue.statusClassification={source:issue.state?.id?'team-status-id':'team-status-name',reason:null};
            issue.state={...issue.state,id:matches[0].id,type:matches[0].type};continue;
          }
          reason=matches.length>1?'status-ambiguous':matches.length?'type-unrecognized':'status-not-found';
        }else reason='metadata-unavailable';
      }
      issue.state={...issue.state,type:'unknown'};
      issue.statusClassification={source:'unresolved',reason};
    }
    return issues;
  }
  async list({search,projectId,teamId,priority,stateId,mine=false,refresh=false}={}){
    const args={};
    if(search)args.query=text(search,'search',300);if(projectId)args.project=text(projectId,'projectId',200);if(teamId)args.team=text(teamId,'teamId',200);if(stateId)args.state=text(stateId,'stateId',200);if(mine)args.assignee='me';
    if(priority!==undefined&&priority!==null&&priority!==''){if(!Number.isInteger(priority)||priority<0||priority>4)fail('INVALID_ARGUMENT','Priority must be an integer from 0 to 4.');args.priority=priority;}
    return this.cached(['issues-parent-v1',args],refresh,async(client,catalog)=>{
      const selected=this.fields(catalog,'list_issues');
      const raw=await this.pages(client,catalog,'list_issues',{...args,...selected},'issues');
      const parent=raw.some(i=>Object.hasOwn(i,'parentId')&&(i.parentId===null||typeof i.parentId==='string'))||(!raw.length&&selected.fields?.includes('parentId'));
      return {issues:await this.classifyIssues(client,catalog,raw.map(normalizeIssue),{teamId}),relations:parent?'parent':'none',complete:raw.complete===true,cursor:null};
    });
  }
  async detail(id,{refresh=false}={}){
    text(id,'issue id',200);
    return this.cached(['issue-children-v2',id],refresh,async(client,catalog)=>{
      const raw=await this.call(client,catalog,'get_issue',{id,...this.fields(catalog,'get_issue')});
      if(!raw||typeof raw!=='object'||Array.isArray(raw)||!raw.id)fail('LINEAR_MCP_API','Linear MCP returned an invalid issue.');
      const issue=normalizeIssue(raw);
      await this.classifyIssues(client,catalog,[issue]);
      const comments=await this.pages(client,catalog,'list_comments',{issueId:id},'comments');
      issue.comments=comments.map(c=>({...c,user:c.user??c.author??null}));
      const tool=catalog.find(t=>t.name==='list_issues'),properties=tool?.inputSchema?.properties;
      if(properties?.parentId?.type==='string') {
        // A failed child read (including auth/network errors) keeps the parent readable.
        // "unavailable" deliberately covers failed and unsupported reads; never a complete empty list.
        try {
          const args={parentId:issue.id,...this.fields(catalog,'list_issues')};
          for(const field of ['blockedBy','relations','labelsComplete','blockedByComplete'])if(args.fields&&properties.fields.items.enum.includes(field))args.fields.push(field);
          if(properties.limit)args.limit=Math.min(CHILD_LIMIT,properties.limit.maximum??CHILD_LIMIT);
          const data=await this.call(client,catalog,'list_issues',args),source=Array.isArray(data)?data:data?.issues;
          const records=Array.isArray(source)?source.map(raw=>{const normalized=normalizeIssue(raw);return {...raw,state:normalized.state,team:normalized.team??(typeof raw.teamId==='string'?{id:raw.teamId}:null)};}):null;
          if(records)await this.classifyIssues(client,catalog,records,{teamId:issue.team?.id??raw.teamId});
          Object.assign(issue,childrenSummary(records,{transport:'mcp',listComplete:data?.hasNextPage===false,truncated:data?.hasNextPage===true}));
        }catch{Object.assign(issue,childrenSummary(null));}
      }else Object.assign(issue,childrenSummary(null));
      return {issue,commentsComplete:comments.complete===true};
    });
  }
  async meta({refresh=false}={}){
    return this.cached(['meta'],refresh,async(client,catalog)=>{
      const viewer=await this.call(client,catalog,'get_user',{query:'me'});
      const teams=await this.pages(client,catalog,'list_teams',{},'teams');
      const projectPage=await this.pages(client,catalog,'list_projects',{},'projects'),projects=projectPage.map(p=>({...p,identifier:p.id,id:p.uuid??p.id}));
      const states=[];let statesComplete=true;
      for(const team of teams){const page=await this.pages(client,catalog,'list_issue_statuses',{team:team.id},'states');statesComplete&&=page.complete===true;states.push(...page.map(s=>({...s,team:{id:team.id}})));}
      return {viewer,teams,projects,states,readOnly:true,complete:teams.complete===true&&projectPage.complete===true&&statesComplete,cursor:null};
    });
  }
  // The same backlog as the GraphQL client, filtered here: the MCP list has no "no project" filter.
  async backlog({teamId,refresh=false}={}){
    const data=await this.list({teamId:text(teamId,'teamId',200),refresh});
    return {...data,issues:data.issues.filter(i=>!i.project&&i.state?.type==='backlog')};
  }
  async forgetBacklog(){}
  async mutate(){fail('LINEAR_READ_ONLY','This Linear MCP connection is read-only. No mutation was sent.');}
  async create(){fail('LINEAR_READ_ONLY','This Linear MCP connection is read-only. No issue was created.');}
}

function normalizeIssue(issue){
  const priority=typeof issue.priority==='object'&&issue.priority!==null?issue.priority.value:issue.priority;
  const relation=(value,id)=>value&&typeof value==='object'?{...value,id:id??value.id}:value?{id:id??null,name:String(value)}:null;
  return {...issue,id:issue.uuid??issue.id,identifier:issue.identifier??issue.id,
    parentId:typeof issue.parentId==='string'?issue.parentId:null,blocks:0,blockedBy:0,
    priority:Number.isInteger(priority)?priority:0,priorityLabel:issue.priority?.name??issue.priorityLabel??'',
    branchName:issue.gitBranchName??issue.branchName??null,
    state:typeof issue.status==='object'?issue.status:{id:null,name:issue.status??'Unknown',type:issue.statusType??'unknown'},
    team:relation(issue.team,issue.teamId),project:relation(issue.project,issue.projectId),assignee:relation(issue.assignee,issue.assigneeId),
    // The connection returns the labels of a ticket whole, or not at all.
    labels:(issue.labels??[]).map(l=>typeof l==='string'?{name:l}:l),labelsComplete:Array.isArray(issue.labels),comments:issue.comments??[]};
}
