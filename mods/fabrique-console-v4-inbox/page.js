// Pure rules of the page of a ticket (v2, Claude Design « page d'un ticket »): its head, its banner and the column
// « Right now », from what the engine already knows. Tested with node --test. Nothing is said that is not known: a part
// of the mockup whose function is not built yet (last sign of life) is left out; the pause is offered only by an engine
// that says it has it.
import {W} from './words.js';
import {waitingOn,inboxOrdered,launchBanner,launchUnsure,clockAt,codeSummary,mockupsFor} from './nav.js';
import {modelShort} from './view.js';

const P=W.page,PREPARE=['requested','delegated','analysing'],VALIDATE=['qa','validating','validated'];
// The three stages of the mockup, then Closed, from the steps of the engine of today.
export const stageOf=mission=>mission?.step==='closed'?'closed':VALIDATE.includes(mission?.step)?'validate':PREPARE.includes(mission?.step)||!mission?.step?'prepare':'develop';
const ORDER=['prepare','develop','validate'];
// The head: the title of the issue, its project and identifier, and where it stands among Prepare › Develop › Validate.
export function pageHead(mission,project) {
  const stage=stageOf(mission),at=stage==='closed'?ORDER.length:ORDER.indexOf(stage);
  return {title:String(mission?.issue?.title||mission?.request||'—'),sub:[project?.name||mission?.project,mission?.issue?.identifier||mission?.id].filter(Boolean).join(' · '),
    track:ORDER.map((key,n)=>({key,label:P.stages[key],state:n<at?'done':n===at?'on':'todo'}))};
}
// The tickets developed in this delivery, as the engine counts them, and those of them accepted.
export const dueTickets=mission=>{const all=mission?.tickets||[],split=all.some(t=>t.n!=null)?all.filter(t=>t.n!=null):all;return split.filter(t=>t.kind!=='design'&&!['deferred','associated','integrated'].includes(t.delivery)&&t.state!=='canceled');};
const accepted=t=>['accepted','merged'].includes(t.state);
export function pageCount(mission) {const list=dueTickets(mission);return {total:list.length,accepted:list.filter(accepted).length};}
// The ticket being worked on: fixed, reviewed or developed.
export const currentTicket=mission=>(mission?.tickets||[]).find(t=>['dev','fix','review'].includes(t.state))||null;
// Which dev develops a ticket: the plan says it (plan.tickets[].dev, 1 or 2), never the tool of the ticket: two devs can
// use the same tool. A ticket whose dev the plan does not say is one of Dev 1; a plan without tickets for both has one
// dev. The same numbers as the lanes of the plan (lineDev, lineDevs).
const devsSaid=mission=>{const said=new Map((mission?.plan?.tickets||[]).map(t=>[t.id,t.dev===2?2:1])),of=id=>said.get(id)||1,ids=(mission?.tickets||[]).filter(t=>t&&t.id).map(t=>t.id),two=ids.some(id=>of(id)===2)&&ids.some(id=>of(id)===1);return id=>two?of(id):1;};
export const devCount=mission=>(mission?.tickets||[]).some(t=>t&&devsSaid(mission)(t.id)===2)?2:1;
export const devOf=(mission,id)=>devsSaid(mission)(id);
// What waits for the user on this development, the most urgent first.
export const pageWaits=(items,mission)=>inboxOrdered(waitingOn(items)).filter(i=>i.mission===mission?.id);
// What a request is, beyond a question (simulation/CONTRAT.md): a suggestion, a verdict to decide, a choice of copy; a
// permission asked by an agent; a choice between the variants of a mockup published for it (decision 41).
export const askKind=(item,mission=null)=>item?.type==='authorization'?'permission':item?.kind==='mockup'||mockupsFor(mission,{item:item?.id}).length?'mockup':['suggestion','verdict','copy'].includes(item?.kind)?item.kind:'question';
// Who asks, as the engine writes it (M9 review 3, decision 98): the recipient of the request, the agent its answer goes
// to (src/requests.mjs: `dev`, `review-1`, `review-2`, `qa`, `lead`), said `dev`, `reviewer`, `qa` or `lead`. A request
// written without one (by hand, or by a page test of before) may say it in `from`. Nothing said: the Lead.
export const askedBy=item=>{const f=String(item?.recipient?.from??item?.from??'');return f==='dev'?'dev':/^review(-[12])?$|^reviewer$/.test(f)?'reviewer':f==='qa'?'qa':'lead';};
// Who asks, in the words of the page: a dev (Dev `dev`), the reviewer, the QA agent, else the Lead.
export const asker=(item,dev=1)=>{const by=askedBy(item);return by==='dev'?P.who.dev(dev):by==='reviewer'?P.answer.theReviewer:by==='qa'?P.answer.theQa:P.who.theLead;};
// The banner of a request, in the words of its kind (screens 14 to 20; N07 and N08 of the final list): its sentence, the
// ticket that waits and for what, and the word of its button. `overnight` (what was accepted since the last visit) is
// said first when the engine gives it (screen 18), only while a decision waits (decision 106, E1): « Overnight » for an
// absence that covers the night, else « Since your last visit » (E3); « So far » at the first visit (the engine gives
// `since: null`).
// The night: the absence began the day before now or earlier, in local time. A first visit (no instant) is not one.
export const coversNight=(since,now=Date.now())=>{const from=Date.parse(since);if(!Number.isFinite(from))return false;const d=new Date(now);return from<new Date(d.getFullYear(),d.getMonth(),d.getDate()).getTime();};
function askBand(item,kind,{count='',waiting=1,overnight=null,dev=1,now=Date.now()}={}) {
  const id=item.ticket||'',who=asker(item,dev),join=(...parts)=>parts.filter(Boolean).join(' · '),night=overnight?.accepted>0?(overnight.since===null?P.band.firstVisit:coversNight(overnight.since,now)?P.band.overnight:P.band.sinceVisit)(overnight.accepted,waiting):'';
  const [big,waits,label]=kind==='verdict'?[P.band.verdict,night?P.band.waitsVerdict:P.band.waitsAnswer,P.band.decide]:kind==='copy'?[P.band.copy(item.about||id),P.band.waitsChoice,P.band.choose]:kind==='mockup'?[P.band.mockup(id),P.band.waitsChoice,P.band.choose]
    :kind==='permission'?[P.band.permission(id,who),P.band.waitsAnswer,P.band.answer]:kind==='suggestion'?[P.band.suggestion(id,who),P.band.waitsAnswer,P.band.answer]:[P.band.question(id,who),P.band.waitsAnswer,P.band.answer];
  return {tone:'you',icon:'◆',big:night||big,det:join(id?waits(id):'',count),button:{key:'answer',label,item}};
}
// The pause, as the engine tells it (simulation/CONTRAT.md § 2 quater): `none` when it has the function and nothing is
// asked, `requested` while the agent at work finishes its turn, `paused` once nothing runs. Null when the engine does not
// say it has the function: nothing of the pause is drawn then, neither its button nor its banner.
export const pauseOf=story=>{const p=story?.pause;return p&&typeof p==='object'&&['none','requested','paused'].includes(p.state)?p:null;};
// Who finishes its turn while a pause is asked: the agent the engine names, else the one the ticket in hand tells (its
// reviewer while it is reviewed, else its dev).
const pausingAgent=(pause,mission,cur)=>{const a=pause?.agent||null,role=a?.role||(cur?(cur.state==='review'?'reviewer':'dev'):null);
  return role==='dev'?P.who.dev(a?.dev===2||a?.dev===1?a.dev:cur?devOf(mission,cur.id):1):role==='reviewer'?P.who.reviewer:role==='qa'?P.who.qa:'';};
