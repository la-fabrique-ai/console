import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDevChain } from '../../src/dev-chain.mjs';
import { createMissionRegistry } from '../../src/mission.mjs';
import { planOf } from '../../src/plan.mjs';
import { fakeHerdr } from './fake-herdr.mjs';

// A ticket as a Lead writes it in its plan, and the plan as its mission keeps it: each ticket with the identity read
// from the tracker (u2 for XJ-2), or the one given (null: never read).
export const planTicket=(id,rank,more={})=>({id,rank,title:'Lot '+id,result:'Ce que '+id+' doit donner',difficulty:'standard',agent:'claude',model:'claude-sonnet-5-5',effort:'high',...more});
export const TWO=[planTicket('XJ-2',1),planTicket('XJ-3',2,{deps:['XJ-2']})];
export const recordPlan=(missions,id,tickets,uids={})=>missions.update(id,m=>{
  const plan=planOf({tickets});
  m.plan={...plan,tickets:plan.tickets.map(t=>({...t,uid:uids[t.id]===undefined?'u'+t.id.split('-')[1]:uids[t.id]})),revision:(m.plan?.revision||0)+1,savedAt:'2026-11-09T09:00:00.000Z',tracker:{verified:true,verifiedAt:'2026-11-09T09:00:00.000Z'}};
});
// The plan approved by the user (ticket M5): the frozen copy the chain asks for before any dev, as the screen records it.
// The copy keeps the plan approved, whole (decision 77: the approval covers the tickets of that copy, and only them).
export const approvePlan=(missions,id)=>missions.update(id,m=>{m.approval={at:'2026-11-09T09:05:00.000Z',revision:m.plan?.revision??null,tickets:m.plan?.tickets?.length??0,...(m.plan?{plan:JSON.parse(JSON.stringify(m.plan))}:{})};});
// The chain without the page: the one fake Herdr (fake-herdr.mjs): its window (tabs made and closed) and its core (the
// devs are its terminals, answered as the real one was seen to), fake reports, a fake tracker issue of two
// tickets, and the mission of the issue (M-1, led by the session) with the plan of its Lead: two tickets, the second
// waiting for the first. `mission:false` leaves the session without a mission, `plan:null` the mission without a plan,
// `approved:false` the plan without the approval of the user.
// A dev shows in the window as the guide of Herdr says a labelled terminal does: in the tab of its label, unnamed
// until the chain renames it; closing its tab ends its terminal.
export async function setup(extra={},over={},{mission=true,plan=TWO,approved=true}={}){
  const root=await mkdtemp(join(tmpdir(),'fabrique-console-chain-'));
  if(mission){
    const missions=createMissionRegistry({root});
    await missions.create({project:'alpha',issue:{id:'i1',identifier:'XJ-1',title:'Paiement',url:'u'},request:'Payer',lead:{sessionId:'s1',lastSeen:null}});
    if(plan)await recordPlan(missions,'M-1',plan);
    if(plan&&approved)await approvePlan(missions,'M-1');
  }
  const session={id:'s1',role:'po',issueId:'i1',identifier:'XJ-1',terminalId:'t1',worktree:'/wt',step:'dev',...over},spaces=[];
  const kid=(id,uid,blockedBy=[])=>({id:uid,identifier:id,title:'Lot — '+id,state:{type:'unstarted'},labels:[{name:'agent:claude'},{name:'niveau:standard'}],model:'claude-sonnet-5-5',effort:'high',blockedBy});
  const issue={id:'i1',description:'Base : release/x\n',children:[kid('XJ-2','u2'),kid('XJ-3','u3',['u2'])]};
  const agents=[{address:'t1',space:'sp',tab:'po',tab_name:'PO · XJ-1',status:'idle'}],calls=[],sent=[],steps=[],reports=[],notified=[];let n=0;
  // The one fake Herdr: its core makes the devs, its window the other tabs; every dev the core made and every command
  // of the window is noted among the calls. A new tab is shown, as in the window; a selection shows the tab selected.
  const core=fakeHerdr({agents,spaces,shown:{space:'sp',tab:'other',name:'notes'},address:()=>'tx'+(++n),tabId:()=>'x'+(++n),
    onRun:term=>calls.push(['hc.run',{name:term.name,cwd:term.cwd,labels:{...term.labels},argv:term.argv,address:term.address}]),
    onDo:(command,args)=>calls.push([command,args])});
  // A transport of the test (a gate, a count) reaches the module of Herdr too, ending at the same fake.
  const make=(more={})=>createDevChain({root,invoke:core.invoke,herdr:(more.invoke||extra.invoke)?core.through(more.invoke||extra.invoke):core.herdr,loadState:async()=>({sessions:[session]}),detail:async()=>({issue}),
    reports:async()=>({reports:reports.map(r=>({...r})),command:"'node' '/r.mjs'"}),send:async x=>{sent.push(x);return {sent:true};},
    ensureWorktree:async()=>({path:'/wt',branch:'xj-1',base:'release/x',created:[],rebased:[],command:"'node' '/r.mjs'"}),
    setStep:async x=>{steps.push(x);session.step=x.step;},...extra,...more,notify:more.notify||extra.notify||(async(title,text)=>notified.push([title,text]))});
  const chain=make();
  const tab=name=>agents.find(a=>a.tab_name===name);
  return {root,chain,make,core,session,spaces,issue,kid,look:x=>core.show(x),agents,calls,sent,steps,reports,tab,notified,cleanup:()=>rm(root,{recursive:true,force:true})};
}
// The mission of the setup: Alpha, led by its session.
export const leadMission=async root=>{
  const missions=createMissionRegistry({root});
  return {missions,mission:await missions.read('M-1')};
};
// The tabs the chain made, by their names, in the order they were made: a dev (a terminal of the core) by the name its
// tab is given.
export const news=calls=>calls.flatMap(([c,a])=>c==='tab.new'?[a.name]:c==='hc.run'?[a.labels['fabrique-console.ticket']+' · dev']:[]);
// What the core was asked for the dev of a ticket: its folder (cwd), its argv, its labels.
export const devRun=(calls,ticket)=>calls.filter(([c,a])=>c==='hc.run'&&a.labels['fabrique-console.ticket']===ticket).at(-1)?.[1]||null;
export const devRuns=(calls,ticket)=>calls.filter(([c,a])=>c==='hc.run'&&a.labels['fabrique-console.ticket']===ticket).length;
export const FG2={identifier:'XJ-2',tool:'claude',model:'claude-sonnet-5-5',effort:'high'};

