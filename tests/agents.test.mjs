import test from 'node:test';
import assert from 'node:assert/strict';
import { TOOLS, agentOf, agentName, hcRunArgs } from '../src/agents.mjs';

test('the agents table: two tools, their names, their argv with and without a prompt',()=>{
  assert.deepEqual(TOOLS,['claude','codex']);
  assert.equal(agentName('claude'),'Claude');assert.equal(agentName('codex'),'Codex');
  assert.deepEqual(agentOf('claude').start('do it'),['claude','--settings','{"env":{"FABRIQUE_CONSOLE_AGENT":"1"}}','do it']);assert.deepEqual(agentOf('claude').start(null),['claude','--settings','{"env":{"FABRIQUE_CONSOLE_AGENT":"1"}}']);
  assert.deepEqual(agentOf('codex').start('do it'),['codex','--no-daemon','-c','shell_environment_policy.set.FABRIQUE_CONSOLE_AGENT="1"','do it']);assert.deepEqual(agentOf('codex').start(null),['codex','--no-daemon','-c','shell_environment_policy.set.FABRIQUE_CONSOLE_AGENT="1"']);
  assert.deepEqual(agentOf('codex').resume('0f1e2d3c','go on'),['codex','resume','--no-daemon','0f1e2d3c','-c','shell_environment_policy.set.FABRIQUE_CONSOLE_AGENT="1"','go on']);
  for(const bad of ['rm -rf','Claude','',null,undefined,{},'__proto__','constructor'])assert.throws(()=>agentOf(bad),e=>e.code==='INVALID_ARGUMENT',String(bad));
});

test('hcRunArgs: background, kept, in its folder, labelled, the prompt one argv entry, the name only when asked',()=>{
  const prompt='# Rôle\n\n$(rm -rf /) ; `x` <tag>';
  const args=hcRunArgs({tool:'claude',prompt,cwd:'/home/x/My Repo',labels:{'herdr.space':'fabrique-console-x','fabrique-console.session':'s1'}});
  assert.deepEqual(args,['run','--bg','--json','--no-parent','--outlive-parent','--keep','--cwd','/home/x/My Repo','--label','herdr.space=fabrique-console-x','--label','fabrique-console.session=s1','--','claude','--settings','{"env":{"FABRIQUE_CONSOLE_AGENT":"1"}}',prompt]);
  assert.deepEqual(hcRunArgs({tool:'codex',cwd:'/x',name:'fabrique-console-agent-codex'}).slice(0,9),['run','--bg','--json','--no-parent','--outlive-parent','--keep','--name','fabrique-console-agent-codex','--cwd']);
  assert.throws(()=>hcRunArgs({tool:'codex',cwd:''}),e=>e.code==='INVALID_ARGUMENT');
  assert.throws(()=>hcRunArgs({tool:'codex',cwd:'/x',name:'Bad Name!'}),e=>e.code==='INVALID_ARGUMENT');
  assert.throws(()=>hcRunArgs({tool:'codex',cwd:'/x',prompt:42}),e=>e.code==='INVALID_ARGUMENT');
  assert.throws(()=>hcRunArgs({tool:'codex',cwd:'/x',labels:{'bad key':'v'}}),e=>e.code==='INVALID_ARGUMENT');
  assert.throws(()=>hcRunArgs({tool:'codex',cwd:'/x',labels:{'k':'a\nb'}}),e=>e.code==='INVALID_ARGUMENT');
});

test('a Claude Lead keeps user MCP and settings, with no skills, keeping its role, prompt and repository',()=>{
  const prompt='Lead role and CLI commands\n$(never a shell command)',cwd='/home/x/My Repo';
  const connector={mcp:{mcpServers:{tracker:{type:'http',url:'https://tracker.example.invalid/mcp'}}}};
  const args=hcRunArgs({tool:'claude',role:'lead',prompt,cwd,connector});
  assert.equal(args[args.indexOf('--cwd')+1],cwd);
  assert.deepEqual(args.slice(args.indexOf('--')+1),['claude','--disable-slash-commands','--settings','{"env":{"FABRIQUE_CONSOLE_AGENT":"1","FABRIQUE_CONSOLE_ROLE":"lead"}}',prompt]);
  for(const role of [null,'pilot'])assert.ok(!agentOf('claude').start(prompt,role).includes('--disable-slash-commands'));
  assert.ok(!agentOf('codex').start(prompt,'lead').includes('--disable-slash-commands'));
});