// What stops a ticket, in the words of the banner (screens 12 and 13): the migration that fails when the engine names
// it, else the title of the request; « the Lead is on it » and « nothing for you to do » only when the engine says so.
export const stuckOf=(items,mission)=>pageWaits(items,mission).find(i=>i.type==='stuck')||null;
// How long a ticket has been stopped: from the instant it stopped (since, else when its request was made), never the
// time of its step, which began before. No instant told, no time.
export const stuckSpan=(stuck,{now=Date.now()}={})=>spanOf(stuck?.since||stuck?.createdAt,now);
// The Lead has finished when its terminal neither works nor waits in it (a permission, a question of its tool).
const leadDone=lead=>Boolean(lead)&&!['working','blocked'].includes(lead.status);
// What a Lead that does not work is said to do: held in its terminal (a permission, a question of its tool) it waits,
// it is not idle.
const leadRests=lead=>lead?.status==='blocked'?P.who.waiting:P.who.idle;
// The banner: one sentence, one line of detail, one main button at most. Its tone says the situation: ok ready or
// done, run an agent works, you the user is waited for, stop blocked, off nobody works. `qaNeeded` is false only when the
// plan is known to go without a QA (a single ticket, one review, then the sign-off): the engine does not say it yet, and
// the number of tickets alone never does.
export function pageBand({mission,lead=null,items=[],qa=null,on=false,qaNeeded=true,environment=null,overnight=null,pause=null,now=Date.now()}) {
  const stage=stageOf(mission),{total,accepted:acc}=pageCount(mission),waits=pageWaits(items,mission),stuck=waits.find(i=>i.type==='stuck'),asks=waits.filter(i=>i.type!=='stuck'),count=total?P.band.accepted(acc,total):'';
  const join=(...parts)=>parts.filter(Boolean).join(' · ');
  // Closed: merged into the base of the mission when the one approval merged it (the engine notes it), and « Reopen… ».
  if(stage==='closed'){const c=mission?.closure,repos=Array.isArray(c?.repositories)?c.repositories:[],merged=repos.length>0&&repos.every(r=>r?.merge?.status==='done');
    // « Open PR » (« je ne vois pas la PR »): the pull request the engine read merged, only a GitHub address.
    // One pull request per repository: « Open PRs » opens each of them.
    const urls=[...new Set(repos.map(r=>r?.pullRequest?.url).filter(u=>typeof u==='string'&&/^https:\/\/github\.com\//.test(u)))];
    return {tone:'ok',icon:'✓',big:merged?P.band.mergedInto(String(c.base||mission?.base||'main').replace(/^origin\//,'')):P.band.closed,det:merged?P.band.closedDet:'',button:{key:'reopen',label:P.band.reopen},...(urls.length?{second:{key:'pr',label:urls.length>1?P.band.openPrs:P.band.openPr,urls}}:{})};}
  if(stage==='prepare') {
    // The Lead waits: its questions and its suggestions are counted (screens 02 and 03). Another kind of request (a
    // choice of mockup, a permission) has its own banner, in the stage it comes in.
    if(asks.length) {
      const kinds=asks.map(i=>askKind(i,mission)),suggestions=kinds.filter(k=>k==='suggestion').length;
      if(!['question','suggestion'].includes(kinds[0]))return askBand(asks[0],kinds[0],{dev:devOf(mission,asks[0].ticket)});
      return {tone:'you',icon:'◆',big:P.band.leadWaits(kinds.filter(k=>k==='question').length,suggestions),det:P.band.approveAfter,button:{key:'answer',label:P.band.answer,item:asks[0]}};
    }
    // A launch whose fate is not known (decision 72): the grey banner of the pause, no button, the approval not offered
    // again; it goes once the engine knows whether the dev left (Develop) or not (failed: the approval offered again).
    if(launchUnsure(mission,now))return {tone:'off',icon:'–',big:P.band.checkingLaunch,det:P.band.launchNotConfirmed};
    const b=launchBanner(mission,lead,{on,now}),first=(mission?.tickets||[]).filter(t=>t.n!=null).sort((a,b)=>a.n-b.n)[0]||(mission?.tickets||[])[0];
    // With two devs the launch is the one of « the devs », and the first ticket is said with the dev that takes it (screen 40).
    const two=devCount(mission)>1,starter=first?devOf(mission,first.id):1;
    if(b?.kind==='ready'&&b.state==='asked')return {tone:'run',icon:'◠',big:two?P.band.startingDevs:P.band.starting,det:P.band.devStarting(starter)};
    const written=(mission?.tickets||[]).length,count=written?P.band.written(written):'';
    // While the Lead works, no launch is offered, whatever is already written (decision 49, screen 01): the plan is said
    // ready once it has finished. The engine marks no end of the plan: the status of the terminal of the Lead tells it.
    if(lead?.status==='working')return {tone:'run',icon:'◠',big:P.band.breaking,det:join(count,P.band.nothingToDo)};
    // The plan ready but the check of the environment failed (screen 07): the launch is drawn and held, a second button
    // opens the check. The sentence of the mockup is about the server; another failure keeps the sentence of the plan.
    if(b?.kind==='ready'&&leadDone(lead)&&environment?.ok===false)return {tone:'stop',icon:'!',big:(environment.checks||[]).some(c=>c?.key==='server'&&c.ok===false)?P.band.envFailed:P.band.planReady(b.total),det:P.band.envHeld,
      button:{key:'approve',label:P.band.approveDevs,disabled:true},second:{key:'check',label:P.band.seeCheck}};
    // « No open question » only when none is: the plan can say the Lead asks one (a request of the issue « asked ») that
    // has not reached the Inbox yet.
    const asking=(Array.isArray(mission?.plan?.requests)?mission.plan.requests:[]).some(r=>r?.state==='asked'&&!(Array.isArray(r.tickets)&&r.tickets.length));
    // « environment ready » (screen 04) only when the engine says the check succeeded (M6 b).
    if(b?.kind==='ready'&&leadDone(lead))return {tone:'ok',icon:'✓',big:P.band.planReady(b.total),det:join(asking?'':P.band.noQuestion,environment?.ok===true?P.environment.bandReady:'',first?P.band.firstTicket(first.id,b.total,starter):''),button:{key:'approve',label:two?P.band.approveDevs:P.band.approve}};
    // The Lead is said at work only when its terminal says so: none, idle or waiting, the banner says that instead.
    return {tone:'off',icon:'–',big:P.band.leadIs[!lead?'none':lead.status==='blocked'?'blocked':'idle'],det:count};
  }
  if(stage==='develop') {
    const cur=currentTicket(mission);
    // The pause comes first, as on the mockup: asked, the agent at work finishes its turn (N02 of the final list);
    // then nothing runs (screen 11). « Resume » takes both back.
    if(pause?.state==='paused')return {tone:'off',icon:'Ⅱ',big:P.band.paused(cur?.id||''),det:join(count,P.band.nothingRunning),button:{key:'resume',label:P.band.resume}};
    // What may still run and is not an agent seen at work (a launch not confirmed, a state not known) is said (M11 review
    // 1); lasting, it is an alert. Resume stays the user's: nothing resumes on its own.
    if(pause?.state==='requested'){
      const all=Array.isArray(pause.waiting)?pause.waiting:[],unsure=all.filter(w=>w&&w.why!=='working'&&P.band.pauseWho[w.role]),atWork=all.some(w=>w?.why==='working'),said=unsure.map(w=>P.band.pauseWho[w.role](w.ticket||'')+(P.band.pauseWhy[w.why]?' ('+P.band.pauseWhy[w.why]+')':''));
      return {tone:pause.alert===true?'stop':'off',icon:pause.alert===true?'!':'Ⅱ',big:P.band.pausing(unsure.length&&!atWork?'':pausingAgent(pause,mission,cur)),det:said.length?join(pause.alert===true?P.band.pauseLong:'',P.band.pauseWaits(said)):P.band.noNewWork,button:{key:'resume',label:P.band.resume}};
    }
    // A ticket stopped (screens 12 and 13): for how long, what fails, who is on it, and a button for its details.
    if(stuck){const id=stuck.ticket||cur?.id||'';return {tone:'stop',icon:'!',big:P.band.blocked(id,id?stuckSpan(stuck,{now}):''),
      det:join(stuck.migration?P.band.migrationFails(String(stuck.migration)):String(stuck.title||''),stuck.owner==='lead'?P.band.leadOnIt:'',stuck.forUser===false?P.band.nothingToDo:''),second:{key:'blocking',label:P.band.seeBlocking,item:stuck}};}
    if(asks.length)return askBand(asks[0],askKind(asks[0],mission),{count,waiting:asks.length,overnight,dev:devOf(mission,asks[0].ticket),now});
    if(total&&acc===total)return {tone:'ok',icon:'✓',big:qaNeeded?P.band.allAccepted(total):P.band.qaNotNeeded,...closing(mission,P.band.toValidate)};
    // « Pause » stands on the banner of a development that runs, when the engine has the function.
    const more=pause?.state==='none'?{second:{key:'pause',label:P.band.pause}}:{};
    if(cur)return {tone:'run',icon:'◠',big:P.band.onTrack(cur.id,cur.state,cur.rounds||0),det:join(count,P.band.nothingWaiting),...more};
    return {tone:'run',icon:'◠',big:P.band.onTrackIdle,det:join(count,P.band.nothingWaiting),...more};
  }
  // Validate: the QA plays, then the user tests what is left, problems and close being of the screens to come.
  const plan=qa?.plan||[],marks=qa?.marks||{},left=plan.filter(t=>!['ok','ko'].includes(marks[t.id]?.result)).length;
  if(asks.length)return {tone:'you',icon:'◆',big:P.band.waiting(asks.length),det:String(asks[0].title||''),button:{key:'answer',label:P.band.answer,item:asks[0]}};
  if(!plan.length)return {tone:'run',icon:'◠',big:P.band.qaRunning,det:P.band.nothingYet};
  if(left)return {tone:'you',icon:'◆',big:P.band.yourTurn(left),det:P.band.pointsDone(plan.length-left,plan.length),button:{key:'test',label:left===plan.length?P.band.startTesting:P.band.continueTesting}};
  return {tone:'ok',icon:'✓',big:P.band.allJudged,...closing(mission,P.band.pointsDone(plan.length,plan.length))};
}
// The end of a mission (points 28 to 30 of the brief, simple first): when everything is accepted, or every point checked,
// the user can close it; the Lead checks, then closes (mission-close, lead-close). Asked once, the band says so.
const closing=(mission,det)=>mission?.closeAskedAt?{det:[det,P.band.closeAsked].filter(Boolean).join(' · ')}:{det,button:{key:'close',label:P.band.close}};
// How long, in the words of the mockup: « 38 min », « 2 h 05 ».
export function spanOf(from,now=Date.now()) {
  const ms=now-Date.parse(from||'');
  if(!Number.isFinite(ms)||ms<0)return '';
  const min=Math.floor(ms/60000);
  return min<60?min+' min':Math.floor(min/60)+' h '+String(min%60).padStart(2,'0');
}
const TAB=/^(?:(QA) · )?([A-Z][A-Z0-9]*-\d+)(?: · (dev|revue)(?: (\d))?)?$/;
// Who works now, for the column: in Prepare the Lead; then the dev of the ticket in hand (Dev 1: the devs run in
// series), the reviewer while it reads, the QA agent, and the Lead when it is the one waited for. Each with the tab to
// open, when it has one. `started` holds the time each terminal was opened; `took` is how long the dev has run on the
// ticket in hand when the engine tells it: the same time as on the card and in the band, before the one of the terminal.
// `devs` are the devs of the plan when it has two (lineLanes): each has its line, which names the ticket it is on (`ticket`).
export function pageWorkers({mission,lead=null,agents=[],items=[],started={},space=null,now=Date.now(),took='',devs=null,pause=null}) {
  const stage=stageOf(mission),tickets=mission?.tickets||[],ids=new Set(tickets.map(t=>t.id)),issue=mission?.issue?.identifier||null,waits=pageWaits(items,mission);
  const tabs=(agents||[]).filter(a=>!space||a.space===space).map(a=>({a,m:TAB.exec(String(a.tab_name||''))})).filter(x=>x.m),live=x=>['working','blocked'].includes(x.a.status);
  const out=[];
  const leadRow=(what,dim=!lead||(lead.status!=='working'&&!waits.length))=>({key:'lead',kind:'lead',badge:'L',name:P.who.lead,tool:'',what,address:lead?.address||null,dim,warn:waits.length>0});
  if(stage==='prepare') {
    const ready=leadDone(lead)&&launchBanner(mission,lead,{now})?.kind==='ready';
    // In Prepare the Lead is the one who works: its line is faded only when it does not run (screens 01 to 07).
    return [leadRow(!lead?P.who.noLead:waits.length?P.who.waitingAnswer:lead.status==='working'?P.who.breaking:ready?P.who.planReady:leadRests(lead),!lead)];
  }
  if(stage==='develop'||stage==='validate') {
    // One line for each dev, in their order: with two devs (`devs`, those of the lanes) each has its own tickets, its
    // own tab, its own next ticket, and its tool and model are said even while it rests (screen 41).
    const hand=currentTicket(mission);
    for(const d of devs&&devs.length>1?devs:[null]) {
      const own=d?tickets.filter(k=>d.ids.includes(k.id)):tickets,mine=d?new Set(d.ids):ids,cur=d?own.find(k=>['dev','fix','review'].includes(k.state))||null:hand;
      const devTab=tabs.find(x=>!x.m[1]&&x.m[3]==='dev'&&mine.has(x.m[2])&&(!cur||x.m[2]===cur.id))||tabs.find(x=>!x.m[1]&&x.m[3]==='dev'&&mine.has(x.m[2])&&live(x));
      const t=devTab?own.find(k=>k.id===devTab.m[2]):cur,next=own.filter(k=>k.state==='todo').sort((a,b)=>(a.n??0)-(b.n??0))[0],n=d?.n||1;
      // The time the engine gives is the one of the ticket in hand: another dev at work is timed by its own terminal.
      const span=a=>(!d||t?.id===hand?.id?took:'')||spanOf(started?.[a.address],now);
      if(stage==='develop'||devTab) {
        const working=Boolean(devTab&&live(devTab)&&t&&t.state!=='review');
        // In pause the dev of the ticket in hand is said paused (screen 11); stopped while the Lead looks for a fix, it
        // is said to wait for the Lead (screen 12). Neither is faded: its ticket is the one the page is about.
        const held=t&&['dev','fix'].includes(t.state)?(pause?.state==='paused'?P.who.paused:waits.some(i=>i.type==='stuck'&&i.ticket===t.id&&i.owner==='lead')?P.who.stopped:''):'';
        const what=held?t.id+' · '+held:working?t.id+' · '+(devTab.a.status==='blocked'?P.who.asks:t.state==='fix'?P.who.fixing((t.rounds||1)+1):span(devTab.a)?P.who.inDevFor(span(devTab.a)):P.who.inDev):t&&t.state==='review'?P.who.inReview(t.id):t&&['dev','fix'].includes(t.state)?t.id+' · '+P.who.noLead:next?P.who.next(next.id):P.who.doneAll;
        out.push({key:n>1?'dev-'+n:'dev',kind:'dev',badge:'D'+n,name:P.who.dev(n),tool:d?d.label:[W.toolNames[t?.dev]||'',modelShort(t?.model)||''].filter(Boolean).join(' · '),what,address:devTab?.a.address||null,dim:!working&&!held,warn:!held&&devTab?.a.status==='blocked',...(d?{ticket:t?.id||null}:{})});
      }
    }
    for(const x of tabs.filter(x=>!x.m[1]&&x.m[3]==='revue'&&ids.has(x.m[2])&&live(x)))out.push({key:'review-'+x.a.address,kind:'review',badge:'R',name:P.who.reviewer,tool:'',what:P.who.inReview(x.m[2])+(x.m[4]?' · '+P.who.reviewN(x.m[4]):''),address:x.a.address,dim:false,warn:false});
    const qa=tabs.find(x=>x.m[1]&&x.m[2]===issue);
    if(qa)out.push({key:'qa',kind:'qa',badge:'QA',name:P.who.qa,tool:'',what:live(qa)?P.who.qaPlaying:P.who.qaDone,address:qa.a.address,dim:!live(qa),warn:qa.a.status==='blocked'});
    // A ticket stopped that the Lead takes care of, and nothing else waiting: the Lead looks for a fix (screen 12), it
    // does not wait for an answer.
    const fixing=Boolean(lead)&&waits.length>0&&waits.every(i=>i.type==='stuck'&&i.owner==='lead');
    if(fixing)out.push({...leadRow(P.who.lookingForFix,false),warn:false});
    else if(waits.length||stage==='validate'||!out.length)out.push(leadRow(!lead?P.who.noLead:waits.length?P.who.waitingAnswer:lead.status==='working'?P.who.working:leadRests(lead)));
    return out;
  }
  return [leadRow(!lead?P.who.noLead:leadRests(lead))];
}
// The agents whose tab the menu of the head opens: the Lead as soon as its terminal exists, whether or not it is among
// those who work now, then the devs at work.
export const pageTabs=(workers,lead=null)=>[...(lead?.address?[{key:'lead',label:P.menu.tabOf(P.who.lead),address:lead.address,kind:'lead'}]:[]),
  ...(workers||[]).filter(w=>w.address&&w.kind==='dev').map(w=>({key:w.key,label:P.menu.tabOf(w.name),address:w.address,kind:w.kind}))];
// What the reports of the agents say, for the activity, the newest first: a delivery is the one of the dev (Dev 1: the
// devs run in series), never named after its tool; a review asking for changes is said by its number; and a ticket is
// said accepted once, at the review that completed those it needs, which its state tells.
export function pageStory(tickets,reports,qa) {
  const kept=(reports||[]).filter(r=>!r.unreadable&&r.at&&(r.kind==='dev'||/^review-\d+$/.test(r.kind))),when=r=>Date.parse(r.at)||0;
  const whole=r=>['accepted','merged'].includes((tickets||[]).find(t=>t.id===r.ticket)?.state)&&!kept.some(o=>o!==r&&o.ticket===r.ticket&&o.kind!=='dev'&&o.verdict==='accepted'&&when(o)>when(r));
  const lines=kept.map(r=>r.kind==='dev'?{at:r.at,text:P.story.delivered(r.ticket,P.who.dev(1)),tone:'ok'}:r.verdict==='accepted'?{at:r.at,text:whole(r)?P.story.accepted(r.ticket):P.story.passed(Number(r.kind.slice(7)),r.ticket),tone:'ok'}:{at:r.at,text:P.story.changes(Number(r.kind.slice(7)),r.ticket),tone:'dec'});
  if(qa?.at)lines.push(qa.verdict==='ok'?{at:qa.at,text:P.story.qaPassed,tone:'ok'}:{at:qa.at,text:P.story.qaProblems,tone:'dec'});
  return lines.sort((a,b)=>when(b)-when(a));
}
// The recent activity: what the watcher wrote for this development, the newest first; the reports of the agents when it
// wrote nothing.
export function pageActivity(journal,lines,shown=5) {
  const kept=(journal||[]).filter(l=>l?.text).map(l=>({at:String(l.at||''),text:String(l.text),tone:l.tone||null})).reverse();
  const told=kept.length?kept:(lines||[]).map(l=>({at:clockAt(l.at)||'',text:String(l.text),tone:l.tone||null}));
  return told.slice(0,shown);
}
// The references: the issue in the tracker, the branch and where it comes from, the repositories, and the state of the
// code as the Development screen said it (pushed or not, pull requests).
export function pageRefs(mission,repositories,project) {
  const code=codeSummary(repositories),names=(repositories||[]).map(r=>String(r.repo||'')).filter(Boolean);
  return {issue:mission?.issue?.identifier?{label:P.refs.inTracker(mission.issue.identifier),url:/^https:\/\//.test(mission.issue.url||'')?mission.issue.url:null}:null,
    branch:mission?.branch?{name:mission.branch,from:mission.base?P.refs.from(String(mission.base).replace(/^origin\//,'')):''}:null,
    // The repository is the path of the project (the name of a worktree says nothing there, point 15 of the brief).
    repo:project?.repo||(names.length?names.join(', '):null),
    code:code?{state:code.pushed==='all'?W.check.pushed:code.pushed==='some'?W.check.somePushed:W.check.notPushed,prs:code.prs,noPr:code.prs.length?'':code.unknown?W.check.prUnknown:W.check.noPr}:null};
}
