import {connectorTestURL} from './helpers/connector-fixtures.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

// One point of contact with Herdr (M2): every command sent to herdr-core (`hc`) or to the window (`herdr-app`, the app)
// goes through src/herdr.mjs. Outside it and the exceptions named below, no file starts a process that can reach Herdr.
//
// The rule, on the code of each file (its comments left out):
// 1. no text names a program of Herdr: `hc`, `herdr-app`, `herdr-core`, `herdr` or `Herdr` as the last part of a
//    path (a piece of a name built ends there too: `bin+'/hc'`), the app (`Herdr.app`, `MacOS/Herdr`, `herdr://`), or
//    a command of Herdr given to a shell (`hc send …`);
// 2. nothing takes a path of Herdr from the module: of src/herdr.mjs a file imports createHerdr and herdrAppHome
//    only, by name (never the module whole, never by a dynamic import, never re-exported);
// 3. a process is started with a program named by a text or a variable, never one built where the program goes
//    (`invoke(['h','c'].join(''))`): the launchers are those of node:child_process (under any name, through their
//    namespace, wrapped by promisify) and the `invoke` and `exec` the engine and the mods are given.
//
// Its limits, said here: it reads the code, it does not run it. A name built into a variable first, then given by
// that variable (`const p=['h','c'].join('');invoke(p)`), a process started another way (a worker, a native addon, a
// require made at run time), or a program given by a file or the environment, are not seen. It holds against a slip,
// not against code written to get around it; the review stays the guard of those.
const repo=fileURLToPath(new URL('..',import.meta.url));
// The files that may still reach Herdr themselves, each with its reason.
const EXCEPTIONS=new Map([
  ['src/herdr.mjs','the one module that sends commands to Herdr'],
  // The trial launcher starts and checks its own confined core, beneath the engine (docs/essais.md).
  ['scripts/trial.mjs','the trial launcher: stops, probes and checks the core of the trial itself, before and outside the engine it confines'],
  ['src/trial.mjs','the confinement of a trial at the process boundary, beneath the Herdr module: it must recognize hc and herdr-app among every program, to map the agents they start and refuse the real ones'],
  ['src/trial-sandbox.mjs','the sandbox profile of a trial: the binary of hc is one of the files it lets the trial read'],
  // Installation tooling: it installs and checks Herdr itself, by hand, before the engine runs.
  ['scripts/bootstrap-macos.mjs','installs the Herdr app: checks that hc is installed (hc --version)'],
  ['scripts/check.mjs','checks the mods of the repository with the checker of the app (herdr-app check)'],
  ['scripts/install.mjs','installs the mods and layouts into the Herdr home'],
]);
// A name of the module a file may import beyond createHerdr and herdrAppHome, and the one place it uses it.
const NAMED_IMPORTS=new Map([
  ['scripts/verify-macos.mjs',new Map([
    // Handed as data to its children, never started by it: the checker (an exception above) and the native checks.
    ['HERDR_APP',"'--herdr-app',HERDR_APP"],
    ['HERDR_OFFICIAL_APP','FABRIQUE_CONSOLE_OFFICIAL_APP:HERDR_OFFICIAL_APP'],
  ])],
]);
// A program built where the program goes, each with its reason.
const COMPUTED=new Map([
  ['src/qa-worker.mjs','runs the argv of a QA run (the test command of its plan), as the engine gives it'],
  ['src/git-process-group.mjs','forks its own supervisor, a module of the engine (fetch-supervisor.mjs), not a program'],
]);
// The API of the window to the mods inside it: `import … from 'herdr'` in ui/ and mods/ (its run of the commands of
// the window, its agents, its terminals). No command sent to Herdr from outside: the window is the one they run in.
// Its exec starts a program, and stays checked as any launch.
const NATIVE=/^(?:ui|mods)\//;
const FOLDERS=['src','scripts','integrations','ui','mods'];
const ALLOWED=new Set(['createHerdr','herdrAppHome']);

