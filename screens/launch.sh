#!/bin/sh
# Starts the separate Herdr of Mission Control with its own environment.
# The Linear key goes from the macOS Keychain to the engine's environment,
# and nowhere else.
set -eu
install="${MISSION_CONTROL_INSTALL:-$HOME/.mc1}"
. "$install/env.sh"
LINEAR_API_KEY="$(security find-generic-password -s dev.mission-control.linear -a api-key -w 2>/dev/null || true)"
export LINEAR_API_KEY
exec "$install/Herdr.app/Contents/MacOS/Herdr"
