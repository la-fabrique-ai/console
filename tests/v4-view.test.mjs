import {T} from '../ui/v3/texts.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {qaAgentOf,QA_OPENING_MS,liveOf,clockAt,workingTabs,readStartedInto,rightModel,ticketLook,askingTicket,ticketGroups,MERGED_SHOWN,launchBanner,missionRequests,qaBrief,testRanges,testMode,agoOf,answersInOrder,mockupsFor,sameWords,leadScreen,tintOf,itemSummary,launchState,readyTickets,codeSummary,testSteps,testIndex,reportBlocks,waitingOn,leadWaits,reportDigest,agentHead,machineToShow,screenOfAgent,stepsOf,ticketStory,storyLines,reviewTone,navModel,railModel,onMachine,missionsOf,phaseOf,shortPhaseOf,missionProgress,ticketPill,ticketDetail,issueSections,issueTarget,openCounts,issueMeta,issueTone,inboxOrdered,itemKind,itemUrgency,agentTabs,pickableAgents,agentDot,watcherOf,dayOf,ageOf,feedLines,SCREENS,atServer,lastLine} from '../mods/fabrique-console-v4-bar/nav.js';
import {W} from '../mods/fabrique-console-v4-bar/words.js';

const projects=[{key:'alpha',name:'Alpha',machine:null},{key:'gz',name:'Gamma',machine:'ai-dev'}];
const mission=(id,project,identifier,step,tickets=[],machine=null)=>({id,project,machine,step,issue:{id:'i-'+id,identifier,title:'Titre '+id},tickets});

test('nothing in the column is marked while Pilot or an agent is shown, even with a project chosen before',()=>{
  for(const page of ['pilot','agent']){
    const nav=navModel({page,project:'alpha',projects,missions:[],items:[],counts:{}});
    assert.equal(nav.inbox.on||nav.issues.on||nav.devs.on,false,page);
    assert.equal(nav.projects.some(p=>p.on||p.sub),false,page);
  }
});

test('a page of the general menu is marked alone; a project chosen is marked alone and unfolds its two lists',()=>{
  const missions=[mission('M-1','alpha','XJ-1','building',[{state:'dev'},{state:'dev'}])];
  const general=navModel({page:'issues',project:null,projects,missions,items:[],counts:{alpha:6}});
  assert.equal(general.issues.on,true);assert.equal(general.inbox.on,false);assert.equal(general.projects.some(p=>p.on),false);
  assert.deepEqual(general.projects[0].missions.map(({id,phase})=>({id,phase})),[{id:'XJ-1',phase:'2 tickets'}],'a project not chosen lists its missions, in the room the column has');
  const chosen=navModel({page:'project',project:'alpha',projects,missions,items:[],counts:{alpha:6}});
  assert.equal(chosen.projects[0].on,true);assert.equal(chosen.issues.on,false);assert.equal(chosen.devs.on,false);
  assert.deepEqual(chosen.projects[0].sub,[{key:'issues',on:false,count:6},{key:'devs',on:false,count:1}]);
  assert.deepEqual(chosen.projects[0].missions,[],'unfolded, it shows its lists instead');
  const list=navModel({page:'devs',project:'alpha',projects,missions,items:[],counts:{alpha:6}});
  assert.equal(list.devs.on,false,'the general entry stays off under a project');
  assert.deepEqual(list.projects[0].sub.map(s=>s.on),[false,true]);
  assert.equal(navModel({page:'issues',project:'unknown',projects,missions,items:[],counts:{}}).issues.on,true,'a project the config no longer has is none');
});

test('a project says its missions, and its Inbox count in red before its issues',()=>{
  const none=navModel({page:'inbox',project:null,projects,missions:[],items:[],counts:{alpha:6}}).projects[0];
  assert.equal(none.summary,'No active missions');assert.equal(none.count,6);assert.equal(none.hot,false);
  const two=[mission('M-1','alpha','XJ-1','analysing'),mission('M-2','alpha','XJ-2','qa')];
  const hot=navModel({page:'inbox',project:null,projects,missions:two,items:[{project:'alpha'},{project:'gz'}],counts:{alpha:6}});
  assert.equal(hot.projects[0].summary,'2 missions');assert.equal(hot.projects[0].count,1);assert.equal(hot.projects[0].hot,true);assert.equal(hot.inbox.count,2);
});

test('an agent waiting for the user counts in the Inbox, and belongs to no project of the column',()=>{
  const nav=navModel({page:'inbox',project:null,projects,missions:[],items:[{project:'alpha'}],waiting:2,counts:{alpha:6}});
  assert.equal(nav.inbox.count,3);assert.equal(nav.projects[0].count,1);assert.equal(nav.projects[1].hot,false);
  assert.equal(navModel({page:'inbox',project:null,projects,missions:[],items:[],counts:{}}).inbox.count,0,'none by default');
});

test('the rail: all machines, this computer with the Inbox count, each machine with its state',()=>{
  const rail=railModel({machines:[{name:null,layout:'ready'},{name:'ai-dev',layout:'unavailable'}],chosen:null,items:[{},{}]});
  assert.deepEqual(rail.map(r=>[r.key,r.label,r.glyph,r.on,r.state,r.badge]),[[null,'All','⌂',true,undefined,undefined],['local','Mac','M',false,'ok',2],['ai-dev','ai-dev','ai',false,'off',0]]);
  assert.deepEqual(railModel({machines:[{name:'ai-dev',layout:'ready'}],chosen:'ai-dev',items:[]}).map(r=>[r.key,r.on,r.state]),[[null,false,undefined],['local',false,'ok'],['ai-dev',true,'ok']]);
});

test('the machine chosen filters what is listed',()=>{
  assert.equal(onMachine(null,null),true);assert.equal(onMachine('ai-dev',null),true);
  assert.equal(onMachine(null,'local'),true);assert.equal(onMachine('ai-dev','local'),false);
  assert.equal(onMachine('ai-dev','ai-dev'),true);assert.equal(onMachine(null,'ai-dev'),false);
  const all=[mission('M-1','alpha','XJ-1','building'),mission('M-2','gz','GZ-1','building',[],'ai-dev')];
  assert.deepEqual(missionsOf(all,{machine:'local'}).map(m=>m.id),['M-1']);
  assert.deepEqual(missionsOf(all,{project:'gz'}).map(m=>m.id),['M-2']);
  assert.deepEqual(missionsOf(null,{}),[]);
});

test('the phase of a mission says what its tickets are doing',()=>{
  assert.equal(phaseOf({step:'analysing',tickets:[]}),'Preparation');
  assert.equal(phaseOf({step:'building',tickets:[{state:'dev'},{state:'fix'},{state:'todo'}]}),'Development · 2 tickets');
  assert.equal(phaseOf({step:'building',tickets:[{state:'dev'}]}),'Development · 1 ticket');
  assert.equal(phaseOf({step:'building',tickets:[{state:'dev',waitingAnswer:'Q-1'},{state:'dev'}]}),'Development · 1 question','a question comes before the count');
  assert.equal(phaseOf({step:'building',tickets:[{state:'review'},{state:'merged'}]}),'Development · Review');
  assert.equal(phaseOf({step:'building',tickets:[]}),'Development');
  assert.equal(phaseOf({step:'qa',tickets:[]}),'Development','the checks are part of the development');assert.equal(phaseOf({step:'validating',tickets:[]}),'Validation');
  assert.equal(phaseOf({step:'nope'}),'—');
  assert.equal(shortPhaseOf({step:'building',tickets:[{state:'dev'},{state:'dev'}]}),'2 tickets');assert.equal(shortPhaseOf({step:'building',tickets:[{state:'dev',waitingAnswer:'Q-1'}]}),'1 question');
  assert.equal(shortPhaseOf({step:'building',tickets:[]}),'Development');assert.equal(shortPhaseOf({step:'qa',tickets:[]}),'Development');assert.equal(shortPhaseOf({step:'nope'}),'—');
  assert.deepEqual(missionProgress({tickets:[{state:'merged'},{state:'accepted'},{state:'dev'}]}),{done:1,total:3,ratio:1/3});
  assert.deepEqual(missionProgress({tickets:[]}),{done:0,total:0,ratio:0});
});

