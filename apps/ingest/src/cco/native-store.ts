import { nativeBuild } from "@tracki/shared/mobile-diagnostics";
import type postgres from "postgres";
import type { CcoConfig, Project } from "./config";
import { CcoError, digest, event, sessionRef } from "./contract";
import {
  classifyEvidence,
  compatibilityCounts,
  incidentIdentity,
  operationTimelines,
  releaseComparisons,
} from "./native-engine";
import {
  type NativeHealth,
  type NativeProtocol,
  nativeHealth,
  nativeProtocol,
} from "./native-meta";
import type {
  NativeDiagnosticEvent,
  NativeDiagnosticsSnapshot,
  NativeHealthRow,
  NativeIncident,
  NativeReadQuery,
  NativeSession,
} from "./native-read-model";
import type { TrustedBrowserScope } from "./trusted-browser";
type Sql = postgres.Sql | postgres.TransactionSql;
function storedHealth(value: unknown): NativeHealth {
  const observedAt =
    value && typeof value === "object"
      ? Number((value as Record<string, unknown>).observedAt)
      : Number.NaN;
  return nativeHealth(value, observedAt);
}
export type NativeAcceptanceMetadata = {
  project: Project;
  anonId: string;
  sessionId: string;
  scopeTag: string;
  protocol: NativeProtocol;
  build: ReturnType<typeof nativeBuild>;
  health: NativeHealth | null;
  firstSeen: number;
  lastSeen: number;
  receivedAt: number;
};

export async function ensureNativeDiagnostics(sql: Sql): Promise<void> {
  await sql`CREATE TABLE IF NOT EXISTS cco_native_sessions (
    org_id text NOT NULL, project_id text NOT NULL, session_ref text NOT NULL, account_id text NOT NULL,
    first_seen bigint NOT NULL, last_seen bigint NOT NULL, received_at bigint NOT NULL, body jsonb NOT NULL,
    PRIMARY KEY(org_id,project_id,session_ref))`;
  await sql`CREATE INDEX IF NOT EXISTS cco_native_sessions_context ON cco_native_sessions(project_id,account_id,last_seen DESC)`;
  await sql`CREATE TABLE IF NOT EXISTS cco_native_health (
    org_id text NOT NULL, project_id text NOT NULL, scope_tag text NOT NULL, reporter_id text NOT NULL,
    account_id text NOT NULL, session_ref text NOT NULL, revision bigint NOT NULL, observed_at bigint NOT NULL,
    received_at bigint NOT NULL, body jsonb NOT NULL, digest text NOT NULL,
    PRIMARY KEY(org_id,project_id,scope_tag,reporter_id))`;
  await sql`CREATE INDEX IF NOT EXISTS cco_native_health_context ON cco_native_health(project_id,account_id,received_at DESC)`;
  await sql`CREATE TABLE IF NOT EXISTS cco_native_incidents (
    incident_id text PRIMARY KEY, org_id text NOT NULL, project_id text NOT NULL, status text NOT NULL DEFAULT 'open',
    revision bigint NOT NULL DEFAULT 1, first_seen bigint NOT NULL, last_seen bigint NOT NULL, resolved_at bigint,
    occurrence_count bigint NOT NULL DEFAULT 1, body jsonb NOT NULL,
    CHECK(status IN ('open','acknowledged','resolved','reopened')))`;
  await sql`CREATE INDEX IF NOT EXISTS cco_native_incidents_time ON cco_native_incidents(project_id,last_seen DESC)`;
  await sql`CREATE TABLE IF NOT EXISTS cco_native_incident_contexts (
    incident_id text NOT NULL REFERENCES cco_native_incidents(incident_id) ON DELETE CASCADE,
    account_id text NOT NULL, PRIMARY KEY(incident_id,account_id))`;
  await sql`CREATE TABLE IF NOT EXISTS cco_native_incident_transitions (
    incident_id text NOT NULL REFERENCES cco_native_incidents(incident_id) ON DELETE CASCADE,
    revision bigint NOT NULL, status text NOT NULL, occurred_at bigint NOT NULL,
    PRIMARY KEY(incident_id,revision))`;
}

