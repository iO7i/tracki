# Telemetry reliability and operations

## Acceptance and identity

The browser and TypeScript mobile core assign an `eventId` before the first send. Clients must reuse it for every retry and never reuse it for a different event. Ingress derives a deterministic identity from organization, project, and client event ID. A PostgreSQL unique constraint accepts each identity once, including overlapping concurrent batches. The first accepted payload and normalized timestamps win. HTTP 202 follows the acceptance transaction, not completion of analytics processing. An unknown public key retains the existing non-disclosing 202 response but does not accept telemetry.

Legacy clients without IDs remain supported: a canonical event fingerprint, envelope `sentAt`, and identical-event occurrence index identify exact-envelope retries. Two identical events in one legacy batch remain distinct. Arbitrary rebatching or changing `sentAt` cannot guarantee legacy idempotency; upgrade clients for that guarantee. Swift, Kotlin, and Flutter sources have not been compile-verified or upgraded to this identity extension.

Completed ledger rows retain identities indefinitely and clear their payload. This prevents resurrection after ClickHouse retention. Capacity planning and explicit project-erasure cleanup are necessary; there is no automatic foreign-key cascade for telemetry tables. Do not prune the ledger while claiming indefinite replay protection. PostgreSQL must use durable storage, normal WAL/synchronous commit, backups, and an appropriate recovery policy; the application cannot preserve data across loss of that database.

## Ownership, recovery, and ordering

The worker owns a row through a PostgreSQL transaction row lock. A project-scoped advisory transaction lock serializes detector updates; other projects can progress concurrently. The earliest pending event in a project blocks newer work in that project even while its retry is delayed. Detector state, watermark, and completion commit together only after both ClickHouse writes succeed. Connection loss rolls back state and releases ownership. SQL statements time out after 30 seconds and idle transactions after 60 seconds; host/network failure detection can add transport latency.

ClickHouse cannot participate in the PostgreSQL transaction. A crash after a ClickHouse insert can therefore leave repeated physical rows. Event and detection identities are deterministic, the tables use ReplacingMergeTree, and the application's ClickHouse client explicitly enables `final=1` for read-time deduplication. Correctness does not wait for background merges. External queries must also use `FINAL` or equivalent explicit identity deduplication. This is one effective analytics record, not a claim of one physical insert or distributed exactly-once delivery.

Handled failures retry with exponential delays starting at two seconds. After five failures the item is dead-lettered and no longer blocks its project. Abrupt process/database failures can occur before retry accounting; the record stays pending. Dead-letter payloads expire after seven days; detector state expires after 48 hours of inactivity. Maintenance runs approximately every five minutes while a worker runs. Completed/dead identity metadata remains.

Monitor pending age, dead-letter count, attempts, database size, worker health, and ClickHouse errors. Operators can inspect metadata without logging payloads:

```sql
SELECT project_id, event_id, attempts, created_at, dead_at
FROM telemetry_inbox
WHERE completed_at IS NULL
ORDER BY created_at;
```

After fixing the underlying cause, requeue only an explicitly selected dead item whose payload still exists:

```sql
UPDATE telemetry_inbox
SET attempts=0, dead_at=NULL, available_at=now()
WHERE project_id = '<project>' AND event_id = '<event>'
  AND dead_at IS NOT NULL AND payload IS NOT NULL;
```

An older requeued event is still subject to the watermark policy. Recomputing historical detections is not implemented. Live Redis notifications, contextual assistance, and identity-profile enrichment remain best effort and are outside the durable analytics transaction. They are not an external-message delivery guarantee.

## Time and session trust

`ts` is validated event time; `received_at` is server acceptance time. Inbox `created_at` and `completed_at` expose queue/processing timing. Required timestamps must be positive safe integers. Events older than 24 hours or more than two minutes ahead of arrival are rejected with HTTP 400; missing/malformed timestamps are not silently replaced. A positive envelope clock skew of up to two minutes is subtracted uniformly, preserving event spacing. Negative skew remains part of event time and the age limit. Keep client clocks synchronized.

Pending work is ordered by event time and identity. Across requests, an event older than the already-processed visitor watermark is retained for analytics but excluded from detection; there is no unbounded reorder buffer or retroactive correction. Equal timestamps use deterministic identity order. All detectors use event time: click/error/submit/navigation windows, OTP, biometric/payment failures, cold restarts, permission denial, and debounce flags. Onboarding abandonment requires an explicit supported `flow_abandon` event; it is not inferred from silence. The legacy `dead_click` wire name means repeated clicks on a non-native-control tag. It does not establish that the element was unresponsive.

