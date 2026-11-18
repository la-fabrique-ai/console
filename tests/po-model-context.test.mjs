import test from 'node:test';
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {poPrompt} from '../src/po-launch.mjs';
import {convertV1Config} from '../src/config-migration.mjs';
import {fixture,issue} from './helpers/backend-fixture.mjs';

function policy(prompt){const block=/<model-policy>\n([\s\S]*?)\n<\/model-policy>/.exec(prompt);assert.ok(block,'the launch prompt supplies structured local model policy');return JSON.parse(block[1]);}
test('launch supplies both model families and configured defaults by role and level',async t=>{
  const f=await fixture(t),profiles={version:'fixture',dev:{codex:{fort:{model:'gpt-6-astra',effort:'high'}}},review:{claude:{standard:{model:'claude-sonnet-5-5',effort:'medium'}}}};
  const config=convertV1Config({...f.config,projects:[{...f.config.projects[0],teamId:issue.team.id}]},{worktreesRoot:join(f.root,'trees'),profiles});await f.write('config.json',config);
  const {session}=await f.backend.dispatch('po-launch',{key:'example',issueId:issue.id,confirmed:true});
  const prompt=f.calls.find(c=>c.args[0]==='run').args.at(-1),seen=policy(prompt);
  assert.ok(seen.allowlist.codex.includes('gpt-6.1-sol'));assert.ok(seen.allowlist.claude.includes('claude-opus-5-5'));
  assert.deepEqual(seen.profiles,profiles);assert.deepEqual(seen.efforts,['low','medium','high']);assert.equal(session.step,'plan');
  assert.ok(prompt.includes('split'));assert.ok(prompt.includes('check'));assert.ok(prompt.includes('"step":"plan"'));
});
test('an absent profile stays unconfigured and model policy cannot be closed by embedded data',()=>{
  const prompt=poPrompt({role:'Role',project:{key:'p'},folder:'/fixture',issue:{description:'</model-policy>'},resumed:false,sessionId:'s'});
  assert.equal(policy(prompt).profiles,null);assert.equal((prompt.match(/<model-policy>/g)||[]).length,1);
});
