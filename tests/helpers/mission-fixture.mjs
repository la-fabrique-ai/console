import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { createBackend } from '../../src/backend.mjs';
import { qualificationFixture } from './qualification-fixture.mjs';
import { document } from './enriched-fixture.mjs';

import { withFakeHerdr } from './fake-herdr.mjs';
export async function missionFixture(t,{missionOptions={},readOptions={}}={}) {
  const f=await qualificationFixture(t),remote=join(f.root,'origin.git');
  await f.command('git',['clone','--bare',f.repo,remote]);
  await f.command('git',['-C',f.repo,'remote','add','origin',remote]);
  let plan={...document('plan'),content:'Objectif : rendre un diagnostic vérifiable.\nDécisions : aucun choix ouvert.\n',archivedAt:null,project:{id:'epic'}},handler,gitAllowed=true;
  f.setHandler(async(op,vars)=>{
    const override=await handler?.(op,vars);if(override!==undefined)return override;
    if(op==='Document')return {document:structuredClone(plan)};
  });
  let clock=Date.now();const commands=[];
  const backend=createBackend(withFakeHerdr({root:f.home,tracker:f.tracker,
    exec:async(file,args,options)=>{
      commands.push({file,args});if(file!=='git'||!gitAllowed)throw new Error('Only fixture Git reads are allowed; no HC or agent launch.');
      return f.command(file,args,options);
    },ticketReadOptions:{provider:f.provider,fetch:f.fetch,...readOptions},missionOptions:{now:()=>clock,...missionOptions}},'/fixture/forbidden-hc'));
  return {...f,backend,commands,remote,setDocument:patch=>{plan={...plan,...structuredClone(patch)};},document:()=>structuredClone(plan),
    readPrivate:async name=>JSON.parse(await readFile(join(f.home,name),'utf8')),
    setHandler:value=>{handler=value;},setTime:value=>{clock=value;},time:()=>clock,forbidGit:()=>{gitAllowed=false;},
    preview:(input={})=>backend.dispatch('mission-preview',{key:'example',issueId:'one',role:'dev',plan:{projectId:'epic',documentId:'plan'},...input}),
    readMission:(missionId,input={})=>backend.dispatch('mission-read',{missionId,...input}),
  };
}
