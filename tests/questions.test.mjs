import test from 'node:test';
import assert from 'node:assert/strict';
import { desk, click, holds } from './helpers/requests.mjs';
import { createQuestionActions, answersOf } from '../src/questions.mjs';
import { createRequestRegistry } from '../src/requests.mjs';

// The questions of the agents and what the Lead does with them: it answers, or it raises a request to the user. The
// requests themselves, their versions and their answers: tests/request-versions, request-interleavings, request-paths.
async function setup(t) {
  const f=await desk(t);
  f.launched=[];f.mission=await f.missions.read('M-1');
  f.actions=createQuestionActions({questions:f.questions,inbox:f.inbox,missions:f.missions,launch:async input=>{f.launched.push(input);return {launched:[]};}});
  // An answer as a screen sends it: with the version of the request as it is shown now.
  f.answerShown=async(id,text,choice=text)=>f.actions.click({item:id,choice,text,seen:(await f.inbox.read(id)).version});
  return f;
}
const ESCALATE={mission:'M-1',type:'decision',title:'Repli',text:'Client ou serveur ?',recommendation:'Serveur',why:'Coût'};

test('one file of an agent makes one question, however many read it at once',async t=>{
  const f=await setup(t),made=await Promise.all(Array.from({length:8},()=>f.asked()));
  assert.equal(made.filter(x=>x.created).length,1);assert.deepEqual([...new Set(made.map(x=>x.question.id))],['Q-1']);
  const [q]=await f.questions.list({mission:'M-1'});
  assert.deepEqual({state:q.state,ticket:q.ticket,from:q.from,fromTab:q.fromTab,options:q.options,answer:q.answer,delivery:q.delivery},{state:'open',ticket:'XJ-2',from:'dev',fromTab:'XJ-2 · dev',options:['A','B'],answer:null,delivery:null});
  assert.equal(Object.hasOwn(q,'item'),false,'a question does not point to a request: the request names its question');
  assert.equal((await f.asked({source:'XJ-2.ask-2.json'})).question.id,'Q-2','another file is another question');
});

test('the Lead answers a question once; the same answer again changes nothing, another is refused',async t=>{
  const f=await setup(t);await f.asked();
  const {question}=await f.actions.answer({question:'Q-1',text:'Garde roles.ts'});
  assert.equal(question.state,'answered');assert.equal(question.answer.text,'Garde roles.ts');assert.equal(question.answer.by,'lead');assert.equal(question.answer.decision,null);
  assert.equal((await f.actions.answer({question:'Q-1',text:'Garde roles.ts'})).question.answer.at,question.answer.at);
  await assert.rejects(()=>f.actions.answer({question:'Q-1',text:'Autre chose'}),e=>e.code==='QUESTION_CLOSED');
  await assert.rejects(()=>f.actions.answer({question:'Q-9',text:'x'}),e=>e.code==='NOT_FOUND');
  await assert.rejects(()=>f.actions.answer({question:'nope',text:'x'}),e=>e.code==='INVALID_ARGUMENT');
  await assert.rejects(()=>f.actions.answer({question:'Q-1'}),e=>e.code==='INVALID_ARGUMENT');
  assert.deepEqual(await f.inbox.list({}),[],'an answer of the Lead never reaches the Inbox');assert.deepEqual(f.notified,[]);
});

