import test from 'node:test';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {ISSUE_STEPS,stepOf,mdSection,partShown,plainMentions,ownValue,GATE_STEPS,splitRows,devRows,runOf,progressOf,reviewLines,workspaceOf,serverOf,modelShort,decisionOf,clarificationOf,withoutSections,mdTable,issueTabs,navModel,toggleUnfolded,openedUnfolded,myIssueGroups,issueFilterOf,teamIssueGroups,backlogCount,dayOf,stageOf,questionStale,toCloseRows,sinceText,STAGES,crumb,fixProject,knownProject,pageOf,poOf,poTab,canceledState,issueMeta,syncText,poStatus,inboxRows,countsText,stateTone,myTabOf,activityGroups,agentTerminal,spaceAsked,SPACE_ASK_TTL,labelColor,mergeMyIssues,unreadTeams,clockOf,ACTIVITY_LIMIT,AGENT_SCREEN,INBOX_SCREEN,MY_ISSUES_SCREEN,ISSUES_SCREEN,ISSUE_SCREEN} from '../../../../ui/v3/view.js';

const projects=[{key:'alpha',name:'Alpha'},{key:'gz'}];
const waiting=[{id:'a',role:'po',issueId:'i1',projectKey:'alpha',status:'blocked',updatedAt:'2026-01-01'},{id:'b',role:'po',issueId:'i2',projectKey:'gz',status:'error',updatedAt:'2026-02-01'},{id:'c',role:'po',issueId:'i3',projectKey:'alpha',status:'working'},{id:'d',issueId:'i4',status:'blocked'}];

test('the bar: the Inbox counts what waits, the open team unfolds Issues (with its backlog count) and Projects (no page yet)',()=>{
  const nav=navModel({projects,chosen:'gz',page:'issues',sessions:waiting,backlog:{key:'gz',count:5}});
  assert.deepEqual(nav.inbox,{count:2,on:false});assert.deepEqual(nav.myIssues,{on:false});assert.equal(navModel({projects,page:'myIssues'}).myIssues.on,true);
  assert.deepEqual(nav.teams.map(t=>[t.key,t.count,t.open,t.on]),[['alpha',1,false,false],['gz',1,true,false]]);
  assert.deepEqual(nav.teams[0].pages,[]);
  assert.deepEqual(nav.teams[1].pages,[{key:'issues',on:true,count:5},{key:'projects',on:false,count:null,soon:true}]);
  // The count read for another team is not shown; the Issue page still marks Issues; the Inbox page marks Inbox only.
  assert.equal(navModel({projects,chosen:'gz',page:'issue',backlog:{key:'alpha',count:5}}).teams[1].pages[0].count,null);
  assert.equal(navModel({projects,chosen:'gz',page:'issue'}).teams[1].pages[0].on,true);
  const inbox=navModel({projects,chosen:'gz',page:'inbox'});assert.equal(inbox.inbox.on,true);assert.equal(inbox.teams[1].pages[0].on,false);
  assert.ok(navModel({projects,chosen:'absent'}).teams.every(t=>!t.open));
  // Several teams stay unfolded at once: the open one, and every one the user unfolded.
  assert.deepEqual(navModel({projects,chosen:'gz',unfolded:['alpha']}).teams.map(t=>t.open),[true,true]);
  assert.deepEqual(navModel({projects,chosen:'gz',unfolded:['gz']}).teams.map(t=>t.open),[false,true]);
  assert.deepEqual(toggleUnfolded(['alpha'],'gz'),['alpha','gz']);assert.deepEqual(toggleUnfolded(['alpha','gz'],'alpha'),['gz']);assert.deepEqual(toggleUnfolded(null,'gz'),['gz']);assert.deepEqual(toggleUnfolded([3,'gz'],'gz'),[]);
  assert.deepEqual(openedUnfolded([],'gz','alpha'),['gz','alpha'],'the team left stays open');assert.deepEqual(openedUnfolded(['gz'],null,'gz'),['gz']);assert.deepEqual(openedUnfolded(null,'',null),[]);
  assert.deepEqual(navModel({projects,chosen:'alpha',unfolded:openedUnfolded([],'gz','alpha')}).teams.map(t=>t.open),[true,true]);
  assert.equal(knownProject(projects,'absent'),null);assert.equal(fixProject(projects,'absent'),'alpha');assert.equal(fixProject(projects,'gz'),'gz');assert.equal(fixProject([],null),null);
  assert.equal(pageOf('issue'),'issue');assert.equal(pageOf('inbox'),'inbox');assert.equal(pageOf('nope'),'issues');
  assert.equal(INBOX_SCREEN,'fabrique-console-v3-inbox');assert.equal(MY_ISSUES_SCREEN,'fabrique-console-v3-my-issues');assert.equal(ISSUES_SCREEN,'fabrique-console-v3-issues');assert.equal(ISSUE_SCREEN,'fabrique-console-v3-issue');
});

test('the top bar: team › page, the identifier of the issue on its page, the Inbox alone',()=>{
  assert.deepEqual(crumb({page:'issues',projects,chosen:'alpha'}).map(p=>p.text),['Alpha','Issues']);
  assert.deepEqual(crumb({page:'issue',projects,chosen:'alpha',identifier:'XJ-690'}).map(p=>[p.text,!!p.strong]),[['Alpha',false],['Issues',false],['XJ-690',true]]);
  assert.deepEqual(crumb({page:'issue',projects,chosen:null}).map(p=>p.text),['Tous les projets','Issues','Issue']);
  assert.deepEqual(crumb({page:'inbox',projects,chosen:'alpha'}).map(p=>p.text),['Inbox']);assert.deepEqual(crumb({page:'myIssues',projects,chosen:'alpha'}).map(p=>p.text),['My issues']);
  assert.ok(crumb({page:'issues',projects,chosen:'alpha'})[0].project);
  assert.equal(stateTone({type:'started'}),'rev');assert.equal(stateTone({type:'completed'}),'ok');assert.equal(stateTone(null),'unk');
});

