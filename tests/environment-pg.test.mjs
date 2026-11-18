// M6 (a), family 3 (read only) at the level of the connection: the client of the check speaks to PostgreSQL itself, on
// 127.0.0.1 only, in default_transaction_read_only=on, with a random application_name; only the trust method is
// accepted (decision 93, point 2), any other is DB_AUTH_UNSUPPORTED without reading a secret; parameters are sent apart
// from the text of the query. Against a fake engine on loopback: never a real base.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { pgConnect } from '../src/environment-pg.mjs';
import { fakePostgres } from './helpers/environment-fakes.mjs';

test('the connection asks read only and a given application_name; parameters go apart from the query',async t=>{
  const pg=await fakePostgres({handler:(sql,params)=>sql.includes('$1')?[[params[0]==='x\' OR 1=1 --'?'0':'9']]:[['on']]});t.after(pg.close);
  const db=await pgConnect({port:pg.port,user:'postgres',database:'beta',applicationName:'mc-env-0123456789abcdef01234567'});
  assert.deepEqual(await db.query("SELECT current_setting('default_transaction_read_only')"),[['on']]);
  assert.deepEqual(await db.query('SELECT count(*)::text FROM "public"."user" WHERE "email" = $1',["x' OR 1=1 --"]),[['0']]);
  await db.close();
  assert.equal(pg.startups.length,1);
  assert.equal(pg.startups[0].options,'-c default_transaction_read_only=on');
  assert.equal(pg.startups[0].application_name,'mc-env-0123456789abcdef01234567');
  assert.equal(pg.startups[0].user,'postgres');assert.equal(pg.startups[0].database,'beta');
  assert.ok(pg.queries.every(q=>!q.simple),'only the extended protocol');
  assert.deepEqual(pg.queries[1].params,["x' OR 1=1 --"]);
});

for(const auth of ['md5','password','scram'])test(`a server that asks a password (${auth}) is DB_AUTH_UNSUPPORTED, nothing sent`,async t=>{
  const pg=await fakePostgres({auth});t.after(pg.close);
  await assert.rejects(pgConnect({port:pg.port,user:'postgres',database:'beta',applicationName:'mc-env-aa'}),e=>e.pg==='auth');
});

test('a missing base, a refused connection, an error: a word, never the text of the server',async t=>{
  const canary='CANARY-pg-7f3a';
  const pg=await fakePostgres({auth:'no-database',canary});t.after(pg.close);
  await assert.rejects(pgConnect({port:pg.port,user:'postgres',database:'beta',applicationName:'mc-env-aa'}),e=>e.pg==='sql'&&e.sqlstate==='3D000'&&!String(e.message).includes(canary));
  const closed=await fakePostgres();const port=closed.port;await closed.close();
  await assert.rejects(pgConnect({port,user:'postgres',database:'beta',applicationName:'mc-env-aa'}),e=>e.pg==='refused');
  const failing=await fakePostgres({canary,handler:()=>({error:{code:'42P01',message:'relation does not exist'}})});t.after(failing.close);
  const db=await pgConnect({port:failing.port,user:'postgres',database:'beta',applicationName:'mc-env-aa'});
  await assert.rejects(db.query('SELECT 1'),e=>e.pg==='sql'&&e.sqlstate==='42P01'&&!String(e.message).includes(canary));
  await db.close();
});

test('only 127.0.0.1: another host is refused before any connection',async()=>{
  await assert.rejects(pgConnect({host:'192.0.2.1',port:5432,user:'postgres',database:'beta',applicationName:'mc-env-aa'}),e=>e.pg==='host');
  await assert.rejects(pgConnect({host:'localhost',port:5432,user:'postgres',database:'beta',applicationName:'mc-env-aa'}),e=>e.pg==='host');
});

test('a connection cut during a query: the query fails at once and its timer is cancelled, the process does not wait for it (review 2, m7)',()=>{
  // In a child process: a fake engine that trusts, then drops the connection at the first query. The child must
  // exit as soon as the query has failed and the server is closed, not after the 8 s timer of the query.
  const module=new URL('../src/environment-pg.mjs',import.meta.url).href;
  const script=`import {createServer} from 'node:net';import {pgConnect} from ${JSON.stringify(module)};
const i32=n=>{const b=Buffer.alloc(4);b.writeInt32BE(n);return b;};const m=(t,b)=>Buffer.concat([Buffer.from(t),i32(b.length+4),b]);
const server=createServer(s=>{let started=false;s.on('error',()=>{});s.on('data',()=>{if(!started){started=true;s.write(Buffer.concat([m('R',i32(0)),m('Z',Buffer.from('I'))]));}else s.destroy();});});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const db=await pgConnect({port:server.address().port,user:'postgres',database:'beta',applicationName:'mc-env-aa'});
const t0=Date.now();const out=await db.query('SELECT 1').then(()=>'resolved',e=>e.pg);
server.close();console.log(out+' '+(Date.now()-t0));`;
  const started=Date.now();
  const run=spawnSync(process.execPath,['--input-type=module','-e',script],{encoding:'utf8',timeout:20000});
  const elapsed=Date.now()-started;
  assert.equal(run.status,0,run.stderr);
  assert.match(run.stdout.trim(),/^closed \d+$/);
  assert.ok(elapsed<4000,'the child waited '+elapsed+' ms: the timer of the query outlived the connection');
});
