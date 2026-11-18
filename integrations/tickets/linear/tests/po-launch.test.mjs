import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LinearClient } from '../linear.mjs';
import { poFolder, poPrompt, PO_PROMPT_LIMIT ,poSpace} from '../../../../src/po-launch.mjs';
import { fixture, issue, approveIssue } from '../../../../tests/helpers/backend-fixture.mjs';
import { poTool } from '../../../../src/agents.mjs';
import { createMissionRegistry } from '../../../../src/mission.mjs';

const response=data=>({ok:true,status:200,headers:new Headers(),json:async()=>data});
async function client(fetch) {return new LinearClient({root:await mkdtemp(join(tmpdir(),'fabrique-console-tracker-')),provider:{getToken:async()=>'secret-fixture'},fetch});}

test('the backlog of a team is read with the Tracker filter: no project, state of type backlog',async()=>{
  let filter;
  const c=await client(async(_url,options)=>{const body=JSON.parse(options.body);filter=body.variables.filter;return response({data:{issues:{nodes:[{id:'a',labels:{nodes:[],pageInfo:{hasNextPage:false}}}],pageInfo:{hasNextPage:false}}}});});
  const data=await c.backlog({teamId:'team-1'});
  assert.deepEqual(filter,{team:{id:{eq:'team-1'}},project:{null:true},state:{type:{eq:'backlog'}}});
  assert.deepEqual(data.issues.map(i=>i.id),['a']);assert.deepEqual(data.issues[0].labels,[]);
});

test('an issue is created in the team and in the state given, with the id chosen by the caller; a creation Tracker does not confirm (success false) is a failure',async()=>{
  let input;
  const c=await client(async(_url,options)=>{const body=JSON.parse(options.body);input=body.variables.input;return response({data:{issueCreate:{success:true,issue:{id:'n1',identifier:'XJ-900',title:input.title,team:{id:'team-1'}}}}});});
  const created=await c.create({teamId:'team-1',title:'Nouvelle issue',stateId:'st-backlog',id:'11111111-2222-4333-8444-555555555555'});
  assert.deepEqual(input,{teamId:'team-1',title:'Nouvelle issue',stateId:'st-backlog',id:'11111111-2222-4333-8444-555555555555'});assert.equal(created.issue.identifier,'XJ-900');
  const refused=await client(async()=>response({data:{issueCreate:{success:false}}}));
  await assert.rejects(()=>refused.create({teamId:'team-1',title:'x'}),e=>e.code==='LINEAR_MUTATION_FAILED');
});

test('the backlog kept for a team is forgotten after a write: the next read goes to Tracker',async()=>{
  let reads=0;
  const c=await client(async(_url,options)=>{const body=JSON.parse(options.body);if(body.query.includes('FabriqueConsoleBacklog')){reads++;return response({data:{issues:{nodes:[],pageInfo:{hasNextPage:false}}}});}return response({data:{issueCreate:{success:true,issue:{id:'n1'}}}});});
  await c.backlog({teamId:'team-1'});assert.equal((await c.backlog({teamId:'team-1'})).cached,true);assert.equal(reads,1);
  await c.forgetBacklog('team-1');
  assert.equal((await c.backlog({teamId:'team-1'})).cached,false);assert.equal(reads,2);
});

test('the PO works from the repository of the project, or from the one folder that holds its repositories',()=>{
  assert.equal(poFolder({repo:'/x/alpha/admin'}),'/x/alpha/admin');
  assert.equal(poFolder({repos:[{path:'/x/alpha/admin'},{path:'/x/alpha/app'}]}),'/x/alpha');
  assert.equal(poFolder({repos:[{path:'/x/alpha/admin'}]}),'/x/alpha/admin');
  assert.throws(()=>poFolder({repos:[{path:'/x/a/admin'},{path:'/y/b/app'}]}),e=>e.code==='PO_FOLDER_UNAVAILABLE');
  assert.throws(()=>poFolder({repos:[]}),e=>e.code==='PO_FOLDER_UNAVAILABLE');
});

