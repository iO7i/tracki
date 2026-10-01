import type postgres from "postgres";
import type { CcoConfig, Project } from "./config";
import {
  CcoError,
  type CcoEvent,
  type CcoSnapshot,
  canonical,
  correlationId,
  digest,
  event,
  id,
  integer,
  object,
  sessionRef,
} from "./contract";
import { appendNativeIncident, ensureNativeDiagnostics } from "./native-store";
export type Binding = {
  orgId: string;
  projectId: string;
  appKey: string;
  environment: string;
  sessionRef: string;
  accountId: string;
  installationId: string | null;
  generation: number | null;
  validFrom: number;
  expiresAt: number;
};
export interface CcoStore {
  append(events: CcoEvent[]): Promise<void>;
  bind(binding: Binding): Promise<void>;
  snapshot(
    config: CcoConfig,
    accountId: string | null,
    since: number,
    now: number,
  ): Promise<CcoSnapshot>;
}
export function parseBinding(value: unknown, scope: Project, now = Date.now()): Binding {
  const r = object(value);
  const accountId = id(r.accountId);
  const validFrom = integer(r.validFrom, now - 1800000, now + 120000);
  const expiresAt = integer(r.expiresAt, validFrom + 1, now + 86400000);
  const installationId = r.installationId == null ? null : id(r.installationId);
  const generation = r.generation == null ? null : integer(r.generation);
  return {
    orgId: scope.orgId,
    projectId: scope.projectId,
    appKey: scope.appKey,
    environment: scope.environment,
    sessionRef: sessionRef(
      scope.orgId,
      scope.projectId,
      correlationId(r.anonId),
      correlationId(r.sessionId),
    ),
    accountId,
    installationId,
    generation,
    validFrom,
    expiresAt,
  };
}
export async function ensureCco(sql: postgres.Sql): Promise<void> {
  await sql`CREATE TABLE IF NOT EXISTS cco_bindings (
    org_id text NOT NULL, project_id text NOT NULL, session_ref text NOT NULL,
    account_id text NOT NULL, valid_from bigint NOT NULL, expires_at bigint NOT NULL,
    body jsonb NOT NULL, digest text NOT NULL, PRIMARY KEY(org_id,project_id,session_ref))`;
  await sql`CREATE INDEX IF NOT EXISTS cco_bindings_account ON cco_bindings(account_id,project_id)`;
  await sql`CREATE TABLE IF NOT EXISTS cco_records (
    org_id text NOT NULL, project_id text NOT NULL, event_id text NOT NULL,
    account_id text, session_ref text, event_time bigint NOT NULL, received_at bigint NOT NULL,
    body jsonb NOT NULL, digest text NOT NULL, PRIMARY KEY(org_id,project_id,event_id))`;
  await sql`CREATE INDEX IF NOT EXISTS cco_records_time ON cco_records(project_id,event_time DESC)`;
  await sql`CREATE INDEX IF NOT EXISTS cco_records_session ON cco_records(project_id,session_ref,event_time)`;
  await sql`CREATE INDEX IF NOT EXISTS cco_records_account ON cco_records(account_id,event_time DESC)`;
  await ensureNativeDiagnostics(sql);
}
/** Caller may pass the EXISTING inbox transaction: CCO acceptance is atomic with telemetry acceptance. */
export async function appendCco(
  tx: postgres.TransactionSql | postgres.Sql,
  events: CcoEvent[],
): Promise<void> {
  for (const e of [...events].sort((a, b) =>
    canonical([a.orgId, a.projectId, a.eventId]).localeCompare(
      canonical([b.orgId, b.projectId, b.eventId]),
    ),
  )) {
    const payloadHash = digest({ ...e, receivedAt: 0 });
    const inserted =
      await tx`INSERT INTO cco_records(org_id,project_id,event_id,account_id,session_ref,event_time,received_at,body,digest)
      VALUES(${e.orgId},${e.projectId},${e.eventId},${e.accountId},${e.sessionRef},${e.occurredAt},${e.receivedAt},${tx.json(e as unknown as postgres.JSONValue)},${payloadHash})
      ON CONFLICT DO NOTHING RETURNING event_id`;
    if (!inserted.length) {
      const old =
        await tx`SELECT digest FROM cco_records WHERE org_id=${e.orgId} AND project_id=${e.projectId} AND event_id=${e.eventId}`;
      if (old[0]?.digest !== payloadHash) throw new CcoError("cco_event_identity_conflict", 409);
    } else await appendNativeIncident(tx, e);
  }
}
export class PostgresCcoStore implements CcoStore {
  constructor(private sql: postgres.Sql) {}
  async append(events: CcoEvent[]): Promise<void> {
    await this.sql.begin(async (tx) => {
      await appendCco(tx, events);
    });
  }
  async bind(b: Binding): Promise<void> {
    const h = digest(b);
    await this.sql.begin(async (tx) => {
      const inserted =
        await tx`INSERT INTO cco_bindings(org_id,project_id,session_ref,account_id,valid_from,expires_at,body,digest)
        VALUES(${b.orgId},${b.projectId},${b.sessionRef},${b.accountId},${b.validFrom},${b.expiresAt},${tx.json(b as unknown as postgres.JSONValue)},${h})
        ON CONFLICT DO NOTHING RETURNING session_ref`;
      if (!inserted.length) {
        const old =
          await tx`SELECT digest FROM cco_bindings WHERE org_id=${b.orgId} AND project_id=${b.projectId} AND session_ref=${b.sessionRef}`;
        if (old[0]?.digest !== h) throw new CcoError("cco_binding_conflict_rotate_session", 409);
      }
    });
  }
  async snapshot(
    config: CcoConfig,
    accountId: string | null,
    since: number,
    now: number,
  ): Promise<CcoSnapshot> {
    const sql = this.sql;
    const projectIds = config.projects.map((p) => p.projectId);
    // Project IDs are configured, never selected by public browser input.
    const result = await sql`SELECT r.body, r.received_at, b.body binding
      FROM cco_records r LEFT JOIN cco_bindings b ON b.org_id=r.org_id AND b.project_id=r.project_id
        AND b.session_ref=r.session_ref AND r.event_time>=b.valid_from AND r.event_time<b.expires_at
      WHERE r.project_id=ANY(${projectIds}::text[]) AND r.event_time>=${since} AND r.event_time<=${now + 120000}
        AND (${accountId}::text IS NULL OR coalesce(r.account_id,b.account_id)=${accountId})
      ORDER BY r.event_time DESC,r.event_id DESC LIMIT 1001`;
    const events: CcoEvent[] = [];
    for (const row of result.slice(0, 1000)) {
      let e = event(row.body);
      const scope = config.projects.find((p) => p.projectId === e.projectId && p.orgId === e.orgId);
      if (!scope || e.environment !== scope.environment || e.appKey !== scope.appKey) continue;
      if (!e.accountId && row.binding) {
        const b = row.binding as Binding;
        e = {
          ...e,
          accountId: b.accountId,
          installationId: b.installationId,
          generation: b.generation,
        };
      }
      // Never present unrelated/unbound browser events as a known account.
      if (accountId && e.accountId !== accountId) continue;
      events.push(e);
    }
    let pending: number | null = null;
    let deadLetters: number | null = null;
    let oldestPendingAt: number | null = null;
    try {
      const rows =
        await sql`SELECT count(*) FILTER(WHERE completed_at IS NULL AND dead_at IS NULL)::int pending,
      count(*) FILTER(WHERE dead_at IS NOT NULL)::int dead, min(created_at) FILTER(WHERE completed_at IS NULL AND dead_at IS NULL) oldest
      FROM telemetry_inbox WHERE project_id=ANY(${projectIds}::text[])`;
      pending = Number(rows[0]?.pending ?? 0);
      deadLetters = Number(rows[0]?.dead ?? 0);
      oldestPendingAt = rows[0]?.oldest ? new Date(rows[0].oldest as string).getTime() : null;
    } catch {
      /* Standalone CCO source can exist without the legacy inbox. */
    }
    return {
      version: 1,
      generatedAt: now,
      windowStart: since,
      events,
      truncated: result.length > 1000,
      coverage: {
        status: "available",
        reason:
          "Bounded read of durably accepted evidence; browser silence is not proof of inactivity.",
        lastReceivedAt: events.length ? Math.max(...events.map((e) => e.receivedAt)) : null,
        pending,
        deadLetters,
        oldestPendingAt,
      },
    };
  }
}