test('a ticket says its state and who works on it, and what it waits for',()=>{
  assert.deepEqual(ticketPill({state:'merged'}),{tone:'merged',label:'Merged'});assert.deepEqual(ticketPill({state:'dev'}),{tone:'rev',label:'In progress'});
  assert.deepEqual(ticketPill({state:'review'}),{tone:'rev',label:'In review'});assert.deepEqual(ticketPill({state:'fix'}),{tone:'dec',label:'Fixing'});
  assert.deepEqual(ticketPill({state:'accepted'}),{tone:'ok',label:'Review passed'});
  assert.deepEqual(ticketPill({state:'todo',deps:['XJ-710']}),{tone:'unk',label:'Waiting for 710'});assert.deepEqual(ticketPill({state:'todo',deps:[]}),{tone:'unk',label:'Not started'});
  assert.deepEqual(ticketPill({state:'dev',waitingAnswer:'Q-3'}),{tone:'dec',label:'Awaiting reply'});
  assert.equal(ticketDetail({dev:'claude',level:'fort',deps:['XJ-710','XJ-711']}),'Claude · Extra review · after 710, 711');
  assert.equal(ticketDetail({dev:'codex',level:'standard',deps:[]}),'Codex');
  assert.equal(ticketDetail({}),'—');
});

const issue=(id,identifier,type,extra={})=>({id,identifier,title:'T '+identifier,state:{name:type,type},labels:[],createdAt:'2026-11-03T10:00:00Z',parentId:null,...extra});
const tracker={teams:[
  {key:'alpha',name:'Alpha',projects:[{id:'p',name:'P',issues:[issue('1','XJ-2','backlog'),issue('2','XJ-1','started'),issue('3','XJ-3','unstarted',{parentId:'1'}),issue('4','XJ-4','completed')]}]},
  {key:'gz',name:'Gamma',projects:[{id:'q',name:'Q',issues:[issue('5','GZ-1','backlog')]}]},
],activity:[]};

test('Issues lists issues by project, without their tickets, for the filter and the project chosen',()=>{
  const active=issueSections(tracker,{filter:'active'});
  assert.deepEqual(active.map(s=>[s.key,s.rows.map(r=>r.issue.identifier)]),[['alpha',['XJ-1']]],'the sub-issue XJ-3 is a ticket');
  const backlog=issueSections(tracker,{filter:'backlog'});
  assert.deepEqual(backlog.map(s=>[s.key,s.name,s.rows.length]),[['alpha','Alpha',1],['gz','Gamma',1]]);
  assert.deepEqual(issueSections(tracker,{filter:'backlog',team:'gz'}).map(s=>s.key),['gz']);
  assert.deepEqual(issueSections(tracker,{filter:'backlog',keys:new Set(['alpha'])}).map(s=>s.key),['alpha'],'the machine chosen keeps its projects');
  assert.deepEqual(issueSections(tracker,{filter:'all',team:'alpha'})[0].rows.map(r=>r.issue.identifier),['XJ-1','XJ-2','XJ-4']);
  assert.deepEqual(issueSections(null,{}),[]);
  assert.deepEqual(issueSections(tracker,{filter:'open',team:'alpha'})[0].rows.map(r=>r.issue.identifier),['XJ-1','XJ-2'],'a project page lists what is still open');
  assert.deepEqual(openCounts(tracker),{alpha:2,gz:1});
  assert.deepEqual(openCounts(null),{});
});

test('Issues only works on a project of the machine shown: nothing can be created in one that is hidden',()=>{
  assert.deepEqual(issueTarget({projects,machine:null,project:null,team:'alpha'}),{project:null,team:'alpha'});
  assert.deepEqual(issueTarget({projects,machine:'ai-dev',project:null,team:'alpha'}),{project:null,team:null},'the chip chosen before is on another machine');
  assert.deepEqual(issueTarget({projects,machine:'ai-dev',project:'alpha',team:'gz'}),{project:null,team:'gz'},'so is the project open in the column');
  assert.deepEqual(issueTarget({projects,machine:'local',project:'alpha',team:'gz'}),{project:'alpha',team:'alpha'},'the project open comes before the chip');
  assert.deepEqual(issueTarget({projects,machine:null,project:'unknown',team:'unknown'}),{project:null,team:null});
  assert.deepEqual(issueTarget({projects:null}),{project:null,team:null});
});

test('an issue says its mission when it has one, else its label and its day',()=>{
  const row={issue:issue('1','XJ-1','backlog',{labels:[{name:'Feature'}]}),team:{key:'alpha',name:'Alpha'}};
  assert.equal(issueMeta(row,[]),'Feature · Created 3 Nov');
  assert.equal(issueMeta({...row,issue:{...row.issue,labels:[]}},[]),'Created 3 Nov');
  const missions=[{id:'M-39',issue:{id:'1'},step:'building',tickets:[]}];
  assert.equal(issueMeta(row,missions),'Mission M-39 · Development');
  assert.equal(issueTone('started','In Review'),'review');assert.equal(issueTone('started','In Progress'),'ok');assert.equal(issueTone('completed','In Review'),'ok');assert.equal(issueTone('backlog'),'unk');assert.equal(issueTone('unstarted'),'rev');assert.equal(issueTone('started'),'ok');assert.equal(issueTone('completed'),'ok');assert.equal(issueTone('canceled'),'unk');assert.equal(issueTone(undefined),'unk');
});

test('the Inbox: what blocks agents first, then the oldest',()=>{
  const items=[{id:'I-3',priority:3,createdAt:'2026-11-09T09:00:00Z'},{id:'I-1',priority:1,createdAt:'2026-11-09T12:00:00Z'},{id:'I-2',priority:1,createdAt:'2026-11-09T10:00:00Z'},{id:'I-4',priority:2,createdAt:'2026-11-09T11:00:00Z'}];
  assert.deepEqual(inboxOrdered(items).map(i=>i.id),['I-2','I-1','I-4','I-3']);
  assert.deepEqual(inboxOrdered(null),[]);
  assert.deepEqual(itemKind({type:'decision'}),{tone:'dec',label:'Decision needed'});assert.deepEqual(itemKind({type:'validation'}),{tone:'ok',label:'Final approval'});
  assert.deepEqual(itemKind({type:'authorization'}),{tone:'dec',label:'Permission needed'});assert.deepEqual(itemKind({type:'stuck'}),{tone:'inc',label:'Blocked'});
  assert.deepEqual(itemUrgency({priority:1}),{tone:'inc',label:'High priority'});assert.deepEqual(itemUrgency({priority:3}),{tone:'unk',label:'Normal priority'});
});

test('counts read right at zero, one and many',()=>{
  assert.deepEqual([0,1,2].map(W.side.missions),['0 missions','1 mission','2 missions']);
  assert.deepEqual([0,1,2].map(W.inbox.count),['0 requests waiting','1 request waiting','2 requests waiting']);
  assert.deepEqual([0,1,2].map(W.devs.count),['0 active missions','1 active mission','2 active missions']);
  assert.deepEqual([0,1,2].map(W.project.issuesCount),['0 issues','1 issue','2 issues']);
  assert.deepEqual([0,1,2].map(W.project.tickets),['0 tickets','1 ticket','2 tickets']);
  assert.deepEqual([0,1,2].map(W.project.questions),['0 questions waiting','1 question waiting','2 questions waiting']);
  assert.deepEqual([1,2].map(W.phase.devs),['1 ticket','2 tickets']);assert.deepEqual([1,2].map(W.phase.waiting),['1 question','2 questions']);
});

test('the watcher says when it was last seen, and nothing it cannot know',()=>{
  assert.equal(W.watcher.watching('10:22'),'Last seen · 10:22');assert.equal(W.watcher.watching(''),'Watching');
  assert.equal(W.watcher.last('10:22'),'Last seen · 10:22');assert.equal(W.watcher.last(''),'Last seen: unknown');
});

