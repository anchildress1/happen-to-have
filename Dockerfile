# syntax=docker/dockerfile:1
#
# Node 24.20.0 LTS (Krypton), Debian bookworm-slim — verified on Docker Hub 2026-09-04.
# Alpine's musl libc is a recurring source of native-module breakage (e.g. sharp); slim
# stays on glibc for that class of problem at a small size cost.
#
# Requires next.config.ts to set `output: 'standalone'` — without it there is no
# .next/standalone directory for the runner stage to copy.

ARG NODE_IMAGE=node:24.20.0-bookworm-slim

# ---- deps: install once, with a frozen lockfile ----
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
# corepack reads the `packageManager` field in package.json, so the pnpm version
# stays pinned in one place instead of being repeated here.
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# ---- builder: compile the standalone Next.js output ----
FROM ${NODE_IMAGE} AS builder
WORKDIR /app
RUN corepack enable
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# `next build` imports every route to collect its config, which evaluates
# src/session/session.ts and its refuse-to-boot guard. Nothing is served during the build,
# so this is a placeholder, not a secret, and it does not reach the runner stage — Cloud Run
# injects the real value from Secret Manager (deploy.sh). Scoped to this RUN so it never
# lands in an image layer's environment.
RUN SESSION_SECRET=build-time-placeholder-never-served-not-a-secret pnpm run build

# ---- runner: minimal production image, non-root ----
FROM ${NODE_IMAGE} AS runner
WORKDIR /app
ENV NODE_ENV=production
# Cloud Run injects its own PORT at deploy time; this default only matters for a
# plain `docker run` outside Cloud Run.
ENV PORT=8080

RUN groupadd --system --gid 1001 nodejs && \
    useradd --system --uid 1001 --gid nodejs nextjs
USER nextjs

# Standalone output already traces only the production deps it needs — no separate
# node_modules copy required.
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

EXPOSE 8080

CMD ["node", "server.js"]
