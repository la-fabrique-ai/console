import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile,readdir } from 'node:fs/promises';
import * as build from '../scripts/build-ui.mjs';
import { projectLook } from '../ui/v3/model.js';
import { glyphOf,leadScreen,screenOfAgent } from '../mods/fabrique-console-v4-bar/nav.js';
import { configV2 } from './helpers/config-v2-fixture.mjs';
const projects=[{key:'synthetic-orbit',name:'Orbite',color:'#123456',icon:'◆',leadLayout:'generated'}, {key:'synthetic-nova',name:'Nova',color:'#ABCDEF',icon:'folder',leadLayout:'generic'}];
test('project presentation uses configured values and generic fallbacks for any key',()=>{
 assert.deepEqual(projectLook(projects[0]),{color:'#123456'});assert.equal(glyphOf(projects[0]),'◆');
 assert.equal(glyphOf(projects[1]),'N');assert.equal(projectLook({key:'alpha'}).color,'#9AA2AD');
 assert.equal(projectLook({color:'#808080'}).color,'#808080');
 assert.equal(leadScreen(projects[0]),'fabrique-console-v4-lead-synthetic-orbit');assert.equal(leadScreen(projects[1]),'fabrique-console-v4-lead');
 assert.equal(leadScreen('synthetic-orbit',projects),'fabrique-console-v4-lead-synthetic-orbit');assert.equal(leadScreen('unknown',projects),'fabrique-console-v4-lead');
});
test('Lead layouts are generated solely from configured projects',()=>{
 assert.equal(typeof build.projectLayoutArtifacts,'function');
 const c=configV2();c.projects=projects.map(p=>({...configV2().projects[0],...p}));
 const artifacts=build.projectLayoutArtifacts(c);
 assert.deepEqual(Object.keys(artifacts).sort(),['fabrique-console-v4-lead-synthetic-orbit.json','fabrique-console-v4-lead-synthetic-orbit.svg']);
 const layout=JSON.parse(artifacts['fabrique-console-v4-lead-synthetic-orbit.json']);assert.equal(layout.colors.accent,'#123456');
 assert.match(artifacts['fabrique-console-v4-lead-synthetic-orbit.svg'],/#123456/);
 assert.deepEqual(build.projectLayoutArtifacts({...c,projects:[]}),{});
});
test('project dictionaries stay outside engine, UI, scripts and roles',async()=>{
 const dictionary=['alpha','gamma','delta','beta','lba',...projects.map(p=>p.key)];
 const forbidden=new RegExp('\\b(?:'+dictionary.join('|')+')\\b','i');
 const scan=async folder=>{for(const entry of await readdir(folder,{withFileTypes:true})){
  const file=new URL(entry.name+(entry.isDirectory()?'/':''),folder);
  if(entry.isDirectory())await scan(file);
  else if(/\.(?:mjs|js|md)$/.test(entry.name))assert.doesNotMatch(await readFile(file,'utf8'),forbidden,file.pathname);
 }};
 for(const dir of ['src/','ui/','scripts/','roles/'])await scan(new URL('../'+dir,import.meta.url));
});