test('the Inbox lists the PO sessions that wait (a question, an error), newest first, with their team',()=>{
  const rows=inboxRows(waiting,projects);
  assert.deepEqual(rows.map(r=>[r.session.id,r.project?.name||null]),[['b',null],['a','Alpha']]);
  assert.deepEqual(inboxRows([],projects),[]);
  // The four stages: a question or a stopped terminal waits; po-ready is to close; stopped is done; else working.
  const q={id:'q-1',text:'Quel découpage retenir ?',options:['Issue simple','Project'],askedAt:'2026-11-07T10:00:00Z'};
  assert.equal(stageOf({role:'po',status:'working'}),'working');assert.equal(stageOf({role:'po',status:'idle',question:q}),'waiting');
  assert.equal(stageOf({role:'po',status:'blocked'}),'waiting');assert.equal(stageOf({role:'po',status:'working',readyAt:'2026'}),'toClose');
  assert.equal(stageOf({role:'po',status:'working',readyAt:'2026',stoppedAt:'2026'}),'done');assert.equal(stageOf({status:'historical'}),'done');assert.equal(stageOf(null),'done');
  // A terminal that is gone answers no question and closes no work: what waits for the user stays (C0).
  assert.equal(stageOf({role:'po',status:'historical',question:q}),'waiting');assert.equal(stageOf({role:'po',status:'historical',readyAt:'2026'}),'toClose');
  // A question of a PO that went on working is stale; a question sorts by when it was asked.
  const asked=[{id:'x',role:'po',status:'idle',question:q,updatedAt:'2026-01-01'},{id:'y',role:'po',status:'working',question:{...q,id:'q-2',askedAt:'2026-11-07T11:00:00Z'}},{id:'z',role:'po',status:'working'}];
  const cards=inboxRows(asked,projects);
  assert.deepEqual(cards.map(r=>[r.session.id,r.question?.id,r.stale]),[['y','q-2',true],['x','q-1',false]]);
  assert.equal(questionStale(asked[0]),false);assert.equal(questionStale(asked[1]),true);
  // Answers are offered only while the PO waits, its terminal idle: the rule po-answer applies.
  assert.deepEqual(['idle','done','working','blocked','unknown','historical'].map(status=>inboxRows([{role:'po',id:status,status,question:q}])[0]?.answerable),[true,true,false,false,false,false]);
  assert.equal(poStatus({status:'done'}),poStatus({status:'idle'}),'a turn ended is not a work finished');
  assert.deepEqual(toCloseRows([{id:'r',role:'po',status:'working',readyAt:'2026-11-07T10:00:00Z',projectKey:'alpha'},...asked],projects).map(r=>[r.session.id,r.project.name]),[['r','Alpha']]);
  const now=Date.parse('2026-11-07T10:12:00Z');
  assert.equal(sinceText('2026-11-07T10:00:00Z',now),'Depuis 12 min');assert.equal(sinceText('x',now),'');
  assert.deepEqual(STAGES,['waiting','working','toClose','done']);
  assert.equal(countsText([{name:'In Progress',type:'started',count:2},{name:'Backlog',type:'backlog',count:1},{name:'Done',type:'completed',count:9}]),'2 In Progress · 1 Backlog · 9 Done');assert.equal(countsText([]),'—');assert.equal(countsText([{name:'—',type:'unknown',count:2}]),'2 —');
});

test('My issues, Issues: Active, Backlog or All issues, grouped by state in the order of the types, with sub-issue counts',()=>{
  const S={started:{name:'In Progress',type:'started'},review:{name:'In Review',type:'started'},todo:{name:'Todo',type:'unstarted'},backlog:{name:'Backlog',type:'backlog'},done:{name:'Done',type:'completed'},canceled:{name:'Canceled',type:'canceled'}};
  const issue=(id,identifier,state,extra={})=>({id,identifier,title:'T '+identifier,state,parentId:null,blocks:0,blockedBy:0,updatedAt:'2026-11-0'+(id.length%9+1)+'T10:00:00Z',...extra});
  const data={relations:'full',teams:[
    {key:'alpha',name:'Alpha',projects:[{id:'p1',name:'Médiathèque',issues:[
      issue('a','XJ-1',S.started,{blocks:2}),issue('a1','XJ-2',S.done,{parentId:'a'}),issue('a2','XJ-3',S.backlog,{parentId:'a',blockedBy:1}),issue('a3','XJ-4',S.canceled,{parentId:'a'}),
      issue('b','XJ-5',S.todo),issue('c','XJ-6',S.done,{blocks:1}),issue('c1','XJ-7',S.review,{parentId:'c'}),issue('d','XJ-10',S.backlog,{parentId:'zz'}),
    ]},{id:'p2',name:'Site',issues:[issue('e','XJ-8',S.started,{blocks:1})]}]},
    {key:'beta',name:'Beta',projects:[],error:{code:'TICKET_API',message:'down'}},
  ],activity:[{...issue('n','JI-3',S.todo),team:{key:'beta',name:'Beta'},project:null},{...issue('a','XJ-1',S.started,{blocks:2}),team:{key:'alpha',name:'Alpha'},project:{id:'p1',name:'Médiathèque'}},{...issue('m','XJ-9',S.done),team:{key:'alpha',name:'Alpha'},project:null}]};
  const shape=g=>[g.name,g.issues.map(r=>r.issue.identifier+(r.total?' '+r.done+'/'+r.total:'')+(r.project?'':' ·'))];
  const active=myIssueGroups(data,'active');
  assert.equal(active.relations,'full');assert.equal(active.count,5);
  // Started states first, by name; then Todo. A parent carries done/all of its sub-issues; an issue in no project comes from the activity, once.
  assert.deepEqual(active.groups.map(shape),[['In Progress',['XJ-1 1/3','XJ-8']],['In Review',['XJ-7']],['Todo',['XJ-5','JI-3 ·']]]);
  assert.deepEqual(myIssueGroups(data,'backlog').groups.map(shape),[['Backlog',['XJ-3','XJ-10']]]);
  const all=myIssueGroups(data,'all');
  assert.deepEqual(all.groups.map(g=>g.name),['In Progress','In Review','Todo','Backlog','Done','Canceled']);assert.equal(all.count,11);
  assert.deepEqual(myIssueGroups(data).groups.map(g=>g.name),['In Progress','In Review','Todo'],'Active by default');
  assert.deepEqual(myIssueGroups(null),{relations:'none',groups:[],count:0});
  assert.equal(issueFilterOf('all'),'all');assert.equal(issueFilterOf(null),'active');assert.equal(issueFilterOf('x'),'active');
  assert.equal(dayOf('2026-11-07T10:00:00Z'),'7 nov.');assert.equal(dayOf('x'),'');
});

