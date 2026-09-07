-- Audit B1: make event ingestion idempotent so crash-recovery re-inserts don't
-- create duplicate rows. ReplacingMergeTree collapses rows with the same sorting
-- key (event_id included); reads use count(DISTINCT event_id) / LIMIT 1 BY
-- event_id to stay exact before background merges run.
-- (Dev: recreate the table. Pre-production, disposable event data.)
DROP TABLE IF EXISTS events;

CREATE TABLE events (
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
ENGINE = ReplacingMergeTree
PARTITION BY toYYYYMM(ts)
ORDER BY (org_id, project_id, ts, event_id);
