import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,realpath,mkdir,writeFile,readFile,rm,stat,symlink} from 'node:fs/promises';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {createDevFlow} from '../src/dev-flow.mjs';
import {writeDevReport} from '../src/dev-report.mjs';
const execute=promisify(execFile),script=fileURLToPath(new URL('../scripts/fabrique-console-report.mjs',import.meta.url));
async function fixture(t){
  const path=await realpath(await mkdtemp('/private/tmp/fabrique-console-report-'));t.after(()=>rm(path,{recursive:true,force:true}));
  const git=async(repo,args)=>(await execute('git',['-C',repo,...args],{encoding:'utf8',shell:false})).stdout.trim();
  for(const repo of[path,join(path,'admin')]){await mkdir(repo,{recursive:true});await git(repo,['init','-b','xj-689']);await git(repo,['config','user.name','Fixture']);await git(repo,['config','user.email','fixture@example.invalid']);await git(repo,['commit','--allow-empty','-m','fixture']);}
  const sha=await git(join(path,'admin'),['rev-parse','HEAD']);
  const run=async args=>{try{const r=await execute(process.execPath,[script,...args],{cwd:path,encoding:'utf8',shell:false});return{exit:0,...JSON.parse(r.stdout)};}catch(error){try{return{exit:error.code,...JSON.parse(error.stdout)};}catch{return{exit:error.code,ok:false,error:{code:'COMMAND_NOT_IMPLEMENTED'}};}}};
  const flow=createDevFlow({loadState:async()=>({sessions:[{id:'po',role:'po',worktree:path}]})});
  return{path,sha,git,run,flow};
}
test('the agent command writes a dev report that dev-reports reads with its actual branch and full commit',async t=>{
  const f=await fixture(t),result=await f.run(['dev','--ticket','XJ-690','--commit',f.sha.slice(0,12),'--repo','admin','--summary','Développement fini.']);
  assert.equal(result.ok,true,JSON.stringify(result));assert.equal(result.exit,0);
  const data=JSON.parse(await readFile(join(f.path,'.fabrique-console','XJ-690.dev.json'),'utf8'));assert.equal(data.commit,f.sha);assert.equal(data.branch,'xj-689');assert.equal(data.repo,'admin');assert.equal(data.ticket,'XJ-690');
  const reports=(await f.flow.reports({sessionId:'po'})).reports;assert.equal(reports.length,1);assert.equal(reports[0].commit,f.sha);assert.equal(reports[0].summary,'Développement fini.');assert.equal(reports[0].branch,'xj-689');
});
test('review inherits the dev repository and exposes all repeated nonblocking notes, including review 12',async t=>{
  const f=await fixture(t);assert.equal((await f.run(['dev','--ticket','XJ-690','--commit',f.sha,'--repo','admin','--summary','Dev'])).ok,true);
  const result=await f.run(['review','--ticket','XJ-690','--n','12','--commit',f.sha,'--verdict','accepted','--summary','Accepté','--note','Une remarque.','--note','Autre remarque.']);assert.equal(result.ok,true,JSON.stringify(result));
  const row=(await f.flow.reports({sessionId:'po'})).reports.find(row=>row.kind==='review-12');assert.deepEqual(row.notes,['Une remarque.','Autre remarque.']);assert.equal(row.repo,'admin');assert.equal(row.verdict,'accepted');
});
for(const [args,code]of[
 [['dev','--ticket','../XJ-690','--commit','a'.repeat(40)],'INVALID_ARGUMENT'],
 [['dev','--ticket','XJ-690','--commit','f'.repeat(40),'--repo','admin'],'REPORT_COMMIT_NOT_FOUND'],
 [['dev','--ticket','XJ-690','--commit','a'.repeat(40),'--repo','../outside'],'INVALID_ARGUMENT'],
 [['review','--ticket','XJ-690','--n','0','--commit','a'.repeat(40),'--verdict','accepted'],'INVALID_ARGUMENT'],
 [['review','--ticket','XJ-690','--n','1','--commit','a'.repeat(40),'--verdict','looks-good'],'INVALID_ARGUMENT'],
 [['dev','--ticket','XJ-690','--commit','a'.repeat(40),'--typo','x'],'INVALID_ARGUMENT']
])test(`invalid report is refused without creating a file: ${args.join(' ')}`,async t=>{
  const f=await fixture(t),result=await f.run(args);assert.equal(result.ok,false);assert.equal(result.exit,1);assert.equal(result.error.code,code);await assert.rejects(()=>stat(join(f.path,'.fabrique-console','XJ-690.dev.json')),{code:'ENOENT'});
});
test('an agent asks a question without any commit; the reports read it back as an ask',async t=>{
  const f=await fixture(t),result=await f.run(['ask','--ticket','XJ-690','--question','Quel rôle ?','--option','Admin','--option','Gérant','--from','review-1']);
  assert.equal(result.ok,true,JSON.stringify(result));assert.equal(result.kind,'ask');assert.match(result.path,/\.fabrique-console\/XJ-690\.ask-\d{13}\.json$/);
  const data=JSON.parse(await readFile(result.path,'utf8'));assert.deepEqual({ticket:data.ticket,question:data.question,options:data.options,from:data.from},{ticket:'XJ-690',question:'Quel rôle ?',options:['Admin','Gérant'],from:'review-1'});
  const row=(await f.flow.reports({sessionId:'po'})).reports.find(r=>r.kind==='ask');
  assert.deepEqual({ticket:row.ticket,question:row.question,options:row.options,from:row.from},{ticket:'XJ-690',question:'Quel rôle ?',options:['Admin','Gérant'],from:'review-1'});assert.ok(row.name.startsWith('XJ-690.ask-'));
  const plain=await f.run(['ask','--ticket','XJ-690','--question','Autre ?']);assert.equal(plain.ok,true);assert.equal(JSON.parse(await readFile(plain.path,'utf8')).from,'dev','a dev by default');
});
for(const args of[['ask','--ticket','XJ-690'],['ask','--ticket','XJ-690','--question','   '],['ask','--ticket','../x','--question','?'],['ask','--ticket','XJ-690','--question','?','--from','boss'],['ask','--ticket','XJ-690','--question','?','--commit','a'.repeat(40)],['ask','--ticket','XJ-690','--question','?','--option','x'.repeat(201)],['ask','--ticket','XJ-690','--question','x'.repeat(2001)],['ask','--ticket','XJ-690','--question','?',...Array.from({length:5},(_,n)=>['--option','o'+n]).flat()]])
test(`an invalid question is refused: ${args.slice(1,5).join(' ').slice(0,60)}`,async t=>{
  const f=await fixture(t),result=await f.run(args);assert.equal(result.ok,false);assert.equal(result.error.code,'INVALID_ARGUMENT');
});

