# Service-backed verification runbook

This is the reproducible non-production procedure for the checks that cannot
be proven by dependency-free unit tests. It uses synthetic tenants and payloads
only. It does not authorize a production deployment, real customer data, or a
real WhatsApp provider.

## 1. Start the disposable local services

From the repository root, use Node 20+, the pinned pnpm version, and Docker
Compose:

```sh
corepack enable
corepack prepare pnpm@9.12.3 --activate
pnpm install --frozen-lockfile
docker compose -f infra/docker-compose.yml up -d postgres redis clickhouse
```

The local stack uses these exact development values:

| Variable | Value |
| --- | --- |
| `DATABASE_URL` | `postgres://tracki:tracki@localhost:5432/tracki` |
| `REDIS_URL` | `redis://localhost:6379` |
| `CLICKHOUSE_URL` | `http://localhost:8123` |
| `CLICKHOUSE_USER` / `CLICKHOUSE_PASSWORD` / `CLICKHOUSE_DB` | `tracki` / `tracki` / `tracki` |
| `NODE_ENV` | `development` |
| `TRACKI_ALLOW_HEURISTIC_LLM` | `1` |
| `INGEST_RUN_SERVER` / `INGEST_RUN_WORKER` | `true` / `true` |

For PowerShell, set the values before migration and before opening the service
terminals:

```powershell
$env:DATABASE_URL = "postgres://tracki:tracki@localhost:5432/tracki"
$env:REDIS_URL = "redis://localhost:6379"
$env:CLICKHOUSE_URL = "http://localhost:8123"
$env:CLICKHOUSE_USER = "tracki"
$env:CLICKHOUSE_PASSWORD = "tracki"
$env:CLICKHOUSE_DB = "tracki"
$env:NODE_ENV = "development"
$env:TRACKI_ALLOW_HEURISTIC_LLM = "1"
$env:INGEST_RUN_SERVER = "true"
$env:INGEST_RUN_WORKER = "true"
```

## 2. Apply schema and seed two benchmark tenants

```sh
pnpm ops:preflight
pnpm db:migrate
pnpm ch:migrate
pnpm ops:seed
```

The preflight must report all three listeners, for example:

```text
Service preflight OK: PostgreSQL=127.0.0.1:5432, Redis=127.0.0.1:6379, ClickHouse=127.0.0.1:8123
```

`ops:seed` is idempotent and creates `ops-a` / `ops-b` with public keys
`pk_ops_a` / `pk_ops_b`. It prints the generated organization and project IDs;
retain those IDs for reconciliation. The dashboard seed remains available for
the bilingual UX path:

```sh
SEED_OWNER_PASSWORD='local-only-change-me' pnpm --filter @tracki/dashboard exec tsx scripts/seed-vertex.ts
```

## 3. Start the three local processes

Use separate terminals with the variables above:

```sh
pnpm --filter @tracki/dashboard dev
pnpm --filter @tracki/ingest dev
pnpm demo
```

Expected readiness checks are `http://localhost:3000`,
`http://localhost:4000/health`, and `http://localhost:4321/delivery.html`.
The health response must contain `"ok":true` and all three dependency checks
must be true.

## 4. Run the service-backed gates

Run in this order so the evidence names are stable and recoverable:

```sh
pnpm --filter @tracki/ingest exec vitest run --config vitest.integration.config.ts
pnpm ops:whatsapp
pnpm e2e
pnpm ops:benchmark -- --keys=pk_ops_a,pk_ops_b --organization-count=2 --levels=1,5,10,25 --duration-ms=30000 --interval-ms=250 --batch-size=8 --duplicate-every=7 --recovery-ms=30000 --max-p95-ms=500 --max-error-rate=0.01 --output=evidence/operations/service-run
pnpm ops:reconcile -- --raw=evidence/operations/service-run/raw.json --project-id=<project-id-from-ops-seed> --output=evidence/reconciliation/service-run.json
pnpm ops:privacy-audit -- --output=evidence/privacy-audit/service-run
pnpm ops:index
```

Expected release evidence is:

| Gate | Required result |
| --- | --- |
| Integration suite | 13 tests pass, 0 skipped; database failure-injection and tenant tests execute against services |
| WhatsApp simulator | PASS; one inbound provider ID produces one local inbound row and one Agent reply, replay adds neither |
| Playwright | All smoke tests pass, including the injected 503 followed by a real retry with the same event IDs |
| Keyed benchmark | HTTP mode is recorded; no `measurement_not_run`; p95/error thresholds pass or the saturation boundary is explicitly reviewed |
| Reconciliation | Zero missing identities and zero physical duplicates for the supplied project; non-observable fields remain `unknown` |
| Privacy audit | `Privacy audit PASS`, with zero unsafe logs, tenant predicate violations, or artifact findings |

Keep `raw.json`, `summary.json`, `report.md`, and manifests. Do not paste raw
payloads or logs into tickets; use the metadata-only `evidence/index.json` for
the release summary.

## 5. Failure handling

If preflight fails, stop at that step and preserve the command output. If a
service-backed gate fails, keep the Compose volumes and the evidence directory,
record the exact first failing gate, and do not relabel it as a unit-test
failure. For a clean rerun of synthetic data, use a named disposable Compose
project or archive the old evidence directory before rerunning. Never run these
commands with production URLs or credentials.