test('My issues: two tabs, and the activity grouped by the day of the last update',()=>{
  assert.equal(myTabOf('activity'),'activity');assert.equal(myTabOf(null),'issues');assert.equal(myTabOf('x'),'issues');assert.equal(myTabOf('projects'),'issues');
  const now=Date.parse('2026-11-07T12:00:00Z');
  const groups=activityGroups([{id:'a',updatedAt:'2026-11-07T08:00:00Z'},{id:'b',updatedAt:'2026-11-06T20:00:00Z'},{id:'c',updatedAt:'2026-11-02T10:00:00Z'},{id:'d',updatedAt:'2026-11-02T09:00:00Z'},{id:'e'}],now);
  assert.deepEqual(groups.map(g=>[g.label,g.issues.map(i=>i.id)]),[['Aujourd\'hui',['a']],['Hier',['b']],['Il y a 5 jours',['c','d']],['Date inconnue',['e']]]);
  assert.deepEqual(activityGroups([],now),[]);
});

test('the Agent page: the living assistant of a tool, the space asked once between copies',()=>{
  const live={address:'t8',state:'live',labels:{'fabrique-console.app':'fabrique-console','fabrique-console.role':'agent','fabrique-console.tool':'claude'}},gone={...live,address:'t7',state:'exited'},po={address:'t1',state:'live',labels:{'fabrique-console.role':'po'}};
  const foreign={address:'t2',state:'live',labels:{'fabrique-console.role':'agent','fabrique-console.tool':'claude'}};
  assert.equal(agentTerminal([gone,foreign,po,live],'claude').address,'t8','only a terminal of this app');assert.equal(agentTerminal([gone,po,live],'codex'),null);assert.equal(agentTerminal([],'claude'),null);
  const t0=Date.parse('2026-11-07T10:00:00Z');
  assert.equal(spaceAsked(new Date(t0).toISOString(),t0+SPACE_ASK_TTL-1),true);assert.equal(spaceAsked(new Date(t0).toISOString(),t0+SPACE_ASK_TTL),false);assert.equal(spaceAsked(null,t0),false);assert.equal(spaceAsked('x',t0),false);
  assert.equal(AGENT_SCREEN,'fabrique-console-v3-agent');assert.equal(navModel({projects,page:'agent'}).agent.on,true);
  assert.deepEqual(crumb({page:'agent',projects,chosen:'alpha'}).map(p=>p.text),['Agent']);
});

test('the Issues page of a team lists every issue of the team, with or without project: Active, Backlog or All issues, grouped by state',()=>{
  const S={started:{name:'In Progress',type:'started'},todo:{name:'Todo',type:'unstarted'},backlog:{name:'Backlog',type:'backlog'},done:{name:'Done',type:'completed'}};
  const issues=[{id:'a',identifier:'XJ-3',state:S.backlog,project:{id:'p1',name:'Médiathèque'}},{id:'b',identifier:'XJ-1',state:S.backlog},{id:'c',identifier:'XJ-2',state:S.started},
    {id:'d',identifier:'XJ-4',state:S.todo,parentId:'c'},{id:'e',identifier:'XJ-5',state:S.done,parentId:'c'}];
  const team={key:'alpha',name:'Alpha'},shape=g=>[g.name,g.issues.map(r=>r.issue.identifier)];
  assert.deepEqual(teamIssueGroups(issues,team,'backlog').groups.map(shape),[['Backlog',['XJ-1','XJ-3']]],'the backlog holds the issues of a project too');
  const active=teamIssueGroups(issues,team,'active');
  assert.deepEqual(active.groups.map(shape),[['In Progress',['XJ-2']],['Todo',['XJ-4']]]);assert.equal(active.count,2);
  assert.deepEqual([active.groups[0].issues[0].done,active.groups[0].issues[0].total],[1,2]);
  assert.equal(teamIssueGroups(issues,team,'all').count,5);
  assert.deepEqual(teamIssueGroups(issues,team,'backlog').groups[0].issues.map(r=>r.project?.name??null),[null,'Médiathèque']);
  assert.equal(backlogCount(issues),2);assert.equal(teamIssueGroups(null,team).count,0);
});

test('a row of the backlog knows its PO: a live one is opened, a closed or absent one is launched',()=>{
  const sessions=[{id:'a',role:'po',issueId:'i1',status:'historical'},{id:'b',role:'po',issueId:'i1',status:'working'},{id:'c',role:'po',issueId:'i2',status:'historical'},{id:'d',issueId:'i3',status:'working'}];
  assert.deepEqual(['i1','i2','i3'].map(id=>poOf(sessions,id)?.id??null),['b','c',null]);
  // A PO whose terminal could not be read is still the PO of the issue, but is not "live".
  assert.equal(poOf([{id:'u',role:'po',issueId:'i1',status:'unknown'}],'i1').id,'u');
  // A session stopped on purpose is over even if its terminal still reports; the session the user came from wins.
  const stopped=[{id:'old',role:'po',issueId:'i1',status:'working',stoppedAt:'2026-01-02',createdAt:'2026-01-01'},{id:'new',role:'po',issueId:'i1',status:'unknown',createdAt:'2026-02-01'}];
  assert.equal(poOf(stopped,'i1').id,'new');assert.equal(poOf(stopped,'i1','old').id,'old');assert.equal(poOf(stopped,'i1','elsewhere').id,'new');
  assert.equal(poOf([stopped[0]],'i1').id,'old');
  // Two closed sessions: the newest one is the PO of the issue.
  assert.equal(poOf([{id:'old',role:'po',issueId:'i1',status:'historical',createdAt:'2026-01-01'},{id:'new',role:'po',issueId:'i1',status:'historical',createdAt:'2026-02-01'}],'i1').id,'new');
  assert.equal(poStatus({status:'blocked'}),'Vous attend');assert.equal(poStatus(null),'Inconnu');
});

test('the tab of the PO is found from the agents Herdr lists, and a numbered tab is still unnamed',()=>{
  const agents=[{address:'t1',space:'s1',tab:'tb1',tab_name:'2'},{address:'t2',space:'s1',tab:'tb2',tab_name:'PO'}];
  assert.deepEqual(poTab(agents,'t1'),{space:'s1',tab:'tb1',name:'2',unnamed:true});
  assert.deepEqual(poTab(agents,'t2'),{space:'s1',tab:'tb2',name:'PO',unnamed:false});
  assert.equal(poTab(agents,'t9'),null);assert.equal(poTab([],null),null);
});

