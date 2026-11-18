import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { fail, object, text } from './common.mjs';
import { nextId } from './ids.mjs';
import { pickedAsk } from './agent-texts.mjs';
import { herdrAppHome } from './herdr.mjs';

// A mockup shown in Herdr V4, where a panel can only show pictures: each variant is one HTML file of a folder, rendered
// by a Chrome without a window, and the picture is what the user sees where he decides.
const chromeApp='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',pageWidth=1440,variantsMax=6,renderWait=30000;
const ticketForm=/^[A-Z][A-Z0-9]{0,9}-\d{1,7}$/,itemForm=/^I-\d{1,7}$/,variantFile=/^[\w-]+\.html$/;

// A full-page picture of a local HTML file. Whatever happens, it ends within the wait: a page that never finishes loading
// fails like a Chrome that stops.
export async function captureHtml(file,out,{chrome=chromeApp,wait=renderWait,temp=tmpdir()}={}) {
  const profile=await mkdtemp(join(temp,'fabrique-console-mockup-'));
  const browser=spawn(chrome,['--headless=new','--disable-gpu','--hide-scrollbars','--no-first-run','--no-default-browser-check','--remote-debugging-port=0','--user-data-dir='+profile,`--window-size=${pageWidth},900`,'about:blank'],{stdio:['ignore','ignore','pipe'],shell:false});
  const exited=new Promise(done=>{browser.once('exit',done);browser.once('error',done);});
  let socket=null,timer;
  const stopped=new Promise((_done,refuse)=>{timer=setTimeout(()=>refuse(new Error('timeout')),wait);exited.then(()=>refuse(new Error('stopped')));});
  async function render() {
    const address=await new Promise(done=>{
      let said='';
      browser.stderr.on('data',chunk=>{said+=chunk;const found=/DevTools listening on (ws:\S+)/.exec(said);if(found)done(found[1]);});
    });
    const page=(await (await fetch('http://127.0.0.1:'+new URL(address).port+'/json/list')).json()).find(target=>target.type==='page');
    socket=new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((done,refuse)=>{socket.onopen=done;socket.onerror=refuse;});
    const waiting=new Map();let last=0,loaded;
    const load=new Promise(done=>{loaded=done;});
    socket.onmessage=event=>{
      const message=JSON.parse(event.data);
      if(message.method==='Page.loadEventFired')loaded();
      if(message.id&&waiting.has(message.id)){waiting.get(message.id)(message);waiting.delete(message.id);}
    };
    const call=(method,params={})=>new Promise((done,refuse)=>{const id=++last;waiting.set(id,message=>message.error?refuse(new Error(message.error.message)):done(message.result));socket.send(JSON.stringify({id,method,params}));});
    await call('Page.enable');
    await call('Page.navigate',{url:pathToFileURL(file).href});
    await load;
    // What the page draws just after it loads: its fonts, above all.
    await new Promise(done=>setTimeout(done,400));
    const size=(await call('Page.getLayoutMetrics')).cssContentSize,width=Math.ceil(size.width),height=Math.ceil(size.height);
    const shot=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:true,clip:{x:0,y:0,width,height,scale:1}});
    await writeFile(out,Buffer.from(shot.data,'base64'));
    return {width,height};
  }
  try{return await Promise.race([render(),stopped]);}
  catch{fail('MOCKUP_CAPTURE_FAILED','This mockup could not be rendered.');}
  finally {
    clearTimeout(timer);
    stopped.catch(()=>{});
    try{socket?.close();}catch{}
    browser.kill('SIGKILL');
    await exited;
    await rm(profile,{recursive:true,force:true}).catch(()=>{});
  }
}

