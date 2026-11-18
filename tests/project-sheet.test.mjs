import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm,readFile,chmod,realpath,symlink,utimes} from 'node:fs/promises';
import {execFileSync,spawnSync,spawn} from 'node:child_process';
import {resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {readSheet,parseMcpList,parseListeners,runMcpCheck,publishable,codexServerNames} from '../src/project-sheet.mjs';
import {clean} from '../src/common.mjs';

const NOW=Date.parse('2026-11-06T12:00:00Z');
const git=(cwd,...args)=>execFileSync('git',['-C',cwd,'-c','user.name=t','-c','user.email=t@example.invalid','-c','commit.gpgsign=false',...args],{encoding:'utf8',stdio:['ignore','pipe','ignore']});

// A home and a project folder with two repositories, declared tools, agents, commands and rules.
async function fixture() {
  const root=await realpath(await mkdtemp(join(tmpdir(),'fabrique-console-sheet-'))),home=join(root,'home'),repo=join(root,'Developer','alpha');
  for(const dir of [join(home,'.claude','skills','apple-design'),join(home,'.codex'),join(repo,'.claude','agents'),join(repo,'.claude','commands'),join(repo,'admin','.claude','agents'),join(repo,'app'),join(repo,'node_modules','x'),join(root,'state')]) await mkdir(dir,{recursive:true});
  await writeFile(join(home,'.claude.json'),JSON.stringify({mcpServers:{figma:{type:'http',url:'https://example.invalid/?key=SECRET-A'}},projects:{[repo]:{mcpServers:{sentry:{type:'stdio',command:'npx',args:['x'],env:{TOKEN:'SECRET-B'}},'bad name\n':{type:'http'}}},'/other':{mcpServers:{elsewhere:{type:'http'}}}}}));
  await writeFile(join(repo,'.mcp.json'),JSON.stringify({mcpServers:{firebase:{command:'firebase',env:{KEY:'SECRET-C'}}}}));
  await writeFile(join(home,'.codex','config.toml'),'model = "x"\n[mcp_servers.node_repl]\ncommand = "node"\n[mcp_servers.node_repl.env]\nKEY = "SECRET-D"\n[mcp_servers."tracker"]\nurl = "https://example.invalid"\n[other]\n');
  await writeFile(join(home,'.claude','settings.json'),JSON.stringify({enabledPlugins:{'ecc@ecc':true,'old@x':false,'vercel@claude-plugins-official':true}}));
  await writeFile(join(home,'.claude','skills','apple-design','SKILL.md'),'---\nname: apple-design\n---\n');
  await writeFile(join(repo,'.claude','agents','mobile-expert.md'),'x');
  await writeFile(join(repo,'admin','.claude','agents','backoffice-expert.md'),'x');
  await writeFile(join(repo,'.claude','commands','sync-feature.md'),'x');
  await writeFile(join(repo,'.claude','commands','notes.txt'),'x');
  for(const name of ['CLAUDE.md','AGENTS.md']) await writeFile(join(repo,name),'x');
  return {root,home,repo,options:{repo,home,cachePath:join(root,'state','mcp-check.json'),now:NOW,run:async()=>({stdout:''}),probe:async()=>false}};
}

test('the sheet lists the declared tools by name only, never a value of their configuration',async t=>{
  const f=await fixture();t.after(()=>rm(f.root,{recursive:true,force:true}));
  const sheet=await readSheet(f.options);
  assert.deepEqual(sheet.mcp.claude,{state:'read',items:[{name:'figma',scope:'global',kind:'remote'},{name:'firebase',scope:'project',kind:'local'},{name:'sentry',scope:'project',kind:'local'}]});
  assert.deepEqual(sheet.mcp.codex,{state:'read',items:[{name:'node_repl'},{name:'tracker'}]});
  assert.deepEqual(sheet.mcp.check,{state:'never'});
  assert.deepEqual(sheet.plugins,{state:'read',items:[{name:'ecc',source:'ecc'},{name:'vercel',source:'claude-plugins-official'}]});
  assert.deepEqual(sheet.agents,[{name:'backoffice-expert',where:'admin'},{name:'mobile-expert',where:null}]);
  assert.deepEqual(sheet.commands,[{name:'sync-feature',where:null}]);
  assert.deepEqual(sheet.skills,{global:['apple-design'],project:[]});
  assert.deepEqual(sheet.rules.map(r=>r.name),['CLAUDE.md','AGENTS.md']);
  assert.equal(sheet.rules[0].path,join(f.repo,'CLAUDE.md'));
  const out=JSON.stringify(clean(sheet));
  for(const secret of ['SECRET-A','SECRET-B','SECRET-C','SECRET-D','example.invalid','npx']) assert.equal(out.includes(secret),false,secret);
});

test('a tools folder that cannot be read makes the inventory partial, not empty',async t=>{
  const f=await fixture();t.after(()=>rm(f.root,{recursive:true,force:true}));
  assert.deepEqual((await readSheet(f.options)).inventory,{state:'read',hidden:1});
  if(process.getuid?.()===0) return;
  const agents=join(f.repo,'.claude','agents');
  await chmod(agents,0o000);
  let sheet;try {sheet=await readSheet(f.options);}finally {await chmod(agents,0o700);}
  assert.deepEqual(sheet.inventory,{state:'partial',hidden:1});
});

test('a configuration that cannot be read is reported as such, an absent one as empty',async t=>{
  const f=await fixture();t.after(()=>rm(f.root,{recursive:true,force:true}));
  await writeFile(join(f.home,'.claude.json'),'{broken');
  await rm(join(f.home,'.codex','config.toml'));
  await rm(join(f.home,'.claude','settings.json'));
  const sheet=await readSheet(f.options);
  assert.deepEqual(sheet.mcp.claude,{state:'unavailable',items:[]});
  assert.deepEqual(sheet.mcp.codex,{state:'read',items:[]});
  assert.deepEqual(sheet.plugins,{state:'read',items:[]});
});

test('repositories: the main branch is compared with what was last fetched, without fetching',async t=>{
  const f=await fixture();t.after(()=>rm(f.root,{recursive:true,force:true}));
  const remote=join(f.root,'remote.git'),admin=join(f.repo,'admin'),app=join(f.repo,'app');
  execFileSync('git',['init','-q','--bare','-b','main',remote]);
  for(const dir of [admin,app]) git(dir,'init','-q','-b','main');
  await writeFile(join(admin,'a'),'1');git(admin,'add','a');git(admin,'commit','-q','-m','one');
  git(admin,'remote','add','origin',remote);git(admin,'push','-q','-u','origin','main');git(admin,'remote','set-head','origin','main');
  await writeFile(join(admin,'a'),'2');git(admin,'commit','-q','-am','two');
  await writeFile(join(app,'b'),'1');git(app,'add','b');git(app,'commit','-q','-m','one');
  // A linked worktree of a repository is not another repository.
  git(admin,'worktree','add','-q',join(f.repo,'admin-rel'),'-b','rel');
  const sheet=await readSheet({...f.options,run:undefined});
  assert.equal(sheet.repos.state,'read');
  assert.deepEqual(sheet.repos.items.map(r=>[r.name,r.branch,r.remote,r.ahead,r.behind,r.tracked]),[['admin','main',true,1,0,true],['app','main',false,null,null,false]]);
  // The main branch is the one the remote names, not a local branch that happens to be called main.
  const trunk=join(f.root,'trunk.git'),site=join(f.repo,'site'),lost=join(f.repo,'lost');
  execFileSync('git',['init','-q','--bare','-b','trunk',trunk]);
  for(const dir of [site,lost]) {await mkdir(dir);git(dir,'init','-q','-b','trunk');await writeFile(join(dir,'c'),'1');git(dir,'add','c');git(dir,'commit','-q','-m','one');git(dir,'remote','add','origin',trunk);}
  git(site,'push','-q','-u','origin','trunk');git(site,'remote','set-head','origin','trunk');git(site,'branch','main');
  const more=await readSheet({...f.options,run:undefined});
  const byName=Object.fromEntries(more.repos.items.map(r=>[r.name,r]));
  assert.deepEqual([byName.site.branch,byName.site.ahead,byName.site.behind,byName.site.tracked],['trunk',0,0,true]);
  // A remote that does not say which branch is its default leaves the main branch unknown.
  assert.deepEqual([byName.lost.branch,byName.lost.remote,byName.lost.tracked],[null,true,false]);
  // A submodule is a repository of its own; a linked worktree is not listed twice.
  await mkdir(join(f.repo,'vendored'));await writeFile(join(f.repo,'vendored','.git'),'gitdir: ../admin/.git/modules/vendored\n');
  assert.equal((await readSheet({...f.options,run:undefined})).repos.items.some(r=>r.name==='vendored'),true);
  assert.equal(sheet.repos.items.some(r=>r.name==='admin-rel'),false);
  // A linked worktree whose repository is outside the project is the only copy here: it is listed.
  const outside=join(f.root,'outside');await mkdir(outside);git(outside,'init','-q','-b','main');await writeFile(join(outside,'z'),'1');git(outside,'add','z');git(outside,'commit','-q','-m','one');
  git(outside,'worktree','add','-q',join(f.repo,'guest'),'-b','guest');
  const guests=(await readSheet({...f.options,run:undefined})).repos.items.map(r=>r.name);
  assert.equal(guests.includes('guest'),true);assert.equal(guests.includes('admin-rel'),false);
  // node_modules and hidden folders are never taken for repositories.
  assert.equal(sheet.repos.items.some(r=>r.name.includes('node_modules')),false);
});

test('servers: only the processes listening from the project or from its worktrees are kept',async t=>{
  const f=await fixture();t.after(()=>rm(f.root,{recursive:true,force:true}));
  const worktree=join(f.root,'Developer','worktrees','alpha','admin-xj-702');
  const listen='p100\ncnode\nn*:3000\nn127.0.0.1:3000\np200\ncnode\nn[::1]:4000\np300\ncpostgres\nn127.0.0.1:5432\np400\ncnode\nn*:9999\n';
  const cwd=`p100\nn${join(f.repo,'admin')}\np200\nn${worktree}\np300\nn/var/db\np400\nn${f.repo}-other\n`;
  const calls=[];
  const run=async(command,args)=>{calls.push([command,...args]);return {stdout:args.includes('cwd')?cwd:listen};};
  const sheet=await readSheet({...f.options,run,probe:async port=>port===3000});
  assert.deepEqual(sheet.servers,{state:'read',unattributed:0,truncated:false,items:[{port:3000,command:'node',pid:100,from:'admin',worktree:false,responds:true},{port:4000,command:'node',pid:200,from:'admin-xj-702',worktree:true,responds:false}]});
  // A listener whose folder cannot be read may belong to the project: the reading is partial.
  const blind=await readSheet({...f.options,run:async(command,args)=>({stdout:args.includes('cwd')?cwd:listen+'p500\ncnode\nn*:8080\n'}),probe:async()=>false});
  // A project folder reached through a symbolic link still finds the servers of its worktrees.
  const alias=join(f.root,'alias');await symlink(f.repo,alias);
  const linked=await readSheet({...f.options,repo:alias,run,probe:async()=>false});
  assert.deepEqual(linked.servers.items.map(i=>[i.port,i.worktree]),[[3000,false],[4000,true]]);
  assert.equal(blind.servers.state,'partial');assert.equal(blind.servers.unattributed,1);assert.equal(blind.servers.items.length,2);
  assert.deepEqual(parseListeners('p1\ncnode\nn*:80\nnbad\nn*:99999\n'),[{pid:1,command:'node',port:80}]);
  const failing=await readSheet({...f.options,run:async()=>{throw new Error('lsof missing');}});
  assert.deepEqual(failing.servers,{state:'unavailable',items:[],unattributed:0,truncated:false});
});

test('the connection check keeps a name and a state per service, and nothing of the line',()=>{
  const out=['Checking MCP server health…','','figma: https://example.invalid/mcp?key=SECRET (HTTP) - ✓ Connected','plugin:ecc:chrome-devtools: npx chrome --token SECRET - ✘ Failed to connect — spawn SECRET','sentry: https://x (HTTP) - ! Needs authentication','firebase: firebase mcp - ⏸ Pending approval','odd: something new','not a line'].join('\n');
  assert.deepEqual(parseMcpList(out),{figma:'connected','plugin:ecc:chrome-devtools':'failed',sentry:'auth',firebase:'pending',odd:'unknown'});
  assert.equal(JSON.stringify(parseMcpList(out)).includes('SECRET'),false);
});

test('the check writes its result where the sheet reads it; a check that never ended is not trusted',async t=>{
  const f=await fixture();t.after(()=>rm(f.root,{recursive:true,force:true}));
  const run=async(command,args,options)=>{assert.deepEqual([command,args,options.cwd],['claude',['mcp','list'],f.repo]);return {stdout:'figma: x - ✓ Connected\n'};};
  await runMcpCheck({repo:f.repo,cachePath:f.options.cachePath,run,now:NOW});
  assert.deepEqual((await readSheet(f.options)).mcp.check,{state:'done',at:new Date(NOW).toISOString(),results:{figma:'connected'}});
  // A result is only shown for the folder it was made in.
  assert.deepEqual((await readSheet({...f.options,repo:join(f.repo,'admin')})).mcp.check,{state:'never'});
  await runMcpCheck({repo:f.repo,cachePath:f.options.cachePath,run:async()=>{throw new Error('boom SECRET');},now:NOW});
  const failed=(await readSheet(f.options)).mcp.check;
  assert.deepEqual(failed,{state:'failed',at:new Date(NOW).toISOString()});
  await writeFile(f.options.cachePath,JSON.stringify({repo:f.repo,state:'running',at:new Date(NOW-60000).toISOString()}));
  assert.equal((await readSheet(f.options)).mcp.check.state,'running');
  assert.equal((await readSheet({...f.options,now:NOW+10*60000})).mcp.check.state,'failed');
  assert.equal((await readFile(f.options.cachePath,'utf8')).includes('SECRET'),false);
});

test('the folder must be an absolute path to an existing directory',async t=>{
  const f=await fixture();t.after(()=>rm(f.root,{recursive:true,force:true}));
  for(const repo of ['relative/path',join(f.root,'absent'),'',null,join(f.repo,'CLAUDE.md')]) await assert.rejects(readSheet({...f.options,repo}),{code:'INVALID_ARGUMENT'},String(repo));
});

test('through the CLI: the sheet is read, and the check is started apart and then shown',async t=>{
  const f=await fixture();t.after(()=>rm(f.root,{recursive:true,force:true}));
  const fake=join(f.root,'fake-claude');
  await writeFile(fake,'#!/bin/sh\nsleep 1\necho "figma: hidden - ✓ Connected"\n');await chmod(fake,0o755);
  const run=(action,payload)=>JSON.parse(spawnSync(process.execPath,[resolve('src/cli.mjs'),action,JSON.stringify(payload)],{encoding:'utf8',env:{...process.env,HOME:f.home,FABRIQUE_CONSOLE_HOME:join(f.root,'state'),FABRIQUE_CONSOLE_MC_CLAUDE_BIN:fake}}).stdout);
  const sheet=run('project-sheet',{repo:f.repo});
  assert.equal(sheet.ok,true);assert.deepEqual(sheet.data.mcp.claude.items.map(i=>i.name),['figma','firebase','sentry']);assert.deepEqual(sheet.data.mcp.check,{state:'never'});
  // Two requests at the same time start one check only.
  const both=await Promise.all([0,1].map(()=>new Promise(done=>{const child=spawn(process.execPath,[resolve('src/cli.mjs'),'mcp-check',JSON.stringify({repo:f.repo})],{env:{...process.env,HOME:f.home,FABRIQUE_CONSOLE_HOME:join(f.root,'state'),FABRIQUE_CONSOLE_MC_CLAUDE_BIN:fake}});let out='';child.stdout.on('data',d=>{out+=d;});child.on('close',()=>done(JSON.parse(out).data.started));})));
  assert.deepEqual(both.sort(),[false,true]);
  let check;
  for(let i=0;i<50;i++) {check=run('project-sheet',{repo:f.repo}).data.mcp.check;if(check.state!=='running') break;await new Promise(r=>setTimeout(r,100));}
  assert.equal(check.state,'done');assert.deepEqual(check.results,{figma:'connected'});
  // Once the check has ended, another one may start.
  await new Promise(r=>setTimeout(r,300));
  assert.deepEqual(run('mcp-check',{repo:f.repo}).data,{started:true});
  for(let i=0;i<50;i++) {if(run('project-sheet',{repo:f.repo}).data.mcp.check.state!=='running') break;await new Promise(r=>setTimeout(r,100));}
  // A marker left by a check that died is taken over once, even by two requests at the same time.
  const marker=(await import('node:fs')).readdirSync(join(f.root,'state')).filter(n=>n.startsWith('mcp-check-')&&n.endsWith('.json')).map(n=>join(f.root,'state',n+'.running'))[0];
  await writeFile(marker,'');const old=new Date(Date.now()-10*60000);await utimes(marker,old,old);
  const taken=await Promise.all([0,1,2].map(()=>new Promise(done=>{const child=spawn(process.execPath,[resolve('src/cli.mjs'),'mcp-check',JSON.stringify({repo:f.repo})],{env:{...process.env,HOME:f.home,FABRIQUE_CONSOLE_HOME:join(f.root,'state'),FABRIQUE_CONSOLE_MC_CLAUDE_BIN:fake}});let out='';child.stdout.on('data',d=>{out+=d;});child.on('close',()=>done(JSON.parse(out).data?.started===true));})));
  assert.equal(taken.filter(Boolean).length,1);
  for(let i=0;i<50;i++) {if(run('project-sheet',{repo:f.repo}).data.mcp.check.state!=='running') break;await new Promise(r=>setTimeout(r,100));}
  for(const bad of [{},{repo:5},{repo:'relative'}]) {const out=run('project-sheet',bad);assert.equal(out.ok,false);assert.equal(out.error.code,'INVALID_ARGUMENT');}
  assert.equal(run('mcp-check',{repo:join(f.root,'absent')}).ok,false);
});

test('a name that could be a secret is never returned, wherever it was read',async t=>{
  const f=await fixture();t.after(()=>rm(f.root,{recursive:true,force:true}));
  for(const [name,ok] of [['svc:ghp_abcdefgh1234',false],['plugin:sk_live_x:tool',false],['web3integration',true],['ticket-alpha',true],['plugin:ecc:chrome-devtools',true],['brightdata-scraping-manager',true],['sk_live_SYNTHETIC_VALUE',false],['ghp_abcdefgh1234',false],['a1b2c3d4e5f6g7h8',false],['x'.repeat(30),false],['with space',false],['',false],[null,false]]) assert.equal(publishable(name),ok,String(name));
  // A header inside a multi-line value of the Codex configuration is not a table header.
  // A triple quote inside a comment opens nothing; quotes inside strings do not either.
  assert.deepEqual([...codexServerNames('# """\nnote = """\n[mcp_servers.hunter2]\n"""\n[mcp_servers.tracker]\nk = "a \\" # \'\'\' b" # \'\'\'\n[mcp_servers.after]\n')],['tracker','after']);
  // A multi-line string may end with up to two quotes of its own before its closing mark.
  assert.deepEqual([...codexServerNames('a = """x""""  # """"\nb = """\n[mcp_servers.hunter2]\n"""\n[mcp_servers.tracker]\nc = \'\'\'y\'\'\'\'\' # \'\'\'\n[mcp_servers.after]\n')],['tracker','after']);
  // Forms that are not read (inline tables, dotted keys) are said unread rather than taken for none.
  assert.equal(codexServerNames('[mcp_servers.a]\n').unsupported,false);
  for(const form of ['mcp_servers = { a = { command = "x" } }\n','[mcp_servers]\na = { command = "x" }\n','mcp_servers.a.command = "x"\n','[ mcp_servers.tracker ]\n','["mcp_servers".tracker]\n','["mcp_servers"]\ntracker = { url = "x" }\n',"'mcp_servers'.a.command = 'x'\n",'[[mcp_servers]]\n']) assert.equal(codexServerNames(form).unsupported,true,form);
  // Only the exact TOML component counts: another table or key whose name merely starts with, or
  // contains, mcp_servers is not a declaration of servers, and a key inside another table is not one either.
  for(const other of ['[mcp_servers-helper]\nk = 1\n','["mcp_servers.helper"]\nk = 1\n','[features]\n"mcp_servers.note" = 1\nmcp_servers = true\nmcp_servers.a = 1\n','x = [\n  ["mcp_servers"],\n]\n','[a.mcp_servers.b]\n']) {
    const names=codexServerNames(other+'[mcp_servers.tracker]\n');
    assert.deepEqual([...names],['tracker'],other);assert.equal(names.unsupported,false,other);
  }
  // A key at the root is still seen after a value written on several lines.
  assert.equal(codexServerNames('x = [\n  ["a"],\n  { b = 1 },\n]\nmcp_servers = { a = { command = "x" } }\n').unsupported,true);
  assert.equal(codexServerNames('x = { a = 1 } # [\n"mcp_servers" . a = { command = "x" }\n').unsupported,true);
  assert.deepEqual([...codexServerNames('note = """\n[mcp_servers.sk_live_SYNTHETIC_VALUE]\n"""\n[mcp_servers.node_repl]\n[mcp_servers.node_repl.env]\nk = \'\'\'\n[mcp_servers.hidden]\n\'\'\'\n[mcp_servers."tracker"]\n')],['node_repl','tracker']);
  await writeFile(join(f.home,'.claude.json'),JSON.stringify({mcpServers:{figma:{type:'http'},'sk_live_SYNTHETIC_VALUE':{type:'http'}}}));
  await writeFile(join(f.home,'.codex','config.toml'),'x = """\n[mcp_servers.sk_live_SYNTHETIC_VALUE]\n"""\n[mcp_servers.ghp_abcdefgh1234]\n[mcp_servers.node_repl]\n');
  await writeFile(join(f.home,'.claude','settings.json'),JSON.stringify({enabledPlugins:{'ecc@ecc':true,'sk_live_SYNTHETIC_VALUE@ecc':true}}));
  await runMcpCheck({repo:f.repo,cachePath:f.options.cachePath,run:async()=>({stdout:'figma: x - ✓ Connected\nsk_live_SYNTHETIC_VALUE: x - ✓ Connected\n'}),now:NOW});
  const sheet=await readSheet(f.options),out=JSON.stringify(sheet);
  for(const secret of ['SYNTHETIC','ghp_abcdefgh1234']) assert.equal(out.includes(secret),false,secret);
  assert.equal((await readFile(f.options.cachePath,'utf8')).includes('SYNTHETIC'),false);
  assert.deepEqual(sheet.mcp.claude.items.map(i=>i.name),['figma','firebase']);
  assert.deepEqual(sheet.mcp.codex.items,[{name:'node_repl'}]);
  // What was hidden is counted, so that the lists are not taken for complete.
  assert.equal(sheet.inventory.hidden,3);
});

test('a Codex configuration written in a form that is not read gives an unread list, not an empty one',async t=>{
  const f=await fixture();t.after(()=>rm(f.root,{recursive:true,force:true}));
  await writeFile(join(f.home,'.codex','config.toml'),'[mcp_servers]\ntracker = { url = "https://example.invalid" }\n');
  assert.deepEqual((await readSheet(f.options)).mcp.codex,{state:'unavailable',items:[]});
});
