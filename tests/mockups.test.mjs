import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { captureHtml, createMockups } from '../src/mockups.mjs';
import { createRequestRegistry } from '../src/requests.mjs';
import { createQuestionActions, createQuestionRegistry } from '../src/questions.mjs';
import { createMissionRegistry } from '../src/mission.mjs';

async function setup(t) {
  const root=await realpath(await mkdtemp(join(tmpdir(),'fabrique-console-mockups-')));t.after(()=>rm(root,{recursive:true,force:true}));
  const allowed=join(root,'mockups'),appHome=join(root,'app'),folder=join(allowed,'xj','lots');
  await mkdir(folder,{recursive:true});await mkdir(appHome);
  for(const name of ['a.html','b.html','notes.txt'])await writeFile(join(folder,name),'<p>x');
  const registry=createMissionRegistry({root}),questions=createQuestionRegistry({root}),inbox=createRequestRegistry({root,questions,missions:registry}),sent=[],captured=[],sessions=[{id:'s1',terminalId:'t7'}];
  await registry.create({project:'p',issue:{id:'i1',identifier:'XJ-1'},request:'r',lead:{sessionId:'s1',lastSeen:null}});
  await registry.create({project:'p',issue:{id:'i2',identifier:'XJ-9'},request:'r',lead:{sessionId:'s1',lastSeen:null}});
  const hooks={},actions=createQuestionActions({questions,inbox,missions:registry,launch:async()=>({})}),real=actions.choose,decide=async x=>{const made=await real(x);if(hooks.during)await hooks.during();return made;};
  const desk=createMockups({root,registry,inbox,allowed,appHome,decide,loadState:async()=>({sessions}),send:async x=>{sent.push(x);return {sent:true};},
    capture:async(file,out)=>{captured.push(file);await writeFile(out,'png');return {width:1440,height:2880};}});
  const ask=async(mission='M-1',ticket='XJ-2')=>(await inbox.ask({type:'decision',mission,ticket,question:null,title:'Choisir',text:'t'})).item;
  return {root,allowed,appHome,folder,registry,inbox,questions,actions,decide,desk,sent,captured,sessions,ask,hooks};
}
// A choice as the screen sends it: the publication it drew, the request that publication is for and its version.
const choose=async(f,mockup,variant,more={})=>f.desk.pick({mission:'M-1',mockup:mockup.id,variant,published:mockup.pub,...(mockup.item?{item:mockup.item,seen:(await f.inbox.read(mockup.item)).version}:{}),...more});
const base=f=>({mission:'M-1',title:'Lots',folder:f.folder});
const otherFolder=async f=>{const folder=join(f.allowed,'xj','autre');await mkdir(folder,{recursive:true});await writeFile(join(folder,'a.html'),'<p>x');return folder;};

test('a mockup is published with one picture per variant, tied to what it concerns',async t=>{
  const f=await setup(t),item=await f.ask(),{mockup}=await f.desk.publish({...base(f),ticket:'XJ-2',item:item.id});
  assert.equal(mockup.id,'MK-1');assert.equal(mockup.ticket,'XJ-2');assert.equal(mockup.item,item.id);
  assert.deepEqual(mockup.variants.map(v=>[v.name,v.file,v.width,v.height]),[['a','a.html',1440,2880],['b','b.html',1440,2880]],'only the HTML files');
  assert.match(mockup.variants[0].image,/^mockups\/MK-1\/\d+-a\.png$/);
  assert.equal((await readdir(join(f.appHome,'mockups','MK-1'))).length,2);
  assert.deepEqual((await f.registry.read('M-1')).mockups.map(k=>k.id),['MK-1']);
});

test('the same folder again replaces its pictures and forgets the choice',async t=>{
  const f=await setup(t),first=(await f.desk.publish(base(f))).mockup;
  await choose(f,first,'a');
  await new Promise(done=>setTimeout(done,5));
  const again=(await f.desk.publish(base(f))).mockup;
  assert.equal(again.id,first.id);assert.equal(again.picked,null);assert.notEqual(again.variants[0].image,first.variants[0].image,'a new name, the app keeps what it has loaded');
  assert.equal((await readdir(join(f.appHome,'mockups',first.id))).length,2);
  assert.equal((await f.registry.read('M-1')).mockups.length,1);
});

test('a mockup comes only from the mockups folder, with one to six variants',async t=>{
  const f=await setup(t),outside=join(f.root,'outside');await mkdir(outside);await writeFile(join(outside,'a.html'),'x');
  await symlink(outside,join(f.allowed,'link'));
  for(const folder of [outside,join(f.allowed,'link'),join(f.allowed,'..','outside'),join(f.allowed,'missing'),f.allowed+'/xj/../../outside'])await assert.rejects(()=>f.desk.publish({...base(f),folder}),e=>e.code==='INVALID_ARGUMENT',folder);
  const empty=join(f.allowed,'empty');await mkdir(empty);
  await assert.rejects(()=>f.desk.publish({...base(f),folder:empty}),e=>e.code==='INVALID_ARGUMENT','none');
  const many=join(f.allowed,'many');await mkdir(many);for(const n of [1,2,3,4,5,6,7])await writeFile(join(many,n+'.html'),'x');
  await assert.rejects(()=>f.desk.publish({...base(f),folder:many}),e=>e.code==='INVALID_ARGUMENT','too many');
  await assert.rejects(()=>f.desk.publish({...base(f),ticket:'nope'}),e=>e.code==='INVALID_ARGUMENT');
  await assert.rejects(()=>f.desk.publish({...base(f),extra:1}),e=>e.code==='INVALID_ARGUMENT');
  await assert.rejects(()=>f.desk.publish({...base(f),mission:'M-9'}),e=>e.code==='NOT_FOUND');
  assert.deepEqual(f.captured,[]);
});

