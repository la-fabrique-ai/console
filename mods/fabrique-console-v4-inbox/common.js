import { div } from 'gpui-kit';
import { v_flex, h_flex } from 'gpui-base';
import { exec, appHome, readTextFile, writeTextFile, watchFolder, theme, shared, setShared } from 'herdr';
export { v_flex, h_flex };
export const snapshot=()=>shared('fabrique-console.snapshot')||{projects:[],sessions:[]};
export const label=(text)=>div().text_size(11).text_color(theme().muted).child(text);
export const text=(value)=>div().text_size(12).child(String(value??'—'));
export const panel=()=>v_flex().size_full().min_h(0).min_w(0).p(12).gap(10).bg(theme().chrome).text_color(theme().foreground).text_size(12);
export const heading=(value)=>div().text_size(14).font_semibold().child(value);
export const button=(id,value,fn,primary=false)=>h_flex().id(id).h(29).px(10).items_center().rounded(6).cursor_pointer().bg(primary?theme().selected:theme().raised).text_color(primary?theme().accent:theme().foreground).hover(s=>s.bg(theme().hover)).on_click(fn).child(value);
export const badge=(value,color)=>div().text_size(10).text_color(color||theme().muted).child(value);
// What this layer says when it fails. The V3 keeps these words; the V4 screens give their own.
const WORDS={install:'Installer FABRIQUE_CONSOLE depuis son dépôt : npm run install:console',unreadable:'Le module local ne répond pas en JSON. Consulter les vérifications FABRIQUE_CONSOLE.',tracker:'Connexion aux tickets indisponible. Exécuter npm run tickets:login dans le dépôt.',failed:'Action impossible'};
export const useWords=words=>{Object.assign(WORDS,words);};
export async function api(mod,action,payload={}) {
 const raw=await readTextFile(appHome()+'/mods/'+mod+'/runtime.json');
 if(!raw) throw new Error(WORDS.install);
 const runtime=JSON.parse(raw);
 const r=await exec(runtime.node,[runtime.repo+'/src/cli.mjs',action,JSON.stringify(payload)]);
 let response;try {response=JSON.parse(r.stdout);}catch{throw new Error(WORDS.unreadable);}
 if(!response.ok) {
  const failure=new Error(response.error?.code==='TICKET_NOT_CONFIGURED'?WORDS.tracker:response.error?.message||WORDS.failed);
  // The typed code lets a screen say a known refusal in plain words.
  failure.code=response.error?.code||null;throw failure;
 }
 return response.data;
}
export function task(view,cx,mod,action,payload,success) {
 if(view.busy)return;
 view.busy=true;view.error='';cx.notify();
 cx.spawn(async cx=>{
  try {const value=await api(mod,action,payload); if(success)success(value);}
  catch(e){view.error=String(e.message||e);}
  finally {view.busy=false;cx.notify();}
 });
}
export const errorView=(view)=>view.error?div().p(8).rounded(6).bg(theme().surface).text_color(theme().blocked).child(view.error):div().h(0);
// The snapshot (teams, sessions) read again at once, after a launch: the screens do not wait for the bar's timer.
export async function reloadSnapshot(mod) {const data=await api(mod,'snapshot',{});setShared('fabrique-console.snapshot',data);setShared('fabrique-console.snapshot-at',new Date().toISOString());return data;}
export function selectSession(session) {setShared('fabrique-console.session',session.id);if(session.issueId)setShared('fabrique-console.issue',session.issueId);}

