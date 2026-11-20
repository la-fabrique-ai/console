// Linear's public GraphQL API: https://linear.app/developers/filtering and /pagination.
// Each process gets synthetic credentials and a local replacement for its HTTP boundary.
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";

if (!process.env.TEST_NO_KEY) process.env.LINEAR_API_KEY = randomUUID();
globalThis.fetch = async (url, init) => {
  assert.equal(String(url), "https://api.linear.app/graphql");
  assert.equal(init?.method, "POST");
  assert.ok(new Headers(init.headers).get("Authorization") === process.env.LINEAR_API_KEY);
  const { query, variables: { filter, after } } = JSON.parse(String(init.body));
  assert.match(query, /issues\s*\([^)]*filter:\s*\$filter/);
  assert.equal(filter.team.key.eq, "DEMO");
  const issues = [
    { number: 1, title: "First issue", type: "started" },
    { number: 2, title: "Second issue", type: "triage" },
    { number: 3, title: "Closed", type: "completed" },
    { number: 4, title: "Canceled", type: "canceled" },
    { number: 5, title: "Duplicate", type: "duplicate" },
  ].filter(i => !filter.state?.type.nin.includes(i.type) && (!filter.number || filter.number.eq === i.number));
  const index = Number(after ?? 0);
  const nodes = issues.slice(index, index + 1).map(i => ({
    identifier: "DEMO-" + i.number, title: i.title, state: { name: "À examiner" },
    description: "**Texte original**", url: "https://example.org/ticket/" + i.number,
  }));
  return Response.json({ data: { issues: { nodes, pageInfo: {
    hasNextPage: index + 1 < issues.length, endCursor: String(index + 1),
  } } } });
};