// In mods/, the copies the build makes (scripts/build-ui.mjs) are left out, and only while they are the same as their
// source in ui/, which is checked: a copy edited by hand is checked as any source. The sources (main.js) are checked.
async function copiesOfTheBuild() {
  const build=await readFile(join(repo,'scripts','build-ui.mjs'),'utf8');
  const list=name=>JSON.parse(build.match(new RegExp(name+'=(\\[[^\\]]*\\])'))[1].replaceAll("'",'"'));
  const v3=list('V3_SHARED'),v4=list('V4_SHARED'),copies=new Map();
  for(const mod of await readdir(join(repo,'mods'))){
    if(!mod.startsWith('fabrique-console-'))continue;
    copies.set('mods/'+mod+'/common.js','ui/common.js');
    if(mod.startsWith('fabrique-console-v3-')||mod.startsWith('fabrique-console-v4-'))for(const f of v3)copies.set('mods/'+mod+'/'+f,'ui/v3/'+f);
    if(mod.startsWith('fabrique-console-v4-'))for(const f of v4)copies.set('mods/'+mod+'/'+f,'ui/v4/'+f);
  }
  return copies;
}
async function files(folder) {
  const out=[];
  for(const item of await readdir(join(repo,folder),{withFileTypes:true}).catch(()=>[])){
    const path=join(folder,item.name);
    if(item.isDirectory()){if(!['node_modules','vendor'].includes(item.name))out.push(...await files(path));}
    else if(/\.(?:mjs|js)$/.test(item.name))out.push(path);
  }
  return out;
}
export async function checkedFiles() {
  const copies=await copiesOfTheBuild(),out=[];
  for(const folder of FOLDERS)for(const path of await files(folder)){
    if(EXCEPTIONS.has(path)||path.includes('/tests/')||path.endsWith('.test.mjs'))continue;
    if(copies.has(path)&&await readFile(join(repo,path),'utf8')===await readFile(join(repo,copies.get(path)),'utf8').catch(()=>null))continue;
    out.push(path);
  }
  return out;
}

