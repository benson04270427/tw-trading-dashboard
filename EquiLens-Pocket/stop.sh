#!/usr/bin/env sh
# EquiLens Pocket (macOS / Linux): stop the tunnel and the mobile server started by start.sh.
# Usage: ./stop.sh [--keep-tunnel]    EquiLens Nexus keeps running (stop it with ../EquiLens-Nexus/stop.sh).
cd "$(dirname "$0")"
stop() { # $1 pid file, $2 expected command fragment, $3 label
  [ -f "$1" ] || return 0
  PID=$(cat "$1")
  if ps -p "$PID" -o command= 2>/dev/null | grep -q "$2"; then kill "$PID" && echo "$3 stopped."; fi
  rm -f "$1"
}
[ "$1" = "--keep-tunnel" ] || stop .local/tunnel.pid cloudflared "Tunnel"
stop .local/server.pid server.mjs "EquiLens Pocket"
echo "EquiLens Nexus keeps running (stop it with ../EquiLens-Nexus/stop.sh)."