test('dates and ages are written in English here, whatever the V3 does',()=>{
  assert.equal(dayOf('2026-11-03T10:00:00Z'),'3 Nov');assert.equal(dayOf('nope'),'');assert.equal(dayOf(null),'','a missing date stays unknown');assert.equal(dayOf(undefined),'');
  const now=Date.parse('2026-11-10T12:00:00Z'),ago=ms=>ageOf(now-ms,now);
  assert.equal(ago(30000),'<1m');assert.equal(ago(60000),'1m');assert.equal(ago(59*60000),'59m');assert.equal(ago(3600000),'1h');assert.equal(ago(23*3600000),'23h');
  assert.equal(ago(24*3600000),'1d');assert.equal(ago(47*3600000),'1d');assert.equal(ago(48*3600000),'2d');
  assert.equal(ageOf(NaN,now),'—');assert.equal(ageOf(undefined,now),'—');assert.equal(ageOf(now+5000,now),'<1m','a clock ahead is no negative age');
});

test('what the feed could not read is said by the name of its screen',()=>{
  const at='2026-11-10T09:05:00';
  assert.deepEqual(feedLines({'snapshot.json':'Busy.'},at),['Couldn’t refresh agent status. Last update: 09:05. Busy.']);
  assert.deepEqual(feedLines({'snapshot.json':'Busy.'},null),['Couldn’t refresh agent status. Busy.']);
  assert.deepEqual(feedLines({'my-issues.json':'No','missions.json':'No','inbox.json':'No'},at),['Couldn’t refresh Inbox: No','Couldn’t refresh Development: No','Couldn’t refresh Issues: No']);
  assert.deepEqual(feedLines({'issues-alpha.json':'No'},at),['Couldn’t refresh Issues alpha: No']);
  assert.deepEqual(feedLines({'other.json':'No'},at),['Couldn’t refresh other.json: No']);
  assert.deepEqual(feedLines(null,at),[]);
});

test('the tabs: only agents chosen and alive; a tab removed does not touch the agent; Pilot is never offered',()=>{
  const agents=[{address:'t1',tab_name:'PILOT',status:'idle'},{address:'t2',tab_name:'XJ-2 · dev',status:'working'},{address:'t3',tab_name:'XJ-3 · revue',status:'blocked'}];
  assert.deepEqual(agentTabs(['t2','gone','t1'],agents,'t1'),[{address:'t2',name:'XJ-2 · dev',dot:'work'}]);
  assert.deepEqual(agentTabs(null,agents,'t1'),[]);
  assert.deepEqual(pickableAgents(['t2'],agents,'t1').map(a=>a.address),['t3']);
  assert.equal(agentDot('blocked'),'blocked');assert.equal(agentDot('done'),'done');assert.equal(agentDot('idle'),'idle');assert.equal(agentDot(undefined),'off');
});

test('the watcher is running while it beat less than fifteen seconds ago; unknown stays unknown',()=>{
  const now=Date.parse('2026-11-09T12:00:20Z');
  assert.deepEqual(watcherOf({at:'2026-11-09T12:00:10Z'},now),{running:true,at:'2026-11-09T12:00:10Z'});
  assert.deepEqual(watcherOf({at:'2026-11-09T11:59:00Z'},now),{running:false,at:'2026-11-09T11:59:00Z'});
  assert.deepEqual(watcherOf(null,now),{running:false,at:null});
});

test('a mod is never named in the code without existing',async()=>{
  const {readdir}=await import('node:fs/promises'),mods=await readdir(new URL('../mods/',import.meta.url)),known=new Set([...mods,...Object.values(SCREENS)].map(n=>"'"+n+"'"));
  for(const mod of mods.filter(n=>n.startsWith('fabrique-console-v4-'))) {
    const source=await readFile(new URL('../mods/'+mod+'/main.js',import.meta.url),'utf8');
    for(const name of source.match(/'fabrique-console-v4-[a-z0-9-]*'/g)||[])assert.ok(known.has(name),mod+' names '+name);
  }
});

test('each screen is a layout that gives its page to the column and to the tabs',async()=>{
  for(const [page,name] of Object.entries(SCREENS)){
    const layout=JSON.parse(await readFile(new URL('../layouts/'+name+'.json',import.meta.url),'utf8')),text=JSON.stringify(layout);
    assert.ok(text.includes('"fabrique-console-v4-rail"'),name);
    for(const mod of ['fabrique-console-v4-bar','fabrique-console-v4-tabs'])assert.ok(text.includes(JSON.stringify({mod,props:{page}})),mod+' in '+name);
  }
});

test('an opened development says where it stands and who did what, from what the agents wrote',()=>{
  assert.deepEqual(stepsOf({step:'validating'}).map(s=>s.state),['done','done','now','todo']);
  assert.deepEqual(stepsOf({step:'delegated'}).map(s=>s.state),['now','todo','todo','todo'],'a Lead at work is preparing');assert.deepEqual(stepsOf({step:'requested'}).map(s=>s.state),['now','todo','todo','todo']);
  assert.deepEqual(stepsOf({step:'qa'}).map(s=>s.state),['done','now','todo','todo'],'the checks are part of the development');assert.deepEqual(stepsOf({step:'delegated'}).map(s=>s.label),['Prepare','Develop','Validate','Close']);
  assert.deepEqual(stepsOf({step:'closed'}).map(s=>s.state),['done','done','done','done'],'closed by the Lead: every step done');assert.deepEqual(stepsOf({step:'validated'}).map(s=>s.state),['done','done','done','now']);
  const reports=[{ticket:'XJ-2',kind:'dev',commit:'a',at:'2026-11-08T10:00:00.000Z',summary:'first'},{ticket:'XJ-2',kind:'review-1',commit:'a',verdict:'changes_requested',summary:'bug',at:'2026-11-08T10:05:00.000Z'},{ticket:'XJ-2',kind:'dev',commit:'b',at:'2026-11-08T11:00:00.000Z',summary:'fixed'},{ticket:'XJ-2',kind:'review-1',commit:'b',verdict:'accepted',summary:'ok',at:'2026-11-08T11:05:00.000Z'},{ticket:'XJ-3',kind:'dev',commit:'c',at:'2026-11-08T12:00:00.000Z',unreadable:true},{ticket:'XJ-2',kind:'ask',at:'2026-11-08T13:00:00.000Z'}];
  const story=ticketStory({id:'XJ-2',dev:'claude'},reports);
  assert.equal(story.dev.summary,'fixed','the last delivery');assert.deepEqual(story.reviews.map(r=>[r.n,r.verdict,r.by,r.tool]),[[1,'accepted','Codex','codex']],'only the reviews of that commit');
  assert.deepEqual(ticketStory({id:'XJ-9',dev:'codex'},reports),{dev:null,reviews:[]},'no report is no story');
  assert.deepEqual([reviewTone('accepted'),reviewTone('changes_requested'),reviewTone(null)],['ok','dec','unk']);
  const lines=storyLines([{id:'XJ-2',dev:'claude'}],reports,{at:'2026-11-09T09:00:00.000Z',verdict:'problèmes'});
  assert.deepEqual(lines.map(l=>l.text),[W.detail.qaProblems,W.detail.passed('XJ-2'),W.detail.delivered('XJ-2','Claude'),W.detail.changes('XJ-2'),W.detail.delivered('XJ-2','Claude')],'newest first, an unreadable report and a question are not events');
  assert.deepEqual(storyLines([],[],null),[]);
});