// ---- The feed: the watcher (src/watch.mjs) writes what the screens show under <state>/state/; the bar reads those
// files when they change and shares them, so no screen reads herdr-core or Tracker on a timer.
export const FEED_SNAPSHOT='fabrique-console.snapshot',FEED_MY_ISSUES='fabrique-console.v3.my-issues',FEED_AT='fabrique-console.v3.feed-at',FEED_ERRORS='fabrique-console.v3.feed-errors';
const seen=new Map();
async function runtimeOf(mod) {const raw=await readTextFile(appHome()+'/mods/'+mod+'/runtime.json');if(!raw)throw new Error(WORDS.install);return JSON.parse(raw);}
export async function stateDirOf(mod) {return (await runtimeOf(mod)).state+'/state';}
// One file of the feed: {at,data}; data holds {error} when its read failed. Shared only when its text changed.
async function pullFile(dir,name,apply) {
 const raw=await readTextFile(dir+'/'+name);
 if(raw===null||seen.get(name)===raw)return false;
 seen.set(name,raw);
 let file;try{file=JSON.parse(raw);}catch{return false;}
 const errors={...(shared(FEED_ERRORS)||{})};
 if(file.data&&file.data.error){errors[name]=file.data.error.message||file.data.error.code;setShared(FEED_ERRORS,errors);return true;}
 if(errors[name]){delete errors[name];setShared(FEED_ERRORS,errors);}
 apply(file.data,file.at);
 return true;
}
// Reads the files of the feed every screen needs and shares what changed: the snapshot, My issues. The issues of a
// team are read by its Issues page alone (readTeamIssues): shared, a list of seven hundred issues would be copied
// into every screen, whose memory is small.
// `merge(kept,data,at)` folds a new My issues answer into the one kept, so a team that could not be read keeps
// what it showed (the V3 rule of view.js); without it the answer is shared as it is.
export async function pullFeed(mod,merge=null) {
 const dir=await stateDirOf(mod);
 let changed=false;
 changed=(await pullFile(dir,'snapshot.json',(data,at)=>{setShared(FEED_SNAPSHOT,data);setShared('fabrique-console.snapshot-at',at);if(shared('fabrique-console.v3.snapshot-failed'))setShared('fabrique-console.v3.snapshot-failed',null);}))||changed;
 changed=(await pullFile(dir,'my-issues.json',(data,at)=>setShared(FEED_MY_ISSUES,merge?merge(shared(FEED_MY_ISSUES),data,Date.parse(at)):{data,at:Date.parse(at)})))||changed;
 changed=(await pullFile(dir,'missions.json',data=>setShared('fabrique-console.v4.missions',Array.isArray(data)?data:[])))||changed;
 changed=(await pullFile(dir,'inbox.json',data=>setShared('fabrique-console.v4.inbox',Array.isArray(data?.items)?data.items:[])))||changed;
 if(changed)setShared(FEED_AT,new Date().toISOString());
 return changed;
}
// The issues of one team as the watcher wrote them: {raw,data,at,error}, or null when the file is absent or its
// text is the one already read (`last`).
export async function readTeamIssues(mod,key,last=null) {
 const raw=await readTextFile((await stateDirOf(mod))+'/issues-'+key+'.json');
 if(raw===null||raw===last)return null;
 // A file that cannot be read keeps the list shown, and says it could not be verified.
 let file;try{file=JSON.parse(raw);}catch{return {raw,data:null,at:null,error:'Impossible de vérifier la liste. Les dernières données disponibles sont conservées.'};}
 const error=file?.data?.error?String(file.data.error.message||file.data.error.code):null;
 return {raw,data:error?null:file.data,at:Date.parse(file.at),error};
}
// Renews the window's lease: writeTextFile replaces a file only when told its current text (null creates it), so
// the lease is read first; another window writing in between is read again, a few times. A lease that cannot be
// written is said, never swallowed: the watcher would stop after ten minutes.
export async function renewLease(mod) {
 const path=(await stateDirOf(mod))+'/lease';
 let error=null;
 for(let attempt=0;attempt<4;attempt++) {
  try{await writeTextFile(path,new Date().toISOString()+'\n',await readTextFile(path));return true;}
  catch(e){error=e;}
 }
 throw error;
}
// Starts the watcher when none beats, renews the window's lease, and follows the folder: the bar runs this once.
export function feed(cx,mod,{merge=null}={}) {
 const lease=async()=>{try{await renewLease(mod);}catch(e){setShared('fabrique-console.v3.watch-error',String(e.message||e));}};
 cx.spawn(async cx=>{
  await lease();
  try{await api(mod,'watch-start',{});}catch(e){setShared('fabrique-console.v3.watch-error',String(e.message||e));}
  try{await pullFeed(mod,merge);}catch{}
  cx.notify();
  let dir;try{dir=await stateDirOf(mod);}catch(e){setShared('fabrique-console.v3.watch-error',String(e.message||e));cx.notify();return;}
  for(;;){try{await watchFolder(dir);if(await pullFeed(mod,merge))cx.notify();}catch{}}
 });
 cx.timer.every(60000,cx=>{cx.spawn(async cx=>{try{await renewLease(mod);const status=await api(mod,'watch-status',{});if(!status.running)await api(mod,'watch-start',{});setShared('fabrique-console.v3.watch-error',null);}catch(e){setShared('fabrique-console.v3.watch-error',String(e.message||e));}cx.notify();});});
}
// Asks the watcher to read Tracker again now; the feed brings the answer.
export async function pokeFeed(mod) {try{await api(mod,'watch-poke',{});}catch{}}
