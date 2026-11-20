import { CommandError, type IssueDetail, type IssueSummary } from "./contract.ts";

interface LinearIssue { identifier: string; title: string; state: { name: string } }
type Detail = LinearIssue & { description: string | null; url: string };
interface Page<I> { nodes: I[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } }

async function queryIssues<I>(teamKey: string, criteria: object, fields: string): Promise<I[]> {
  const key = process.env.LINEAR_API_KEY?.trim();
  if (!key) throw new CommandError("La clé d’accès à Linear est absente.", "linear_key_missing");
  const filter = { team: { key: { eq: teamKey } }, ...criteria };
  const query = `query Issues($filter: IssueFilter!, $after: String) {
    issues(filter: $filter, first: 50, after: $after) {
      nodes { identifier title state { name } ${fields} }
      pageInfo { hasNextPage endCursor }
    }
  }`;
  const issues: I[] = [];
  let after: string | null = null;
  do {
    const response = await fetch("https://api.linear.app/graphql", {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: key },
      body: JSON.stringify({ query, variables: { filter, after } }),
    }).catch(() => { throw new CommandError("Impossible de joindre Linear."); });
    if (response.status === 401 || response.status === 403) throw new CommandError("Linear refuse l’accès avec cette clé.");
    const rejected = "Linear a rejeté la requête de lecture des tickets.";
    if (!response.ok) throw new CommandError(response.status === 400 ? rejected : "Linear n’a pas pu répondre à la demande.");
    const body: { data: { issues: Page<I> }; errors?: unknown[] } = await response.json();
    if (body.errors?.length) throw new CommandError(rejected);
    const page = body.data.issues;
    issues.push(...page.nodes);
    after = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
  } while (after);
  return issues;
}

function summary(issue: LinearIssue): IssueSummary {
  return { key: issue.identifier, title: issue.title, status: issue.state.name };
}

export async function openIssues(teamKey: string): Promise<IssueSummary[]> {
  const open = { state: { type: { nin: ["completed", "canceled", "duplicate"] } } };
  return (await queryIssues<LinearIssue>(teamKey, open, "")).map(summary);
}

export async function issueDetail(teamKey: string, number: number): Promise<IssueDetail> {
  const [issue] = await queryIssues<Detail>(teamKey, { number: { eq: number } }, "description url");
  if (!issue) throw new CommandError("Ticket introuvable dans Linear.");
  return { ...summary(issue), description: issue.description ?? "", url: issue.url };
}
