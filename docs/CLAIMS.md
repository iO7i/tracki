# Claim → evidence matrix

This matrix keeps public wording tied to a reproducible proof surface. A code
path or workflow definition is not itself a green runtime result; statuses must
be updated from the corresponding evidence artifact or CI run.

| Claim | Proof surface | Status boundary |
| --- | --- | --- |
| Current SDKs assign stable event IDs and preserve them in retries | `packages/mobile-core/src/conformance.test.ts`, `sdks/conformance/journey-batch.json`, native jobs in `.github/workflows/native.yml` | TypeScript reference is locally green; native toolchain status requires a green supported-runner job |
| Same explicit ID with changed content is rejected | `apps/ingest/src/reliability.test.ts`, integration delivery test, inbox `payload_hash` | Unit path is locally green; real database result requires the integration stack |
| Accepted telemetry has a durable PostgreSQL ledger entry | `apps/ingest/src/inbox.ts`, `docs/RELIABILITY.md`, integration suite | Contract is implemented; no local durability claim without PostgreSQL evidence |
| ClickHouse retries are effectively deduplicated | `apps/ingest/src/worker.ts`, `bench/operations/reconcile.mjs`, fault matrix | Physical duplicates remain possible; effective read and reconciliation evidence are required |
| Detector quality is measured against known labels | `bench/operations/friction-benchmark.ts`, versioned holdout report/manifest | Synthetic holdout only; not real-customer accuracy |
| Arabic and English decisions are equivalent for language-independent scenarios | Paired holdout scenarios and parity report | Limited to the versioned synthetic pairs; FAQ/RTL rendering needs browser evidence |
| Operational scale is characterized | `bench/operations/run.mjs`, `/metrics`, environment manifest | A dry run is `not_run`; keyed results must name the machine, stack, saturation boundary, and reconciliation |
| WhatsApp webhook replays are suppressed locally | `apps/dashboard/drizzle/0013_idempotent_whatsapp.sql`, simulator check, `docs/RELIABILITY.md` | Provider-side boundary remains at-least-once across a crash window |
| Tracki is deployable | `docs/DEPLOY.md`, `infra/`, migrations, health endpoint | Deploy-ready artifacts only; `LIVE_DEPLOYMENT_NOT_RUN` |
