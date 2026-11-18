import {View,div,image} from 'gpui-kit';
import {TextareaState,Textarea} from 'gpui-base';
import {shared,setShared,props,closeOverlay,exec,run} from 'herdr';
import {snapshot,api} from './kit.js';
import {T} from './texts.js';
import {v_flex,h_flex,C,pill,btn,press,projectTile,goLead,leadOfMission,leadToTell,openQa,qaSurface,alertToast,alertOnce} from './look.js';
import {W} from './words.js';
import {KEYS,testSteps,testIndex,testMode,atServer,lastLine} from './nav.js';
// The QA window: what is tested on the left (the back office in a browser, the app on its iPhone, or a terminal), the
// test on the right. One mod, three parts: the head, the panel of the test, and what stands in for the left side
// while nothing can be shown there. The panel prepares each test: it starts what it needs and shows it.
const MOD='fabrique-console-v4-qa',PANEL=460,STALE=Symbol('stale');
export default class Qa extends View {
 init(_p,cx) {
  this.story=null;this.error='';this.prepared=null;this.token=null;this.feedback=null;this.note=TextareaState.new({value:'',placeholder:W.qa.feedbackHint,rows:5});this.compare=null;this.marking=false;
  // Every nine seconds, every three while the Lead plays a test.
  if(props()?.part==='panel'){this.poll(cx);this.tick=0;cx.timer.every(3000,cx=>{this.tick++;if(this.playing()||this.tick%3===0)this.poll(cx);});}
 }
 // Its window closed or replaced: what it was preparing is dropped.
 close() {this.token=null;}
 mission() {return props()?.mission||null;}
 state(change) {setShared(KEYS.qa,{...(shared(KEYS.qa)||{}),mission:this.mission(),...change});}
 poll(cx) {
  cx.spawn(async cx=>{
   try{this.story=await api(MOD,'mission-read',{mission:this.mission()});this.error='';alertOnce(this,'read',null);}catch(e){alertOnce(this,'read',String(e.message||e));}
   this.ensure(cx);cx.notify();
  });
 }
 plan() {return this.story?.qa?.plan||[];}
 // A browser test at the address its server really took, once that server answers for this development.
 atServer(t,qs) {
  if(!t||testMode(t)!=='browser'||qs?.mission!==this.mission()||!qs.url)return t;
  return {...t,steps:atServer(t.steps,qs.planned,qs.url),expected:atServer(t.expected,qs.planned,qs.url)};
 }
 marks() {return this.story?.qa?.marks||{};}
 current() {
  const s=shared(KEYS.qa),plan=this.plan();
  let at=s?.mission===this.mission()&&Number.isInteger(s?.at)?s.at:testIndex(plan,this.marks(),null);
  return Math.max(0,Math.min(at<0?0:at,plan.length-1));
 }
 go(at,cx) {this.state({at});this.compare=null;this.feedback=null;this.ensure(cx);cx.notify();}
 // Only when the user asks: the Lead plays the back-office test in his browser, follows its steps and writes what it saw.
 guide(cx) {
  const s=shared(KEYS.qa)||{},plan=this.plan(),at=this.current(),t=this.atServer(plan[at],s),m=this.story?.mission||(shared(KEYS.missions)||[]).find(x=>x.id===this.mission())||null;
  if(!t||testMode(t)!=='browser'||!s.browser||shared(KEYS.qaShown)?.window!==props()?.window||this.playState(s,t)==='playing')return;
  const lead=m?leadToTell(m):null;
  if(!lead||!m?.lead?.sessionId||!m.worktree||!/^[\w.-]{1,20}$/.test(t.id)){alertToast(W.qa.noLead);return;}
  this.state({playedAt:{...(s.playedAt||{}),[t.id]:Date.now()}});
  cx.spawn(async cx=>{
   try{await api(MOD,'dev-send',{sessionId:m.lead.sessionId,terminal:lead.address,text:T.issue.val.prepareForQa({issue:m.issue?.identifier||m.id,at:at+1,total:plan.length,browser:s.browser,server:s.server,test:t,file:m.worktree+'/.fabrique-console/played/'+t.id+'.json'})});}
   catch(e){alertToast(e.message||e);const now={...(shared(KEYS.qa)?.playedAt||{})};delete now[t.id];this.state({playedAt:now});}
   cx.notify();
  });
 }
 // Asked and no result written since: playing; five minutes without one: late. A result older than the ask is the last one.
 playState(qs,t) {
  const asked=qs.playedAt?.[t?.id]||0,fresh=t?.played&&Date.parse(t.played.at)>asked;
  if(!asked||fresh)return t?.played?'result':'none';
  return Date.now()-asked>300000?'late':'playing';
 }
 playing() {const plan=this.plan(),t=plan[this.current()];return Boolean(t)&&this.playState(shared(KEYS.qa)||{},t)==='playing';}

