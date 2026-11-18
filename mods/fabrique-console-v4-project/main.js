import {View,div} from 'gpui-kit';
import {shared,setShared,run,home} from 'herdr';
import {snapshot} from './kit.js';
import {FEED_MY_ISSUES} from './common.js';
import {projectLook} from './model.js';
import {projectTile,v_flex,h_flex,screen,h1,hd,sq,dim,grp,list,empty,fault,missionRow,issueList,openTicket,prepareButton} from './look.js';
import {W} from './words.js';
import {KEYS,SCREENS,missionsOf,machineWord,issueSections} from './nav.js';
const MOD='fabrique-console-v4-project';
// The page of a project: its developments under way and its issues, nothing else.
export default class Project extends View {
 init(_p,cx) {this.memo=null;this.error='';this.preparing=null;}
 sections(kept,team) {
  const stamp=[kept?.at,team].join('|');
  if(this.memo?.stamp!==stamp)this.memo={stamp,value:issueSections(kept?.data,{filter:'open',team})};
  return this.memo.value;
 }
 detail(m) {
  const tickets=m.tickets||[],working=[...new Set(tickets.filter(t=>t.state==='dev'||t.state==='fix').map(t=>W.tools[t.dev]).filter(Boolean))],waiting=tickets.filter(t=>t.waitingAnswer).length;
  return [W.steps[m.step]||'—',W.project.tickets(tickets.length),...(working.length?[working.join(', ')]:[]),W.project.questions(waiting)].join(' · ');
 }
 render() {
  const all=snapshot().projects||[],project=all.find(p=>p.key===shared(KEYS.project))||null;
  // Reached by a click on a project: without one (or before the first snapshot) there is nothing to say yet.
  if(!project)return screen().id('project');
  const color=projectLook(project).color,machine=project.machine||'local',missions=missionsOf(shared(KEYS.missions),{project:project.key}),sections=this.sections(shared(FEED_MY_ISSUES),project.key),count=sections[0]?.rows.length||0;
  const folder=String(project.repo||'').replace(home(),'~');
  const head=[W.project.issuesCount(count),missions.length?W.devs.count(missions.length):W.devs.none,machineWord(machine),...(folder?[folder]:[])].join(' · ');
  return screen().id('project')
   // Prepare ticket opens Pilot fresh on this very project.
   .child(hd(h_flex().flex_none().items_center().gap(10).child(projectTile(project)).child(h1(project.name||project.key)),h_flex().flex_none().items_center().gap(14).child(dim(head)).child(prepareButton(this,MOD,project.key))))
   .when(Boolean(this.error),e=>e.child(fault(this.error)))
   .child(grp(W.project.devsTitle,missions.length))
   .when(missions.length>0,e=>e.child(list().children(missions.map((m,n)=>missionRow('mission-'+m.id,m,{color,detail:this.detail(m),on:n===0,first:n===0,last:n===missions.length-1,fn:()=>{setShared(KEYS.mission,m.id);run('layout.switch',{name:SCREENS.ticket});}})))))
   .when(!missions.length,e=>e.child(empty(W.project.nothing)))
   .child(grp(W.project.issuesTitle,count))
   .child(count?issueList('project-issues',sections,{missions,colorOf:()=>color,open:(_cx,row)=>openTicket(row),heads:false}):v_flex().flex_1().child(empty(W.issues.empty.all)));
 }
}
