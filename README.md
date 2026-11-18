# Console

`la-fabrique-ai/console` combines a local mission engine with native Herdr App layouts. It helps you prepare a ticket, run Claude Code or Codex developers, collect independent reviews and QA evidence, and approve delivery.

The package name is `@la-fabrique-ai/console`; the CLI name is `fabrique-console`. See [configuration](docs/console/configuration.md), [ticket connectors](docs/console/ticket-connectors.md), and the [workflow](docs/console/workflow.md).

**Integration status — TODO(console):** These documents describe the approved Console target. The renamed installer scripts, configuration validator, connector registration, and layout selection still need verification in the integrated release. Commands marked below are pending that verification; this guide is not evidence of a successful fresh installation.

## Requirements

- macOS on Apple Silicon.
- Herdr App **0.1.12** and herdr-core **0.1.17**, the validated baseline. Newer versions require compatibility checks; they are not implied by this baseline.
- Node.js **22 or later** and npm.
- Git, with access to the repositories you intend to use.
- GitHub CLI (`gh`), installed and authenticated for the intended repositories before remote delivery.
- Claude Code and/or Codex CLI, installed and authenticated. Install both for reviews across the two agent families. Codex launches under herdr-core use `--no-daemon`.
- Access to a supported ticket connection, with the capabilities required by your workflow.

Obtain Herdr App and core through their official distribution. Keep the Console app at `~/Applications/Herdr.app`; keep any existing app installation separate. Launch it explicitly:

```sh
open "$HOME/Applications/Herdr.app"
```

After installing or updating Herdr, read the generated API guide and type declarations in `~/.config/herdr-app/`, together with `herdr-app commands` and `hc --skill`. The generated files describe the installed version; do not edit them.

## Install from a checkout

In your local checkout of `la-fabrique-ai/console`, install the locked dependencies:

```sh
npm ci
```

Then build and validate the checkout:

```sh
npm test
npm run build:ui
npm run check
```

The approved installer command is:

```sh
npm run install:console
```

**TODO(console):** Verify that `install:console` is present in the integrated `package.json` and installs only Console-owned resources before running it. Do not substitute an older product's installer. The installer must refuse unknown collisions and modified owned artifacts; preserve edits and investigate a refusal rather than removing ownership checks.

The installer deploys native resources under `~/.config/herdr-app/` with `fabrique-console-v4-*` names, plus retained `fabrique-console-v3-*` dependencies. Private Console data belongs under `~/.config/fabrique-console/`; worktree reports use `.fabrique-console/`. It must preserve existing Herdr resources, applications, sessions, and other installations. There is no import of earlier sessions or credentials.

The backend runs from the checkout. Its absolute path and the Node executable are injected into local runtime files during installation. Keep the checkout in place. The approved update alias is `npm run update:console`; **TODO(console):** verify that alias before using it after a move, Node change, or source update.

## First configuration

1. Create the local JSON configuration using the fictional `demo` example in [configuration](docs/console/configuration.md). Set a stable owner ID, an explicit ticket scope, repository paths, and verified base branches. Store no credentials in it.
2. Configure the local connection named by `ticketConnector`. Follow its [connector-specific instructions](docs/console/ticket-connectors.md), including authentication and capability checks. A connected read-only account does not grant write access.
3. Select installed agents and explicit model, budget, and test policies. **TODO(console):** use the integrated validator's accepted fields; the approved configuration sketch does not define those nested fields yet.
4. Select the installed Console layout in Herdr App. **TODO(console):** confirm the exact entry layout name and selection command against the installed resources; the approved naming prefix alone does not identify an entry point.
5. Check that the owner and `demo` project are displayed, ticket reads succeed, and the repository mapping is unambiguous. An unavailable source must appear as unknown or unavailable, not as an empty successful result. Then follow [Prepare → Develop → Validate → Close](docs/console/workflow.md).

For an authorized installation check, `herdr-app status` inspects the app and `herdr-app shot /tmp/fabrique-console-inspection.png` captures its current window. Keep captures private. **TODO(console):** verify the integrated native test switch `FABRIQUE_CONSOLE_NATIVE_CHECKS=1`; validation must exercise deferred UI states as well as the initial render.

## Uninstall

Switch to Herdr's official layout first:

```sh
herdr-app do layout.switch '{"name":"main"}'
```

The approved removal command is `npm run uninstall:console`. **TODO(console):** verify this alias and its ownership behavior in the integrated release before running it.

Removal should delete only unchanged artifacts listed in the Console ownership manifest and report modified artifacts it preserves. Private configuration, reports, worktrees, terminals, credentials, and Herdr itself remain. Back them up separately if needed; a worktree backup also needs its common Git repository. Removing the UI does not stop an agent or close a ticket. Review retained data and credentials separately before any explicit deletion; do not remove another installation's resources.
