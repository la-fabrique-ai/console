import { join } from 'node:path';
import { createBackend } from '../../src/backend.mjs';
import { configV2 } from './config-v2-fixture.mjs';
import { enrichedFixture,ticket,connection } from './enriched-fixture.mjs';

import { withFakeHerdr } from './fake-herdr.mjs';
export const ordinaryDescription='## Besoin *\nConnaître les éléments manquants du ticket.\n\n## Résultat attendu *\nLa qualification rend un état par règle.\n\n## Critères d\'acceptation *\n- [ ] Les six règles sont vérifiées.\n\n## Vérification *\nExécuter le profil rapide configuré.\n';
export const bugDescription='## Constat\nErreur reproduite dans une fixture.\n## Gravité\nP2 : effet limité au test.\n## Reproduction\nOuvrir la fixture et lire son état.\n## Cause\nCause décrite avec ses preuves.\n## Critères d\'acceptation\n- [ ] Le cas de régression est vérifié.\n## Vérification\nExécuter le profil de régression configuré.\n';
export const labelNames=names=>connection(names.map((name,index)=>({id:'label-'+index,name})));
export const readyLabels=['prêt','agent:codex','niveau:standard','web'];

export async function qualificationFixture(t,{options={},token,handler:initialHandler}={}) {
  let current=ticket('one',{description:ordinaryDescription,labels:labelNames(readyLabels)}),handler=initialHandler;
  const f=await enrichedFixture(t,{...(token!==undefined?{token}:{}),options,handler:async(...args)=>{
    const override=await handler?.(...args);if(override!==undefined)return override;
    if(args[0]==='Issue')return {issue:structuredClone(current)};
    if(args[0]==='Labels')return {issue:{id:'one',labels:connection(current.labels.nodes.slice(3))}};
  }});
  const config=configV2();config.worktreesRoot=join(f.root,'must-not-be-created');
  Object.assign(config.projects[0],{teamId:'team',projectId:'epic',preferredAgent:'claude'});
  config.projects[0].repos[0].path=f.repo;config.projects[0].repos[1].path=join(f.root,'declared-specs');
  await f.write('config.json',config);
  const commands=[];
  const backend=createBackend(withFakeHerdr({root:f.home,tracker:f.tracker,exec:async(file,args)=>{
    commands.push({file,args});throw new Error('Qualification must not start an external command or read credentials.');
  },ticketReadOptions:{provider:f.provider,fetch:f.fetch,...options}}));
  return {...f,config,backend,commands,
    setIssue:patch=>{current={...current,...structuredClone(patch)};},
    currentIssue:()=>structuredClone(current),setHandler:value=>{handler=value;},
    qualify:(input={})=>backend.dispatch('ticket-qualify',{key:'example',issueId:'one',...input}),
  };
}
