# syntax=docker/dockerfile:1
#
# One production image for the whole Tracki monorepo. The same image runs three
# roles, selected by the compose `command`:
#   • ingest    → pnpm --filter @tracki/ingest start   (Fastify API + worker, tsx)
#   • dashboard → pnpm --filter @tracki/dashboard start (next start, prebuilt .next)
#   • migrate   → pnpm db:migrate && pnpm ch:migrate    (one-shot)
#
# NEXT_PUBLIC_* are inlined into the dashboard at BUILD time, so they're build args.
FROM node:22-bookworm-slim AS app
WORKDIR /app

# Public URLs baked into the dashboard bundle (browser-visible). Override per deploy.
ARG NEXT_PUBLIC_APP_URL=http://localhost:3000
ARG NEXT_PUBLIC_INGEST_URL=http://localhost:4000
ARG NEXT_PUBLIC_SNIPPET_URL=http://localhost:4000/tracki.js
ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL \
    NEXT_PUBLIC_INGEST_URL=$NEXT_PUBLIC_INGEST_URL \
    NEXT_PUBLIC_SNIPPET_URL=$NEXT_PUBLIC_SNIPPET_URL

# curl is used by the ingest healthcheck; corepack pins pnpm from package.json.
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && corepack enable

# Install with the full workspace (dev deps included: tsx/next/drizzle-kit are
# needed at build+runtime). Then build the snippet (ingest serves /tracki.js) and
# the dashboard. NODE_ENV is only set for the build steps so install keeps devDeps.
#
# `next build` evaluates the route graph, and the db client throws at import if
# DATABASE_URL is unset — so the dashboard build is given PLACEHOLDER store URLs.
# These are scoped to the build command only (never written to image ENV); real
# values are supplied at runtime by .env.prod and take precedence.
COPY . .
RUN pnpm install --frozen-lockfile \
 && NODE_ENV=production pnpm --filter @tracki/snippet build \
 && DATABASE_URL=postgres://build:build@localhost:5432/build \
    REDIS_URL=redis://localhost:6379 \
    CLICKHOUSE_URL=http://localhost:8123 \
    NODE_ENV=production pnpm --filter @tracki/dashboard build \
 && pnpm store prune

ENV NODE_ENV=production
EXPOSE 3000 4000

# Default role; compose overrides per service.
CMD ["pnpm", "--filter", "@tracki/ingest", "start"]
