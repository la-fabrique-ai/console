# Screens

The screens are native Herdr App panels ("mods"), written in TypeScript. Herdr App loads only JavaScript, so `install.ts` strips the types with Node 24 and copies the result into a Herdr App home (decision 0012).

They run in a **separate Herdr installation**, never in the operator's own Herdr or in the old system's.

## The separate installation
One folder holds a copy of Herdr App, a copy of its Core, and their own settings, state and sockets. `env.sh` in that folder exports what points every command at it: `HERDR_APP_HOME`, `HC_SESSION`, `HC_SOCKET`, the `XDG_*` folders and `MISSION_CONTROL_HOME`. `launch.sh` expects the folder at `~/.mc1` (`MISSION_CONTROL_INSTALL` picks another). An empty file `.mission-control` in its Herdr App home marks it as ours: `install.ts` writes to no other home.

Source `env.sh` before any `herdr-app` command meant for this installation: without `HERDR_APP_HOME` those commands reach the default one.

## Everyday commands
```sh
. ~/.mc1/env.sh
node screens/install.ts                              # copy the screens and their layout
herdr-app check "$HERDR_APP_HOME/mods/mission-control"  # Herdr's own check of the panel
herdr-app do layout.switch --name mission-control    # show the Mission Control window
sh screens/launch.sh                                 # start the separate Herdr
```

The window runs each engine command through `engine.sh`, which reads the Linear key from the macOS Keychain (service `dev.mission-control.linear`, account `api-key`) and hands it to that one process as `LINEAR_API_KEY`. The key is written nowhere and Herdr itself never holds it.

## Files
- `mission-control/main.ts`: the window. It calls the engine and draws what it returns, after `docs/mockups/prepare-flow`.
- `herdr-types/`: Herdr App's own type files, copied from its home. Replace them when Herdr App is updated.
- `tests/`: the slice's path on screen, run outside Herdr against a stand-in for its modules.
