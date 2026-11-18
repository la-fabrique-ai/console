import { realpath } from 'node:fs';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
import { fail, exec, commandOptions } from './common.mjs';
import { gitEnvironment } from './git-environment.mjs';

export const nativeRealpath=promisify(realpath.native);
const defaultGit=async(repo,args)=>(await exec('git',['-C',repo,...args],{...commandOptions,env:gitEnvironment()})).stdout.trim();

export async function resolveRepositories(config,{git=defaultGit}={}) {
  for(const project of config.projects) {
    const identities=new Set();
    for(const repo of config.version===1?[project]:project.repos) {
      const field=config.version===1?'repo':'path';
      try {
        const path=await nativeRealpath(repo[field]);
        if(await git(path,['rev-parse','--is-inside-work-tree'])!=='true')fail('INVALID_CONFIG','A mapping is not a Git worktree.');
        const common=await git(path,['rev-parse','--git-common-dir']);
        const identity=await nativeRealpath(resolve(path,common));
        if(identities.has(identity))fail('INVALID_CONFIG','Two repositories in this project identify the same Git repository.');
        identities.add(identity);
        await git(path,['rev-parse','--verify',`refs/heads/${repo.mainBranch}^{commit}`]);
        repo[field]=path;
      }catch(error) {
        if(error.code==='INVALID_CONFIG')throw error;
        fail('INVALID_CONFIG','A configured repository or branch cannot be resolved.');
      }
    }
  }
  return config;
}
