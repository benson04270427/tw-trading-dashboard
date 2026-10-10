#!/usr/bin/env sh
# EquiLens Nexus (macOS / Linux): stop the service started by start.sh (only if the PID still belongs to this project).
cd "$(dirname "$0")"
PID_FILE=.local/server.pid
[ -f "$PID_FILE" ] || { echo "No launcher-owned process was found."; exit 0; }
PID=$(cat "$PID_FILE")
if ps -p "$PID" -o command= 2>/dev/null | grep -q "server.mjs"; then
  kill "$PID" && echo "EquiLens Nexus stopped."
else
  echo "Process does not match this project. Nothing was stopped."
fi
rm -f "$PID_FILE"