test('questions written in the same millisecond are all kept',async t=>{
  const f=await fixture(t),all=await Promise.all(Array.from({length:16},(_,n)=>writeDevReport(['ask','--worktree',f.path,'--ticket','XJ-2','--question','Question '+n])));
  assert.equal(new Set(all.map(x=>x.path)).size,16);
  const read=await Promise.all(all.map(async x=>JSON.parse(await readFile(x.path,'utf8')).question));assert.equal(new Set(read).size,16);
  const rows=(await f.flow.reports({sessionId:'po'})).reports.filter(r=>r.kind==='ask');assert.equal(rows.length,16);
});

test('a directory that only belongs to its parent Git repo is not mistaken for a nested repository',async t=>{
  const f=await fixture(t);await mkdir(join(f.path,'not-a-repo'));const rootSha=await f.git(f.path,['rev-parse','HEAD']);
  const result=await f.run(['dev','--ticket','XJ-690','--commit',rootSha,'--repo','not-a-repo']);assert.equal(result.ok,false);assert.equal(result.error.code,'REPORT_REPOSITORY_NOT_FOUND');
});
test('a report larger than the reader limit is refused instead of silently disappearing from dev-reports',async t=>{
  const f=await fixture(t),notes=Array.from({length:40},()=>['--note','x'.repeat(2000)]).flat();
  const result=await f.run(['review','--ticket','XJ-690','--n','1','--commit',f.sha,'--repo','admin','--verdict','accepted',...notes]);
  assert.equal(result.ok,false);assert.equal(result.error.code,'INVALID_ARGUMENT');await assert.rejects(()=>stat(join(f.path,'.fabrique-console','XJ-690.review-1.json')),{code:'ENOENT'});
});

