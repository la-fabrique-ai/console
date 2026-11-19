import {readFileSync} from 'node:fs';
import {fail} from '../../../src/common.mjs';
import {folderOf} from './store.mjs';

const writeInstructions=readFileSync(new URL('./agent-instructions.md',import.meta.url),'utf8').trim();
const readInstructions=readFileSync(new URL('./agent-read-instructions.md',import.meta.url),'utf8').trim();
// The folder of every configured project, so an agent edits the files of the main checkout, not of its worktree.
const folders=config=>{
  const lines=(config?.projects??[]).map(project=>{const folder=folderOf(project);return folder?`- ${project.key} : \`${folder}\``:null;}).filter(Boolean);
  return lines.length?lines.join('\n'):'- (aucun projet configuré)';
};
const same=value=>value;
export const definition={
  id:'markdown',
  scope:project=>({key:project.key,id:project.teamId??project.ticketScope?.scopeId??null}),
  agentContext:config=>({instructions:readInstructions.replace('{{folders}}',folders(config)),writeInstructions:writeInstructions.replace('{{folders}}',folders(config))}),
  configInput:same,
  settings(settings){
    if(settings!==undefined)fail('INVALID_CONFIG','Markdown tickets take no connection settings besides the driver.');
    return {};
  },
  backendOptions:same,
  factoryOptions:same,
  mission:same,
  ticketState:record=>record?.tracker,
  action:same,
  error:same,
  async runtime(){return import('./runtime.mjs');},
};
