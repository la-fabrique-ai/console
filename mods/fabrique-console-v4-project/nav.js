// Pure rules of the V4 shell: what the rail, the column and the tabs show, what each list holds. Tested with node --test.
import {W} from './words.js';
import {myIssueGroups,agentTerminal,clockOf,reviewerFor} from './view.js';

// ---- Dates, ages and read errors in the words of these screens: the V3 keeps its own.
// A date nobody knows stays unknown: new Date(null) would be read as 1 January 1970.
export const dayOf=at=>{const d=new Date(at??NaN);return Number.isFinite(d.getTime())?d.getDate()+' '+W.months[d.getMonth()]:'';};
const MINUTE=60000,HOUR=60*MINUTE,DAY=24*HOUR;
export function ageOf(at,now=Date.now()) {
  if(typeof at!=='number'||!Number.isFinite(at))return '—';
  const age=Math.max(0,now-at);
  if(age<MINUTE)return W.age.now;
  if(age<HOUR)return Math.floor(age/MINUTE)+W.age.minutes;
  if(age<DAY)return Math.floor(age/HOUR)+W.age.hours;
  return Math.floor(age/DAY)+W.age.days;
}
const FEED_VIEWS={'my-issues.json':W.nav.issues,'missions.json':W.nav.devs,'inbox.json':W.nav.inbox};
export function feedLines(errors,snapshotAt) {
  return Object.entries(errors||{}).sort(([a],[b])=>a.localeCompare(b)).map(([name,message])=>{
    if(name==='snapshot.json')return W.feed.snapshot(snapshotAt?clockOf(snapshotAt):'',message);
    const team=/^issues-(.+)\.json$/.exec(name);
    return W.feed.error(FEED_VIEWS[name]||(team?W.nav.issues+' '+team[1]:name),message);
  });
}

// One layout per screen; the column and the tabs receive the page in their props.
export const SCREENS={ticket:'fabrique-console-v4-ticket',sim:'fabrique-console-v4-sim',mockup:'fabrique-console-v4-mockup',pilot:'fabrique-console-v4-pilot',agent:'fabrique-console-v4-agent',lead:'fabrique-console-v4-lead',inbox:'fabrique-console-v4-inbox',issues:'fabrique-console-v4-issues',devs:'fabrique-console-v4-devs',project:'fabrique-console-v4-project'};
export const KEYS={planView:'fabrique-console.v4.plan-view',simShown:'fabrique-console.v4.sim-shown',qaProblems:'fabrique-console.v4.qa-problems',qaDecisions:'fabrique-console.v4.qa-decisions',qaMaximized:'fabrique-console.v4.qa-maximized',qa:'fabrique-console.v4.qa',qaShown:'fabrique-console.v4.qa-shown',barCollapsed:'fabrique-console.v4.bar-collapsed',ticket:'fabrique-console.v4.ticket',mockup:'fabrique-console.v4.mockup',machine:'fabrique-console.v4.machine',project:'fabrique-console.v4.project',tabs:'fabrique-console.v4.tabs',agent:'fabrique-console.v4.agent',mission:'fabrique-console.v4.mission',team:'fabrique-console.v4.issues-team',filter:'fabrique-console.v4.issues-filter',missions:'fabrique-console.v4.missions',inbox:'fabrique-console.v4.inbox',pilotAsked:'fabrique-console.v4.pilot-asked',ask:'fabrique-console.v4.ask'};
export const PILOT_TOOL='claude';
// A colour with its pale inside, like the action buttons: the colour over the dark of the cards.
export const tintOf=color=>{const n=parseInt(String(color).slice(1),16),mix=(c,dark)=>Math.round(c*.24+dark*.76).toString(16).padStart(2,'0');return '#'+mix(n>>16&255,0x1C)+mix(n>>8&255,0x20)+mix(n&255,0x29);};
// A Lead opens in the colour of its project: its page says which project it is before any name is read.
export const leadScreen=(project,projects=[])=>{const p=typeof project==='string'?projects.find(p=>p.key===project):project;return p?.leadLayout==='generated'&&/^[a-z0-9][a-z0-9_-]{0,47}$/.test(p.key)?'fabrique-console-v4-lead-'+p.key:SCREENS.lead;};
export const glyphOf=project=>(project?.icon&&project.icon!=='folder'?project.icon:null)||String(project?.name||project?.key||'?').slice(0,1).toUpperCase();

// ---- The machine chosen on the rail: null is every machine, 'local' this computer, a name another machine.
export const onMachine=(machine,chosen)=>chosen===null||chosen===undefined||(chosen==='local'?(machine===null||machine===undefined):machine===chosen);
export const machineWord=chosen=>chosen&&chosen!=='local'?chosen:W.rail.local;
export function railModel({machines,chosen,items}) {
  const others=(machines||[]).filter(m=>m.name);
  return [{key:null,label:W.rail.all,glyph:W.rail.allGlyph,on:chosen===null||chosen===undefined},
    {key:'local',label:W.rail.local,glyph:W.rail.localGlyph,on:chosen==='local',state:'ok',badge:(items||[]).length},
    ...others.map(m=>({key:m.name,label:m.name,glyph:String(m.name).slice(0,2).toLowerCase(),on:chosen===m.name,state:m.layout==='ready'?'ok':'off',badge:0}))];
}

