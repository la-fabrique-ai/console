import * as nativeFS from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { fail, clean, canonical } from './common.mjs';

export const revisionOf=raw=>createHash('sha256').update(raw).digest('hex');
const same=(a,b)=>a.dev===b.dev&&a.ino===b.ino;

export function createDurableStorage({fs=nativeFS}={}) {
  async function read(path,{synchronize=false}={}) {
    let handle;
    try {
      handle=await fs.open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
      const before=await handle.stat();
      if(!before.isFile())fail('UNSAFE_STORAGE','Private data must be a regular file.');
      const raw=await handle.readFile(),after=await handle.stat();
      if(before.size!==after.size||before.mtimeMs!==after.mtimeMs)fail('CONFIG_CONFLICT','The file changed while being read.');
      if(synchronize)await handle.sync();
      let value;try{value=JSON.parse(raw.toString('utf8'));}catch{fail('INVALID_DATA','A local JSON file is invalid.');}
      return {value,raw,revision:revisionOf(raw),info:after};
    }catch(error) {
      if(error.code==='ENOENT')return {value:null,raw:null,revision:null};
      if(error.code==='ELOOP')fail('UNSAFE_STORAGE','Private data cannot be a symbolic link.');
      throw error;
    }finally{await handle?.close();}
  }
  async function syncDir(path) {
    const handle=await fs.open(path,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);
    try{await handle.sync();}finally{await handle.close();}
  }
  async function parent(path) {
    const folder=dirname(path);
    await fs.mkdir(folder,{recursive:true,mode:0o700});
    const info=await fs.lstat(folder);
    if(!info.isDirectory()||info.isSymbolicLink())fail('UNSAFE_STORAGE','Private storage must be a real directory.');
    await fs.chmod(folder,0o700);
    // Persist the directory entry too, including a newly created backups/migrations directory.
    await syncDir(dirname(folder));
    return {folder,info};
  }
  async function unchangedParent({folder,info}) {
    const current=await fs.lstat(folder);
    if(!current.isDirectory()||current.isSymbolicLink()||!same(info,current))fail('UNSAFE_STORAGE','The private storage directory changed.');
  }
  async function temporary(path,raw) {
    const handle=await fs.open(path,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
    try{await handle.writeFile(raw);await handle.sync();}finally{await handle.close();}
  }
  async function cleanup(path,directory) {
    // Do not follow a substituted parent just to remove a temporary file.
    try{await unchangedParent(directory);await fs.rm(path,{force:true});}catch{}
  }
  async function backup(path,raw) {
    const directory=await parent(path),temp=path+'.'+randomUUID()+'.tmp';
    try {
      const existing=await read(path);
      if(existing.raw===null) {
        await temporary(temp,raw);await unchangedParent(directory);
        try{await fs.link(temp,path);}catch(error){if(error.code!=='EEXIST')throw error;}
      }
      await unchangedParent(directory);
      const stored=await read(path);
      if(stored.revision!==revisionOf(raw))fail('MIGRATION_CONFLICT','The existing backup differs from its source.');
      if(stored.info.mode&0o077)fail('UNSAFE_STORAGE','Backup permissions are not private.');
      const handle=await fs.open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
      try{await handle.sync();}finally{await handle.close();}
      await syncDir(directory.folder);await unchangedParent(directory);
    }finally{await cleanup(temp,directory);}
  }
  async function synchronize(path,{expectedRevision,conflictCode='CONFIG_CONFLICT'}={}) {
    const directory=await parent(path),stored=await read(path,{synchronize:true});
    if(stored.revision!==expectedRevision)fail(conflictCode,'The file changed before synchronization.');
    await syncDir(directory.folder);await unchangedParent(directory);
    if((await read(path)).revision!==expectedRevision)fail(conflictCode,'The file changed during synchronization.');
  }
  async function write(path,value,options={}) {
    if(canonical(clean(value))!==canonical(value))fail('INVALID_CONFIG','The document cannot be serialized without alteration.');
    const raw=JSON.stringify(value,null,2)+'\n',revision=revisionOf(raw);
    const directory=await parent(path),temp=path+'.'+randomUUID()+'.tmp';
    try {
      await temporary(temp,raw);
      await unchangedParent(directory);
      // The expensive temporary write/fsync happens before the last source comparison.
      const current=await read(path);
      if(Object.hasOwn(options,'expectedRevision')&&current.revision!==options.expectedRevision)fail(options.conflictCode??'CONFIG_CONFLICT','The configuration changed before publication.');
      await fs.rename(temp,path);
      await syncDir(directory.folder);await unchangedParent(directory);
      if((await read(path)).revision!==revision)fail('CONFIG_CONFLICT','The published file changed unexpectedly.');
      return {revision};
    }finally{await cleanup(temp,directory);}
  }
  return {read,write,backup,synchronize};
}
