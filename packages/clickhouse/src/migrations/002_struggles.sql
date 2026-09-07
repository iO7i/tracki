CREATE TABLE IF NOT EXISTS struggles (
  org_id String,
  project_id String,
  anon_id String,
  user_id String,
  session_id String,
  struggle_id String,
  type LowCardinality(String),
  severity LowCardinality(String),
  path String,
  reason String,
  event_count UInt32,
  ts DateTime64(3)
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(ts)
ORDER BY (org_id, project_id, ts);
