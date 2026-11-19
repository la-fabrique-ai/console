# Configuration

Console configuration is local, schema-versioned JSON, validated strictly and stored with mode `0600`. The approved state directory is `~/.config/fabrique-console/`, optionally selected through `FABRIQUE_CONSOLE_HOME`. Credentials belong in the connector's dedicated credential store, never in configuration, layouts, runtime files, source control, or prompts.

**TODO(console):** Confirm the configuration filename, environment override behavior, schema location, and validation command against the integrated release. The example below reproduces the approved version-1 shape; it does not establish that the current checkout already accepts it.

## Fictional example

Replace the scope and repository path with values you have checked. The `main` branch below is an example, not an inferred default.

```json
{
  "version": 1,
  "owner": {
    "id": "owner",
    "displayName": "Owner"
  },
  "ticketConnector": "primary",
  "projects": [
    {
      "key": "demo",
      "name": "Demo project",
      "color": "#6B6CF5",
      "icon": "folder",
      "leadLayout": "generated",
      "ticketScope": {
        "connection": "primary",
        "scopeId": "EXAMPLE_SCOPE"
      },
      "machine": null,
      "repos": [
        {
          "key": "app",
          "path": "/absolute/path/to/demo",
          "mainBranch": "main"
        }
      ]
    }
  ]
}
```

## Version-1 fields

| Field | Meaning |
| --- | --- |
| `version` | Schema version; `1` in this example. Unsupported versions must be rejected. |
| `owner.id` | Stable identity used for provenance, persisted with the `owner` role. Do not replace it when only the display name changes. |
| `owner.displayName` | Owner name used in the interface and agent context. No person is hard-coded in the engine. |
| `ticketConnector` | Local connection reference, here `primary`; not a provider name or credential. |
| `projects[]` | Explicit project mappings. A directory name alone does not establish a mapping. |
| `projects[].key` | Stable project key, here `demo`. |
| `projects[].name` | Project display name. |
| `projects[].color` / `icon` | Project appearance using supported values and owned resources. |
| `projects[].leadLayout` | `generated` requests local generation from project configuration; a generic Lead layout is the fallback. |
| `projects[].ticketScope.connection` | Local connection that owns this project's ticket scope. |
| `projects[].ticketScope.scopeId` | Opaque scope identifier obtained from the connection's metadata. Do not infer it from a display name. |
| `projects[].machine` | `null` for local orchestrated launches in this version. |
| `projects[].repos[]` | Explicit repositories participating in the project. |
| `repos[].key` | Repository key within the project, here `app`. |
| `repos[].path` | Absolute path to an existing local Git repository. |
| `repos[].mainBranch` | Verified integration/base branch for that repository. |

`primary` must resolve to a local connection whose driver and options are validated by its connector. Driver selection is connector-specific; see [ticket connectors](ticket-connectors.md). It does not belong in a provider-specific engine schema.

## Choosing the ticket connector

One connector serves the whole Console. It is chosen by `tracker.driver`; without it, the default bundled connector is used, so existing configurations need no change. An unknown driver is refused.

For tickets kept as Markdown files in each project's repository, under `la-fabrique/output/tickets/`:

```json
{
  "tracker": { "driver": "markdown" },
  "projects": [
    {
      "key": "demo",
      "ticketScope": { "connection": "primary", "scopeId": "demo" },
      "repos": [{ "key": "app", "path": "/absolute/path/to/demo", "mainBranch": "main" }]
    }
  ]
}
```

With Markdown, `scopeId` is the project key and tickets are named `DEMO-1.md`, `DEMO-2.md`… in the first repository of the project. The other fields of the example above stay as they are. See `integrations/tickets/markdown/README.md` for the file format.

## Tests, agents, models, and budgets

These policies must be explicit for a fresh installation. Test commands use argument arrays, for example `["npm", "test"]`, rather than shell strings. Enable only commands that exist in the mapped repository and that can run in an isolated test environment. An example npm command is not evidence that a repository supports it.

Choose installed agents and allowed models and efforts for the work's risk level. Set budgets and thresholds deliberately; do not copy historical personal limits into a new installation. Required local paths must also be explicit.

**TODO(console):** The approved approach names tests, models, budgets, and local paths but does not specify their JSON keys, units, defaults, or limits. Add them only from the integrated schema and its validated examples. The minimal example above is not a complete launch policy.

## Check a mapping before launch

Verify that the connection can read the selected scope, that each ticket resolves to one intended project mapping, and that repository paths and branches exist. Resolve overlapping mappings explicitly. Layouts and icons must be selected from owned resources; configuration must never supply executable code.

Generated resources come from `projects[]`, not from a built-in project list. Repository moves or a changed Node executable also require an installer update because deployed runtime paths are absolute; see [installation](README.md).
