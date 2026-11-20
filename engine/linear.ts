import type { IssueDetail, IssueSummary } from "./contract.ts";

interface LinearIssue {
  identifier: string;
  title: string;
  state: { name: string };
  description?: string | null;
  url?: string;
}
interface Page {
  nodes: LinearIssue[];
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
}

async function queryIssues(teamKey: string, number?: number): Promise<LinearIssue[]> {
  const filter = {
    team: { key: { eq: teamKey } },
    ...(number === undefined ? { state: { type: { nin: ["completed", "canceled", "duplicate"] } } } : { number: { eq: number } }),
  };
  const query = `query Issues($filter: IssueFilter!, $after: String) {
    issues(filter: $filter, first: 50, after: $after) {
      nodes { identifier title state { name } ${number === undefined ? "" : "description url"} }
      pageInfo { hasNextPage endCursor }
    }
  }`;
  const issues: LinearIssue[] = [];
  const cursors = new Set<string>();
  let after: string | null = null;
  for (;;) {
    const response = await fetch("https://api.linear.app/graphql", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: process.env.LINEAR_API_KEY! },
      body: JSON.stringify({ query, variables: { filter, after } }),
      redirect: "error",
    });
    if (!response.ok) throw new Error("Linear HTTP error");
    const body = await response.json();
    if (body.errors?.length) throw new Error("Linear query failed");
    const page: Page = body.data.issues;
    issues.push(...page.nodes);
    if (!page.pageInfo.hasNextPage) return issues;
    after = page.pageInfo.endCursor;
    if (!after || cursors.has(after)) throw new Error("Invalid Linear cursor");
    cursors.add(after);
  }
}

function summary(issue: LinearIssue): IssueSummary {
  if (typeof issue.identifier !== "string" || typeof issue.title !== "string" || typeof issue.state.name !== "string") {
    throw new Error("Incomplete Linear issue");
  }
  return { key: issue.identifier, title: issue.title, status: issue.state.name };
}

export async function openIssues(teamKey: string): Promise<IssueSummary[]> {
  return (await queryIssues(teamKey)).map(summary);
}

export function issueNumber(key: unknown, teamKey: string): number | undefined {
  if (typeof key !== "string") return;
  const parts = /^([A-Z0-9]+)-([1-9][0-9]*)$/.exec(key);
  if (parts?.[1] === teamKey && Number.isSafeInteger(Number(parts[2]))) return Number(parts[2]);
}

export async function issueDetail(teamKey: string, number: number): Promise<IssueDetail | undefined> {
  const [issue] = await queryIssues(teamKey, number);
  if (!issue) return;
  if (issue.identifier !== teamKey + "-" + number || typeof issue.url !== "string" ||
      !(issue.description === null || typeof issue.description === "string")) throw new Error("Invalid Linear detail");
  return { ...summary(issue), description: issue.description ?? "", url: issue.url };
}
