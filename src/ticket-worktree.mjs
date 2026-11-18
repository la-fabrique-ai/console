import {join,dirname} from 'node:path';
import {lstat,readdir,realpath,readFile,writeFile,rename,mkdir,appendFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {AppError,fail,object,text,withLock} from './common.mjs';
import {isLead} from './state.mjs';

const identifier=/^[A-Z][A-Z0-9]{0,9}-\d{1,7}$/;
const sha=value=>typeof value==='string'&&/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value);
const exists=async path=>{try{await lstat(path);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}};
const metadataPath=path=>join(path,'.fabrique-console','ticket.json');
async function saveMetadata(metadata){
  const path=metadataPath(metadata.path),temp=path+'.'+randomUUID()+'.tmp';await mkdir(dirname(path),{recursive:true});await writeFile(temp,JSON.stringify(metadata,null,2)+'\n');await rename(temp,path);
}

// Normal local Git, as when working by hand. The lock serializes layout actions;
// no branch/worktree is ever removed, and conflicts are tested before merging.
export function createTicketWorktrees({root,invoke,loadState}){
  const git=(path,args)=>invoke('git',['-C',path,...args],{timeout:60000});
  const read=async(path,args)=>(await git(path,args)).stdout.trimEnd();
  async function context(input){
    object(input);if(Object.keys(input).some(key=>!['sessionId','ticket'].includes(key)))fail('INVALID_ARGUMENT','Argument de ticket inattendu.');
    text(input.sessionId,'sessionId',200);if(!identifier.test(input.ticket??''))fail('INVALID_ARGUMENT','Un identifiant de ticket Tracker est requis.');
    const po=(await loadState()).sessions.find(row=>isLead(row)&&row.id===input.sessionId);
    if(!po||!identifier.test(po.identifier??'')||typeof po.worktree!=='string')fail('NOT_FOUND','Le worktree de cette issue est introuvable.');
    let issuePath;try{issuePath=await realpath(po.worktree);}catch{fail('NOT_FOUND','Le worktree de cette issue est introuvable.');}
    const issueBranch=po.branch??po.identifier.toLowerCase();
    try{await git(issuePath,['check-ref-format','--branch',issueBranch]);}catch{fail('WORKTREE_CHANGED','La branche de l’issue est invalide.');}
    return{sessionId:po.id,issue:po.identifier,ticket:input.ticket,issuePath,issueBranch,path:join(dirname(issuePath),po.identifier+'-'+input.ticket),branch:issueBranch+'--'+input.ticket.toLowerCase()};
  }
  async function info(path,branch){
    try{
      if(await realpath(await read(path,['rev-parse','--show-toplevel']))!==await realpath(path)||await read(path,['symbolic-ref','--quiet','--short','HEAD'])!==branch)throw Error('Wrong checkout');
      const commit=await read(path,['rev-parse','--verify','HEAD']),common=await realpath(await read(path,['rev-parse','--path-format=absolute','--git-common-dir']));
      if(!sha(commit))throw Error('Missing commit');return{commit,common};
    }catch{fail('WORKTREE_CHANGED','Le dépôt ou la branche du worktree ne correspond plus à l’issue ou au ticket.');}
  }
  async function issueRepositories(ctx){
    const paths=[{repo:'.',path:ctx.issuePath}];
    for(const entry of(await readdir(ctx.issuePath,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){
      if(!entry.isDirectory()||entry.name.startsWith('.'))continue;
      const path=join(ctx.issuePath,entry.name);if(await exists(join(path,'.git')))paths.push({repo:entry.name,path});
    }
    for(const row of paths)Object.assign(row,await info(row.path,ctx.issueBranch));return paths;
  }
  async function excludeReports(path){
    const common=await realpath(await read(path,['rev-parse','--path-format=absolute','--git-common-dir'])),file=join(common,'info','exclude');let raw='';
    try{raw=await readFile(file,'utf8');}catch(error){if(error.code!=='ENOENT')throw error;}
    if(!raw.split('\n').includes('.fabrique-console/')){await mkdir(dirname(file),{recursive:true});await appendFile(file,(raw&&!raw.endsWith('\n')?'\n':'')+'.fabrique-console/\n');}
  }
  async function metadata(ctx,repositories){
    let saved;try{saved=JSON.parse(await readFile(metadataPath(ctx.path),'utf8'));}catch{fail('WORKTREE_COLLISION','Ce dossier de ticket existe sans préparation reconnue ; il est conservé.');}
    if(saved.version!==1||!['preparing','ready'].includes(saved.status)||['issue','ticket','issuePath','issueBranch','path','branch'].some(key=>saved[key]!==ctx[key])||!Array.isArray(saved.repositories)||saved.repositories.length!==repositories.length
      ||saved.repositories.some((row,i)=>row.repo!==repositories[i].repo||!sha(row.baseCommit)||row.common!==repositories[i].common))fail('WORKTREE_CHANGED','La préparation du ticket ne correspond plus aux dépôts de l’issue.');
    return saved;
  }
  const view=saved=>({path:saved.path,branch:saved.branch,issuePath:saved.issuePath,issueBranch:saved.issueBranch,repositories:saved.repositories.map(row=>({repo:row.repo,path:join(saved.path,row.repo),baseCommit:row.baseCommit,branch:saved.branch}))});
  async function prepare(input){
    return withLock(root,async()=>{
      const ctx=await context(input),repositories=await issueRepositories(ctx),present=await exists(ctx.path);
      let saved=present?await metadata(ctx,repositories):{version:1,...ctx,status:'preparing',repositories:repositories.map(row=>({repo:row.repo,baseCommit:row.commit,common:row.common}))};
      try{
        for(const row of repositories){
          const path=join(ctx.path,row.repo),base=saved.repositories.find(entry=>entry.repo===row.repo).baseCommit;
          if(await exists(path)){
            if(!present&&row.repo==='.')fail('WORKTREE_COLLISION','Le dossier du ticket existe déjà.');
            const current=await info(path,ctx.branch);if(current.common!==row.common)fail('WORKTREE_CHANGED','Le ticket appartient à un autre dépôt.');continue;
          }
          let branchExists=false;try{await git(row.path,['rev-parse','--verify','refs/heads/'+ctx.branch]);branchExists=true;}catch{}
          if(branchExists)fail('WORKTREE_COLLISION','La branche du ticket existe déjà sans ce worktree.');
          await git(row.path,['worktree','add','-b',ctx.branch,path,base]);
          if(row.repo==='.')await saveMetadata(saved);
        }
        await excludeReports(ctx.path);saved.status='ready';await saveMetadata(saved);return{...view(saved),reused:present};
      }catch(error){if(error instanceof AppError)throw error;fail('WORKTREE_FAILED','La préparation du ticket est incomplète ; les fichiers et branches créés sont conservés.');}
    });
  }
  async function clean(path,nested=[]){
    const gitDir=await read(path,['rev-parse','--absolute-git-dir']);
    for(const name of ['MERGE_HEAD','CHERRY_PICK_HEAD','REVERT_HEAD','rebase-merge','rebase-apply'])if(await exists(join(gitDir,name)))fail('WORKTREE_DIRTY','Une opération Git est déjà en cours ; elle est conservée, aucune fusion n’est lancée.');
    const raw=(await git(path,['status','--porcelain=v1','-z','--untracked-files=normal'])).stdout;
    const changes=raw.split('\0').filter(Boolean).filter(line=>!nested.some(name=>line==='?? '+name+'/'||line==='?? '+name));
    if(changes.length)fail('WORKTREE_DIRTY','Des modifications non commitées sont présentes ; elles sont conservées, aucune fusion n’est lancée.');
  }
  async function merge(input){
    return withLock(root,async()=>{
      const ctx=await context(input),repositories=await issueRepositories(ctx),saved=await metadata(ctx,repositories);
      if(saved.status!=='ready')fail('WORKTREE_FAILED','La préparation de ce ticket est incomplète.');
      let report=null;try{report=JSON.parse(await readFile(join(ctx.issuePath,'.fabrique-console',ctx.ticket+'.dev.json'),'utf8'));}catch{}
      const planned=[],unchanged=[],conflicts=[];
      for(const row of repositories){
        const path=join(ctx.path,row.repo),ticket=await info(path,ctx.branch),base=saved.repositories.find(entry=>entry.repo===row.repo).baseCommit;
        if(ticket.common!==row.common)fail('WORKTREE_CHANGED','Le ticket appartient à un autre dépôt.');
        try{await git(path,['merge-base','--is-ancestor',base,ticket.commit]);}catch{fail('WORKTREE_CHANGED','La branche du ticket ne descend plus de sa base.');}
        const expected=(Array.isArray(report?.repositories)?report.repositories.find(entry=>entry.repo===row.repo)?.commit:null)??(report?.repo===row.repo?report.commit:null);
        if(expected&&expected!==ticket.commit)fail('REPORT_STALE','La branche du ticket a changé après son compte rendu ; une nouvelle revue est requise.');
        if(ticket.commit===base){unchanged.push(row.repo);continue;}
        try{await git(row.path,['merge-base','--is-ancestor',ticket.commit,row.commit]);unchanged.push(row.repo);continue;}catch{}
        const nested=row.repo==='.'?repositories.filter(entry=>entry.repo!=='.').map(entry=>entry.repo):[];
        await clean(row.path,nested);await clean(path,nested);
        try{await git(row.path,['merge-tree','--write-tree','--name-only','-z',row.commit,ticket.commit]);}
        catch(error){
          if(error.code!==1||typeof error.stdout!=='string')fail('MERGE_FAILED','La fusion du ticket ne peut pas être vérifiée.');
          const records=error.stdout.split('\0'),end=records.indexOf('',1),files=records.slice(1,end<0?records.length:end);if(!sha(records[0])||!files.length)fail('MERGE_FAILED','La liste des conflits ne peut pas être lue.');
          conflicts.push({repo:row.repo,files});
        }
        planned.push({...row,ticketCommit:ticket.commit});
      }
      if(conflicts.length)return{status:'conflict',path:ctx.issuePath,branch:ctx.issueBranch,conflicts,merged:[],unchanged};
      const merged=[];
      for(const row of planned){
        const current=await info(row.path,ctx.issueBranch);if(current.commit!==row.commit)fail('WORKTREE_CHANGED','La branche de l’issue a changé pendant la fusion.');
        try{await git(row.path,['merge','--no-edit',row.ticketCommit]);}
        catch{
          let inMerge=false;try{await git(row.path,['rev-parse','--verify','MERGE_HEAD']);inMerge=true;}catch{}
          if(inMerge)try{await git(row.path,['merge','--abort']);}catch{fail('MERGE_FAILED','La fusion doit être inspectée manuellement ; aucune suppression ni restauration forcée.');}
          fail('MERGE_FAILED','La fusion a échoué. Les fusions déjà réussies sont conservées ; relisez les dépôts avant de rejouer.');
        }
        merged.push({repo:row.repo,previousCommit:row.commit,commit:await read(row.path,['rev-parse','--verify','HEAD'])});
      }
      return{status:'merged',path:ctx.issuePath,branch:ctx.issueBranch,conflicts:[],merged,unchanged};
    });
  }
  return{prepare,merge};
}
