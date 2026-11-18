#!/usr/bin/env node
// Started apart by the "mcp-check" action: the check outlasts the 30 seconds an action may take.
import {runMcpCheck} from './project-sheet.mjs';
import {trialOf,journal,realStateRoot} from './trial.mjs';

import {rm} from 'node:fs/promises';

const [repo,cachePath,marker]=process.argv.slice(2);
// In a trial, the claude of the trial by its absolute path, never the one of the PATH; none named: no check.
const claude=()=>{
  const trial=trialOf({root:process.env.FABRIQUE_CONSOLE_HOME??realStateRoot()});
  if(!trial)return process.env.FABRIQUE_CONSOLE_MC_CLAUDE_BIN||'claude';
  if(!trial.agents.claude){journal(trial,{kind:'agent',program:'claude',via:'mcp-check',refused:true});throw new Error('The trial names no claude.');}
  journal(trial,{kind:'exec',program:trial.agents.claude,command:'mcp-check',agent:trial.agents.claude});
  return trial.agents.claude;
};
try {await runMcpCheck({repo,cachePath,command:claude()});}catch {process.exitCode=1;}
// The marker of the running check is released whatever happened.
finally {if(marker) await rm(marker,{force:true}).catch(()=>{});}
