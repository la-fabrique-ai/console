import {normalizeTicketConfig} from '../integrations/tickets/factory.mjs';
import { join, dirname } from 'node:path';
import { lstat } from 'node:fs/promises';
import { fail, object, readJSON, withLock, canonical, clean } from './common.mjs';
import { validateConfig } from './config.mjs';
import { createDurableStorage, revisionOf as hash } from './durable-storage.mjs';
import { resolveRepositories } from './repository-config.mjs';

const configHash=value=>hash(canonical(value));
const known=(value,keys)=>{
  object(value,'INVALID_CONFIG');
  if(Object.keys(value).some(key=>!keys.includes(key)))fail('MIGRATION_UNSUPPORTED_FIELDS','Unknown V1 fields need explicit handling before migration.');
};

export function convertV1Config(source,{worktreesRoot,profiles}={}) {
  source=normalizeTicketConfig(source);
  object(source,'INVALID_CONFIG');
  if(source.version!==1||!Array.isArray(source.projects))fail('INVALID_CONFIG','Migration requires a version 1 configuration.');
  known(source,['version','tracker','projects','budgets','owner','ticketConnector']);
  if(source.tracker!==undefined)known(source.tracker,['transport','endpoint']);
  for(const project of source.projects) {
    known(project,['key','name','projectId','teamId','repo','preferredAgent','mainBranch','machine','tests','budgets','color','icon','leadLayout','ticketScope']);
    for(const profile of Object.values(project.tests??{}))known(profile,['argv','timeoutMs','terminal']);
  }
  const legacy=validateConfig(source);
  if(legacy.version!==1)fail('INVALID_CONFIG','Migration requires a version 1 configuration.');
  const config=validateConfig({
    version:2,tracker:source.tracker??legacy.tracker,owner:legacy.owner,ticketConnector:legacy.ticketConnector,worktreesRoot,...(legacy.budgets?{budgets:legacy.budgets}:{}),
    wip:{dev:2,review:3,maxParallelDevs:2},launch:{confirm:'each'},
    projects:legacy.projects.map(({repo,mainBranch,tests,...project})=>({
      ...project,kind:'annexe',
      repos:[{key:'legacy',path:repo,mainBranch,tests,labels:[],aliases:[],verification:'required'}],
    })),
    profiles:profiles??{version:'unconfigured',dev:{},review:{}},
  });
  // Refuse a lossy serialization, including unexpected secret-like values in configuration.
  if(canonical(clean(config))!==canonical(config))fail('MIGRATION_UNSUPPORTED_FIELDS','Configuration cannot be serialized without alteration.');
  return config;
}

async function readBackup(path,expectedHash,storage) {
  const parent=await lstat(dirname(path));
  if(!parent.isDirectory()||parent.isSymbolicLink())fail('UNSAFE_STORAGE','Migration backup directory must be a real directory.');
  const {raw,info}=await storage.read(path);
  if(raw===null)fail('MIGRATION_CONFLICT','The migration backup is missing.');
  if(hash(raw)!==expectedHash)fail('MIGRATION_CONFLICT','The migration backup does not match its source.');
  if(info.mode&0o077)fail('UNSAFE_STORAGE','Migration backup permissions are not private.');
  return raw;
}

export const writeConfigBackup=(path,raw,options)=>createDurableStorage(options).backup(path,raw);

