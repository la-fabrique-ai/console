import test from 'node:test';
import assert from 'node:assert/strict';
import { desk,click } from './helpers/requests.mjs';
import { createRequestRegistry,ownerAnswerOf } from '../src/requests.mjs';
import { createQuestionRegistry } from '../src/questions.mjs';
import { frozenCopyOf } from '../src/mission.mjs';
import { leadPrompt } from '../src/po-launch.mjs';
import { issuePrompt } from '../src/pilot.mjs';
import { readFile,writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isOwnerRecord,sameOwnerRecord } from '../src/owner.mjs';
import { createConversation } from '../src/conversation.mjs';
import { createClaims } from '../src/claims.mjs';
import { setup,FG2 } from './helpers/dev-chain-setup.mjs';
const owner={id:'human-42',displayName:'Camille'};
for(const by of ['lead','x'])test(`an owner role does not authorize ${by}`,()=>{
 const record={by,role:'owner'};
 assert.equal(isOwnerRecord(record),false);
 assert.equal(isOwnerRecord(record,owner.id),false);
 assert.equal(sameOwnerRecord(record,{...record}),false);
 assert.equal(sameOwnerRecord(record,{...record},owner.id),false);
});
test('owner provenance requires the expected identity and preserves historical the user records',()=>{
 assert.equal(isOwnerRecord({by:owner.id,role:'owner'},owner.id),true);
 assert.equal(isOwnerRecord({by:owner.id,role:'owner'}),false);
 assert.equal(isOwnerRecord({by:owner.id,role:'lead'},owner.id),false);
 assert.equal(isOwnerRecord({by:'owner',role:'owner'}),true);
 assert.equal(isOwnerRecord({by:'legacyOwner'}),true);
 assert.equal(isOwnerRecord(null),false);
 assert.equal(sameOwnerRecord({by:owner.id,role:'owner'},{by:owner.id,role:'owner'},owner.id),true);
 assert.equal(sameOwnerRecord({by:owner.id,role:'owner'},{by:'other-owner',role:'owner'},owner.id),false);
 assert.equal(sameOwnerRecord({by:'legacyOwner'},{by:'legacyOwner'}),true);
 assert.equal(sameOwnerRecord({by:'legacyOwner'},{}),true);
 assert.equal(sameOwnerRecord(null,null),false);
});
test('new request and question decisions persist owner id and role and remain readable',async t=>{
 const f=await desk(t),loadConfig=async()=>({owner});
 const questions=createQuestionRegistry({root:f.root,loadConfig});
 const inbox=createRequestRegistry({root:f.root,questions,loadConfig});
 const q=await questions.create({mission:'M-1',from:'dev',fromTab:'t9',question:'Choisir ?',options:['A','B']});
 const asked=await inbox.ask({mission:'M-1',question:q.id,type:'decision',title:'Choix',text:'Choisir',options:['A','B']});
 const item=await inbox.read(asked.id??asked.item?.id);
 assert.equal(item.to,owner.id);
 const result=await inbox.answer({item:item.id,seen:item.version,choice:'A',text:'A',via:'screen'});
 await inbox.settle(item.id);
 const kept=(await inbox.decisions())[0];
 assert.equal(kept.by,owner.id);assert.equal(kept.role,'owner');
 const answered=await questions.read(q.id);assert.equal(ownerAnswerOf(answered).by,owner.id);
 assert.equal(answered.answer.role,'owner');assert.ok(result);
});
test('old owner answers remain readable without rewriting provenance',()=>{
 const old={answer:{by:'legacyOwner',decision:'D-1',text:'Oui'}};assert.equal(ownerAnswerOf(old),old.answer);
});
test('frozen plan approvals carry stable configured owner identity',()=>{
 const copy=frozenCopyOf({plan:{revision:'r1',tickets:[]}},{at:'2026-01-01',owner});
 assert.equal(copy.by,owner.id);assert.equal(copy.role,'owner');
});
test('Lead and Pilot prompts use configured display name without changing ticket data',async()=>{
 const role=await readFile(new URL('../roles/lead.md',import.meta.url),'utf8');
 const prompt=leadPrompt({role,issue:{identifier:'EX-1'},project:{key:'demo'},folder:'/example',mission:{id:'M-1',request:'Une demande'},config:{owner}});
 assert.match(prompt,/Camille/);assert.doesNotMatch(prompt,/the user/);
 const pilot=issuePrompt({role:'Pilot',project:'demo',issueId:'EX-1',dossier:{issue:{identifier:'EX-1',title:'the user data stays'}},folder:'/example',config:{owner}});
 assert.match(pilot,/Camille/);assert.match(pilot,/the user data stays/);
});

test('decision replay keeps the identity recorded before a configuration change',async t=>{
 const f=await desk(t);let current=owner;const loadConfig=async()=>({owner:current});
 const questions=createQuestionRegistry({root:f.root,loadConfig}),inbox=createRequestRegistry({root:f.root,questions,loadConfig});
 const {item}=await inbox.ask({mission:'M-1',type:'decision',title:'Choisir',text:'Un choix',options:['A','B']});
 await inbox.answer({item:item.id,seen:item.version,choice:'A',text:'A',via:'screen'});
 current={id:'other-owner',displayName:'Autre'};
 await inbox.settle(item.id);await inbox.settle(item.id);
 const decisions=await inbox.decisions();assert.equal(decisions.length,1);assert.equal(decisions[0].by,owner.id);
});

