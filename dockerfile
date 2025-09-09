# --- Stage 1: Frontend build (Next.js) ---
FROM node:20-bookworm-slim AS frontend-build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package*.json ./
RUN npm ci --include=dev
COPY . .
RUN npm run build

# --- Stage 2: Python wheels bauen ---
FROM python:3.11-slim AS py-build
WORKDIR /app
COPY backend/ backend/
RUN python -m pip install --upgrade pip wheel && \
    pip wheel --no-cache-dir -r backend/requirements.txt -w /wheels

# --- Stage 3: Runtime (Node + Python + Nginx) ---
FROM node:20-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app

# Laufzeit-Pakete
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-venv nginx-light dumb-init ca-certificates gettext-base \
    && rm -rf /var/lib/apt/lists/*

# Prod-Dependencies für Next (next start)
COPY --from=frontend-build /app/package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund

# Build-Output + public Assets
COPY --from=frontend-build /app/.next ./.next
COPY --from=frontend-build /app/public ./public

# Backend + Daten + Certs
COPY backend/ ./backend
COPY certs/ /etc/nginx/certs/

# Python venv + Wheels
RUN python3 -m venv /opt/venv
ENV VIRTUAL_ENV=/opt/venv
ENV PATH="/opt/venv/bin:${PATH}"
COPY --from=py-build /wheels /wheels
RUN pip install --no-cache-dir --no-index --find-links=/wheels -r backend/requirements.txt && \
    rm -rf /wheels && \
    find /opt/venv -name '__pycache__' -type d -prune -exec rm -rf {} +

# Nginx-Template + Entrypoint
COPY nginx.conf /etc/nginx/templates/nginx.conf.template
COPY docker-entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENV HOST=0.0.0.0
ENV PORT=3000
EXPOSE 443

ENTRYPOINT ["/usr/bin/dumb-init", "--"]
CMD ["/entrypoint.sh"]