test('a request of another development cannot be tied to a mockup, and a link cannot lead outside',async t=>{
  const f=await setup(t),other=await f.ask('M-2');
  await assert.rejects(()=>f.desk.publish({...base(f),item:other.id}),e=>e.code==='INVALID_ARGUMENT');
  await assert.rejects(()=>f.desk.publish({...base(f),item:'I-99'}),e=>e.code==='NOT_FOUND');
  const outside=join(f.root,'secret.html');await writeFile(outside,'x');
  await rm(join(f.folder,'a.html'));await symlink(outside,join(f.folder,'a.html'));
  await assert.rejects(()=>f.desk.publish(base(f)),e=>e.code==='INVALID_ARGUMENT');
  assert.deepEqual(f.captured,[],'nothing outside is rendered');
});

test('a choice answers the request it belongs to, with the words of the user',async t=>{
  const f=await setup(t),item=await f.ask(),{mockup}=await f.desk.publish({...base(f),item:item.id});
  assert.deepEqual(await choose(f,mockup,'b',{note:'Plus court'}),{mockup:mockup.id,variant:'b'});
  const answered=await f.inbox.read(item.id);assert.equal(answered.state,'answered');
  const [decision]=await f.inbox.decisions({mission:'M-1'});assert.equal(decision.choice,'b');assert.match(decision.text,/variante b\. Note du propriétaire : Plus court/);
  assert.deepEqual(f.sent,[],'the watcher delivers a decision');
  assert.equal((await f.registry.read('M-1')).mockups[0].picked.variant,'b');
  assert.deepEqual(await choose(f,mockup,'b',{note:'Plus court'}),{mockup:mockup.id,variant:'b'},'the same choice again');
});

test('a choice that differs from the answer already given is refused and never shown as chosen',async t=>{
  const f=await setup(t),item=await f.ask(),{mockup}=await f.desk.publish({...base(f),item:item.id});
  await choose(f,mockup,'a');
  await assert.rejects(()=>choose(f,mockup,'b'),e=>e.code==='QUESTION_CLOSED');
  assert.equal((await f.registry.read('M-1')).mockups[0].picked.variant,'a');assert.deepEqual(f.sent,[]);
  const other=await f.ask('M-1','XJ-3'),next=(await f.desk.publish({...base(f),folder:await otherFolder(f),item:other.id})).mockup;
  await f.actions.click({item:other.id,text:'Autre réponse',seen:other.version});
  await assert.rejects(()=>choose(f,next,'a'),e=>e.code==='QUESTION_CLOSED');
  assert.equal((await f.registry.read('M-1')).mockups.find(k=>k.id===next.id).picked,null);
});

test('a page still open on an earlier publication chooses nothing',async t=>{
  const f=await setup(t),one=await f.ask('M-1','XJ-2'),two=await f.ask('M-1','XJ-3'),old=(await f.desk.publish({...base(f),item:one.id})).mockup;
  await new Promise(done=>setTimeout(done,5));
  await f.desk.publish({...base(f),item:two.id});
  await assert.rejects(()=>choose(f,old,'a'),e=>e.code==='MOCKUP_STALE');
  await assert.rejects(()=>f.desk.pick({mission:'M-1',mockup:old.id,variant:'a'}),e=>e.code==='MOCKUP_STALE','without its publication');
  await assert.rejects(()=>f.desk.pick({mission:'M-1',mockup:old.id,variant:'a',published:old.at}),e=>e.code==='MOCKUP_STALE','its time is not its publication');
  assert.deepEqual(await f.inbox.decisions({mission:'M-1'}),[]);
});

test('a publication made while a choice is being sent does not receive that choice',async t=>{
  const f=await setup(t),one=await f.ask('M-1','XJ-2'),two=await f.ask('M-1','XJ-3'),old=(await f.desk.publish({...base(f),item:one.id})).mockup;
  // The first request is answered by the choice; the same folder is then published for another request.
  f.hooks.during=async()=>{f.hooks.during=null;await new Promise(done=>setTimeout(done,5));await f.desk.publish({...base(f),item:two.id});};
  await choose(f,old,'a');
  const now=(await f.registry.read('M-1')).mockups[0];
  assert.equal(now.item,two.id);assert.equal(now.picked,null);
  assert.equal((await f.inbox.read(two.id)).state,'pending');assert.equal((await f.inbox.read(two.id)).answer,null);assert.equal((await f.inbox.read(one.id)).answer.choice,'a');
});