test('owner role names are escaped and ticket text remains untrusted data',async()=>{
 const role=await readFile(new URL('../roles/lead.md',import.meta.url),'utf8');
 const prompt=leadPrompt({role,issue:{identifier:'EX-1',title:'{{owner}} is ticket data'},project:{key:'demo'},folder:'/example',mission:{id:'M-1',request:'Une demande'},config:{owner:{id:'human',displayName:'Camille <owner>'}}});
 assert.match(prompt,/Camille \\u003cowner\\u003e/);assert.match(prompt,/\{\{owner\}\} is ticket data/);
});

test('a recorded owner identity cannot change through question progress or provenance checks',async t=>{
 const f=await desk(t),loadConfig=async()=>({owner});
 const questions=createQuestionRegistry({root:f.root,loadConfig}),inbox=createRequestRegistry({root:f.root,questions,loadConfig});
 const q=await questions.create({mission:'M-1',from:'dev',fromTab:'t9',question:'Choisir ?',options:['A','B']});
 const {item}=await inbox.ask({mission:'M-1',question:q.id,type:'decision',title:'Choix',text:'Choisir',options:['A','B']});
 await inbox.answer({item:item.id,seen:item.version,choice:'A',text:'A',via:'screen'});await inbox.settle(item.id);
 const answered=await questions.read(q.id),vouches=await inbox.vouches({mission:'M-1'});assert.equal(vouches(answered),true);
 assert.equal(vouches({...answered,answer:{...answered.answer,by:'other-owner'}}),false);
 await assert.rejects(questions.progress(q.id,x=>{x.answer.by='other-owner';}),{code:'REQUEST_FIXED'});
});

test('messages forwarded to agents identify the configured owner and preserve quoted text',async()=>{
 const {forwardedText}=await import('../src/agent-texts.mjs');
 const message=forwardedText('the user data stays',{owner});
 assert.match(message,/Camille/);assert.match(message,/<forwarded-message>the user data stays<\/forwarded-message>/);
});

test('a custom owner decision is relayed through the Lead after the owner configuration changes',async t=>{
 const f=await desk(t);let current=owner;const loadConfig=async()=>({owner:current});
 const questions=createQuestionRegistry({root:f.root,loadConfig}),inbox=createRequestRegistry({root:f.root,questions,loadConfig});
 const q=await questions.create({mission:'M-1',ticket:'XJ-2',from:'dev',fromTab:'XJ-2 · dev',question:'Choisir ?',options:['A','B']});
 const {item}=await inbox.ask({mission:'M-1',question:q.id,type:'decision',title:'Choix',text:'Choisir',options:['A','B']});
 await inbox.answer({item:item.id,seen:item.version,choice:'A',text:'A',via:'screen'});
 await inbox.settle(item.id);
 current={id:'other-owner',displayName:'Autre'};
 const sent=[],conversation=createConversation({questions,inbox,send:async message=>{sent.push(message);return {sent:true};}});
 const context={id:'M-1',mission:await f.missions.read('M-1'),session:{id:'s1',terminalId:'t7'},reports:[],lead:{address:'t7',status:'idle'},tab:()=>({address:'t9',status:'idle'}),log:async()=>{},...createClaims({root:f.root})};
 await conversation.step(context);
 const relayed=await questions.read(q.id);
 assert.equal(relayed.state,'open','the Lead receives the decision before answering');
 assert.deepEqual([relayed.legacyOwner.by,relayed.legacyOwner.role],[owner.id,'owner']);
 assert.deepEqual(sent.map(message=>message.terminal),['t7']);
 assert.equal((await inbox.settle(item.id)).settled,'already','replay recognizes the relayed recorded identity');
 await questions.leadAnswer(q.id,'A');
 await conversation.step(context);
 const delivered=await questions.read(q.id);
 assert.equal(delivered.state,'delivered');assert.equal(delivered.answer.by,'lead');
 assert.deepEqual([delivered.legacyOwner.by,delivered.legacyOwner.role],[owner.id,'owner']);
 assert.equal((await inbox.vouches({mission:'M-1'}))(delivered),true);
});

test('an agent answer cannot supply owner provenance',async t=>{
 const f=await desk(t),{question}=await f.asked();
 for(const forged of [{by:owner.id},{role:'owner'},{by:'legacyOwner',role:'owner'}]){
  await assert.rejects(f.actions.answer({question:question.id,text:'A',...forged}),{code:'INVALID_ARGUMENT'});
 }
 await f.actions.answer({question:question.id,text:'A'});
 const kept=await f.questions.read(question.id);
 assert.equal(kept.answer.by,'lead');assert.equal(kept.answer.role,undefined);
 assert.equal((await f.inbox.decisions()).length,0);
});

