#!/bin/sh
# Starts the separate Herdr of Mission Control with its own environment.
set -eu
install="${MISSION_CONTROL_INSTALL:-$HOME/.mc1}"
. "$install/env.sh"
unset LINEAR_API_KEY # the key never enters Herdr: engine.sh reads it for each engine command
exec "$install/Herdr.app/Contents/MacOS/Herdr"
