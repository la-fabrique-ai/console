// Official Linear schema: packages/sdk/src/schema.graphql in linear/linear.
// Root pages are 50, nested seeds only 3; continuations contain ONE connection.
const page='pageInfo { hasNextPage endCursor }';
const state='id name type';
const related=`id identifier archivedAt state { ${state} } team { id }`;
const relation=`id type issue { ${related} } relatedIssue { ${related} }`;
const label='id name';
const milestone='id name description progress status targetDate createdAt updatedAt';
const document='id title createdAt updatedAt url';
const issue=`id identifier title description url updatedAt archivedAt estimate
  state { ${state} } team { id } project { id }
  parent { ${related} } projectMilestone { id name targetDate }
  labels(first:3,includeArchived:false) { nodes { ${label} } ${page} }
  children(first:3,includeArchived:false) { nodes { ${related} } ${page} }
  relations(first:3,includeArchived:false) { nodes { ${relation} } ${page} }
  inverseRelations(first:3,includeArchived:false) { nodes { ${relation} } ${page} }`;
const project=`id name url progress startDate targetDate createdAt updatedAt status { ${state} }
  projectMilestones(first:3,includeArchived:false) { nodes { ${milestone} } ${page} }
  documents(first:3,includeArchived:false) { nodes { ${document} } ${page} }`;
export const READ_QUERIES=Object.freeze({
  projects:`query FabriqueConsoleV2Projects($teamId:String!,$first:Int!,$after:String) { team(id:$teamId) { id projects(first:$first,after:$after,includeArchived:false,includeSubTeams:false) { nodes { ${project} } ${page} } } }`,
  projectScope:`query FabriqueConsoleV2ProjectScope($id:String!,$first:Int!,$after:String) { project(id:$id) { id teams(first:$first,after:$after) { nodes { id } ${page} } } }`,
  milestones:`query FabriqueConsoleV2Milestones($id:String!,$first:Int!,$after:String) { project(id:$id) { id projectMilestones(first:$first,after:$after,includeArchived:false) { nodes { ${milestone} } ${page} } } }`,
  documents:`query FabriqueConsoleV2Documents($id:String!,$first:Int!,$after:String) { project(id:$id) { id documents(first:$first,after:$after,includeArchived:false) { nodes { ${document} } ${page} } } }`,
  issues:`query FabriqueConsoleV2Issues($filter:IssueFilter!,$first:Int!,$after:String) { issues(filter:$filter,first:$first,after:$after,includeArchived:false) { nodes { ${issue} } ${page} } }`,
  issueScope:`query FabriqueConsoleV2IssueScope($id:String!) { issue(id:$id) { id archivedAt team { id } } }`,
  issue:`query FabriqueConsoleV2Issue($id:String!) { issue(id:$id) { ${issue} } }`,
  labels:`query FabriqueConsoleV2Labels($id:String!,$first:Int!,$after:String) { issue(id:$id) { id labels(first:$first,after:$after,includeArchived:false) { nodes { ${label} } ${page} } } }`,
  children:`query FabriqueConsoleV2Children($id:String!,$first:Int!,$after:String) { issue(id:$id) { id children(first:$first,after:$after,includeArchived:false) { nodes { ${related} } ${page} } } }`,
  relations:`query FabriqueConsoleV2Relations($id:String!,$first:Int!,$after:String) { issue(id:$id) { id relations(first:$first,after:$after,includeArchived:false) { nodes { ${relation} } ${page} } } }`,
  inverseRelations:`query FabriqueConsoleV2InverseRelations($id:String!,$first:Int!,$after:String) { issue(id:$id) { id inverseRelations(first:$first,after:$after,includeArchived:false) { nodes { ${relation} } ${page} } } }`,
  states:`query FabriqueConsoleV2States($teamId:String!,$first:Int!,$after:String) { team(id:$teamId) { id states(first:$first,after:$after,includeArchived:false) { nodes { ${state} } ${page} } } }`,
  documentScope:`query FabriqueConsoleV2DocumentScope($id:String!) { document(id:$id) { id archivedAt project { id } } }`,
  document:`query FabriqueConsoleV2Document($id:String!) { document(id:$id) { ${document} content archivedAt project { id } } }`,
});
