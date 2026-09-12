# Release risk register

This register applies to the operational-evidence and reliable-delivery
changes. Status is evidence-based; a documented procedure is not a completed
runtime test.

| Risk | Impact | Detection | Mitigation / response | Status |
| --- | --- | --- | --- | --- |
| PostgreSQL, Redis, or ClickHouse is unavailable during startup | Ingest cannot accept or process telemetry | `/health`, `pnpm ops:preflight`, dependency gauges | Keep producers stopped, restore the dependency, then rerun integration and reconciliation | Service run required |
| Crash after a ClickHouse insert | Physical duplicate rows or repeated detection writes | Reconciliation oracle and `FINAL`/identity-deduplicated reads | Keep deterministic event/struggle IDs, reconcile after recovery, do not claim physical exactly-once | Known boundary; controlled by design |
| Explicit event ID is reused with changed content | Conflicting behavioral data could overwrite the first event | HTTP 409 contract and `payload_hash` comparison | Reject the conflict; retain the first accepted payload/hash | Locally verified; database proof service-required |
| Legacy active Redis queues remain during cutover | New worker could process incompatible queue state | Startup refusal and legacy queue inspection | Drain with the old worker before migration; do not delete active work | Procedure documented |
| Privacy masking misses a novel PII form | Sensitive data could enter analytics or evidence | Privacy audit, redaction tests, artifact scan | Stop the run, preserve metadata, add a regression case, and rerun; do not treat masking as universal classification | Defense-in-depth; residual classifier risk remains |
| Tenant predicate is removed from an analytics query | Cross-project data disclosure | Static query audit and mocked ClickHouse contract | Require both `org_id` and `project_id` parameters; review all new analytics reads | Locally verified for current surface |
| Keyed benchmark saturates the local machine or dependency | Misleading latency or error conclusion | Aggregate metrics, resource metadata, error rate, saturation boundary | Report machine/stack, lower the level, and label the result non-production | Service run required |
| WhatsApp provider accepts an outbound message before a crash | Duplicate outbound message after retry | Local effect audit plus provider logs | Treat external delivery as at-least-once; reconcile by `effect_id` where provider support exists | Explicit product boundary |
| Native toolchain or browser dependency is absent | A local green result could omit a supported client | Native workflow artifact checks and E2E setup | Require the supported CI workflow and archive artifacts; do not claim local native verification | CI/service required |
| Migration is applied while writers are active | Lost or inconsistent telemetry during table exchange | Cutover checklist and migration logs | Stop producers/workers, back up stores, run one migration runner, retain rollback copies | Procedure documented |
| Rollback removes new columns or indexes | Older code cannot start or replay safely | Migration inventory and post-rollback health check | Roll back application image only; leave additive schema in place and reconcile | Procedure documented |

Owners should be assigned in the deployment environment before any production
canary. No risk in this document authorizes live traffic.
