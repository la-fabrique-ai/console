import test from 'node:test';
import assert from 'node:assert/strict';
import { issueOrder } from '../mods/fabrique-console-v4-bar/nav.js';

// The issues of a project: by status (in progress, to do, triage, backlog, done, canceled), then the most recent first.
test('issues are ordered by status, then from the most recent to the oldest', ()=>{
  const row=(id,type,createdAt)=>({issue:{identifier:id,state:type?{type}:null,createdAt}});
  const rows=[row('A','backlog','2026-11-01T10:00:00Z'),row('B','started','2026-10-01T10:00:00Z'),row('C','completed','2026-11-10T10:00:00Z'),row('D','started','2026-11-05T10:00:00Z'),
    row('E','unstarted','2026-11-02T10:00:00Z'),row('F','canceled','2026-11-11T10:00:00Z'),row('G','triage','2026-11-03T10:00:00Z'),row('H','backlog','2026-11-09T10:00:00Z'),row('I',null,'2026-11-11T10:00:00Z'),row('J','backlog',null)];
  assert.deepEqual(issueOrder(rows).map(r=>r.issue.identifier),['D','B','E','G','H','A','J','C','F','I'],'an unknown status last, an unknown date last of its status');
  assert.deepEqual(rows.map(r=>r.issue.identifier).join(''),'ABCDEFGHIJ','the list given is left as it is');
  assert.deepEqual(issueOrder(null),[]);
});
