# Native diagnostics collector

The authoritative read model is `/internal/cco/native-diagnostics`, protected by the existing server-only reader key. Watchtower authenticates the operator and checks `support.view` before proxying a read. Status mutations use `/internal/cco/native-incidents/:incidentId/status`; Watchtower also requires `support.operate`, a same-origin request, and the incident's current revision. The collector never exposes keys to native apps.

## Storage and upgrade

Apply `src/cco/migrations/001_native_diagnostics.sql` to the collector telemetry database. `scripts/migrate-native-diagnostics.ts` requires explicit `DATABASE_URL` and `TRACKI_APPLY_NATIVE_MIGRATION=yes`. The existing collector startup also applies these idempotent additive definitions. There are no merchant application table writes. The native health and session records expire under existing CCO retention; incident context/status history follows incident retention.

ClickHouse migration 007 adds sanitized build/schema/sampling analytics projections. It does not become the authority for merchant binding, health, or incident status. No destructive migration or historical backfill is automatic. Existing native history without health reports remains `unavailable` or `collector-only`; it is not described as complete.

## Health and trust

Only an authenticated app server producer can submit `/internal/cco/native-batches` or `/internal/cco/native-health`. Native public keys cannot assert merchant identity. The collector verifies configured app/environment and the producer's authorized human binding, immutable session build/protocol/installation/generation, event and report times, and the canonical allowlist. Health reports are cumulative and deduplicated by verified scope/reporter/revision. A changed body at the same revision or regressed counters rejects the whole transaction.

Reports describe client observations and app-backend outbox acknowledgments. `collectorReceivedEvents` describes actual collector persistence separately. A recent report with no known loss is bounded observation, not proof of uninterrupted capture or absence of incidents. Health becomes stale after 20 minutes (maximum supported 15-minute heartbeat plus 5-minute grace). Unsupported bootstraps are outside the accepted stream, so their compatibility count is unknown (`null`); client-reported unsupported-schema counters remain visible.

## Correlation and incidents

Request, business operation, asynchronous job and final readback IDs join only inside the verified organization/project/account/installation/generation/app/environment boundary. HTTP 200 or a successful enqueue does not establish business success. Only a server-reported terminal readback can confirm a final business outcome. Missing links remain an incomplete chain.

Failure groups are deterministic across operation, normalized route, fixed code, app/environment, release, SDK/schema and optional sanitized fingerprint. Accepted event IDs increment counts once. Status changes use revision fencing. A resolved incident reopens only when a newly accepted failure occurred after its resolution; delayed older evidence cannot reopen it. Global counts cover retained incident history; account-filtered counts cover matching observed events in the current bounded window.

## Bounded reads and release comparisons

Reads span at most 30 days, fetch at most 2,000 events, 500 sessions and 200 incidents, and report truncation. Operation timelines contain at most 100 entries. Release comparisons require explicit baseline/candidate, matching app/environment/normalized route/window, at least 30 terminal requests per release, and known per-event sampling probability. Inverse sampling weights adjust estimated failure rates. Observed latency is not sample-adjusted. Truncated or insufficient reads cannot establish a regression. Comparisons never establish causation.

## Local BATCH fixture

`scripts/native-local-collector.ts` listens only at `127.0.0.1:5490` and creates a separate in-memory PostgreSQL engine. It submits clearly synthetic fixtures through real authenticated routes and durable acceptance, including job failure and final readback success. Reader credentials go to a local evidence env file outside the repository. This is not production telemetry or production sign-in.
