import {join,resolve,relative,isAbsolute,dirname} from 'node:path';
import {realpath,mkdir,readFile,writeFile,rename,rm,link} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {exec,fail} from './common.mjs';
import {gitEnvironment} from './git-environment.mjs';

const ticketPattern=/^[A-Z][A-Z0-9]{0,9}-\d{1,7}$/,ASKERS=['dev','review-1','review-2','qa'];
// The question of an agent, for the watcher: no commit needed, it may be stuck before the first one.
// A dev that says its ticket stopped (M10): no commit needed either; its instant is the instant of the stop.
async function writeAsk(args,root){
  const at=new Date(),stop=args.kind==='block',folder=join(root,'.fabrique-console'),base=join(folder,args.ticket+(stop?'.block-':'.ask-')),temp=base+randomUUID()+'.tmp';
  const encoded=JSON.stringify(stop?{ticket:args.ticket,reason:args.reason,...(args.migration?{migration:args.migration}:{}),from:'dev',at:at.toISOString()}:{ticket:args.ticket,question:args.question,options:args.options.map(option=>option.trim()),from:args.from,at:at.toISOString()},null,2)+'\n';
  try{
    await mkdir(folder,{recursive:true});await writeFile(temp,encoded);
    // Two questions in one millisecond are two questions: the next free number, a file is never replaced.
    for(let stamp=at.getTime();;stamp++){
      const path=base+stamp+'.json';
      try{await link(temp,path);return stop?{path,ticket:args.ticket,kind:'block'}:{path,ticket:args.ticket,kind:'ask',question:args.question};}
      catch(error){if(error.code!=='EEXIST')throw error;}
    }
  }
  catch{fail('STORAGE_ERROR',stop?'L’arrêt n’a pas pu être enregistré.':'La question n’a pas pu être enregistrée.');}
  finally{await rm(temp,{force:true}).catch(()=>{});}
}
function argumentsOf(argv){
  const[kind,...rest]=argv;if(!['dev','review','ask','block'].includes(kind))fail('INVALID_ARGUMENT','Choisissez dev, review, ask ou block.');
  const allowed=kind==='block'?['ticket','reason','migration','worktree']:kind==='ask'?['ticket','question','option','from','worktree']:['ticket','commit','repo','summary','worktree',...(kind==='review'?['n','verdict','note']:[])],args={notes:[],options:[]};
  for(let at=0;at<rest.length;at+=2){
    const key=rest[at].startsWith('--')?rest[at].slice(2):'';
    if(!allowed.includes(key)||rest[at+1]===undefined||!['note','option'].includes(key)&&Object.hasOwn(args,key))fail('INVALID_ARGUMENT','Option inconnue, répétée ou sans valeur.');
    if(key==='note')args.notes.push(rest[at+1]);else if(key==='option')args.options.push(rest[at+1]);else args[key]=rest[at+1];
  }
  if(kind==='block'){
    const reason=(args.reason??'').trim(),migration=(args.migration??'').trim();
    if(!ticketPattern.test(args.ticket??'')||!reason||reason.length>2000||/[\0]/.test(reason)||migration.length>40||/[\r\n\0]/.test(migration))fail('INVALID_ARGUMENT','Un ticket, ce qui bloque en 2000 signes au plus, et la migration en 40 signes au plus.');
    return{kind,...args,reason,...(migration?{migration}:{})};
  }
  if(kind==='ask'){
    const question=(args.question??'').trim(),from=args.from??'dev';
    if(!ticketPattern.test(args.ticket??'')||!question||question.length>2000||!ASKERS.includes(from)||args.options.length>4||args.options.some(option=>!option.trim()||option.length>200||/[\r\n\0]/.test(option)))fail('INVALID_ARGUMENT','Un ticket, une question de 2000 signes au plus, quatre réponses de 200 signes au plus, et un auteur dev, review-1, review-2 ou qa.');
    return{kind,...args,question,from};
  }
  if(!ticketPattern.test(args.ticket??'')||!/^[a-fA-F0-9]{7,64}$/.test(args.commit??''))fail('INVALID_ARGUMENT','Ticket du tracker et SHA de commit requis.');
  if((args.summary??'').length>2000||args.notes.length>100||args.notes.some(note=>note.length>2000))fail('INVALID_ARGUMENT','Résumé ou remarques trop longs.');
  if(kind==='review'&&(!/^[1-9]\d{0,2}$/.test(args.n??'')||!['accepted','changes_requested'].includes(args.verdict)))fail('INVALID_ARGUMENT','La revue exige un numéro de 1 à 999 et un verdict accepted ou changes_requested.');
  return{kind,...args};
}
export async function writeDevReport(argv,{cwd=process.cwd()}={}){
  const args=argumentsOf(argv);let worktree;
  try{worktree=await realpath(resolve(cwd,args.worktree??'.'));}catch{fail('REPORT_REPOSITORY_NOT_FOUND','Le worktree indiqué est introuvable.');}
  let metadata=null,cursor=worktree;
  for(;;){
    let raw;
    try{raw=await readFile(join(cursor,'.fabrique-console','ticket.json'),'utf8');}catch(error){if(error.code!=='ENOENT')fail('WORKTREE_CHANGED','Les métadonnées du ticket sont illisibles.');}
    if(raw!==undefined){
      try{metadata=JSON.parse(raw);}catch{fail('WORKTREE_CHANGED','Les métadonnées du ticket sont illisibles.');}
      if(metadata.version!==1||metadata.path!==cursor||metadata.ticket!==args.ticket||metadata.status!=='ready'||typeof metadata.issuePath!=='string'||!Array.isArray(metadata.repositories))fail('WORKTREE_CHANGED','Ce worktree ne correspond pas au ticket indiqué.');
      worktree=cursor;break;
    }
    if(dirname(cursor)===cursor)break;cursor=dirname(cursor);
  }
  const reportRoot=metadata?await realpath(metadata.issuePath):worktree;
  if(args.kind==='ask'||args.kind==='block')return writeAsk(args,reportRoot);
  const folder=join(reportRoot,'.fabrique-console'),name=args.ticket+'.'+(args.kind==='dev'?'dev':'review-'+args.n)+'.json';
  let previous=null;
  if(args.kind==='review')try{previous=JSON.parse(await readFile(join(folder,args.ticket+'.dev.json'),'utf8'));}catch{}
  const repo=args.repo??(typeof previous?.repo==='string'?previous.repo:'.');
  if(typeof repo!=='string'||!repo||repo.length>200||isAbsolute(repo)||repo!=='.'&&repo.split('/').some(part=>!part||part==='.'||part==='..')||repo.includes('\\')||/[\x00-\x1f]/.test(repo))fail('INVALID_ARGUMENT','Le dépôt doit être un chemin relatif du worktree, ou « . ».');
  let target;
  try{target=await realpath(join(worktree,repo));}catch{fail('REPORT_REPOSITORY_NOT_FOUND','Le dépôt indiqué est introuvable.');}
  const rest=relative(worktree,target);if(rest==='..'||rest.startsWith('../')||isAbsolute(rest))fail('REPORT_REPOSITORY_NOT_FOUND','Le dépôt indiqué est hors du worktree.');
  const git=async parameters=>(await exec('git',['-C',target,...parameters],{shell:false,encoding:'utf8',timeout:10000,maxBuffer:65536,env:gitEnvironment(process.env)})).stdout.trim();
  try{if(await realpath(await git(['rev-parse','--show-toplevel']))!==target)throw Error('Not a repository root');}
  catch{fail('REPORT_REPOSITORY_NOT_FOUND','Le dossier indiqué doit être la racine de son dépôt Git.');}
  let commit;
  try{commit=await git(['rev-parse','--verify',args.commit+'^{commit}']);if(!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(commit))throw Error('Invalid commit');}
  catch{fail('REPORT_COMMIT_NOT_FOUND','Ce commit est absent du dépôt indiqué.');}
  let branch=null;try{branch=await git(['symbolic-ref','--quiet','--short','HEAD']);}catch{}
  let baseCommit=null,repositories;
  if(metadata){
    const selected=metadata.repositories.find(row=>row.repo===repo);
    if(!selected||branch!==metadata.branch)fail('WORKTREE_CHANGED','Le dépôt n’est plus sur la branche de ce ticket.');
    try{await git(['merge-base','--is-ancestor',selected.baseCommit,commit]);}catch{fail('WORKTREE_CHANGED','Le commit ne descend pas de la base du ticket.');}
    if(await git(['rev-parse','--verify','HEAD'])!==commit)fail('REPORT_STALE','Le commit du rapport doit être le commit courant de la branche du ticket.');
    baseCommit=selected.baseCommit;repositories=[];
    for(const row of metadata.repositories){
      if(typeof row.repo!=='string'||row.repo!=='.'&&(isAbsolute(row.repo)||row.repo.split('/').some(part=>!part||part==='.'||part==='..')))fail('WORKTREE_CHANGED','Un dépôt du ticket est invalide.');
      const path=join(worktree,row.repo);
      const head=(await exec('git',['-C',path,'rev-parse','--verify','refs/heads/'+metadata.branch+'^{commit}'],{shell:false,encoding:'utf8',timeout:10000,maxBuffer:65536,env:gitEnvironment(process.env)})).stdout.trim();
      if(!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(head))fail('WORKTREE_CHANGED','Un commit du ticket est illisible.');
      repositories.push({repo:row.repo,commit:head,baseCommit:row.baseCommit,branch:metadata.branch});
    }
  }
  const report={ticket:args.ticket,commit,repo,branch,...(metadata?{baseCommit,repositories}:{}),summary:args.summary??'',...(args.kind==='review'?{verdict:args.verdict,notes:args.notes}:{})};
  const encoded=JSON.stringify(report,null,2)+'\n';
  if(Buffer.byteLength(encoded)>65536)fail('INVALID_ARGUMENT','Le compte rendu dépasse la limite de 64 Ko.');
  const path=join(folder,name),temp=path+'.'+randomUUID()+'.tmp';
  try{await mkdir(folder,{recursive:true});await writeFile(temp,encoded);await rename(temp,path);}
  catch{fail('STORAGE_ERROR','Le compte rendu n’a pas pu être enregistré.');}
  finally{await rm(temp,{force:true}).catch(()=>{});}
  return{path,ticket:args.ticket,kind:args.kind,commit,branch,repo,...(metadata?{baseCommit,repositories}:{})};
}
