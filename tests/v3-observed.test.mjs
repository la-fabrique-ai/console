import test from 'node:test';
import assert from 'node:assert/strict';
import { observedCards, bucket } from '../ui/v3/observed.js';

test('unreported live program is unknown rather than working', () => {
 const [card] = observedCards([{id:'s', terminalId:'t1',status:'working'}],[{address:'t1',state:'live',status:null}],[]);
 assert.equal(card.status,'unknown');
 assert.equal(bucket(card.status),'unknown');
});
test('disappeared session remains historical and cannot be mistaken for done', () => {
 const [card] = observedCards([{id:'s',terminalId:'t1',status:'historical'}],[],[]);
 assert.equal(card.status,'historical');
});
test('program status error, blocked and done have separate columns', () => {
 assert.equal(bucket('error'),'error');assert.equal(bucket('blocked'),'blocked');assert.equal(bucket('done'),'done');
});
test('all live core agents appear once; unknown tools are not assigned a model', () => {
 const cards=observedCards([{id:'s',terminalId:'t1'}],[{address:'t1',state:'live',status:'working',labels:{'fabrique-console.session':'s','fabrique-console.app':'fabrique-console'}},{address:'t2',state:'live',status:'blocked'}],[]);
 assert.equal(cards.length,2);assert.equal(cards[1].status,'blocked');assert.equal(cards[1].model,null);
});
test('reused core address cannot impersonate an owned session',()=>{
 const [c]=observedCards([{id:'old',terminalId:'t1',status:'historical'}],[{address:'t1',state:'live',status:'working',labels:{'fabrique-console.session':'other','fabrique-console.app':'fabrique-console'}}],[]);
 assert.equal(c.status,'historical');assert.equal(c.liveVerified,false);
});
test('reported false cannot turn stale status into verified activity',()=>{
 const [c]=observedCards([{id:'s',terminalId:'t1'}],[{address:'t1',state:'live',status:'working',reported:false,labels:{'fabrique-console.session':'s','fabrique-console.app':'fabrique-console'}}],[]);
 assert.equal(c.status,'unknown');
});
