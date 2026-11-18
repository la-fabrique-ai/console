import { fail, commandOptions } from './common.mjs';
import { gitEnvironment } from './git-environment.mjs';
import { basename } from 'node:path';

export function createCommands({exec}) {
  const invoke=async(file,args,options={})=>exec(file,args,{...commandOptions,...options,...(basename(file)==='git'?{env:gitEnvironment(options.env??process.env)}:{}),shell:false});
  const git=async(cwd,args)=>{try{return (await invoke('git',['-C',cwd,...args])).stdout.trimEnd();}catch{fail('GIT_ERROR','Git failed. Verify the configured local repository, branch and worktree.');}};
  return {invoke,git};
}
