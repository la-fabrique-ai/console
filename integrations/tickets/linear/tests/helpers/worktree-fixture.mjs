import { mkdir,writeFile,readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fixture } from '../../../../../tests/helpers/backend-fixture.mjs';
import { createBackend } from '../../../../../src/backend.mjs';

import { withFakeHerdr } from '../../../../../tests/helpers/fake-herdr.mjs';
export async function worktreeFixture(t) {
  const f=await fixture(t),remote=join(f.root,'remote.git'),peer=join(f.root,'peer'),worktreesRoot=join(f.root,'managed-worktrees');
  await f.command('git',['clone','--bare',f.repo,remote]);
  await f.command('git',['-C',f.repo,'remote','add','origin',remote]);
  await f.command('git',['-C',f.repo,'fetch','origin']);
  await f.command('git',['-C',f.repo,'branch','--set-upstream-to','origin/main','main']);
  await f.command('git',['clone',remote,peer]);
  const config={version:2,tracker:{transport:'mcp',endpoint:'https://mcp.linear.app/mcp/readonly'},worktreesRoot,wip:{dev:2,review:3,maxParallelDevs:2},launch:{confirm:'each'},projects:[{
    key:'fixture',name:'Fixture',teamId:'team-fixture',projectId:'project-fixture',kind:'produit',color:'#808080',machine:null,
    repos:[{key:'app',path:f.repo,labels:[],aliases:[],mainBranch:'main',verification:'verified',tests:{}}],
  }],profiles:{version:'unconfigured',dev:{},review:{}}};
  await f.write('config.json',config);
  const issues=new Map([['one',ticket('one','FIX-1')],['two',ticket('two','FIX-2')]]),trackerCalls=[],commands=[];
  const tracker={...f.tracker,detail:async(id,options)=>{trackerCalls.push({id,options});const issue=issues.get(id);if(!issue)throw new Error('Fixture issue absent');return {issue:structuredClone(issue)};}};
  const exec=async(file,args,options)=>{
    commands.push({file,args});if(file!=='git'&&!file.endsWith('/git'))throw new Error('Preparation tried to launch a non-Git tool');
    return f.command(file,args,options);
  };
  const backend=createBackend(withFakeHerdr({root:f.home,tracker,exec},'/fixture/forbidden-hc'));
  const plan=(options={})=>backend.dispatch('worktree-plan',{issueId:'one',tool:'codex',role:'dev',...options});
  const prepare=(plan,options={})=>backend.dispatch('worktree-prepare',{planId:plan.planId,...options});
  const commit=async(path,message)=>{await f.command('git',['-C',path,'-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','--allow-empty','-m',message]);return (await f.command('git',['-C',path,'rev-parse','HEAD'])).stdout.trim();};
  const publish=()=>f.command('git',['--git-dir',remote,'fetch',peer,'main:main']);
  return {...f,backend,config,remote,peer,worktreesRoot,issues,trackerCalls,commands,tracker,exec,plan,prepare,commit,publish};
}
function ticket(id,identifier) {
  return {id,identifier,title:'Fixture task',updatedAt:'2026-11-06T12:00:00Z',branchName:'tracker/'+id,team:{id:'team-fixture'},project:{id:'project-fixture'},labels:[],description:'Fixture acceptance criteria'};
}
