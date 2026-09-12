# Release, migration, rollback, and verification checklist

Use this checklist for the operational-evidence branch and any release that
includes reliable ingestion, tenant/privacy guards, or WhatsApp replay keys.

## Verification before merge

- [ ] `pnpm ops:verify`
- [ ] `pnpm ops:privacy-audit`
- [ ] `pnpm lint`
- [ ] `pnpm check-types`
- [ ] `pnpm test`
- [ ] Three deterministic 10,000-iteration fuzz seeds are green.
- [ ] Versioned holdout report and manifest are present; quality thresholds are
      approved before turning synthetic quality into a product gate.
- [ ] CI uploads behavioral and privacy evidence with
      `if-no-files-found: error`.
- [ ] Supported native consumer workflow is green with all expected artifacts.

## Migration notes

1. Back up PostgreSQL and ClickHouse and validate a staging restore.
2. Stop producers and old workers. Drain `events:buffer` and
   `events:processing`; review `events:dead` separately.
3. Run `pnpm db:migrate`. Migration `0013_idempotent_whatsapp.sql` adds nullable
   `wa_messages.provider_message_id` and `effect_id`, plus partial unique
   indexes. It is additive and safe for older application binaries.
4. Start the new ingest code once to run `ensureInbox`. It creates the durable
   inbox/state tables and adds nullable `telemetry_inbox.payload_hash` when
   missing. Existing rows without a hash retain legacy duplicate-only behavior
   until an explicit backfill is approved.
5. Run `pnpm ch:migrate` with all writers stopped. The runner safely intercepts
   the historical `003_events_dedup.sql` destructive operation, performs the
   table-copy/atomic-exchange path, and retains rollback copies. Do not execute
   the historical SQL file manually.
6. Start the new worker/API, verify `/health`, acceptance, queue drain,
   read-time deduplication, and reconciliation before resuming traffic.

## Canary verification

- [ ] Use a dedicated non-production project/key and synthetic payloads.
- [ ] Record image digest, migration result, health response, `/metrics`,
      pending oldest age, dead-letter count, and ClickHouse error counters.
- [ ] Run `docs/SERVICE-VERIFICATION.md` gates appropriate to the environment.
- [ ] Archive the raw artifacts and metadata-only index under a named release
      directory.
- [ ] Obtain explicit promotion approval after the reconciliation result is
      reviewed.

## Rollback

1. Stop new producers and pause the new worker. Keep all Postgres, ClickHouse,
   and Redis volumes intact.
2. Pin the last known-good application image and restart the API/worker. Do not
   remove the additive columns, unique indexes, inbox hash column, or retained
   ClickHouse rollback copies; older binaries can ignore the new fields.
3. Check `/health`, pending/dead-letter metadata, and provider/local effect
   records. Reconcile the canary project before resuming traffic.
4. If rows are pending, fix the dependency or code cause first. Requeue only an
   explicitly selected dead row whose payload still exists; never bulk-delete
   pending or dead telemetry as a first response.
5. Preserve migration logs, manifests, and the first failing metrics snapshot.
   Removing rollback copies or changing retention is a separate approved
   operation.

The external WhatsApp boundary remains at-least-once across a process crash;
application rollback cannot make a provider-side accepted message exactly once.

## Release record

Record the following in the release ticket or PR:

- Base and release commit SHAs, branch, and CI run URL.
- Migration start/end and result, image digest, environment name, and operator.
- Exact service-backed command set and evidence manifest paths.
- Threshold result for p95/error rate, queue age, dead letters, reconciliation,
  privacy audit, and native artifacts.
- Any skipped or unavailable gate with the blocker and next action. A skipped
  service/native/live gate is not a green release claim.
