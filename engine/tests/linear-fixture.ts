// Linear's public GraphQL API: https://linear.app/developers/filtering and /pagination.
// Each process gets synthetic credentials and a local replacement for its HTTP boundary.
import { randomUUID } from "node:crypto";
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert/strict";

if (!process.env.TEST_NO_KEY) process.env.LINEAR_API_KEY = " " + randomUUID() + " ";
globalThis.fetch = async (url, init) => {
  assert.equal(String(url), "https://api.linear.app/graphql");
  assert.equal(init?.method, "POST");
  assert.ok(new Headers(init.headers).get("Authorization") === process.env.LINEAR_API_KEY?.trim());
  const request = JSON.parse(String(init.body));
  appendFileSync(join(process.env.MISSION_CONTROL_HOME!, "linear-requests"), JSON.stringify(request) + "\n");
  switch (process.env.TEST_LINEAR_FAILURE) {
    case "unauthorized": return new Response(null, { status: 401 });
    case "network": throw new TypeError("fetch failed");
    case "http": return new Response(null, { status: 503 });
    case "graphql": return Response.json({ errors: [{ message: "Internal diagnostic" }] });
  }
  if (!request.query.includes("query Issues(")) return launchRequest(request.query, request.variables);
  const { query, variables: { filter, after } } = request;
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

interface Child { id: string; identifier: string; location?: string }
interface Tracker { children: Child[]; comments: { id: string }[] }

function launchRequest(query: string, variables: { parent?: string; key?: string; id?: string; after?: string; input?: Record<string, string> }) {
  const home = process.env.MISSION_CONTROL_HOME!;
  const file = join(home, "tracker.json");
  const tracker: Tracker = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : { children: [], comments: [] };
  const fault = process.env.TEST_LAUNCH_FAULT;
  if (query.includes("query LaunchParent(")) {
    if (fault === "after-commit") process.exit(73);
    assert.equal(variables.key, "DEMO-1");
    if (fault === "bad-read") return Response.json({ data: {} });
    return Response.json({ data: { issue: { id: "parent", identifier: fault === "other-parent" ? "DEMO-2" : "DEMO-1",
      team: { id: "team", key: fault === "other-team" ? "OTHER" : "DEMO" },
      ...(query.includes("archivedAt") && { archivedAt: fault === "archived" ? "yesterday" : null }),
      ...(query.includes("trashed") && { trashed: fault === "trashed" || null }),
      ...(query.includes("state { type }") && { state: { type: ["canceled", "completed"].includes(fault ?? "") ? fault : "started" } }),
    } } });
  }
  if (query.includes("query LaunchInventory(")) {
    assert.equal(variables.parent, "parent");
    const field = query.includes("children(") ? "children" : "comments";
    assert.ok(query.includes(field + "(first: 50, after: $after, includeArchived: true)"));
    const start = Number(variables.after ?? 0);
    if (fault === "bad-inventory") return Response.json({ data: { issue: null } });
    const entries = field === "children" ? tracker.children.filter(c => !c.location) : tracker.comments;
    const nodes = entries.slice(start, start + 1);
    const pageInfo = { hasNextPage: start + 1 < entries.length, endCursor: String(start + 1) };
    return Response.json({ data: { issue: { [field]: { nodes, pageInfo } } } });
  }
  if (query.includes("query LaunchChild(")) {
    assert.match(query, /issue\(id: \$id\)/);
    if (fault === "lookup-error") return Response.json({ errors: [{ message: "Unavailable" }] });
    const child = tracker.children.find(c => c.id === variables.id);
    return child ? Response.json({ data: { issue: child } }) :
      Response.json({ data: null, errors: [{ path: ["issue"], message: "Entity not found: Issue" }] }, { status: 400 });
  }
  if (fault === "reject-write") return new Response(null, { status: 422 });
  if (fault === "graphql-refusal") return Response.json({ errors: [{ extensions: { type: "invalid input" } }] });
  if (fault === "denied-create") return Response.json({ data: { issueCreate: { success: false } } });
  if (fault === "denied-comment" && query.includes("commentCreate(")) return Response.json({ data: { commentCreate: { success: false } } });
  if (fault === "before-write") return new Response(null, { status: 503 });
  const input = variables.input!;
  assert.match(input.id, /^[0-9a-f-]{36}$/);
  let data;
  if (query.includes("issueCreate(input: $input)")) {
    assert.equal(input.parentId, "parent"); assert.equal(input.teamId, "team");
    assert.equal(tracker.children.some(c => c.id === input.id), false);
    const issue = { id: input.id, identifier: "DEMO-" + (10 + tracker.children.length) };
    tracker.children.push(issue);
    data = { issueCreate: { success: true, issue: fault === "wrong-child" ? { ...issue, id: "wrong" } : issue } };
  } else {
    assert.ok(query.includes("commentCreate(input: $input)")); assert.equal(input.issueId, "parent");
    assert.equal(tracker.comments.some(c => c.id === input.id), false);
    const comment = { id: input.id };
    tracker.comments.push(comment);
    data = { commentCreate: { success: true, comment: fault === "wrong-comment" ? { id: "wrong" } : comment } };
  }
  writeFileSync(file, JSON.stringify(tracker));
  if ((fault === "after-two" && tracker.children.length === 2) || (fault === "after-comment" && data.commentCreate)) process.exit(73);
  if (fault === "lost-answer") throw new TypeError("response lost");
  return Response.json({ data });
}