test('the prompt is the role, the context, then the issue as escaped data; too long is refused',()=>{
  const prompt=poPrompt({role:'# Rôle\nRègles.',issue:{id:'i1',title:'Titre <script>'},project:{key:'alpha',name:'Alpha'},folder:'/x/alpha',resumed:false});
  assert.ok(prompt.startsWith('# Rôle\nRègles.\n\nPropriétaire configuré'));assert.match(prompt,/## Contexte de lancement/);
  assert.ok(prompt.includes('Team : Alpha. Dossier de travail : /x/alpha'));
  assert.ok(prompt.includes('<ticket-data-untrusted>\n'));assert.ok(!prompt.includes('<script>'));assert.ok(prompt.includes('\\u003cscript\\u003e'));
  assert.ok(prompt.includes('Commence par l\'étape 1'));
  assert.ok(poPrompt({role:'r',issue:{},project:{key:'k'},folder:'/f',resumed:true}).includes('Reprise'));
  // The commands of the session run as written in a shell: the Node of the backend and the path of the CLI quoted.
  const withCommands=poPrompt({role:'r',issue:{},project:{key:'k'},folder:'/f',resumed:false,sessionId:'s-1',cli:"/repo with spaces/it's/cli.mjs",node:'/opt/node bin/node'});
  assert.ok(withCommands.includes(`'/opt/node bin/node' '/repo with spaces/it'\\''s/cli.mjs' po-ask '{"sessionId":"s-1","id":"q-1"`),withCommands);
  assert.ok(withCommands.includes(`'/opt/node bin/node' '/repo with spaces/it'\\''s/cli.mjs' po-ready '{"sessionId":"s-1"}'`));
  assert.ok(withCommands.includes(`'/opt/node bin/node' '/repo with spaces/it'\\''s/cli.mjs' po-step '{"sessionId":"s-1","step":"plan"}'`));
  assert.throws(()=>poPrompt({role:'r'.repeat(PO_PROMPT_LIMIT),issue:{},project:{key:'k'},folder:'/f'}),e=>e.code==='PO_PROMPT_TOO_LARGE');
});

// The fixture project gets the team of the fixture issue, as the Issues page needs.
async function teamFixture(t) {
  // Its missions are the ones its tests make; the launch of before approves one where it needs it.
  const f=await fixture(t,{approved:false});
  await f.write('config.json',{...f.config,projects:[{...f.config.projects[0],teamId:'characterization-team'}]});
  f.tracker.backlog=async(...args)=>{f.trackerCalls.push(['backlog',...args]);return {issues:[{...issue,createdAt:'2026-01-01T00:00:00Z'},{...issue,id:'newer',identifier:'CHAR-8',createdAt:'2026-02-01T00:00:00Z'}],cached:false,updatedAt:'2026-03-01T00:00:00Z'};};
  f.tracker.create=async(...args)=>{f.trackerCalls.push(['create',...args]);return {success:true,issue:{...issue,id:'created',identifier:'CHAR-9',title:args[0].title}};};
  f.tracker.meta=async()=>({states:[{id:'st-backlog',type:'backlog',team:{id:'characterization-team'}},{id:'st-canceled',type:'canceled',team:{id:'characterization-team'}},{id:'other-backlog',type:'backlog',team:{id:'other'}}]});
  return f;
}

test('ticket-backlog reads the team of the configured project and sorts newest first; a project without team is refused',async t=>{
  const f=await teamFixture(t);
  const data=await f.backend.dispatch('ticket-backlog',{key:'example'});
  assert.deepEqual(data.issues.map(i=>i.identifier),['CHAR-8','CHAR-7']);assert.equal(data.teamId,'characterization-team');
  assert.deepEqual(f.trackerCalls.at(-1),['backlog',{teamId:'characterization-team',refresh:false}]);
  await assert.rejects(()=>f.backend.dispatch('ticket-backlog',{key:'absent'}),e=>e.code==='NOT_FOUND');
  await f.write('config.json',f.config);
  await assert.rejects(()=>f.backend.dispatch('ticket-backlog',{key:'example'}),e=>e.code==='TEAM_NOT_CONFIGURED');
});

const OP='0b5f3b1e-7c2d-4e8a-9f10-2a3b4c5d6e7f',OP2='1c6a4c2f-8d3e-4f9b-8a21-3b4c5d6e7f80';
test('ticket-create needs confirmation and an operation id, picks the backlog state of the team, and journals the creation under that id',async t=>{
  const f=await teamFixture(t);
  await assert.rejects(()=>f.backend.dispatch('ticket-create',{key:'example',title:'Sans confirmation',operationId:OP}),e=>e.code==='CONFIRMATION_REQUIRED');
  await assert.rejects(()=>f.backend.dispatch('ticket-create',{key:'example',title:'   ',operationId:OP,confirmed:true}),e=>e.code==='INVALID_ARGUMENT');
  await assert.rejects(()=>f.backend.dispatch('ticket-create',{key:'example',title:'Sans opération',confirmed:true}),e=>e.code==='INVALID_ARGUMENT');
  await assert.rejects(()=>f.backend.dispatch('ticket-create',{key:'example',title:'Opération invalide',operationId:'not-a-uuid',confirmed:true}),e=>e.code==='INVALID_ARGUMENT');
  const {issue:created}=await f.backend.dispatch('ticket-create',{key:'example',title:'Payer les compétitions',operationId:OP,confirmed:true});
  assert.equal(created.identifier,'CHAR-9');
  const call=f.trackerCalls.at(-1);
  assert.equal(call[0],'create');assert.match(call[1].id,/^[0-9a-f-]{36}$/);
  assert.deepEqual({...call[1],id:undefined},{teamId:'characterization-team',title:'Payer les compétitions',stateId:'st-backlog',id:undefined});
  const journal=JSON.parse(await readFile(join(f.home,'mutations','create-'+OP+'.json'),'utf8'));
  assert.equal(journal.status,'applied');assert.equal(journal.issueId,'created');assert.equal(journal.kind,'issue-create');assert.equal(journal.operationId,OP);
  // The same title under another operation is a second issue; the same operation again is the same issue, read back.
  await f.backend.dispatch('ticket-create',{key:'example',title:'Payer les compétitions',operationId:OP2,confirmed:true});
  assert.equal((await readdir(join(f.home,'mutations'))).filter(n=>n.startsWith('create-')).length,2);
  f.tracker.detail=async id=>({issue:{...issue,id,identifier:'CHAR-9-AGAIN'}});
  const replay=await f.backend.dispatch('ticket-create',{key:'example',title:'Payer les compétitions',operationId:OP,confirmed:true});
  assert.equal(replay.replayed,true);assert.equal(replay.issue.identifier,'CHAR-9-AGAIN');
  assert.equal(f.trackerCalls.filter(c=>c[0]==='create').length,2);
  // An operation id never names two different creations.
  await assert.rejects(()=>f.backend.dispatch('ticket-create',{key:'example',title:'Autre titre',operationId:OP,confirmed:true}),e=>e.code==='INVALID_ARGUMENT');
});

test('a lost answer to a creation is reconciled by the id chosen before the call, never by a second creation',async t=>{
  const f=await teamFixture(t);
  const remote=new Map();let lose=true;
  f.tracker.create=async payload=>{f.trackerCalls.push(['create',payload]);remote.set(payload.id,{...issue,id:payload.id,identifier:'CHAR-10',title:payload.title});if(lose)throw new Error('socket closed');return {success:true,issue:remote.get(payload.id)};};
  f.tracker.detail=async id=>{if(!remote.has(id)){const e=new Error('not found');e.code='LINEAR_API';throw e;}return {issue:remote.get(id)};};
  await assert.rejects(()=>f.backend.dispatch('ticket-create',{key:'example',title:'Réponse perdue',operationId:OP,confirmed:true}));
  const first=JSON.parse(await readFile(join(f.home,'mutations','create-'+OP+'.json'),'utf8'));
  assert.equal(first.status,'uncertain');assert.ok(first.issueId);
  // The retry of the same submission finds the issue The tracker did create: one issue, read back, no second create.
  lose=false;
  const again=await f.backend.dispatch('ticket-create',{key:'example',title:'Réponse perdue',operationId:OP,confirmed:true});
  assert.equal(again.replayed,true);assert.equal(again.issue.id,first.issueId);assert.equal(remote.size,1);
  assert.equal(f.trackerCalls.filter(c=>c[0]==='create').length,1);
  assert.equal(JSON.parse(await readFile(join(f.home,'mutations','create-'+OP+'.json'),'utf8')).status,'applied');
  // Lost before Tracker created anything: the retry creates it, with the same id.
  remote.clear();lose=true;
  await assert.rejects(()=>f.backend.dispatch('ticket-create',{key:'example',title:'Jamais créée',operationId:OP2,confirmed:true}));
  remote.clear();lose=false;
  const made=await f.backend.dispatch('ticket-create',{key:'example',title:'Jamais créée',operationId:OP2,confirmed:true});
  assert.equal(made.replayed,undefined);assert.equal(remote.size,1);
  const creates=f.trackerCalls.filter(c=>c[0]==='create');assert.equal(creates.length,3);assert.equal(creates[1][1].id,creates[2][1].id);
});

test('po-launch starts the PO with the tool of the config (the project\'s preference, Codex here), the role and the escaped issue in the project folder, labelled as the PO of the issue',async t=>{
  const f=await teamFixture(t);
  await assert.rejects(()=>f.backend.dispatch('po-launch',{key:'example',issueId:issue.id}),e=>e.code==='CONFIRMATION_REQUIRED');
  const {session,reused}=await f.backend.dispatch('po-launch',{key:'example',issueId:issue.id,confirmed:true});
  assert.equal(reused,false);assert.equal(session.role,'po');assert.equal(session.tool,'codex');assert.equal(session.worktree,null);assert.equal(session.terminalId,'t1');assert.equal(session.repo,f.repo);
  const run=f.calls.find(c=>c.args[0]==='run');
  const labels=Object.fromEntries(run.args.flatMap((a,n)=>a==='--label'?[run.args[n+1].split(/=(.*)/s).slice(0,2)]:[]));
  assert.equal(labels['fabrique-console.role'],'po');assert.equal(labels['fabrique-console.session'],session.id);assert.equal(labels['fabrique-console.issue'],issue.id);assert.equal(labels['herdr.space'],'fabrique-console-example-char-7');assert.equal(poSpace({key:'k'},{identifier:'not an id'},{id:'s-1'}),'fabrique-console-k-s-1');assert.equal(labels['herdr.tab'],'fabrique-console-'+session.id);
  assert.equal(run.args[run.args.indexOf('--cwd')+1],f.repo);
  const dash=run.args.indexOf('--');assert.deepEqual(run.args.slice(dash+1,dash+5),['codex','--no-daemon','-c','shell_environment_policy.set.FABRIQUE_CONSOLE_AGENT="1"'],'the agents table builds the argv, marked');
  // Traced (M12): the key of its trace for its commands, between its mark and its prompt.
  assert.equal(run.args[dash+5],'-c');assert.match(run.args[dash+6],/^shell_environment_policy\.set\.FABRIQUE_CONSOLE_TRACE="[0-9a-f-]{36}"$/);
  // The Lead of the issue carries the role mark of the Lead (M10 review), after the key of its trace.
  assert.deepEqual(run.args.slice(dash+7,dash+9),['-c','shell_environment_policy.set.FABRIQUE_CONSOLE_ROLE="lead"']);
  const prompt=run.args.at(-1);
  assert.ok(prompt.startsWith('# Rôle : PO'));assert.ok(prompt.includes('<ticket-data-untrusted>'));assert.ok(prompt.includes('Untrusted \\u003cexternal\\u003e text'));assert.ok(!prompt.includes('<external>'));
  // The issue was reread at launch, never taken from the screen.
  assert.ok(f.trackerCalls.some(c=>c[0]==='detail'&&c[1]===issue.id&&c[2]?.refresh===true));
  const state=await f.read('state.json');
  assert.equal(state.sessions.length,1);assert.equal(state.sessions[0].launchUncertain,false);
  // A live PO terminal is reused: no second launch.
  const again=await f.backend.dispatch('po-launch',{key:'example',issueId:issue.id,confirmed:true});
  assert.equal(again.reused,true);assert.equal(again.session.id,session.id);assert.equal(f.calls.filter(c=>c.args[0]==='run').length,1);
  // The snapshot lists the PO session with its observed status.
  const snap=await f.backend.dispatch('snapshot',{});
  assert.equal(snap.sessions[0].role,'po');assert.equal(snap.sessions[0].status,'working');
});

test('po-launch refuses an issue of another team, and relaunches the same PO when its terminal is gone',async t=>{
  const f=await teamFixture(t);
  f.tracker.detail=async()=>({issue:{...issue,team:{id:'another-team'}}});
  await assert.rejects(()=>f.backend.dispatch('po-launch',{key:'example',issueId:issue.id,confirmed:true}),e=>e.code==='ISSUE_NOT_IN_TEAM');
  assert.equal((await f.read('state.json').catch(()=>({sessions:[]}))).sessions.length,0);
  f.tracker.detail=async()=>({issue});
  const first=await f.backend.dispatch('po-launch',{key:'example',issueId:issue.id,confirmed:true});
  f.setTerminals([]);
  const second=await f.backend.dispatch('po-launch',{key:'example',issueId:issue.id,confirmed:true});
  assert.equal(second.reused,false);assert.equal(second.session.id,first.session.id);assert.equal(second.session.terminalId,'t2');
  const runs=f.calls.filter(c=>c.args[0]==='run');assert.equal(runs.length,2);
  assert.ok(runs[1].args.at(-1).includes('Cette session reprend un travail commencé'));
});

test('ticket-my-issues groups the issues of every team by Tracker project: open ones listed in state order, the rest counted; an unreadable team keeps its place',async t=>{
  const f=await teamFixture(t);
  await f.write('config.json',{...f.config,projects:[{...f.config.projects[0],teamId:'characterization-team'},{...f.config.projects[0],key:'other',name:'Other',teamId:'other-team'}]});
  const mk=(id,type,name,project,extra={})=>({...issue,id,identifier:'CHAR-'+id,title:'T'+id,updatedAt:'2026-01-'+String(id).padStart(2,'0')+'T00:00:00Z',labels:[{id:'l',name:'Chore',color:'#abcdef'}],state:{id:'s-'+type,name,type},project:project?{id:project,name:'Project '+project}:null,...extra});
  f.tracker.list=async({teamId,refresh})=>{
    f.trackerCalls.push(['list',teamId,refresh]);
    if(teamId==='other-team'){const e=new Error('Tracker returned a GraphQL error.');e.code='LINEAR_API';throw e;}
    return {issues:[mk(1,'backlog','Backlog','B'),mk(2,'completed','Done','A'),mk(3,'started','In Progress','A'),mk(4,'backlog','Backlog',null),mk(5,'unstarted','Todo','A'),mk(6,'canceled','Canceled','A'),mk(10,'backlog','Backlog','A')],cached:true,updatedAt:'2026-03-01T00:00:00Z'};
  };
  const data=await f.backend.dispatch('ticket-my-issues',{});
  assert.equal(data.cached,true);assert.equal(data.updatedAt,'2026-03-01T00:00:00Z');
  assert.deepEqual(data.teams.map(t=>[t.key,t.error?.code||null,t.projects.map(p=>p.name)]),[['example',null,['Project A','Project B']],['other','TICKET_API',[]]]);
  const a=data.teams[0].projects[0];
  assert.deepEqual(a.counts,{completed:1,started:1,unstarted:1,canceled:1,backlog:1});assert.equal(a.total,5);
  assert.deepEqual(a.states,[{name:'In Progress',type:'started',count:1},{name:'Todo',type:'unstarted',count:1},{name:'Backlog',type:'backlog',count:1},{name:'Done',type:'completed',count:1},{name:'Canceled',type:'canceled',count:1}]);
  assert.deepEqual(a.issues.map(i=>i.identifier),['CHAR-3','CHAR-5','CHAR-10','CHAR-2','CHAR-6']);
  assert.deepEqual(Object.keys(a.issues[0]).sort(),['assignee','blockedBy','blocks','createdAt','id','identifier','labels','parentId','priority','state','title','updatedAt','url']);
  assert.deepEqual([a.issues[0].parentId,a.issues[0].blocks,a.issues[0].blockedBy],[null,0,0]);
  assert.equal(data.relations,'none');
  assert.deepEqual(a.issues[0].labels,[{name:'Chore',color:'#abcdef'}]);
  // The activity: every issue of the readable teams, the last updated first, with its team and project.
  assert.deepEqual(data.activity.map(i=>i.identifier),['CHAR-10','CHAR-6','CHAR-5','CHAR-4','CHAR-3','CHAR-2','CHAR-1']);
  assert.deepEqual(data.activity[3].project,null);assert.equal(data.activity[0].team.key,'example');
  await f.backend.dispatch('ticket-my-issues',{refresh:true});
  assert.deepEqual(f.trackerCalls.filter(c=>c[0]==='list').map(c=>c[2]),[false,false,true,true]);
  await assert.rejects(()=>f.backend.dispatch('ticket-my-issues',{refresh:'yes'}),e=>e.code==='INVALID_ARGUMENT');
});

test('an identical creation left uncertain by an earlier screen is offered before a new one starts: resumed, or another issue on purpose',async t=>{
  const f=await teamFixture(t);
  const remote=new Map();let lose=true;
  f.tracker.create=async payload=>{f.trackerCalls.push(['create',payload]);remote.set(payload.id,{...issue,id:payload.id,identifier:'CHAR-'+remote.size,title:payload.title});if(lose)throw new Error('socket closed');return {success:true,issue:remote.get(payload.id)};};
  f.tracker.detail=async id=>{if(!remote.has(id)){const e=new Error('not found');e.code='LINEAR_API';throw e;}return {issue:remote.get(id)};};
  await assert.rejects(()=>f.backend.dispatch('ticket-create',{key:'example',title:'Même titre',operationId:OP,confirmed:true}));
  lose=false;
  // A new screen, a new operation id, the same title: nothing is sent, the uncertain operation is named.
  const offered=await f.backend.dispatch('ticket-create',{key:'example',title:'Même titre',operationId:OP2,confirmed:true});
  assert.equal(offered.issue,null);assert.equal(offered.pending.operationId,OP);assert.equal(offered.pending.title,'Même titre');
  assert.equal(f.trackerCalls.filter(c=>c[0]==='create').length,1);assert.equal(remote.size,1);
  // Resumed: the issue Tracker created is found, no second one.
  const resumed=await f.backend.dispatch('ticket-create',{key:'example',title:'Même titre',operationId:OP,confirmed:true});
  assert.equal(resumed.replayed,true);assert.equal(remote.size,1);
  // Another one on purpose: a second issue, under its own operation; a different title never asks.
  const other=await f.backend.dispatch('ticket-create',{key:'example',title:'Même titre',operationId:OP2,another:true,confirmed:true});
  assert.ok(other.issue);assert.equal(remote.size,2);
  const third=await f.backend.dispatch('ticket-create',{key:'example',title:'Autre titre',operationId:'2d7b5d30-9e4f-4a0c-9b32-4c5d6e7f8091',confirmed:true});
  assert.ok(third.issue);assert.equal(remote.size,3);
});

test('the journal of creations: a temporary file of an interrupted write is ignored, a corrupt journal or an unreadable folder refuses the creation',async t=>{
  const f=await teamFixture(t);
  const {mkdir,writeFile,chmod,rm}=await import('node:fs/promises');
  const folder=join(f.home,'mutations');await mkdir(folder,{recursive:true});
  await writeFile(join(folder,'create-'+OP+'.json.deadbeef.tmp'),'{"kind":"issue-cre');
  const made=await f.backend.dispatch('ticket-create',{key:'example',title:'Après un temporaire',operationId:OP2,confirmed:true});
  assert.ok(made.issue);
  await writeFile(join(folder,'create-'+OP+'.json'),'{not json');
  await assert.rejects(()=>f.backend.dispatch('ticket-create',{key:'example',title:'Journal corrompu',operationId:'3e8c6e41-af50-4b1d-8c43-5d6e7f809102',confirmed:true}),e=>e.code==='INVALID_DATA');
  await rm(join(folder,'create-'+OP+'.json'));
  if(process.getuid?.()!==0) {
    await chmod(folder,0o300);
    try{await assert.rejects(()=>f.backend.dispatch('ticket-create',{key:'example',title:'Dossier illisible',operationId:'4f9d7f52-b061-4c2e-9d54-6e7f80910213',confirmed:true}),e=>e.code==='MUTATION_JOURNAL_UNREADABLE');}
    finally{await chmod(folder,0o700);}
  }
  assert.equal(f.trackerCalls.filter(c=>c[0]==='create').length,1);
});

test('the delivery of the role is read from the terminal found again when the launch answer was lost',async t=>{
  const f=await teamFixture(t);
  f.undeliverFirstMessage(true);f.loseLaunchResponse(true);
  await assert.rejects(()=>f.backend.dispatch('po-launch',{key:'example',issueId:issue.id,confirmed:true}),e=>e.code==='LAUNCH_UNCERTAIN');
  f.loseLaunchResponse(false);
  const found=await f.backend.dispatch('po-launch',{key:'example',issueId:issue.id,confirmed:true});
  assert.equal(found.reused,true);assert.ok(found.warning);assert.equal((await f.read('state.json')).sessions[0].firstMessageSent,false);
  f.setTerminals([]);
  await assert.rejects(()=>f.backend.dispatch('po-launch',{key:'example',issueId:issue.id,confirmed:true}),e=>e.code==='PO_PROMPT_UNDELIVERED');
  assert.equal(f.calls.filter(c=>c.args[0]==='run').length,1);
});

test('ticket-backlog with all reads every issue of the configured team, never a list without team',async t=>{
  const f=await teamFixture(t);
  f.tracker.list=async(...args)=>{f.trackerCalls.push(['list',...args]);return {issues:[{...issue,createdAt:'2026-01-01T00:00:00Z'},{...issue,id:'n',identifier:'CHAR-9',createdAt:'2026-02-01T00:00:00Z'}],cached:false,updatedAt:'2026-03-01T00:00:00Z'};};
  const data=await f.backend.dispatch('ticket-backlog',{key:'example',all:true,refresh:true});
  assert.deepEqual(data.issues.map(i=>i.identifier),['CHAR-9','CHAR-7']);
  // Each issue as a list shows it: no description, no comments (a team of seven hundred weighs a megabyte whole).
  assert.equal(data.issues[1].description,undefined);assert.equal(data.issues[1].comments,undefined);
  assert.deepEqual(Object.keys(data.issues[1]).sort(),['blockedBy','blocks','createdAt','id','identifier','labels','parentId','priority','project','state','title','updatedAt']);
  assert.deepEqual(data.issues[1].state,{name:'Todo',type:'unstarted'});
  assert.deepEqual(f.trackerCalls.at(-1),['list',{teamId:'characterization-team',refresh:true}]);
  await assert.rejects(()=>f.backend.dispatch('ticket-backlog',{key:'example',all:'yes'}),e=>e.code==='INVALID_ARGUMENT');
  await f.write('config.json',f.config);
  await assert.rejects(()=>f.backend.dispatch('ticket-backlog',{key:'example',all:true}),e=>e.code==='TEAM_NOT_CONFIGURED');
});

test('a prompt too long refuses the launch before any intent is written: the issue, once shortened, launches',async t=>{
  const f=await teamFixture(t);
  f.tracker.detail=async()=>({issue:{...issue,description:'x'.repeat(PO_PROMPT_LIMIT)}});
  await assert.rejects(()=>f.backend.dispatch('po-launch',{key:'example',issueId:issue.id,confirmed:true}),e=>e.code==='PO_PROMPT_TOO_LARGE');
  assert.equal((await f.read('state.json').catch(()=>({sessions:[]}))).sessions.length,0);
  assert.equal(f.calls.filter(c=>c.args[0]==='run').length,0);
  f.tracker.detail=async()=>({issue});
  const {reused}=await f.backend.dispatch('po-launch',{key:'example',issueId:issue.id,confirmed:true});
  assert.equal(reused,false);assert.equal(f.calls.filter(c=>c.args[0]==='run').length,1);
});

test('a PO whose role was not delivered stays so until stopped: reused with the warning, never relaunched blindly',async t=>{
  const f=await teamFixture(t);
  f.undeliverFirstMessage(true);
  const first=await f.backend.dispatch('po-launch',{key:'example',issueId:issue.id,confirmed:true});
  assert.equal(first.session.firstMessageSent,false);assert.ok(first.warning);
  const again=await f.backend.dispatch('po-launch',{key:'example',issueId:issue.id,confirmed:true});
  assert.equal(again.reused,true);assert.ok(again.warning);
  assert.equal((await f.read('state.json')).sessions[0].firstMessageSent,false);
  // Its terminal gone, the session is not resumed: the role never reached it.
  f.setTerminals([]);
  await assert.rejects(()=>f.backend.dispatch('po-launch',{key:'example',issueId:issue.id,confirmed:true}),e=>e.code==='PO_PROMPT_UNDELIVERED');
  assert.equal(f.calls.filter(c=>c.args[0]==='run').length,1);
  // Stopped on purpose, it is over: the next launch is a new PO, with its role delivered this time.
  await f.backend.dispatch('stop',{sessionId:first.session.id,confirmed:true});
  f.undeliverFirstMessage(false);
  const fresh=await f.backend.dispatch('po-launch',{key:'example',issueId:issue.id,confirmed:true});
  assert.equal(fresh.reused,false);assert.notEqual(fresh.session.id,first.session.id);assert.equal(fresh.session.firstMessageSent,true);assert.equal(fresh.warning,undefined);
  assert.equal((await f.read('state.json')).sessions.length,2);
});

test('a terminal whose labels contradict the session, or several terminals for one session, are a local inconsistency',async t=>{
  const f=await teamFixture(t);
  const {session}=await f.backend.dispatch('po-launch',{key:'example',issueId:issue.id,confirmed:true});
  const own={'fabrique-console.app':'fabrique-console','fabrique-console.session':session.id};
  f.setTerminals([{id:'t1',labels:{...own,'fabrique-console.role':'dev','fabrique-console.issue':issue.id},state:'live',reported:true,status:'working'}]);
  await assert.rejects(()=>f.backend.dispatch('po-launch',{key:'example',issueId:issue.id,confirmed:true}),e=>e.code==='TERMINAL_OWNERSHIP');
  f.setTerminals([{id:'t1',labels:{...own,'fabrique-console.role':'po','fabrique-console.issue':'other'},state:'live',reported:true,status:'working'}]);
  await assert.rejects(()=>f.backend.dispatch('po-launch',{key:'example',issueId:issue.id,confirmed:true}),e=>e.code==='TERMINAL_OWNERSHIP');
  f.setTerminals([{id:'t1',labels:own,state:'live',reported:true,status:'working'},{id:'t9',labels:own,state:'live',reported:true,status:'working'}]);
  await assert.rejects(()=>f.backend.dispatch('po-launch',{key:'example',issueId:issue.id,confirmed:true}),e=>e.code==='TERMINAL_OWNERSHIP');
  assert.equal(f.calls.filter(c=>c.args[0]==='run').length,1);
});

test('a PO session is never taken for a development session by the legacy launch',async t=>{
  const f=await teamFixture(t);
  await f.backend.dispatch('po-launch',{key:'example',issueId:issue.id,confirmed:true});await approveIssue(f.home);
  const {session,reused}=await f.backend.dispatch('launch',{issueId:issue.id,tool:'claude'});
  assert.equal(reused,false);assert.equal(session.role,undefined);assert.ok(session.worktree);
  assert.equal((await f.read('state.json')).sessions.length,2);
});

test('the tool of a PO comes from the project of the config; a PO found again keeps its tool; a stopped one takes the current preference',async t=>{
  const f=await teamFixture(t);
  const project={...f.config.projects[0],teamId:'characterization-team',preferredAgent:'claude'};
  await f.write('config.json',{...f.config,projects:[project]});
  const first=await f.backend.dispatch('po-launch',{key:'example',issueId:issue.id,confirmed:true});
  assert.equal(first.session.tool,'claude');
  const run=f.calls.find(c=>c.args[0]==='run'),dash=run.args.indexOf('--');assert.equal(run.args[dash+1],'claude');
  await f.write('config.json',{...f.config,projects:[{...project,preferredAgent:'codex'}]});
  const again=await f.backend.dispatch('po-launch',{key:'example',issueId:issue.id,confirmed:true});
  assert.equal(again.reused,true);assert.equal(again.session.tool,'claude','a PO found again keeps its tool');
  await f.backend.dispatch('stop',{sessionId:first.session.id,confirmed:true});
  const next=await f.backend.dispatch('po-launch',{key:'example',issueId:issue.id,confirmed:true});
  assert.equal(next.reused,false);assert.equal(next.session.tool,'codex');
  const last=f.calls.filter(c=>c.args[0]==='run').at(-1);assert.deepEqual(last.args.slice(last.args.indexOf('--')+1,last.args.indexOf('--')+3),['codex','--no-daemon']);
  assert.equal(poTool({preferredAgent:'codex'},{}),'codex');assert.equal(poTool({},{}),'claude');assert.equal(poTool({preferredAgent:'codex'},{preferredAgent:'claude'}),'claude');
  // A PO from before the tools were recorded: the tool of its relaunch is recorded, and kept at the next one.
  const state=await f.read('state.json');
  const old=state.sessions.find(s=>s.id===next.session.id);delete old.tool;await f.write('state.json',state);
  f.setTerminals([]);
  const relaunched=await f.backend.dispatch('po-launch',{key:'example',issueId:issue.id,confirmed:true});
  assert.equal(relaunched.session.id,next.session.id);assert.equal(relaunched.session.tool,'codex');
  assert.equal((await f.read('state.json')).sessions.find(s=>s.id===next.session.id).tool,'codex','the tool run is recorded');
  await f.write('config.json',{...f.config,projects:[{...project,preferredAgent:'claude'}]});
  f.setTerminals([]);
  const kept=await f.backend.dispatch('po-launch',{key:'example',issueId:issue.id,confirmed:true});
  assert.equal(kept.session.tool,'codex','and kept when the preference changes');
  const lastRun=f.calls.filter(c=>c.args[0]==='run').at(-1);assert.equal(lastRun.args[lastRun.args.indexOf('--')+1],'codex');
});

test('agent-start starts the general assistant of a tool in the agent space, named for hc, and refuses another tool',async t=>{
  const f=await fixture(t,{approved:false});
  const {terminalId,tool}=await f.backend.dispatch('agent-start',{tool:'codex'});
  assert.equal(tool,'codex');assert.match(terminalId,/^t\d+$/);
  const run=f.calls.find(c=>c.args[0]==='run');
  assert.equal(run.args[run.args.indexOf('--name')+1],'fabrique-console-agent-codex');
  const labels=Object.fromEntries(run.args.flatMap((a,n)=>a==='--label'?[run.args[n+1].split(/=(.*)/s).slice(0,2)]:[]));
  assert.deepEqual(labels,{'herdr.space':'fabrique-console-agent','herdr.tab':'fabrique-console-agent-codex','fabrique-console.app':'fabrique-console','fabrique-console.role':'agent','fabrique-console.tool':'codex'});
  const traced=run.args.slice(run.args.indexOf('--')+1);
  assert.deepEqual(traced.slice(0,5),['codex','--no-daemon','-c','shell_environment_policy.set.FABRIQUE_CONSOLE_AGENT="1"','-c'],'no prompt: the assistant starts empty');
  assert.equal(traced.length,6);assert.match(traced[5],/^shell_environment_policy\.set\.FABRIQUE_CONSOLE_TRACE="[0-9a-f-]{36}"$/,'traced (M12)');
  for(const tool of ['rm -rf',undefined,'claude; x'])await assert.rejects(()=>f.backend.dispatch('agent-start',{tool}),e=>e.code==='INVALID_ARGUMENT');
  f.loseLaunchResponse(true);
  await assert.rejects(()=>f.backend.dispatch('agent-start',{tool:'claude'}),e=>e.code==='LAUNCH_UNCERTAIN');
});

test('lead-launch makes the mission and its Lead: the demand and the commands of the mission are in the first message',async t=>{
  const f=await teamFixture(t);
  const out=await f.backend.dispatch('lead-launch',{project:'example',issueId:issue.id,request:'Permettre de <payer>'});
  assert.equal(out.mission.id,'M-1');assert.equal(out.created,true);assert.equal(out.mission.step,'delegated');assert.equal(out.reused,false);
  assert.equal(out.session.role,'lead');assert.equal(out.session.missionId,'M-1');assert.equal(out.session.issueId,issue.id);assert.equal(out.mission.lead.sessionId,out.session.id);
  assert.equal(out.mission.issue.identifier,issue.identifier);
  const run=f.calls.filter(c=>c.args[0]==='run'),args=run[0].args,prompt=args.at(-1);
  assert.equal(run.length,1);
  assert.ok(args.includes('fabrique-console.role=lead'));assert.ok(args.includes('fabrique-console.mission=M-1'));assert.ok(args.includes('herdr.space=fabrique-console-example-char-7'));
  assert.ok(prompt.includes('Mission : M-1'));assert.ok(prompt.includes('Permettre de \\u003cpayer\\u003e'),prompt);assert.ok(!prompt.includes('<payer>'));
  for(const command of ['lead-request','lead-answer','lead-escalate','mission-read','mission-tldr'])assert.ok(prompt.includes(command),command);
  for(const old of ['po-ask','po-step','po-ready'])assert.ok(!prompt.includes(' '+old+' '),old);
  assert.ok(prompt.includes('<ticket-data-untrusted>'));assert.ok(prompt.includes(out.session.id)===false,'the Lead names its mission, not its session');
});

test('lead-launch from Pilot records where the user said to stop, and tells the Lead (chantier 1, point 16)',async t=>{
  const f=await teamFixture(t);
  await assert.rejects(()=>f.backend.dispatch('lead-launch',{project:'example',issueId:issue.id,request:'Demande',stopAfter:'qa'}),e=>e.code==='INVALID_ARGUMENT');
  const out=await f.backend.dispatch('lead-launch',{project:'example',issueId:issue.id,request:'Demande',stopAfter:'develop'});
  assert.equal(out.mission.stopAfter,'develop');
  const prompt=f.calls.filter(c=>c.args[0]==='run').at(-1).args.at(-1);
  assert.match(prompt,/fin de Develop/);
  // Once devs run, the limit changes from the page only (review 1 of 1A): Pilot is refused, nothing written.
  const missions=createMissionRegistry({root:f.home});
  await missions.setStep('M-1','building','devs');
  await assert.rejects(()=>f.backend.dispatch('lead-launch',{project:'example',issueId:issue.id,request:'Demande',stopAfter:'validate'}),e=>e.code==='MISSION_STARTED');
  assert.equal((await missions.read('M-1')).stopAfter,'develop');
});

test('lead-launch finds the Lead again while its terminal lives, and relaunches the same one with its folder when it is gone',async t=>{
  const f=await teamFixture(t);
  const first=await f.backend.dispatch('lead-launch',{project:'example',issueId:issue.id,request:'Demande'});
  const again=await f.backend.dispatch('lead-launch',{mission:'M-1'});
  assert.equal(again.reused,true);assert.equal(again.created,false);assert.equal(again.session.id,first.session.id);
  const same=await f.backend.dispatch('lead-launch',{project:'example',issueId:issue.id,request:'Autre demande'});
  assert.equal(same.mission.id,'M-1');assert.equal(same.mission.request,'Demande');assert.equal(same.reused,true,'an open mission is found, never made twice');
  assert.equal(f.calls.filter(c=>c.args[0]==='run').length,1);
  f.setTerminals([]);
  const back=await f.backend.dispatch('lead-launch',{mission:'M-1'});
  assert.equal(back.reused,false);assert.equal(back.session.id,first.session.id);
  const runs=f.calls.filter(c=>c.args[0]==='run');assert.equal(runs.length,2);
  assert.ok(runs[1].args.at(-1).includes('reprend'));assert.ok(runs[1].args.at(-1).includes('Demande'));
});

// Lot 1B (reviews 6 and 7): a rest marks the Lead, then closes its tab. A launch outside the lock of the rest, which
// takes up the terminal or opens another in that tab, keeps the mark: the next message wakes the Lead. Under the lock
// (a launch by mission, or the wake of a message), it is awake.
test('lead-launch by issue keeps the rest mark on a Lead terminal it takes up or opens again; under the lock, it clears it',async t=>{
  const f=await teamFixture(t);
  await f.backend.dispatch('lead-launch',{project:'example',issueId:issue.id,request:'Demande'});
  const missions=createMissionRegistry({root:f.home});
  await missions.update('M-1',m=>{m.lead={...m.lead,restedAt:'2026-11-16T10:00:00.000Z'};});
  const by=await f.backend.dispatch('lead-launch',{project:'example',issueId:issue.identifier,request:'Demande'});
  assert.equal(by.reused,true);
  assert.equal((await missions.read('M-1')).lead.restedAt,'2026-11-16T10:00:00.000Z','kept: the rest may be closing it');
  f.setTerminals([]);
  const opened=await f.backend.dispatch('lead-launch',{project:'example',issueId:issue.id,request:'Demande'});
  assert.equal(opened.reused,false,'a new terminal');
  assert.equal((await missions.read('M-1')).lead.restedAt,'2026-11-16T10:00:00.000Z','kept: the close may still be on its way');
  const named=await f.backend.dispatch('lead-launch',{mission:'M-1'});
  assert.equal(named.reused,true);
  assert.equal((await missions.read('M-1')).lead.restedAt,undefined);
});

test('lead-launch keeps the Lead a mission already has: a session of the first version is found again by its mission',async t=>{
  const f=await teamFixture(t);
  const {session}=await f.backend.dispatch('po-launch',{key:'example',issueId:issue.id,confirmed:true});
  const missions=createMissionRegistry({root:f.home});
  await missions.create({project:'example',issue:{id:issue.id,identifier:issue.identifier,title:issue.title,url:issue.url},request:null,lead:{sessionId:session.id,lastSeen:null},step:'building'});
  const out=await f.backend.dispatch('lead-launch',{mission:'M-1'});
  assert.equal(out.reused,true);assert.equal(out.session.id,session.id);assert.equal(out.mission.step,'building','a mission under way stays where it is');
});

// A PO of the first version at work on the issue: a worktree, and a chain that runs under its own name.
async function workingPo(f,fields={}) {
  const {session}=await f.backend.dispatch('po-launch',{key:'example',issueId:issue.id,confirmed:true});
  const state=JSON.parse(await readFile(join(f.home,'state.json'),'utf8'));
  Object.assign(state.sessions.find(s=>s.id===session.id),{worktree:'/wt-po',branch:'char-7',step:'dev',...fields});
  await f.write('state.json',state);
  await mkdir(join(f.home,'state'),{recursive:true});
  await f.write('state/devchain-'+session.id+'.json',{on:true,done:{'dev|CHAR-8':1},log:[],seen:{},paths:{},digest:[],digestAt:0});
  return session;
}

test('lead-launch after a PO was stopped mid-way starts where it was: its folder, its step, and it says so',async t=>{
  const f=await teamFixture(t),po=await workingPo(f,{step:'check',base:'release/x',stoppedAt:'2026-11-09T21:31:49.364Z'});
  const out=await f.backend.dispatch('lead-launch',{project:'example',issueId:issue.id,request:'Finir'});
  assert.equal(out.mission.step,'validating','not sent back to the start');assert.equal(out.mission.worktree,'/wt-po');assert.equal(out.mission.branch,'char-7');assert.equal(out.mission.base,'release/x');assert.equal(out.mission.resumedFrom,po.id);
  assert.notEqual(out.session.id,po.id);assert.equal(out.session.worktree,'/wt-po');assert.equal(out.session.base,'release/x');
  assert.match(f.calls.filter(c=>c.args[0]==='run').at(-1).args.at(-1),/reprend une mission commencée/);
});

test('a mission made first and given a Lead after takes up the stopped PO all the same',async t=>{
  const f=await teamFixture(t),po=await workingPo(f,{step:'check',base:'release/x',stoppedAt:'2026-11-09T21:31:49.364Z'});
  const made=await f.backend.dispatch('mission-create',{project:'example',issueId:issue.id,request:'Finir'});
  assert.equal(made.created,true);assert.equal(made.mission.step,'requested');
  const out=await f.backend.dispatch('lead-launch',{mission:made.mission.id});
  assert.equal(out.mission.step,'validating');assert.equal(out.mission.resumedFrom,po.id);assert.equal(out.mission.worktree,'/wt-po');assert.equal(out.session.worktree,'/wt-po');
});

test('a Lead launched after a PO that finished its work starts a mission of its own',async t=>{
  const f=await teamFixture(t);await workingPo(f,{step:'close',stoppedAt:'2026-11-09T21:31:49.364Z'});
  const out=await f.backend.dispatch('lead-launch',{project:'example',issueId:issue.id,request:'Autre chose'});
  assert.equal(out.mission.step,'delegated');assert.equal(out.mission.worktree,null);assert.equal(out.mission.resumedFrom??null,null);
});

test('lead-launch on an issue a PO is working on takes that PO and its chain up, instead of leaving them behind',async t=>{
  const f=await teamFixture(t),session=await workingPo(f);
  const out=await f.backend.dispatch('lead-launch',{project:'example',issueId:issue.id,request:'Reprendre'});
  assert.equal(out.session.id,session.id,'the PO, not a second Lead');assert.equal(out.reused,true);assert.equal(out.created,false);
  assert.equal(out.mission.adoptedFrom,session.id);assert.equal(out.mission.worktree,'/wt-po');assert.equal(out.mission.step,'building');
  assert.equal(out.mission.request,'Reprendre','the demand is kept');
  assert.equal(f.calls.filter(c=>c.args[0]==='run').length,1,'only the launch of the PO');
  assert.equal((await f.backend.dispatch('dev-chain-read',{sessionId:session.id})).on,true,'its chain is still walked');
});

test('mission-create on an issue a PO is working on gives back the mission of that PO',async t=>{
  const f=await teamFixture(t),session=await workingPo(f);
  const out=await f.backend.dispatch('mission-create',{project:'example',issueId:issue.id,request:'Autre'});
  assert.equal(out.created,false);assert.equal(out.code,'MISSION_OPEN');assert.equal(out.mission.adoptedFrom,session.id);
  assert.equal(out.mission.request,'Autre','the demand nobody had recorded is kept');
  assert.equal((await createMissionRegistry({root:f.home}).read('M-1')).request,'Autre','and it is written');
  const again=await f.backend.dispatch('mission-create',{project:'example',issueId:issue.id,request:'Encore une autre'});
  assert.equal(again.mission.request,'Autre','a demand already recorded stays');
  assert.equal((await f.backend.dispatch('lead-launch',{mission:'M-1'})).mission.request,'Autre');
});

test('a PO that is done leaves its issue free: a new demand makes a new mission and a new Lead',async t=>{
  const f=await teamFixture(t),session=await workingPo(f,{step:'close',readyAt:'2026-11-09T12:00:00.000Z'});
  const out=await f.backend.dispatch('lead-launch',{project:'example',issueId:issue.id,request:'Suite'});
  assert.equal(out.created,true);assert.notEqual(out.session.id,session.id);assert.equal(out.session.role,'lead');
  assert.equal(out.mission.adoptedFrom,null);
});

test('a Lead stopped and replaced takes up the folder of its mission, and is told it resumes',async t=>{
  const f=await teamFixture(t);
  const first=await f.backend.dispatch('lead-launch',{project:'example',issueId:issue.id,request:'Demande'});
  const state=JSON.parse(await readFile(join(f.home,'state.json'),'utf8'));
  Object.assign(state.sessions.find(s=>s.id===first.session.id),{worktree:'/wt-issue',branch:'char-7',mainBranch:'main',baseCommit:'abc',base:'release/x'});
  await f.write('state.json',state);
  await createMissionRegistry({root:f.home}).update('M-1',m=>{m.worktree='/wt-issue';m.branch='char-7';m.base='release/x';m.step='building';});
  await f.backend.dispatch('stop',{sessionId:first.session.id,confirmed:true});
  const out=await f.backend.dispatch('lead-launch',{mission:'M-1'});
  assert.notEqual(out.session.id,first.session.id,'a session stopped on purpose is over');assert.equal(out.reused,false);
  for(const [field,value] of Object.entries({worktree:'/wt-issue',branch:'char-7',mainBranch:'main',baseCommit:'abc',base:'release/x'}))assert.equal(out.session[field],value,field);
  assert.equal(out.mission.lead.sessionId,out.session.id);assert.equal(out.mission.step,'building');
  assert.ok(f.calls.filter(c=>c.args[0]==='run').at(-1).args.at(-1).includes('reprend'));
});

test('a Lead with no predecessor left takes its folder from the mission',async t=>{
  const f=await teamFixture(t),missions=createMissionRegistry({root:f.home});
  await missions.create({project:'example',issue:{id:issue.id,identifier:issue.identifier,title:issue.title,url:issue.url},request:'Demande',lead:{sessionId:'gone',lastSeen:null},worktree:'/wt-issue',branch:'char-7',base:'release/x',step:'building'});
  const out=await f.backend.dispatch('lead-launch',{mission:'M-1'});
  assert.equal(out.session.worktree,'/wt-issue');assert.equal(out.session.branch,'char-7');assert.equal(out.session.base,'release/x');
});

test('lead-launch refuses a mission without issue, a bad request, and an issue of another team',async t=>{
  const f=await teamFixture(t),launch=input=>f.backend.dispatch('lead-launch',input);
  await f.backend.dispatch('mission-create',{project:'example',request:'Sans issue'});
  await assert.rejects(()=>launch({mission:'M-1'}),e=>e.code==='MISSION_NO_ISSUE');
  await assert.rejects(()=>launch({mission:'M-9'}),e=>e.code==='NOT_FOUND');
  await assert.rejects(()=>launch({project:'example',issueId:issue.id}),e=>e.code==='INVALID_ARGUMENT');
  await assert.rejects(()=>launch({mission:'M-1',project:'example'}),e=>e.code==='INVALID_ARGUMENT');
  const detail=f.tracker.detail;f.tracker.detail=async()=>({issue:{...issue,team:{id:'other-team'}}});
  await assert.rejects(()=>launch({project:'example',issueId:issue.id,request:'r'}),e=>e.code==='ISSUE_NOT_IN_TEAM');
  f.tracker.detail=detail;
  assert.equal((await createMissionRegistry({root:f.home}).list()).length,1,'a refused issue makes no mission');
  assert.equal(f.calls.filter(c=>c.args[0]==='run').length,0);
});

test('a launch not confirmed leaves the mission to its session: it is said, not launched twice blindly',async t=>{
  const f=await teamFixture(t);
  f.loseLaunchResponse(true);
  await assert.rejects(()=>f.backend.dispatch('lead-launch',{project:'example',issueId:issue.id,request:'r'}),e=>e.code==='LAUNCH_UNCERTAIN');
  f.loseLaunchResponse(false);
  const m=await createMissionRegistry({root:f.home}).read('M-1');
  assert.equal(m.step,'requested');assert.ok(m.lead.sessionId);
  const found=await f.backend.dispatch('lead-launch',{mission:'M-1'});
  assert.equal(found.reused,true,'the labelled terminal is found again');assert.equal(found.mission.step,'delegated');
  assert.equal(f.calls.filter(c=>c.args[0]==='run').length,1);
});

test('the commands given to the Lead answer; what comes with a later lot says so, cleanly',async t=>{
  const f=await teamFixture(t);
  for(const action of ['lead-request','lead-answer','lead-escalate','pilot-decide'])await assert.rejects(()=>f.backend.dispatch(action,{}),e=>e.code==='INVALID_ARGUMENT',action);
  await f.backend.dispatch('lead-launch',{project:'example',issueId:issue.id,request:'Demande'});
  assert.equal((await f.backend.dispatch('lead-request',{mission:'M-1',kind:'qa'})).automatic,true);
  await assert.rejects(()=>f.backend.dispatch('lead-request',{mission:'M-1',kind:'fix'}),e=>e.code==='INVALID_ARGUMENT','a correction names its tickets');
  assert.deepEqual(await f.backend.dispatch('inbox-list',{}),{items:[]});
  const read=await f.backend.dispatch('mission-read',{mission:'M-1'});assert.deepEqual([read.questions,read.items],[[],[]]);
});

// ---- Review 2 of 1A (Codex): the limit Pilot passes is checked before anything is written, on the step a PO taken up
// stands at, even when the mission already holds that limit.
test('lead-launch with a limit, a PO stopped past Develop: refused, no mission made, no PO taken up (1A review 2)',async t=>{
  const f=await teamFixture(t);await workingPo(f,{step:'check',base:'release/x',stoppedAt:'2026-11-09T21:31:49.364Z'});
  await assert.rejects(()=>f.backend.dispatch('lead-launch',{project:'example',issueId:issue.id,request:'Demande',stopAfter:'develop'}),e=>e.code==='MISSION_STARTED');
  assert.equal((await createMissionRegistry({root:f.home}).list()).length,0,'no mission made');
});
test('lead-launch with a limit already written, a PO stopped past Develop: refused, the mission not taken up (1A review 2)',async t=>{
  const f=await teamFixture(t);
  const missions=createMissionRegistry({root:f.home});
  await missions.create({project:'example',issue:{id:issue.id,identifier:issue.identifier,title:issue.title,url:issue.url},request:'Demande'});
  await missions.update('M-1',m=>{m.stopAfter='develop';});
  await workingPo(f,{step:'check',base:'release/x',stoppedAt:'2026-11-09T21:31:49.364Z'});
  await assert.rejects(()=>f.backend.dispatch('lead-launch',{project:'example',issueId:issue.id,request:'Demande',stopAfter:'develop'}),e=>e.code==='MISSION_STARTED');
  const m=await missions.read('M-1');
  assert.notEqual(m.step,'validating');assert.equal(m.resumedFrom,undefined,'not taken up');
});
test('lead-launch with a limit, a PO at work past Develop: refused before it is adopted (1A review 2)',async t=>{
  const f=await teamFixture(t);await workingPo(f,{step:'check'});
  await assert.rejects(()=>f.backend.dispatch('lead-launch',{project:'example',issueId:issue.id,request:'Demande',stopAfter:'develop'}),e=>e.code==='MISSION_STARTED');
  assert.equal((await createMissionRegistry({root:f.home}).list()).length,0,'nothing adopted');
});

// ---- Review 3 of 1A (Codex).
test('lead-launch with a limit: a PO of before that is done leaves the issue free (1A review 3)',async t=>{
  const f=await teamFixture(t);await workingPo(f,{step:'close'});
  const out=await f.backend.dispatch('lead-launch',{project:'example',issueId:issue.id,request:'Demande',stopAfter:'develop'});
  assert.equal(out.mission.stopAfter,'develop');
});
