#!/bin/bash

# Docker entrypoint script to start frontend, backend and nginx (HTTPS reverse proxy)

set -e
echo "Starting RFID App with Frontend, Backend and Nginx (HTTPS)..."

# Function to handle shutdown
cleanup() {
        echo "Shutting down services..."
        kill $BACKEND_PID $FRONTEND_PID $NGINX_PID 2>/dev/null || true
        exit 0
}

# Set up signal handlers
trap cleanup SIGTERM SIGINT

# Render nginx.conf from template if present
if [ -f /etc/nginx/templates/nginx.conf.template ]; then
    echo "Rendering nginx config..."
    : "${SERVER_IP:=_}"
    : "${NGINX_SSL_CERT:=/etc/nginx/certs/10.11.36.40.pem}"
    : "${NGINX_SSL_KEY:=/etc/nginx/certs/10.11.36.40-key.pem}"
    export SERVER_IP NGINX_SSL_CERT NGINX_SSL_KEY
    envsubst '${SERVER_IP} ${NGINX_SSL_CERT} ${NGINX_SSL_KEY}' < /etc/nginx/templates/nginx.conf.template > /etc/nginx/nginx.conf
fi

# Start Backend in background
echo "Starting Backend..."
cd /app/backend
python main.py &
BACKEND_PID=$!

# Wait a moment for backend to start
sleep 3

# Start Frontend in background
echo "Starting Frontend..."
cd /app
npm start &
FRONTEND_PID=$!

# Start Nginx (foreground disabled to keep simple PIDs; we'll background it)
echo "Starting Nginx (HTTPS on :443)..."
nginx -g 'daemon off;' &
NGINX_PID=$!

# Wait for all processes
echo "Services started. Backend PID: $BACKEND_PID, Frontend PID: $FRONTEND_PID, Nginx PID: $NGINX_PID"
echo "HTTPS: https://localhost (port 443) -> / -> 3000, /api|/ws -> 8001"

wait $BACKEND_PID $FRONTEND_PID $NGINX_PID