test('the page of an agent says who it is and leads back to its development; a Lead has its own page and colour',async()=>{
  const missions=[{id:'M-2',project:'alpha',issue:{identifier:'XJ-689',title:'Mes lots'},lead:{sessionId:'s2'},tickets:[{id:'XJ-690',title:'Contrat'}]}],sessions=[{id:'s2',terminalId:'t2n'}];
  const agents=[{address:'t2n',space:'x',tab_name:'1'},{address:'t3',space:'sp9',tab_name:'XJ-690 · dev'},{address:'t4',space:'fabrique-console-alpha-xj-689',tab_name:'QA · XJ-689'},{address:'t5',space:'other',tab_name:'notes'}],spaces=[{id:'sp9',name:'fabrique-console-alpha-xj-689'}];
  const head=address=>agentHead({address,agents,spaces,missions,sessions});
  assert.deepEqual(head('t2n'),{lead:true,title:W.tabs.lead('XJ-689'),task:'Mes lots',mission:'M-2',issue:'XJ-689'});
  assert.deepEqual(head('t3'),{lead:false,title:'XJ-690 · dev',task:'Contrat',mission:'M-2',issue:'XJ-689'},'a dev of the mission, by the name of its space: its ticket');
  assert.deepEqual(head('t4'),{lead:false,title:'QA · XJ-689',task:'Mes lots',mission:'M-2',issue:'XJ-689'},'the space may be known by its id');
  assert.deepEqual(head('t5'),{lead:false,title:'notes',task:null,mission:null,issue:null},'no development: no way back');
  assert.equal(head('gone'),null);
  const asked=[{mission:'M-2',state:'pending'}];
  assert.equal(leadWaits('t2n',missions,sessions,asked),true,'a Lead with a decision waiting says so');assert.equal(leadWaits('t3',missions,sessions,asked),false,'not its devs');
  assert.equal(leadWaits('t2n',missions,sessions,[{mission:'M-9',state:'pending'}]),false,'another mission');assert.equal(leadWaits('t2n',missions,sessions,[{mission:'M-2',state:'answered'}]),false,'answered: on its way');assert.equal(leadWaits('t2n',missions,sessions,null),false);
  assert.deepEqual(waitingOn([{state:'pending'},{state:'opening'},{state:'error'},{state:'answered'},{state:'delivered'}]).map(i=>i.state),['pending','opening','error']);
  const closedLead=agentHead({address:'t6',agents:[{address:'t6',space:'fabrique-console-alpha-xj-689',tab_name:'1'}],spaces,missions,sessions:[...sessions,{id:'old',terminalId:'t6',missionId:'M-1'}]});
  assert.deepEqual(closedLead,{lead:false,title:'1',task:null,mission:null,issue:null},'the Lead of a mission that is over is not taken for an agent of the new one');
  assert.equal(machineToShow({machine:null},'ai-dev'),null,'a machine that would hide the development is left');assert.equal(machineToShow({machine:null},'local'),'local');assert.equal(machineToShow({machine:'ai-dev'},'ai-dev'),'ai-dev');assert.equal(machineToShow({machine:null},undefined),null);assert.equal(machineToShow({machine:null},null),null);
  assert.equal(screenOfAgent('t2n',missions,sessions,[{key:'alpha',leadLayout:'generated'}]),'fabrique-console-v4-lead-alpha');assert.equal(screenOfAgent('t3',missions,sessions),SCREENS.agent);assert.equal(screenOfAgent(null,missions,sessions),SCREENS.agent);
  assert.equal(navModel({page:'lead',project:'alpha',projects:[{key:'alpha'}],missions:[],items:[],counts:{}}).projects[0].on,false,'nothing is marked in the column while talking to a Lead');
  const layout=name=>readFile(new URL('../layouts/fabrique-console-v4-'+name+'.json',import.meta.url),'utf8').then(JSON.parse);
  const look=await readFile(new URL('../ui/v4/look.js',import.meta.url),'utf8');
  assert.equal((await layout('lead')).colors.accent,/lead:'(#[0-9A-F]{6})'/.exec(look)[1],'the outline of its terminal is the colour of the Lead');
  assert.equal((await layout('agent')).colors.accent,'#6B6CF5');
  for(const name of ['lead','agent'])assert.ok(JSON.stringify(await layout(name)).includes('"fabrique-console-v4-agent-head"'));
});

test('what an agent wrote is cut to what reads at a glance: its first sentence and its numbered remarks',()=>{
  assert.deepEqual(reportDigest('Accepté techniquement, aucun bloquant. Vérifié sous Node 26.8.2, pnpm 10.7.1 : 211 tests verts. Remarques mineures, par gravité : (1) Mineur : le garde ne vérifie pas golf.view ; (2) Process : critère 3 non prouvé ;'),{head:'Accepté techniquement, aucun bloquant.',remarks:['Mineur : le garde ne vérifie pas golf.view','Process : critère 3 non prouvé']});
  assert.equal(reportDigest('Specs sur v2.1.0 : schémas communs. Suite.').head,'Specs sur v2.1.0 : schémas communs.','a version number does not end a sentence');
  assert.deepEqual(reportDigest('Une seule phrase sans point'),{head:'Une seule phrase sans point',remarks:[]});
  assert.deepEqual(reportDigest('Voir (1) seul. Fin.').remarks,[],'one number is not a list');
  const long=reportDigest('x'.repeat(50)+' '+'mot '.repeat(100));assert.ok(long.head.length<=221);assert.ok(long.head.endsWith('…'));
  assert.deepEqual(reportDigest(''),{head:'',remarks:[]});assert.deepEqual(reportDigest(null),{head:'',remarks:[]});
});

test('the full text of an agent is laid out without losing a word',()=>{
  const report="Accepté techniquement, aucun bloquant. Vérifié sous Node 26.8.2 : vitest verts ; specs épinglées. Garde réservée aux gérants ; admin refusé. Remarques mineures, par gravité : (1) Mineur : le garde ne vérifie pas golf.view. (2) Process : critère 3 non prouvé ;";
  assert.deepEqual(reportBlocks(report),[{text:'Accepté techniquement, aucun bloquant.'},{lead:'Vérifié sous Node 26.8.2',items:['vitest verts','specs épinglées']},{lead:null,items:['Garde réservée aux gérants','admin refusé']},{lead:'Remarques mineures, par gravité',items:['Mineur : le garde ne vérifie pas golf.view','Process : critère 3 non prouvé']}]);
  assert.deepEqual(reportBlocks('Limites : CI à vérifier ; tests sur FakeFirestore.'),[{lead:'Limites',items:['CI à vérifier','tests sur FakeFirestore']}]);
  assert.deepEqual(reportBlocks('Une phrase. Une autre.'),[{text:'Une phrase.'},{text:'Une autre.'}]);
  assert.deepEqual(reportBlocks('Sans ponctuation'),[{text:'Sans ponctuation'}]);
  assert.deepEqual(reportBlocks('(1) Premier ; (2) Second').at(-1),{lead:null,items:['Premier','Second']});
  assert.deepEqual(reportBlocks(''),[]);assert.deepEqual(reportBlocks(null),[]);
  const words=t=>t.replace(/[().;:]/g,' ').split(/\s+/).filter(w=>w&&!/^\d$/.test(w));
  const out=reportBlocks(report).flatMap(b=>b.items?[b.lead||'',...b.items]:[b.text]).join(' ');
  assert.deepEqual(words(out).sort(),words(report).sort(),'every word is still there');
});

test('validation: the code in one line, the steps of a test one by one, and the test to show',()=>{
  const r=(repo,pushed,pr=null,known=true)=>({repo,branch:'xj-689',pushed,pr,known});
  assert.deepEqual(codeSummary([r('admin',false),r('app',false)]),{branch:'xj-689',count:2,pushed:'none',prs:[],unknown:false});
  assert.equal(codeSummary([r('admin',true),r('app',false)]).pushed,'some');assert.equal(codeSummary([r('admin',true)]).pushed,'all');
  assert.deepEqual(codeSummary([r('admin',true,{number:21,url:'u'})]).prs,[{repo:'admin',number:21,url:'u'}]);
  assert.equal(codeSummary([r('admin',false,null,false)]).unknown,true,'GitHub unreadable is not no pull request');assert.equal(codeSummary([]),null);assert.equal(codeSummary(null),null);
  assert.deepEqual(testSteps('Connectez-vous avec un gérant. Regardez le menu v2.1 de gauche. Cliquez sur « Mes lots ».'),['Connectez-vous avec un gérant.','Regardez le menu v2.1 de gauche.','Cliquez sur « Mes lots ».']);
  assert.deepEqual(testSteps(''),[]);assert.deepEqual(testSteps(null),[]);
  const plan=[{id:'1'},{id:'2'},{id:'3'}];
  assert.equal(testIndex(plan,{},null),0);assert.equal(testIndex(plan,{1:{result:'ok'}},null),1,'the next one not checked');assert.equal(testIndex(plan,{1:{result:'ok'},2:{result:'ko'}},null),2,'a problem counts as checked');
  assert.equal(testIndex(plan,{1:{result:'ok'},2:{result:'ok'},3:{result:'ok'}},null),-1,'none left');assert.equal(testIndex(plan,{1:{result:'ok'}},0),0,'going back to one already checked');assert.equal(testIndex(plan,{},9),0,'a choice that does not exist is no choice');assert.equal(testIndex([],{},null),-1);
});