test('the result the Lead writes for a test it played is read with the time of its file; a bad one or a bad id is not',async t=>{
  const f=await fixture(t),dir=join(f.path,'.fabrique-console');await mkdir(join(dir,'played'),{recursive:true});
  await writeFile(join(dir,'qa.json'),JSON.stringify({verdict:'ok',summary:'s',tests:[{id:'1',title:'A'},{id:'2',title:'B'},{id:'../x',title:'C'}]}));
  await writeFile(join(dir,'played','1.json'),JSON.stringify({verdict:'ko',seen:'  Le champ est vide.  ',at:'1999-01-01'}));
  await writeFile(join(dir,'played','2.json'),JSON.stringify({verdict:'maybe',seen:'x'}));
  const {qa}=await f.flow.validation({sessionId:'po'}),[one,two,three]=qa.tests;
  assert.equal(one.played.verdict,'ko');assert.equal(one.played.seen,'Le champ est vide.');assert.notEqual(one.played.at,'1999-01-01','dated by the file');
  assert.equal(two.played,null);assert.equal(three.played,null);
});

test('a result read only from the played folder itself, never through a link to elsewhere',async t=>{
  const f=await fixture(t),dir=join(f.path,'.fabrique-console'),outside=join(f.path,'..','outside-'+process.pid+'-'+Date.now());
  await mkdir(dir,{recursive:true});await mkdir(outside,{recursive:true});t.after(()=>rm(outside,{recursive:true,force:true}));
  await writeFile(join(outside,'1.json'),JSON.stringify({verdict:'ok',seen:'ailleurs'}));await symlink(outside,join(dir,'played'));
  await writeFile(join(dir,'qa.json'),JSON.stringify({verdict:'ok',summary:'s',tests:[{id:'1',title:'A'}]}));
  assert.equal((await f.flow.validation({sessionId:'po'})).qa.tests[0].played,null);
});

test('a problem keeps the feedback of the user; a note without a problem, or too long, is refused',async t=>{
  const f=await fixture(t);
  const out=await f.flow.mark({sessionId:'po',step:'3',result:'ko',note:'  Le texte est coupé.  '});
  assert.equal(out.marks['3'].note,'Le texte est coupé.');
  assert.equal((await f.flow.mark({sessionId:'po',step:'4',result:'ko'})).marks['4'].note,undefined);
  for(const bad of [{result:'ok',note:'x'},{result:'ko',note:'x'.repeat(2001)},{result:'ko',note:7}])await assert.rejects(()=>f.flow.mark({sessionId:'po',step:'5',...bad}),e=>e.code==='INVALID_ARGUMENT');
});

// ---- M10: a dev that cannot go on says it, without any commit; the reports read it back as a stop, dated from the
// instant it was said.
test('a dev says its ticket stopped; the reports read it back as a block with its reason, its migration and its instant (M10)',async t=>{
  const f=await fixture(t),before=Date.now(),result=await f.run(['block','--ticket','XJ-690','--reason','La migration 0026 ne passe pas.','--migration','0026']);
  assert.equal(result.ok,true,JSON.stringify(result));assert.equal(result.kind,'block');assert.match(result.path,/\.fabrique-console\/XJ-690\.block-\d{13}\.json$/);
  const row=(await f.flow.reports({sessionId:'po'})).reports.find(r=>r.kind==='block');
  assert.deepEqual({ticket:row.ticket,reason:row.reason,migration:row.migration},{ticket:'XJ-690',reason:'La migration 0026 ne passe pas.',migration:'0026'});
  assert.ok(row.name.startsWith('XJ-690.block-'));assert.equal(row.path,result.path);
  assert.ok(Date.parse(row.at)>=before-1000&&Date.parse(row.at)<=Date.now(),'the instant it was said');
  const plain=await f.run(['block','--ticket','XJ-690','--reason','Le service de test ne répond pas.']);assert.equal(plain.ok,true);
  assert.equal((await f.flow.reports({sessionId:'po'})).reports.filter(r=>r.kind==='block').length,2,'two stops said are two files');
});
for(const args of[['block','--ticket','XJ-690'],['block','--ticket','XJ-690','--reason','  '],['block','--ticket','../x','--reason','x'],['block','--ticket','XJ-690','--reason','x','--migration','x'.repeat(41)],['block','--ticket','XJ-690','--reason','x'.repeat(2001)],['block','--ticket','XJ-690','--reason','x','--commit','a'.repeat(40)]])
test(`an invalid stop is refused: ${args.slice(1,5).join(' ').slice(0,60)} (M10)`,async t=>{
  const f=await fixture(t),result=await f.run(args);assert.equal(result.ok,false);assert.equal(result.error.code,'INVALID_ARGUMENT');
});
