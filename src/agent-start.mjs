import { join } from 'node:path';
import { homedir } from 'node:os';
import { fail } from './common.mjs';
import { terminalId, parsed } from './terminals.mjs';
import { hcRunArgs } from './agents.mjs';

// The general assistant of a tool: one terminal per tool, above the teams, in ~/Developer, in the space of the Agent
// page. hc keeps its name unique among live terminals, so a second start of the same tool is refused there.
export const AGENT_SPACE='fabrique-console-agent';
export const agentTerminalName=tool=>`${AGENT_SPACE}-${tool}`;

export function createAgentStart({herdr,agentFolder=join(homedir(),'Developer')}) {
  async function start(input) {
    const tool=input.tool;
    const args=hcRunArgs({tool,cwd:agentFolder,name:agentTerminalName(tool),labels:{'herdr.space':AGENT_SPACE,'herdr.tab':agentTerminalName(tool),'fabrique-console.app':'fabrique-console','fabrique-console.role':'agent','fabrique-console.tool':tool}});
    let launched;
    try {launched=parsed((await herdr.run(args)).stdout);}catch{fail('LAUNCH_UNCERTAIN','The agent start could not be confirmed. A terminal of that tool may already run.');}
    const id=terminalId(launched);
    if(typeof id!=='string'||!/^t[0-9a-z]+$/.test(id))fail('LAUNCH_UNCERTAIN','hc did not return a local terminal ID.');
    return {terminalId:id,tool};
  }
  return {start};
}