test('only the tickets that can start now are offered to launch',()=>{
  const t=(id,extra={})=>({id,state:'todo',dev:'claude',model:'m',effort:'high',deps:[],tracker:'backlog',...extra});
  assert.deepEqual(readyTickets([t('A'),t('B',{deps:['A']}),t('C',{deps:['1'],n:3})]).map(x=>x.id),['A'],'what waits for an unfinished ticket does not start');
  assert.deepEqual(readyTickets([t('A',{state:'merged',n:1}),t('B',{deps:['A']}),t('C',{deps:['1']})]).map(x=>x.id),['B','C'],'by identifier or by its number in the split');
  assert.deepEqual(readyTickets([t('A',{state:'dev'}),t('B',{dev:null}),t('C',{model:null}),t('D',{effort:null}),t('E',{tracker:'completed'}),t('F',{deps:['nope']})]),[]);
  assert.deepEqual(readyTickets(null),[]);
});

test('the launch is offered while a development is analysed or when tickets can start, as long as its Lead lives',()=>{
  const lead={address:'t1'},now=Date.parse('2026-11-10T12:00:00Z'),ready={id:'A',state:'todo',dev:'claude',model:'m',effort:'high',deps:[],tracker:'backlog'};
  assert.equal(launchState({step:'delegated',tickets:[]},lead,now),'offer','before any ticket exists');assert.equal(launchState({step:'analysing'},lead,now),'offer');
  assert.equal(launchState({step:'delegated'},null,now),null,'no Lead to ask');
  assert.equal(launchState({step:'delegated',launchAskedAt:'2026-11-10T11:59:00Z'},lead,now),'asked');assert.equal(launchState({step:'delegated',launchAskedAt:'2026-11-10T11:50:00Z'},lead,now),'offer','asked long ago: it can be asked again');
  assert.equal(launchState({step:'building',tickets:[]},lead,now),null);assert.equal(launchState({step:'building',tickets:[ready]},lead,now),'offer','a ticket left that can start');
});

test('a ticket accepted but not merged does not free what waits for it',()=>{
  const t=(id,extra={})=>({id,state:'todo',dev:'claude',model:'m',effort:'high',deps:[],tracker:'backlog',...extra});
  assert.deepEqual(readyTickets([t('A',{state:'accepted',tracker:'completed'}),t('B',{deps:['A']})]),[]);
  assert.deepEqual(readyTickets([t('A',{tracker:'completed'}),t('B',{deps:['A']})]).map(x=>x.id),['B'],'closed in Tracker, never run');
});

test('a request reads in one line, and in full laid out',()=>{
  assert.equal(itemSummary({summary:'Choisir les textes.',text:'Long.'}),'Choisir les textes.');
  assert.equal(itemSummary({text:'Première phrase. Deuxième phrase.'}),'Première phrase.');
  assert.ok(itemSummary({text:'x '.repeat(200)}).length<=142);assert.equal(itemSummary({}),'');
  const blocks=reportBlocks('Trois textes. 1) Libellé : A « Un » ; B « Deux » ; C « Trois ». 2) Note : A « Oui » ; B « Non ». 3) Fin sans choix.');
  assert.deepEqual(blocks,[{text:'Trois textes.'},{lead:'1. Libellé',items:['A « Un »','B « Deux »','C « Trois »']},{lead:'2. Note',items:['A « Oui »','B « Non »']},{text:'3. Fin sans choix'}]);
  assert.deepEqual(reportBlocks('Titre.\n- un\n- deux\nFin.'),[{text:'Titre.'},{lead:null,items:['un','deux']},{text:'Fin.'}]);
});

test('a Lead opens in the colour of its project, and an unknown project keeps the plain Lead page',async()=>{
  assert.equal(leadScreen({key:'demo',leadLayout:'generated'}),'fabrique-console-v4-lead-demo');assert.equal(leadScreen('autre'),'fabrique-console-v4-lead');assert.equal(leadScreen(undefined),'fabrique-console-v4-lead');assert.equal(leadScreen('constructor'),'fabrique-console-v4-lead');
  assert.equal(screenOfAgent('t1',[{project:'lba',lead:{sessionId:'s'}}],[{id:'s',terminalId:'t1'}],[{key:'lba',leadLayout:'generated'}]),'fabrique-console-v4-lead-lba');
  assert.equal(tintOf('#FF2E97').length,7);assert.notEqual(tintOf('#FF2E97'),tintOf('#39FF14'));
  const {readFile}=await import('node:fs/promises');
  const layout=JSON.parse(await readFile(new URL('../layouts/fabrique-console-v4-lead-demo.json',import.meta.url),'utf8'));
  assert.equal(layout.colors.accent,'#6B6CF5');assert.equal(layout.preview,'layouts/fabrique-console-v4-lead-demo.svg');
});

test('what is said twice is shown once',()=>{
  assert.equal(sameWords('Faire relire le plan ?','Faire relire le plan'),true);assert.equal(sameWords('Un.','Un'),true);
  assert.equal(sameWords('Textes de la page','Choisissez les textes de la page.'),false);
});

test('a mockup shows on the request it was published for, and on no other: the ticket ties nothing',()=>{
  const m={mockups:[{id:'MK-1',item:'I-3',ticket:null},{id:'MK-2',item:null,ticket:'XJ-2'},{id:'MK-3',item:'I-4',ticket:'XJ-2'}]},ids=x=>x.map(k=>k.id);
  assert.deepEqual(ids(mockupsFor(m,{item:'I-3'})),['MK-1']);assert.deepEqual(mockupsFor(m,{ticket:'XJ-2'}),[],'no request, no mockup');
  assert.deepEqual(ids(mockupsFor(m,{item:'I-3',ticket:'XJ-2'})),['MK-1'],'another request of that ticket never shows the mockup of the first');
  assert.deepEqual(mockupsFor(m,{item:'I-9',ticket:null}),[]);assert.deepEqual(mockupsFor({},{item:'I-3'}),[]);assert.deepEqual(mockupsFor(null),[]);
});

test('the answer recommended comes first, and a request says how long ago in words',()=>{
  assert.deepEqual(answersInOrder(['A','B','C'],'B'),['B','A','C']);assert.deepEqual(answersInOrder(['A','B'],'Autre'),['A','B'],'nothing is taken for recommended');assert.deepEqual(answersInOrder(null,'A'),[]);
  const now=Date.parse('2026-11-10T12:00:00Z');
  assert.equal(agoOf(now-2*3600000,now),'il y a 2 h');assert.equal(agoOf(now-12*60000,now),'il y a 12 min');assert.equal(agoOf(now-3*86400000,now),'il y a 3 j');assert.equal(agoOf(now-5000,now),"à l'instant");assert.equal(agoOf(NaN,now),'—');
});

test('each test is played in its mode: what the QA says, else its title, else its steps',()=>{
  assert.equal(testMode({mode:'app',title:'Backoffice : x'}),'app');
  assert.equal(testMode({title:'Backoffice : le champ'}),'browser');assert.equal(testMode({title:'App : la description'}),'app');
  assert.equal(testMode({title:'Pas de lien de reçu sans paiement',steps:"Dans l'app (simulateur ou iPhone), ouvre la fiche."}),'app');
  assert.equal(testMode({title:'Lien',steps:'Ouvre http://localhost:3000/events'}),'browser');
  assert.equal(testMode({title:'Reçu : un vrai paiement de test',steps:'Paie avec la carte 4242.'}),'special');
  assert.equal(testMode({mode:'other',title:'x'}),'special');assert.equal(testMode(null),'special');
});

test('test numbers read as ranges',()=>{
  assert.equal(testRanges(['7','8','9','10','11','12','16','17','18']),'7–12, 16–18');
  assert.equal(testRanges(['20']),'20');assert.equal(testRanges(['3','1','2','3']),'1–3');assert.equal(testRanges(['a','b']),'a, b');assert.equal(testRanges([]),'');
});

