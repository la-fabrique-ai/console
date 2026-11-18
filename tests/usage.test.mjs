import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,appendFile,rm,readFile,utimes,chmod} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {readUsage} from '../src/usage.mjs';
import {clean} from '../src/common.mjs';

const NOW=Date.parse('2026-11-06T12:00:00Z'),at=(hoursAgo)=>new Date(NOW-hoursAgo*3600000).toISOString();
const claude=(id,usage,over={})=>JSON.stringify({type:'assistant',sessionId:'s1',cwd:'/work/alpha/admin',gitBranch:'main',timestamp:at(1),...over,message:{id,model:'claude-x',usage:{input_tokens:0,cache_creation_input_tokens:0,cache_read_input_tokens:0,output_tokens:0,...usage},...(over.message||{})}});
const codexCount=(hoursAgo,total,extra={})=>JSON.stringify({timestamp:at(hoursAgo),type:'event_msg',payload:{type:'token_count',info:total?{total_token_usage:{input_tokens:total[0],cached_input_tokens:total[1],output_tokens:total[2],total_tokens:total[0]+total[2]},last_token_usage:{input_tokens:extra.lastInput??0},model_context_window:extra.window??null}:null,rate_limits:extra.limits??null}});
async function home() {
  const root=await mkdtemp(join(tmpdir(),'fabrique-console-usage-'));
  await mkdir(join(root,'claude','-work-alpha-admin','s1','subagents'),{recursive:true});
  await mkdir(join(root,'codex','2026','11','06'),{recursive:true});
  await mkdir(join(root,'state'),{recursive:true});
  return {root,claudeFile:join(root,'claude','-work-alpha-admin','s1.jsonl'),subFile:join(root,'claude','-work-alpha-admin','s1','subagents','agent-a.jsonl'),codexFile:join(root,'codex','2026','11','06','rollout-x.jsonl'),
    options:{claudeDir:join(root,'claude'),codexDir:join(root,'codex'),cachePath:join(root,'state','usage-cache.json'),now:NOW,projects:[{key:'alpha',name:'Alpha',repo:'/work/alpha'}],sessions:[]}};
}

test('Claude: one answer is counted once, with its final usage, sub-agents included',async t=>{
  const h=await home();t.after(()=>rm(h.root,{recursive:true,force:true}));
  await writeFile(h.claudeFile,[
    JSON.stringify({type:'user',cwd:'/work/alpha/admin',message:{content:'secret prompt'}}),
    claude('m1',{input_tokens:10,output_tokens:1}),
    claude('m1',{input_tokens:10,cache_read_input_tokens:100,output_tokens:5}),
    claude('m2',{input_tokens:1,cache_creation_input_tokens:20,output_tokens:2}),
  ].join('\n')+'\n');
  await writeFile(h.subFile,claude('m3',{input_tokens:7,output_tokens:3},{sessionId:'s1'})+'\n');
  const u=await readUsage(h.options);
  assert.deepEqual(u.total,{input:18,output:10,cacheRead:100,cacheWrite:20,all:148});
  assert.deepEqual(u.byTool.find(x=>x.tool==='claude'),{tool:'claude',all:148,sessions:1,input:18,output:10,cacheRead:100,cacheWrite:20});
  assert.deepEqual(u.byProject,[{key:'alpha',all:148}]);
  assert.deepEqual(u.byModel,[{model:'claude-x',all:148}]);
  assert.equal(u.cacheShare,68);
});

test('Claude: the same answer copied into another session file is not counted twice',async t=>{
  const h=await home();t.after(()=>rm(h.root,{recursive:true,force:true}));
  await writeFile(h.claudeFile,claude('m1',{input_tokens:10,output_tokens:5})+'\n');
  await writeFile(join(h.root,'claude','-work-alpha-admin','s2.jsonl'),claude('m1',{input_tokens:10,output_tokens:5},{sessionId:'s2'})+'\n');
  assert.equal((await readUsage(h.options)).total.all,15);
});

test('only the chosen period is counted, and today apart',async t=>{
  const h=await home();t.after(()=>rm(h.root,{recursive:true,force:true}));
  await writeFile(h.claudeFile,[claude('old',{input_tokens:1000},{timestamp:at(24*9)}),claude('week',{input_tokens:100},{timestamp:at(24*3)}),claude('today',{input_tokens:10},{timestamp:at(2)})].join('\n')+'\n');
  const u=await readUsage(h.options);
  assert.equal(u.days,7);assert.equal(u.total.all,110);assert.equal(u.today.all,10);
});

