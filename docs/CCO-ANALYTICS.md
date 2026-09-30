# Dedicated CCO analytics worker

Run the existing durable inbox detector independently from the authenticated
collector. Use `railway.cco-worker.json` with the same immutable source revision
as the collector. Do not mount public snippet, assistance, or product APIs.

Required configuration:

- `NODE_ENV=production`, the collector's telemetry `DATABASE_URL`, and its
  authenticated CCO project configuration.
- `CLICKHOUSE_URL`, `CLICKHOUSE_USER`, `CLICKHOUSE_PASSWORD`, and `CLICKHOUSE_DB`
  for a dedicated internal ClickHouse service with persistent storage.
- `TELEMETRY_RETENTION_DAYS=30` to match collector retention.
- `CCO_RELEASE_SHA` identifying the deployed source archive.

The entry point applies idempotent ClickHouse migrations before starting the
existing transaction-owned worker. It preserves per-project ordering, retries,
dead letters, stable analytics IDs, and derived CCO projections. Redis live
assistance is disabled for this diagnostics process. Other worker entry points
retain their existing assistance behavior.

Keep the worker and ClickHouse on the private service network without public
domains or TCP proxies. `/health` reports storage availability and durable inbox
counts. Verify real accepted inbox records complete and ClickHouse rows persist
before claiming analytics processing is live.

Set `TRACKI_CCO_ANALYTICS_WORKER=external` on the collector only after the worker
is verified. Collector health then reports `external-configured`; it does not
claim to measure the separate worker's liveness. Watchtower's pending and dead
letter counts remain the processing evidence.
