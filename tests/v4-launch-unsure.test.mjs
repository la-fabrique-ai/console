import test from 'node:test';
import assert from 'node:assert/strict';
import {pageBand} from '../mods/fabrique-console-v4-ticket/page.js';
import {launchState,launchOffered,launchUnsure} from '../mods/fabrique-console-v4-ticket/nav.js';
import {launchState as devsLaunchState} from '../mods/fabrique-console-v4-devs/nav.js';

// Decision 72: a launch whose fate is not known is said in the grey banner of the pause (« Checking the launch… »),
// with no button; the approval is not offered again meanwhile; the banner goes once the tool knows whether the dev left.
const T0=Date.parse('2026-11-14T10:00:00Z'),ago=s=>new Date(T0-s*1000).toISOString();
const ticket=(id,n)=>({id,n,state:'todo',title:'Titre '+id,dev:'claude',model:'claude-opus-5-5',effort:'high',deps:[]});
const mission=(launch,more={})=>({id:'M-1',project:'beta',step:'analysing',issue:{identifier:'PRB-41'},tickets:[ticket('PRB-142',1),ticket('PRB-144',2)],lead:{sessionId:'s1'},approval:{at:ago(600)},...(launch?{launch}:{}),...more});
const IDLE={address:'t1',status:'idle'},WORKING={address:'t1',status:'working'};
const band=(m,lead=IDLE,more={})=>pageBand({mission:m,lead,now:T0,...more}),said=b=>[b.tone,b.icon,b.big,b.det];
const UNSURE=['off','–','Checking the launch…','The launch is not confirmed. Nothing for you to do.'];

test('a launch said unknown: the grey banner, its two lines, no button, whatever the Lead does',()=>{
  for(const lead of [IDLE,WORKING,null]) {
    const b=band(mission({state:'unknown',at:ago(300),saidAt:ago(290)}),lead);
    assert.deepEqual(said(b),UNSURE,JSON.stringify(lead));assert.equal(b.button,undefined);assert.equal(b.second,undefined);
  }
});
test('a launch left « asking » by a stop midway is unknown once the send could no longer be running; a click in flight is not',()=>{
  assert.deepEqual(said(band(mission({state:'asking',at:ago(120)}))),UNSURE);
  assert.notDeepEqual(said(band(mission({state:'asking',at:ago(5)}))),UNSURE,'the click being sent');
});
test('the approval is not offered again while the launch is unknown, on this page or on the Development screen',()=>{
  const m=mission({state:'unknown',at:ago(300)});
  assert.equal(launchUnsure(m,T0),true);
  assert.equal(launchState(m,IDLE,T0),null);assert.equal(launchOffered(launchState(m,IDLE,T0),IDLE),false);
  assert.equal(devsLaunchState(m,IDLE,T0),null);
});
test('the banner goes once the tool knows: the dev left (Develop), or it did not (failed: the approval may be asked again)',()=>{
  assert.notDeepEqual(said(band(mission({state:'unknown',at:ago(300)},{step:'building',tickets:[{...ticket('PRB-142',1),state:'dev'},ticket('PRB-144',2)]}))),UNSURE);
  const failed=band(mission({state:'failed',at:ago(900),saidAt:ago(899)}));
  assert.equal(failed.tone,'ok');assert.equal(failed.button?.key,'approve');
  assert.equal(launchUnsure(mission({state:'asked',at:ago(300)}),T0),false);
  assert.equal(launchUnsure(mission(null),T0),false);
});
test('a request that waits on the user still comes first: it asks something of him, the check does not',()=>{
  const ask={id:'I-1',type:'decision',state:'pending',mission:'M-1',ticket:null,title:'Une question ?'};
  assert.equal(band(mission({state:'unknown',at:ago(300)}),IDLE,{items:[ask]}).tone,'you');
});
