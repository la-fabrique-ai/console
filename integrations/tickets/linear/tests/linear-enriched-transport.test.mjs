import test from 'node:test';
import assert from 'node:assert/strict';
let transportModule;
try{transportModule=await import('../linear-enriched-transport.mjs');}catch{}
const secret='fixture-arbitrary-private-value';
function transport(t,options={}){
  assert.equal(typeof transportModule?.EnrichedReadTransport,'function');
  const value=new transportModule.EnrichedReadTransport({token:secret,...options});t.after(()=>value.close());return value;
}
const json=(body,status=200,headers={})=>new Response(JSON.stringify(body),{status,headers});

test('the enriched transport sends only static allowlisted query operations to the fixed endpoint',async t=>{
  const calls=[],read=transport(t,{fetch:async(url,init)=>{calls.push({url,init});return json({data:{team:{id:'team'}}});}});
  assert.deepEqual(await read.request('projects',{teamId:'team',first:50,after:null}),{team:{id:'team'}});
  assert.equal(calls[0].url,'https://api.linear.app/graphql');assert.equal(calls[0].init.headers.Authorization,secret);
  const body=JSON.parse(calls[0].init.body);assert.match(body.query,/^query FabriqueConsoleV2Projects\b/);assert.doesNotMatch(body.query,/\b(?:mutation|subscription)\b/);
  await assert.rejects(read.request('query injected { viewer { id } }',{}),{code:'INVALID_ARGUMENT'});assert.equal(calls.length,1);
});

test('HTTP 400 GraphQL RATELIMITED retries after the indicated delay within one operation budget',async t=>{
  let time=0,calls=0;const delays=[];
  const read=transport(t,{now:()=>time,sleep:async ms=>{delays.push(ms);time+=ms;},fetch:async()=>++calls===1?json({errors:[{message:'private error',extensions:{code:'RATELIMITED'}}]},400,{'Retry-After':'2'}):json({data:{ok:true}})});
  assert.deepEqual(await read.request('projects',{}),{ok:true});assert.deepEqual(delays,[2000]);assert.equal(calls,2);
});

test('complexity refusal is classified without copying GraphQL errors or retrying the same expensive query',async t=>{
  let calls=0;const read=transport(t,{fetch:async()=>{calls++;return json({errors:[{message:'private diagnostic',extensions:{code:'QUERY_COMPLEXITY_LIMIT_EXCEEDED'}}]},400);}});
  await assert.rejects(read.request('projects',{}),error=>error.reason==='complexity-limit'&&!String(error).includes('private diagnostic'));assert.equal(calls,1);
});

test('rate reset headers beyond the remaining budget stop without sleeping or another request',async t=>{
  let calls=0,slept=false;const read=transport(t,{now:()=>1000,wallNow:()=>1000,sleep:async()=>{slept=true;},fetch:async()=>{calls++;return json({errors:[{extensions:{code:'RATELIMITED'}}]},400,{'X-RateLimit-Requests-Remaining':'0','X-RateLimit-Requests-Reset':'999999'});}});
  await assert.rejects(read.request('projects',{}),error=>error.reason==='rate-limit');assert.equal(calls,1);assert.equal(slept,false);
});

test('the budget includes reading a response body that never finishes and aborts the request',async t=>{
  let signal;const start=performance.now();
  const read=transport(t,{budgetMs:80,fetch:async(_url,init)=>{signal=init.signal;return new Response(new ReadableStream({start(){}}));}});
  await assert.rejects(read.request('projects',{}),error=>error.reason==='deadline');assert.ok(performance.now()-start<1000);assert.equal(signal.aborted,true);
});

test('a reflected arbitrary API key is refused before any response or error can expose it',async t=>{
  const read=transport(t,{fetch:async()=>json({data:{title:secret}})});
  await assert.rejects(read.request('projects',{}),error=>error.code==='LINEAR_SECRET_RESPONSE'&&!JSON.stringify(error).includes(secret)&&!error.message.includes(secret));
});

test('an oversized response is bounded and malformed GraphQL success is never treated as complete',async t=>{
  const read=transport(t,{maxBodyBytes:100,fetch:async()=>new Response('x'.repeat(101))});
  await assert.rejects(read.request('projects',{}),error=>error.reason==='response-too-large');
  const malformed=transport(t,{fetch:async()=>json({errors:[{message:'private diagnostic'}],data:{team:null}})});
  await assert.rejects(malformed.request('projects',{}),error=>error.reason==='api-error'&&!String(error).includes('private diagnostic'));
});

test('HTTP 429 without a JSON body remains a rate limit and never exceeds two retries',async t=>{
  let calls=0;const read=transport(t,{sleep:async()=>{},fetch:async()=>{calls++;return new Response('Too many requests',{status:429,headers:{'retry-after':'0'}});}});
  await assert.rejects(read.request('projects',{}),error=>error.reason==='rate-limit');assert.equal(calls,3);
});

test('a reflected credential is detected in decoded strings even when JSON escapes its characters',async t=>{
  const token='arbitrary-quote-"-credential',read=transport(t,{token,fetch:async()=>json({data:{title:token}})});
  await assert.rejects(read.request('projects',{}),error=>error.code==='LINEAR_SECRET_RESPONSE'&&!error.message.includes(token));
});
