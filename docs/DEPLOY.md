# Deploying Tracki

For an existing installation, follow [the telemetry cutover procedure](RELIABILITY.md#existing-deployment-cutover-and-retention) before running an update or migrations. Stop producers, drain the legacy queue, and stop old workers before copying tables. The commands below are not a zero-downtime upgrade procedure.

This repo ships a **self-contained production stack** you can run on any single
Linux host with Docker. One image runs the API/worker, the dashboard, and the
migrations; Postgres + ClickHouse + Redis run as internal services; Caddy
terminates TLS for two public domains.

> Status: **deploy-ready artifacts** (Dockerfile, `infra/docker-compose.prod.yml`,
> `infra/Caddyfile`, `.env.sample`). Going live needs *your* host, DNS, and
> secrets — none are baked in. For a managed cloud (AWS `me-central-1` for GCC
> data residency, etc.) the same image applies; swap the three store services for
> managed Postgres / ClickHouse Cloud / managed Redis and point the URLs at them.

## Prerequisites
- A Linux host with **Docker** + the Compose plugin, ports **80/443** open.
- **Two DNS records** pointing at the host: one for the dashboard (`APP_DOMAIN`)
  and one for the ingest origin (`INGEST_DOMAIN`) — e.g. `app.acme.com`, `in.acme.com`.
- An **`ANTHROPIC_API_KEY`** (production refuses to boot without it — `assertLLM`).
- (Optional) WhatsApp Meta Cloud API credentials for real WhatsApp; otherwise the
  built-in simulator is used and `/v1/whatsapp/simulate` stays disabled in prod.

## 1. Configure
```sh
cp .env.sample .env.prod
# Edit .env.prod:
#  - APP_DOMAIN / INGEST_DOMAIN + the three NEXT_PUBLIC_* https URLs
#  - strong POSTGRES_PASSWORD / CLICKHOUSE_PASSWORD (and matching DATABASE_URL)
#  - ANTHROPIC_API_KEY
#  - TRACKI_ADMIN_EMAILS (your account, to see /admin)
#  - WHATSAPP_* only if going live on Meta
```
`NEXT_PUBLIC_*` are compiled into the dashboard, so they must be correct **before**
the build (step 2). Changing them later requires a rebuild.

## 2. Build, migrate, and start
```sh
docker compose -f infra/docker-compose.prod.yml --env-file .env.prod up -d --build
```
Order is automatic: stores come up healthy → the one-shot **migrate** job applies
the Postgres (drizzle) + ClickHouse migrations → **ingest** starts (waits for
migrate to succeed) → **dashboard** starts (waits for ingest healthy) → **caddy**
issues TLS certs and routes both domains.

## 3. Verify
```sh
docker compose -f infra/docker-compose.prod.yml ps           # all healthy
curl -fsS https://in.example.com/health                      # {"ok":true,...}
curl -fsS https://in.example.com/tracki.js | head -c 80      # the snippet
# open https://app.example.com  → sign up, create an org + project
```
Embed on a customer site: `<script async src="https://in.example.com/tracki.js"
data-key="pk_…"></script>` (the dashboard shows the exact tag per project).

## 4. Operate
```sh
docker compose -f infra/docker-compose.prod.yml logs -f ingest dashboard
docker compose -f infra/docker-compose.prod.yml up -d --build   # deploy an update
docker compose -f infra/docker-compose.prod.yml run --rm migrate # re-run migrations
```
Data persists in named volumes (`pgdata`, `chdata`, `redisdata`). **Back these up.**

## Hardening checklist (already in code, confirm in your env)
- `NODE_ENV=production` is set → CSP + security headers on, simulate endpoints off.
- `ANTHROPIC_API_KEY` set → AI runs Claude (never fabricates; grounded only).
- Strong store passwords; stores have **no host ports** (internal network only).
- Per-key / per-IP rate limits, PII masking at ingest, tenant isolation — on by default.
- Before a **second** WhatsApp number, address the ticketed multi-number routing
  (`projectForWaId` → route by `phone_number_id`).

## Managed-cloud variant (notes)
- Drop the `postgres` / `clickhouse` / `redis` services; set `DATABASE_URL`,
  `CLICKHOUSE_URL`/user/pass/db, `REDIS_URL` to your managed endpoints.
- Build/push the image to a registry; run `ingest` and `dashboard` as two services
  from the same image (ingest needs the worker — keep `INGEST_RUN_WORKER=true`, or
  split into a third worker-only service with `INGEST_RUN_SERVER=false`).
- Run the `migrate` command as a release/pre-deploy job.
- Put the managed load balancer / CDN in front instead of Caddy (keep the snippet
  cacheable; ingest CORS stays open for `/v1`).