Anonymous/session IDs are 1–64 ASCII letters, digits, underscores, or hyphens. They are untrusted correlation identifiers, not authentication credentials. State includes tenant/project and visitor/session scope; restart windows deliberately span a visitor's sessions within that project. A public collection key cannot authenticate an end user or prevent forged behavioral events within its own project. Server-resolved project scope is never taken from client session text.

## Privacy and browser delivery

Sensitive-key redaction is independent of value-pattern matching and handles casing and separator variants recursively. Passwords, tokens, authorization, cookies, API/private keys, and secrets are redacted even when opaque. Existing email, phone, card, and JWT patterns remain. URL query keys/values are inspected with bounded decoding while harmless query structure is preserved. Traversal is limited to eight levels, 512 nodes, and 100 members per container; strings are bounded. This is defense in depth, not a universal PII classifier. Never intentionally put personal information in identifiers, arbitrary field names, or URLs; do not send secrets at all.

The browser scrubs before persisting. A consent-granted queue keeps at most 200 events / 48,000 UTF-8 bytes, expires events after 23 hours, and rejects oversized individual events. Oldest events are evicted at the bounds. HTTP success removes acknowledged IDs only; errors retain them. Fetch aborts after ten seconds. Retry delay grows exponentially to a 60-second base with ±25% jitter; `online` requests an immediate attempt. There is no retry-count eviction. Invalid requests can remain until the bounded queue expires.

`sendBeacon(true)` means accepted by the browser, not acknowledged by the API: those events remain persisted for later idempotent retry. Rejected/throwing beacon attempts fall back to fetch. Page close is best effort. Browser quota/private-mode restrictions fall back to memory; closing a page can then lose pending events. Local persistence is not a guaranteed archive, and simultaneous tabs sharing a storage key are not coordinated. Consent pending does not transmit persisted events. Denied/revoked consent clears queued data and suppresses retries and late response handlers; an already-issued network request cannot be recalled. Host applications must propagate consent changes to their active pages.

## Existing-deployment cutover and retention

1. Back up PostgreSQL and ClickHouse and validate recovery in staging. Reserve space for a full telemetry table copy. Use an Atomic ClickHouse database and a single migration runner.
2. Stop incoming producers. Drain `events:buffer` and `events:processing` with the old worker and verify both are empty. Review `events:dead` separately; this release does not silently import or delete legacy dead letters. New ingestion refuses to start with a nonempty legacy active queue.
3. Stop all old workers. Run `pnpm ch:migrate` with the new code. Do not run historical SQL files manually: `003_events_dedup.sql` contains the old destructive operation and is retained only as historical evidence. The runner intercepts it with a safe table-copy/atomic-exchange upgrade. It also upgrades the detection table, retaining old tables as `events_before_reliable_delivery` and `struggles_before_reliable_delivery` for rollback. Never run the copy while writers are active.
4. Start new ingestion/workers; inbox schema creation is idempotent. Verify acceptance, drain progress, detector output, and read-time deduplication before resuming traffic. Keep rollback copies until validation completes; remove them only through an explicitly approved operational change.

`TELEMETRY_RETENTION_DAYS` defaults to 90, accepts integers 1–3650, and is applied by rerunning the migration command. Events expire by `received_at`; detections expire by event `ts`. The same policy applies to retained migration backups. Existing tenant/project/time sorting and monthly partitions remain. ClickHouse TTL deletes asynchronously during merges, not precisely at the expiration instant. Backups outside ClickHouse need their own retention policy. PostgreSQL pending payloads remain until processing or dead-letter cleanup; TTL is not a blanket application-data erasure policy.

## Verification boundaries

CI runs lint, type checks, unit regressions, production build, real PostgreSQL/Redis/ClickHouse regressions, and Chromium E2E. Infrastructure tests cover concurrent replay, partial retries, normalization-to-detection timing, masking, worker ownership, rollback after insert, terminated database connections, detection-write recovery, late events, dead letters, isolation, and populated legacy migration. Browser tests include a deliberate HTTP outage followed by a real ingestion retry. Hosted model accuracy, external messaging delivery, native toolchain builds, sustained load, disaster recovery, and simultaneous-tab persistence are not established by these tests. No production throughput benchmark is claimed.
