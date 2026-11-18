import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fail, object, writeJSON } from './common.mjs';
import { agentAskText } from './agent-texts.mjs';

// What an agent stopped on its terminal is asking. Read and shown only: nothing here answers it.
const terminalForm=/^t[0-9a-z]+$/,ticketForm=/^[A-Z][A-Z0-9]{0,9}-\d{1,7}$/,askMax=300;
const isChoice=line=>/^[›❯>]?\s*\d+\.\s/.test(line)||/^(press enter|esc to|enter to)/i.test(line);
const cut=line=>line.length>askMax?line.slice(0,askMax)+'…':line;

export function askOf(screen) {
  const lines=String(screen||'').split('\n').map(line=>line.replace(/^[\s│|]+|[\s│|]+$/g,'')).filter(line=>line&&!line.startsWith('[hc]')&&!/^[─━╭╰╮╯-]+$/.test(line));
  const at=lines.findLastIndex(line=>/would you like|do you want|\?$/i.test(line)&&!isChoice(line));
  if(at<0)return {question:lines.length?cut(lines.filter(line=>!isChoice(line)).at(-1)||''):null,command:null,details:[]};
  // Codex writes the command after its question, with a dollar; Claude Code above it, under its title.
  const after=lines.slice(at+1),choice=after.findIndex(isChoice),told=choice<0?after:after.slice(0,choice),below=told.find(line=>line.startsWith('$ '))?.slice(2)??null;
  const title=lines.slice(0,at).findLastIndex(line=>/^(bash command|command)$/i.test(line)),above=title>=0&&title+1<at?lines[title+1]:null,command=below??above;
  const details=(below?told.filter(line=>!line.startsWith('$ ')&&!/^environment:/i.test(line)):title>=0?lines.slice(title+2,at):told).map(cut);
  return {question:cut(lines[at]),command:command?cut(command):null,details};
}

export function createWaiting({root=null,herdr,loadState,missions,send,now=Date.now}) {
  const screenOf=async terminal=>{
    try{return (await herdr.read(terminal,40)).stdout;}
    catch{fail('HC_UNAVAILABLE','herdr-core is unavailable. What this agent asks cannot be read.');}
  };
  async function read(raw) {
    const input=object(raw);
    if(Object.keys(input).some(key=>key!=='terminal')||typeof input.terminal!=='string'||!terminalForm.test(input.terminal))fail('INVALID_ARGUMENT','Give the terminal of the agent.');
    return askOf(await screenOf(input.terminal));
  }
  // the user opens with the Lead or Pilot what an agent asks: it is given what the agent says now. It cannot answer for him.
  async function discuss(raw) {
    const input=object(raw);
    if(Object.keys(input).some(key=>!['agent','mission','ticket','to','terminal'].includes(key))||typeof input.agent!=='string'||!terminalForm.test(input.agent)||!['lead','pilot'].includes(input.to)||(typeof input.ticket!=='string'||!ticketForm.test(input.ticket)))fail('INVALID_ARGUMENT','Give the agent, its ticket and who is told.');
    if(input.to==='pilot'&&(typeof input.terminal!=='string'||!terminalForm.test(input.terminal)))fail('INVALID_ARGUMENT','Give the terminal of Pilot.');
    if(!root)fail('STORAGE_ERROR','What this agent asks cannot be kept.');
    // What it asks is kept in a file of its own, and the message names that file: its words are never copied into the
    // message (decision 61). One file per discussion, never written over.
    const mission=await missions.read(input.mission),ask=askOf(await screenOf(input.agent)),at=now();
    const file=join(root,'state','agent-asks',`${input.ticket}-${input.agent}-${at}-${randomUUID().slice(0,8)}.json`);
    await writeJSON(file,{ticket:input.ticket,agent:input.agent,mission:mission.id,at:new Date(at).toISOString(),...ask});
    const text=agentAskText(input.ticket,{file});
    if(input.to==='pilot') {
      try{await herdr.send(input.terminal,text);}catch{fail('SEND_FAILED','Pilot could not be told.');}
      return {told:true};
    }
    const session=((await loadState()).sessions||[]).find(s=>s.id===mission.lead?.sessionId);
    if(!session||session.stoppedAt||!session.terminalId)fail('NOT_FOUND','This development has no Lead running.');
    await send({sessionId:session.id,terminal:session.terminalId,text});
    return {told:true};
  }
  // When an agent's terminal was opened: the time of its last launch, since a relaunch opens a new terminal.
  async function started(raw) {
    const input=object(raw);
    if(Object.keys(input).some(key=>key!=='terminal')||typeof input.terminal!=='string'||!terminalForm.test(input.terminal))fail('INVALID_ARGUMENT','Give the terminal of the agent.');
    let ms;
    try{ms=Number(JSON.parse((await herdr.get(input.terminal)).stdout)?.created_ms);}
    catch{fail('HC_UNAVAILABLE','herdr-core is unavailable. When this agent started cannot be read.');}
    return {startedAt:Number.isFinite(ms)&&ms>0?new Date(ms).toISOString():null};
  }
  return {read,discuss,started};
}