test('a removed issue goes to the canceled state of its team only',()=>{
  const states=[{id:'c-other',type:'canceled',team:{id:'other'}},{id:'c-mine',type:'canceled',team:{id:'mine'}},{id:'done',type:'completed',team:{id:'mine'}}];
  assert.equal(canceledState(states,'mine').id,'c-mine');assert.equal(canceledState(states,'none'),null);assert.equal(canceledState([],'mine'),null);
  assert.equal(canceledState(states,null).id,'c-other');
});

test('what a row says about an issue, and when the list was read',()=>{
  assert.equal(issueMeta({state:{name:'Backlog'},priority:2,assignee:{name:'the user'}}),'Backlog · Haute · the user');
  assert.equal(issueMeta({}),'— · — · Non assigné');
  assert.equal(syncText({updatedAt:'2026-11-07T12:00:00Z',cached:true}),'Cache · 2026-11-07T12:00:00Z');
  assert.equal(syncText({}),'Aucune synchronisation réussie');
});

test('a label colour is only ever a hex colour',()=>{
  assert.equal(labelColor('#4FAE52'),'#4FAE52');assert.equal(labelColor('#abc'),'#abc');assert.equal(labelColor('#8E86F5FF'),'#8E86F5FF');
  for(const bad of ['not-a-color','#12zzzz','url(x)','#123456;alert(1)','',null,12])assert.equal(labelColor(bad),null,String(bad));
});

test('My issues: a team the reread cannot read keeps its last data, dated, in both tabs',()=>{
  const xj={key:'alpha',name:'Alpha',teamId:'team-F',projects:[{id:'p1',name:'P',issues:[]}]},ji={key:'beta',name:'Beta',teamId:'team-J',projects:[{id:'p2',name:'Q',issues:[]}]};
  const a1={id:'a',updatedAt:'2026-11-07T09:00:00Z',team:{key:'alpha'}},j1={id:'j',updatedAt:'2026-11-07T08:00:00Z',team:{key:'beta'}};
  const kept={data:{teams:[xj,ji],activity:[a1,j1]},at:1000};
  const error={code:'TICKET_API',message:'Tracker returned a GraphQL error.'};
  const fg2={...xj,projects:[{id:'p1',name:'P2',issues:[]}]},a2={id:'a2',updatedAt:'2026-11-07T10:00:00Z',team:{key:'alpha'}};
  const merged=mergeMyIssues(kept,{teams:[fg2,{key:'beta',name:'Beta',teamId:'team-J',projects:[],error}],activity:[a2]},5000);
  assert.equal(merged.at,5000);
  assert.deepEqual(merged.data.teams[0],fg2,'a readable team carries the new read');
  assert.deepEqual(merged.data.teams[1],{...ji,error,keptAt:1000},'an unreadable team keeps its projects, with its error and the time of its data');
  assert.deepEqual(merged.data.activity.map(i=>i.id),['a2','j'],'Activity keeps the issues of the unreadable team, in order');
  assert.deepEqual(unreadTeams(merged.data.teams),[{key:'beta',name:'Beta',error,keptAt:1000}]);
  // The time kept is that of the first read that worked, not of the last reread.
  const again=mergeMyIssues(merged,{teams:[fg2,{key:'beta',name:'Beta',teamId:'team-J',projects:[],error}],activity:[a2]},9000);
  assert.equal(again.data.teams[1].keptAt,1000);assert.deepEqual(again.data.activity.map(i=>i.id),['a2','j']);
  // Nothing kept before: the error stands alone, Activity is what the read says.
  const first=mergeMyIssues(null,{teams:[{key:'beta',name:'Beta',teamId:'team-J',projects:[],error}],activity:[]},9000);
  assert.deepEqual(first.data.teams[0],{key:'beta',name:'Beta',teamId:'team-J',projects:[],error});assert.deepEqual(first.data.activity,[]);
  assert.deepEqual(unreadTeams(first.data.teams),[{key:'beta',name:'Beta',error,keptAt:null}]);
  // Every team failing keeps everything shown.
  const all=mergeMyIssues(kept,{teams:[{...xj,projects:[],error},{...ji,projects:[],error}],activity:[]},5000);
  assert.deepEqual(all.data.activity.map(i=>i.id),['a','j']);assert.equal(all.data.teams[0].projects.length,1);
  // The limit of Activity holds after the merge.
  const many=Array.from({length:ACTIVITY_LIMIT},(_,n)=>({id:'m'+n,updatedAt:'2026-11-07T07:'+String(n%60).padStart(2,'0')+':00Z',team:{key:'alpha'}}));
  assert.equal(mergeMyIssues(kept,{teams:[fg2,{key:'beta',name:'Beta',teamId:'team-J',projects:[],error}],activity:many},5000).data.activity.length,ACTIVITY_LIMIT);
  // A local key pointed at another Tracker team keeps nothing of the team it named before.
  const fgA={...xj,teamId:'team-A'},moved=mergeMyIssues({data:{teams:[fgA],activity:[a1]},at:1000},{teams:[{key:'alpha',name:'Other',teamId:'team-B',projects:[],error}],activity:[]},5000);
  assert.deepEqual(moved.data.teams[0],{key:'alpha',name:'Other',teamId:'team-B',projects:[],error});assert.deepEqual(moved.data.activity,[]);
  const same=mergeMyIssues({data:{teams:[fgA],activity:[a1]},at:1000},{teams:[{key:'alpha',name:'Alpha',teamId:'team-A',projects:[],error}],activity:[]},5000);
  assert.equal(same.data.teams[0].keptAt,1000);assert.deepEqual(same.data.activity.map(i=>i.id),['a']);
  assert.equal(unreadTeams(undefined).length,0);
  assert.match(clockOf(Date.now()),/^\d\d:\d\d$/);assert.equal(clockOf('x'),'');
});

test('the tabs of the issues open: one per PO session not over, oldest first',()=>{
  const sessions=[{id:'b',role:'po',status:'idle',projectKey:'gz',createdAt:'2026-11-07T10:00:00Z'},{id:'a',role:'po',status:'working',projectKey:'alpha',createdAt:'2026-11-07T09:00:00Z'},
    {id:'stopped',role:'po',status:'idle',stoppedAt:'2026',createdAt:'2026'},{id:'gone',role:'po',status:'historical',createdAt:'2026'},{id:'dev',role:'dev',status:'working',createdAt:'2026'}];
  assert.deepEqual(issueTabs(sessions,projects).map(t=>[t.session.id,t.project?.key??null,t.stage]),[['a','alpha','working'],['b','gz','working']]);
});

