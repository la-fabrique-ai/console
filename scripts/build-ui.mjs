import {readdir,copyFile,mkdir,writeFile,readFile,unlink} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {validateConfig} from '../src/config.mjs';
const root=new URL('../',import.meta.url);
const copy=(from,to)=>copyFile(new URL(from,root),new URL(to,root));
// The V3 mods share the design kit, the texts, the pure rules and the observation of live agents.
export const V3_SHARED=['kit.js','texts.js','model.js','view.js','observed.js'];
// The V4 mods add their look, words and rules; they read the feed and the issues through the V3 files until those go.
export const V4_SHARED=['look.js','words.js','nav.js','page.js','line.js','board.js','blocks.js','answers.js','dialog.js'];
// ---- The V4 layouts: one frame (rail, column, tabs), one body per screen. Written here so that the frame cannot drift
// from one screen to another.
const COLORS={accent:'#6B6CF5',canvas:'#0F1115',chrome:'#161920',surface:'#1C2029',border:'#262A33'},LEAD='#F472B6';
const TERMINAL={id:'terminal',type:'block',min:180,padding:[12,24],content:{tab:'active',pane:{lone:true,gap:6,radius:8,border:{width:1,color:'border'},focus:{width:1,color:'accent'}}}};
const screen=mod=>[{id:mod,type:'block',content:{mod}}];
const HEAD={id:'fabrique-console-v4-agent-head',type:'block',content:{mod:'fabrique-console-v4-agent-head'},size:{px:66}};
const SCREENS={pilot:[{id:'fabrique-console-v4-pilot',type:'block',content:{mod:'fabrique-console-v4-pilot'},size:{px:66}},TERMINAL],agent:[HEAD,TERMINAL],lead:[HEAD,TERMINAL],inbox:screen('fabrique-console-v4-inbox'),issues:screen('fabrique-console-v4-issues'),mockup:screen('fabrique-console-v4-mockup'),sim:[{id:'sim-row',type:'row',children:[{id:'herdr-sim',type:'block',content:{mod:'herdr-sim',props:{frames:'fabrique-console'}},size:{px:440}},TERMINAL]}],devs:screen('fabrique-console-v4-devs'),ticket:screen('fabrique-console-v4-ticket'),project:screen('fabrique-console-v4-project')};
// Beside Pilot and beside an agent, a column on the right: the Inbox and the developments, or the agent's development.
// Its width is fixed: a container is resizable unless it says otherwise, whatever the root says.
const SIDE_PAGES=['pilot','agent','lead'],SIDE_PX=420;
const withSide=(page,body)=>SIDE_PAGES.includes(page)?[{id:'with-side',type:'row',resizable:false,size:{weight:1},children:[{id:'main',type:'column',resizable:false,size:{weight:1},children:body},{id:'fabrique-console-v4-side',type:'block',content:{mod:'fabrique-console-v4-side',props:{page}},size:{px:SIDE_PX}}]}]:body;
const layout=(page,body,name=page,accent=null)=>({id:'root',type:'row',titlebar:'none',traffic_lights:[7,18],theme:'graphite',font:'JetBrains Mono',font_size:13,ui_font:'Geist',background:'canvas',colors:page==='lead'?{...COLORS,accent:accent||LEAD}:COLORS,terminal_padding:[8,8],gap:0,resizable:false,preview:'layouts/fabrique-console-v4-'+name+'.svg',
  children:[{id:'fabrique-console-v4-rail',type:'block',content:{mod:'fabrique-console-v4-rail'},size:{px:64},window_drag:true},
    {id:'fabrique-console-v4-bar',type:'block',content:{mod:'fabrique-console-v4-bar',props:{page}},size:{px:228}},
    {id:'body',type:'column',size:{weight:1},children:[{id:'fabrique-console-v4-tabs',type:'block',content:{mod:'fabrique-console-v4-tabs',props:{page}},size:{px:44},window_drag:true},...withSide(page,body)]}]});
