import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {LinearClient} from '../linear.mjs';

test('the ticket list read with the API key carries the labels the screens count on',async t=>{
  const root=await mkdtemp(join(tmpdir(),'fabrique-console-tracker-labels-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const queries=[];
  const fetch=async(_url,options)=>{
    const {query}=JSON.parse(options.body);queries.push(query);
    return {status:200,ok:true,headers:{get:()=>null},json:async()=>({data:{issues:{nodes:[{id:'i1',identifier:'XJ-1',labels:{nodes:[{id:'l1',name:'Bug'}],pageInfo:{hasNextPage:false}}},{id:'i2',identifier:'XJ-2',labels:{nodes:[{id:'l2',name:'x'}],pageInfo:{hasNextPage:true}}}],pageInfo:{hasNextPage:false,endCursor:null}}}})};
  };
  const client=new LinearClient({root,provider:{getToken:async()=>'synthetic'},fetch});
  const {issues}=await client.list({});
  assert.ok(queries.some(query=>query.includes('FabriqueConsoleIssues')&&/labels\(first:\d+\)\{nodes\{id name color\} pageInfo\{hasNextPage\}\}/.test(query)));
  assert.deepEqual(issues[0].labels,[{id:'l1',name:'Bug'}]);
  // A ticket with more labels than were read says so.
  assert.deepEqual(issues.map(i=>i.labelsComplete),[true,false]);
});