test('an escalation makes one request with one notification; other words for the same question replace it',async t=>{
  const f=await setup(t);await f.asked();
  const first=await f.actions.escalate({...ESCALATE,question:'Q-1',ticket:'XJ-2',consequences:'+1 s',proofs:['a.png']});
  assert.equal(first.created,true);assert.equal(first.question,'Q-1');
  const it=first.item;
  assert.deepEqual({id:it.id,type:it.type,mission:it.mission,project:it.project,issue:it.issue,ticket:it.ticket,question:it.question,title:it.title,recommendation:it.recommendation,why:it.why,consequences:it.consequences,blocked:it.blocked,proofs:it.proofs,to:it.to,priority:it.priority,state:it.state,answer:it.answer},
    {id:'I-1',type:'decision',mission:'M-1',project:'alpha',issue:'XJ-1',ticket:'XJ-2',question:'Q-1',title:'Repli',recommendation:'Serveur',why:'Coût',consequences:'+1 s',blocked:['XJ-2'],proofs:['a.png'],to:'owner',priority:1,state:'pending',answer:null});
  assert.equal((await f.questions.read('Q-1')).state,'escalated');
  assert.equal(f.notified.length,1);
  const again=await f.actions.escalate({...ESCALATE,question:'Q-1',ticket:'XJ-2',text:'Reformulé'});
  assert.equal(again.created,true);assert.equal(again.replaced,'I-1');assert.equal(again.item.id,'I-2','other words are another request');assert.equal(again.item.text,'Reformulé');
  assert.deepEqual({consequences:again.item.consequences,proofs:again.item.proofs,question:again.item.question,blocked:again.item.blocked},{consequences:'',proofs:[],question:'Q-1',blocked:['XJ-2']},'it is what the Lead says now, in the question that waited');
  const before=await f.inbox.read('I-1');assert.equal(before.text,'Client ou serveur ?');assert.equal(before.state,'pending','nothing is written in the request replaced');
  assert.deepEqual((await f.inbox.list({})).map(i=>i.id),['I-2']);assert.equal(f.notified.length,1,'a request replaced before its answer notifies nobody');
  assert.equal((await f.actions.escalate({...ESCALATE,ticket:'XJ-3'})).item.id,'I-3','another ticket is another request');
  assert.equal((await f.actions.escalate({...ESCALATE,type:'authorization',ticket:'XJ-2',options:['Autoriser','Refuser']})).item.id,'I-4','another type too');
  assert.equal((await f.actions.escalate({...ESCALATE,ticket:'XJ-2'})).item.id,'I-5','and the same ticket and type without the question: it comes from nowhere but the Lead');
  assert.deepEqual((await f.inbox.list({})).map(i=>i.id).sort(),['I-2','I-3','I-4','I-5']);
  await holds(f);
});

test('what the Lead escalates of its own waits in a question of its own, and comes back to it',async t=>{
  const f=await setup(t),{item}=await f.actions.escalate(ESCALATE);
  const q=await f.questions.read(item.question);
  assert.equal(q.from,'lead');assert.equal(q.state,'escalated');assert.equal(q.ticket,null);
  assert.deepEqual(item.recipient,{question:q.id,from:'lead',fromTab:null,ticket:null,mission:'M-1'});assert.equal(item.source,null);
  assert.equal(item.priority,2,'nothing is blocked');
});

test('the same escalation twice at once makes one question: one decision, one delivery to come',async t=>{
  const f=await setup(t),both=await Promise.all([f.actions.escalate(ESCALATE),f.actions.escalate(ESCALATE)]);
  assert.equal((await f.questions.list({mission:'M-1'})).length,1);assert.equal(both[0].question,both[1].question);assert.equal((await f.inbox.list({})).length,1);assert.equal(f.notified.length,1);
  await f.answerShown('I-1','Serveur');
  assert.deepEqual((await f.questions.list({mission:'M-1'})).map(q=>q.state),['answered']);
  await Promise.all([f.actions.request({mission:'M-1',kind:'validation',text:'Bilan'}),f.actions.request({mission:'M-1',kind:'validation',text:'Bilan'})]);
  assert.equal((await f.questions.list({mission:'M-1'})).length,2,'one more for the validation');
});

test('an escalation is refused when it does not hold together',async t=>{
  const f=await setup(t);await f.asked();
  const other=(await f.missions.create({project:'alpha',issue:{id:'i2',identifier:'XJ-9'},request:'r'})).mission;
  for(const input of [{...ESCALATE,type:'validation'},{...ESCALATE,title:''},{...ESCALATE,recommendation:undefined},{...ESCALATE,ticket:'nope'},{...ESCALATE,blocked:'XJ-2'},{...ESCALATE,proofs:[1]},{...ESCALATE,extra:1},{...ESCALATE,mission:other.id,question:'Q-1'}])
    await assert.rejects(()=>f.actions.escalate(input),e=>e.code==='INVALID_ARGUMENT',JSON.stringify(input));
  await assert.rejects(()=>f.actions.escalate({...ESCALATE,mission:'M-9'}),e=>e.code==='NOT_FOUND');
  assert.deepEqual(await f.inbox.list({}),[]);assert.deepEqual(f.notified,[]);
  assert.equal((await f.questions.read('Q-1')).state,'open','and its question is not held');
});

