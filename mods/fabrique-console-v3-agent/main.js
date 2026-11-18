import {View,div} from 'gpui-kit';
import {terminals,home,run,agents,spaces,shared,setShared} from 'herdr';
import {h_flex,C,btn,LINE,api} from './kit.js';
import {T} from './texts.js';
import {agentTerminal,poTab,spaceAsked,AGENT_TOOLS,AGENT_SPACE} from './view.js';
const MOD='fabrique-console-v3-agent',ASKED='fabrique-console.v3.agent-space-asked';
// The head of the Agent page: the general assistant above the teams, one terminal per tool (Claude, Codex),
// started in ~/Developer. The conversation is the terminal under this head, the active tab of its space.
export default class Agent extends View {
 init(_p,cx){this.busy=false;this.error='';this.failed=null;this.shown=null;this.made=false;this.tick(cx);cx.timer.every(2000,cx=>this.tick(cx));}
 living(tool){return agentTerminal(terminals(),tool);}
 // The terminal to show: the tool chosen, else the first living one; shown once Herdr lists it. Without any, the
 // page shows the agent's own space (made once if it does not exist yet), never the terminal of another page.
 tick(cx){
  const chosen=shared('fabrique-console.v3.agent-tool'),terminal=(chosen&&this.living(chosen))||AGENT_TOOLS.map(t=>this.living(t)).find(Boolean)||null;
  const tab=terminal?poTab(agents(),terminal.address):null;
  // A start refused because the tool already runs (hc keeps its name unique) is no error once the terminal of that
  // tool shows; another tool running says nothing about it.
  if(this.error&&this.failed&&this.living(this.failed)){this.error='';this.failed=null;}
  if(tab&&this.shown!==terminal.address){this.shown=terminal.address;run('space.select',{id:tab.space});run('tab.select',{id:tab.tab});}
  else if(!tab){
   // No agent terminal, or one Herdr does not report yet: the page keeps to its own space, never another work.
   const space=spaces().find(s=>s.named&&s.name===AGENT_SPACE);
   if(space){if(!space.active)run('space.select',{id:space.id});}
   else if(!terminal&&!this.made&&!spaceAsked(shared(ASKED),Date.now())){this.made=true;setShared(ASKED,new Date().toISOString());run('space.new',{name:AGENT_SPACE,folder:home()+'/Developer'});}
  }
  cx.notify();
 }
 show(cx,tool){setShared('fabrique-console.v3.agent-tool',tool);this.shown=null;this.tick(cx);}
 // Start the assistant of a tool through the backend (the agents table builds the argv): one start at a time.
 start(cx,tool){
  if(this.busy)return;
  this.busy=true;this.error='';setShared('fabrique-console.v3.agent-tool',tool);cx.notify();
  cx.spawn(async cx=>{
   try{await api(MOD,'agent-start',{tool});this.shown=null;}
   catch{this.error=T.agent.failed;this.failed=tool;}
   finally{this.busy=false;cx.notify();}
  });
 }
 // One button per tool, at the left: start it, or show it once it runs (the shown one in the primary style).
 render(){
  const chosen=shared('fabrique-console.v3.agent-tool');
  return h_flex().id('agent-head').size_full().min_w(0).h(44).px(20).gap(8).items_center().bg(C.window).border_b_1().border_color(C.barBorder).text_color(C.text).text_size(13).line_height(LINE)
   .children(AGENT_TOOLS.map(tool=>{
    const live=this.living(tool),name=T.agent.tools[tool];
    if(live)return btn('agent-show-'+tool,T.agent.show(name),(_e,cx)=>this.show(cx,tool),{small:true,primary:chosen===tool});
    return btn('agent-start-'+tool,this.busy&&chosen===tool?T.agent.starting:T.agent.start(name),(_e,cx)=>this.start(cx,tool),{small:true});
   }))
   .child(div().flex_1())
   .when(Boolean(this.error),e=>e.child(div().text_size(12).text_color(C.danger).child(this.error)));
 }
}