export function createConfigMigration({root,io={},git}) {
  const configPath=join(root,'config.json'),journalPath=join(root,'migrations','config-v1-v2.json');
  const storage=createDurableStorage({fs:io.fs});
  const write=io.writeJSON??storage.write,backup=io.writeBackup??storage.backup;
  const current=async()=>{
    const {value,raw}=await storage.read(configPath);
    if(value===null)fail('INVALID_CONFIG','An existing V1 configuration is required for migration.');
    return {value,raw};
  };
  async function migrate(input={}) {
    if(input.confirmed!==true)fail('CONFIRMATION_REQUIRED','Confirm configuration migration explicitly.');
    if(Object.keys(input).some(k=>!['confirmed','worktreesRoot','profiles'].includes(k)))fail('INVALID_ARGUMENT','Unsupported migration option.');
    return withLock(root,async()=>{
      let {value,raw}=await current();
      try {
        const parent=await lstat(dirname(journalPath));
        if(!parent.isDirectory()||parent.isSymbolicLink())fail('UNSAFE_STORAGE','Migration journal directory must be a real directory.');
      }catch(error){if(error.code!=='ENOENT')throw error;}
      let journal=await readJSON(journalPath,null);
      if(journal) {
        if(journal.version!==1||!['prepared','applied'].includes(journal.status)||!(/^[a-f0-9]{64}$/).test(journal.sourceHash)||!(/^[a-f0-9]{64}$/).test(journal.targetHash))fail('MIGRATION_CONFLICT','Invalid migration journal.');
        const target=validateConfig(journal.target);
        if(target.version!==2||configHash(journal.target)!==journal.targetHash)fail('MIGRATION_CONFLICT','Migration target does not match its journal.');
        const backupPath=join(root,'backups',`config-v1-${journal.sourceHash}.json`);
        const backupRaw=await readBackup(backupPath,journal.sourceHash,storage);
        if(journal.status==='applied') {
          const config=validateConfig(value);
          if(config.version!==2)fail('MIGRATION_CONFLICT','An applied migration no longer has a V2 configuration.');
          return {status:'already-migrated',config,backupPath,journalPath,sourceHash:journal.sourceHash,targetHash:journal.targetHash};
        }
        const resolved=await resolveRepositories(structuredClone(target),{git});
        if(canonical(clean(resolved))!==canonical(resolved))fail('MIGRATION_UNSUPPORTED_FIELDS','Resolved configuration cannot be serialized without alteration.');
        await storage.backup(backupPath,backupRaw);
        if(input.worktreesRoot!==undefined&&input.worktreesRoot!==target.worktreesRoot)fail('MIGRATION_CONFLICT','Migration options changed after preparation.');
        if(input.profiles!==undefined&&canonical(input.profiles)!==canonical(target.profiles))fail('MIGRATION_CONFLICT','Migration profiles changed after preparation.');
      }else {
        if(value.version===2)return {status:'already-v2',config:validateConfig(value)};
        const target=await resolveRepositories(convertV1Config(value,input),{git});
        if(canonical(clean(target))!==canonical(target))fail('MIGRATION_UNSUPPORTED_FIELDS','Resolved configuration cannot be serialized without alteration.');
        journal={version:1,status:'prepared',sourceHash:hash(raw),targetHash:configHash(target),target,createdAt:new Date().toISOString()};
        const backupPath=join(root,'backups',`config-v1-${journal.sourceHash}.json`);
        await backup(backupPath,raw);
        await write(journalPath,journal);
      }
      const backupPath=join(root,'backups',`config-v1-${journal.sourceHash}.json`);
      // Re-read before replacing the config, so a changed source is never blindly overwritten.
      ({value,raw}=await current());
      if(value.version===1) {
        if(hash(raw)!==journal.sourceHash)fail('MIGRATION_CONFLICT','Configuration changed after migration preparation.');
        await write(configPath,journal.target,{expectedRevision:hash(raw),conflictCode:'MIGRATION_CONFLICT'});
      }else if(value.version!==2||configHash(validateConfig(value))!==configHash(validateConfig(journal.target))) {
        fail('MIGRATION_CONFLICT','Configuration differs from the migration target.');
      }
      const published=await current();
      if(published.value.version!==2||configHash(validateConfig(published.value))!==configHash(validateConfig(journal.target)))fail('MIGRATION_CONFLICT','Configuration changed before migration completion.');
      await storage.synchronize(configPath,{expectedRevision:hash(published.raw),conflictCode:'MIGRATION_CONFLICT'});
      await write(journalPath,{...journal,status:'applied',completedAt:new Date().toISOString()});
      return {status:'migrated',config:validateConfig(journal.target),backupPath,journalPath,sourceHash:journal.sourceHash,targetHash:journal.targetHash};
    });
  }
  return {migrate};
}
