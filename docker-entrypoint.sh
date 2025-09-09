#!/usr/bin/env bash
set -euo pipefail

term_handler() {
  echo "Stopping services..."
  pkill -TERM -P $$
  exit 143
}
trap term_handler SIGTERM SIGINT

# Defaults für Nginx
export SERVER_NAME="${SERVER_NAME:-_}"
export SSL_CERT="${SSL_CERT:-/etc/nginx/certs/10.11.36.40.pem}"
export SSL_KEY="${SSL_KEY:-/etc/nginx/certs/10.11.36.40-key.pem}"

# Nginx Config aus Template erzeugen
mkdir -p /etc/nginx
if command -v envsubst >/dev/null 2>&1; then
  envsubst '${SERVER_NAME} ${SSL_CERT} ${SSL_KEY}' \
    < /etc/nginx/templates/nginx.conf.template \
    > /etc/nginx/nginx.conf
else
  sed -e "s|\${SERVER_NAME}|${SERVER_NAME}|g" \
      -e "s|\${SSL_CERT}|${SSL_CERT}|g" \
      -e "s|\${SSL_KEY}|${SSL_KEY}|g" \
    /etc/nginx/templates/nginx.conf.template > /etc/nginx/nginx.conf
fi

# Warte bis Port offen ist
wait_port() {
  local port=$1
  for i in {1..60}; do
    if (echo > /dev/tcp/127.0.0.1/${port}) >/dev/null 2>&1; then return 0; fi
    sleep 0.5
  done
  return 1
}

# Backend (Uvicorn auf 8001)
echo "[entrypoint] Starting backend (uvicorn) on :8001"
uvicorn --app-dir backend main:app --host 0.0.0.0 --port 8001 --no-access-log &
BACK_PID=$!

# Frontend (Next.js auf 3000) – EXPLIZIT auf 0.0.0.0 binden
PORT="${PORT:-3000}"
NEXT_HOST="0.0.0.0"
echo "[entrypoint] Starting frontend (next start) on :$PORT (host=$NEXT_HOST)"
npm run start -- -p "$PORT" -H "$NEXT_HOST" &
FRONT_PID=$!

echo "[entrypoint] Waiting for services..."
wait_port 8001 || { echo "Backend not ready on :8001"; exit 1; }
wait_port 3000 || { echo "Frontend not ready on :3000"; exit 1; }

echo "[entrypoint] Starting nginx on :443 (server_name=$SERVER_NAME)"
nginx -g 'daemon off;' &
NGINX_PID=$!

wait -n $BACK_PID $FRONT_PID $NGINX_PID || true
term_handler