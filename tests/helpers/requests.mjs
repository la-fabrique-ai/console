import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMissionActions, createMissionRegistry } from '../../src/mission.mjs';
import { createQuestionActions, createQuestionRegistry } from '../../src/questions.mjs';
import { createRequestRegistry, printOf } from '../../src/requests.mjs';
import { createConversation } from '../../src/conversation.mjs';
import { createClaims } from '../../src/claims.mjs';
import { fakeHerdr } from './fake-herdr.mjs';

// A desk of requests on test data: the registers, the actions of the Lead, of Pilot and of the screens, a Lead whose
// terminal only records what it is sent, and a watcher that passes when the test says so.
export async function desk(t,{probe=null,send=null,wrapQuestions=q=>q}={}) {
  const root=await realpath(await mkdtemp(join(tmpdir(),'fabrique-console-requests-')));t.after(()=>rm(root,{recursive:true,force:true}));
  let at=Date.parse('2026-11-13T09:00:00Z');
  const f={root,notified:[],sent:[],probe,send,sessions:[{id:'s1',terminalId:'t7'}],tabs:{'XJ-2 · dev':{address:'t9',status:'idle'},'XJ-6 · dev':{address:'t10',status:'idle'}},leadGone:false};
  const now=()=>at;f.now=now;f.later=minutes=>{at+=minutes*60000;};
  f.missions=createMissionRegistry({root,now});f.questions=wrapQuestions(createQuestionRegistry({root,now}));
  f.inbox=createRequestRegistry({root,now,questions:f.questions,missions:f.missions,notify:async(title,text)=>{f.notified.push([title,text]);},probe:async point=>{if(f.probe)await f.probe(point);}});
  f.actions=createQuestionActions({questions:f.questions,inbox:f.inbox,missions:f.missions,launch:async()=>({launched:[]})});
  const post=async message=>{f.sent.push(message);if(f.send)await f.send(message,f.sent.length);return {sent:true};};
  // The window of Herdr, through the one fake Herdr: the Lead's terminal in its tab, idle until the test says otherwise
  // (f.leadTab.status).
  f.leadTab={address:'t7',space:'sp1',tab:'x7',tab_name:'XJ-1 · Lead',status:'idle'};const {window}=fakeHerdr({agents:[f.leadTab]}).herdr;
  f.lead=createMissionActions({root,now,registry:f.missions,inbox:f.inbox,questions:f.questions,loadState:async()=>({sessions:f.sessions}),send:post,window});
  await f.missions.create({project:'alpha',issue:{id:'i1',identifier:'XJ-1',title:'Paiement',url:'u'},request:'Payer',lead:{sessionId:'s1',lastSeen:null}});
  f.shown=async()=>(await f.actions.list({})).items;f.one=async id=>(await f.shown()).find(item=>item.id===id);
  f.asked=(fields={})=>f.questions.ensure({mission:'M-1',ticket:'XJ-2',from:'dev',fromTab:'XJ-2 · dev',question:'Quel rôle ?',options:['A','B'],source:'XJ-2.ask-1.json',...fields});
  // The watcher: the claims of the mission where the chain keeps them, one pass of the conversation at a time.
  const claims=createClaims({root,now});f.claimed=key=>claims.claimedAt('M-1',key);
  const talk=createConversation({questions:f.questions,inbox:f.inbox,send:post,now});
  f.pass=async(times=1,minutes=0)=>{for(let n=0;n<times;n++){at+=minutes*60000;await talk.step({id:'M-1',mission:await f.missions.read('M-1'),session:{id:'s1',terminalId:'t7',identifier:'XJ-1'},reports:[],lead:f.leadGone?null:{address:'t7',status:'idle'},tab:name=>f.tabs[name]||null,log:async()=>{},tell:async()=>{},...claims});}};
  f.requests=async()=>Promise.all((await readdir(join(root,'state','requests')).catch(()=>[])).filter(name=>/^I-\d+\.json$/.test(name)).map(async name=>JSON.parse(await readFile(join(root,'state','requests',name),'utf8'))));
  f.decisionFiles=async()=>Promise.all((await readdir(join(root,'state','decisions')).catch(()=>[])).filter(name=>/^D-\d+\.json$/.test(name)).map(async name=>JSON.parse(await readFile(join(root,'state','decisions',name),'utf8'))));
  return f;
}
// What the screens send with an answer: the request, and the version shown of it.
export const click=(f,item,choice,more={})=>f.actions.click({item:item.id,choice,text:choice,seen:item.seen,...more});

// The rule, checked on what is on disk: a request is what its print says, its identifier included; it has one answer at
// most, given on its own print; a request replaced has none; a permission was answered by a screen, with one of its
// answers; a decision names the request whose answer it is; and an answer of the user in a question comes from the one
// request that names that question.
export async function holds(f,label='') {
  const items=await f.requests(),decisions=await f.decisionFiles(),questions=await f.questions.list({});
  for(const item of items) {
    assert.equal(item.version,printOf(item),label+' '+item.id+': its version is its print');
    if(!item.answer)continue;
    assert.equal(item.answer.seen,item.version,label+' '+item.id+': answered on its own version');
    assert.equal(items.some(other=>other.replaces===item.id),false,label+' '+item.id+': answered, so never replaced');
    if(item.type==='authorization'){assert.equal(item.answer.via,'screen',label+' '+item.id+': a permission comes from a screen');assert.ok(item.answers.includes(item.answer.choice),label+' '+item.id+': with one of its answers');}
  }
  assert.equal(new Set(items.filter(item=>item.answer?.id).map(item=>item.answer.id)).size,items.filter(item=>item.answer?.id).length,label+' one request per decision');
  for(const d of decisions) {
    const owner=items.find(item=>item.answer?.id===d.id);
    assert.ok(owner,label+' '+d.id+': a decision is the answer of a request');assert.equal(d.item,owner.id);assert.equal(d.seen,owner.version);assert.equal(d.text,owner.answer.text);
  }
  for(const q of questions) {
    const said=(q.answer?.role==='owner'||q.answer?.by==='legacyOwner')?q.answer:q.legacyOwner??null;
    if(!said)continue;
    const owner=items.find(item=>item.answer?.id===said.decision);
    assert.ok(owner,label+' '+q.id+': the answer of the user comes from a request');assert.equal(owner.question,q.id,label+' '+q.id+': from the request that names this question');assert.equal(said.text,owner.answer.text);
  }
}
// At most one message per kind and subject: what was sent, by what it carries.
export const sentAbout=(f,pattern)=>f.sent.filter(message=>pattern.test(message.text));