// ---- A mission, as the lists say it.
export const missionsOf=(list,{machine=null,project=null}={})=>(list||[]).filter(m=>onMachine(m.machine,machine)&&(!project||m.project===project));
// What the tickets of a mission being built are doing: a question waits before anything else.
function activityOf(mission) {
  if(mission?.step!=='building')return '';
  const tickets=mission.tickets||[],waiting=tickets.filter(t=>t.waitingAnswer).length,working=tickets.filter(t=>t.state==='dev'||t.state==='fix').length;
  if(waiting)return W.phase.waiting(waiting);
  if(working)return W.phase.devs(working);
  return tickets.some(t=>t.state==='review')?W.phase.review:'';
}
const stepWord=mission=>W.steps[mission?.step]||'—';
export function phaseOf(mission) {const activity=activityOf(mission);return activity?stepWord(mission)+' · '+activity:stepWord(mission);}
// The column has room for one fact.
export const shortPhaseOf=mission=>activityOf(mission)||stepWord(mission);
export function missionProgress(mission) {
  const tickets=mission?.tickets||[],done=tickets.filter(t=>t.state==='merged').length;
  return {done,total:tickets.length,ratio:tickets.length?done/tickets.length:0};
}
const shortId=id=>String(id).split('-').pop();
export function ticketPill(ticket) {
  if(ticket?.waitingAnswer)return {tone:'dec',label:W.ticket.waiting};
  switch(ticket?.state) {
    case 'dev':return {tone:'rev',label:W.ticket.dev};
    case 'review':return {tone:'rev',label:W.ticket.review};
    case 'fix':return {tone:'dec',label:W.ticket.fix};
    case 'accepted':return {tone:'ok',label:W.ticket.accepted};
    case 'merged':return {tone:'merged',label:W.ticket.merged};
    default:return {tone:'unk',label:ticket?.deps?.length?W.ticket.waits(ticket.deps.map(shortId).join(', ')):W.ticket.toLaunch};
  }
}
export function ticketDetail(ticket) {
  const parts=[W.tools[ticket?.dev],ticket?.level==='fort'?W.strong:null,ticket?.deps?.length?W.ticket.after(ticket.deps.map(shortId).join(', ')):null].filter(Boolean);
  return parts.length?parts.join(' · '):'—';
}
// The titles of the tickets: a mission keeps their state, Tracker their words.
export function ticketTitles(data) {
  const titles=new Map();
  for(const team of data?.teams||[])for(const project of team.projects||[])for(const issue of project.issues||[])titles.set(issue.identifier,issue.title);
  for(const issue of data?.activity||[])if(!titles.has(issue.identifier))titles.set(issue.identifier,issue.title);
  return titles;
}