test('incremental: appended lines are added, an unfinished last line waits, a replaced file is read again',async t=>{
  const h=await home();t.after(()=>rm(h.root,{recursive:true,force:true}));
  await writeFile(h.claudeFile,claude('m1',{input_tokens:10})+'\n'+claude('m2',{input_tokens:5}).slice(0,40));
  assert.equal((await readUsage(h.options)).total.all,10);
  await writeFile(h.claudeFile,claude('m1',{input_tokens:10})+'\n'+claude('m2',{input_tokens:5})+'\n');
  assert.equal((await readUsage(h.options)).total.all,15);
  await appendFile(h.claudeFile,claude('m3',{input_tokens:1})+'\n');
  assert.equal((await readUsage(h.options)).total.all,16);
  await writeFile(h.claudeFile,claude('m9',{input_tokens:2})+'\n');
  assert.equal((await readUsage(h.options)).total.all,2);
  const cache=await readFile(h.options.cachePath,'utf8');
  assert.ok(!cache.includes('secret'));
});

test('Codex: cumulative counters are turned into increments; repeats and resets do not overcount',async t=>{
  const h=await home();t.after(()=>rm(h.root,{recursive:true,force:true}));
  await writeFile(h.codexFile,[
    JSON.stringify({timestamp:at(5),type:'session_meta',payload:{cwd:'/work/alpha/app'}}),
    JSON.stringify({timestamp:at(5),type:'turn_context',payload:{model:'gpt-x',cwd:'/work/alpha/app'}}),
    codexCount(4,[100,40,10]),
    codexCount(4,[100,40,10]),
    codexCount(3,[300,140,30]),
    codexCount(2,[50,0,5]),
    codexCount(1,null),
  ].join('\n')+'\n');
  const u=await readUsage(h.options);
  // 300 input (140 cached) + 30 output, then a reset: 50 input + 5 output.
  assert.deepEqual(u.total,{input:210,output:35,cacheRead:140,cacheWrite:0,all:385});
  assert.deepEqual(u.byTool.find(x=>x.tool==='codex'),{tool:'codex',all:385,sessions:1,input:210,output:35,cacheRead:140,cacheWrite:0});
  assert.deepEqual(u.byModel,[{model:'gpt-x',all:385}]);
  assert.deepEqual(u.byProject,[{key:'alpha',all:385}]);
});

test('Codex: the latest rate limits are reported with their window and reset time; Claude has none',async t=>{
  const h=await home();t.after(()=>rm(h.root,{recursive:true,force:true}));
  const limits=(p,s)=>({primary:{used_percent:p,window_minutes:300,resets_at:1793980800},secondary:{used_percent:s,window_minutes:10080,resets_at:1794400000}});
  await writeFile(h.codexFile,[codexCount(6,[10,0,1],{limits:limits(20,5)}),codexCount(1,[20,0,2],{limits:limits(37,9)})].join('\n')+'\n');
  const u=await readUsage(h.options);
  assert.deepEqual(u.limits.codex,{observedAt:at(1),primary:{usedPercent:37,windowMinutes:300,resetsAt:1793980800000},secondary:{usedPercent:9,windowMinutes:10080,resetsAt:1794400000000}});
  assert.equal(u.limits.claude,null);
});

test('a session of the layout is attributed to its ticket; anything else outside a project stays unassigned',async t=>{
  const h=await home();t.after(()=>rm(h.root,{recursive:true,force:true}));
  await writeFile(h.claudeFile,[claude('a',{input_tokens:5},{cwd:'/wt/alpha-fg1'}),claude('b',{input_tokens:3},{cwd:'/elsewhere'})].join('\n')+'\n');
  const u=await readUsage({...h.options,sessions:[{id:'x',identifier:'XJ-1',worktree:'/wt/alpha-fg1',projectKey:'alpha',tool:'claude'}]});
  assert.deepEqual(u.byProject,[{key:'alpha',all:5},{key:null,all:3}]);
  assert.deepEqual(u.byTicket,[{identifier:'XJ-1',project:'alpha',tool:'claude',all:5}]);
});

test('heavy sessions are those that re-read the most on each message',async t=>{
  const h=await home();t.after(()=>rm(h.root,{recursive:true,force:true}));
  await writeFile(h.claudeFile,[claude('a',{cache_read_input_tokens:400000,output_tokens:1}),claude('b',{cache_read_input_tokens:500000,output_tokens:1})].join('\n')+'\n');
  const u=await readUsage(h.options);
  // What is re-read per message is the measured average, not a peak.
  assert.equal(u.sessions[0].reread,450000);assert.equal(u.sessions[0].messages,2);assert.equal(u.sessions[0].tool,'claude');assert.equal(u.sessions[0].id,'s1');
  // Each session keeps what went in, what came out and what was re-read, apart.
  assert.deepEqual([u.sessions[0].input,u.sessions[0].output,u.sessions[0].cacheRead,u.sessions[0].cacheWrite],[0,2,900000,0]);
});

