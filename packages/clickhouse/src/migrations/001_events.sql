CREATE TABLE IF NOT EXISTS events (
  org_id String,
  project_id String,
  anon_id String,
  user_id String,
  session_id String,
  event_id String,
  type LowCardinality(String),
  path String,
  url String,
  referrer String,
  props String,
  ua String,
  ts DateTime64(3),
  received_at DateTime64(3)
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(ts)
ORDER BY (org_id, project_id, ts);
