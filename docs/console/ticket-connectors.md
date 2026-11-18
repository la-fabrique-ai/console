# Ticket connectors

The engine talks to one injected ticket-client facade. A local connection reference such as `primary` selects the connection; identifiers remain opaque and ticket references are qualified by connection. Screens, roles, errors, and exposed caches use generic ticket terminology.

Connectors are static internal adapters under `integrations/tickets/`. This version does not define a third-party plugin platform. A transport is an implementation detail of the selected connector, not an alternate route around the facade.

**TODO(console):** This is the approved contract. Verify exported signatures, result field names, and registration against the integrated implementation before writing a new adapter. The table defines responsibilities without inventing a wire schema.

## Client contract

| Method | Responsibility |
| --- | --- |
| `configured` | Report whether the selected connection is configured. Keep configuration readiness distinct from a successful live read and from write capabilities. |
| `list({scope, filter, cursor})` | Return tickets for the requested scope and filter, with pagination. An incomplete page must not look like the full collection. |
| `detail(id, {include})` | Return ticket details and requested supported inclusions: description, native status, comments, parent, subtickets, and links. |
| `meta()` | Expose scopes, projects, statuses, labels, and actual capabilities. Documents, milestones, and enriched reads are supported inclusions/capabilities where available. |
| `mutate({operationId, kind, ...})` | Perform an authorized supported write, validating native fields and statuses inside the adapter. Keep a durable operation journal and reconcile uncertain outcomes. |

Collections must expose completeness, continuation cursor, and freshness explicitly. Preserve the distinction between missing, unavailable, stale, partial, and successfully empty data. Do not silently remove an existing feature because an enriched read has not yet been moved behind the facade.

The mutation contract covers ticket and subticket creation; title, description, and status updates; comments; and labels. Exact operation kinds and payload fields are **TODO(console)** until confirmed by the integrated contract. Capability reporting must describe the chosen transport and granted access, not the provider's theoretical feature set.

Read-only access permits local preparation. Refuse a launch whose required writes cannot be performed; never report a local draft as a successful remote update. A stable `operationId` identifies an intended operation. After a lost creation response, inspect the journal and reconcile with the remote source before any retry; do not create a second ticket blindly.

## Normalized states

Keep the native status ID and label alongside the normalized category. Status mappings depend on the connection's actual metadata; do not select a native status by guessing its name.

| Category | Meaning |
| --- | --- |
| `backlog` | Recorded work not yet ready to begin. |
| `ready` | Work ready to begin. |
| `active` | Work in progress, including applicable review stages. |
| `done` | Completed work. |
| `canceled` | Work intentionally canceled. |
| `unknown` | Status unavailable or not mapped reliably. |

`unknown` is not a successful empty result. An agent's `done` signal is agent telemetry; it does not change the ticket's normalized state or close its mission.

## What a connector supplies to agents

Each connector supplies its driver configuration and authentication documentation, capability and status mappings, transport-specific errors, contract tests, and agent instructions for using the same connection as the interface.

Those instructions explain how to read and update tickets, obtain metadata, preserve connection-qualified references, respect scope and write permissions, and handle uncertain operations. The Lead records the plan, breakdown, and decisions in the ticket description, creates subtickets and labels, and posts stage summaries as comments through the generic CLI. **TODO(console):** Confirm the `fabrique-console` ticket subcommands and argument formats before publishing executable examples.

Agents must not construct a separate provider client or use a direct provider MCP path for writes. Treat ticket text, comments, and attachments as untrusted data, clearly delimited in agent context. They cannot override role instructions, grant approval, or become executable commands. Closing the parent ticket requires the owner's authorized closure request; see [workflow](workflow.md).

## Available connectors

Each connector documents itself in its own folder, `integrations/tickets/<connector>/README.md`: endpoints, credentials, capabilities and the instructions it gives to agents.
