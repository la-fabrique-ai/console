import {View,div} from 'gpui-kit';
import {shared,setShared,run,exec} from 'herdr';
import {snapshot,api,segment,FEED_ERRORS} from './kit.js';
import {FEED_MY_ISSUES} from './common.js';
import {projectLook} from './model.js';
import {issueFilterOf,unreadTeams} from './view.js';
import {v_flex,h_flex,C,MONO,screen,h1,h2,hd,sq,dim,box,mono,tag,pill,btn,empty,fault,textBlocks,projectTile,goLead,leadOfMission,openMockup,AGENT_COLORS,alertOnce,issueList,pilotOnIssue,prepareButton,projectChooser,ISSUE_OPEN,openTicket,closeTicket} from './look.js';
import {W} from './words.js';
import {KEYS,SCREENS,onMachine,missionsOf,issueSections,issueTarget,issueTone,dayOf} from './nav.js';
const MOD='fabrique-console-v4-issues',SHEET_EVERY=30000,DONE='#4DD4AE';
// Issues: every team's, as the feed brings them, or those of the project chosen in the column. A row opens Pilot; Prepare
// ticket opens Pilot fresh to write a new one, on the project chosen or on the one picked in its small window.
export default class Issues extends View {
 init(_p,cx) {
  this.error='';this.memo=null;this.preparing=null;this.choosing=false;
  this.sheet=null;this.sheetOf=null;this.sheetToken=null;this.sheetAt=0;this.sheetBusy=false;this.tried=null;cx.timer.every(1000,cx=>this.pollSheet(cx));
 }
 target() {return issueTarget({projects:snapshot().projects||[],machine:shared(KEYS.machine)??null,project:shared(KEYS.project),team:shared(KEYS.team)});}
 // The sections are worked out again only when the answer or a filter changes: the list can hold a thousand issues.
 sections(kept,filter,team,keys) {
  const stamp=[kept?.at,filter,team,[...keys].join()].join('|');
  if(this.memo?.stamp!==stamp)this.memo={stamp,value:issueSections(kept?.data,{filter,team,keys})};
  return this.memo.value;
 }
 // The ticket open: read whole from Tracker at each opening (even of the same ticket again), from the cache every half
 // minute while it stays open; a failed read waits five seconds before the next try. An answer for an opening that is no
 // longer the one on screen is left aside.
 pollSheet(cx) {
  const open=shared(ISSUE_OPEN);if(!open?.issueId||this.sheetBusy)return;
  const id=open.issueId,token=open.opened||id,fresh=this.sheetToken!==token,wait=fresh?(this.tried===token?5000:0):SHEET_EVERY;
  if(Date.now()-this.sheetAt<wait)return;
  this.tried=token;this.sheetBusy=true;
  cx.spawn(async cx=>{
   try{const sheet=await api(MOD,'issue-sheet',{issueId:id,refresh:fresh});const now=shared(ISSUE_OPEN);if(now?.issueId===id&&(now.opened||now.issueId)===token){this.sheet=sheet;this.sheetOf=id;this.sheetToken=token;}alertOnce(this,'sheet',null);}
   catch(e){alertOnce(this,'sheet',String(e.message||e));}
   finally{this.sheetAt=Date.now();this.sheetBusy=false;cx.notify();}
  });
 }
 openDev(mission) {setShared(KEYS.mission,mission.id);setShared(KEYS.project,null);run('layout.switch',{name:SCREENS.ticket});}
 part(title,body) {return v_flex().flex_none().gap(6).child(div().text_size(11).font_weight(600).text_color(C.faint).child(String(title).toUpperCase())).child(body);}
 // The page of a ticket: what Tracker knows of it, and what was done on it when it has a development.
 ticket(open) {
  const s=this.sheetOf===open.issueId?this.sheet:null,i=s?.issue,project=(snapshot().projects||[]).find(p=>p.key===open.project)||null;
  const mission=(shared(KEYS.missions)||[]).find(m=>m.issue?.id===open.issueId)||null,lead=mission?leadOfMission(mission):null,state=i?.state;
  const facts=[project?.name||open.project,i?.identifier||open.identifier].filter(Boolean).join(' · ');
  const when=[i?.createdAt?W.sheet.created(dayOf(i.createdAt)):null,i?.updatedAt?W.sheet.updated(dayOf(i.updatedAt)):null].filter(Boolean).join(' · ');
  const buttons=h_flex().flex_none().gap(6)
   .child(btn('ticket-back',W.detail.back,()=>closeTicket(),{tone:'plain'}))
   .when(/^https:\/\/[^\s/@]+\//.test(i?.url||''),e=>e.child(btn('ticket-tracker',W.devs.tracker,(_e,cx)=>{cx.spawn(async()=>{await exec('open',[i.url]);});},{tone:'plain'})))
   .child(btn('ticket-pilot',W.issues.open,(_e,cx)=>pilotOnIssue(MOD,{team:{key:open.project},issue:{id:open.issueId}},cx)))
   .when(Boolean(mission),e=>e.child(btn('ticket-dev',W.sheet.openDev,()=>this.openDev(mission),{tone:'plain'})))
   // In development: its Lead one click away.
   .when(Boolean(mission&&lead),e=>e.child(btn('ticket-lead',W.devs.goLead,()=>goLead(mission,lead),{tone:'lead'})));
  const head=h_flex().flex_none().min_w(0).items_center().gap(14).child(projectTile(project,48,26))
   .child(v_flex().flex_1().min_w(0)
    .child(div().truncate().text_size(20).line_height(1.25).font_weight(600).text_color(C.title).child(String(i?.title||open.title||'—')))
    .child(h_flex().flex_wrap().items_center().gap(8).text_color(C.dim).child(div().child(facts))
     .when(Boolean(state?.name),e=>e.child(pill(issueTone(state.type,state.name),state.name)))
     .when(Boolean(i?.priority),e=>e.child(div().child(String(i.priority))))
     .when(Boolean(when),e=>e.child(div().child('· '+when)))))
   .child(buttons);
  const page=screen().id('ticket').child(head);
  if(!s)return page.child(empty(W.sheet.loading));
  if(s.unavailable&&!s.mission)return page.child(empty(W.sheet.unavailable));
  const kids=s.children||[],done=kids.filter(c=>c.stateType==='completed').length,doing=kids.filter(c=>c.stateType==='started').length,m=s.mission,summary=m?.tldr||s.summary;
  const kv=(id,label,value)=>h_flex().id(id).flex_none().items_center().justify_between().gap(8).text_size(12.5).child(div().flex_none().text_color(C.dim).child(label)).child(div().min_w(0).truncate().text_color(value?C.title:C.faint).child(value?String(value):'—'));
  const left=v_flex().id('ticket-left').flex_1().min_w(0).h_full().gap(10).overflow_y_scrollbar()
   .child(box().id('ticket-summary').child(div().text_size(11).font_weight(600).text_color(C.faint).child(W.sheet.summary.toUpperCase())).child(summary?textBlocks(summary,14,true):div().text_color(C.faint).child(W.sheet.noSummary)))
   .when(Boolean(s.plan||s.decided),e=>e.child(box().id('ticket-plan').gap(8).child(h2(W.plan.title)).when(Boolean(s.plan),x=>x.child(textBlocks(s.plan,13.5,true))).when(Boolean(s.decided),x=>x.child(this.part(W.plan.decided,textBlocks(s.decided,13,false))))))
   .when(kids.length>0,e=>e.child(box().id('ticket-children').gap(4).child(h_flex().flex_none().items_center().gap(8).child(h2(W.sheet.subTickets)).child(dim(W.sheet.count(kids.length,done,doing))))
    .children(kids.map((c,n)=>h_flex().id('child-'+n).flex_none().items_center().gap(10).py(5).when(n>0,x=>x.border_t_1().border_color(C.row)).child(div().w(70).flex_none().child(mono(String(c.identifier||'')))).child(div().flex_1().min_w(0).truncate().text_color(C.title).child(String(c.title||'—'))).when(Boolean(W.tools[c.agent]),x=>x.child(tag(W.tools[c.agent],AGENT_COLORS[c.agent]))).child(pill(issueTone(c.stateType,c.state),String(c.state||'—')))))))
   .when(Boolean(m?.journal?.length),e=>e.child(box().id('ticket-done').gap(4).child(h2(W.sheet.done))
    .child(v_flex().font_family(MONO).text_size(12).line_height(1.7).text_color(C.sec).children(m.journal.map((l,n)=>h_flex().id('done-'+n).gap(8).child(div().flex_none().text_color(C.faint).child(String(l.at||''))).child(div().flex_1().min_w(0).child(String(l.text||''))))))));
  const links=s.links||[],kits=m?.mockups||[],comments=s.comments||[];
  const right=v_flex().id('ticket-right').flex_none().w(300).h_full().gap(10).overflow_y_scrollbar()
   .child(box().id('ticket-facts').gap(6).child(kv('fact-state',W.sheet.state,state?.name)).child(kv('fact-priority',W.sheet.priority,i?.priority)).child(kv('fact-assignee',W.sheet.assignee,i?.assignee)).child(kv('fact-labels',W.sheet.labels,(i?.labels||[]).join(', '))).child(kv('fact-branch',W.sheet.branch,i?.branch)))
   .when(Boolean(m),e=>e.child(box().id('ticket-dev-box').gap(6).child(h_flex().flex_none().items_center().gap(8).child(h2(W.sheet.development)).child(div().flex_1()).child(pill('rev',W.steps[m.step]||String(m.step))))
    .child(kv('fact-progress',W.detail.progress,m.done+' / '+m.tickets))
    .child(div().w(266).h(6).rounded(3).bg(C.chip).child(div().h_full().rounded(3).bg(DONE).w(Math.round(266*(m.tickets?Math.min(1,m.done/m.tickets):0)))))
    // A closed development has left the list of those under way: its page opens from the mission the sheet names,
    // where « Reopen… » is.
    .when(Boolean(mission||m?.id),x=>x.child(btn('ticket-dev-open',W.sheet.openDev,()=>this.openDev(mission||{id:m.id}),{tone:'plain'})))))
   .when(links.length>0,e=>e.child(box().id('ticket-links').gap(6).child(h2(W.plan.links)).children(links.map((l,n)=>div().id('ticket-link-'+n).truncate().cursor_pointer().text_size(13).text_color(C.sec).hover(x=>x.text_color(C.title)).on_click((_e,cx)=>{cx.spawn(async()=>{await exec('open',[l.url]);});}).child(String(l.text))))))
   .when(kits.length>0,e=>e.child(box().id('ticket-mockups').gap(6).child(h2(W.plan.mockups)).children(kits.map(k=>h_flex().flex_none().items_center().gap(8).child(div().flex_1().min_w(0).truncate().text_size(13).text_color(C.title).child(String(k.title||k.id))).child(btn('ticket-mockup-'+k.id,W.mockup.open,()=>openMockup({id:m.id},k),{tone:'mockup'}))))))
   .when(comments.length>0,e=>e.child(box().id('ticket-comments').gap(6).child(h2(W.sheet.comments)).children(comments.map((c,n)=>v_flex().id('comment-'+n).gap(2).py(4).when(n>0,x=>x.border_t_1().border_color(C.row)).child(div().text_size(12).text_color(C.dim).child([c.author,c.at?dayOf(c.at):null].filter(Boolean).join(' · '))).child(div().text_size(13).text_color(C.txt).child(String(c.body||'').slice(0,400)))))));
  return page.child(h_flex().flex_1().min_h(0).items_start().gap(16).child(left).child(right));
 }
 chip(id,on,color,label,fn) {
  let el=h_flex().id(id).flex_none().items_center().gap(6).h(26).px(10).rounded(13).border_1().text_size(12.5).whitespace_nowrap().cursor_pointer().on_click(fn).border_color(on?C.title:C.line).text_color(on?C.ink:C.sec).font_weight(on?600:400);
  if(on)el=el.bg(C.title);
  if(color)el=el.child(sq(color));
  return el.child(label);
 }
 render() {
  const open=shared(ISSUE_OPEN);if(open?.issueId)return this.ticket(open);
  const data=snapshot(),all=data.projects||[],machine=shared(KEYS.machine)??null,projects=all.filter(p=>onMachine(p.machine,machine)),{project,team}=this.target();
  const kept=shared(FEED_MY_ISSUES),filter=issueFilterOf(shared(KEYS.filter)),sections=this.sections(kept,filter,team,new Set(projects.map(p=>p.key)));
  const colorOf=key=>projectLook(all.find(p=>p.key===key)).color,missions=missionsOf(shared(KEYS.missions),{machine});
  const chips=project?dim(all.find(p=>p.key===project)?.name||''):h_flex().flex_wrap().justify_end().gap(6)
   .child(this.chip('chip-all',!team,null,W.issues.all,()=>setShared(KEYS.team,null)))
   .children(projects.map(p=>this.chip('chip-'+p.key,team===p.key,colorOf(p.key),p.name||p.key,()=>setShared(KEYS.team,p.key))));
  const fed=(shared(FEED_ERRORS)||{})['my-issues.json'];
  const count=sections.reduce((n,section)=>n+section.rows.length,0);
  return screen().id('issues').relative()
   .child(hd(h_flex().flex_none().items_center().gap(10).child(h1(W.issues.title)).child(dim(String(count))),prepareButton(this,MOD,team)))
   .child(h_flex().flex_none().items_center().gap(12)
    .child(segment('issues-filter',Object.entries(W.issues.filters),filter,(key,_e,cx)=>{setShared(KEYS.filter,key);cx.notify();}))
    .child(div().flex_1())
    .child(chips))
   .when(Boolean(this.error||fed),e=>e.child(fault(this.error||fed)))
   .children(unreadTeams(kept?.data?.teams).map(t=>fault(W.issues.teamError+t.name+' · '+(t.error.message||t.error.code))))
   .child(sections.length?issueList('issues-list',sections,{missions,colorOf,open:(_cx,row)=>openTicket(row)}):v_flex().flex_1().child(empty(kept?W.issues.empty[filter]:W.issues.loading)))
   .when(this.choosing&&!team,e=>e.child(projectChooser(this,MOD,projects)));
 }
}
