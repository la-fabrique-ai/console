# Ticket connector (read contract)

`createTicketFactory({root, exec, loadConfig, injectedTickets?, ...})` is the sole
production entry point for provider code. It returns `getTickets()` and the
existing write dispatcher. The backend injects that getter into readers,
workspace plans and missions; the watcher uses the same backend. A fully formed
connector can be injected as `injectedTickets`; transport doubles use
`injectedTransport`. Adapter unit tests may import adapter internals.

The connector exposes these asynchronous methods:

- `configured(): boolean` checks the selected connection, without opening login.
- `list({scope, filter, cursor, include, refresh})` returns `tickets`, `complete`,
  `cursor`, and `freshness: {observedAt, cached}`. `scope.id` is an opaque scope ID;
  `scope.key` is the configured local project key. Filters currently support
  `search`, `projectId`, `priority`, `stateId`, `mine`, and `backlog` (tickets
  without a project, in backlog). A null scope means all accessible tickets.
- `detail(id, {scope, include, refresh})` returns `ticket`, the same observation
  fields, and collection evidence for comments, labels and children.
- `meta({refresh})` returns `scopes`, projects, states, capabilities and observation
  fields. Capabilities describe implemented reads; they do not prove credentials
  are available. `configured()` covers the base transport; enrichment reports its
  own `available` and `status`, including unavailable credentials.
- `mutate(payload)` retains the previous payload and behavior, through the same
  connector. Existing create and cache invalidation operations remain available
  to the unchanged write dispatcher. Authorization and journals are unchanged;
  the generic write contract belongs to lot E.

IDs must never be parsed, rewritten, or inferred from display identifiers.
Ticket references are `{connection, id}`. Each ticket has
`status: {id, label, category}`; category is one of
`backlog/ready/active/done/canceled/unknown`. Labels always retain the source's
real wording. Tickets and enriched content are marked `untrusted`.

A complete collection means every page was read, not that every nested relation
is complete. Nested collections have their own evidence. Unknown items are
`null`, unknown timestamps are `null`, and unverified completeness is `false`.
Legacy arrays and fields (`issues`, `issue`, raw `state`, relation coverage,
`updatedAt`, `cached`) are retained so existing screens lose no information.
They are compatibility fields, not a second provider access path.

Enriched inclusions use the same connector:

- `list({scope, include:['projects']})` reads projects with documents and milestones.
- `list({scope, filter:{projectId}, include:['enriched']})` reads enriched tickets.
- `detail(id, {scope, include:['enriched']})` reads an enriched ticket.
- `detail(id, {scope, projectId, include:['document']})` reads document content.

These return the existing `status/available/data/partialReasons/limits/usage`
envelope as well as normalized observation fields. Nested collection freshness
inherits the envelope observation. Internal `readOptions` allows the mission
reader to carry its remaining time budget; it is not accepted from CLI inputs.
Collections report continuation evidence, but this first connector reads all
pages internally within its limits. A non-null input cursor is rejected explicitly;
never retry a partial read blindly as a new page. Enrichment can return partial
nested collections when its budget or limits expire.

`ticketConnection(config, project?)` resolves the selected local connection and scope.
The bundled connector owns transport validation, legacy aliases, agent instructions
and MCP server configuration. The engine consumes `connectorAgentContext(config)`;
ticket content can never supply it. V0 loads exactly one bundled adapter.

Each adapter folder provides `definition.mjs`, its runtime, instructions and documentation.