export async function appendNativeIncident(sql: Sql, e: NativeDiagnosticEvent): Promise<void> {
  const identity = incidentIdentity(e);
  if (!identity) return;
  const body = {
    appKey: e.appKey,
    environment: e.environment,
    projectId: e.projectId,
    route: e.route,
    operation: e.operation,
    errorCode: identity.errorCode,
    releases: e.release ? [e.release] : [],
    representativeEventId: e.eventId,
    sdkVersion: e.nativeProtocol?.sdkVersion ?? null,
    schemaVersion: e.nativeProtocol?.schemaVersion ?? null,
  };
  const rows =
    await sql`INSERT INTO cco_native_incidents(incident_id,org_id,project_id,first_seen,last_seen,body)
    VALUES(${identity.incidentId},${e.orgId},${e.projectId},${e.occurredAt},${e.occurredAt},${sql.json(body)})
    ON CONFLICT(incident_id) DO UPDATE SET occurrence_count=cco_native_incidents.occurrence_count+1,
      first_seen=LEAST(cco_native_incidents.first_seen,EXCLUDED.first_seen),last_seen=GREATEST(cco_native_incidents.last_seen,EXCLUDED.last_seen),
      status=CASE WHEN cco_native_incidents.status='resolved' AND EXCLUDED.last_seen>cco_native_incidents.resolved_at THEN 'reopened' ELSE cco_native_incidents.status END,
      revision=cco_native_incidents.revision+1 RETURNING status,revision`;
  if (e.accountId)
    await sql`INSERT INTO cco_native_incident_contexts(incident_id,account_id) VALUES(${identity.incidentId},${e.accountId}) ON CONFLICT DO NOTHING`;
  const current = rows[0];
  if (!current) throw new CcoError("native_incident_write_unconfirmed", 503);
  if (current.status === "reopened" || Number(current.revision) === 1)
    await sql`INSERT INTO cco_native_incident_transitions(incident_id,revision,status,occurred_at)
    VALUES(${identity.incidentId},${current.revision},${current.status},${e.occurredAt}) ON CONFLICT DO NOTHING`;
}

/** Called inside the same durable-inbox transaction, never after returning an ACK. */
export async function acceptNativeMetadata(
  sql: Sql,
  scope: TrustedBrowserScope,
  meta: NativeAcceptanceMetadata,
): Promise<void> {
  const ref = sessionRef(scope.orgId, scope.projectId, meta.anonId, meta.sessionId);
  const sessionBody = {
    appKey: meta.project.appKey,
    environment: meta.project.environment,
    installationId: scope.installationId,
    generation: scope.generation,
    build: meta.build,
    release: meta.build.updateId ?? meta.build.buildId ?? null,
    protocol: meta.protocol,
  };
  const sessionRows =
    await sql`INSERT INTO cco_native_sessions(org_id,project_id,session_ref,account_id,first_seen,last_seen,received_at,body)
    VALUES(${scope.orgId},${scope.projectId},${ref},${scope.accountId},${meta.firstSeen},${meta.lastSeen},${meta.receivedAt},${sql.json(sessionBody)})
    ON CONFLICT(org_id,project_id,session_ref) DO UPDATE SET
      first_seen=LEAST(cco_native_sessions.first_seen,EXCLUDED.first_seen),last_seen=GREATEST(cco_native_sessions.last_seen,EXCLUDED.last_seen),
      received_at=GREATEST(cco_native_sessions.received_at,EXCLUDED.received_at)
      WHERE cco_native_sessions.account_id=EXCLUDED.account_id AND cco_native_sessions.body=EXCLUDED.body RETURNING session_ref`;
  if (sessionRows.length !== 1) throw new CcoError("native_session_identity_conflict", 409);
  if (!meta.health) return;
  const h = meta.health;
  // Lock even the first report using a transaction advisory lock; prevents concurrent lower revision overwrites.
  await sql`SELECT pg_advisory_xact_lock(hashtextextended(${digest([scope.orgId, scope.projectId, meta.scopeTag, h.reporterId])},0))`;
  const old =
    await sql`SELECT revision,body,digest,account_id FROM cco_native_health WHERE org_id=${scope.orgId} AND project_id=${scope.projectId}
    AND scope_tag=${meta.scopeTag} AND reporter_id=${h.reporterId} FOR UPDATE`;
  const hash = digest(h);
  if (old[0]) {
    if (old[0].account_id !== scope.accountId)
      throw new CcoError("native_health_identity_conflict", 409);
    const revision = Number(old[0].revision);
    if (h.revision === revision) {
      if (old[0].digest !== hash) throw new CcoError("native_health_identity_conflict", 409);
      return;
    }
    if (h.revision < revision) return; // Reordered durable deliveries must not erase a newer health report.
    const previous = storedHealth(old[0].body);
    for (const key of [
      "observed",
      "sampledOut",
      "droppedCapacity",
      "droppedExpired",
      "rejected",
      "storageFailures",
      "unsupportedSchema",
      "accepted",
    ] as const)
      if (h[key] < previous[key]) throw new CcoError("native_health_counter_regression", 409);
  }
  await sql`INSERT INTO cco_native_health(org_id,project_id,scope_tag,reporter_id,account_id,session_ref,revision,observed_at,received_at,body,digest)
    VALUES(${scope.orgId},${scope.projectId},${meta.scopeTag},${h.reporterId},${scope.accountId},${ref},${h.revision},${h.observedAt},${meta.receivedAt},${sql.json(h)},${hash})
    ON CONFLICT(org_id,project_id,scope_tag,reporter_id) DO UPDATE SET revision=EXCLUDED.revision,observed_at=EXCLUDED.observed_at,
      received_at=EXCLUDED.received_at,session_ref=EXCLUDED.session_ref,body=EXCLUDED.body,digest=EXCLUDED.digest`;
}

