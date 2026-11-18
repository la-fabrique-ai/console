import {MODEL_ALLOWLIST,MODEL_EFFORTS} from './config.mjs';

// A proposal is data, never an argv. Do not read an example inside fenced code.
export function ticketModel(description,labels,{labelsComplete=true}={}) {
  const absent={model:null,effort:null,modelIssue:null},lines=[];let fence=null;
  if(description===undefined||(description!==null&&typeof description!=='string'))return {...absent,modelIssue:'Modèle non vérifié.'};
  for(const line of String(description??'').split(/\r\n|\r|\n/)) {
    const f=/^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if(fence){if(f&&f[0]===fence[0]&&f.length>=fence.length&&!line.trim().slice(f.length).trim())fence=null;continue;}
    if(f){fence=f;continue;}
    if(/^(?: {4}|\t)/.test(line))continue;
    const colon=line.indexOf(':');
    if(colon>=0&&line.slice(0,colon).trim().normalize('NFC').toLowerCase()==='modèle')lines.push(line.slice(colon+1).trim());
  }
  if(!lines.length)return absent;
  const invalid=modelIssue=>({...absent,modelIssue});
  if(lines.length!==1)return invalid('Plusieurs modèles sont indiqués.');
  const parts=lines[0].split('·'),model=parts[0].trim();
  if(parts.length!==2)return invalid('La ligne du modèle est illisible.');
  const effortParts=parts[1].trim().split(/\s+/u);
  if(effortParts.length!==2||effortParts[0].toLowerCase()!=='effort')return invalid('La ligne du modèle est illisible.');
  const family=Object.keys(MODEL_ALLOWLIST).find(tool=>MODEL_ALLOWLIST[tool].includes(model));
  if(!family)return invalid('Modèle non autorisé.');
  const effort=effortParts[1];
  if(!MODEL_EFFORTS.includes(effort))return invalid('Effort non autorisé.');
  if(!labelsComplete)return invalid('Agent non vérifié.');
  const agents=new Set(labels.map(l=>String(l.name??'').normalize('NFC').toLowerCase()).filter(l=>l.startsWith('agent:')).map(l=>l.slice(6).trim()));
  if(agents.size>1)return invalid('L’agent du ticket est ambigu.');
  if(agents.size&&[...agents][0]!==family)return invalid('Le modèle ne correspond pas à l’agent.');
  return {model,effort,modelIssue:null};
}
