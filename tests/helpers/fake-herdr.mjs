import { createHerdr } from '../../src/herdr.mjs';
import { commandOptions } from '../../src/common.mjs';

// The one fake Herdr of the tests (M2): every test that needs Herdr drives this one, through the real module of the
// engine (src/herdr.mjs, `herdr`), and fakes nothing above it. Two ways to use it:
// - simulated (the default): a herdr-core and a window that keep their terminals, tabs and spaces, below;
// - scripted (`on`): every command sent to Herdr is answered by `on(program, args, options)` as the test writes it, and
//   `program` is the name of the program the module was given (`hc`, `herdr-app`, or the names the test gives).
//
// The core: a herdr-core for the tests, at the level of the `hc` command: it answers as hc 0.1.21 was seen to answer on an
// isolated core (2026-11-13, proof of ticket 3 of the workflow v2), and supposes nothing more.
//
// What was seen, and is reproduced here:
// - `hc run --name N`: {address,agent,cwd,name,state:"live",turn:0} on stdout, exit 0. A second run under a name a
//   live terminal holds: nothing on stdout, {"error":{"kind":"name_taken",...}} on stderr, exit 1, and no terminal
//   made. Of two runs asked at the same moment, one is made and the other gets name_taken (five rounds out of five).
// - `hc get <name|address> --json`: the whole terminal, with its labels. By name: the live one that holds it, else a
//   finished one that held it. Nothing by that name or address: {"error":{"kind":"not_found"}} on stderr, exit 3.
// - `hc kill <t> --json`: the terminal, state "finished", reason "killed", exit 0; the same again on a finished one;
//   not_found (exit 3) on an unknown one. A killed terminal stays readable by its address.
// - The name of a finished terminal is free: a new run under it is made, with a new address.
// - A program that ends by itself leaves its terminal finished (reason "exited"), its name free.
// - `hc ls --json` lists the live terminals without their labels; `--label k=v` keeps those that carry it; `--all`
//   adds the finished ones.
//
// A terminal of the window whose agent ended keeps its shell (the guide of Herdr: tab.new): a test says so with the
// status null (no program reports one there).
//
// What a test may add, none of it seen on the real core, each a failure of the transport or a supposition named as
// such: an answer lost after the terminal was made (`lost`), a core that does not answer (`mute`), a request that
// reaches the core later (`late`, then `arrive()`), a program dead at its start (`dies`), a kill that fails (`fail`)
// or that leaves the terminal alive (`stays`, a supposition: the real kill was always final).
export function fakeHerdr({agents:given=null,onRun=null,address=null,on=null,hc='hc',herdrApp='herdr-app',spaces=[],shown=null,tabId=null,onDo=null}={}) {
  const terminals=[],pending=[];let n=0;
  // The tabs of the window: those of the test, else its own, kept from the first command to the last (never a list
  // thrown away after each command: a tab made, or a terminal of the core shown in a tab, stays listed).
  const agents=given??[];
  // The addresses the core gives: its own count, or the one of the test (a window that numbers its tabs with it).
  const next=address||(()=>'t'+(++n));
  // Faults of the window too: `do` ('fail' refuses a command of the window), `hidden` (the tabs its listing leaves out).
  const faults={run:null,get:null,kill:null,do:null,hidden:null};
  const refusal=(kind,message,exit)=>Object.assign(new Error('Command failed: hc'),{code:exit,stdout:'',stderr:JSON.stringify({error:{hint:'',kind,message}})+'\n'});
  const silent=()=>Object.assign(new Error('Command failed: hc'),{killed:true,signal:'SIGTERM',code:null,stdout:'',stderr:''});
  const ok=value=>({stdout:JSON.stringify(value)+'\n',stderr:''});
  // A terminal shown in the window (labels herdr.space and herdr.tab) whose tab was closed there has ended.
  const sync=()=>{for(const t of terminals)if(t.state==='live'&&t.shown&&!agents.includes(t))end(t,'killed');};
  const end=(t,reason)=>{t.state='finished';t.reason=reason;const i=agents.indexOf(t);if(i>=0)agents.splice(i,1);};
  const find=ref=>terminals.find(t=>t.state==='live'&&t.name===ref)||terminals.find(t=>t.address===ref)||terminals.filter(t=>t.name===ref).at(-1)||null;
  const whole=t=>({address:t.address,argv:t.argv,cwd:t.cwd,exit_code:t.reason==='exited'?1:null,keep:true,labels:{...t.labels},name:t.name,parent:null,reason:t.state==='finished'?t.reason:null,reported:t.status!=null,state:t.state,status:t.status??null,turn:0});
  const brief=t=>({address:t.address,agent:t.argv[0],cwd:t.cwd,name:t.name,state:t.state,turn:0});
  function make({name,cwd,labels,argv}) {
    if(terminals.some(t=>t.state==='live'&&t.name===name))throw refusal('name_taken','a live terminal is already named "'+name+'"',1);
    const t={address:next(),name,cwd,labels,argv,state:'live',reason:null,status:'working',shown:Boolean(labels['herdr.space']&&labels['herdr.tab'])};
    // In the window: a tab of the space of its label, whose id is the one of its label, unnamed until it is renamed.
    if(t.shown){t.space=labels['herdr.space'];t.tab=labels['herdr.tab'];t.tab_name=labels['herdr.tab'];}
    terminals.push(t);if(t.shown)agents.push(t);
    onRun?.(t);
    return t;
  }
  function parseRun(args) {
    const out={name:null,cwd:null,labels:{},argv:[]};
    for(let i=1;i<args.length;i++){
      const a=args[i];
      if(a==='--'){out.argv=args.slice(i+1);break;}
      if(a==='--name')out.name=args[++i];else if(a==='--cwd')out.cwd=args[++i];
      else if(a==='--label'){const [k,v]=args[++i].split(/=(.*)/s);out.labels[k]=v;}
      else if(!['--bg','--json','--no-parent','--outlive-parent','--keep'].includes(a))throw new Error('fake hc: unknown run option '+a);
    }
    return out;
  }
  const fault=(kind,args,more)=>typeof faults[kind]==='function'?faults[kind](args,more):faults[kind];
  async function coreInvoke(args) {
    sync();
    const [command]=args;
    if(command==='run'){
      const asked=parseRun(args),mode=fault('run',asked);
      if(mode==='mute')throw silent();
      if(mode==='late'){pending.push(asked);throw silent();}
      const t=make(asked);
      if(mode==='dies')end(t,'exited');
      if(mode==='lost')throw silent();
      return ok(brief(t));
    }
    if(command==='get'||command==='kill'){
      const mode=fault(command,args[1]);
      if(mode==='mute'||mode==='fail')throw silent();
      const t=find(args[1]);
      if(!t)throw refusal('not_found','no terminal "'+args[1]+'"',3);
      if(command==='kill'&&t.state==='live'&&mode!=='stays')end(t,'killed');
      return ok(whole(t));
    }
    if(command==='ls'){
      const all=args.includes('--all'),at=args.indexOf('--label'),want=at>=0?args[at+1].split(/=(.*)/s):null;
      return ok({hidden_finished:0,terminals:terminals.filter(t=>(all||t.state==='live')&&(!want||t.labels[want[0]]===want[1])).map(brief)});
    }
    throw new Error('fake hc: unknown command '+command);
  }
  // A request sent earlier reaches the core now: made, unless a live terminal holds its name (refused, as any run).
  function arrive() {const asked=pending.shift();if(!asked)return null;try{return make(asked);}catch{return null;}}
  const live=()=>{sync();return terminals.filter(t=>t.state==='live');};

  // The window (herdr-app): its spaces, the tabs of the agents (`agents`: {address, space, tab, tab_name, status}, the
  // terminals of the core shown in a tab among them), the tab shown. `ls` answers as herdr-app ls does: spaces, their
  // tabs, the terminals of each. `do` runs its commands: a new space, a new tab (shown at once), a selection, a
  // rename (refused for a tab that is not there), a close. Ids of new tabs: `tabId`, else x1, x2…
  let k=0;
  const nextTab=tabId||(()=>'x'+(++k));
  const view={shown};
  function appLs() {
    sync();
    const order=[],byId=new Map();
    const space=id=>{if(!byId.has(id)){const declared=spaces.find(x=>x.id===id);byId.set(id,{id,name:declared?.name??null,tabs:[]});order.push(id);}return byId.get(id);};
    for(const s of spaces)space(s.id);
    const tab=(s,id,name)=>{let t=s.tabs.find(x=>x.id===id);if(!t){t={id,name,terminals:[]};s.tabs.push(t);}return t;};
    for(const a of agents.filter(a=>!faults.hidden?.(a)))tab(space(a.space),a.tab,a.tab_name).terminals.push({terminal:a.address,status:a.status??null});
    if(view.shown)tab(space(view.shown.space),view.shown.tab,view.shown.name);
    return {spaces:order.map(id=>{const s=byId.get(id);return {id,name:s.name,active:view.shown?.space===id,tabs:s.tabs.map(t=>({id:t.id,name:t.name,active:view.shown?.space===id&&view.shown?.tab===t.id,terminals:t.terminals}))};})};
  }
  function appDo(command,args) {
    onDo?.(command,args);
    // A refusal answers as herdr-app does ({ "error" } on stdout, exit 1): nothing was done. `lost`: the command is
    // done, then its answer is lost (no stdout, the process killed), a fault of the transport, not seen on the window.
    const mode=fault('do',command,args);
    if(mode==='fail')throw Object.assign(new Error('Command failed: herdr-app'),{code:1,stdout:JSON.stringify({error:'window busy'})+'\n',stderr:''});
    if(mode==='lost'){appDone(command,args);throw silent();}
    return appDone(command,args);
  }
  function appDone(command,args) {
    const list=agents;
    if(command==='space.new'){const id='sp'+(spaces.length+1);spaces.push({id,name:args.name,active:false});return {space:id,tab:id+'-1',terminal:'t-'+id};}
    if(command==='tab.new'){const t=nextTab();list.push({address:'t'+t,space:args.space,tab:t,tab_name:args.name,status:'working'});view.shown={space:args.space,tab:t,name:args.name};return {terminal:'t'+t};}
    if(command==='tab.select')view.shown={space:view.shown?.space,tab:args.id,name:list.find(a=>a.tab===args.id)?.tab_name||args.id};
    if(command==='tab.rename'){const a=list.find(x=>x.tab===args.id);if(!a)throw new Error('no such tab');a.tab_name=args.name;}
    if(command==='tab.close'){const i=list.findIndex(a=>a.tab===args.id);if(i>=0)list.splice(i,1);}
    return {};
  }
  async function appInvoke(args) {
    if(args[0]==='ls')return ok(appLs());
    if(args[0]==='do')return ok(appDo(args[1],JSON.parse(args[2])));
    throw new Error('fake herdr-app: unknown command '+args[0]);
  }

  // The transport the module is given: a program it names, the arguments, the options.
  async function invoke(file,args,options) {
    if(on)return on(file,args,options);
    if(file===hc)return coreInvoke(args);
    if(file===herdrApp)return appInvoke(args);
    throw new Error('fake Herdr: not a program of Herdr: '+file);
  }
  const herdr=createHerdr({invoke,hc,herdrApp});
  // The module over a transport of the test (a gate, a count, a fault of its own) that ends at this fake.
  const through=wrapped=>createHerdr({invoke:wrapped,hc,herdrApp});
  return {herdr,through,invoke,terminals,faults,pending,arrive,live,end:(t,reason='exited')=>end(t,reason),show:x=>{view.shown=x;},get shown(){return view.shown;},spaces};
}

// The options of a backend whose Herdr is this fake, scripted by the exec of the test (which sees the program under
// the name `program`, with the options the engine gives every program); a backend with no exec of its own reaches no Herdr.
export function withFakeHerdr(options,program='/fixture/hc') {
  const exec=options.exec;
  return {...options,herdr:fakeHerdr({hc:program,on:(file,args,more)=>exec?exec(file,args,{...commandOptions,...more,shell:false}):Promise.reject(Object.assign(new Error('spawn '+file+' ENOENT'),{code:'ENOENT'}))}).herdr};
}
