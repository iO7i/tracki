-- Additive analytics projections from collector-sanitized metadata; no UI/input/body capture.
-- Authoritative health, incident lifecycle, and merchant binding remain in collector PostgreSQL.
-- Empty build/version and zero sample probability mean unavailable, never a measured zero rate.
ALTER TABLE events ADD COLUMN IF NOT EXISTS native_sdk_version String MATERIALIZED JSONExtractString(props, 'ccoProtocol', 'sdkVersion');
ALTER TABLE events ADD COLUMN IF NOT EXISTS native_schema_version UInt8 MATERIALIZED JSONExtractUInt(props, 'ccoProtocol', 'schemaVersion');
ALTER TABLE events ADD COLUMN IF NOT EXISTS native_build_id String MATERIALIZED JSONExtractString(props, 'ccoBuild', 'buildId');
ALTER TABLE events ADD COLUMN IF NOT EXISTS native_runtime_version String MATERIALIZED JSONExtractString(props, 'ccoBuild', 'runtimeVersion');
ALTER TABLE events ADD COLUMN IF NOT EXISTS native_update_id String MATERIALIZED JSONExtractString(props, 'ccoBuild', 'updateId');
ALTER TABLE events ADD COLUMN IF NOT EXISTS native_sample_rate Float64 MATERIALIZED JSONExtractFloat(props, 'ccoSampleRate');