test('the step of an issue: the method in five steps, the plan before anything, the closure once ready',()=>{
  assert.deepEqual(ISSUE_STEPS,['plan','split','dev','check','close']);
  assert.equal(stepOf(null),'plan');assert.equal(stepOf({}),'plan');assert.equal(stepOf({step:'weird'}),'plan');assert.equal(stepOf({step:'analysis'}),'plan');
  assert.equal(stepOf({step:'split'}),'split');assert.equal(stepOf({step:'check'}),'check');assert.equal(stepOf({step:'dev',readyAt:'2026'}),'close');
  // An open question that closes a later step moves the step forward, never back.
  assert.equal(stepOf({step:'plan',question:{gate:'split'}}),'split');assert.equal(stepOf({question:{gate:'launch'}}),'dev');
  assert.equal(stepOf({step:'dev',question:{gate:'plan'}}),'dev');assert.equal(stepOf({step:'plan',question:{text:'?'}}),'plan');
});

test('a decision: its first mention of who and when is the meta line, the words quoted kept',()=>{
  assert.deepEqual(decisionOf('Une liste par golf ; premium uniquement (the user, 2026-10-31).'),{text:'Une liste par golf ; premium uniquement.',who:'the user',date:'2026-10-31',quote:null});
  assert.deepEqual(decisionOf('Choix confirmés (the user, 2026-11-07) : pas d\'interrupteur.'),{text:'Choix confirmés : pas d\'interrupteur.',who:'the user',date:'2026-11-07',quote:null});
  const d=decisionOf('**Admin exclu** : aucun accès (the user, 2026-11-07 : « l\'admin ne gère pas »). Précision de the user (2026-11-07) : « seul le Golf Manager ».');
  assert.equal(d.who,'the user');assert.equal(d.quote,'« l\'admin ne gère pas »');assert.equal(d.text,'**Admin exclu** : aucun accès. Précision de the user (2026-11-07) : « seul le Golf Manager ».');
  assert.deepEqual(decisionOf('Nom : « Mes lots » (maquette coque, 2026-11-02).'),{text:'Nom : « Mes lots ».',who:'maquette coque',date:'2026-11-02',quote:null});
  assert.deepEqual(decisionOf('Sans mention.'),{text:'Sans mention.',who:null,date:null,quote:null});
});

test('the clarification of a description: facts, decided, open, the rest as it is',()=>{
  const md='Intro.\n\n## Clarification\n\nÉtat constaté le 2026-11-07 (PO) :\n\n* Le plan existe.\n* Rien n\'est poussé,\n  ni fusionné.\n\n### Décidé\n\n* A (the user, 2026-10-31).\n* B.\n\n### Ouvert\n\n* Partenaires ?\n\n### Notes\n\nlibre\n\n## Plan\nP';
  const c=clarificationOf(md);
  assert.deepEqual(c.facts,{title:'État constaté le 2026-11-07 (PO)',lead:'',items:['Le plan existe.','Rien n\'est poussé,\nni fusionné.'],rest:''});
  assert.equal(c.decided.title,'Décidé');assert.deepEqual(c.decided.items.map(d=>[d.text,d.who]),[['A.','the user'],['B.',null]]);
  assert.deepEqual(c.open.items,['Partenaires ?']);assert.deepEqual(c.others,[{title:'Notes',body:'libre'}]);
  assert.equal(clarificationOf('Pas de section'),null);
  const fenced=clarificationOf('## Clarification\n```\n### Décidé\n* code\n```\n### Ouvert\n* vrai');
  assert.equal(fenced.decided,null);assert.deepEqual(fenced.open.items,['vrai']);
});

test('the clarification loses no text: a question without list, numbered items, text after a list, sub-items',()=>{
  const bare=clarificationOf('## Clarification\n### Ouvert\nFaut-il migrer les comptes ?');
  assert.equal(partShown(bare.open),true);assert.equal(bare.open.lead,'Faut-il migrer les comptes ?');
  assert.deepEqual(clarificationOf('## Clarification\n### Ouvert\n1. Faut-il migrer ?\n2) Et les tests ?').open.items,['Faut-il migrer ?','Et les tests ?']);
  const after=clarificationOf('## Clarification\n### Décidé\n- Garder les données (the user, 2026-11-07).\n\nAttention : seulement les données actives.');
  assert.equal(after.decided.rest,'Attention : seulement les données actives.');assert.equal(partShown(after.decided),true);
  const nested=clarificationOf('## Clarification\n### Décidé\n- Migrer les comptes (the user, 2026-11-07).\n  - Sauf les comptes test.\n- Autre.').decided.items;
  assert.equal(nested.length,2);assert.equal(nested[0].text,'Migrer les comptes.\n- Sauf les comptes test.');assert.equal(nested[0].who,'the user');
  assert.equal(partShown(clarificationOf('## Clarification\n### Ouvert\n- Rien.').open),false);assert.deepEqual(clarificationOf('## Clarification\n### Ouvert\n- Rien de plus que ceci ?').open.items,['Rien de plus que ceci ?']);
  assert.equal(partShown(null),false);assert.equal(partShown({lead:'',items:[],rest:''}),false);
  // A title with a long run of blanks inside keeps its words and its content (the timed test only checks the time).
  const spaced=clarificationOf('## Clarification\n### Ouvert '+' '.repeat(5000)+'au 7 nov. ##\n- Partenaires ?');
  assert.equal(spaced.open.title,'Ouvert '+' '.repeat(5000)+'au 7 nov.');assert.deepEqual(spaced.open.items,['Partenaires ?']);
});

test('a table: marked heads read plainly, a row wider than the head keeps its cells',()=>{
  const t=mdTable('| **Ticket** | _Contenu_ |\n|---|---|\n| 1 | a | extra |');
  assert.deepEqual(t.head,['Ticket','Contenu']);assert.deepEqual(t.rows,[['1','a','extra']]);
});