// ---- One development, opened: how far it is and who did what, from what the agents wrote.
// Four steps: the Lead prepares alone (plan, split, tickets), the agents develop (reviews and checks included), the user
// validates, then closes. Launching the devs, between the first two, stays the user's.
const STEP_AT={requested:0,delegated:0,analysing:0,building:1,qa:1,validating:2,validated:3,closed:4};
export function stepsOf(mission) {
  const at=STEP_AT[mission?.step]??0;
  return W.stepBar.map((label,n)=>({label,state:n<at?'done':n===at?'now':'todo'}));
}
const byTime=(a,b)=>String(a.at).localeCompare(String(b.at));
// What a ticket went through: the last report of its dev, and the reviews of that very commit.
export function ticketStory(ticket,reports) {
  const own=(reports||[]).filter(r=>r.ticket===ticket?.id&&!r.unreadable),dev=own.filter(r=>r.kind==='dev').sort(byTime).at(-1)||null;
  const reviews=dev?own.filter(r=>/^review-\d+$/.test(r.kind)&&r.commit===dev.commit).sort(byTime).map(r=>{const n=Number(r.kind.slice(7));const tool=reviewerFor(ticket.dev,n)?.tool||null;return {n,verdict:r.verdict,summary:r.summary||'',at:r.at,tool,by:W.tools[tool]||null};}):[];
  return {dev,reviews};
}
// What an agent wrote, in its own words but cut to what reads at a glance: its first sentence and the remarks it numbered.
const cutAt=(text,max)=>{if(text.length<=max)return text;const at=text.lastIndexOf(' ',max);return text.slice(0,at>0?at:max)+'…';};
export function reportDigest(text) {
  const clean=String(text||'').replace(/\s+/g,' ').trim(),head=/^(.+?[.!?])(?=\s+[A-ZÀ-Ý(]|$)/.exec(clean)?.[1]||clean;
  const marks=[...clean.matchAll(/(?:^|[\s:;])\((\d)\)\s+/g)];
  const remarks=marks.length>=2?marks.map((m,n)=>cutAt(clean.slice(m.index+m[0].length,marks[n+1]?.index??clean.length).replace(/[\s;.]+$/,''),170)):[];
  return {head:cutAt(head,220),remarks};
}
// The whole of what an agent wrote, every word kept, laid out to be read: a paragraph per sentence, an enumeration as a
// list under its heading, and the remarks it numbered as a list.
const LEAD_MAX=90;
function sentenceBlock(sentence) {
  const parts=sentence.replace(/[\s.;]+$/,'').split(/\s*;\s+/);
  if(parts.length<2)return {text:sentence};
  const colon=parts[0].indexOf(' : '),lead=colon>0&&colon<=LEAD_MAX?parts[0].slice(0,colon):null;
  return {lead,items:[lead?parts[0].slice(colon+3):parts[0],...parts.slice(1)]};
}
// Alternatives written in one breath ("Label : A « x » ; B « y »") get a line each.
function variantsOf(item) {
  const parts=item.split(/\s*;\s+(?=[A-Z]\s+«)/),first=/^(.*?)\s*:\s*([A-Z]\s+«.*)$/.exec(parts[0]);
  return parts.length>=2&&first?{lead:first[1],items:[first[2],...parts.slice(1)]}:null;
}
// What a request says in one line: what its author summed up, else its first sentence.
export const itemSummary=item=>item?.summary||cutAt(reportDigest(item?.text).head,140);
// How a test is played: in a browser (the back office), on the app, or neither (a payment, a rule, logs). The QA says
// it; a test written before says it by its title, else by its steps.
export function testMode(test) {
  if(['browser','app','special'].includes(test?.mode))return test.mode;
  const title=String(test?.title||''),steps=String(test?.steps||'');
  if(/^\s*(back.?office|admin|navigateur|web)\b/i.test(title))return 'browser';
  if(/^\s*(app|application|mobile|ios|android|iphone)\b/i.test(title))return 'app';
  if(/(dans l['’]app|simulateur|iphone)/i.test(steps))return 'app';
  if(/(back.?office|localhost:\d+|navigateur)/i.test(steps))return 'browser';
  return 'special';
}
// Test numbers as a person reads them: 7–12, 16–18.
export function testRanges(ids) {
  const list=[...new Set((ids||[]).map(String))];
  if(!list.length||!list.every(id=>/^\d+$/.test(id)))return list.join(', ');
  const numbers=list.map(Number).sort((a,b)=>a-b),parts=[];
  for(let n=0;n<numbers.length;n++){let end=n;while(end+1<numbers.length&&numbers[end+1]===numbers[end]+1)end++;parts.push(end>n?numbers[n]+'–'+numbers[end]:String(numbers[n]));n=end;}
  return parts.join(', ');
}
// What the user has in mind before his QA: what the QA found, what to check first (four at most), the risks. A report
// written before these fields says what it can: the problems the QA found, then the tests it could not play.
export function qaBrief(qa) {
  const plan=qa?.plan||[],played=plan.filter(t=>t.auto==='ok'||t.auto==='ko').length,known=id=>plan.some(t=>t.id===id);
  const lines=v=>(Array.isArray(v)?v:typeof v==='string'?v.split(/(?<=[.!?…])\s+/):[]).map(x=>String(x??'').trim()).filter(Boolean);
  let checkFirst=Array.isArray(qa?.checkFirst)?qa.checkFirst.filter(i=>String(i?.text??'').trim()).map(i=>({kind:'qa',text:String(i.text).trim(),tests:(Array.isArray(i.tests)?i.tests:[]).map(String).filter(known),decision:i.decision===true})):null;
  if(!checkFirst) {
    const ko=plan.filter(t=>t.auto==='ko'),open=plan.filter(t=>t.auto!=='ok'&&t.auto!=='ko');
    checkFirst=[...ko.map(t=>({kind:'problem',text:String(t.title||''),tests:[t.id],decision:false})),...(open.length?[{kind:'notPlayed',text:String(open.length),tests:open.map(t=>t.id),decision:false}]:[])];
  }
  return {found:lines(qa?.found).slice(0,3),checkFirst:checkFirst.slice(0,4),risks:lines(qa?.risks).slice(0,6),played,forYou:plan.length-played};
}
// The mockup published for a request: tied by the request it names, and by nothing else. The ticket ties nothing: two
// requests of one ticket never share a mockup.
export const mockupsFor=(mission,{item=null}={})=>item?(mission?.mockups||[]).filter(k=>k.item===item):[];
// What a card of the Inbox opens, to look at: the mockup published for its request, and those published for its ticket
// and for no request (decision 29: nothing leaves the Inbox). Looking ties nothing: a mockup of the ticket does not
// make the request a choice of mockup (mockupsFor), and one published for another request never shows.
export const mockupsToSee=(mission,{item=null,ticket=null}={})=>(mission?.mockups||[]).filter(k=>(item&&k.item===item)||(ticket&&!k.item&&k.ticket===ticket));
// What the screen of a mockup answers with: the publication it draws, the request that publication is for, and the
// version of that request as the list gave it when the publication was first drawn. Kept for as long as that
// publication shows: a version read later never takes its place; only one not yet known is filled in.
export function mockupShown(kept,mockup,items) {
  if(!mockup)return null;
  const published=mockup.pub||null,item=mockup.item||null;
  if(kept&&kept.mockup===mockup.id&&kept.published===published&&kept.item===item&&(kept.seen||!item))return kept;
  return {mockup:mockup.id,published,item,seen:item?(items||[]).find(known=>known.id===item)?.seen||null:null};
}
// What a choice sends: the publication, the request and its version, together, as they were drawn.
export const mockupPick=(shown,mission,variant,note)=>({mission,mockup:shown.mockup,variant,published:shown.published,...(note?{note}:{}),...(shown.item?{item:shown.item,...(shown.seen?{seen:shown.seen}:{})}:{})});
// How long ago, in words.
export function agoOf(at,now=Date.now()) {
  const short=ageOf(at,now),found=/^(\d+)([a-z]+)$/.exec(short);
  if(short===W.age.now)return W.inbox.ago.now;
  return found?W.inbox.ago.before+found[1]+(W.inbox.ago.units[found[2]]||found[2]):short;
}
// The answers of a request, the one its Lead recommends first.
export const answersInOrder=(answers,recommended)=>[...(answers||[]).filter(a=>a===recommended),...(answers||[]).filter(a=>a!==recommended)];
// The same words, whatever ends them: what is said twice is shown once.
export const sameWords=(a,b)=>{const bare=x=>String(x||'').replace(/[\s.?!…]+$/,'').trim();return bare(a)===bare(b);};
export function reportBlocks(text) {
  // The lines its author wrote are kept, and a run of "- x" is one list.
  const lines=String(text||'').split(/\n+/).map(line=>line.trim()).filter(Boolean);
  if(lines.length>1) {
    const out=[];
    for(const line of lines) {
      const item=/^[-•*]\s+(.+)$/.exec(line)?.[1];
      if(!item)out.push(...reportBlocks(line));
      else if(out.at(-1)?.list)out.at(-1).items.push(item);
      else out.push({lead:null,items:[item],list:true});
    }
    return out.map(({list:_list,...block})=>block);
  }
  const clean=String(text||'').replace(/\s+/g,' ').trim(),marks=[...clean.matchAll(/(?:^|[\s:;])\(?(\d)\)\s+/g)],numbered=marks.length>=2;
  const before=numbered?clean.slice(0,marks[0].index):clean,sentences=(before.match(/.+?(?:[.!?](?=\s+[A-ZÀ-Ý(])|$)/g)||[]).map(s=>s.trim()).filter(Boolean);
  if(!numbered)return sentences.map(sentenceBlock);
  const items=marks.map((m,n)=>clean.slice(m.index+m[0].length,marks[n+1]?.index??clean.length).replace(/[\s;.]+$/,'')),heading=/^(.*?)\s*:$/.exec(sentences.at(-1)||'')?.[1]??null;
  const intro=(heading?sentences.slice(0,-1):sentences).map(sentenceBlock);
  if(items.some(variantsOf))return [...intro,...(heading?[{text:heading+' :'}]:[]),...items.map((item,n)=>{const v=variantsOf(item);return v?{lead:(n+1)+'. '+v.lead,items:v.items}:{text:(n+1)+'. '+item};})];
  return [...intro,{lead:heading,items}];
}
// Where the code of a development stands, in one line: its repositories are said together.
export function codeSummary(repositories) {
  const list=repositories||[],pushed=list.filter(r=>r.pushed).length;
  if(!list.length)return null;
  return {branch:list[0].branch,count:list.length,pushed:pushed===0?'none':pushed===list.length?'all':'some',prs:list.filter(r=>r.pr).map(r=>({repo:r.repo,...r.pr})),unknown:list.some(r=>r.pr===null&&r.known===false)};
}
// The steps of a test, one sentence each.
export const testSteps=text=>(String(text||'').replace(/\s+/g,' ').trim().match(/.+?(?:[.!?](?=\s+[A-ZÀ-Ý(«])|$)/g)||[]).map(s=>s.trim()).filter(Boolean);
// A test written for the address of the plan, read at the address the server really took (another project may hold
// the planned port, the server may speak HTTPS): only that address changes, never another page of this Mac (the emulators).
const origin=url=>/^(https?):\/\/(localhost|127\.0\.0\.1):(\d{2,5})/.exec(String(url||''));
export function atServer(text,planned,real) {
  const from=origin(planned),to=origin(real);
  if(text==null||!from||!to||from[0]===to[0])return text;
  return String(text).replace(new RegExp('(?<![\\w.-])(https?://)?(?:localhost|127\\.0\\.0\\.1):'+from[3]+'(?!\\d)','g'),(_all,scheme)=>scheme?to[0]:to[2]+':'+to[3]);
}
// The last line a server said, when it gives no reason of its own.
export const lastLine=text=>String(text||'').split('\n').map(line=>line.trim()).filter(Boolean).at(-1)||null;
// The test to show: the one chosen, or the first not yet checked, or none once they all are.
export const testIndex=(plan,marks,chosen)=>Number.isInteger(chosen)&&plan[chosen]?chosen:(plan||[]).findIndex(t=>!marks?.[t.id]?.result);
// The tickets that can start now: not started, with their agent and model, and nothing left to wait for.
// A wait is over by the rule of the engine: the ticket waited for (by its identifier or its number in the split) is merged,
// or was never run and is done or canceled in Tracker.
const waitMet=list=>wait=>{const t=list.find(x=>x.id===String(wait)||(x.n!=null&&String(x.n)===String(wait)));return Boolean(t)&&(t.state==='merged'||(t.state==='todo'&&['completed','canceled'].includes(t.tracker)));};
export function readyTickets(tickets) {
  const list=tickets||[],met=waitMet(list);
  return list.filter(t=>t.state==='todo'&&!['completed','canceled'].includes(t.tracker)&&['claude','codex'].includes(t.dev)&&t.model&&t.effort&&(t.deps||[]).every(met));
}
// A launch whose fate is not known (decision 72): said unknown by the engine, or left « asking » by a stop midway, once
// the send could no longer be running (the click being sent is not). Never offered again meanwhile: the engine
// establishes whether the dev left (src/mission.mjs, launchSettled).
const SEND_RUNS_FOR=60000;
export function launchUnsure(mission,now=Date.now()) {
  const l=mission?.launch,at=Date.parse(l?.at||'');
  return l?.state==='unknown'||(l?.state==='asking'&&(!Number.isFinite(at)||now-at>=SEND_RUNS_FOR));
}
// The launch button of a development: offered while it is being analysed or when tickets can start, while its Lead lives.
const ASKED_FOR=120000,EARLY=['requested','delegated','analysing'];
export function launchState(mission,lead,now=Date.now()) {
  if(!lead)return null;
  const early=EARLY.includes(mission?.step),asked=Date.parse(mission?.launchAskedAt||'');
  if(early&&launchUnsure(mission,now))return null;
  // A launch the engine said not started (failed: not sent, or no dev asked after it) is offered again at once.
  if(early&&mission?.launch?.state==='failed')return 'offer';
  if(early&&Number.isFinite(asked)&&now-asked<ASKED_FOR)return 'asked';
  return early||readyTickets(mission?.tickets).length?'offer':null;
}
// The launch button of the Development screen: offered, and its Lead not working (decision 49: while the Lead breaks the
// issue down, no launch is offered, even with tickets already written).
export const launchOffered=(state,lead)=>state==='offer'&&lead?.status!=='working';
// The banner of the launch, before any dev runs: the Lead still preparing, or the tickets of its split ready (how many,
// how many start at once). A ticket already finished, or a sub-issue that is not in the split, is not counted.
export function launchBanner(mission,lead,{on=false,now=Date.now()}={}) {
  const state=launchState(mission,lead,now);
  if(!state||on||!EARLY.includes(mission?.step))return null;
  // The split is known on every ticket, finished or not; then only what is left to do counts. A ticket starts at the launch
  // when every wait of it is over, by the rule of the engine.
  const all=mission?.tickets||[],split=all.some(t=>t.n!=null)?all.filter(t=>t.n!=null):all,open=split.filter(t=>t.state!=='merged'&&!['completed','canceled'].includes(t.tracker)),met=waitMet(all);
  if(!split.length)return {kind:'preparing',state,total:0,first:0};
  return open.length?{kind:'ready',state,total:open.length,first:open.filter(t=>(t.deps||[]).every(met)).length}:null;
}
// The close of a development, from its Validation: offered once every test of the QA plan is marked (a problem is a mark:
// the user may close anyway) and every ticket of the split is accepted or done, while its Lead lives; asked, for two
// minutes. The Lead then checks and closes with lead-close.
const CLOSE_ASKED_FOR=120000;
export function closeState(mission,qa,lead,now=Date.now()) {
  if(!lead||!mission||['validated','closed'].includes(mission.step))return null;
  const plan=qa?.plan||[],marks=qa?.marks||{};
  if(!plan.length||!plan.every(t=>['ok','ko'].includes(marks[t.id]?.result)))return null;
  const all=mission.tickets||[],split=all.some(t=>t.n!=null)?all.filter(t=>t.n!=null):all;
  // A ticket of design, deferred, associated or integrated by another one is not developed in this delivery: it stays open
  // in the tracker and holds nothing, as for the engine.
  const due=split.filter(t=>t.kind!=='design'&&!['deferred','associated','integrated'].includes(t.delivery));
  if(!due.length||!due.every(t=>['merged','accepted'].includes(t.state)||['completed','canceled'].includes(t.tracker)))return null;
  const asked=Date.parse(mission.closeAskedAt||'');
  return Number.isFinite(asked)&&now-asked<CLOSE_ASKED_FOR?'asked':'offer';
}
export const reviewTone=verdict=>verdict==='accepted'?'ok':verdict==='changes_requested'?'dec':'unk';
// What happened, newest first: only what an agent wrote down, with the time it was written.
export function storyLines(tickets,reports,qa) {
  const tool=id=>W.tools[(tickets||[]).find(t=>t.id===id)?.dev]||null;
  const lines=(reports||[]).filter(r=>!r.unreadable&&r.at&&(r.kind==='dev'||/^review-\d+$/.test(r.kind))).map(r=>r.kind==='dev'?{at:r.at,text:W.detail.delivered(r.ticket,tool(r.ticket)),tone:'ok'}:r.verdict==='accepted'?{at:r.at,text:W.detail.passed(r.ticket),tone:'ok'}:{at:r.at,text:W.detail.changes(r.ticket),tone:'dec'});
  if(qa?.at)lines.push(qa.verdict==='ok'?{at:qa.at,text:W.detail.qaPassed,tone:'ok'}:{at:qa.at,text:W.detail.qaProblems,tone:'dec'});
  return lines.sort((a,b)=>byTime(b,a));
}

// ---- The issues, by project. A sub-issue is a ticket of its issue: it is followed in Développements, not listed here.
const CLOSED=['completed','canceled'];
// The issues of a project in order: in progress first, then to do, triage, backlog, done, canceled; at the same status,
// the most recent first.
const STATE_ORDER={started:0,unstarted:1,triage:2,backlog:3,completed:4,canceled:5};
export const issueOrder=rows=>[...(rows||[])].sort((a,b)=>(STATE_ORDER[a.issue?.state?.type]??6)-(STATE_ORDER[b.issue?.state?.type]??6)||(Date.parse(b.issue?.createdAt||'')||0)-(Date.parse(a.issue?.createdAt||'')||0));
export function issueSections(data,{filter='active',team=null,keys=null}={}) {
  if(!data)return [];
  const sections=new Map(),open=filter==='open';
  for(const group of myIssueGroups(data,open?'all':filter).groups)for(const row of group.issues) {
    if(row.issue.parentId||(team&&row.team.key!==team)||(keys&&!keys.has(row.team.key))||(open&&CLOSED.includes(row.issue.state?.type)))continue;
    if(!sections.has(row.team.key))sections.set(row.team.key,{key:row.team.key,name:row.team.name,order:row.order,rows:[]});
    sections.get(row.team.key).rows.push(row);
  }
  return [...sections.values()].sort((a,b)=>a.order-b.order).map(section=>({...section,rows:issueOrder(section.rows)}));
}
// What Issues works on: the project open in the column, else the chip chosen, and only on the machine shown. A choice
// made before the machine changed is no choice: a creation must never land in a project nobody sees.
export function issueTarget({projects,machine=null,project=null,team=null}) {
  const known=key=>(projects||[]).some(p=>p.key===key&&onMachine(p.machine,machine))?key:null;
  return {project:known(project),team:known(project)||known(team)};
}
export function openCounts(data) {
  if(!data)return {};
  const counts={};
  for(const group of myIssueGroups(data,'all').groups)for(const row of group.issues)if(!row.issue.parentId&&!CLOSED.includes(row.issue.state?.type))counts[row.team.key]=(counts[row.team.key]||0)+1;
  return counts;
}
export function issueMeta(row,missions) {
  const mission=(missions||[]).find(m=>m.issue?.id===row.issue.id);
  if(mission)return W.issues.mission(mission.id,W.steps[mission.step]||'—');
  const label=row.issue.labels?.[0]?.name,day=dayOf(row.issue.createdAt);
  return [label,day?W.issues.created(day):null].filter(Boolean).join(' · ');
}
// Tracker gives « In Progress » and « In Review » the same type: only the name tells them apart.
export const issueTone=(type,name)=>type==='started'&&/review|relecture/i.test(String(name||''))?'review':({unstarted:'rev',started:'ok',completed:'ok'})[type]||'unk';

// ---- The Inbox: what blocks agents first, then the oldest.
export const inboxOrdered=items=>[...(items||[])].sort((a,b)=>(a.priority??9)-(b.priority??9)||String(a.createdAt??'').localeCompare(String(b.createdAt??'')));
// The requests of one development that still wait, as the Inbox has them: those about one of its tickets go in that
// ticket's row, the others at the top of its page. One answered stays in the list until it is resolved: not here.
export const missionRequests=(items,mission,tickets)=>{const asks=inboxOrdered(waitingOn(items)).filter(i=>i.mission===mission?.id),ids=new Set((tickets||[]).map(t=>t.id));return {asks,top:asks.filter(i=>!ids.has(i.ticket))};};
export const itemKind=item=>({decision:{tone:'dec',label:W.item.decision},authorization:{tone:'dec',label:W.item.authorization},stuck:{tone:'inc',label:W.item.stuck},validation:{tone:'ok',label:W.item.validation}})[item?.type]||{tone:'unk',label:'—'};
export const itemUrgency=item=>item?.priority===1?{tone:'inc',label:W.item.urgent}:{tone:'unk',label:W.item.normal};

// ---- The column on the right. Beside Pilot: what waits for the user, then the developments, each one a step and a bar.
// Beside a Lead: its development, the summary first, then where each ticket is. An agent that leads nothing: empty.
// The state of a ticket as the Development screen shows it: its agent asking first, then a merge refused, then its pill.
export const askingTicket=(agents,id)=>(agents||[]).some(a=>a.status==='blocked'&&String(a.tab_name||'').startsWith(id+' '));
export const ticketLook=(ticket,asking=false)=>asking?{tone:'dec',label:W.ticket.asking}:ticket?.mergeRefused&&ticket.state!=='merged'?{tone:'dec',label:W.ticket.mergeRefused}:ticketPill(ticket);
// The tickets of a development, grouped by what they need, the most urgent first (Claude Design, 2026-11-12): what waits
// for the user or must be fixed, then what moves, then what is done. Merged ones fold after a few lines.
const TICKET_GROUPS=[['asking','dec',true],['waiting','dec',true],['mergeRefused','dec',true],['fix','dec',true],['review','rev',false],['dev','rev',false],['accepted','ok',false],['toLaunch','unk',false],['merged','merged',false]];
export const MERGED_SHOWN=8;
const groupOf=(t,asking)=>asking?'asking':t?.waitingAnswer?'waiting':t?.mergeRefused&&t.state!=='merged'?'mergeRefused':['fix','review','dev','accepted','merged'].includes(t?.state)?t.state:'toLaunch';
export function ticketGroups(tickets,agents=[],{all=false}={}) {
  const rows=(tickets||[]).map(t=>({id:t.id,title:String(t.title||''),group:groupOf(t,askingTicket(agents,t.id))}));
  return TICKET_GROUPS.map(([key,tone,hot])=>{
    const list=rows.filter(r=>r.group===key),shown=key==='merged'&&!all?list.slice(0,MERGED_SHOWN):list;
    return {key,tone,hot,label:W.ticket[key],count:list.length,tickets:shown.map(({id,title})=>({id,title})),hidden:list.length-shown.length};
  }).filter(g=>g.count>0);
}
// What runs now for a development and since when (Claude Design, 2026-11-12): its QA first, then a dev, then a review,
// while it works or waits for the user, among the agents of the Lead's space (where the chain opens their tabs). The time
// is when its terminal was opened (agent-started): a relaunch opens a new one.
const WORK_TAB=/^(?:(QA) · )?([A-Z][A-Z0-9]*-\d+)(?: · (dev|revue)(?: \d)?)?$/;
export const clockAt=at=>{const d=new Date(at??NaN);return Number.isFinite(d.getTime())?String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0'):null;};
export const workingTabs=agents=>(agents||[]).filter(a=>['working','blocked'].includes(a?.status)).map(a=>({a,m:WORK_TAB.exec(String(a.tab_name||''))})).filter(x=>x.m);
// The launch times read once per terminal: an answer is kept, even « no date »; a failure keeps nothing, so it is asked
// again at the next turn.
export async function readStartedInto(cache,agents,ask) {
  for(const address of workingTabs(agents).map(x=>x.a.address).filter(a=>a&&!(a in cache))){
    try{cache[address]=(await ask(address))?.startedAt||null;}catch{}
  }
  return cache;
}
export function liveOf(mission,agents,{space=null,started={}}={}) {
  const issue=mission?.issue?.identifier||null,ids=new Set((mission?.tickets||[]).map(t=>t.id));
  const named=workingTabs(agents).filter(x=>!space||x.a.space===space);
  const qa=named.find(x=>x.m[1]&&x.m[2]===issue),dev=named.find(x=>!x.m[1]&&x.m[3]==='dev'&&ids.has(x.m[2])),review=named.find(x=>!x.m[1]&&x.m[3]==='revue'&&ids.has(x.m[2]));
  const found=qa?{kind:'qa',who:issue,x:qa}:dev?{kind:'dev',who:dev.m[2],x:dev}:review?{kind:'review',who:review.m[2],x:review}:null;
  return found?{kind:found.kind,who:found.who,address:found.x.a.address,waits:found.x.a.status==='blocked',since:clockAt(started?.[found.x.a.address])}:null;
}
// The QA agent of a development, on a line beside its Lead (the user, 2026-11-12), from its launch to its report. Done
// once its report is written after its last launch; before it, its tab tells: at work, asking, stopped without its
// report, or gone. Just launched, a tab not seen yet is still opening. Its tab is looked for in the Lead's space.
export const QA_OPENING_MS=60000;
const QA_STATES={working:'running',blocked:'asking',idle:'stopped',done:'stopped'},QA_DOTS={running:'work',starting:'work',asking:'blocked',stopped:'blocked',gone:'blocked',done:'done',unknown:'off'};
export function qaAgentOf(mission,run,agents,{space=null,now=Date.now()}={}) {
  if(!run)return null;
  const issue=mission?.issue?.identifier||null,launched=Date.parse(run.launchedAt||'');
  const agent=issue?(agents||[]).find(a=>{const m=WORK_TAB.exec(String(a?.tab_name||''));return m&&m[1]==='QA'&&m[2]===issue&&!m[3]&&(!space||a.space===space);})||null:null;
  const state=run.done?'done':agent?QA_STATES[agent.status]||'unknown':Number.isFinite(launched)&&now-launched<QA_OPENING_MS?'starting':'gone';
  return {state,dot:QA_DOTS[state],agent:agent?{address:agent.address,space:agent.space,tab:agent.tab}:null,since:clockAt(run.launchedAt),tests:Number(run.tests)||0,last:clockAt(run.lastShotAt),report:clockAt(run.reportAt)};
}
const STEP_TONES={requested:'unk',delegated:'unk',analysing:'unk',building:'rev',qa:'rev',validating:'review',validated:'ok',closed:'ok'};
export function rightModel({page,head=null,items,missions,projects,agents=[],blocked=[],asks={},started={},space=null,machine=null,all=false,now=Date.now()}) {
  const names=new Map((projects||[]).map(p=>[p.key,p.name||p.key])),nameOf=key=>names.get(key)||key||'',byId=new Map((missions||[]).map(m=>[m.id,m]));
  // A request names its ticket when its title does not: two « merge refused » on two tickets stay apart.
  const refOf=i=>{const ref=i.ticket||i.issue||'';return ref&&!new RegExp('(?:^|[^A-Za-z0-9-])'+ref+'(?![0-9])').test(String(i.title||''))?ref:'';};
  const request=i=>({id:i.id,item:i,agent:null,title:String(i.title||'—'),project:nameOf(i.project),ref:refOf(i),reason:String(itemSummary(i)||itemKind(i).label),urgent:i.priority===1,ago:agoOf(Date.parse(i.createdAt),now),mission:i.mission||null});
  // An agent stopped on its terminal waits for the user like a request, before them, as in the Inbox; its reason is what
  // its screen asks, read as the Inbox reads it.
  const stopped=a=>{const m=byId.get(a.mission)||null,ticket=/^([A-Z][A-Z0-9]*-\d+)/.exec(String(a.name))?.[1]||m?.issue?.identifier||null,ask=asks?.[a.address]||null;
    return {id:a.address,item:null,agent:{address:a.address,mission:m?.id||null,ticket},title:String(a.name)+' · '+W.inbox.agentWaits,project:nameOf(m?.project),ref:'',reason:ask?.command?W.inbox.asksToRun+' '+ask.command:String(ask?.question||W.item.authorization),urgent:true,ago:'',mission:m?.id||null};};
  const waiting=(blocked||[]).map(stopped),asked=inboxOrdered(waitingOn(items)).map(request);
  if(page==='pilot')return {page,items:[...waiting,...asked],
    devs:missionsOf(missions,{machine}).map(m=>({mission:m.id,issue:m.issue?.identifier||m.id,title:String(m.issue?.title||''),project:nameOf(m.project),step:W.steps[m.step]||'—',tone:STEP_TONES[m.step]||'unk',...missionProgress(m)}))};
  // Only a Lead has a development of its own here: a dev or the QA of a mission leaves the column empty.
  const mission=head?.lead?head.mission:null,m=mission?byId.get(mission):null;
  if(!m)return {page,mission:null};
  const {done,total}=missionProgress(m),groups=ticketGroups(m.tickets,agents,{all});
  const count=key=>groups.find(g=>g.key===key)?.count||0;
  return {page,mission:m.id,issue:m.issue?.identifier||m.id,live:liveOf(m,agents,{space,started}),step:W.steps[m.step]||'—',tone:STEP_TONES[m.step]||'unk',steps:stepsOf(m),tldr:String(m.tldr||''),done,total,
    groups,review:count('review'),fix:count('fix')+count('mergeRefused'),
    asks:[...waiting.filter(r=>r.mission===m.id),...asked.filter(r=>r.mission===m.id)]};
}

// ---- The column: one thing is marked. Nothing is, while Pilot or an agent is on screen.
export function navModel({page,project,projects,missions,items,counts,waiting=0}) {
  const talking=page==='pilot'||page==='agent'||page==='lead',chosen=!talking&&(projects||[]).some(p=>p.key===project)?project:null;
  const general=name=>!talking&&!chosen&&page===name;
  return {inbox:{on:general('inbox'),count:(items||[]).length+waiting},issues:{on:general('issues')},devs:{on:general('devs')},
    projects:(projects||[]).map(p=>{
      const own=(missions||[]).filter(m=>m.project===p.key),hot=(items||[]).filter(i=>i.project===p.key).length,on=chosen===p.key,open=(counts||{})[p.key]||0;
      return {key:p.key,name:p.name||p.key,on,summary:own.length?W.side.missions(own.length):W.side.nothing,count:hot||open,hot:hot>0,
        missions:on?[]:own.map(m=>({mission:m.id,id:m.issue?.identifier||m.id,phase:shortPhaseOf(m)})),
        sub:on?[{key:'issues',on:page==='issues',count:open},{key:'devs',on:page==='devs',count:own.length}]:null};
    })};
}

// ---- The tabs: Pilot, then the agents the user chose to look at, while they live.
export const pilotOf=terminals=>agentTerminal(terminals,PILOT_TOOL)||agentTerminal(terminals,'codex');
export const agentDot=status=>({working:'work',blocked:'blocked',done:'done',idle:'idle'})[status]||'off';
const agentName=agent=>String(agent.tab_name||agent.title||agent.address);
export function agentTabs(added,agents,pilot) {
  const alive=new Map((agents||[]).map(a=>[a.address,a]));
  return (added||[]).filter(address=>address!==pilot&&alive.has(address)).map(address=>({address,name:agentName(alive.get(address)),dot:agentDot(alive.get(address).status)}));
}
// A Lead has its own page and colour: the user sees at a glance who he is talking to.
const missionLedBy=(address,missions,sessions)=>address?(missions||[]).find(m=>(sessions||[]).find(s=>s.id===m.lead?.sessionId)?.terminalId===address)||null:null;
// What still waits for the user: an element answered is on its way, it no longer needs him.
export const waitingOn=items=>(items||[]).filter(i=>['pending','opening','error'].includes(i.state));
// A Lead that waits for the user says so, whatever its terminal reports: an element of the Inbox is open on its mission.
export const leadWaits=(address,missions,sessions,items)=>{const m=missionLedBy(address,missions,sessions);return Boolean(m)&&waitingOn(items).some(i=>i.mission===m.id);};
export const screenOfAgent=(address,missions,sessions,projects=[])=>{const led=missionLedBy(address,missions,sessions);return led?leadScreen(led.project,projects):SCREENS.agent;};
// The head of an agent's page: who it is, what it works on, and the development it belongs to when it has one.
export function agentHead({address,agents,spaces,missions,sessions}) {
  const agent=(agents||[]).find(a=>a.address===address)||null;
  if(!agent)return null;
  const led=missionLedBy(address,missions,sessions),spaceName=(spaces||[]).find(s=>s.id===agent.space)?.name;
  const inSpace=m=>{if(!m.issue?.identifier)return false;const name='fabrique-console-'+m.project+'-'+m.issue.identifier.toLowerCase();return agent.space===name||spaceName===name;};
  // A terminal with a session of its own belongs to that work: the mission it led being over, it is not given another.
  const mission=led||((sessions||[]).some(s=>s.terminalId===address)?null:(missions||[]).find(inSpace)||null),ticket=/^(?:QA · )?([A-Z][A-Z0-9]*-\d+)/.exec(String(agent.tab_name||''))?.[1];
  return {lead:Boolean(led),title:led?W.tabs.lead(mission.issue?.identifier||mission.id):agentName(agent),task:(mission?.tickets||[]).find(t=>t.id===ticket)?.title||mission?.issue?.title||null,mission:mission?.id||null,issue:mission?mission.issue?.identifier||mission.id:null};
}
// The machine shown once back on a development: the one chosen, unless it would hide that development.
export const machineToShow=(mission,chosen)=>onMachine(mission?.machine,chosen)?chosen??null:null;
export const pickableAgents=(added,agents,pilot)=>(agents||[]).filter(a=>a.address!==pilot&&!(added||[]).includes(a.address)).map(a=>({address:a.address,name:agentName(a),space:a.space_name,dot:agentDot(a.status)}));

// ---- The watcher: alive while it beat less than fifteen seconds ago (the rule of watch-status).
export function watcherOf(file,now) {
  const at=file?.at??null,time=Date.parse(at||'');
  return {running:Number.isFinite(time)&&now-time<15000,at};
}
