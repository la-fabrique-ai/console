import { join } from 'node:path';
import { lstat, readdir, readFile, realpath, writeFile, rename, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { fail } from './common.mjs';
import { isLead } from './state.mjs';
import { forwardedText } from './agent-texts.mjs';

// The chain of the devs of an issue (the user, 2026-11-08: "je veux que tout s'enchaîne"): each agent leaves its
// report in <worktree>/.fabrique-console/ (a dev: <ticket>.dev.json; a reviewer: <ticket>.review-<n>.json); the Issue page reads
// them to launch the review, then the tickets that waited. A message for an agent goes into its tab through hc.
const MAX_FILES=300,MAX_BYTES=65536;
// The command the agents report with (scripts/fabrique-console-report.mjs), run by the node of this backend: given in their tasks.
const quote=s=>"'"+String(s).replace(/'/g,"'\\''")+"'";
export const REPORT_COMMAND=quote(process.execPath)+' '+quote(fileURLToPath(new URL('../scripts/fabrique-console-report.mjs',import.meta.url)));
const REPORT=/^([A-Z][A-Z0-9]{0,9}-\d{1,7})\.(dev|review-[1-9]\d{0,2}|ask-\d{10,17}|block-\d{10,17})\.json$/,ASKERS=['dev','review-1','review-2','qa'];

export function createDevFlow({herdr,loadState,loadConfig=async()=>({})}) {
  async function po(sessionId) {
    const state=await loadState(),session=(state.sessions||[]).find(s=>s.id===sessionId&&isLead(s));
    if(!session)fail('NOT_FOUND','PO session not found.');
    return session;
  }
  // The reports of the worktree of the issue, as the agents wrote them; a file that does not parse is said, not hidden.
  async function reports(input) {
    const session=await po(input?.sessionId);
    if(typeof session.worktree!=='string'||!session.worktree)return {reports:[],command:REPORT_COMMAND};
    const folder=join(session.worktree,'.fabrique-console');let names=[];
    try{names=(await readdir(folder)).filter(n=>REPORT.test(n)).slice(0,MAX_FILES);}catch{return {reports:[],command:REPORT_COMMAND};}
    const out=[];
    for(const name of names){
      const [,ticket,found]=REPORT.exec(name),kind=found.startsWith('ask-')?'ask':found.startsWith('block-')?'block':found,path=join(folder,name);
      try{
        const info=await lstat(path);if(!info.isFile()||info.size>MAX_BYTES)continue;
        const data=JSON.parse(await readFile(path,'utf8'));
        // A ticket stopped, said by its dev (M10): from the instant it wrote, else the one of its file.
        if(kind==='block'){const said=typeof data.at==='string'&&Number.isFinite(Date.parse(data.at))?new Date(Date.parse(data.at)).toISOString():info.mtime.toISOString();
          out.push({name,ticket,kind,path,at:said,reason:typeof data.reason==='string'?data.reason.slice(0,2000):'',migration:typeof data.migration==='string'&&data.migration?data.migration.slice(0,40):null});continue;}
        if(kind==='ask'){out.push({name,ticket,kind,at:info.mtime.toISOString(),question:typeof data.question==='string'?data.question.slice(0,2000):'',options:Array.isArray(data.options)?data.options.filter(option=>typeof option==='string').slice(0,4).map(option=>option.slice(0,200)):[],from:ASKERS.includes(data.from)?data.from:'dev'});continue;}
        out.push({name,ticket,kind,at:info.mtime.toISOString(),commit:typeof data.commit==='string'?data.commit.slice(0,64):null,repo:typeof data.repo==='string'?data.repo.slice(0,200):null,
          baseCommit:typeof data.baseCommit==='string'?data.baseCommit.slice(0,64):null,
          repositories:Array.isArray(data.repositories)?data.repositories.slice(0,100).map(row=>({repo:typeof row?.repo==='string'?row.repo.slice(0,200):null,commit:typeof row?.commit==='string'?row.commit.slice(0,64):null,baseCommit:typeof row?.baseCommit==='string'?row.baseCommit.slice(0,64):null,branch:typeof row?.branch==='string'?row.branch.slice(0,200):null})):[],
          branch:typeof data.branch==='string'?data.branch.slice(0,200):null,notes:Array.isArray(data.notes)?data.notes.filter(note=>typeof note==='string').slice(0,100).map(note=>note.slice(0,2000)):[],
          verdict:['accepted','changes_requested'].includes(data.verdict)?data.verdict:null,summary:typeof data.summary==='string'?data.summary.slice(0,2000):''});
      }catch{out.push({name,ticket,kind,at:null,commit:null,repo:null,branch:null,baseCommit:null,repositories:[],notes:[],verdict:null,summary:'',unreadable:true});}
    }
    return {reports:out,command:REPORT_COMMAND};
  }
  // Validation: the report of the QA agent (<worktree>/.fabrique-console/qa.json: summary, test plan) and the marks of the user,
  // step by step (<worktree>/.fabrique-console/validation.json). A file absent or unreadable gives null, never an invented plan.
  const readJSON=async path=>{try{const info=await lstat(path);if(!info.isFile()||info.size>MAX_BYTES*4)return null;return {data:JSON.parse(await readFile(path,'utf8')),at:info.mtime.toISOString()};}catch{return null;}};
  async function validation(input) {
    const session=await po(input?.sessionId);
    if(typeof session.worktree!=='string'||!session.worktree)return {qa:null,marks:{}};
    const qa=await readJSON(join(session.worktree,'.fabrique-console','qa.json')),marks=await readJSON(join(session.worktree,'.fabrique-console','validation.json'));
    const tests=Array.isArray(qa?.data?.tests)?qa.data.tests.slice(0,80).map((t,n)=>({id:String(t?.id??n+1).slice(0,20),title:String(t?.title||'').slice(0,300),steps:String(t?.steps||'').slice(0,1500),expected:String(t?.expected||'').slice(0,600),auto:['ok','ko','skipped'].includes(t?.auto)?t.auto:null,note:String(t?.note||'').slice(0,600),mode:['browser','app','special'].includes(t?.mode)?t.mode:null,shot:typeof t?.shot==='string'&&/^\.fabrique-console\/qa\/[\w.-]{1,80}\.png$/.test(t.shot)?join(session.worktree,t.shot):null})):[];
    // What the Lead saw when the user asked it to play a test (<worktree>/.fabrique-console/played/<id>.json), dated by the file.
    // Only from the folder itself: a link at .fabrique-console or played leads elsewhere, and is not read.
    const home=await realpath(session.worktree).catch(()=>null),playedDir=home?join(home,'.fabrique-console','played'):null;
    const inside=playedDir?await realpath(playedDir).then(path=>path===playedDir,()=>false):false;
    for(const t of tests) {
      const got=inside&&/^[\w.-]{1,20}$/.test(t.id)?await readJSON(join(playedDir,t.id+'.json')):null,v=got?.data;
      t.played=v&&['ok','ko','unsure'].includes(v.verdict)?{verdict:v.verdict,seen:String(v.seen??'').trim().slice(0,600),at:got.at}:null;
    }
    // A list of short sentences; a paragraph written instead is cut into its sentences.
    const lines=(v,max)=>{const list=Array.isArray(v)?v:typeof v==='string'&&v.trim()?v.trim().split(/(?<=[.!?…])\s+/):null;return list&&list.map(x=>String(x??'').trim().slice(0,400)).filter(Boolean).slice(0,max);};
    const checkFirst=Array.isArray(qa?.data?.checkFirst)?qa.data.checkFirst.slice(0,4).map(i=>({text:String(i?.text??'').trim().slice(0,400),tests:Array.isArray(i?.tests)?i.tests.slice(0,40).map(x=>String(x).slice(0,20)):[],decision:i?.decision===true})).filter(i=>i.text):null;
    return {qa:qa?{at:qa.at,summary:String(qa.data?.summary||'').slice(0,4000),found:lines(qa.data?.found,3),checkFirst,risks:lines(qa.data?.risks,6),verdict:typeof qa.data?.verdict==='string'?qa.data.verdict.slice(0,40):null,tests}:null,marks:marks?.data&&typeof marks.data==='object'?marks.data:{},shots:home?await shotsIn(join(home,'.fabrique-console','qa')):[]};
  }
  // The captures the QA agent leaves as it plays its plan (<worktree>/.fabrique-console/qa/<test>.png, or <test>-<detail>.png),
  // dated by their files: how far it has gone before its report says so. Only from the folder itself, as above.
  async function shotsIn(dir) {
    if(await realpath(dir).then(path=>path!==dir,()=>true))return [];
    const out=[];
    for(const entry of (await readdir(dir,{withFileTypes:true}).catch(()=>[])).slice(0,MAX_FILES)) {
      const test=entry.isFile()&&/^[\w.-]{1,80}\.png$/.test(entry.name)?entry.name.slice(0,-4).split('-')[0]:'';
      if(!test)continue;
      const info=await lstat(join(dir,entry.name)).catch(()=>null);
      if(info?.isFile())out.push({test,at:info.mtime.toISOString()});
    }
    return out;
  }
  async function mark(input) {
    const session=await po(input?.sessionId);
    if(typeof session.worktree!=='string'||!session.worktree)fail('NOT_FOUND','The issue has no worktree.');
    const step=input?.step,result=input?.result;
    if(typeof step!=='string'||!/^[\w.-]{1,20}$/.test(step))fail('INVALID_ARGUMENT','step is required.');
    if(!['ok','ko',null].includes(result))fail('INVALID_ARGUMENT','result must be ok, ko or null.');
    // The feedback of the user on a problem, for the Lead who prepares the fixes.
    const note=input?.note===undefined||input.note===null?'':input.note;
    if(typeof note!=='string'||note.length>2000||(note.trim()&&result!=='ko'))fail('INVALID_ARGUMENT','A note goes with a problem, 2000 characters at most.');
    const path=join(session.worktree,'.fabrique-console','validation.json'),cur=(await readJSON(path))?.data||{};
    if(result===null)delete cur[step];else cur[step]={result,at:new Date().toISOString(),...(note.trim()?{note:note.trim()}:{})};
    await mkdir(join(session.worktree,'.fabrique-console'),{recursive:true});
    const temp=path+'.'+process.pid+'.tmp';await writeFile(temp,JSON.stringify(cur,null,2)+'\n');await rename(temp,path);
    return {marks:cur};
  }
  // A message typed into the tab of an agent of this issue (a finding to fix, for instance), quoted as data.
  async function send(input) {
    await po(input?.sessionId);
    const terminal=input?.terminal,text=input?.text;
    if(typeof terminal!=='string'||!/^t[0-9a-z]+$/.test(terminal))fail('INVALID_ARGUMENT','terminal must be an hc terminal id.');
    if(typeof text!=='string'||!text.trim()||text.length>8000)fail('INVALID_ARGUMENT','text is required.');
    // Only hc that never ran (ENOENT) is known not to have sent; what is refused before (the session, the terminal, the
    // text) never reaches it. Anything else leaves the message perhaps sent, an exit with an error included: hc warns
    // that a send that failed may have arrived. It is said as a doubt, never as a failure, so that nothing sends it
    // again by itself.
    try{await herdr.send(terminal,forwardedText(text,await loadConfig()));}
    catch(error){
      if(error?.code==='ENOENT'&&!error?.killed&&!error?.signal)fail('SEND_FAILED','The message could not be sent to the agent.');
      fail('SEND_UNSURE','This message may not have been delivered. It was not sent again.');
    }
    return {sent:true};
  }
  return {reports,send,validation,mark};
}
