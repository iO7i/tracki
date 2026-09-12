# Pull request description — operational evidence and delivery hardening

## Summary

This change turns the Tracki reliability and operational claims into a
reviewable evidence surface. It adds stable-ID/protocol contracts, durable
ingestion conflict handling, deterministic fuzz/holdout/ramp harnesses, native
consumer workflow contracts, WhatsApp replay protection, privacy/tenant
regression checks, and release/service runbooks.

## What changed

- Added a dependency-free privacy audit that checks runtime log arguments,
  aggregate-only metrics, parameterized tenant predicates in ClickHouse reads,
  sensitive bench output, and generated evidence for common PII/secret forms.
- Added `privacy.contract.test.ts` covering ingestion masking, metric redaction,
  and mocked tenant-scoped ClickHouse reads.
- Removed raw URL/props/query output from privacy-sensitive integration checks
  and made startup/migration/webhook errors generic.
- Added idempotent `ops:seed` fixtures for two synthetic benchmark tenants and
  an executable service-backed verification runbook.
- Added the release checklist, rollback/migration notes, risk register, and
  ready-to-paste evidence/limitations text.

## Verification

Locally available on the isolated branch:

- `node bench/operations/privacy-audit.mjs --output=evidence/privacy-audit/current`
- `pnpm --filter @tracki/ingest exec vitest run src/privacy.contract.test.ts`
- Existing unit, fuzz, holdout, workflow-contract, and evidence-index checks
  from `docs/verification/2026-09-12.md`.

Requires service/native/browser environments before the corresponding claim is
green:

- PostgreSQL/Redis/ClickHouse integration suite and WhatsApp simulator.
- Keyed HTTP ramp and reconciliation against the full stack.
- Playwright Chromium run.
- Flutter, Swift, and Android consumer workflow.
- Any deployment or canary.

## Risk and rollout

The primary residual risks are documented in `docs/RISK-REGISTER.md`. The
ClickHouse path remains physically at-least-once with read-time identity
deduplication, and external WhatsApp delivery remains at-least-once across a
crash window. Migrations are additive on PostgreSQL; ClickHouse migration must
run with writers stopped and rollback copies retained.

Use `docs/SERVICE-VERIFICATION.md` for the non-production run, then
`docs/RELEASE-CHECKLIST.md` for promotion or rollback evidence. No live
deployment, real WhatsApp traffic, or customer data is part of this PR.