test('the brief before the QA: what the QA wrote, four points at most, tests that exist only; an older report says what it can',()=>{
  const plan=[{id:'1',auto:'ok'},{id:'2',auto:'ko',title:'Le reçu'},{id:'3',auto:'skipped'},{id:'4'}];
  const written=qaBrief({plan,found:['A',' ','B','C','D'],risks:['R'],checkFirst:[{text:'Décision ?',tests:['4','99'],decision:true},{text:''},{text:'x'},{text:'y'},{text:'z'},{text:'w'}]});
  assert.deepEqual(written.found,['A','B','C']);assert.equal(written.checkFirst.length,4);
  assert.deepEqual(written.checkFirst[0],{kind:'qa',text:'Décision ?',tests:['4'],decision:true});
  assert.deepEqual([written.played,written.forYou],[2,2]);
  const older=qaBrief({plan});
  assert.deepEqual(older.checkFirst,[{kind:'problem',text:'Le reçu',tests:['2'],decision:false},{kind:'notPlayed',text:'2',tests:['3','4'],decision:false}]);
  assert.deepEqual(older.found,[]);assert.deepEqual(qaBrief({plan,checkFirst:[]}).checkFirst,[],'written empty stays empty');
  assert.deepEqual(qaBrief(null),{found:[],checkFirst:[],risks:[],played:0,forYou:0});
});

test('a paragraph written for what the QA found is read as its sentences',()=>{
  assert.deepEqual(qaBrief({plan:[],found:'Le back-office marche. Le reçu aussi ! Rien dans l’app.'}).found,['Le back-office marche.','Le reçu aussi !','Rien dans l’app.']);
});

test('the problems go to the Lead in a message that always fits, the whole feedback left in its file',()=>{
  const list=Array.from({length:20},(_,i)=>({id:String(i+1),title:'T'.repeat(300),note:'<qa-problems> '+'N'.repeat(2000)}));
  const text=T.issue.val.problemsToLead('PRC-108',list,'/w/.fabrique-console/validation.json');
  assert.ok(text.length<=8000);assert.ok(text.includes('/w/.fabrique-console/validation.json'));assert.ok(text.includes('et 8 autres'));
  assert.equal(text.split('<qa-problems>').length,2,'one block only');
});

test('a request of a development goes in the row of its ticket, the others at the top, in the order of the Inbox',()=>{
  const items=[{id:'I-3',state:'pending',mission:'M-1',ticket:null,priority:2,createdAt:'2026-11-11T10:00:00Z'},{id:'I-1',state:'opening',mission:'M-1',ticket:'ABC-2',priority:1,createdAt:'2026-11-11T11:00:00Z'},
    {id:'I-2',state:'pending',mission:'M-2',ticket:'ABC-2',priority:1},{id:'I-4',state:'error',mission:'M-1',ticket:'ABC-9',priority:2,createdAt:'2026-11-11T09:00:00Z'},
    // Answered (as inbox-list keeps it until it is resolved), handed to the Lead, resolved: none of them waits any more.
    {id:'I-5',state:'answered',decision:'D-1',answered:'B',mission:'M-1',ticket:null,priority:1},{id:'I-6',state:'delegated',mission:'M-1',ticket:'ABC-2',priority:1},{id:'I-7',state:'resolved',mission:'M-1',ticket:null,priority:1}];
  const {asks,top}=missionRequests(items,{id:'M-1'},[{id:'ABC-2'},{id:'ABC-3'}]);
  assert.deepEqual(asks.map(i=>i.id),['I-1','I-4','I-3'],'only what still waits in this development, most urgent first');
  assert.deepEqual(top.map(i=>i.id),['I-4','I-3'],'no ticket, or a ticket that is not one of its own: at the top');
  assert.deepEqual(missionRequests(null,{id:'M-1'},null),{asks:[],top:[]});
});

test('the launch banner: the Lead preparing, then the tickets of its split ready, until the devs run',()=>{
  const lead={address:'w1:p1'},now=Date.parse('2026-11-11T12:00:00Z'),t=(id,n,deps=[],tracker='backlog',state='todo')=>({id,n,deps,tracker,state});
  assert.deepEqual(launchBanner({step:'delegated',tickets:[]},lead,{now}),{kind:'preparing',state:'offer',total:0,first:0});
  const tickets=[t('ABC-1',1),t('ABC-2',2),t('ABC-3',3,['1']),t('ABC-4',4,['2','3']),t('ABC-0',null),t('ABC-9',null,[],'completed')];
  assert.deepEqual(launchBanner({step:'analysing',tickets},lead,{now}),{kind:'ready',state:'offer',total:4,first:2},'the split only: an older sub-issue is not counted');
  assert.deepEqual(launchBanner({step:'delegated',tickets:[t('ABC-1',1,[],'completed'),t('ABC-2',2,['1']),t('ABC-3',3,['ABC-2'])]},lead,{now}),{kind:'ready',state:'offer',total:2,first:1},'waiting only for a finished ticket: it starts at the launch');
  assert.deepEqual(launchBanner({step:'delegated',tickets:[t('ABC-7',null),t('ABC-8',null,['ABC-7'])]},lead,{now}).total,2,'no split table: every open sub-issue');
  assert.equal(launchBanner({step:'delegated',launchAskedAt:'2026-11-11T11:59:00Z',tickets},lead,{now}).state,'asked');
  assert.equal(launchBanner({step:'delegated',tickets},null,{now}),null,'no Lead');
  assert.equal(launchBanner({step:'delegated',tickets},lead,{now,on:true}),null,'the devs already run');
  assert.equal(launchBanner({step:'building',tickets},lead,{now}),null,'launched');
  // The split is known before the finished tickets are put aside: an older sub-issue left open is not a ticket to start.
  assert.equal(launchBanner({step:'delegated',tickets:[t('ABC-2',1,[],'completed'),t('ABC-99',null)]},lead,{now}),null,'nothing of the split left to start');
  // A wait on a canceled ticket is over, as for the engine.
  assert.deepEqual(launchBanner({step:'delegated',tickets:[t('ABC-2',1,[],'canceled'),t('ABC-3',2,['1'])]},lead,{now}),{kind:'ready',state:'offer',total:1,first:1});
});

test('a browser test is read at the address its server really took, never another page of the Mac',()=>{
  const steps='Ouvrez http://localhost:3000/lots puis localhost:3000. L\'interface des émulateurs est sur http://127.0.0.1:4000. Port 30001 inchangé : localhost:30001.';
  assert.equal(atServer(steps,'http://localhost:3000','http://localhost:3001'),'Ouvrez http://localhost:3001/lots puis localhost:3001. L\'interface des émulateurs est sur http://127.0.0.1:4000. Port 30001 inchangé : localhost:30001.');
  assert.equal(atServer(steps,'http://localhost:3000','http://localhost:3000'),steps,'same port: unchanged');
  assert.equal(atServer(steps,null,'http://localhost:3001'),steps,'no planned address: unchanged');
  assert.equal(atServer(null,'http://localhost:3000','http://localhost:3001'),null);
  assert.equal(lastLine('a\n  b  \n\n'),'b');assert.equal(lastLine(null),null);
});

test('review: the address of another host is left as it is',()=>{
  assert.equal(atServer('http://notlocalhost:3000/x et my.localhost:3000','http://localhost:3000','http://localhost:3001'),'http://notlocalhost:3000/x et my.localhost:3000');
  assert.equal(atServer('(localhost:3000)','http://localhost:3000','http://localhost:3001'),'(localhost:3001)');
});

test('review 2: the steps take the real origin, protocol included',()=>{
  assert.equal(atServer('Ouvrez http://localhost:3000/x','http://localhost:3000','https://localhost:3443'),'Ouvrez https://localhost:3443/x');
  assert.equal(atServer('Ouvrez http://localhost:3000/x','http://localhost:3000','https://localhost:3000'),'Ouvrez https://localhost:3000/x','same port, another protocol');
  assert.equal(atServer('sur localhost:3000','http://localhost:3000','https://127.0.0.1:3001'),'sur 127.0.0.1:3001');
});