test('a long run of blanks in a table or a decision is read in tracker time',()=>{
  // In a child process with a time limit: a parser that backtracks over the blanks fails here instead of holding the suite.
  const url=new URL('../../../../ui/v3/view.js',import.meta.url).href,big="' '.repeat(200000)";
  const code=`import('${url}').then(m=>{m.mdTable('|Ticket|\\n'+${big}+'x');m.clarificationOf('## Clarification\\n### Décidé\\n- Choix '+${big}+'x (');m.decisionOf('('+${big}+'x');m.clarificationOf('## Clarification\\n### Ouvert '+${big}+'x\\n- y');process.stdout.write('done');})`;
  const child=spawnSync(process.execPath,['--input-type=module','-e',code],{timeout:2000,encoding:'utf8'});
  assert.equal(child.error,undefined,'read within two seconds');assert.equal(child.stdout,'done');
});

test('the mentions Tracker writes become their label: a link in text, the bare label in a cell',()=>{
  const tag='<issue id="0fed" label="XJ-690" href="https://linear.app/fabrique-console/issue/XJ-690" />';
  assert.equal(plainMentions('1 · '+tag,false),'1 · XJ-690');
  assert.equal(plainMentions('voir '+tag),'voir [XJ-690](https://linear.app/fabrique-console/issue/XJ-690)');
  assert.equal(plainMentions('<user id="u1" label="the user" href="javascript:x" />'),'the user');
  assert.equal(plainMentions('<issue id="x"/>',false),'x');assert.equal(plainMentions('a < b > c'),'a < b > c');
  assert.deepEqual(GATE_STEPS,{plan:'plan',split:'split',launch:'dev',finish:'dev',check:'check'});
  const child=spawnSync(process.execPath,['--input-type=module','-e',"import('"+new URL('../../../../ui/v3/view.js',import.meta.url).href+"').then(m=>{m.plainMentions('<issue '+'a'.repeat(200000));process.stdout.write('done')})"],{timeout:2000,encoding:'utf8'});
  assert.equal(child.stdout,'done');
});

test('the split read into aligned rows: number and ticket apart, effort as bars, waits as numbers, a count',()=>{
  const md='| Ticket | Contenu | Niveau | Agent | Modèle | Effort | Attend |\n|---|---|---|---|---|---|---|\n'+
    '| 1 · <issue id="a" label="XJ-690" href="https://linear.app/x/issue/XJ-690" /> | Publier le `contrat` | léger | codex | gpt-6-luna | medium | rien |\n'+
    '| 4 · XJ-693 | Données | fort | Codex | gpt-6-astra | high | 1 |\n| 8 · XJ-697 | Fin | léger | claude | claude-haiku-5-5 | medium | 2, 3, 5, 7 |';
  const s=splitRows(mdTable(md));
  assert.deepEqual(s.rows[0],{n:1,id:'XJ-690',content:'Publier le contrat',level:'léger',agent:'codex',model:'gpt-6-luna',effort:2,effortName:'medium',waits:[]});
  assert.deepEqual([s.rows[1].agent,s.rows[1].effort,s.rows[1].waits],['codex',3,['1']]);assert.deepEqual(s.rows[2].waits,['2','3','5','7']);
  assert.deepEqual(s.summary,{total:3,strong:1,codex:2,claude:1,free:1});
  assert.equal(splitRows(mdTable('| Ticket | Autre |\n|---|---|\n| 1 | x |')),null);assert.equal(splitRows(null),null);
  assert.equal(splitRows(mdTable('| # | Contenu | Attend |\n|---|---|---|\n| 3 | x | — |')).rows[0].n,3);
  const mention=splitRows(mdTable('| Ticket | Contenu | Niveau | Agent | Modèle | Effort | Attend |\n| -- | -- | -- | -- | -- | -- | -- |\n| <issue id="a" label="PRC-109" href="https://linear.app/x/issue/PRC-109" /> · 1. Textes | c | léger | codex | gpt-6.1-sol | medium | — |\n| PRC-110 · 2. Fin | c | standard | claude | claude-sonnet-5-5 | high | 1 |')).rows;
  assert.deepEqual(mention.map(r=>[r.id,r.n,r.agent,r.model,r.waits]),[['PRC-109',1,'codex','gpt-6.1-sol',[]],['PRC-110',2,'claude','claude-sonnet-5-5',['1']]],'a ticket written first, its number after');
  assert.equal(modelShort('claude-sonnet-5-5'),'sonnet 5.5');assert.equal(modelShort('gpt-6.1-sol'),'gpt-6.1-sol');assert.equal(modelShort(null),'');
});

test('the split shows only a table it fully knows: renamed, missing or extra columns, # and Ticket apart, names kept',()=>{
  const row='| 1 · XJ-690 | x | léger | codex | gpt-6-luna | medium | 2 |';
  assert.equal(splitRows(mdTable('| Ticket | Contenu | Niveau | Agent | Modèle | Effort | Dépendances |\n|---|---|---|---|---|---|---|\n'+row)),null);
  assert.equal(splitRows(mdTable('| Ticket | Contenu | Niveau | Agent | Modèle | Effort |\n|---|---|---|---|---|---|\n| 1 · XJ-690 | x | léger | codex | gpt-6-luna | medium |')),null);
  assert.equal(splitRows(mdTable('| Ticket | Contenu | Attend | Décision |\n|---|---|---|---|\n| 1 | x | — | Ne pas lancer avant accord |')),null);
  const both=splitRows(mdTable('| # | Ticket | Contenu | Attend |\n|---|---|---|---|\n| 3 | XJ-693 | Réparer user_id et `max_retries` | — |'));
  assert.deepEqual([both.rows[0].n,both.rows[0].id,both.rows[0].content],[3,'XJ-693','Réparer user_id et max_retries']);
  assert.deepEqual(splitRows(mdTable('| Ticket | Contenu | Attend |\n|---|---|---|\n| 1 | x |  |')).rows[0].waits,['?']);
});

test('values from Tracker look names up only among the page own names',()=>{
  const s=splitRows(mdTable('| Ticket | Contenu | Niveau | Agent | Effort | Attend |\n|---|---|---|---|---|---|\n| 1 | x | __proto__ | constructor | constructor | rien |'));
  assert.equal(s.rows[0].effort,0);assert.equal(ownValue({a:1},'constructor'),undefined);assert.equal(ownValue({a:1},'__proto__'),undefined);assert.equal(ownValue({a:1},'a'),1);
  assert.equal(stateTone({type:'constructor'}),'unk');assert.equal(stateTone({type:'started'}),'rev');
});

