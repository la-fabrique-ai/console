import { fail } from './common.mjs';
import { agentMark } from '../ui/v3/view.js';

// The agents Mission Control starts, one row per tool: how it is named, how it starts with a prompt, how it resumes.
// Every launch (PO, dev, reviewer, general assistant) builds its argv here; no `claude` or `codex` is spelled elsewhere.
// Facts from the installed help (Claude Code, Codex 0.166 under hc): the prompt is a positional argument of the
// interactive program; Codex runs without its shared daemon so that its commands stay under hc.
// Each carries the mark of an agent started by the tool (decision 70, ui/v3/view.js), before its prompt.
const AGENTS={
  claude:{name:'Claude',start:(prompt,role=null)=>['claude',...(role==='lead'?['--disable-slash-commands']:[]),...agentMark('claude',role),...(prompt?[prompt]:[])],resume:(id,prompt)=>['claude','--resume',id,...agentMark('claude'),...(prompt?[prompt]:[])]},
  codex:{name:'Codex',start:(prompt,role=null)=>['codex','--no-daemon',...agentMark('codex',role),...(prompt?[prompt]:[])],resume:(id,prompt)=>['codex','resume','--no-daemon',id,...agentMark('codex'),...(prompt?[prompt]:[])]},
};
export const TOOLS=Object.keys(AGENTS);
export const APP_LABEL='fabrique-console.app=fabrique-console';

// The row of a tool, or an INVALID_ARGUMENT refusal: a tool is a value of the config or of a request, never trusted.
export function agentOf(tool) {
  if(typeof tool!=='string'||!Object.hasOwn(AGENTS,tool))fail('INVALID_ARGUMENT','tool must be claude or codex.');
  return AGENTS[tool];
}
export const agentName=tool=>agentOf(tool).name;
// The argv that resumes a conversation of an agent, marked as every other.
export const resumeArgv=(tool,id,prompt=null)=>agentOf(tool).resume(id,prompt);
// The tool a project's PO uses: the project's preference, else the config's, else Claude.
export const poTool=(config,project)=>project?.preferredAgent??config?.preferredAgent??'claude';

// The hc argv that starts an agent in the background, kept when its parent goes, in its folder, with its labels.
// A prompt is one argv entry, never a shell line. `name` is hc's unique name among live terminals, when one is wanted.
// `role` is the role mark of the agent (ui/v3/view.js, ROLE_MARK). A Claude Lead starts without slash commands or skills;
// it keeps its MCP servers: it writes to the tracker with them (roles/lead.md).
export function hcRunArgs({tool,prompt=null,cwd,name=null,labels={},role=null}) {
  if(typeof cwd!=='string'||!cwd)fail('INVALID_ARGUMENT','cwd is required.');
  if(prompt!==null&&typeof prompt!=='string')fail('INVALID_ARGUMENT','prompt must be a string.');
  if(name!==null&&!/^[a-z0-9_-]{1,32}$/.test(name))fail('INVALID_ARGUMENT','name must be 1-32 of a-z 0-9 - _.');
  const program=agentOf(tool).start(prompt,role);
  const labelArgs=Object.entries(labels).flatMap(([key,value])=>{
    if(!/^[a-z][a-z0-9.-]*$/i.test(key)||typeof value!=='string'||value.includes('\n'))fail('INVALID_ARGUMENT','Invalid label.');
    return ['--label',`${key}=${value}`];
  });
  return ['run','--bg','--json','--no-parent','--outlive-parent','--keep',...(name?['--name',name]:[]),'--cwd',cwd,...labelArgs,'--',...program];
}