test('a decision is written once: played again or at the same time it is the first one, and the question gets it',async t=>{
  const f=await setup(t);await f.asked();await f.actions.escalate({...ESCALATE,question:'Q-1',ticket:'XJ-2'});
  const all=await Promise.all(Array.from({length:6},()=>f.answerShown('I-1','Serveur, plafond 50','Serveur')));
  assert.equal(all.filter(x=>x.created).length,1);assert.deepEqual([...new Set(all.map(x=>x.decision.id))],['D-1']);
  const d=all[0].decision;
  assert.deepEqual({id:d.id,item:d.item,mission:d.mission,question:d.question,choice:d.choice,text:d.text,by:d.by,via:d.via},{id:'D-1',item:'I-1',mission:'M-1',question:'Q-1',choice:'Serveur',text:'Serveur, plafond 50',by:'owner',via:'screen'});
  const it=await f.inbox.read('I-1');assert.equal(it.state,'answered');assert.equal(it.answer.id,'D-1');
  const q=await f.questions.read('Q-1');assert.equal(q.state,'answered');assert.deepEqual({text:q.answer.text,by:q.answer.by,decision:q.answer.decision,choice:q.answer.choice,title:q.answer.title},{text:'Serveur, plafond 50',by:'owner',decision:'D-1',choice:'Serveur',title:'Repli'});
  assert.equal((await f.answerShown('I-1','Autre avis')).decision.text,'Serveur, plafond 50','the first decision stands');
  await assert.rejects(()=>f.actions.click({item:'I-9',text:'x',seen:it.version}),e=>e.code==='NOT_FOUND');
  await assert.rejects(()=>f.actions.click({item:'I-1',seen:it.version}),e=>e.code==='INVALID_ARGUMENT');
  for(const seen of ['',42,null,'abc','z'.repeat(64)])await assert.rejects(()=>f.actions.click({item:'I-1',text:'Serveur',seen}),e=>e.code==='INVALID_ARGUMENT',JSON.stringify(seen));
  await holds(f);
});

test('the Inbox: what blocks agents first, then the oldest; what is resolved goes, an error stays',async t=>{
  let at=Date.parse('2026-11-10T09:00:00Z');
  const f=await setup(t),inbox=createRequestRegistry({root:f.root,questions:f.questions,missions:f.missions,now:()=>(at+=60000)}),actions=createQuestionActions({questions:f.questions,inbox,missions:f.missions,launch:async()=>({})});
  await actions.request({mission:'M-1',kind:'validation',text:'Bilan'});
  await actions.escalate({...ESCALATE,type:'authorization',options:['Autoriser','Refuser']});
  await actions.escalate({...ESCALATE,ticket:'XJ-2',blocked:['XJ-2']});
  await actions.escalate({...ESCALATE,ticket:'XJ-3',blocked:['XJ-3']});
  assert.deepEqual((await actions.list({})).items.map(i=>[i.id,i.priority]),[['I-3',1],['I-4',1],['I-2',2],['I-1',3]]);
  await inbox.mark('I-3',{state:'resolved'});await inbox.mark('I-4',{state:'error',error:'gone'});
  assert.deepEqual((await actions.list({})).items.map(i=>i.id),['I-4','I-2','I-1']);
  const made=await actions.escalate({...ESCALATE,ticket:'XJ-2',blocked:['XJ-2']});
  assert.equal(made.created,true,'a resolved request frees its ticket and type');
});

test('the Lead asks for what the watcher runs: a launch, a validation; QA and fixes come later',async t=>{
  const f=await setup(t),tickets=[{identifier:'XJ-2',tool:'claude',model:'m',effort:'high'}];
  await f.actions.request({mission:'M-1',kind:'launch',tickets});
  assert.deepEqual(f.launched,[{mission:'M-1',tickets,fresh:false}]);
  const first=await f.actions.request({mission:'M-1',kind:'validation',text:'Bilan : six tickets.'});
  assert.equal(first.created,true);assert.deepEqual({type:first.item.type,priority:first.item.priority,text:first.item.text,ticket:first.item.ticket,title:first.item.title},{type:'validation',priority:3,text:'Bilan : six tickets.',ticket:null,title:'Paiement'});
  assert.equal((await f.missions.read('M-1')).step,'validating');
  const again=await f.actions.request({mission:'M-1',kind:'validation',text:'Bilan corrigé.'});
  assert.equal(again.created,true);assert.notEqual(again.item.id,first.item.id,'a report corrected is another request');assert.equal(again.item.text,'Bilan corrigé.');assert.equal(f.notified.length,1);
  assert.equal(again.item.question,first.item.question,'in the question the first one waited in');assert.equal(again.item.replaces,first.item.id);assert.deepEqual((await f.inbox.list({})).map(i=>i.id),[again.item.id]);
  assert.equal((await f.actions.request({mission:'M-1',kind:'validation',text:'Bilan corrigé.'})).created,false,'the same report again');
  assert.equal((await f.actions.request({mission:'M-1',kind:'qa'})).automatic,true,'the watcher starts the QA by itself');
  f.launched.length=0;await f.actions.request({mission:'M-1',kind:'fix',tickets});assert.deepEqual(f.launched,[{mission:'M-1',tickets,fresh:false}],'a correction ticket starts like any other');
  await assert.rejects(()=>f.actions.request({mission:'M-1',kind:'nope'}),e=>e.code==='INVALID_ARGUMENT');
  await assert.rejects(()=>f.actions.request({mission:'M-1',kind:'validation'}),e=>e.code==='INVALID_ARGUMENT');
  await assert.rejects(()=>f.actions.request({mission:'M-9',kind:'validation',text:'x'}),e=>e.code==='NOT_FOUND');
});

