import test from 'node:test';
import assert from 'node:assert/strict';
import { enrichedFixture,connection,ticket,reference } from './helpers/enriched-fixture.mjs';
import { assertInterfaceShape } from '../../../../tests/helpers/interface-shape.mjs';

test('an archived parent is an explicit partial omission rather than an issue presented as parentless',async t=>{
  const parent={...reference('old-parent','outside'),archivedAt:'2026-01-01T00:00:00Z',title:'Excluded archived text'};
  const f=await enrichedFixture(t,{handler:op=>op==='Issues'?{issues:connection([ticket('one',{parent})])}:undefined});
  const result=await f.read(),issue=result.data.issues.items[0];
  assert.equal(result.status,'partial');assert.equal(result.data.issues.total,null);assert.equal(issue.parent,null);assert.equal(issue.complete,false);
  assert.ok(result.partialReasons.some(item=>item.path==='issues[0].parent'&&item.reason==='archived-excluded'));
  assert.doesNotMatch(JSON.stringify(result),/old-parent|Excluded archived text/);assertInterfaceShape('EnrichedIssues',result);
  const noParent=await enrichedFixture(t),complete=await noParent.read();assert.equal(complete.status,'complete');assert.equal(complete.data.issues.items[0].parent,null);
});
