#!/usr/bin/env node
import * as fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

export const repositoryRoot=fileURLToPath(new URL('../',import.meta.url));
export class PublicationError extends Error {
  constructor(code,findings=[]) {super(code);this.code=code;this.findings=findings;}
}
const fail=code=>{throw new PublicationError(code);};
const normalized=value=>value.normalize('NFKD').replace(/[\p{M}\p{Cf}]/gu,'').replace(/[\s_\-.]+/g,' ').toLowerCase();
const inside=(root,file)=>file===root||file.startsWith(root+path.sep);
const brand=['dv','lpr'].join('');
const ticketSystems=[['lin','ear'],['ji','ra'],['you','track']].map(parts=>parts.join(''));
// This native paint API is a mathematical term, not a ticket-system reference.
const nativeGradient=normalized(['Background.li','near_gradient'].join(''));
const connector=/^integrations\/tickets\/[a-z][a-z0-9-]*(?:\/|$)/i;
const secretPatterns=[
  /\bgh[pousr]_[a-zA-Z0-9]{36,}\b/,
  /\bgithub_pat_[a-zA-Z0-9_]{22,}\b/,
  /\bglpat-[a-zA-Z0-9_-]{20,}\b/,
  /\bxox[baprs]-[a-zA-Z0-9-]{20,}\b/,
  /\bsk_(?:live|test)_[a-zA-Z0-9]{16,}\b/,
  /\bsk-(?:proj-|svcacct-)?[a-zA-Z0-9_-]{20,}\b/,
  /\blin_(?:api|oauth)_[a-zA-Z0-9_-]{20,}\b/,
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/,
  /\beyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\b/,
  /\bBearer[ \t]+[a-zA-Z0-9._~+/-]+=*/i,
  /\bpassword\s*=/i,
  /\b[a-z][a-z0-9+.-]*:\/\/[^\s/@:]+(?::[^\s/@]*)?@[^\s/]+/i,
  /\bAIza[a-zA-Z0-9_-]{35}\b/,
  /-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/
];

export function privatePath(file) {
  const name=file.normalize('NFKC').toLowerCase(),parts=name.split('/');
  return parts.some(part=>['.git','.claude','.state','.mcp-auth','node_modules','preuves','simulation','reference','catalog','state','cache','logs','backups'].includes(part)
    ||part==='.env'||(part.startsWith('.env.')&&part!=='.env.example')||/\.(pem|key|p12|keychain|sqlite|sock)(?:$|[.-])/.test(part))
    ||/(^|\/)(docs|config)\/local(\/|$)/.test(name)||/^config\/.*\.local\./.test(name)
    ||/^mods\/[^/]+\/(runtime\.json|herdr\.d\.ts|gpui-kit\.d\.ts|jsconfig\.json)$/.test(name)
    ||/\.(png|jpe?g|gif|webp|heic|crash|log)$/.test(name);
}

// Check each component, including ancestors: neither a linked directory nor a
// linked file may redirect a scan or copy. macOS's two system aliases are safe.
export async function regularPath(file,{missing=false}={}) {
  const absolute=path.resolve(file);let current=path.parse(absolute).root;
  for(const part of absolute.slice(current.length).split(path.sep).filter(Boolean)) {
    current=path.join(current,part);
    let info;try {info=await fs.lstat(current);} catch(error) {
      if(missing&&error.code==='ENOENT')return absolute;
      throw new PublicationError('unsafe-file');
    }
    if(info.isSymbolicLink()&&!['/tmp','/var'].includes(current))fail('unsafe-file');
  }
  return absolute;
}

