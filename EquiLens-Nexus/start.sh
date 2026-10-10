#!/usr/bin/env sh
# EquiLens Nexus (macOS / Linux): start the local service in the background and open the browser.
# Usage: ./start.sh [--no-browser]    (port: PORT=4330 by default)
set -e
cd "$(dirname "$0")"
PORT="${PORT:-4330}"
URL="http://127.0.0.1:$PORT"
health() { curl -fsS --max-time 2 "$URL/api/health" 2>/dev/null | grep -q '"equilens-nexus"'; }
open_url() {
  [ "$1" = "--no-browser" ] && return 0
  if command -v open >/dev/null 2>&1; then open "$URL"
  elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$URL" >/dev/null 2>&1 &
  else echo "Open $URL in your browser."; fi
}
if health; then open_url "$1"; exit 0; fi
command -v node >/dev/null 2>&1 || { echo "Node.js 22 or newer is required: https://nodejs.org/"; exit 1; }
[ "$(node -p 'process.versions.node.split(".")[0]')" -ge 22 ] || { echo "Please update Node.js to version 22 or newer."; exit 1; }
[ -d node_modules/@anthropic-ai/sdk ] || npm install --omit=dev --no-fund --no-audit
mkdir -p .local
nohup node server.mjs >> .local/server.log 2>&1 &
echo $! > .local/server.pid
i=0
while [ $i -lt 30 ]; do
  sleep 0.4
  if health; then echo "EquiLens Nexus is ready: $URL"; open_url "$1"; exit 0; fi
  kill -0 "$(cat .local/server.pid)" 2>/dev/null || { echo "EquiLens Nexus could not start (port $PORT may be in use). See .local/server.log"; exit 1; }
  i=$((i + 1))
done
echo "EquiLens Nexus startup timed out. Run 'node server.mjs' in this folder to see the error."
exit 1