export function createMockups({root,registry,inbox,loadState,send,decide,capture=captureHtml,appHome=herdrAppHome(),allowed=join(homedir(),'Developer','mockups')}) {
  const only=(input,names)=>{if(Object.keys(input).some(key=>!names.includes(key)))fail('INVALID_ARGUMENT','Unexpected argument.');};
  async function folderOf(value) {
    const wanted=text(value,'folder',500).replace(/^~(?=\/)/,homedir()),folder=await realpath(wanted).catch(()=>null),base=await realpath(allowed).catch(()=>null);
    if(!folder||!base||!folder.startsWith(base+'/'))fail('INVALID_ARGUMENT','A mockup lives in a folder of ~/Developer/mockups.');
    return {folder,base};
  }
  const linked=(value,form,name)=>{if(value===undefined)return null;if(typeof value!=='string'||!form.test(value))fail('INVALID_ARGUMENT','Expected a '+name+'.');return value;};
  // The Lead publishes a mockup for what it concerns. The same folder again replaces its pictures.
  async function publish(raw) {
    const input=object(raw);only(input,['mission','title','folder','ticket','item']);
    const title=text(input.title,'title',200).trim(),ticket=linked(input.ticket,ticketForm,'ticket'),item=linked(input.item,itemForm,'request');
    const mission=await registry.read(input.mission),{folder,base}=await folderOf(input.folder);
    if(item&&(await inbox.read(item)).mission!==mission.id)fail('INVALID_ARGUMENT','This request belongs to another development.');
    const files=(await readdir(folder)).filter(name=>variantFile.test(name)).sort();
    if(!files.length||files.length>variantsMax)fail('INVALID_ARGUMENT','A mockup is one to six HTML files, one per variant.');
    const known=(mission.mockups||[]).find(mockup=>mockup.folder===folder),id=known?.id??await nextId(root,'MK'),stamp=Date.now(),pictures=join(appHome,'mockups',id);
    // What is rendered is what the file really is: a link cannot lead out of the mockups folder.
    const pages=await Promise.all(files.map(file=>realpath(join(folder,file)).catch(()=>null)));
    if(pages.some(page=>!page||!page.startsWith(base+'/')))fail('INVALID_ARGUMENT','A variant lives in the mockups folder.');
    await mkdir(pictures,{recursive:true});
    const variants=[];
    for(const [n,file] of files.entries()) {
      const name=file.replace(/\.html$/,''),picture=stamp+'-'+name+'.png';
      variants.push({name,file,image:'mockups/'+id+'/'+picture,...await capture(pages[n],join(pictures,picture))});
    }
    // Each publication has an identifier of its own (pub): two publications can share a time, never this.
    const mockup={id,title,ticket,item,folder,variants,at:new Date(stamp).toISOString(),pub:randomUUID(),picked:null};
    const write=()=>registry.update(mission.id,m=>{
      // A request has one mockup: the choice of a variant answers it, and must say which pictures were shown.
      if(item&&(m.mockups||[]).some(other=>other.id!==id&&other.item===item))fail('INVALID_ARGUMENT','This request already has a mockup.');
      m.mockups=[...(m.mockups||[]).filter(other=>other.id!==id),mockup];
    });
    // Tied to a request, it is written under the lock of the requests, for a request still open: not answered, not
    // closed, not replaced. For the request that replaces it, the Lead publishes again.
    await (item?inbox.holding(item,write):write());
    // A name of its own for each publication: the app keeps a picture it has already loaded.
    for(const name of await readdir(pictures))if(!name.startsWith(stamp+'-'))await rm(join(pictures,name),{force:true});
    return {mockup};
  }
  // the user chooses a variant: the answer to the request it belongs to; a mockup tied to no request, a message to the
  // Lead. The screen sends together what it drew: the publication (published), the request (item) and its version
  // (seen). A mockup answers the request it names, and no other: the ticket ties nothing.
  async function pick(raw) {
    const input=object(raw);only(input,['mission','mockup','variant','note','published','item','seen']);
    const mission=await registry.read(input.mission),mockup=(mission.mockups||[]).find(known=>known.id===input.mockup);
    if(!mockup)fail('NOT_FOUND','No mockup uses this identifier.');
    const stale=()=>fail('MOCKUP_STALE','This mockup was published again. Look at it once more.');
    // A page still open on an earlier publication chooses nothing: what it shows may be another mockup, for another request.
    if(!mockup.pub||input.published!==mockup.pub)stale();
    const variant=mockup.variants.find(known=>known.name===input.variant);
    if(!variant)fail('INVALID_ARGUMENT','This mockup has no such variant.');
    const note=input.note===undefined?'':text(input.note,'note',1000).trim(),said=`Maquette ${mockup.id} : variante ${variant.name}.${note?' Note du propriétaire : '+note:''}`;
    if(mockup.item) {
      if(input.item!==mockup.item)stale();
      // One answer per request: one already given is kept, and this choice is not said to be recorded. The publication
      // and the request are read again under the lock that writes the answer (requests.answer): a publication made
      // meanwhile, a request closed, left to the Lead or replaced stop here, and nothing is told to the Lead.
      const made=await decide({item:mockup.item,choice:variant.name,text:said,seen:input.seen,mockup:mockup.id,published:mockup.pub});
      if(made.decision.text!==said)fail('QUESTION_CLOSED','This request already has another answer.');
    }
    const session=mockup.item?null:((await loadState()).sessions||[]).find(s=>s.id===mission.lead?.sessionId);
    if(!mockup.item&&(!session||session.stoppedAt||!session.terminalId))fail('NOT_FOUND','This development has no Lead running.');
    await registry.update(mission.id,m=>{const kept=(m.mockups||[]).find(known=>known.id===mockup.id&&known.pub===mockup.pub);if(kept)kept.picked={variant:variant.name,note,at:new Date().toISOString()};});
    // Tied to no request, the Lead is told where the choice is kept, in the file of the mission: the words of the note
    // and the name of the variant are never copied into the message (decision 61).
    if(!mockup.item)await send({sessionId:session.id,terminal:session.terminalId,text:pickedAsk(mockup.id,{file:registry.fileOf(mission.id)})});
    return {mockup:mockup.id,variant:variant.name};
  }
  return {publish,pick};
}