test('files not modified within the period are not read at all, and unreadable input never fails the reading',async t=>{
  const h=await home();t.after(()=>rm(h.root,{recursive:true,force:true}));
  await writeFile(h.claudeFile,'{not json "usage"\n'+claude('ok',{input_tokens:4})+'\n');
  const old=join(h.root,'claude','-work-alpha-admin','old.jsonl');
  await writeFile(old,claude('x',{input_tokens:999},{timestamp:at(24*60)})+'\n');
  const past=new Date(NOW-60*24*3600000);await utimes(old,past,past);
  const u=await readUsage(h.options);
  assert.equal(u.total.all,4);assert.equal(u.scanned.skipped,1);
  const missing=await readUsage({...h.options,claudeDir:join(h.root,'absent'),codexDir:join(h.root,'absent2'),cachePath:join(h.root,'state','other.json')});
  assert.equal(missing.total.all,0);assert.deepEqual(missing.byTool,[]);
});

test('no counter is lost to the filter that hides secrets',async t=>{
  const h=await home();t.after(()=>rm(h.root,{recursive:true,force:true}));
  await writeFile(h.claudeFile,claude('m1',{input_tokens:10,output_tokens:5})+'\n');
  const u=await readUsage(h.options);
  assert.deepEqual(clean(u),u);
  assert.ok(!JSON.stringify(u).toLowerCase().includes('token'));
});

import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
test('the usage action answers through the CLI envelope, reads only the given home, and rejects bad lists',async t=>{
  const root=await mkdtemp(join(tmpdir(),'fabrique-console-usage-cli-'));t.after(()=>rm(root,{recursive:true,force:true}));
  await mkdir(join(root,'.claude','projects','-x'),{recursive:true});
  await writeFile(join(root,'.claude','projects','-x','s.jsonl'),claude('m1',{input_tokens:10,output_tokens:5},{timestamp:new Date().toISOString(),cwd:'/x/repo'})+'\n');
  const run=payload=>spawnSync(process.execPath,[resolve('src/cli.mjs'),'usage',JSON.stringify(payload)],{encoding:'utf8',env:{...process.env,HOME:root,FABRIQUE_CONSOLE_HOME:join(root,'state')}});
  const ok=JSON.parse(run({projects:[{key:'p',name:'P',repo:'/x/repo',extra:'ignored'}]}).stdout);
  assert.equal(ok.ok,true);assert.equal(ok.data.total.all,15);assert.deepEqual(ok.data.byProject,[{key:'p',all:15}]);
  const bad=JSON.parse(run({projects:'nope'}).stdout);
  assert.equal(bad.ok,false);assert.equal(bad.error.code,'INVALID_ARGUMENT');
  // The root must be a JSON object, as for every other action.
  for(const root of [null,[],5,'x']) {const out=JSON.parse(run(root).stdout);assert.equal(out.ok,false,JSON.stringify(root));assert.equal(out.error.code,'INVALID_ARGUMENT',JSON.stringify(root));}
});

test('Codex: each increment keeps its own folder and its own time',async t=>{
  const h=await home();t.after(()=>rm(h.root,{recursive:true,force:true}));
  const ctx=(hours,cwd)=>JSON.stringify({timestamp:at(hours),type:'turn_context',payload:{model:'gpt-x',cwd}});
  await writeFile(h.codexFile,[ctx(30,'/work/alpha/app'),codexCount(30,[100,0,0]),ctx(2,'/elsewhere'),codexCount(2,[150,0,0])].join('\n')+'\n');
  const u=await readUsage(h.options);
  assert.deepEqual(u.byProject,[{key:'alpha',all:100},{key:null,all:50}]);
  // 30 hours ago is in the week, not in today; 2 hours ago is today.
  assert.equal(u.total.all,150);assert.equal(u.today.all,50);
  const old=await readUsage({...h.options,days:1});
  assert.equal(old.total.all,50);
});

test('a file rewritten in place with the same size is read again from the start',async t=>{
  const h=await home();t.after(()=>rm(h.root,{recursive:true,force:true}));
  await writeFile(h.claudeFile,claude('m1',{input_tokens:10})+'\n');
  assert.equal((await readUsage(h.options)).total.all,10);
  await writeFile(h.claudeFile,claude('m1',{input_tokens:99})+'\n');
  const later=new Date(Date.now()+5000);await utimes(h.claudeFile,later,later);
  assert.equal((await readUsage(h.options)).total.all,99);
});