test('the Inbox offers the answers of the Lead, else those of the agent, else what the Lead recommends',async t=>{
  const f=await setup(t);await f.asked();
  await f.actions.escalate({...ESCALATE,ticket:'XJ-9',options:['Serveur','Client']});
  await f.actions.escalate({...ESCALATE,ticket:'XJ-8'});
  await f.actions.escalate({...ESCALATE,question:'Q-1',ticket:'XJ-2'});
  const items=(await f.actions.list({})).items,by=id=>items.find(i=>i.ticket===id);
  assert.deepEqual(by('XJ-9').answers,['Serveur','Client']);assert.deepEqual(by('XJ-8').answers,[ESCALATE.recommendation],'what the Lead recommends');assert.deepEqual(by('XJ-2').answers,['A','B'],'those of the agent');assert.equal(by('XJ-9').answered,null);
  assert.equal(by('XJ-9').seen,by('XJ-9').version,'its version is given to send back');
  await click(f,by('XJ-9'),'Serveur');
  const after=(await f.actions.list({})).items.find(i=>i.ticket==='XJ-9');assert.equal(after.answered,'Serveur','the answer given is shown');assert.ok(after.decision);
});

test('the answers offered are few and short',async t=>{
  const f=await setup(t);
  for(const options of [Array(5).fill('a'),'a',[''],['x'.repeat(201)]])await assert.rejects(()=>f.actions.escalate({...ESCALATE,ticket:'XJ-9',options}),e=>e.code==='INVALID_ARGUMENT',JSON.stringify(options).slice(0,30));
  assert.deepEqual(answersOf({recommendation:'x'.repeat(500)},null),[],'too long for a button: Pilot takes it');assert.deepEqual(answersOf({options:['a','a'],recommendation:'b'},null),['a']);assert.deepEqual(answersOf({},{options:['Oui']}),['Oui']);
});

test('a button is clicked as it is: an answer with a blank to fill in is not offered',()=>{
  assert.deepEqual(answersOf({options:['Variante choisie : <préciser A/B/C>','Tout A']},null),['Tout A']);
  assert.deepEqual(answersOf({options:['Variante : <préciser>'],recommendation:'Tout A'},null),['Tout A'],'nothing usable: what is recommended');
  assert.deepEqual(answersOf({options:['<x>']},{options:['Oui','Non']}),['Oui','Non']);
  assert.deepEqual(answersOf({options:['<x>']},null),[]);
});

test('the version of a request covers every word of it: any other word is another request, with another version',async t=>{
  const f=await setup(t);await f.asked();await f.actions.escalate({...ESCALATE,question:'Q-1',ticket:'XJ-2'});
  const first=(await f.actions.list({})).items[0];
  await f.actions.escalate({...ESCALATE,question:'Q-1',ticket:'XJ-2'});
  await f.inbox.mark(first.id,{discussedAt:'2026-01-01T00:00:00.000Z'});
  assert.equal((await f.actions.list({})).items[0].seen,first.seen,'the same words again, or a talk with the Lead, change nothing');
  for(const change of [{title:'Repli du paiement'},{text:'Client, serveur ou les deux ?'},{recommendation:'Client'},{why:'Délai'},{consequences:'Un lot de plus'},{options:['Serveur','Client']},{blocked:['XJ-2','XJ-3']},{proofs:['preuves/a.png']},{summary:'Repli'}]) {
    const before=(await f.actions.list({})).items[0];
    await f.actions.escalate({...ESCALATE,question:'Q-1',ticket:'XJ-2',...change});
    const [now,...others]=(await f.actions.list({})).items;
    assert.deepEqual(others,[],JSON.stringify(change));assert.notEqual(now.id,before.id,JSON.stringify(change));assert.notEqual(now.seen,before.seen);assert.equal(now.replaces,before.id);
  }
  await holds(f);
});
