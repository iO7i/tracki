-- Native diagnostics telemetry schema only. Idempotent, additive; no merchant app/business writes.
CREATE TABLE IF NOT EXISTS cco_native_sessions (
    org_id text NOT NULL, project_id text NOT NULL, session_ref text NOT NULL, account_id text NOT NULL,
    first_seen bigint NOT NULL, last_seen bigint NOT NULL, received_at bigint NOT NULL, body jsonb NOT NULL,
    PRIMARY KEY(org_id,project_id,session_ref));
CREATE INDEX IF NOT EXISTS cco_native_sessions_context ON cco_native_sessions(project_id,account_id,last_seen DESC);
CREATE TABLE IF NOT EXISTS cco_native_health (
    org_id text NOT NULL, project_id text NOT NULL, scope_tag text NOT NULL, reporter_id text NOT NULL,
    account_id text NOT NULL, session_ref text NOT NULL, revision bigint NOT NULL, observed_at bigint NOT NULL,
    received_at bigint NOT NULL, body jsonb NOT NULL, digest text NOT NULL,
    PRIMARY KEY(org_id,project_id,scope_tag,reporter_id));
CREATE INDEX IF NOT EXISTS cco_native_health_context ON cco_native_health(project_id,account_id,received_at DESC);
CREATE TABLE IF NOT EXISTS cco_native_incidents (
    incident_id text PRIMARY KEY, org_id text NOT NULL, project_id text NOT NULL, status text NOT NULL DEFAULT 'open',
    revision bigint NOT NULL DEFAULT 1, first_seen bigint NOT NULL, last_seen bigint NOT NULL, resolved_at bigint,
    occurrence_count bigint NOT NULL DEFAULT 1, body jsonb NOT NULL,
    CHECK(status IN ('open','acknowledged','resolved','reopened')));
CREATE INDEX IF NOT EXISTS cco_native_incidents_time ON cco_native_incidents(project_id,last_seen DESC);
CREATE TABLE IF NOT EXISTS cco_native_incident_contexts (
    incident_id text NOT NULL REFERENCES cco_native_incidents(incident_id) ON DELETE CASCADE,
    account_id text NOT NULL, PRIMARY KEY(incident_id,account_id));
CREATE TABLE IF NOT EXISTS cco_native_incident_transitions (
    incident_id text NOT NULL REFERENCES cco_native_incidents(incident_id) ON DELETE CASCADE,
    revision bigint NOT NULL, status text NOT NULL, occurred_at bigint NOT NULL,
    PRIMARY KEY(incident_id,revision));
