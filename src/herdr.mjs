import { join } from 'node:path';
import { homedir } from 'node:os';
import { AppError, fail } from './common.mjs';
import { terminalId, terminalState, parsed } from './terminals.mjs';

// The one point of contact with Herdr (M2): every command the engine sends to herdr-core (`hc`: terminals made, read,
// written to, stopped) or to the window (`herdr-app`: spaces and tabs made, selected, renamed, closed) goes through
// here, and nothing else names those programs. The trial confines this module from beneath, at the process boundary
// (src/trial.mjs): a trial gives it the programs of its own folder.
//
// The verbs of the core answer as hc does ({stdout}) and fail as it fails (its error, as it is): what an answer means
// stays with the caller, unless the module says it here. What the module says, it says once for all: a Herdr that does
// not answer, or loses its answer, is unknown, never absent (`HC_UNAVAILABLE`); absent is only what Herdr itself said
// (an answer that lists no such terminal, or `not_found`).
export const HC=join(homedir(),'.local','bin','hc');
export const HERDR_APP=join(homedir(),'.local','bin','herdr-app');
// The app itself, as the official archive installs it (the native checks of an installation look at it; nothing here
// starts it).
export const HERDR_OFFICIAL_APP=join(homedir(),'Applications','Herdr.app');
// The home of the app: its settings, its layouts, the pictures of the mockups.
export const herdrAppHome=(env=process.env)=>env.HERDR_APP_HOME||join(homedir(),'.config','herdr-app');

const READ_MS=15000,WRITE_MS=30000;
const kindOf=error=>{try{return JSON.parse(String(error?.stderr||'')).error?.kind||null;}catch{return null;}};

