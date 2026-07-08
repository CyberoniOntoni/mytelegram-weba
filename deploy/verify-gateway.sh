#!/usr/bin/env bash
# Verify Testgram Docker gateway is reachable from the LXC host before serving FamilyGram Web.
# Run on the same machine where docker compose and nginx run (e.g. 192.168.11.79).

set -euo pipefail

GATEWAY_HOST="${1:-127.0.0.1}"
GATEWAY_PORT="${2:-30444}"
COMPOSE_DIR="${COMPOSE_DIR:-/opt/testgram/docker/compose}"

echo "==> FamilyGram Web gateway check (${GATEWAY_HOST}:${GATEWAY_PORT})"

if command -v docker >/dev/null 2>&1; then
  if [ -d "$COMPOSE_DIR" ]; then
    echo "-- docker compose (gateway-server):"
    (cd "$COMPOSE_DIR" && docker compose ps gateway-server) || true
  else
    echo "-- docker ps (gateway):"
    docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}' | grep -i gateway || true
  fi
fi

echo "-- listening ports:"
if ss -tlnp 2>/dev/null | grep -q ":${GATEWAY_PORT} "; then
  ss -tlnp | grep ":${GATEWAY_PORT} " || true
else
  echo "FAIL: nothing listening on ${GATEWAY_HOST}:${GATEWAY_PORT}"
  echo "    Ensure App__Servers__5__Enabled=True and App__Servers__5__Port=30444 in Testgram .env"
  echo "    Then: cd ${COMPOSE_DIR} && docker compose up -d gateway-server"
  exit 1
fi

echo "-- HTTP probe (gateway root):"
if curl -sf --max-time 5 "http://${GATEWAY_HOST}:${GATEWAY_PORT}/" | grep -qi websocket; then
  echo "OK: gateway HTTP endpoint responds"
else
  echo "FAIL: gateway did not respond on http://${GATEWAY_HOST}:${GATEWAY_PORT}/"
  exit 1
fi

if command -v docker >/dev/null 2>&1 && [ -d "$COMPOSE_DIR" ]; then
  echo "-- required Testgram services:"
  for svc in gateway-server auth-server messenger-query-server rabbitmq mongodb redis; do
    status="$(cd "$COMPOSE_DIR" && docker compose ps "$svc" --format '{{.Status}}' 2>/dev/null || true)"
    if [ -n "$status" ]; then
      echo "    ${svc}: ${status}"
    else
      echo "    WARN: ${svc} not found in compose"
    fi
  done
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if command -v node >/dev/null 2>&1 && [ -f "${SCRIPT_DIR}/mtproto-handshake-probe.cjs" ]; then
  echo "-- MTProto handshake probe (ReqPqMulti → ResPQ):"
  if node "${SCRIPT_DIR}/mtproto-handshake-probe.cjs" "ws://${GATEWAY_HOST}:${GATEWAY_PORT}/apiws"; then
    echo "OK: full MTProto auth path works"
  else
    echo "FAIL: WebSocket opens but auth-server did not answer — check auth-server, rabbitmq, redis"
    exit 1
  fi
elif command -v node >/dev/null 2>&1; then
  echo "-- WebSocket probe (/apiws, subprotocol binary):"
  node -e "
    const { WebSocket } = require('ws');
    const url = 'ws://${GATEWAY_HOST}:${GATEWAY_PORT}/apiws';
    const ws = new WebSocket(url, 'binary');
    const t = setTimeout(() => { ws.terminate(); console.log('FAIL: WebSocket timeout'); process.exit(1); }, 8000);
    ws.on('open', () => { clearTimeout(t); console.log('OK: WebSocket opened on', url); ws.close(); process.exit(0); });
    ws.on('error', (e) => { clearTimeout(t); console.log('FAIL:', e.message); process.exit(1); });
  " 2>/dev/null || echo "    (npm install ws in deploy/ parent, or: npx wscat -c ws://127.0.0.1:${GATEWAY_PORT}/apiws -s binary)"
fi

echo ""
echo "OK — nginx can proxy /apiws and /apiw1 to http://${GATEWAY_HOST}:${GATEWAY_PORT}"
echo "    Client connects via wss://your-domain/apiws (NPM → nginx:8082 → gateway:30444)"
echo "    If WebSocket opens but login still hangs, check auth-server and messenger-query-server logs."