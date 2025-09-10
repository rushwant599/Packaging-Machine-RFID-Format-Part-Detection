# Multi-stage Dockerfile for Next.js Frontend + Python Backend

# Python Backend Stage
FROM python:3.13-slim AS backend-builder
WORKDIR /app/backend

# Install Python dependencies
COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Copy backend source
COPY backend/ ./

# Node.js Frontend Stage
FROM node:22.19.0-alpine AS frontend-builder
WORKDIR /app

# Install Node.js dependencies
COPY package.json package-lock.json ./
RUN npm ci

# Copy frontend source and build
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# Remove dev dependencies
RUN npm prune --omit=dev

# Final Runtime Stage
FROM python:3.13-slim AS runner
WORKDIR /app

# Install Node.js and Nginx in the Python container
RUN apt-get update && apt-get install -y \
    curl \
    gnupg \
    ca-certificates \
    nginx \
    gettext-base \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies
COPY --from=backend-builder /usr/local/lib/python3.13/site-packages /usr/local/lib/python3.13/site-packages
COPY --from=backend-builder /usr/local/bin /usr/local/bin

# Copy backend files
COPY --from=backend-builder /app/backend ./backend

# Copy frontend build
COPY --from=frontend-builder /app/.next ./.next
COPY --from=frontend-builder /app/public ./public
COPY --from=frontend-builder /app/package.json ./package.json
COPY --from=frontend-builder /app/node_modules ./node_modules

# Copy startup scripts
COPY docker-entrypoint.sh ./
COPY .env.example* ./
COPY nginx/nginx.conf.template /etc/nginx/templates/nginx.conf.template
COPY certs /etc/nginx/certs

# Set environment variables
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PYTHONPATH=/app/backend
ENV NGINX_SSL_CERT=/etc/nginx/certs/10.11.36.40.pem
ENV NGINX_SSL_KEY=/etc/nginx/certs/10.11.36.40-key.pem

# Expose ports (internal) and 443 for external HTTPS
EXPOSE 3000 8001 443

# Make entrypoint executable
RUN chmod +x docker-entrypoint.sh

# Start all services (backend, frontend, nginx)
CMD ["./docker-entrypoint.sh"]