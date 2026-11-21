import { CommandError, type IssueDetail, type IssueSummary } from "./contract.ts";

interface LinearIssue { identifier: string; title: string; state: { name: string } }
type Detail = LinearIssue & { description: string | null; url: string };
interface Page<I> { nodes: I[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } }

const readRejected = "Linear a rejeté la requête de lecture des tickets.";
const writeUnconfirmed = "Linear n’a pas confirmé l’écriture. Relancez le plan pour vérifier les tickets et le commentaire.";

const parentReadFailed = "Impossible de lire le ticket principal dans Linear.";
const childReadFailed = "Impossible de vérifier le sous-ticket dans Linear.";
const writeRefused = "Linear a refusé l’écriture.";

async function request<T>(query: string, variables: object, message: string): Promise<T> {
  const key = process.env.LINEAR_API_KEY?.trim();
  if (!key) throw new CommandError("La clé d’accès à Linear est absente.", "linear_key_missing");
  const response = await fetch("https://api.linear.app/graphql", {
    signal: AbortSignal.timeout(30_000), method: "POST", headers: { "Content-Type": "application/json", Authorization: key },
    body: JSON.stringify({ query, variables }),
  }).catch(() => { throw new CommandError(message === writeUnconfirmed ? message : "Impossible de joindre Linear."); });
  if (response.status === 401 || response.status === 403) throw new CommandError("Linear refuse l’accès avec cette clé.");
  const body = await response.json().catch(() => null);
  const errors = body?.errors;
  if (!response.ok || !body?.data || errors?.length) {
    const definite = (response.status >= 400 && response.status < 500 && response.status !== 408) ||
      (Array.isArray(errors) && errors.some(e => e?.extensions?.type === "invalid input"));
    throw new CommandError(message === writeUnconfirmed && definite ? writeRefused : message);
  }
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
  const open = { state: { type: { nin: ["completed", "canceled"] } } };
  return (await queryIssues<LinearIssue>(teamKey, open, "")).map(summary);
}

export async function issueDetail(teamKey: string, number: number): Promise<IssueDetail> {
  const [issue] = await queryIssues<Detail>(teamKey, { number: { eq: number } }, "description url");
  if (!issue) throw new CommandError("Ticket introuvable dans Linear.");
  return { ...summary(issue), description: issue.description ?? "", url: issue.url };
}

interface Parent { id: string; teamId: string }
interface Child { id: string; identifier: string }

function nextCursor(page: Page<unknown>["pageInfo"], seen: Set<string>, failure: string) {
  if (!page.hasNextPage) return null;
  const cursor = page.endCursor;
  if (typeof cursor !== "string" || !cursor || seen.has(cursor)) throw new CommandError(failure);
  seen.add(cursor);
  return cursor;
}

async function members<I>(parent: string, field: "children" | "comments"): Promise<I[]> {
  const fields = field === "children" ? "id identifier" : "id";
  const query = `query LaunchInventory($parent: String!, $after: String) {
    issue(id: $parent) { ${field}(first: 50, after: $after, includeArchived: true) {
      nodes { ${fields} } pageInfo { hasNextPage endCursor }
    } }
  }`;
  const nodes: I[] = [];
  const seen = new Set<string>();
  let after: string | null = null;
  do {
    const data: { issue?: Record<string, Page<I>> } = await request(query, { parent, after }, parentReadFailed);
    const page: Page<I> | undefined = data.issue?.[field];
    if (!Array.isArray(page?.nodes) || typeof page.pageInfo?.hasNextPage !== "boolean") throw new CommandError(parentReadFailed);
    nodes.push(...page.nodes);
    after = nextCursor(page.pageInfo, seen, parentReadFailed);
  } while (after);
  return nodes;
}

async function lookupMissingChildren(savedIds: string[], keys: Map<string, string>) {
  const ids = savedIds.filter(id => !keys.has(id));
  if (!ids.length) return;
  const query = `query LaunchChildren($ids: [ID!]!, $after: String) {
    issues(filter: { id: { in: $ids } }, includeArchived: true, first: 50, after: $after) {
      nodes { id identifier } pageInfo { hasNextPage endCursor }
    }
  }`;
  const seen = new Set<string>();
  let after: string | null = null;
  do {
    const { issues }: { issues: Page<Child> } = await request(query, { ids, after }, childReadFailed);
    if (!Array.isArray(issues?.nodes) || typeof issues.pageInfo?.hasNextPage !== "boolean") throw new CommandError(childReadFailed);
    for (const child of issues.nodes) {
      if (!ids.includes(child?.id) || typeof child.identifier !== "string" || !child.identifier) throw new CommandError(childReadFailed);
      keys.set(child.id, child.identifier);
    }
    after = nextCursor(issues.pageInfo, seen, childReadFailed);
  } while (after);
}

export async function launchInventory(key: string, teamKey: string, savedIds: string[]) {
  type MainIssue = Child & { team: { id: string; key: string }; archivedAt: string | null; trashed: boolean | null; state: { type: string } };
  const { issue } = await request<{ issue: MainIssue }>(
    "query LaunchParent($key: String!) { issue(id: $key) { id identifier team { id key } archivedAt trashed state { type } } }",
    { key }, parentReadFailed);
  if (!issue?.id || !issue.identifier || !issue.team?.id || !issue.team.key || !issue.state?.type ||
      issue.archivedAt === undefined || issue.trashed === undefined) throw new CommandError(parentReadFailed);
  if (issue.identifier !== key || issue.team.key !== teamKey) throw new CommandError("Ticket introuvable dans Linear.");
  if (issue.archivedAt || issue.trashed || ["canceled", "completed"].includes(issue.state.type)) {
    throw new CommandError("Le ticket principal n’est plus ouvert dans Linear.");
  }
  const children = await members<Child>(issue.id, "children");
  const comments = await members<{ id: string }>(issue.id, "comments");
  if (children.some(c => !c?.id || !c.identifier) || comments.some(c => !c?.id)) throw new CommandError(parentReadFailed);
  const keys = new Map(children.map(c => [c.id, c.identifier]));
  await lookupMissingChildren(savedIds, keys);
  return { id: issue.id, teamId: issue.team.id, children: keys, comments: new Set(comments.map(c => c.id)) };
}

export async function createSubTicket(parent: Parent, id: string, title: string, description: string) {
  const { issueCreate } = await request<{ issueCreate: { success: boolean; issue: Child } }>(
    `mutation CreateSubTicket($input: IssueCreateInput!) {
      issueCreate(input: $input) { success issue { id identifier } }
    }`, { input: { id, teamId: parent.teamId, parentId: parent.id, title, description } }, writeUnconfirmed);
  if (issueCreate?.success === false) throw new CommandError(writeRefused);
  if (!issueCreate?.success || issueCreate.issue?.id !== id || !issueCreate.issue.identifier) throw new CommandError(writeUnconfirmed);
  return issueCreate.issue.identifier;
}

export async function addComment(issueId: string, id: string, body: string) {
  const { commentCreate } = await request<{ commentCreate: { success: boolean; comment: { id: string } } }>(
    `mutation AddComment($input: CommentCreateInput!) {
      commentCreate(input: $input) { success comment { id } }
    }`, { input: { id, issueId, body } }, writeUnconfirmed);
  if (commentCreate?.success === false) throw new CommandError(writeRefused);
  if (!commentCreate?.success || commentCreate.comment?.id !== id) throw new CommandError(writeUnconfirmed);
}