async function dictionaryFor(root,{dictionaryPath=process.env.FABRIQUE_CONSOLE_GUARD_DICT,sourceRoot=repositoryRoot}={}) {
  if(!dictionaryPath)fail('dictionary-required');
  let dictionaryFile,source;
  try {
    if(!path.isAbsolute(dictionaryPath))fail('dictionary-invalid');
    await regularPath(dictionaryPath);
    if(!(await fs.lstat(dictionaryPath)).isFile())fail('dictionary-invalid');
    dictionaryFile=await fs.realpath(dictionaryPath);source=await fs.realpath(sourceRoot);
  } catch {fail('dictionary-invalid');}
  if(inside(root,dictionaryFile)||inside(source,dictionaryFile))fail('dictionary-not-external');
  let names;
  try {names=JSON.parse(await fs.readFile(dictionaryFile,'utf8'));}catch {fail('dictionary-invalid');}
  if(!Array.isArray(names)||!names.length||names.some(name=>typeof name!=='string'||!name.trim()))fail('dictionary-invalid');
  const canonicalNames=names.map(name=>normalized(name).trim());
  if(canonicalNames.some(name=>[...name].length<3))fail('dictionary-entry-too-short');
  return [...new Set(canonicalNames)];
}

async function exceptionsFor() {
  // Trust the tool's versioned list, never an exception file from the scanned tree.
  const {version,exceptions}=JSON.parse(await fs.readFile(new URL('../export/guard-exceptions.json',import.meta.url),'utf8'));
  if(version!==1||!Array.isArray(exceptions))fail('exceptions-invalid');
  for(const item of exceptions) {
    if(typeof item.path!=='string'||!(/^[a-f0-9]{64}$/).test(item.sha256)||!Array.isArray(item.rules)
      ||item.rules.some(rule=>!['private-name','ticket-system'].includes(rule)))fail('exceptions-invalid');
  }
  return exceptions;
}

export async function guardDirectory(directory,options={}) {
  await regularPath(directory);
  const root=await fs.realpath(directory);
  if(!(await fs.stat(root)).isDirectory())fail('unsafe-file');
  const names=await dictionaryFor(root,options),exceptions=await exceptionsFor(),findings=[];
  let files=0,entry=0;
  const scan=(value,relative,location,id,exempt=[])=>{
    const text=normalized(value);
    for(const [rule,hit] of [
      ['private-path',location==='path'&&privatePath(relative)],
      ['private-name',names.some(name=>text.includes(name))],
      ['brand',text.includes(brand)],
      ['ticket-system',!connector.test(relative)&&ticketSystems.some(name=>text.replaceAll(nativeGradient,'').includes(name))],
      ['secret',secretPatterns.some(pattern=>pattern.test(value))]
    ])if(hit&&!exempt.includes(rule)&&!findings.some(f=>f.entry===id&&f.location===location&&f.rule===rule))findings.push({entry:id,location,rule});
  };
  async function walk(folder,relative='') {
    for(const name of (await fs.readdir(folder)).sort()) {
      const file=path.join(folder,name),key=relative?relative+'/'+name:name,id=++entry;
      const stat=await fs.lstat(file);
      scan(key,key,'path',id);
      if(stat.isSymbolicLink()||(!stat.isDirectory()&&!stat.isFile()))fail('unsafe-file');
      if(stat.isDirectory())await walk(file,key);
      else {
        files++;const bytes=await fs.readFile(file),hash=createHash('sha256').update(bytes).digest('hex');
        const exemption=exceptions.find(item=>item.path===key&&item.sha256===hash)?.rules??[];
        // Binary extensions are not exemptions. Check UTF-8 and both wide encodings.
        const even=bytes.subarray(0,bytes.length-bytes.length%2);
        for(const text of [bytes.toString('utf8'),even.toString('utf16le'),Buffer.from(even).swap16().toString('utf16le')])scan(text,key,'content',id,exemption);
      }
    }
  }
  await walk(root);
  if(findings.length)throw new PublicationError('guard-rejected',findings);
  return {ok:true,files};
}

export const isMain=url=>process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(url);
export async function publicationCli(action) {
  try {
    if(process.argv.length!==3)fail('usage');
    console.log(JSON.stringify(await action(process.argv[2])));
  } catch(error) {
    // Never echo input paths, matches, OS errors, or the private dictionary.
    console.log(JSON.stringify({ok:false,error:{code:error instanceof PublicationError?error.code:'publication-failed',...(error instanceof PublicationError&&error.findings.length?{findings:error.findings}:{})}}));
    process.exitCode=1;
  }
}
if(isMain(import.meta.url))await publicationCli(guardDirectory);
