import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { AppError, fail } from './common.mjs';
import { operationLock } from './operation-lock.mjs';

// The lane of the devs of a mission (workflow v2, ticket 3; decisions 46 and 48 of the owner).
//
// For a mission, one dev terminal is alive at most. It is asked for under the lock of the mission only, for the ticket
// that holds the lane, after herdr-core answered that no other lives. The lane is freed on a stop seen in the core,
// and on nothing else. This file is the one place that answers for it: the only run of a dev terminal of the
// repository is here, and nothing else writes the lane.
//
// What it stands on, seen on an isolated core (hc 0.1.21, 2026-11-13) before a line of it was written:
// `hc run --name N` is refused (name_taken, nothing made) while a live terminal holds N, for two requests at the same
// moment as for one after the other; `hc kill` then `hc get` answer finished (by its name too, with its labels, while
// no live terminal took the name since); the name of a finished terminal is free;
// a name nobody holds answers not_found; a terminal is found again by its name and known by its labels when the
// answer of its run was lost. So the dev of a mission runs under one name per mission, and the core itself refuses a
// second one alive. A core that does not answer, or answers something else, says nothing: unknown is never absent.
//
// The lane, kept in the file of the chain of the mission: null (free), or {ticket, launch, tab, terminal}. `tab` is
// `asked` from the moment the dev is about to be asked of the core (written before the request, and never erased by a
// failure), and `seen` once a reading of the core showed its terminal alive with the labels of that very launch.
// `terminal` is its address in the core, once known. `launch` numbers the launches of the mission.
export const devName=mission=>'mc-dev-'+createHash('sha256').update(String(mission)).digest('hex').slice(0,20);
// The tab of the window a dev shows in: its id is chosen here (the label herdr.tab), one per launch.
export const devTabId=(ticket,launch)=>'mc-dev-'+String(ticket).toLowerCase()+'-'+launch;
// The marks the patches of the mechanism of before left in the file of a chain. A file that carries no lane and was
// set on, or carries one of them or a launch, is of a mission launched by that mechanism. Such a mission stays blocked:
// its devs were tabs of the window, with no name nor label the core could find them by, so nothing here can see them
// stopped, and nothing here resets it on the word of a caller.
const OLD_MARK=/^(?:resumed|preparing|asked|shown|stopped)\|/;
export const launchedBefore=d=>Boolean(d.on)||Object.keys(d.done||{}).some(key=>key.startsWith('dev|')||OLD_MARK.test(key));
// What a lane kept in a file must be, or the file is not one the chain wrote.
export const validLane=lane=>lane===null||(Boolean(lane)&&typeof lane==='object'&&!Array.isArray(lane)&&typeof lane.ticket==='string'&&/^[A-Z][A-Z0-9]{0,9}-\d{1,7}$/.test(lane.ticket)&&Number.isInteger(lane.launch)&&lane.launch>0&&['asked','seen'].includes(lane.tab)&&(lane.terminal===null||(typeof lane.terminal==='string'&&/^t[0-9a-z]+$/.test(lane.terminal))));

