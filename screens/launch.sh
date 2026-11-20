#!/bin/sh
# Starts the separate Herdr of Mission Control with its own environment.
set -eu
install="${MISSION_CONTROL_INSTALL:-$HOME/.mc1}"
. "$install/env.sh"
exec "$install/Herdr.app/Contents/MacOS/Herdr"
