# First adapter: Linear

The factory selects the existing GraphQL/API key or MCP/OAuth transport.
Workflow types map as follows: backlog and triage → backlog, unstarted → ready,
started → active, completed → done, canceled → canceled, all other types → unknown.
Classification never guesses from a status label. Source state fields remain
available for existing screens.

Projects, milestones and documents use the existing bounded GraphQL enriched
reader, including when the base transport is MCP. They require the existing API
key separately; unavailable credentials remain explicitly unavailable. This
preserves current functionality without inventing an OAuth enriched-read API.
MCP stays read-only. Both transports and enrichment are constructed by the one
factory; no engine module constructs a client.

OAuth login and its dedicated Keychain helper remain unchanged. The existing
`npm run tickets:login` entry point dispatches through the factory. No credentials
are included in connector configuration, references, snapshots, or tests.

The agent MCP configuration and operational instructions live in `definition.mjs` and `agent-instructions.md`. Legacy configuration fields, action names and persisted ticket states are decoded here; the engine emits generic ticket names.

## Linear

Transport par défaut : **MCP officiel, OAuth, lecture seule**.

```sh
npm run tickets:login
node src/cli.mjs snapshot '{}'
node src/cli.mjs ticket-meta '{}'
node src/cli.mjs ticket-list '{"mine":true}'
```

Autoriser l'accès dans le navigateur. Les identifiants restent dans le trousseau macOS, service `ai.la-fabrique.console.linear-mcp`, compte `oauth`. L'écriture utilise Security.framework via un helper Swift dont l'entrée standard transporte les données ; aucun token en argument de processus. Xcode Command Line Tools/Swift requis pour compiler ce helper la première fois. Aucun navigateur ne s'ouvre à partir d'un simple rafraîchissement du dashboard. Refaire le login après révocation ; ne jamais copier les jetons d'un autre client MCP.

Le connecteur Linear de ChatGPT reste distinct : sa connexion n'est pas exportée dans Herdr. Les noms et paramètres des outils MCP sont découverts sur le serveur réel.

Option GraphQL : mettre `linear.transport` à `graphql` dans la configuration locale, puis créer dans Trousseaux d'accès un mot de passe générique `ai.la-fabrique.console.linear`, compte `api-key`. Commencer en lecture seule. Ne coller la clé ni ici, ni dans un layout, ni dans un prompt. Endpoint GraphQL officiel : `https://api.linear.app/graphql`.

Le MCP `/mcp/readonly` n'autorise aucune écriture. Le backend GraphQL comprend une mutation explicite, avec payload intégral confirmé, état réel de l'équipe et journal d'idempotence. Aucun lancement/arrêt d'agent ne modifie un statut Linear. Une proposition de commentaire est préparée localement ; le bouton de confirmation ne contourne jamais les droits du transport.


## Connector notes (from the console documentation)

Linear is the first connector, located under `integrations/tickets/linear/` in the approved structure. Its MCP and GraphQL adapters share the generic facade; MCP is a transport, not a separate Lead write channel.

The approved authentication alias is `npm run tickets:login`. **TODO(console):** Verify that the integrated alias selects the intended local connection and confirm its arguments before running it. OAuth login requires an explicit browser authorization. A refresh must not open a login browser automatically.

The read-only MCP endpoint is `https://mcp.linear.app/mcp/readonly`. It cannot perform writes. The GraphQL endpoint is `https://api.linear.app/graphql`; write availability also depends on the selected transport, implementation, and granted permissions. MCP scopes and tool names must be discovered from the actual server. A connection in another application is not an exported credential for Console.

Credentials use dedicated macOS Keychain services: `ai.la-fabrique.console.linear-mcp`, account `oauth`, and `ai.la-fabrique.console.linear`, account `api-key`. Secrets reach the Security.framework helper through standard input, never process arguments. Xcode Command Line Tools with Swift are required when compiling that helper locally. Do not import another installation's credentials.

**TODO(console):** Supply and validate the complete `primary` driver-selection example and exact connection options from the integrated adapter. The engine example in [configuration](configuration.md) deliberately contains only a connection reference. Verify all required write operations and capability reporting with contract tests before enabling the full workflow.
