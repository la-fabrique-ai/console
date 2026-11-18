#!/usr/bin/env node
// Manual verification entry point when macOS GUI/Keychain/loopback access is unavailable to a sandbox.
import {spawnSync} from 'node:child_process';
import {mkdirSync,writeFileSync,existsSync,readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {join,dirname} from 'node:path';
import {createHerdr,HERDR_APP,HERDR_OFFICIAL_APP} from '../src/herdr.mjs';
const repo=dirname(dirname(fileURLToPath(import.meta.url)));process.chdir(repo);
const local=join(repo,'docs/local');mkdirSync(local,{recursive:true,mode:0o700});
function run(command,args,file,env={}){
 const r=spawnSync(command,args,{cwd:repo,env:{...process.env,...env},encoding:'utf8',timeout:120000,maxBuffer:16*1024*1024});
 if(file)writeFileSync(join(local,file),(r.stdout||'')+(r.stderr||''),{mode:0o600});
 if(r.error||r.status!==0)throw new Error(file?`Vérification échouée : docs/local/${file}`:'Commande de vérification refusée ou échouée.');
 return r.stdout;
}
// Herdr, through its one module (M2): the commands of this check wait as long as the others (120 s), whatever the
// module would wait in the engine.
const herdr=createHerdr({invoke:async(command,args)=>({stdout:run(command,args)})});
function action(name,input={}){
 const out=JSON.parse(run(process.execPath,['src/cli.mjs',name,JSON.stringify(input)]));if(!out.ok)throw new Error('Action locale échouée : '+(out.error?.code||name));return out.data;
}
try{
 console.log('Tests automatisés et natifs…');
 run('npm',['test'],'final-tests.txt',{FABRIQUE_CONSOLE_NATIVE_CHECKS:'1',FABRIQUE_CONSOLE_OFFICIAL_APP:HERDR_OFFICIAL_APP});
 run(process.execPath,['scripts/check.mjs','--herdr-app',HERDR_APP],'final-herdr-check.json');
 const meta=action('ticket-meta'),mine=action('ticket-list',{mine:true,refresh:true});
 const summary={at:new Date().toISOString(),tests:'passed',officialChecks:'passed',tracker:{teams:meta.teams.length,projects:meta.projects.length,states:meta.states.length,mine:mine.issues.length},layouts:[]};
 if(mine.issues.length){
  const issue=mine.issues[0];const detail=action('ticket-detail',{id:issue.id,refresh:true});
  if(detail.issue.id!==issue.id)throw new Error('Identité ticket incohérente.');
  const search=action('ticket-list',{search:issue.identifier,refresh:true});
  if(!search.issues.some(i=>i.id===issue.id))throw new Error('Recherche ticket incohérente.');
  const state=meta.states.find(s=>s.team?.id===issue.team?.id&&s.name===issue.state?.name);
  const filtered=action('ticket-list',{teamId:issue.team?.id,priority:issue.priority,stateId:state?.id,mine:true,refresh:true});
  if(!filtered.issues.some(i=>i.id===issue.id))throw new Error('Filtres ticket incohérents.');
  summary.tracker.detail=true;summary.tracker.search=true;summary.tracker.filters=true;summary.tracker.stateFilter=!!state;
 }
 const snapshot=action('snapshot');summary.projectCounts=[];
 for(const project of snapshot.projects){const counts=action('project-summary',{key:project.key});if(!counts.complete||typeof counts.total!=='number')throw new Error('Compteurs Tracker incomplets.');summary.projectCounts.push({key:counts.key,open:counts.open,total:counts.total,unknown:counts.unknown});}
 for(const name of ['fabrique-console-development','fabrique-console-qa-release','fabrique-console']){
  await herdr.window.run('layout.switch',{name});const status=await herdr.window.status();
  if(status.errors?.length)throw new Error('Erreurs layout '+name);
  await herdr.window.shot(join(local,name+'-shot.png'));summary.layouts.push(name);
 }
 const smoke=join(local,'smoke/launch.json');
 if(existsSync(smoke)){
  const s=JSON.parse(readFileSync(smoke,'utf8')).session;
  const t=JSON.parse((await herdr.get(s.terminalId)).stdout);
  if(t.labels?.['fabrique-console.session']!==s.id)throw new Error('Identité terminal smoke incohérente.');
  summary.smoke={terminalVerified:true,state:t.state,status:t.status,reported:t.reported};
  writeFileSync(join(local,'smoke-screen.txt'),(await herdr.read(s.terminalId,35)).stdout,{mode:0o600});
 }
 writeFileSync(join(local,'verification.json'),JSON.stringify(summary,null,2)+'\n',{mode:0o600});
 console.log('Vérifications réussies. Rapport privé : docs/local/verification.json');
}catch(e){console.error(e.message);process.exitCode=1;}
