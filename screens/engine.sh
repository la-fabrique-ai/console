#!/bin/sh
# Runs one engine command for the screens. The Linear key goes from the macOS
# Keychain to the environment of that one process, and nowhere else.
LINEAR_API_KEY="$(security find-generic-password -s dev.mission-control.linear -a api-key -w 2>/dev/null || true)" \
  exec node "$(dirname "$0")/../engine/cli.ts" "$@"