export async function readNativeDiagnostics(
  sql: postgres.Sql,
  config: CcoConfig,
  q: NativeReadQuery,
): Promise<NativeDiagnosticsSnapshot> {
  const projects = config.projects.filter(
    (p) =>
      (!q.appKey || p.appKey === q.appKey) && (!q.environment || p.environment === q.environment),
  );
  const ids = projects.map((p) => p.projectId);
  const records =
    await sql`SELECT body FROM cco_records WHERE project_id=ANY(${ids}::text[]) AND event_time>=${q.since} AND event_time<=${q.now + 120000}
    AND (${q.accountId ?? null}::text IS NULL OR account_id=${q.accountId ?? null}) ORDER BY event_time DESC,event_id DESC LIMIT 2001`;
  const events: NativeDiagnosticEvent[] = records.slice(0, 2000).flatMap((r) => {
    try {
      const e = event(r.body);
      return projects.some(
        (p) =>
          p.orgId === e.orgId &&
          p.projectId === e.projectId &&
          p.appKey === e.appKey &&
          p.environment === e.environment,
      )
        ? [e]
        : [];
    } catch {
      return [];
    }
  });
  const sessionsRaw =
    await sql`SELECT s.*,h.body health FROM cco_native_sessions s LEFT JOIN LATERAL
    (SELECT body FROM cco_native_health h WHERE h.org_id=s.org_id AND h.project_id=s.project_id AND h.session_ref=s.session_ref ORDER BY received_at DESC LIMIT 1) h ON true
    WHERE s.project_id=ANY(${ids}::text[]) AND s.last_seen>=${q.since} AND s.last_seen<=${q.now + 120000}
      AND (${q.accountId ?? null}::text IS NULL OR s.account_id=${q.accountId ?? null}) ORDER BY s.last_seen DESC LIMIT 501`;
  const sessions: NativeSession[] = sessionsRaw.slice(0, 500).flatMap((r) => {
    const b = r.body as Record<string, unknown>;
    const project = projects.find(
      (p) =>
        p.orgId === r.org_id &&
        p.projectId === r.project_id &&
        p.appKey === b.appKey &&
        p.environment === b.environment,
    );
    if (!project) return [];
    const reportedHealth = r.health ? storedHealth(r.health) : null;
    const base: NativeSession = {
      sessionRef: String(r.session_ref),
      appKey: project.appKey,
      environment: project.environment,
      accountId: String(r.account_id),
      installationId: typeof b.installationId === "string" ? b.installationId : null,
      firstSeen: Number(r.first_seen),
      lastSeen: Number(r.last_seen),
      build: nativeBuild(b.build),
      release: typeof b.release === "string" ? b.release : null,
      protocol: nativeProtocol(b.protocol),
      evidenceHealth: "unavailable",
      receivedEventCount: events.filter(
        (e) => e.sessionRef === r.session_ref && e.source === "tracki.native",
      ).length,
      reportedHealth,
    };
    base.evidenceHealth = classifyEvidence([base], base.receivedEventCount, q.now).status;
    return [base];
  });
  const health: NativeHealthRow[] = projects.map((p) => {
    const scoped = sessions.filter((s) => s.appKey === p.appKey && s.environment === p.environment);
    const reports = scoped.flatMap((s) => (s.reportedHealth ? [s.reportedHealth] : []));
    // A reporter can span rotated sessions. Count its newest revision once.
    const unique = [
      ...new Map(
        reports.sort((a, b) => a.revision - b.revision).map((h) => [h.reporterId, h]),
      ).values(),
    ];
    const matchingEvents = events.filter(
      (e) => e.projectId === p.projectId && e.source === "tracki.native",
    );
    const counters = unique.length
      ? {
          observed: 0,
          sampledOut: 0,
          droppedCapacity: 0,
          droppedExpired: 0,
          rejected: 0,
          storageFailures: 0,
          unsupportedSchema: 0,
          accepted: 0,
          queueDepth: 0,
          queueBytes: 0,
          retryingCount: 0,
        }
      : null;
    if (counters)
      for (const h of unique)
        for (const key of Object.keys(counters) as Array<keyof typeof counters>)
          counters[key] += h[key];
    const max = (v: Array<number | undefined>) =>
      v.length ? Math.max(...v.map((x) => x ?? 0)) || null : null;
    const oldest = unique.flatMap((h) => (h.oldestQueuedAt ? [h.oldestQueuedAt] : []));
    return {
      appKey: p.appKey,
      environment: p.environment,
      projectId: p.projectId,
      accountId: q.accountId ?? null,
      ...classifyEvidence(scoped, matchingEvents.length, q.now),
      lastReceivedAt: max(matchingEvents.map((e) => e.receivedAt)),
      lastReportAt: max(unique.map((h) => h.observedAt)),
      lastSuccessfulDelivery: max(unique.map((h) => h.lastSuccessAt)),
      lastAttemptedDelivery: max(unique.map((h) => h.lastAttemptAt)),
      oldestQueuedAt: oldest.length ? Math.min(...oldest) : null,
      counters,
      collectorReceivedEvents: matchingEvents.length,
      reporterCount: unique.length,
      staleReporterCount: unique.filter((h) => h.observedAt < q.now - 20 * 60000).length,
      compatibility: compatibilityCounts(scoped.map((s) => s.protocol)),
      lastResponseCategory:
        unique.sort((a, b) => b.observedAt - a.observedAt)[0]?.lastResponseCategory ?? null,
    };
  });
  const rawIncidents =
    await sql`SELECT i.*, (SELECT count(*)::integer FROM cco_native_incident_contexts c WHERE c.incident_id=i.incident_id) affected_count
    FROM cco_native_incidents i WHERE i.project_id=ANY(${ids}::text[]) AND i.last_seen>=${q.since} AND i.last_seen<=${q.now + 120000}
    AND (${q.incidentId ?? null}::text IS NULL OR i.incident_id=${q.incidentId ?? null})
    AND (${q.accountId ?? null}::text IS NULL OR EXISTS(SELECT 1 FROM cco_native_incident_contexts c WHERE c.incident_id=i.incident_id AND c.account_id=${q.accountId ?? null}))
    ORDER BY i.last_seen DESC,i.incident_id DESC LIMIT 201`;
  const incidents: NativeIncident[] = [];
  for (const row of rawIncidents.slice(0, 200)) {
    const b = row.body as Omit<
      NativeIncident,
      | "incidentId"
      | "status"
      | "revision"
      | "firstSeen"
      | "lastSeen"
      | "occurrenceCount"
      | "affectedContextCount"
      | "affectedAccountIds"
      | "evidenceHealth"
    >;
    if (
      !projects.some(
        (p) =>
          p.orgId === row.org_id &&
          p.projectId === row.project_id &&
          p.appKey === b.appKey &&
          p.environment === b.environment,
      )
    )
      continue;
    const contexts = q.accountId
      ? [{ account_id: q.accountId }]
      : await sql`SELECT account_id FROM cco_native_incident_contexts WHERE incident_id=${row.incident_id} ORDER BY account_id LIMIT 100`;
    incidents.push({
      ...b,
      incidentId: String(row.incident_id),
      status: row.status as NativeIncident["status"],
      revision: Number(row.revision),
      firstSeen: Number(row.first_seen),
      lastSeen: Number(row.last_seen),
      occurrenceCount: q.accountId
        ? events.filter((e) => incidentIdentity(e)?.incidentId === row.incident_id).length
        : Number(row.occurrence_count),
      affectedContextCount: q.accountId ? 1 : Number(row.affected_count),
      affectedAccountIds: contexts.map((c) => String(c.account_id)),
      evidenceHealth: health.find((h) => h.projectId === row.project_id)?.status ?? "unavailable",
    });
  }
  const truncated = records.length > 2000 || sessionsRaw.length > 500 || rawIncidents.length > 200;
  const deliveryFailures = sessions
    .flatMap((s) => {
      const h = s.reportedHealth;
      if (!h || ["none", "accepted"].includes(h.lastResponseCategory)) return [];
      return [
        {
          appKey: s.appKey,
          environment: s.environment,
          accountId: s.accountId,
          category: h.lastResponseCategory,
          count: h.rejected + h.unsupportedSchema + h.storageFailures + h.retryingCount,
          remediation: deliveryRemediation(h.lastResponseCategory),
          observedAt: h.observedAt,
        },
      ];
    })
    .slice(0, 100);
  return {
    version: 1,
    generatedAt: q.now,
    windowStart: q.since,
    windowEnd: q.now,
    truncated,
    health,
    incidents,
    sessions,
    operations: operationTimelines(events),
    releases: releaseComparisons(
      events,
      q.baselineRelease,
      q.candidateRelease,
      q.since,
      q.now,
      truncated,
    ),
    deliveryFailures,
  };
}
export function deliveryRemediation(category: string): string {
  if (
    [
      "authentication_rejected",
      "context_unverified",
      "revoked_context",
      "environment_mismatch",
    ].includes(category)
  )
    return "verify_authentication_context_and_environment";
  if (category === "unsupported_schema") return "upgrade_supported_sdk";
  if (category === "payload_too_large") return "reduce_batch_budget";
  if (category === "local_storage_failure") return "restore_local_storage";
  if (category === "expired") return "discard_expired_evidence";
  if (category === "rate_limited") return "backoff_and_reduce_success_sampling";
  return "restore_connectivity_or_collector";
}
export async function setNativeIncidentStatus(
  sql: postgres.Sql,
  config: CcoConfig,
  incidentId: string,
  status: "open" | "acknowledged" | "resolved",
  revision: number,
  now: number,
): Promise<{ incidentId: string; status: string; revision: number }> {
  return sql.begin(async (tx) => {
    const rows =
      await tx`UPDATE cco_native_incidents SET status=${status},revision=revision+1,resolved_at=CASE WHEN ${status}='resolved' THEN ${now}::bigint ELSE NULL::bigint END
      WHERE incident_id=${incidentId} AND revision=${revision}
        AND EXISTS(SELECT 1 FROM jsonb_array_elements(${tx.json(config.projects.map((p) => ({ org: p.orgId, project: p.projectId })))}::jsonb) allowed
          WHERE allowed->>'org'=cco_native_incidents.org_id AND allowed->>'project'=cco_native_incidents.project_id) RETURNING revision`;
    if (!rows[0]) throw new CcoError("incident_revision_conflict_or_unavailable", 409);
    const next = Number(rows[0].revision);
    await tx`INSERT INTO cco_native_incident_transitions(incident_id,revision,status,occurred_at) VALUES(${incidentId},${next},${status},${now})`;
    return { incidentId, status, revision: next };
  }) as Promise<{ incidentId: string; status: string; revision: number }>;
}