test('what could not be read is reported, and what was known before is kept',async t=>{
  const h=await home();t.after(()=>rm(h.root,{recursive:true,force:true}));
  await writeFile(h.claudeFile,'{broken "usage"\n'+claude('ok',{input_tokens:4})+'\n');
  const first=await readUsage(h.options);
  assert.equal(first.total.all,4);assert.equal(first.scanned.invalid,1);assert.equal(first.scanned.complete,false);
  const clean=await readUsage({...h.options,claudeDir:join(h.root,'absent'),cachePath:join(h.root,'state','b.json')});
  assert.equal(clean.scanned.complete,true);assert.equal(clean.scanned.invalid,0);
  if(process.getuid?.()!==0) {
    await writeFile(h.claudeFile,claude('ok',{input_tokens:4})+'\n');
    const good=await readUsage({...h.options,cachePath:join(h.root,'state','c.json')});
    assert.equal(good.total.all,4);
    await chmod(h.options.claudeDir,0o000);
    let denied;try {denied=await readUsage({...h.options,cachePath:join(h.root,'state','c.json')});}finally {await chmod(h.options.claudeDir,0o700);}
    assert.equal(denied.scanned.complete,false);assert.equal(denied.total.all,4);
  }
});

test('Codex counters older than the horizon leave the cache, even in a file still written to',async t=>{
  const h=await home();t.after(()=>rm(h.root,{recursive:true,force:true}));
  await writeFile(h.codexFile,codexCount(1,[100,0,0])+'\n');
  assert.equal((await readUsage(h.options)).total.all,100);
  const later=NOW+40*86400000;await utimes(h.codexFile,new Date(later),new Date(later));
  await readUsage({...h.options,now:later});
  const cache=JSON.parse(await readFile(h.options.cachePath,'utf8')),horizon=later-35*86400000;
  const slots=Object.values(cache.files).filter(f=>f.kind==='codex').flatMap(f=>Object.keys(f.data.days)).map(key=>Number(key.split('|')[0])*900000);
  assert.deepEqual(slots.filter(at=>at<horizon),[]);
});

test('two readings at the same time both complete and agree',async t=>{
  const h=await home();t.after(()=>rm(h.root,{recursive:true,force:true}));
  await writeFile(h.claudeFile,claude('m1',{input_tokens:10,output_tokens:5})+'\n');
  const results=await Promise.all([readUsage(h.options),readUsage(h.options),readUsage(h.options)]);
  for(const u of results) {assert.equal(u.scanned.complete,true);assert.equal(u.total.all,15);}
  assert.equal(JSON.parse(await readFile(h.options.cachePath,'utf8')).version>0,true);
});

test('an unreadable line keeps the reading partial until the file is rewritten',async t=>{
  const h=await home();t.after(()=>rm(h.root,{recursive:true,force:true}));
  await writeFile(h.claudeFile,'{broken "usage"\n'+claude('ok',{input_tokens:4})+'\n');
  for(let i=0;i<2;i++) {const u=await readUsage(h.options);assert.equal(u.scanned.invalid,1,'reading '+i);assert.equal(u.scanned.complete,false,'reading '+i);assert.equal(u.total.all,4);}
  await writeFile(h.claudeFile,claude('ok',{input_tokens:4})+'\n'+claude('more',{input_tokens:1})+'\n');
  const later=new Date(Date.now()+5000);await utimes(h.claudeFile,later,later);
  const fixed=await readUsage(h.options);
  assert.equal(fixed.scanned.invalid,0);assert.equal(fixed.scanned.complete,true);assert.equal(fixed.total.all,5);
});

test('a file rewritten before the point already read, then appended to, is read again from the start',async t=>{
  const h=await home();t.after(()=>rm(h.root,{recursive:true,force:true}));
  await writeFile(h.claudeFile,claude('m1',{input_tokens:10})+'\n');
  assert.equal((await readUsage(h.options)).total.all,10);
  await writeFile(h.claudeFile,claude('m1',{input_tokens:99})+'\n'+claude('m2',{input_tokens:5})+'\n');
  const later=new Date(Date.now()+5000);await utimes(h.claudeFile,later,later);
  const u=await readUsage(h.options);
  assert.equal(u.total.all,104);assert.equal(u.scanned.complete,true);
});

test('a session that worked in two projects gives one row per project',async t=>{
  const h=await home();t.after(()=>rm(h.root,{recursive:true,force:true}));
  await writeFile(h.claudeFile,claude('m1',{input_tokens:100})+'\n'+claude('m2',{input_tokens:50},{cwd:'/elsewhere'})+'\n');
  const u=await readUsage(h.options);
  assert.deepEqual(u.sessions.map(s=>[s.id,s.project,s.all,s.messages]).sort((a,b)=>b[2]-a[2]),[['s1','alpha',100,1],['s1',null,50,1]]);
  assert.deepEqual(u.byProject,[{key:'alpha',all:100},{key:null,all:50}]);
  assert.equal(u.byTool.find(x=>x.tool==='claude').sessions,1);
});

test('the period says where it starts: on the quarter of an hour both tools are cut at',async t=>{
  const h=await home();t.after(()=>rm(h.root,{recursive:true,force:true}));
  const u=await readUsage({...h.options,now:NOW+7*60000});
  assert.equal(u.from,new Date(NOW-7*86400000).toISOString());
});
