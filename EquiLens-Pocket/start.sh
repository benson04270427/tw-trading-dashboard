#!/usr/bin/env sh
# EquiLens Pocket (macOS / Linux): set a password if needed, make sure Nexus runs, start the mobile server,
# then open the public HTTPS address according to the connection mode set in EquiLens Nexus (Remote access),
# unless --no-tunnel is given. Cloudflare modes use cloudflared; 'custom' means you run your own tunnel or reverse proxy.
set -e
cd "$(dirname "$0")"
PORT="${PORT:-4340}"
URL="http://127.0.0.1:$PORT"
NEXUS_URL="${NEXUS_URL:-http://127.0.0.1:4330}"
mkdir -p .local
command -v node >/dev/null 2>&1 || { echo "Node.js 22 or newer is required: https://nodejs.org/"; exit 1; }

# 1. A password must exist before anything is exposed.
[ -f .local/auth.json ] || { echo "No mobile password yet. Please set one now (at least 10 characters)."; node scripts/set-password.mjs; }

# 2. EquiLens Nexus (the data engine).
if ! curl -fsS --max-time 2 "$NEXUS_URL/api/health" 2>/dev/null | grep -q '"equilens-nexus"'; then
  NEXUS_DIR="${NEXUS_DIR:-../EquiLens-Nexus}"
  if [ -x "$NEXUS_DIR/start.sh" ]; then echo "Starting EquiLens Nexus..."; "$NEXUS_DIR/start.sh" --no-browser
  else echo "EquiLens Nexus not found at $NEXUS_DIR. Start it manually; the phone app shows data only while Nexus runs."; fi
fi

# 3. Mobile server (bound to 127.0.0.1 only).
health() { curl -fsS --max-time 2 "$URL/health" 2>/dev/null | grep -q '"equilens-pocket"'; }
if ! health; then
  nohup node server.mjs >> .local/server.log 2>&1 &
  echo $! > .local/server.pid
  i=0
  until health; do
    sleep 0.4; i=$((i + 1))
    [ $i -lt 30 ] || { echo "EquiLens Pocket startup timed out. See .local/server.log"; exit 1; }
  done
fi
echo "EquiLens Pocket is running locally: $URL"

# 4. Public URL, following the connection mode set in EquiLens Nexus (Data & Settings -> Remote access):
#    auto | cloudflare-quick | cloudflare-named | custom (your own tunnel / reverse proxy) | off (local only)
[ "$1" = "--no-tunnel" ] && exit 0
MODE=$(curl -fsS --max-time 3 "$NEXUS_URL/api/profile" 2>/dev/null | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{process.stdout.write(JSON.parse(s).remote?.tunnel||'')}catch{}})" || true)
[ -n "$MODE" ] || MODE=$(node -e "try{process.stdout.write(require('./.local/remote-cache.json').tunnel||'')}catch{}" 2>/dev/null || true)
[ -n "$MODE" ] || MODE=auto
case "$MODE" in
  custom) echo "Remote access: your own tunnel or reverse proxy (custom). Forward your HTTPS address to $URL and add its domain in EquiLens Nexus -> Remote access."; exit 0 ;;
  off) echo "Remote access is off (local only). No tunnel is started."; exit 0 ;;
esac
command -v cloudflared >/dev/null 2>&1 || { echo "Install cloudflared to reach Pocket from your phone: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/"; exit 0; }
if [ "$MODE" = "cloudflare-named" ] && [ ! -f .local/cloudflared.yml ]; then
  echo "Connection mode is 'Cloudflare fixed domain', but .local/cloudflared.yml was not found. See README.md."; exit 1
fi
if [ -f .local/cloudflared.yml ] && [ "$MODE" != "cloudflare-quick" ]; then
  nohup cloudflared tunnel --config .local/cloudflared.yml run >> .local/tunnel.log 2>&1 &
  echo $! > .local/tunnel.pid
  echo "Named tunnel started (see .local/cloudflared.yml for your hostname)."
else
  : > .local/tunnel.log
  nohup cloudflared tunnel --url "$URL" >> .local/tunnel.log 2>&1 &
  echo $! > .local/tunnel.pid
  i=0
  while [ $i -lt 60 ]; do
    PUBLIC=$(grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' .local/tunnel.log | head -n 1 || true)
    [ -n "$PUBLIC" ] && { echo "Phone URL: $PUBLIC"; exit 0; }
    sleep 0.5; i=$((i + 1))
  done
  echo "The tunnel did not report a URL yet; see .local/tunnel.log"
fi