// The lane reads herdr-core through its kernel (src/herdr.mjs, `kernel`): get, kill and run of a dev by its name.
// What a caller is told when the lane of its mission is held by another operation.
const BUSY_TEXT='Another operation is running on the devs of this mission. Try again in a moment.';
export function createDevLane({root,kernel,load,change,now=Date.now,wait=ms=>new Promise(done=>setTimeout(done,ms)),lock=operationLock,patienceMs=10000}) {
  const held=new Set(),dirOf=mission=>join(root,'state','devlane',String(mission));
  const safe=mission=>{if(typeof mission!=='string'||!/^[\w.-]{1,200}$/.test(mission))fail('INVALID_ARGUMENT','A mission is required.');return mission;};
  // The one function that takes the lock of the lane of a mission, held for the whole of the task, however long: it
  // falls on its own if the process dies. It is not reentrant: what runs under it never takes it. The watcher does not
  // wait (it skips the mission); a command tries the acquisition again, and the acquisition only, for ten seconds, then
  // says busy. A BUSY thrown by the task itself is handed up as it is: the task is never played twice.
  async function withLane(mission,task,{patient=true}={}) {
    const dir=dirOf(safe(mission)),until=now()+patienceMs;
    for(;;){
      let entered=false;
      try{
        return await lock(dir,async()=>{
          entered=true;held.add(mission);
          try{return await task();}finally{held.delete(mission);}
        });
      }catch(error){
        if(entered||error?.code!=='BUSY')throw error;
        if(!patient||now()>=until)throw new AppError('DEV_LANE_BUSY',BUSY_TEXT);
        await wait(100+Math.random()*100);
      }
    }
  }
  const under=mission=>{if(!held.has(mission))fail('DEV_LANE_UNLOCKED','The lane of a mission is read and written under its lock.');};
  const own=(terminal,mission,lane)=>terminal.labels['fabrique-console.mission']===mission&&terminal.labels['fabrique-console.ticket']===lane.ticket&&terminal.labels['fabrique-console.launch']===String(lane.launch);
  // Reads the lane and the core, and notes what a reading of the core proves: a dev asked for is seen. The state:
  // `old` (a mission of the mechanism of before: nothing of it is guessed), `free`, `foreign` (a terminal lives under
  // the name of the mission that is not the dev of the lane: blocked), `doubt` (asked for, and the core shows no
  // terminal of it), `live`, `gone` (seen, and now stopped: the lane is still its ticket's).
  async function look(mission) {
    under(mission);
    const d=await load(mission);
    if(d.old)return {state:'old',lane:null,terminal:null};
    const lane=d.lane??null,named=await kernel.get(devName(mission));
    if(!lane)return {state:named.state==='live'?'foreign':'free',lane:null,terminal:named.state==='live'?named:null};
    if(named.state==='live'){
      if(!own(named,mission,lane)||(lane.tab==='seen'&&lane.terminal!==named.address))return {state:'foreign',lane,terminal:named};
      if(lane.tab!=='seen'||lane.terminal!==named.address){
        const seen={ticket:lane.ticket,launch:lane.launch,tab:'seen',terminal:named.address};
        await change(mission,x=>{x.lane=seen;});
        return {state:'live',lane:seen,terminal:named};
      }
      return {state:'live',lane,terminal:named};
    }
    if(lane.tab==='asked')return {state:'doubt',lane,terminal:null};
    // Seen before: stopped only if its own address says so too.
    const at=lane.terminal?await kernel.get(lane.terminal):named;
    if(at.state==='live')return {state:'foreign',lane,terminal:at};
    return {state:'gone',lane,terminal:null};
  }
  // What the lane answers a launch of a ticket: `go` (a new launch), `again` (the same launch asked again: only the
  // gesture of a user, after a doubt), or why not. `auto` is the chain on its own; `resume` a launch asked as a resume.
  function decide(view,ticket,{auto=false,resume=false}={}) {
    if(view.state==='old')return 'old';
    if(view.state==='foreign')return 'blocked';
    if(view.state==='free')return 'go';
    if(view.lane.ticket!==ticket)return 'serial';
    if(view.state==='live')return 'already';
    if(view.state==='doubt')return auto?'doubt':'again';
    // Seen before and now stopped: a resume is safe, including the watcher's.
    return resume?'go':'already';
  }
  // Asks the core for the dev of a ticket, if the lane and the core allow it. The note (asked) is written before the
  // request and stays whatever becomes of it. The answer of the core gives the address; seen is for the next reading.
  async function request(mission,{ticket,auto=false,resume=false,cwd,argv,space}) {
    under(mission);
    const view=await look(mission),verdict=decide(view,ticket,{auto,resume});
    if(verdict!=='go'&&verdict!=='again')return {launched:false,reason:verdict};
    const lane=verdict==='again'?view.lane:await change(mission,d=>{
      d.laneSeq=(Number.isInteger(d.laneSeq)?d.laneSeq:0)+1;
      d.lane={ticket,launch:d.laneSeq,tab:'asked',terminal:null};
      if(d.done['dev|'+ticket]==null)d.done['dev|'+ticket]=now();
      return d.lane;
    });
    const tab=devTabId(ticket,lane.launch);
    let made;
    try{made=await kernel.run({name:devName(mission),cwd,argv,labels:{'fabrique-console.mission':mission,'fabrique-console.ticket':ticket,'fabrique-console.launch':String(lane.launch),...(space?{'herdr.space':String(space),'herdr.tab':tab}:{})}});}
    catch(error){
      if(!(error instanceof AppError))throw error;
      // Refused by the core: a terminal holds the name. After a doubt, it is the first request, arrived at last.
      if(error.code==='NAME_TAKEN'){const after=await look(mission);return {launched:false,reason:after.state==='live'?'already':'blocked'};}
      if(error.code==='LAUNCH_UNCERTAIN')return {launched:false,reason:'uncertain',message:error.message};
      throw error;
    }
    await change(mission,d=>{if(d.lane&&d.lane.ticket===ticket&&d.lane.launch===lane.launch&&d.lane.tab==='asked')d.lane={...d.lane,terminal:made.address};});
    return {launched:true,address:made.address,launch:lane.launch,tab};
  }
  // Frees the lane: its dev is killed, working or not, the core is read again, and the lane is free only if the core
  // says its terminal stopped and the name of the mission is held by no live terminal. A terminal under that name
  // that is not the dev of the lane is neither killed nor taken for it. A dev asked for whose address nobody knows is
  // stopped only if the core shows the terminal of that very launch, by its labels, stopped under the name of the
  // mission: a name nobody holds proves nothing (its request may still reach the core), and the lane stays held, as a
  // doubt, until that terminal shows and is stopped, or a user asks for it again (rule 1 of decision 48).
  async function release(mission) {
    under(mission);
    const d=await load(mission);
    if(d.old||!d.lane)return {freed:false,ticket:null};
    const lane=d.lane,name=devName(mission);
    if(lane.terminal&&(await kernel.get(lane.terminal)).state==='live')await kernel.kill(lane.terminal);
    const named=await kernel.get(name);
    if(named.state==='live'&&own(named,mission,lane)&&(lane.tab==='asked'||named.address===lane.terminal))await kernel.kill(named.address);
    const after=await kernel.get(name);
    const stopped=after.state!=='live'&&(lane.terminal?(await kernel.get(lane.terminal)).state!=='live':after.state==='finished'&&own(after,mission,lane));
    if(!stopped)return {freed:false,ticket:lane.ticket};
    await change(mission,x=>{if(x.lane&&x.lane.ticket===lane.ticket&&x.lane.launch===lane.launch)x.lane=null;});
    return {freed:true,ticket:lane.ticket};
  }
  return {withLane,look,decide,request,release};
}