test('a choice for a mockup tied to no request goes to the Lead, and nothing is recorded if it cannot reach it',async t=>{
  const f=await setup(t),{mockup}=await f.desk.publish(base(f));
  await choose(f,mockup,'a');
  assert.equal(f.sent.length,1);assert.equal(f.sent[0].terminal,'t7');assert.match(f.sent[0].text,/variante a/);
  const g=await setup(t),own=(await g.desk.publish(base(g))).mockup;
  g.sessions[0].stoppedAt='x';
  await assert.rejects(()=>choose(g,own,'a'),e=>e.code==='NOT_FOUND');
  assert.equal((await g.registry.read('M-1')).mockups[0].picked,null);
  await assert.rejects(()=>choose(g,{id:'MK-9',pub:own.pub},'a'),e=>e.code==='NOT_FOUND');
  await assert.rejects(()=>choose(g,own,'z'),e=>e.code==='INVALID_ARGUMENT');
});

// Review of the screen of the answers, P1: the page answers a choice of mockup, so a window left open on a request
// that is closed must not reach the Lead by another road.
test('a request closed or left to the Lead stops the choice: no message to the Lead, whatever the number of windows',async t=>{
  const f=await setup(t),item=await f.ask(),{mockup}=await f.desk.publish({...base(f),item:item.id});
  await f.inbox.mark(item.id,{state:'resolved'});
  const two=await Promise.allSettled([choose(f,mockup,'a'),choose(f,mockup,'b')]);
  assert.deepEqual(two.map(r=>r.status==='rejected'&&r.reason.code),['QUESTION_CLOSED','QUESTION_CLOSED'],'two windows left open');
  await assert.rejects(()=>choose(f,mockup,'a'),e=>e.code==='QUESTION_CLOSED'&&e.message==='This request is closed.');
  assert.deepEqual(f.sent,[],'nothing is said to the Lead');
  assert.equal((await f.registry.read('M-1')).mockups[0].picked,null);assert.deepEqual(await f.inbox.decisions({}),[]);
  // Left to the Lead, the same.
  const g=await setup(t),other=await g.ask(),kit=(await g.desk.publish({...base(g),item:other.id})).mockup;
  await g.inbox.answer({item:other.id,seen:other.version,via:'screen',left:true});
  await assert.rejects(()=>choose(g,kit,'a'),e=>e.code==='QUESTION_CLOSED');assert.deepEqual(g.sent,[]);assert.equal((await g.registry.read('M-1')).mockups[0].picked,null);
});

test('a choice of mockup for a request replaced since it was shown is refused, and nothing is chosen',async t=>{
  const f=await setup(t),item=await f.ask(),{mockup}=await f.desk.publish({...base(f),item:item.id}),seen=item.version;
  await assert.rejects(()=>f.desk.pick({mission:'M-1',mockup:mockup.id,variant:'a',published:mockup.pub,item:item.id}),e=>e.code==='SEEN_REQUIRED','without the version shown');
  const next=(await f.inbox.ask({type:'decision',mission:'M-1',ticket:'XJ-2',question:null,title:'Choisir',text:'Une autre question'})).item;
  assert.notEqual(next.id,item.id,'other words are another request');
  for(const version of [seen,next.version])await assert.rejects(()=>choose(f,mockup,'a',{seen:version}),e=>e.code==='REQUEST_CHANGED','the mockup answers the request of before');
  assert.equal((await f.registry.read('M-1')).mockups[0].picked,null);assert.deepEqual(await f.inbox.decisions({}),[]);assert.deepEqual(f.sent,[]);
  // The Lead publishes it for the request of now: it is chosen there.
  const again=(await f.desk.publish({...base(f),item:next.id})).mockup;
  assert.deepEqual(await choose(f,again,'a'),{mockup:again.id,variant:'a'});assert.equal((await f.inbox.decisions({}))[0].item,next.id);
});

test('a capture ends within its wait, and leaves no profile behind',async t=>{
  const temp=await realpath(await mkdtemp(join(tmpdir(),'fabrique-console-capture-')));t.after(()=>rm(temp,{recursive:true,force:true}));
  const work=join(temp,'work'),profiles=join(temp,'profiles');await mkdir(work);await mkdir(profiles);
  const stuck=join(work,'stuck.sh'),dead=join(work,'dead.sh');
  await writeFile(stuck,'#!/bin/sh\nexec sleep 30\n');await writeFile(dead,'#!/bin/sh\nexit 1\n');await chmod(stuck,0o755);await chmod(dead,0o755);
  for(const chrome of [stuck,dead]) {
    const began=Date.now();
    await assert.rejects(()=>captureHtml(join(work,'a.html'),join(work,'a.png'),{chrome,wait:300,temp:profiles}),e=>e.code==='MOCKUP_CAPTURE_FAILED',chrome);
    assert.ok(Date.now()-began<5000,'it does not wait for Chrome');
    assert.deepEqual(await readdir(profiles),[],'no profile left');
  }
});