// The picture the settings screen shows for a layout: the frame, the screen's body in the accent colour.
const preview=page=>`<svg xmlns="http://www.w3.org/2000/svg" width="240" height="150" viewBox="0 0 240 150"><rect width="240" height="150" rx="8" fill="#0F1115"/><rect width="16" height="150" fill="#0A0C10"/><rect x="16" width="58" height="150" fill="#161920"/><rect x="74" width="166" height="14" fill="#0C0E12"/><rect x="74" width="34" height="14" fill="#2A2B5E"/><rect x="${page==='pilot'||page==='agent'?84:82}" y="${page==='pilot'?44:24}" width="${page==='pilot'||page==='agent'?146:150}" height="${page==='pilot'?96:116}" rx="4" fill="#6B6CF5" opacity="${page==='pilot'||page==='agent'?0.35:0.2}"/></svg>\n`;
// A Lead opens in the colour of its project, outlined even when the terminal has lost the focus.
const OUTLINED=JSON.parse(JSON.stringify(TERMINAL).replace('"border":{"width":1,"color":"border"}','"border":{"width":2,"color":"accent"}').replace('"focus":{"width":1,','"focus":{"width":2,'));
export function projectLayoutArtifacts(input) {
  const config=validateConfig(input),artifacts={};
  for(const project of config.projects) {
    if(project.leadLayout!=='generated')continue;
    const name='lead-'+project.key;
    artifacts['fabrique-console-v4-'+name+'.json']=JSON.stringify(layout('lead',[HEAD,OUTLINED],name,project.color),null,2)+'\n';
    artifacts['fabrique-console-v4-'+name+'.svg']=preview('lead').replaceAll(COLORS.accent,project.color);
  }
  return artifacts;
}
export async function buildUI({configFile=new URL('config/projects.example.json',root)}={}) {
  const config=JSON.parse(await readFile(configFile,'utf8'));
  const projectArtifacts=projectLayoutArtifacts(config);
  for(const name of await readdir(new URL('layouts/',root))) {
    if(/^fabrique-console-v4-lead-.+\.(json|svg)$/.test(name)&&!Object.hasOwn(projectArtifacts,name))await unlink(new URL('layouts/'+name,root));
  }
for(const name of await readdir(new URL('mods/',root))) {
  if(!name.startsWith('fabrique-console-')) continue;
  await copy('ui/common.js','mods/'+name+'/common.js');
  if(!name.startsWith('fabrique-console-v3-')&&!name.startsWith('fabrique-console-v4-')) continue;
  for(const file of V3_SHARED) await copy('ui/v3/'+file,'mods/'+name+'/'+file);
  await mkdir(new URL('mods/'+name+'/icons/',root),{recursive:true});
  for(const icon of await readdir(new URL('ui/v3/icons/',root))) if(icon.endsWith('.svg')) await copy('ui/v3/icons/'+icon,'mods/'+name+'/icons/'+icon);
  if(name.startsWith('fabrique-console-v4-'))for(const file of V4_SHARED) await copy('ui/v4/'+file,'mods/'+name+'/'+file);
  if(name.startsWith('fabrique-console-v4-'))for(const icon of await readdir(new URL('ui/v4/icons/',root))) if(icon.endsWith('.svg')) await copy('ui/v4/icons/'+icon,'mods/'+name+'/icons/'+icon);
}

for(const [name,content] of Object.entries(projectArtifacts))await writeFile(new URL('layouts/'+name,root),content);
for(const [page,body] of Object.entries(SCREENS)) {
  await writeFile(new URL('layouts/fabrique-console-v4-'+page+'.json',root),JSON.stringify(layout(page,body),null,2)+'\n');
  await writeFile(new URL('layouts/fabrique-console-v4-'+page+'.svg',root),preview(page));
}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const args=process.argv.slice(2);
  if(args.length&&!(args.length===2&&args[0]==='--config'))throw new Error('Usage: build-ui.mjs [--config CONFIG_JSON]');
  await buildUI(args.length?{configFile:resolve(args[1])}:{});
}
