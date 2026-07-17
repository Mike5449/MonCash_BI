# ─────────────────────────────────────────────────────────────────────────────
# MonCash BI Portal — Frontend
# Stage 1 : build the Vite bundle
# Stage 2 : serve the static bundle with nginx (also proxies /api to backend)
# ─────────────────────────────────────────────────────────────────────────────

# ── Stage 1 : build ──────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Install deps first (pure dependency layer — cached until package files change)
COPY package.json package-lock.json* ./
RUN npm ci --no-audit --no-fund

# Vite reads VITE_* env at BUILD time. Frontend calls become <BASE>/customers/...
# We default to "/api" so nginx (stage 2) can strip the /api prefix and forward
# to the backend on the internal Docker network. Override via docker-compose ARG.
ARG VITE_API_BASE_URL=/api
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}

# Copy the rest of the source and build
COPY . .
RUN npm run build

# ── Stage 2 : nginx runtime ──────────────────────────────────────────────────
FROM nginx:1.27-alpine AS runtime

# Static bundle
COPY --from=builder /app/dist /usr/share/nginx/html

# Reverse-proxy config (serves SPA + proxies /api/* to backend:8000)
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget -q -O /dev/null http://localhost/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