// The code of a file, without its comments: what it says of hc in a comment is no call.
const code=source=>source.replace(/\/\*[\s\S]*?\*\//g,'').split('\n').filter(line=>!/^\s*\/\//.test(line)).map(line=>line.replace(/\s\/\/\s.*$/,'')).join('\n');
const LITERAL=/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g;
const PROGRAMS=new Set(['hc','herdr-app','herdr-core','herdr','Herdr']);
// A command of a shell: at the start of the text, after ; & | ( " or a backquote, after exec or -c. A sentence that
// cites one (« … : hc read ») is no command.
const SHELL=/(?:^|[;&|(`"]\s*|\bexec\s+|\s-c\s+)(?:\S*\/)?(?:hc|herdr-app|herdr-core)\s+(?:ls|get|read|send|kill|run|do|status|shot|check|exec|wait|attach)\b/;
function namesHerdr(text) {
  if(PROGRAMS.has(text.replace(/\/+$/,'').split('/').at(-1)))return 'names a program of Herdr';
  if(/Herdr\.app|MacOS\/Herdr|^herdr:\/\//.test(text))return 'names the app of Herdr';
  if(SHELL.test(text))return 'gives a shell a command of Herdr';
  return null;
}
const LAUNCHERS=['exec','execFile','execFileSync','execSync','spawn','spawnSync','fork','invoke'];
const CHILD=/^(?:node:)?child_process$/;
// What reaches Herdr in the code of `path`, one line per way (empty: nothing).
export function scan(path,source) {
  let body=code(source);const found=[],say=(why,hit)=>found.push(path+': '+why+' ('+String(hit).trim().slice(0,80)+')');
  if(NATIVE.test(path))body=body.replace(/\bfrom\s*(['"])herdr\1/g,'from __native__');
  // 2. What it takes of the module, and what it takes of node:child_process.
  const launchers=new Set(LAUNCHERS),namespaces=new Set();
  for(const m of body.matchAll(/\b(import|export)\s*(\{[^}]*\}|\*(?:\s*as\s+[\w$]+)?|[\w$]+(?:\s*,\s*\{[^}]*\})?)\s*from\s*(['"])([^'"]+)\3/g)){
    const [whole,kind,what,,from]=m;
    if(/(?:^|\/)herdr\.mjs$/.test(from)){
      if(kind==='export'){say('passes on what the module of Herdr exports',whole);continue;}
      if(!what.startsWith('{')){say('imports the module of Herdr whole',whole);continue;}
      for(const part of what.slice(1,-1).split(',').map(x=>x.trim()).filter(Boolean)){
        const name=part.split(/\s+as\s+/)[0].trim();
        if(!ALLOWED.has(name)&&!NAMED_IMPORTS.get(path)?.has(name))say('takes a path of Herdr from its module ('+name+')',whole);
      }
    }
    if(CHILD.test(from)&&kind==='import'){
      if(what.startsWith('{'))for(const part of what.slice(1,-1).split(',').map(x=>x.trim()).filter(Boolean)){const [name,as=name]=part.split(/\s+as\s+/).map(x=>x.trim());if(LAUNCHERS.includes(name))launchers.add(as);}
      else namespaces.add(what.replace(/^\*\s*as\s+/,'').split(',')[0].trim());
    }
  }
  if(/\bimport\(\s*['"`][^'"`]*herdr\.mjs/.test(body))say('imports the module of Herdr at run time',body.match(/\bimport\([^)]*\)/)[0]);
  if(/\b(?:import|require)\(\s*['"`](?:node:)?child_process['"`]/.test(body))say('takes node:child_process at run time','child_process');
  for(const [name,place] of NAMED_IMPORTS.get(path)||[]){
    const uses=body.replace(/\bimport\s*\{[^}]*\}\s*from\s*(['"])[^'"]+\1/g,'').split(new RegExp('\\b'+name+'\\b')).length-1;
    if(uses!==body.split(place).length-1||uses!==1)say('uses '+name+' elsewhere than its one named place',place);
  }
  // A launcher wrapped under another name: const run=promisify(execFile).
  for(const m of body.matchAll(/\b(?:const|let|var)\s+([\w$]+)\s*=\s*promisify\(\s*([\w$.]+)\s*\)/g)){
    const inner=m[2].split('.').at(-1);if(launchers.has(inner)||LAUNCHERS.includes(inner))launchers.add(m[1]);
  }
  // 1. The texts.
  for(const [literal] of body.matchAll(LITERAL)){
    const pieces=literal[0]==='`'?literal.slice(1,-1).split(/\$\{[^}]*\}/):[literal.slice(1,-1)];
    for(const piece of pieces){const why=namesHerdr(piece);if(why){say(why,literal);break;}}
  }
  // The old words, kept: a variable that holds the path of hc or herdr-app, by its name.
  for(const [pattern,why] of [[/\binvoke\(\s*(?:hc|herdrApp)\b/,'calls hc or herdr-app'],[/(?<![\w$.'"`-])(?:hc|herdrApp)\s*(?:[:=](?!=)|[,})])/,'takes the path of hc or herdr-app']]){const hit=pattern.exec(body);if(hit)say(why,hit[0]);}
  // 3. The program of each launch.
  if(!COMPUTED.has(path)){
    const names=[...launchers].map(n=>n.replace(/\$/g,'\\$')).join('|'),spaces=[...namespaces].map(n=>n.replace(/\$/g,'\\$')).join('|');
    const calls=[...body.matchAll(new RegExp('(?<![\\w$.])(?:'+names+')\\s*\\(','g'))];
    if(spaces)calls.push(...body.matchAll(new RegExp('(?<![\\w$.])(?:'+spaces+')\\s*\\.\\s*[\\w$]+\\s*\\(','g')));
    for(const call of calls){
      const after=body.slice(call.index+call[0].length).replace(/^\s+/,'');
      if(/^(['"])(?:[^'"\\\n]|\\.)*\1\s*[,)]/.test(after))continue;
      if(/^`[^`$]*`\s*[,)]/.test(after))continue;
      if(/^[A-Za-z_$][\w$]*(?:\s*\??\.\s*[A-Za-z_$][\w$]*)*\s*[,)]/.test(after))continue;
      say('starts a program it builds where the program goes',call[0]+after.slice(0,40));
    }
  }
  return found;
}
export async function offenders() {
  const found=[];
  for(const path of await checkedFiles())found.push(...scan(path,await readFile(join(repo,path),'utf8')));
  return found;
}

test('no file but src/herdr.mjs sends a command to Herdr: the exceptions are named, each with its reason',async()=>{
  assert.deepEqual(await offenders(),[]);
  for(const path of [...EXCEPTIONS.keys(),...NAMED_IMPORTS.keys(),...COMPUTED.keys()])assert.ok((await readFile(join(repo,path),'utf8')).length,path+' exists');
});

const hits=(source,path='src/x.mjs')=>scan(path,source).length;
test('the check sees a call of hc or herdr-app, and not a comment that names them',()=>{
  assert.ok(hits("await invoke(hc,['ls','--json']);"));
  assert.ok(hits("const app=join(homedir(),'.local','bin','herdr-app');"));
  assert.ok(hits("export function f({invoke,hc}){}"));
  assert.ok(hits("createX({hc:'/fixture/hc'})"));
  assert.equal(hits("// hc says done when an agent ended its turn\nconst x=1;"),0);
  assert.equal(hits("fail('LAUNCH_UNCERTAIN','hc did not return a local terminal ID.');"),0);
});

// The ways around a list of words (M2 review): a name built, a path imported under another name, the app's own binary.
test('M2 review: the check sees a Herdr reached around the words: a name built, a path imported under an alias, the binary of the app',()=>{
  const seen=source=>hits(source)>0;
  assert.ok(seen("await invoke(['h','c'].join(''),['ls','--json']);"),'a name built where the program goes');
  assert.ok(seen("import {HC as core} from './herdr.mjs';\nawait invoke(core,['ls','--json']);"),'the path of hc imported under an alias');
  assert.ok(seen("import * as h from './herdr.mjs';\nawait invoke(h.HC,['ls']);"),'the module imported whole');
  assert.ok(seen("spawn(join(homedir(),'Applications','Herdr.app','Contents','MacOS','Herdr'),[]);"),'the binary of the app');
  assert.ok(seen("execFile(`${home}/Applications/Herdr.app/Contents/MacOS/Herdr`,[]);"),'the binary of the app in a template');
  assert.ok(seen("execSync('hc send t1 -- hello');"),'hc in a command of a shell');
  assert.ok(seen("invoke('zsh',['-lc','cd /w && hc kill t1']);"),'hc after another command of a shell');
  assert.ok(seen("import * as cp from 'node:child_process';\ncp.execFile(prefix+'c',[]);"),'a launcher called through its namespace, its program built');
  assert.ok(seen("const run=promisify(execFile);\nawait run(bin+'/hc',[]);"),'a launcher under another name, its program built');
  assert.ok(seen("exec('open',['-a','Herdr']);"),'the app opened by its name');
  const clean=source=>hits(source)===0;
  assert.ok(clean("await invoke('git',['status']);"),'another program, by its name');
  assert.ok(clean("const r=spawnSync(command,args,{cwd});"),'a program given by the caller');
  assert.ok(clean("await exec('open',[url]);"),'a page opened');
  assert.ok(clean("const m=/^x$/.exec(line);cx.spawn(async()=>{});"),'no process: a regular expression, a task of the window');
  assert.ok(clean("import { createHerdr } from './herdr.mjs';"),'the module itself');
  assert.ok(clean("fail('HC_UNAVAILABLE','herdr-core did not answer.');"),'a message that names it');
  assert.ok(clean("const hint=' (le serveur de test l’affiche : hc read ';"),'a sentence that cites a command');
});

test('M2 review: the API of the window is the mods\' own, and their exec is checked as any launch; a named import keeps to its place',()=>{
  assert.equal(hits("import {run,agents,exec} from 'herdr';\nrun('layout.switch',{name});await exec('open',[url]);",'mods/fabrique-console-v4-x/main.js'),0,'the native API, inside the window');
  assert.ok(hits("import {exec} from 'herdr';\nawait exec(['h','c'].join(''),['ls']);",'mods/fabrique-console-v4-x/main.js'),'its exec, with a program built');
  assert.ok(hits("import {exec} from 'herdr';\nawait exec('herdr-app',['ls']);",'mods/fabrique-console-v4-x/main.js'),'its exec, toward herdr-app');
  assert.ok(hits("import {run} from 'herdr';",'src/x.mjs'),'the API of the window is not the engine\'s');
  const verify="import {createHerdr,HERDR_APP,HERDR_OFFICIAL_APP} from '../src/herdr.mjs';\nrun(node,['scripts/check.mjs','--herdr-app',HERDR_APP]);\nrun('npm',['test'],{FABRIQUE_CONSOLE_OFFICIAL_APP:HERDR_OFFICIAL_APP});";
  assert.equal(hits(verify,'scripts/verify-macos.mjs'),0,'verify-macos hands the paths to its children');
  assert.ok(hits(verify+"\nrun(HERDR_APP,['ls']);",'scripts/verify-macos.mjs'),'and starts nothing with them');
  assert.ok(hits(verify,'scripts/other.mjs'),'another file takes no path of the module');
});

test('M2 review: in mods/, the sources (main.js) are checked; only the copies the build makes, the same as their source, are not',async()=>{
  const checked=await checkedFiles();
  assert.ok(checked.includes('mods/fabrique-console-v4-bar/main.js'),'a main.js source');
  assert.ok(checked.includes('mods/fabrique-console-v4-qa/main.js'));
  assert.ok(!checked.includes('mods/fabrique-console-v4-bar/look.js'),'a copy of ui/v4/look.js');
  assert.ok(!checked.includes('mods/fabrique-console-v3-agent/common.js'),'a copy of ui/common.js');
  assert.ok(checked.includes('ui/v4/look.js')&&checked.includes('ui/common.js'),'their sources are');
  assert.ok(checked.includes('scripts/verify-macos.mjs'),'the manual verification goes through the module');
  assert.ok(!checked.some(path=>path.startsWith('simulation/')),'the simulation stays apart, with its own Herdr');
});

// The tests drive one fake Herdr (tests/helpers/fake-herdr.mjs): no other test builds a Herdr of its own, gives a
// module the path of hc, or fakes the window or the kernel of the devs.
const TEST_FORBIDDEN=[
  [/(?<![\w$.'"`-])(?:hc|herdrApp)\s*:/,'gives a module the path of hc or herdr-app'],
  [/\bcreateHerdr\(/,'builds a Herdr of its own'],
  [/\b(?:herdrWindow|devKernel)\(/,'builds the window or the kernel itself'],
  [/\bwindow\s*[:=]\s*\{\s*ls\s*:/,'fakes the window'],
  [/fake-core\.mjs/,'uses the old fake core'],
];
// What tests may still name hc for: not a Herdr of the engine.
const TEST_EXCEPTIONS=new Map([
  [relative(repo,fileURLToPath(connectorTestURL('trial-isolation.suite.mjs'))),'the sandbox suite uses its confined fake programs'],
  [relative(repo,fileURLToPath(connectorTestURL('v3-screen.test.mjs'))),'the native kit uses its own fake window'],
  ['tests/trial-validator.test.mjs','the sandbox profile of a trial lets it read the binary of hc'],
]);
test('the tests use one fake Herdr',async()=>{
  const found=[];
  const all=[...(await readdir(join(repo,'tests'))).filter(n=>/\.(?:mjs|js)$/.test(n)).map(n=>join('tests',n)),...(await readdir(join(repo,'tests','helpers'))).map(n=>join('tests','helpers',n)),...(await files('integrations/tickets')).filter(path=>path.includes('/tests/')||path.endsWith('.test.mjs'))];
  for(const path of all){
    if(path===join('tests','helpers','fake-herdr.mjs')||path===relative(repo,fileURLToPath(import.meta.url))||TEST_EXCEPTIONS.has(path))continue;
    const body=code(await readFile(join(repo,path),'utf8'));
    for(const [pattern,why] of TEST_FORBIDDEN){const hit=pattern.exec(body);if(hit)found.push(path+': '+why+' ('+hit[0].trim()+')');}
  }
  assert.deepEqual(found,[]);
});
