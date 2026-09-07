-- Mobile Journey Intelligence (implementation): device context, denormalized per row
-- so revenue/recovery can be cut by app version and device type without joins.
-- '' = pre-implementation rows (web); the ingest stamps 'web' or 'ios'/'android' now.
-- Idempotent ADDs so re-running is safe.
ALTER TABLE events ADD COLUMN IF NOT EXISTS platform LowCardinality(String) DEFAULT '';
ALTER TABLE events ADD COLUMN IF NOT EXISTS app_version String DEFAULT '';
ALTER TABLE events ADD COLUMN IF NOT EXISTS device_model String DEFAULT '';
ALTER TABLE struggles ADD COLUMN IF NOT EXISTS platform LowCardinality(String) DEFAULT '';
ALTER TABLE struggles ADD COLUMN IF NOT EXISTS app_version String DEFAULT '';
