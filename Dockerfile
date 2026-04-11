FROM node:22-alpine AS base

# Install system dependencies
RUN apk add --no-cache \
  docker-cli \
  docker-cli-compose \
  git \
  github-cli \
  openssh-client \
  bash \
  python3 \
  make \
  g++ \
  su-exec \
  lsof \
  iproute2 \
  curl \
  && npm install -g pnpm

# ---- Dependencies ----
FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install

# ---- Build ----
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# ---- Production ----
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PXM_PORT=20222
ENV PXM_DATA_DIR=/data
ENV PXM_STACKS_DIR=/data/stacks

# Create data directories
RUN mkdir -p /data/stacks /data/db /data/openclaw

# Copy built application
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
COPY --from=builder /app/server.ts ./server.ts
COPY --from=builder /app/tsconfig.json ./tsconfig.json
# Copy source files needed by server.ts at runtime (tsx executes TypeScript directly)
COPY --from=builder /app/src ./src
# Copy full node_modules for native modules (node-pty, better-sqlite3) and tsx
COPY --from=deps /app/node_modules ./node_modules

EXPOSE 20222 20242

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD wget -qO- http://localhost:20222/api/health || exit 1

# Entrypoint
COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
