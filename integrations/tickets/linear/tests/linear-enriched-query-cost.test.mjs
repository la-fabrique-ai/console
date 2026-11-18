import test from 'node:test';
import assert from 'node:assert/strict';
import { READ_QUERIES } from '../linear-enriched-queries.mjs';
import { queryCost } from '../../../../tests/helpers/query-cost.mjs';

test('all allowlisted queries have explicit bounded pagination and remain under Tracker maximum complexity',()=>{
  for(const [name,query] of Object.entries(READ_QUERIES)){
    assert.match(query,/^query FabriqueConsoleV2\w+/);assert.doesNotMatch(query,/\b(mutation|subscription)\b/);
    assert.ok(queryCost(query)<10000,name+' exceeds complexity maximum');
  }
  assert.throws(()=>queryCost(READ_QUERIES.issues.replace('labels(first:3','labels(first:50')),/nested/);
});