test('the column on the right: what waits for the user and the developments beside Pilot, the development of a Lead beside it',()=>{
  const now=Date.parse('2026-11-12T10:00:00Z');
  const tickets=[{id:'XJ-1',title:'Un',state:'merged'},{id:'XJ-2',title:'Deux',state:'accepted'},{id:'XJ-3',title:null,state:'todo'}];
  const missions=[{...mission('M-2','alpha','XJ-689','validating',tickets),tldr:'Tout est fusionné.'},mission('M-4','gz','GZ-1','building',[],'ai-dev')];
  const items=[{id:'I-2',type:'stuck',state:'pending',priority:2,title:'Fusion refusée',summary:'Des modifications non commitées',project:'alpha',issue:'XJ-689',ticket:'XJ-703',mission:'M-2',createdAt:'2026-11-11T19:00:00Z'},
    {id:'I-1',type:'validation',state:'pending',priority:1,title:'Valider XJ-689',project:'alpha',issue:'XJ-689',mission:'M-2',createdAt:'2026-11-12T09:55:00Z'},
    {id:'I-3',type:'decision',state:'answered',priority:1,title:'Déjà répondu',project:'alpha',createdAt:'2026-11-12T09:00:00Z'}];
  const pilot=rightModel({page:'pilot',items,missions,projects,machine:null,now});
  assert.deepEqual(pilot.items.map(i=>i.id),['I-1','I-2'],'only what still waits, the most urgent first');
  assert.deepEqual(pilot.items[0],{id:'I-1',item:items[1],agent:null,title:'Valider XJ-689',project:'Alpha',ref:'',reason:W.item.validation,urgent:true,ago:agoOf(Date.parse('2026-11-12T09:55:00Z'),now),mission:'M-2'},'with no summary, the kind of request is its reason');
  assert.equal(pilot.items[1].reason,'Des modifications non commitées','a request says why it waits');
  assert.equal(pilot.items[1].ref,'XJ-703','a request names its ticket when its title does not');
  assert.equal(pilot.items[0].ref,'','nor twice when it does');
  assert.deepEqual(pilot.devs.map(d=>d.mission),['M-2','M-4']);
  assert.deepEqual(pilot.devs[0],{mission:'M-2',issue:'XJ-689',title:'Titre M-2',project:'Alpha',step:W.steps.validating,tone:'review',done:1,total:3,ratio:1/3});
  assert.equal(pilot.devs[1].tone,'rev','a development being built has the colour of what moves');
  assert.deepEqual(rightModel({page:'pilot',items,missions,projects,machine:'local',now}).devs.map(d=>d.mission),['M-2'],'the machine chosen in the rail filters the developments');
  const blocked=[{address:'t9',name:'XJ-2 · dev',mission:'M-2'},{address:'t8',name:'GZ-5 · dev',mission:null}];
  const withAgents=rightModel({page:'pilot',items,missions,projects,blocked,asks:{t9:{command:'pnpm test',question:'Run it?'}},now});
  assert.deepEqual(withAgents.items.map(i=>i.id),['t9','t8','I-1','I-2'],'an agent stopped on its terminal waits for the user too, first, as in the Inbox');
  assert.deepEqual(withAgents.items[0],{id:'t9',item:null,agent:{address:'t9',mission:'M-2',ticket:'XJ-2'},title:'XJ-2 · dev · '+W.inbox.agentWaits,project:'Alpha',ref:'',reason:W.inbox.asksToRun+' pnpm test',urgent:true,ago:'',mission:'M-2'},'its reason is what its screen asks');
  assert.equal(withAgents.items[1].project,'','an agent outside any development says nothing of where');
  assert.equal(withAgents.items[1].reason,W.item.authorization,'its screen not read yet: the kind of request');
  assert.equal(rightModel({page:'pilot',items:[],missions,projects,blocked:[{address:'t7',name:'QA · XJ-689',mission:'M-2'}],now}).items[0].agent.ticket,'XJ-689','a QA stopped on its terminal is named by the issue it tests');
  assert.equal(rightModel({page:'pilot',items:[],missions,projects,blocked:[{address:'t7',name:'QA · X',mission:null}],now}).items[0].agent.ticket,null);
  const lead=rightModel({page:'lead',head:{lead:true,mission:'M-2'},items,missions,projects,blocked,now});
  assert.equal(lead.mission,'M-2');assert.equal(lead.issue,'XJ-689');assert.equal(lead.tldr,'Tout est fusionné.');assert.equal(lead.step,W.steps.validating);assert.equal(lead.tone,'review');
  assert.deepEqual(lead.steps,stepsOf(missions[0]));assert.deepEqual([lead.done,lead.total],[1,3]);
  assert.deepEqual(lead.groups.map(g=>[g.key,g.count]),[['accepted',1],['toLaunch',1],['merged',1]],'grouped by what each ticket needs, what is done last');
  assert.deepEqual(lead.groups[1],{key:'toLaunch',tone:'unk',hot:false,label:W.ticket.toLaunch,count:1,tickets:[{id:'XJ-3',title:''}],hidden:0});
  assert.deepEqual(lead.asks.map(i=>i.id),['t9','I-1','I-2'],'beside its Lead, only what waits for this development');
  assert.deepEqual(rightModel({page:'agent',head:{lead:false,mission:'M-2'},items,missions,projects,now}),{page:'agent',mission:null},'a dev or the QA of a mission is not its Lead: an empty column');
  assert.deepEqual(rightModel({page:'agent',head:null,items,missions,projects,now}),{page:'agent',mission:null},'an agent that leads nothing has an empty column');
  assert.deepEqual(rightModel({page:'lead',head:{lead:true,mission:'M-9'},items,missions,projects,now}),{page:'lead',mission:null},'a mission gone (closed) leaves the column empty');
});

test('the tickets beside a Lead: the urgent first and in amber, merged ones folded after eight lines',()=>{
  const many=[{id:'J-1',state:'fix',title:'Corriger'},{id:'J-2',state:'dev'},{id:'J-6',state:'dev',waitingAnswer:'Q-1'},{id:'J-3',state:'review'},{id:'J-4',state:'accepted',mergeRefused:true},{id:'J-5',state:'dev'},...Array.from({length:11},(_,n)=>({id:'M-'+n,state:'merged',title:'m'+n}))];
  const asking=[{status:'blocked',tab_name:'J-5 · dev'},{status:'working',tab_name:'J-2 · dev'}];
  assert.equal(askingTicket(asking,'J-5'),true);assert.equal(askingTicket(asking,'J-2'),false);assert.equal(askingTicket(asking,'J-'),false);
  const groups=ticketGroups(many,asking);
  assert.deepEqual(groups.map(g=>[g.key,g.count,g.hot]),[['asking',1,true],['waiting',1,true],['mergeRefused',1,true],['fix',1,true],['review',1,false],['dev',1,false],['merged',11,false]]);
  assert.deepEqual(groups.map(g=>g.label),[W.ticket.asking,W.ticket.waiting,W.ticket.mergeRefused,W.ticket.fix,W.ticket.review,W.ticket.dev,W.ticket.merged]);
  const merged=groups.at(-1);assert.equal(merged.tickets.length,MERGED_SHOWN);assert.equal(merged.hidden,11-MERGED_SHOWN);
  assert.equal(ticketGroups(many,asking,{all:true}).at(-1).hidden,0,'« show all » unfolds them');
  assert.deepEqual(ticketGroups([{id:'X',state:'merged',mergeRefused:true}]).map(g=>g.key),['merged'],'a merge refused then done is merged');
  const m={...mission('M-5','alpha','XJ-1','building',many)};
  const lead=rightModel({page:'lead',head:{lead:true,mission:'M-5'},items:[],missions:[m],projects,agents:asking});
  assert.deepEqual([lead.review,lead.fix],[1,2],'in review, and to fix (a merge refused is to fix)');
  assert.deepEqual(ticketLook({state:'merged',mergeRefused:true}),ticketPill({state:'merged'}));
});