test('mentions inside code stay as written; mentions in prose become their label',()=>{
  const t2='<issue id="x" label="XJ-1" href="https://linear.app/x" />';
  assert.equal(plainMentions('``exemple ` '+t2+' ``'),'``exemple ` '+t2+' ``');assert.equal(plainMentions('` ouvert '+t2),'` ouvert [XJ-1](https://linear.app/x)');
  const fast=spawnSync(process.execPath,['--input-type=module','-e',"import('"+new URL('../../../../ui/v3/view.js',import.meta.url).href+"').then(m=>{let l='';for(let k=1;k<2400;k++)l+='`'.repeat(k)+' x ';m.plainMentions(l);process.stdout.write('done')})"],{timeout:3000,encoding:'utf8'});assert.equal(fast.stdout,'done');
  const tag='<issue id="x" label="XJ-690" href="https://linear.app/x/issue/XJ-690" />';
  assert.equal(plainMentions('```xml\n'+tag+'\n```'),'```xml\n'+tag+'\n```');
  assert.equal(plainMentions('voir `'+tag+'` et '+tag),'voir `'+tag+'` et [XJ-690](https://linear.app/x/issue/XJ-690)');
});

test('the tickets of the Réalisation: Tracker first, the split validated beside, in the split order',()=>{
  const split=splitRows(mdTable('| Ticket | Contenu | Niveau | Agent | Modèle | Effort | Attend |\n|---|---|---|---|---|---|---|\n| 1 · XJ-690 | a | léger | codex | gpt-6-luna | medium | — |\n| 2 · XJ-693 | b | fort | codex | gpt-6-astra | high | 1 |'));
  const kids=[{id:'u3',identifier:'XJ-693',title:'Mes lots — données',state:{name:'Backlog',type:'backlog'},labels:[],blockedBy:['u0'],model:null,effort:null},
    {id:'u0',identifier:'XJ-690',title:'Mes lots — contrat',state:{name:'In Progress',type:'started'},labels:[{name:'agent: Claude'}],blockedBy:[],model:'claude-opus-5-5',effort:'low'},
    {id:'u9',identifier:'XJ-699',title:'Mes lots — hors découpage',state:{name:'Done',type:'completed'},labels:[],blockedBy:['zz']}];
  const d=devRows(kids,split);
  assert.deepEqual(d.rows.map(r=>[r.n,r.id,r.content]),[[1,'XJ-690','contrat'],[2,'XJ-693','données'],[null,'XJ-699','hors découpage']]);
  assert.deepEqual([d.rows[0].agent,d.rows[0].model,d.rows[0].effort],['claude','claude-opus-5-5',1]);
  assert.deepEqual([d.rows[1].agent,d.rows[1].model,d.rows[1].effort,d.rows[1].waits],['codex','gpt-6-astra',3,['1']]);
  assert.deepEqual(d.rows[2].waits,['…']);assert.deepEqual(d.summary,{total:3,started:1,review:0,done:1,todo:1});
  assert.deepEqual(devRows([],null),{rows:[],summary:{total:0,started:0,review:0,done:0,todo:0}});
});

test('a description without the sections the steps show on their own',()=>{
  assert.equal(withoutSections('Intro\n## Clarification\nx\n### Décidé\ny\n## Autre\nz\n## Plan\np',['Clarification','plan']),'Intro\n## Autre\nz');
  assert.equal(withoutSections('```\n## Plan\n```\nfin',['Plan']),'```\n## Plan\n```\nfin');
});

test('a markdown table: head, rows padded to the head, escaped pipes, the text around',()=>{
  const t=mdTable('Avant\n\n| Ticket | Contenu | Modèle |\n|---|:--|---|\n| 1 | a \\| b | claude-opus-5-5 |\n| 2 | c |\n\nAprès');
  assert.deepEqual(t,{head:['Ticket','Contenu','Modèle'],rows:[['1','a | b','claude-opus-5-5'],['2','c','']],before:'Avant',after:'Après'});
  assert.equal(mdTable('pas | de tableau'),null);assert.equal(mdTable('```\n| a |\n|---|\n```'),null);
});

test('a section of a description by its level-2 title, up to the next title',()=>{
  const md='Intro\n\n## Clarification\n\nDécidé : x\n### Ouvert\n- y\n\n## Critères\n- a\n# Fin';
  assert.equal(mdSection(md,'Clarification'),'Décidé : x\n### Ouvert\n- y');
  assert.equal(mdSection(md,'critères'),'- a');
  assert.equal(mdSection(md,'Plan'),null);assert.equal(mdSection('## Plan\n\n',"Plan"),null);assert.equal(mdSection(null,'x'),null);
});

test('a section ignores the titles of a code block and reads the usual forms of a title',()=>{
  const md='Exemple :\n```md\n## Clarification\nEXAMPLE_ONLY\n```\n\n## Clarification\nREAL\n```sh\n## shell comment\necho ok\n```\nsuite\n## Plan\nReal plan';
  assert.equal(mdSection(md,'Clarification'),'REAL\n```sh\n## shell comment\necho ok\n```\nsuite');
  assert.equal(mdSection(md,'Plan'),'Real plan');
  for(const head of ['## **Clarification**','## _Clarification_','## Clarification ##','  ## Clarification'])assert.equal(mdSection(head+'\nX\n## Plan\nY','Clarification'),'X',head);
  assert.equal(mdSection('~~~~\n## Plan\n~~~\nstill code\n~~~~\n## Plan\nP','Plan'),'P');
  assert.equal(mdSection('### Plan\nnot it','Plan'),null);
});

test('a section reads CRLF descriptions as LF ones, and a long title in one pass',()=>{
  const lf='Ex :\n```md\n## Clarification\nEXAMPLE\n```\n## **Clarification** ##\nREAL\n### Ouvert\n- y\n## Plan\nP';
  const crlf=lf.replaceAll('\n','\r\n');
  assert.equal(mdSection(crlf,'Clarification'),mdSection(lf,'Clarification'));assert.equal(mdSection(lf,'Clarification'),'REAL\n### Ouvert\n- y');
  assert.equal(mdSection(crlf,'Plan'),'P');assert.equal(mdSection('## Clarification\r\nREAL_CRLF\r\n\r\n## Plan\r\nPLAN_CRLF','Clarification'),'REAL_CRLF');
  // In a child process with a time limit: a parser that slows down fails here instead of holding the suite.
  const code="import('"+new URL('../../../../ui/v3/view.js',import.meta.url).href+"').then(m=>process.stdout.write(String(m.mdSection('## Other'+' '.repeat(131072)+'!\\n## Plan\\nP','Plan'))))";
  const child=spawnSync(process.execPath,['--input-type=module','-e',code],{timeout:2000,encoding:'utf8'});
  assert.equal(child.error,undefined,'read within two seconds');assert.equal(child.stdout,'P');
});

