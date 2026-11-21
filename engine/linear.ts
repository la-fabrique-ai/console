import { CommandError, type IssueDetail, type IssueSummary } from "./contract.ts";

interface LinearIssue { identifier: string; title: string; state: { name: string } }
type Detail = LinearIssue & { description: string | null; url: string };
interface Page<I> { nodes: I[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } }

const readRejected = "Linear a rejeté la requête de lecture des tickets.";
const writeUnconfirmed = "Linear n’a pas confirmé l’écriture. Relancez le plan pour vérifier les tickets et le commentaire.";

async function request<T>(query: string, variables: object, message: string): Promise<T> {
  const key = process.env.LINEAR_API_KEY?.trim();
  if (!key) throw new CommandError("La clé d’accès à Linear est absente.", "linear_key_missing");
  const response = await fetch("https://api.linear.app/graphql", {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: key },
    body: JSON.stringify({ query, variables }),
  }).catch(() => { throw new CommandError(message === writeUnconfirmed ? message : "Impossible de joindre Linear."); });
  if (response.status === 401 || response.status === 403) throw new CommandError("Linear refuse l’accès avec cette clé.");
  if (!response.ok) throw new CommandError(message);
  const body = await response.json().catch(() => null);
  if (!body?.data || body.errors?.length) throw new CommandError(message);
  return body.data;
}

async function queryIssues<I>(teamKey: string, criteria: object, fields: string): Promise<I[]> {
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
    const { issues: page }: { issues: Page<I> } = await request(query, { filter, after }, readRejected);
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

interface Parent { id: string; teamId: string }
interface Child { id: string; identifier: string }

async function members<I>(parent: string, field: "children" | "comments"): Promise<I[]> {
  const fields = field === "children" ? "id identifier" : "id";
  const query = `query LaunchInventory($parent: String!, $after: String) {
    issue(id: $parent) { ${field}(first: 50, after: $after, includeArchived: true) {
      nodes { ${fields} } pageInfo { hasNextPage endCursor }
    } }
  }`;
  const nodes: I[] = [];
  let after: string | null = null;
  do {
    const data: { issue: Record<string, Page<I>> } = await request(query, { parent, after }, readRejected);
    const page: Page<I> = data.issue[field];
    nodes.push(...page.nodes);
    if (page.pageInfo.hasNextPage === false) break;
    if (!page.pageInfo.endCursor || page.pageInfo.endCursor === after) throw new CommandError(readRejected);
    after = page.pageInfo.endCursor;
  } while (after);
  return nodes;
}

export async function launchInventory(key: string, teamKey: string) {
  const { issue } = await request<{ issue: { id: string; identifier: string; team: { id: string; key: string } } }>(
    "query LaunchParent($key: String!) { issue(id: $key) { id identifier team { id key } } }", { key }, readRejected);
  if (!issue?.id || !issue.team?.id || issue.identifier !== key || issue.team.key !== teamKey) {
    throw new CommandError("Ticket introuvable dans Linear.");
  }
  const children = await members<Child>(issue.id, "children");
  const comments = await members<{ id: string }>(issue.id, "comments");
  if (children.some(c => !c.id || !c.identifier) || comments.some(c => !c.id)) throw new CommandError(readRejected);
  return { id: issue.id, teamId: issue.team.id, children: new Map(children.map(c => [c.id, c.identifier])),
    comments: new Set(comments.map(c => c.id)) };
}

export async function createSubTicket(parent: Parent, id: string, title: string, description: string) {
  const { issueCreate } = await request<{ issueCreate: { success: boolean; issue: Child } }>(
    `mutation CreateSubTicket($input: IssueCreateInput!) {
      issueCreate(input: $input) { success issue { id identifier } }
    }`, { input: { id, teamId: parent.teamId, parentId: parent.id, title, description } }, writeUnconfirmed);
  if (!issueCreate?.success || issueCreate.issue?.id !== id || !issueCreate.issue.identifier) throw new CommandError(writeUnconfirmed);
  return issueCreate.issue.identifier;
}

export async function addComment(issueId: string, id: string, body: string) {
  const { commentCreate } = await request<{ commentCreate: { success: boolean; comment: { id: string } } }>(
    `mutation AddComment($input: CommentCreateInput!) {
      commentCreate(input: $input) { success comment { id } }
    }`, { input: { id, issueId, body } }, writeUnconfirmed);
  if (!commentCreate?.success || commentCreate.comment?.id !== id) throw new CommandError(writeUnconfirmed);
}