// A trial (src/trial.mjs) names the programs of its folder, else the installed ones.
export function createHerdr({invoke,hc=HC,herdrApp=HERDR_APP,trial=null}) {
  if(typeof invoke!=='function')throw new TypeError('createHerdr needs invoke.');
  if(trial){hc=trial.hc??hc;herdrApp=trial.herdrApp??herdrApp;}
  const core=(args,timeout)=>invoke(hc,args,{timeout});
  const app=(args,timeout)=>invoke(herdrApp,args,{timeout});
  const json=(out,what)=>{try{const v=JSON.parse(out?.stdout);if(v&&typeof v==='object')return v;}catch{}throw new AppError('HC_UNAVAILABLE',what+' gave an answer that cannot be read.');};

  // herdr-core, verb by verb.
  const ls=({all=false,label=null}={})=>core(['ls',...(all?['--all']:[]),'--json',...(label?['--label',label]:[])],READ_MS);
  const get=ref=>core(['get',ref,'--json'],READ_MS);
  const read=(ref,lines)=>core(['read',ref,'--lines',String(lines)],READ_MS);
  // The text is data: after `--`, a text that starts with a dash is never read as an option of hc.
  const send=(ref,text,{ifIdle=false}={})=>core(['send',...(ifIdle?['--if','idle']:[]),ref,'--',text],WRITE_MS);
  const kill=ref=>core(['kill',ref,'--json'],READ_MS);
  // A run is the whole argv of `hc run` (agents.mjs builds those of the agents).
  const run=args=>{
    if(!Array.isArray(args)||args[0]!=='run')fail('INVALID_ARGUMENT','A run of herdr-core starts with run.');
    return core(args,WRITE_MS);
  };
  // The terminals a listing gives, or unknown: an answer that is not there, cannot be read, or carries no list, says
  // nothing of them (HC_UNAVAILABLE). An empty list is absent: Herdr said so.
  async function list(filter={}) {
    let out;
    try{out=await ls(filter);}catch{fail('HC_UNAVAILABLE','herdr-core did not answer.');}
    let data;try{data=JSON.parse(out?.stdout);}catch{fail('HC_UNAVAILABLE','herdr-core gave an answer that cannot be read.');}
    const terminals=Array.isArray(data)?data:data?.terminals??data?.items;
    if(!Array.isArray(terminals))fail('HC_UNAVAILABLE','herdr-core gave an answer that cannot be read.');
    return terminals;
  }
  // The whole record of a terminal (its labels, its status), or unknown; null only when the core said it has none.
  // A record is one only when it names its terminal and carries its labels (an object, or a list as older cores give
  // them): the callers decide on the labels, and an answer without them (`{}`) says nothing of them, never "no labels".
  async function record(ref) {
    let out;
    try{out=await get(ref);}
    catch(error){if(kindOf(error)==='not_found')return null;fail('HC_UNAVAILABLE','herdr-core did not answer.');}
    let t;try{t=JSON.parse(out?.stdout);}catch{fail('HC_UNAVAILABLE','herdr-core gave an answer that cannot be read.');}
    if(!t||typeof t!=='object'||Array.isArray(t))fail('HC_UNAVAILABLE','herdr-core gave an answer that cannot be read.');
    const named=typeof terminalId(t)==='string'&&terminalId(t)!=='';
    const labelled=t.labels!==null&&typeof t.labels==='object';
    if(!named||!labelled)fail('HC_UNAVAILABLE','herdr-core gave a record of a terminal that is not whole.');
    return t;
  }

  // The terminals of Mission Control, each as its own record says: ls omits labels and status, get is the
  // authoritative observation and ownership check.
  const readTerminals=async()=>{
    try {const data=parsed((await ls({all:true,label:'fabrique-console.app=fabrique-console'})).stdout);const terminals=Array.isArray(data)?data:data.terminals??data.items;
      if(!Array.isArray(terminals)) fail('HC_PROTOCOL','hc returned an invalid terminal list.');
      const local=terminals.filter(t=>typeof terminalId(t)==='string'&&/^t[0-9a-z]+$/.test(terminalId(t)));
      return await Promise.all(local.map(async t=>parsed((await get(terminalId(t))).stdout)));
    }catch(error){if(error instanceof AppError) throw error;fail('HC_UNAVAILABLE','herdr-core is unavailable. Session status cannot be verified.');}
  };

  // herdr-core as the lane of the devs reads it (dev-lane.mjs). `get` answers the state of a terminal by its name or
  // its address: live, finished, or none; `kill` the same, after the kill. `run` asks for a terminal under a name: its
  // address, NAME_TAKEN when the core refused it because a live terminal holds the name, LAUNCH_UNCERTAIN when nobody
  // knows what became of the request. Anything else than an answer of hc is HC_UNAVAILABLE: nothing is concluded from
  // it.
  const kernel=(()=>{
    const terminal=stdout=>{
      let t;try{t=JSON.parse(stdout);}catch{return null;}
      if(!t||typeof t!=='object'||typeof t.address!=='string'||!/^t[0-9a-z]+$/.test(t.address)||!['live','finished'].includes(t.state))return null;
      const labels=t.labels&&typeof t.labels==='object'&&!Array.isArray(t.labels)?t.labels:{};
      return {state:t.state,address:t.address,labels,status:t.state==='live'?terminalState(t):null};
    };
    async function ask(command,ref) {
      if(typeof ref!=='string'||!/^[a-z0-9_-]{1,32}$/.test(ref))fail('INVALID_ARGUMENT','A terminal is named by its name or its address.');
      let out;
      try{out=await (command==='get'?get:kill)(ref);}
      catch(error){if(kindOf(error)==='not_found')return {state:'none',address:null,labels:{},status:null};fail('HC_UNAVAILABLE','herdr-core did not answer. The dev of this mission cannot be verified.');}
      return terminal(out?.stdout)??fail('HC_UNAVAILABLE','herdr-core gave an answer that cannot be read. The dev of this mission cannot be verified.');
    }
    async function runDev({name,cwd,labels,argv}) {
      if(typeof name!=='string'||!/^[a-z0-9_-]{1,32}$/.test(name))fail('INVALID_ARGUMENT','name must be 1-32 of a-z 0-9 - _.');
      if(typeof cwd!=='string'||!cwd)fail('INVALID_ARGUMENT','cwd is required.');
      if(!Array.isArray(argv)||!argv.length||argv.some(a=>typeof a!=='string'||a.includes('\0')))fail('INVALID_ARGUMENT','argv is required.');
      const labelArgs=Object.entries(labels||{}).flatMap(([key,value])=>{
        if(!/^[a-z][a-z0-9.-]*$/i.test(key)||typeof value!=='string'||!value||/[\n\0]/.test(value))fail('INVALID_ARGUMENT','Invalid label.');
        return ['--label',key+'='+value];
      });
      let out;
      // An agent kept by the core, as the window keeps its own: in the background, with no parent.
      try{out=await run(['run','--bg','--json','--no-parent','--outlive-parent','--keep','--name',name,'--cwd',cwd,...labelArgs,'--',...argv]);}
      catch(error){
        if(kindOf(error)==='name_taken')throw new AppError('NAME_TAKEN','A live terminal already holds the name of the dev of this mission.');
        throw new AppError('LAUNCH_UNCERTAIN','The dev could not be confirmed as started.');
      }
      const made=terminal(out?.stdout);
      if(!made)throw new AppError('LAUNCH_UNCERTAIN','The dev could not be confirmed as started.');
      return {address:made.address};
    }
    return {get:ref=>ask('get',ref),kill:ref=>ask('kill',ref),run:runDev};
  })();

  // A terminal of the window where no agent runs, as the window says it: an agent run by tab.new leaves its shell when it
  // exits (the guide of Herdr), and the window gives the status of an agent only while a program reports one (null then,
  // herdr.d.ts), or names the program that runs there. A status left out, or one not known, says nothing: not a shell.
  const shellOnly=x=>x?.program?.agent===true?false:x?.program?.shell===true||x?.program?.agent===false||(Object.hasOwn(x||{},'status')&&x.status===null);
  // The window as a background process sees it: the agents of herdr-app ls (as the mods' agents() gives them), the
  // space and tab shown, its commands, its status (the errors of its layout) and a picture of it. An answer that
  // carries no spaces says nothing of them: unknown, never a window with no tabs.
  const window={
    async ls() {
      const out=JSON.parse((await app(['ls'],READ_MS)).stdout);
      if(!out||typeof out!=='object'||!Array.isArray(out.spaces))throw new AppError('HC_UNAVAILABLE','herdr-app gave an answer that cannot be read.');
      const agents=[],spaces=[];let shown=null;
      for(const s of out.spaces){
        spaces.push({id:s.id,name:s.name??null,active:Boolean(s.active)});
        for(const t of s.tabs||[]){
          if(s.active&&t.active)shown={space:s.id,tab:t.id,name:t.name};
          for(const x of t.terminals||[])agents.push({address:x.terminal,space:s.id,tab:t.id,tab_name:t.name,status:x.status||null,shell:shellOnly(x)});
        }
      }
      return {agents,shown,spaces};
    },
    // A command of the window: what it made, or its error. Refused (`refused`) only when herdr-app said so ({ "error" } on
    // stdout): nothing was done. Any other failure (no answer, an answer lost or that cannot be read) is `uncertain`: the
    // command may have been done.
    async run(command,args) {
      let out;
      try{out=await app(['do',command,JSON.stringify(args)],WRITE_MS);}
      catch(error){
        let said=null;try{said=JSON.parse(String(error?.stdout||''));}catch{}
        if(said&&typeof said==='object'&&said.error!=null)throw Object.assign(error,{refused:true});
        throw Object.assign(error instanceof Error?error:new Error(String(error)),{uncertain:true});
      }
      try{return JSON.parse(out?.stdout||'{}');}catch(error){throw Object.assign(error,{uncertain:true});}
    },
    status:async()=>json(await app(['status'],READ_MS),'herdr-app'),
    shot:async file=>{
      if(typeof file!=='string'||!file.startsWith('/'))fail('INVALID_ARGUMENT','A picture of the window is written to an absolute path.');
      await app(['shot',file],WRITE_MS);
    },
  };

  return {ls,get,read,send,kill,run,list,record,readTerminals,kernel,window};
}
