// A fake keychain and a fake network for a whole process, loaded with `node --import` before the code under test.
// Every program the process starts and every network request it makes is written, one JSON line each, to the file
// named by FABRIQUE_CONSOLE_TEST_GUARD_LOG. The keychain (/usr/bin/security, a keychain helper) and the network fail at once
// when touched: the real ones are never reached, whatever the code under test does.
import childProcess from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { basename } from 'node:path';
import { syncBuiltinESMExports } from 'node:module';
import { promisify } from 'node:util';

const logPath=process.env.FABRIQUE_CONSOLE_TEST_GUARD_LOG;
if(!logPath)throw new Error('FABRIQUE_CONSOLE_TEST_GUARD_LOG is required.');
const note=entry=>appendFileSync(logPath,JSON.stringify({pid:process.pid,...entry})+'\n');
const keychain=file=>basename(String(file))==='security'||/keychain/i.test(String(file));
const refused=()=>Object.assign(new Error('The fake keychain refuses every request.'),{code:1,stdout:'',stderr:''});

const {execFile,spawn}=childProcess;
function guardedExecFile(file,args,options,callback) {
  if(typeof args==='function'){callback=args;args=[];options={};}
  else if(typeof options==='function'){callback=options;options={};}
  note({kind:'exec',file:String(file),first:Array.isArray(args)?String(args[0]??''):''});
  if(keychain(file)){note({kind:'keychain',file:String(file)});queueMicrotask(()=>callback?.(refused(),'',''));return {pid:0,kill(){},on(){return this;},once(){return this;}};}
  return execFile(file,args,options,callback);
}
guardedExecFile[promisify.custom]=(file,args=[],options={})=>new Promise((resolve,reject)=>{
  guardedExecFile(file,args,options,(error,stdout,stderr)=>error?reject(Object.assign(error,{stdout,stderr})):resolve({stdout,stderr}));
});
function guardedSpawn(file,args,options) {
  note({kind:'spawn',file:String(file),first:Array.isArray(args)?String(args[0]??''):''});
  if(keychain(file)){note({kind:'keychain',file:String(file)});throw refused();}
  return spawn(file,args,options);
}
childProcess.execFile=guardedExecFile;childProcess.spawn=guardedSpawn;
syncBuiltinESMExports();

// fetch: whatever replaces it later, every call is noted and refused first.
let current=globalThis.fetch;
const guardedFetch=async(input)=>{note({kind:'network',url:String(input?.url??input)});throw new TypeError('The fake network refuses every request.');};
Object.defineProperty(globalThis,'fetch',{configurable:true,get:()=>guardedFetch,set:value=>{current=value;note({kind:'fetch-replaced'});}});
void current;