for(const during of [false,true])test(`a forged Lead owner answer is never relayed (${during?'changed before the progress lock':'already on disk'})`,async t=>{
 let armed=false;
 const f=await desk(t,{wrapQuestions:questions=>({...questions,progress:async(id,change)=>{
  if(armed){armed=false;await forge();}
  return questions.progress(id,change);
 }})});
 const {question}=await f.asked();
 const {item}=await f.actions.escalate({mission:'M-1',question:question.id,type:'decision',title:'Choisir',text:'Un choix',recommendation:'A',why:'Coût'});
 await click(f,{...item,seen:item.version},'A');
 const file=f.questions.fileOf(question.id);
 async function forge(){
  const saved=JSON.parse(await readFile(file,'utf8'));
  saved.answer.by='lead';saved.answer.role='owner';
  await writeFile(file,JSON.stringify(saved));
 }
 if(during)armed=true;else await forge();
 await f.pass(2);
 assert.deepEqual(f.sent,[],'a disk answer cannot authorize a relay by declaring its own owner role');
 const kept=await f.questions.read(question.id);
 assert.equal(kept.answer.by,'lead');assert.equal(kept.answer.role,'owner');
 assert.equal(kept.legacyOwner??null,null,'the forged answer is never kept as an owner decision');
 assert.equal(kept.relayedAt??null,null);
});

test('inscribing a decision requires its recorded identity and never derives it from current configuration',async t=>{
 const f=await desk(t),questions=createQuestionRegistry({root:f.root,loadConfig:async()=>({owner})});
 const q=await questions.create({mission:'M-1',from:'dev',fromTab:'t9',question:'Choisir ?'});
 await assert.rejects(questions.inscribe(q.id,{text:'A',decision:'D-1',at:'2026-11-18T09:00:00.000Z'},{from:'dev',fromTab:'t9'}),{code:'INVALID_ARGUMENT'});
 const kept=await questions.read(q.id);
 assert.equal(kept.state,'open');assert.equal(kept.answer,null);
});

for(const historical of [false,true])test(`a watcher keeps ${historical?'historical the user':'the deciding owner'} provenance after a configuration change`,async t=>{
 let current=owner,clock=Date.parse('2026-11-09T10:00:00Z');
 const loadConfig=async()=>({owner:current}),now=()=>clock;
 const f=await setup({loadConfig,now});t.after(f.cleanup);
 const questions=createQuestionRegistry({root:f.root,loadConfig,now}),inbox=createRequestRegistry({root:f.root,questions,loadConfig,now});
 const chain=f.make({questions,inbox});
 await chain.launch({mission:'M-1',tickets:[FG2]});
 const commit='a'.repeat(40),reportedAt='2026-11-09T10:00:00.000Z';
 f.reports.push({ticket:'XJ-2',kind:'dev',commit,repo:'admin',summary:'fait',at:reportedAt});
 await chain.tick({mission:'M-1'});
 const q=await questions.create({mission:'M-1',ticket:'XJ-2',from:'review-1',fromTab:'XJ-2 · revue',question:'Accepter ?',options:['Accepter','Corriger']});
 const {item}=await inbox.ask({mission:'M-1',question:q.id,ticket:'XJ-2',type:'decision',kind:'verdict',title:'Verdict',text:'Accepter ?',options:['Accepter','Corriger']});
 clock=Date.parse('2026-11-09T10:04:00Z');
 await inbox.answer({item:item.id,seen:item.version,choice:'Accepter',text:'Accepter',via:'screen'});
 if(historical){
  // The historical record predates roles. Keep its original fields, as persisted by the old application.
  const file=join(f.root,'state','requests',item.id+'.json'),saved=JSON.parse(await readFile(file,'utf8'));
  saved.answer.by='legacyOwner';delete saved.answer.role;await writeFile(file,JSON.stringify(saved));
 }
 current={id:'other-owner',displayName:'Autre'};
 await inbox.settle(item.id);
 const expectedBy=historical?'legacyOwner':'human-42',expectedRole=historical?undefined:'owner';
 const [taken]=await inbox.taken({mission:'M-1'});
 assert.deepEqual([taken.by,taken.role],[expectedBy,expectedRole],'inbox preserves the recorded provenance');
 clock=Date.parse('2026-11-09T10:06:00Z');
 f.reports.push({ticket:'XJ-2',kind:'review-1',commit,verdict:'accepted',summary:'Accepté sur décision.',at:'2026-11-09T10:06:00.000Z'});
 await chain.tick({mission:'M-1'});
 const saved=JSON.parse(await readFile(join(f.root,'state','devchain-M-1.json'),'utf8'));
 const decided=saved.done['decided|XJ-2|'+commit+'|'+reportedAt+'|1'];
 assert.deepEqual([decided.by,decided.role],[expectedBy,expectedRole],'watcher preserves the deciding identity');
 const review=(await chain.read({mission:'M-1'})).timings['XJ-2'].find(step=>step.step==='review-1');
 assert.deepEqual([review.decided.by,review.decided.role,review.decided.answer],[expectedBy,expectedRole,'Accepter'],'journal preserves the deciding identity');
});