 // Each test in its mode: what it needs is started, then shown on the left.
 ensure(cx) {
  const plan=this.plan();
  if(!plan.length)return;
  const mode=testMode(plan[this.current()]);
  if(this.prepared===mode)return;
  this.prepared=mode;this.prepare(mode,cx);
 }
 // A preparation belongs to its window: once the window is closed, replaced or given to another development, it
 // stops at its next step and neither writes the state nor opens anything.
 prepare(mode,cx) {
  const mission=this.mission(),token={},call=(command,target)=>api(MOD,'mission-server',{mission,command,...(target?{target}:{})});
  const ours=()=>this.token===token&&shared(KEYS.qaShown)?.window===props()?.window,live=()=>{if(!ours())throw STALE;};
  this.token=token;
  if(!ours())return;
  this.state({mode,env:W.qa.preparing[mode],tone:'dec',url:null});
  // Another kind of test: the left side says at once what is being prepared.
  if(shared(KEYS.qaShown)?.mode!==mode){openQa(mission,qaSurface(mission),{mode});if(!ours())return;}
  cx.spawn(async cx=>{
   try{
    if(mode==='app') {
     let app=await call('status','app');live();if(!app.running){app=await call('start','app');live();}
     if(app.device)setShared('herdr-sim.devices',{...(shared('herdr-sim.devices')||{}),qa:app.device});
     this.state({env:W.qa.appOn,tone:'ok'});openQa(mission,{mod:'herdr-sim',props:{frames:'qa',reserve:60}},{mode});
    } else if(mode==='browser') {
     let server=await call('status');live();if(!server.running&&!server.starting){server=await call('start');live();}
     // Running only once its address answers: a server that starts its emulators first, then compiles, takes a while.
     for(let n=0;n<150&&!server.running&&server.starting;n++){this.state({env:W.qa.waitingServer,tone:'dec'});await exec('sleep',['2']);live();server=await call('status');live();}
     // Never "starting" for ever: what it really says when it does not answer.
     if(!server.running)throw new Error(server.reason||lastLine(server.lastOutput)||(server.starting?W.qa.noUrl:W.qa.serverStopped));
     const page=await api(MOD,'qa-browser',{mission,url:server.url});live();
     this.state({env:W.qa.serverOn(server.url),tone:'ok',browser:page.key||null,server:server.terminal||null,url:server.url,planned:server.planned||null});
     // Shown only here: without a tab of its own, the browser takes the size of this window.
     openQa(mission,{terminal:page.terminal},{mode});run('terminal.park',{terminal:page.terminal});
    } else {
     const server=await call('status').catch(()=>({})),app=await call('status','app').catch(()=>({})),terminal=server.running?server.terminal:app.running?app.terminal:null;live();
     this.state({env:terminal?W.qa.logs:W.qa.nothing,tone:terminal?'ok':'unk'});openQa(mission,terminal?{terminal}:qaSurface(mission),{mode});
    }
   }
   catch(e){if(e===STALE||!ours())return;alertToast(e.message||e);this.state({env:String(e.message||e),tone:'inc'});openQa(mission,qaSurface(mission),{mode});}
   cx.notify();
  });
 }
 // A mark is kept at once; a problem keeps the feedback of the user. Nothing goes to the Lead here: the problems go
 // together, when the user sends them.
 // A click on Passed or Problem toggles; Save and Remove say exactly what the test becomes (`set`).
 mark(m,t,result,cx,note='',set=false) {
  const qa=this.story?.qa;
  if(!qa||this.marking)return;
  const next=set?result:qa.marks?.[t.id]?.result===result&&!note?null:result,before=qa.marks?.[t.id];
  qa.marks={...(qa.marks||{})};if(next)qa.marks[t.id]={result:next,...(note?{note}:{})};else delete qa.marks[t.id];
  this.marking=true;cx.notify();
  cx.spawn(async cx=>{
   try{
    await api(MOD,'validation-mark',{sessionId:m.lead.sessionId,step:t.id,result:next,...(note?{note}:{})});
    // Kept: the box closes. Refused: the mark comes back and what the user wrote stays in the box.
    this.feedback=null;
    // Passed goes on to the next test; a problem stays, so that the user sees what he wrote.
    if(next==='ok'){const plan=this.plan(),after=plan.findIndex((x,n)=>n>this.current()&&!qa.marks[x.id]?.result);if(after>=0)this.go(after,cx);}
   }
   catch(e){alertToast(e.message||e);qa.marks={...qa.marks};if(before)qa.marks[t.id]=before;else delete qa.marks[t.id];}
   finally{this.marking=false;cx.notify();}
  });
 }
 // The problems noted, and whether this very list reached the Lead. A send whose answer is lost stays uncertain.
 problems() {const plan=this.plan(),marks=this.marks();return plan.filter(t=>marks[t.id]?.result==='ko').map(t=>({id:t.id,title:t.title,note:marks[t.id]?.note||''}));}
 problemsState(list) {const sent=(shared(KEYS.qaProblems)||{})[this.mission()];return sent&&sent.sig===JSON.stringify(list.map(p=>[p.id,p.note]))?sent.state:null;}
 sendProblems(m,cx) {
  const list=this.problems(),lead=m?leadToTell(m):null,state=this.problemsState(list);
  if(!list.length||state==='sending'||state==='sent')return;
  if(!lead||!m?.lead?.sessionId){alertToast(W.qa.noLead);return;}
  // An answer belongs to its own list: one that comes back after a newer list was sent leaves that one as it is.
  const sig=JSON.stringify(list.map(p=>[p.id,p.note])),mission=this.mission();
  const mark=(state,first=false)=>{const all=shared(KEYS.qaProblems)||{};if(!first&&all[mission]?.sig!==sig)return;setShared(KEYS.qaProblems,{...all,[mission]:{sig,state,at:Date.now()}});};
  mark('sending',true);cx.notify();
  cx.spawn(async cx=>{
   try{await api(MOD,'dev-send',{sessionId:m.lead.sessionId,terminal:lead.address,text:T.issue.val.problemsToLead(m.issue?.identifier||m.id,list,m.worktree?m.worktree+'/.fabrique-console/validation.json':null)});mark('sent');}
   catch(e){mark('uncertain');alertToast(e.message||e);}
   cx.notify();
  });
 }
 // The window is given back as it was: maximized only if it was before the QA.
 quit() {
  const shown=shared(KEYS.qaShown);
  setShared(KEYS.qaShown,null);
  if(shown?.overlay&&shown.overlay!==props().overlay)closeOverlay(shown.overlay);
  if(shared(KEYS.qaMaximized)){setShared(KEYS.qaMaximized,null);run('window.maximize');}
  closeOverlay(props().overlay);
 }
 head() {
  const s=shared(KEYS.qa)||{},mission=(shared(KEYS.missions)||[]).find(m=>m.id===this.mission())||null,project=(snapshot().projects||[]).find(p=>p.key===mission?.project)||null,lead=mission?leadOfMission(mission):null;
  return press(h_flex()).id('qa-head').size_full().items_center().gap(12).px(16).bg(C.panel).border_b_1().border_color(C.line).text_color(C.txt).text_size(13.5)
   .child(projectTile(project,34,18))
   .child(v_flex().flex_1().min_w(0).child(div().font_weight(600).text_color(C.title).child(W.qa.title(mission?.issue?.identifier||this.mission()))).child(div().truncate().text_size(12.5).text_color(C.dim).child(String(mission?.issue?.title||''))))
   .child(h_flex().flex_none().gap(6).children(['browser','app','special'].map(k=>pill(s.mode===k?'rev':'unk',W.qa.modes[k]))))
   .when(Boolean(s.env),e=>e.child(div().flex_none().max_w(360).truncate().child(pill(s.tone||'unk',String(s.env)))))
   .when(Boolean(lead),e=>e.child(press(btn('qa-lead',W.devs.goLead,()=>{this.quit();goLead(mission,lead);},{tone:'lead'}))))
   .child(press(btn('qa-quit',W.qa.quit,()=>this.quit(),{tone:'plain'})));
 }
 surface() {
  const s=shared(KEYS.qa)||{};
  return press(v_flex()).id('qa-surface').size_full().items_center().justify_center().gap(8).bg('#0C0D11').text_color(C.dim).text_size(14)
   .child(div().text_color(C.title).child(String(s.env||W.qa.starting)))
   .child(div().text_size(12.5).child(W.qa.follow));
 }
 part(label,body) {return v_flex().gap(4).child(div().text_size(11).text_color(C.faint).child(label.toUpperCase())).child(body);}
 panel() {
  const plan=this.plan(),marks=this.marks(),m=this.story?.mission||(shared(KEYS.missions)||[]).find(x=>x.id===this.mission())||null;
  // No press here moves the window: it stays the whole page.
  const root=press(v_flex()).id('qa-panel').size_full().min_h(0).bg(C.panel).border_l_1().border_color(C.line).text_color(C.txt).text_size(13.5).line_height(1.5);
  if(!plan.length)return root.child(div().p(16).text_color(C.dim).child(this.story?W.check.noPlan:W.qa.starting));
  const at=this.current(),qs=shared(KEYS.qa)||{},t=this.atServer(plan[at],qs),steps=testSteps(t.steps),mark=marks[t.id]?.result,mode=testMode(t),kits=mode==='app'?(m?.mockups||[]):[];
  const width=PANEL-34,shown=this.compare?.variants?.[0],play=this.playState(qs,t);
  const problems=this.problems(),sent=this.problemsState(problems);
  return root
   .child(h_flex().flex_none().gap(3).px(16).pt(14).children(plan.map((x,n)=>div().id('qa-bar-'+n).flex_1().h(6).rounded(3).cursor_pointer().bg(n===at?C.acc:marks[x.id]?.result==='ok'?'#4DD4AE':marks[x.id]?.result==='ko'?'#FF8A7E':'#2C313B').on_click((_e,cx)=>this.go(n,cx)))))
   .child(v_flex().id('qa-card').flex_1().min_h(0).overflow_y_scrollbar().px(16).py(14).gap(12)
    .child(h_flex().items_center().gap(8).child(div().flex_1().text_size(12.5).text_color(C.dim).child(W.check.testOf(at+1,plan.length))).when(Boolean(mark),e=>e.child(pill(mark==='ok'?'ok':'inc',mark==='ok'?W.check.passed:W.check.problem))))
    .child(div().text_size(16).font_weight(600).text_color(C.title).child(String(t.title||'—')))
    .when(mode==='browser'&&Boolean(qs.browser),e=>e.child(h_flex().items_center().gap(10).child(play==='playing'?pill('dec','▶ '+W.qa.leadAsked):press(btn('qa-guide',W.qa.leadSetup,(_e,cx)=>this.guide(cx),{tone:'lead'}))).when(play==='late',x=>x.child(div().text_size(12.5).text_color(C.dim).child(W.qa.leadLate)))))
    .when(kits.length>0,e=>e.child(h_flex().flex_wrap().gap(6).children(kits.map(k=>press(btn('qa-mock-'+k.id,this.compare?.id===k.id?W.qa.backToTest:W.qa.compare+' · '+k.title,(_e,cx)=>{this.compare=this.compare?.id===k.id?null:k;cx.notify();},{tone:'mockup'}))))))
    .when(Boolean(shown),e=>e.child(image(shown.image).w(width).h(Math.round(width*shown.height/shown.width))))
    .when(steps.length>0,e=>e.child(this.part(W.check.todo,v_flex().gap(4).children(steps.map((line,n)=>h_flex().items_start().gap(8).child(div().flex_none().w(16).text_size(12).text_color(C.faint).child(String(n+1))).child(div().flex_1().min_w(0).child(line)))))))
    .when(Boolean(t.expected),e=>e.child(this.part(W.check.expected,div().text_color(C.title).child(String(t.expected)))))
    .when(Boolean(t.played)&&play!=='playing',e=>e.child(this.part(W.qa.leadResult,h_flex().items_start().gap(8).child(pill(t.played.verdict==='ok'?'ok':t.played.verdict==='ko'?'inc':'unk',W.qa.leadVerdict[t.played.verdict])).child(div().flex_1().min_w(0).text_color(C.title).child(t.played.seen||'')))))
    .when(Boolean(t.auto),e=>e.child(v_flex().gap(4).child(h_flex().child(pill(t.auto==='ok'?'ok':t.auto==='ko'?'inc':'unk',W.check.qaResult[t.auto]))).when(Boolean(t.note),x=>x.child(div().text_size(12.5).text_color(C.dim).child(String(t.note))))))
    .when(Boolean(t.shot),e=>e.child(h_flex().child(press(btn('qa-shot',W.qa.shot,(_e,cx)=>{const file=t.shot;cx.spawn(async()=>{await exec('open',[file]);});},{tone:'plain'})))))
    .when(mark==='ko'&&Boolean(marks[t.id]?.note),e=>e.child(this.part(W.qa.yourFeedback,div().text_color(C.title).child(String(marks[t.id].note)))))
    .when(this.feedback===t.id,e=>e.child(v_flex().gap(8).p(12).rounded(10).bg('#0C0D11').border_1().border_color(C.danger)
     .child(div().text_size(12.5).text_color(C.dim).child(W.qa.feedbackTitle))
     .child(press(Textarea.new(this.note).w_full().h(120).p(8).rounded(8).bg(C.panel).border_1().border_color(C.line).text_size(13.5).text_color(C.title)))
     .child(h_flex().justify_end().gap(8).when(mark==='ko',x=>x.child(press(btn('qa-feedback-remove',W.qa.removeProblem,(_e,cx)=>this.mark(m,t,null,cx,'',true),{tone:'plain'}))).child(div().flex_1())).child(press(btn('qa-feedback-cancel',W.qa.cancel,(_e,cx)=>{this.feedback=null;cx.notify();},{tone:'plain'}))).child(press(btn('qa-feedback-save',W.qa.saveProblem,(_e,cx)=>this.mark(m,t,'ko',cx,this.note.value().trim(),true),{tone:'danger'}))))))
    .when(Boolean(this.error),e=>e.child(div().text_size(12.5).text_color(C.danger).child(this.error))))
   .when(problems.length>0,e=>e.child(h_flex().flex_none().items_center().gap(10).px(16).py(10).border_t_1().border_color(C.line).text_size(12.5)
    .child(div().flex_1().min_w(0).text_color(C.title).child(W.qa.problemsNoted(problems.length)))
    .child(sent==='sent'?pill('ok',W.qa.problemsSent):sent==='sending'?pill('dec',W.qa.problemsSending):press(btn('qa-problems-send',sent==='uncertain'?W.qa.problemsAgain:W.qa.problemsSend,(_e,cx)=>this.sendProblems(m,cx),{tone:'lead'})))
    .when(sent==='uncertain',x=>x.child(div().text_color(C.danger).child(W.qa.problemsUncertain)))))
   .child(h_flex().flex_none().items_center().gap(8).px(16).py(12).border_t_1().border_color(C.line)
    .child(press(btn('qa-prev','‹',(_e,cx)=>this.go(Math.max(0,at-1),cx),{tone:'plain'})))
    .child(press(btn('qa-next','›',(_e,cx)=>this.go(Math.min(plan.length-1,at+1),cx),{tone:'plain'})))
    .child(div().flex_1())
    .when(Boolean(m?.lead?.sessionId),e=>e.child(press(btn('qa-ko',W.check.problem,(_e,cx)=>{this.feedback=t.id;this.note.set_value(mark==='ko'?String(marks[t.id]?.note||''):'');cx.notify();},{tone:'danger'}))).child(press(btn('qa-ok',W.check.passed,(_e,cx)=>this.mark(m,t,'ok',cx),{tone:'ok'})))));
 }

 // The head of the simulator window: what runs, and Close.
 simHead() {
  return press(h_flex()).id('sim-head').size_full().items_center().gap(10).px(14).bg(C.panel).border_b_1().border_color(C.line).text_color(C.title).text_size(13.5)
   .child(div().flex_1().min_w(0).truncate().font_weight(600).child(W.sim.title(String(props()?.title||''))))
   .child(press(btn('sim-close',W.sim.close,()=>{setShared(KEYS.simShown,null);closeOverlay(props().overlay);},{tone:'plain'})));
 }
 render() {
  const part=props()?.part;
  if(part==='sim')return this.simHead();
  return part==='head'?this.head():part==='surface'?this.surface():this.panel();
 }
}