test('Pilot, an agent and every Lead have the column on the right, beside the terminal; the other screens do not',async()=>{
  const layout=name=>readFile(new URL('../layouts/fabrique-console-v4-'+name+'.json',import.meta.url),'utf8').then(JSON.parse);
  const find=(node,id)=>node?.id===id?node:(node?.children||[]).map(c=>find(c,id)).find(Boolean)||null;
  for(const [name,page] of [['pilot','pilot'],['agent','agent'],['lead','lead'],['lead-demo','lead']]){
    const l=await layout(name),side=find(l,'fabrique-console-v4-side'),row=find(l,'with-side');
    assert.deepEqual(side?.content,{mod:'fabrique-console-v4-side',props:{page}},name);
    assert.equal(side.size.px,420,'the width of Claude Design, chosen by the user');
    assert.equal(row.resizable,false,name+': the column keeps its width');assert.equal(find(row,'main').resizable,false);
    assert.ok(find(row,'terminal'),name+': the terminal stays beside the column');
  }
  for(const name of ['inbox','devs','issues','project'])assert.equal(find(await layout(name),'fabrique-console-v4-side'),null,name);
});

test('the QA agent beside the Lead: launched with no report, done, stopped before its report, or its tab gone',()=>{
  const m=mission('M-4','beta','PRB-41','validating',[{id:'PRB-153',state:'dev'}]);
  const at=(h,mm)=>new Date(2026,10,12,h,mm).toISOString(),now=Date.parse(at(11,20));
  const tab=status=>({address:'t9',space:'s1',tab:'tb9',tab_name:'QA · PRB-41',status}),run={launchedAt:at(10,52),reportAt:null,done:false,tests:7,lastShotAt:at(11,13)};
  assert.equal(qaAgentOf(m,null,[tab('working')],{space:'s1',now}),null,'never launched: no line');
  assert.deepEqual(qaAgentOf(m,run,[tab('working')],{space:'s1',now}),{state:'running',dot:'work',agent:{address:'t9',space:'s1',tab:'tb9'},since:'10:52',tests:7,last:'11:13',report:null},'launched, no report: at work, how far, its tab');
  assert.equal(qaAgentOf(m,run,[tab('blocked')],{space:'s1',now}).state,'asking','waiting for the user in its terminal');
  for(const status of ['idle','done']){const x=qaAgentOf(m,run,[tab(status)],{space:'s1',now});assert.deepEqual([x.state,x.dot,x.agent?.address],['stopped','blocked','t9'],status+': stopped before its report, its tab still one click away');}
  const gone=qaAgentOf(m,run,[],{space:'s1',now});assert.deepEqual([gone.state,gone.agent],['gone',null],'no report and no tab: gone, nothing to go to');
  assert.equal(qaAgentOf(m,{...run,launchedAt:new Date(now-QA_OPENING_MS/2).toISOString()},[],{space:'s1',now}).state,'starting','just launched, its tab not seen yet');
  assert.equal(qaAgentOf(m,{...run,launchedAt:null},[],{space:'s1',now}).state,'gone','a launch with no known time is not opening');
  const done=qaAgentOf(m,{...run,done:true,reportAt:at(11,19),tests:13,lastShotAt:at(11,18)},[tab('done')],{space:'s1',now});
  assert.deepEqual([done.state,done.dot,done.tests,done.report,done.agent?.address],['done','done',13,'11:19','t9'],'its report written: done, whatever its tab says');
  assert.equal(qaAgentOf(m,{...run,done:true,reportAt:at(11,19)},[],{space:'s1',now}).state,'done','done even once its tab is closed');
  assert.equal(qaAgentOf(m,run,[{...tab('working'),space:'s2'}],{space:'s1',now}).state,'gone','a QA of the same name in another space is not this one');
  assert.equal(qaAgentOf(m,run,[{...tab('working'),tab_name:'QA · PRB-4'},{...tab('working'),tab_name:'PRB-41 · dev'}],{space:'s1',now}).state,'gone','another issue, or a dev of this one, is not its QA');
  assert.equal(qaAgentOf(m,run,[{...tab('working'),space:'s2'}],{now}).state,'running','with no Lead to place it, its tab is found by its name');
  assert.equal(qaAgentOf(m,run,[tab('unknown')],{space:'s1',now}).state,'unknown','a status Herdr does not give is not made up');
});

test('under the summary of a Lead: who runs now for the development, among the agents of its space, and when it was launched',()=>{
  const m=mission('M-2','alpha','XJ-689','validating',[{id:'XJ-702',state:'dev'},{id:'XJ-70',state:'review'}]);
  const at=(h,mm)=>new Date(2026,10,12,h,mm).toISOString(),started={t1:at(10,12),t2:at(9,30),t3:at(11,5)};
  assert.equal(clockAt(at(10,12)),'10:12');assert.equal(clockAt('nope'),null);
  const qa={address:'t1',space:'s1',tab_name:'QA · XJ-689',status:'working'},dev={address:'t2',space:'s1',tab_name:'XJ-702 · dev',status:'blocked'};
  assert.deepEqual(liveOf(m,[qa,dev],{space:'s1',started}),{kind:'qa',who:'XJ-689',address:'t1',waits:false,since:'10:12'},'the QA first, at the time its terminal was opened');
  assert.deepEqual(liveOf(m,[{...qa,status:'done'},dev],{space:'s1',started}),{kind:'dev',who:'XJ-702',address:'t2',waits:true,since:'09:30'},'a QA that finished does not run; a dev waiting for the user does');
  assert.deepEqual(liveOf(m,[{address:'t3',space:'s1',tab_name:'XJ-70 · revue 2',status:'working'}],{space:'s1',started}),{kind:'review',who:'XJ-70',address:'t3',waits:false,since:'11:05'},'a review has its time too');
  assert.equal(liveOf(m,[{...qa,space:'s2'},dev],{space:'s1',started}).kind,'dev','a QA of the same name in another space is not this development\'s');
  assert.equal(liveOf(m,[dev],{space:'s1'}).since,null,'its time not read yet: none said');
  assert.equal(liveOf(m,[{address:'t4',space:'s1',tab_name:'QA · XJ-1',status:'working'},{address:'t5',space:'s1',tab_name:'GZ-9 · dev',status:'working'},{...dev,status:'idle'}],{space:'s1',started}),null,'another development, or an agent at rest: nothing runs here');
  assert.deepEqual(workingTabs([qa,{...dev,status:'idle'},{address:'t6',status:'working',tab_name:'Pilot'}]).map(x=>x.a.address),['t1']);
  assert.deepEqual(rightModel({page:'lead',head:{lead:true,mission:'M-2'},items:[],missions:[m],projects,agents:[qa],started,space:'s1'}).live,{kind:'qa',who:'XJ-689',address:'t1',waits:false,since:'10:12'});
  const near=rightModel({page:'pilot',items:[{id:'I-9',state:'pending',type:'stuck',title:'Problème similaire à XJ-702',ticket:'XJ-70',project:'alpha',createdAt:at(9,0)},{id:'I-8',state:'pending',type:'stuck',title:'XJ-70 bloqué',ticket:'XJ-70',project:'alpha',createdAt:at(9,1)}],missions:[m],projects});
  assert.deepEqual(near.items.map(i=>i.ref),['XJ-70',''],'a ticket is in a title only by its whole identifier');
});

test('the launch time of an agent is read once per terminal, and asked again after a failure',async()=>{
  const live=[{address:'t1',status:'working',tab_name:'QA · XJ-689'},{address:'t2',status:'working',tab_name:'XJ-702 · dev'},{address:'t3',status:'idle',tab_name:'XJ-703 · dev'}];
  const calls=[];let down=true;
  const ask=async address=>{calls.push(address);if(address==='t1'&&down)throw new Error('down');return address==='t2'?{startedAt:null}:{startedAt:'2026-11-12T09:12:00.000Z'};};
  const cache={};
  await readStartedInto(cache,live,ask);
  assert.deepEqual(cache,{t2:null},'a failure keeps nothing; « no date » is an answer');
  down=false;await readStartedInto(cache,live,ask);
  assert.deepEqual(cache,{t2:null,t1:'2026-11-12T09:12:00.000Z'},'asked again once the service is back');
  await readStartedInto(cache,live,ask);
  assert.deepEqual(calls,['t1','t2','t1'],'never asked twice once answered; an agent at rest is not asked');
});
