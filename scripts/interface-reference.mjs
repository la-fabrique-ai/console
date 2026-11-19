import {ticketError,ticketConnection} from '../integrations/tickets/factory.mjs';
import { readFile,readdir,writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export async function readSources(root=new URL('../',import.meta.url)) {
  const sources=new Map();
  async function walk(folder) {
    for(const entry of (await readdir(new URL(folder,root),{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))) {
      const path=folder+entry.name;
      if(entry.isDirectory()&&entry.name!=='tests')await walk(path+'/');
      else if(entry.isFile()&&entry.name.endsWith('.mjs')&&!entry.name.endsWith('.test.mjs')) {
        // The default connector is documented as <connector>; another bundled connector keeps its own folder.
        const key=path.replace(new RegExp('^(integrations/tickets/)'+ticketConnection({}).driver+'/'),'$1<connector>/').replaceAll(ticketConnection({}).driver,'tracker');
        const source=(await readFile(new URL(path,root),'utf8')).replace(/(['"`])([A-Z][A-Z0-9_]+)\1/g,(all,quote,code)=>quote+ticketError({code}).code+quote);
        sources.set(key,source);
      }
    }
  }
  await walk('src/');await walk('integrations/');return sources;
}
const sorted=values=>[...new Set(values)].sort();
function firstArgument(source,start) {
  let depth=0,quote=null,escaped=false;
  for(let i=start;i<source.length;i++) {
    const c=source[i];
    if(quote){if(escaped)escaped=false;else if(c==='\\')escaped=true;else if(c===quote)quote=null;continue;}
    if(['\'', '"','`'].includes(c)){quote=c;continue;}
    if('([{'.includes(c))depth++;
    else if(')]}'.includes(c)){if(depth===0)return source.slice(start,i).trim();depth--;}
    if(c===','&&depth===0)return source.slice(start,i).trim();
  }
  throw new Error('Unterminated error expression in backend sources');
}
export function inspectInterface(sources,nonErrorLiterals=[]) {
  const backend=sources.get('src/backend.mjs')??'',block=backend.match(/const actions=new Map\(\[([\s\S]*?)\n\s*\]\);/);
  if(!block||/actions\.(?:set|delete|clear)\s*\(/.test(backend))throw new Error('actions: unsupported registry; update the reference inspector explicitly');
  const entries=[...block[1].matchAll(/\[\s*(['"])([a-z][a-z0-9-]*)\1\s*,\s*([\w.]+)\s*\]/g)];
  if(block[1].replace(/\[\s*(['"])([a-z][a-z0-9-]*)\1\s*,\s*[\w.]+\s*\]/g,'').replace(/[\s,]/g,''))throw new Error('actions: nonliteral registration requires explicit documentation');
  const literals=[],expressions=[],locations={};
  for(const [path,source] of sources) {
    for(const match of source.matchAll(/(['"`])([A-Z][A-Z0-9_]+)\1/g)) {
      literals.push(match[2]);(locations[match[2]]??=[]).push(path);
    }
    for(const match of source.matchAll(/\b([A-Z][A-Z0-9_]+)\s*:/g)) {
      literals.push(match[1]);(locations[match[1]]??=[]).push(path);
    }
    for(const match of source.matchAll(/\b(?:fail|refusal|new\s+AppError)\s*\(|(?:\bcode|['"]code['"])\s*:\s*/g)) {
      const expression=firstArgument(source,match.index+match[0].length).replace(/\s+/g,' ');
      if(!/^(['"`])[A-Z][A-Z0-9_]+\1$/.test(expression))expressions.push(path+': '+expression);
    }
  }
  const constants=new Set(nonErrorLiterals);
  return {actions:sorted(entries.map(entry=>entry[2])),codes:sorted(literals.filter(value=>!constants.has(value))),literals:sorted(literals),expressions:sorted(expressions),locations:Object.fromEntries(Object.entries(locations).map(([key,value])=>[key,sorted(value)]))};
}
function equalSet(actual,expected,label) {
  const left=sorted(actual),right=sorted(expected);
  if(JSON.stringify(left)!==JSON.stringify(right))throw new Error(`${label}: undocumented=${left.filter(item=>!right.includes(item)).join(', ')}; absent from source=${right.filter(item=>!left.includes(item)).join(', ')}`);
}
export function verifyReference(reference,sources) {
  const inventory=inspectInterface(sources,reference.nonErrorLiterals);
  equalSet(inventory.actions,Object.keys(reference.actions),'actions');
  equalSet(inventory.codes,Object.keys(reference.codes),'codes');
  equalSet(reference.nonErrorLiterals,inventory.literals.filter(value=>reference.nonErrorLiterals.includes(value)),'codes: unused non-error exemptions');
  equalSet(inventory.expressions,reference.codeExpressions,'expressions');
  for(const [name,action] of Object.entries(reference.actions)) {
    for(const key of ['purpose','input','output','writes','confirmation','replay','source'])if(!action[key])throw new Error(`actions: ${name} needs ${key}`);
    for(const code of [...action.codes,...(action.reasons??[])])if(!reference.codes[code])throw new Error(`codes: ${name} mentions unknown ${code}`);
  }
  for(const [code,item] of Object.entries(reference.codes)) {
    if(!item.description||!item.handling)throw new Error(`codes: ${code} needs meaning and handling`);
    if(!['error','refusal','both','warning','reason','worker'].includes(item.channel))throw new Error(`codes: ${code} needs a valid channel`);
  }
  return inventory;
}
export function renderReference(reference) {
  const out=['# Référence du backend — étapes 1, 3a, 8b et lots 4.1/4.2','',...reference.introduction.flatMap(text=>[text,'']),'## Types des échanges',''];
  for(const [name,type] of Object.entries(reference.types))out.push(`### ${name}`,'',type.description??'','', '```json',JSON.stringify(type.shape,null,2),'```','');
  out.push('## Actions','');
  for(const [name,action] of Object.entries(reference.actions)) {
    out.push(`### \`${name}\``,'',action.purpose,'',`Source : ${action.source.map(path=>`[${path}](../${path})`).join(', ')}.`,'',`Entrée : ${action.input}`,'',`Sortie : ${action.output}`,'',`Écritures : ${action.writes}`,'',`Confirmation : ${action.confirmation}`,'',`Rejeu : ${action.replay}`,'',`Codes spécifiques : ${action.codes.map(code=>'`'+code+'`').join(', ')||'aucun'} ; voir aussi les codes communs.`,...(action.reasons?[`Raisons d’observation (pas des exceptions) : ${action.reasons.map(code=>'`'+code+'`').join(', ')}.`]:[]),'');
  }
  out.push('## Codes et conduite à tenir','',`Codes communs : ${reference.commonCodes.map(code=>'`'+code+'`').join(', ')}. Les erreurs typées sont distinctes des refus dans data et de preparation.errorCode.`,'');
  for(const [code,item] of Object.entries(reference.codes))out.push(`- **${code}** (${item.channel}) — ${item.description} **À faire :** ${item.handling}`);
  out.push('','## Fichiers d’état et versions','',...reference.stateFiles.map(item=>`- **${item.path}** — ${item.version}. ${item.description}`),'','## Parcours à respecter','',...reference.workflows.flatMap(text=>[text,'']),'## Contrôle de dérive','',reference.driftPolicy,'','## Suites','', 'Remarques et limites : [etape1-suites.md](etape1-suites.md). Ce document est le lieu unique des suites, pas une liste de comportements supplémentaires.','');
  return out.join('\n');
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const root=new URL('../',import.meta.url),reference=JSON.parse(await readFile(new URL('docs/backend-interface.json',root),'utf8'));
  verifyReference(reference,await readSources(root));
  if(process.argv[2]==='--write')await writeFile(new URL('docs/backend-interface.md',root),renderReference(reference));
  else if(await readFile(new URL('docs/backend-interface.md',root),'utf8')!==renderReference(reference))throw new Error('Markdown stale: node scripts/interface-reference.mjs --write');
}
