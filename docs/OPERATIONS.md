# Operations and evidence

This repository separates deterministic correctness evidence from measurements.
The commands below use synthetic data only. They do not deploy Tracki, call a
real WhatsApp account, or claim production performance without a generated
report and its manifest.

## Acceptance targets

The operational acceptance criteria are:

- every current SDK event has a stable `eventId` before its first send and
  reuses it on retry;
- `project_id,event_id` is the durable ingestion identity; duplicate replays
  are harmless and a changed payload with the same explicit ID is rejected;
- the worker commits detector state and completion together only after durable
  ClickHouse writes succeed;
- late arrivals are retained for analytics but do not retroactively mutate a
  processed visitor watermark;
- bounded client queues never exceed their documented count/byte/age limits;
- tenant-scoped queries do not cross project boundaries and ingestion masking
  happens before persistence;
- WhatsApp provider webhook IDs are durable replay keys; outbound provider
  delivery remains explicitly at-least-once across a crash window.

## Deterministic verification

```sh
pnpm lint
pnpm check-types
pnpm test
pnpm build
pnpm --filter @tracki/ingest exec vitest run --config vitest.integration.config.ts
pnpm e2e
```

The integration and E2E commands require the local Compose stack and dedicated
test data. The native workflow is `.github/workflows/native.yml`; it runs the
React Native reference, Flutter pure-Dart and Android consumer builds, and the
Swift package/iOS consumer build on their supported runners.

Before service-backed checks, `pnpm ops:preflight` probes the required local
ports and emits actionable errors for missing PostgreSQL, Redis, or ClickHouse
containers.

## Synthetic ramp and reconciliation

Run the deterministic ramp without a key first. This produces a report with an
explicit `measurement_not_run` boundary and makes no network request:

```sh
pnpm ops:benchmark -- --dry-run --levels=1,5,10,25
```

With dedicated non-production project keys and an endpoint, the same harness
round-robins clients across projects and records response status, acceptance
latency, duplicate replay batches, unique IDs, and aggregate metrics; bounded
error bodies are never stored:

```sh
pnpm ops:benchmark -- --keys=pk_test_a,pk_test_b --organization-count=2 --endpoint=http://localhost:4000/v1/events --levels=1,5,10,25 --recovery-ms=30000
```

`--recovery-ms` adds a no-send observation window after the final level. The
harness scrapes `/metrics` before and after each level and after this recovery
wait, so queue drain is recorded rather than assumed.

Each run writes `raw.json`, `summary.json`, `report.md`, and a SHA-256
`manifest.json` under `evidence/operations/<run-id>/`. Pass the raw artifact and
project ID to the read-only oracle after the worker drains:

```sh
pnpm ops:reconcile -- --raw=evidence/operations/<run-id>/raw.json \
  --project-id=<project-uuid> --output=evidence/reconciliation/<run-id>.json
```

The oracle reports ledger completion, missing ClickHouse identities, and
physical duplicates. It intentionally labels detector-state and provider-side
delivery facts as `unknown` when they are not observable from the supplied
stores.

After generating multiple runs, `pnpm ops:index` creates the metadata-only
`evidence/index.json`; it indexes manifests and sidecars without copying raw
payloads.

## Friction quality and adversarial evidence

The friction benchmark has versioned dev/tune/holdout seeds, positive and hard
negative scenarios, and paired Arabic/English metadata. It reports TP/FP/TN/FN,
precision, recall, F1, false-positive and false-intervention rates, intervention
trigger rate, event-time detection latency, macro averages, and parity:

```sh
pnpm ops:friction -- --set=holdout
pnpm ops:fuzz -- --iterations=10000
pnpm ops:index
```

The rapid-success-navigation case remains a visible hard negative; it is not
silently relabeled to improve the score. CI runs three deterministic 10,000-
iteration fuzz seeds. Fuzz regressions are minimized and written as recoverable
JSON evidence rather than discarded. The benchmark's intervention rate is a
detector-trigger proxy: it does not execute a popup, assist, or external
message, so live side-effect rate needs a separate canary.

The machine-readable acceptance contract is
`docs/acceptance-matrix.json`. `pnpm ops:verify` validates its tracked proof
paths, threshold objects, native consumer inputs, and CI artifact references;
it does not turn a `not_run`, `ci_required`, or `service_required` entry into a
green result.

## Fault matrix

`bench/operations/fault-matrix.json` is the review checklist for dependency and
failure injection. It covers lost 202 responses, worker termination after a
ClickHouse insert, PostgreSQL/ClickHouse/Redis outages, duplicates, reordering,
late events, explicit-ID conflicts, WhatsApp webhook replay, and tenant/privacy
boundaries. The existing infrastructure regression suite provides executable
coverage for the listed durable-ingestion cases; provider and sustained-load
cases require a configured non-production run and must be marked measured or
not run in their evidence manifest.

With the local stack and simulator enabled, `pnpm ops:whatsapp` runs the
handoff/Agent flow, masks synthetic PII, verifies takeover behavior, and replays
the same provider `messageId` to assert one inbound row and one local reply
attempt. It never calls the real WhatsApp provider.

## SLO starting points and runbooks

These are initial operational targets, not measured claims:

| Signal | Target | Page / response |
| --- | --- | --- |
| API availability | 99.9% monthly | inspect `/health`, dependency gauges, and deployment logs |
| accepted-event p95 | ≤ 500 ms under the declared ramp | check Postgres latency, pool saturation, and rate limits |
| pending oldest age | < 5 min | inspect worker health and dependency errors; pause producers if unbounded |
| dead-letter count | 0 sustained | fix root cause, then requeue only selected payload-bearing rows |
| masking/privacy | 0 raw secret or cross-tenant rows in evidence | stop the run, preserve the artifact, and investigate before retrying |

For an incident, preserve the run manifest and logs, check `/metrics` and the
metadata-only inbox query in `docs/RELIABILITY.md`, identify the failing
dependency, and avoid deleting pending/dead rows as a first response. After the
cause is fixed, requeue only explicitly selected rows and rerun reconciliation.
For a migration, follow the cutover procedure in `docs/RELIABILITY.md` before
starting new workers.

The current local evidence boundary and blockers are recorded in
[`docs/verification/2026-09-12.md`](verification/2026-09-12.md).