test('Réalisation (M6): a ticket launched shows its stage, its reviewers each on a line, and counts by its stage',()=>{
  const kids=[{id:'u0',identifier:'XJ-690',title:'a',state:{name:'Backlog',type:'backlog'},labels:[],blockedBy:[]},
    {id:'u1',identifier:'XJ-691',title:'b',state:{name:'Backlog',type:'backlog'},labels:[],blockedBy:[]},
    {id:'u2',identifier:'XJ-692',title:'c',state:{name:'Backlog',type:'backlog'},labels:[],blockedBy:[]}];
  const now=Date.parse('2026-11-07T17:10:00Z');
  const tickets=[{ticketId:'u0',identifier:'XJ-690',stage:'review',status:'idle',commit:'a'.repeat(40),launchUncertain:false,
      reviews:[{runId:'r1',agent:'claude',model:'claude-sonnet-5-5',status:'working',since:'2026-11-07T17:06:00Z',verdict:null,launchUncertain:false},
        {runId:'r2',agent:'codex',model:'gpt-6-astra',status:'done',since:'2026-11-07T17:00:00Z',verdict:'changes_requested',launchUncertain:false}]},
    {ticketId:'other',identifier:'XJ-691',stage:'accepted',status:'done',reviews:[],launchUncertain:false}];
  const d=devRows(kids,null,tickets);
  assert.equal(d.rows[0].run,tickets[0]);assert.equal(d.rows[1].run,tickets[1],'found by identifier when the id differs');assert.equal(d.rows[2].run,null);
  assert.deepEqual(d.summary,{total:3,started:0,review:1,done:1,todo:1});
  assert.deepEqual(progressOf(d.rows[0]),{text:'En revue',tone:'rev',run:true});
  assert.deepEqual(progressOf(d.rows[2]),{text:'Backlog',tone:'unk',run:false});
  assert.equal(progressOf({run:{stage:'dev',launchUncertain:true}}).tone,'dec');
  assert.equal(progressOf({run:{stage:'dev',status:'error'}}).tone,'inc');
  assert.equal(progressOf({run:{stage:'constructor'}}).text,'constructor');
  const lines=reviewLines(tickets[0],now);
  assert.deepEqual(lines.map(l=>[l.agent,l.text,l.tone]),[['claude','relecture en cours','rev'],['codex','corrections demandées','dec']]);
  assert.match(lines[0].since,/4 min/);assert.equal(lines[1].since,'');
  assert.deepEqual(reviewLines(null),[]);assert.equal(reviewLines({reviews:[{status:'done',verdict:null}]})[0].text,'terminé sans verdict');
  assert.equal(runOf(tickets,{uid:'',id:''}),null);
  const launched=devRows([{id:'u5',identifier:'XJ-9',title:'x',labels:[{name:'agent:codex'}],model:'gpt-6-luna',effort:'low',blockedBy:[]}],null,[{ticketId:'u5',stage:'dev',agent:'claude',model:'claude-opus-5-5',effort:'high',reviews:[]}]).rows[0];
  assert.deepEqual([launched.agent,launched.model,launched.effort],['claude','claude-opus-5-5',3],'the launch, not the ticket');
});

test('Réalisation (M6): the worktree and the test server as the page says them',()=>{
  assert.equal(workspaceOf(null),null);
  const w=workspaceOf({path:'/w/alpha/XJ-689',branch:'xj-689',ahead:3,dirty:true,changes:[{},{}],status:'ready'});
  assert.deepEqual(w,{path:'/w/alpha/XJ-689',facts:['xj-689','3 commits d\'avance','modifications non commitées (2)'],warning:null});
  assert.match(workspaceOf({path:'p',status:'uncertain',dirty:null,ahead:null}).warning,/incertain/);
  assert.match(workspaceOf({path:'p',status:'__proto__'}).warning,/illisible/);
  assert.deepEqual(serverOf(null),{configured:false});
  const on=serverOf({configured:true,status:'working',active:true,listening:true,url:'http://localhost:5173/'});
  assert.equal(on.alive,true);assert.equal(on.url,'http://localhost:5173/');
  assert.equal(serverOf({configured:true,status:'working',url:'http://evil.example:80/'}).url,null);
  assert.equal(serverOf({configured:true,status:'historical',url:'http://localhost:1/'}).url,null);
  assert.equal(serverOf({configured:true,status:'unknown',launchUncertain:true}).uncertain,true);
  const unk=serverOf({configured:true,runId:'s1',terminalId:'t1',status:'unknown',active:null,listening:null,launchUncertain:false});
  assert.deepEqual([unk.alive,unk.stopped,unk.unknown,unk.text],[false,false,true,'Inconnu'],'an unknown observation is never stopped');
  assert.equal(serverOf({configured:true,runId:null,terminalId:null,status:'unknown'}).stopped,true,'never started');
  assert.equal(serverOf({configured:true,runId:'s1',status:'historical'}).stopped,true);
  const done=serverOf({configured:true,runId:'s1',terminalId:'t1',status:'done',active:null});assert.deepEqual([done.stopped,done.unknown],[false,true],'done does not prove the server ended');
  const at=(url,port=null)=>serverOf({configured:true,status:'working',url,port}).url;
  assert.equal(at('http://127.0.0.2:5173/'),'http://127.0.0.2:5173/');assert.equal(at('http://localhost:5173?x=1'),'http://localhost:5173?x=1');
  assert.equal(at('http://[::1]:3000'),'http://[::1]:3000');assert.equal(at('http://localhost:5173/',4000),null);
  assert.equal(at('http:'+'//fixture:fake@localhost:5173/'),null);assert.equal(at('http://localhost.evil.com:80/'),null);assert.equal(at('http://localhost:5173/@evil'),null);
  assert.equal(at('http://localhost:99999/'),null);
});
