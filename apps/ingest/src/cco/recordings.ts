import { gunzipSync } from "node:zlib";
import type postgres from "postgres";
import type { CcoConfig, Project } from "./config";
import { CcoError, correlationId, digest, integer, object, sessionRef } from "./contract";
import type { TrustedBrowserScope } from "./trusted-browser";

export function visualProps(value: unknown): Record<string, unknown> {
  const p = object(value);
  if (
    p.name !== "cco_visual_chunk" ||
    typeof p.data !== "string" ||
    !/^[A-Za-z0-9+/=]{1,6000}$/.test(p.data)
  )
    throw new CcoError("invalid_visual_chunk");
  const part = integer(p.part, 0, 511);
  const parts = integer(p.parts, 1, 512);
  if (part >= parts) throw new CcoError("invalid_visual_part");
  return {
    name: p.name,
    recordingId: correlationId(p.recordingId),
    segmentId: correlationId(p.segmentId),
    sequence: integer(p.sequence, 0, 10000),
    part,
    parts,
    data: p.data,
  };
}

export async function ensureRecordings(sql: postgres.Sql): Promise<void> {
  await sql`CREATE TABLE IF NOT EXISTS cco_visual_chunks (
    org_id text NOT NULL, project_id text NOT NULL, account_id text NOT NULL,
    installation_id text, generation bigint, environment text NOT NULL, app_key text NOT NULL,
    session_ref text NOT NULL, recording_id text NOT NULL, segment_id text NOT NULL,
    sequence int NOT NULL, part int NOT NULL, parts int NOT NULL, event_time bigint NOT NULL,
    received_at bigint NOT NULL, route text NOT NULL, data text NOT NULL, digest text NOT NULL,
    PRIMARY KEY(org_id,project_id,recording_id,segment_id,part))`;
  await sql`CREATE INDEX IF NOT EXISTS cco_visual_account ON cco_visual_chunks(account_id,event_time DESC)`;
}

export async function storeVisual(
  sql: postgres.Sql,
  scope: TrustedBrowserScope,
  project: Project,
  batch: {
    anonId: string;
    sessionId: string;
    events: Array<{ ts: number; path?: string; props?: Record<string, unknown> }>;
  },
): Promise<void> {
  await sql.begin(async (tx) => {
    const ref = sessionRef(scope.orgId, scope.projectId, batch.anonId, batch.sessionId);
    for (const e of batch.events) {
      const p = visualProps(e.props);
      await tx`SELECT pg_advisory_xact_lock(hashtextextended(${String(p.recordingId)},0))`;
      const hash = digest({ scope, ref, props: p, ts: e.ts, route: e.path });
      const old = await tx`SELECT * FROM cco_visual_chunks WHERE org_id=${scope.orgId}
        AND project_id=${scope.projectId} AND recording_id=${String(p.recordingId)}
        AND segment_id=${String(p.segmentId)} AND part=${Number(p.part)}`;
      if (old.length) {
        if (old[0]?.digest !== hash) throw new CcoError("visual_identity_conflict", 409);
        continue;
      }
      const first = await tx`SELECT * FROM cco_visual_chunks WHERE org_id=${scope.orgId}
        AND project_id=${scope.projectId} AND recording_id=${String(p.recordingId)} LIMIT 1`;
      if (
        first.length &&
        (first[0]?.account_id !== scope.accountId ||
          first[0]?.installation_id !== scope.installationId ||
          String(first[0]?.generation) !== String(scope.generation) ||
          first[0]?.session_ref !== ref ||
          first[0]?.environment !== project.environment ||
          first[0]?.app_key !== project.appKey)
      )
        throw new CcoError("visual_scope_conflict", 409);
      const sequence =
        await tx`SELECT segment_id,parts FROM cco_visual_chunks WHERE org_id=${scope.orgId}
        AND project_id=${scope.projectId} AND recording_id=${String(p.recordingId)} AND sequence=${Number(p.sequence)} LIMIT 1`;
      if (
        sequence.length &&
        (sequence[0]?.segment_id !== p.segmentId || Number(sequence[0]?.parts) !== p.parts)
      )
        throw new CcoError("visual_sequence_conflict", 409);
      const count = await tx`SELECT count(*)::int count,coalesce(sum(length(data)),0)::bigint bytes
        FROM cco_visual_chunks WHERE org_id=${scope.orgId} AND project_id=${scope.projectId}
        AND recording_id=${String(p.recordingId)}`;
      if (
        Number(count[0]?.count) >= 10000 ||
        Number(count[0]?.bytes) + String(p.data).length > 24 * 1024 * 1024
      )
        throw new CcoError("visual_recording_capacity", 413);
      const result = await tx`INSERT INTO cco_visual_chunks
        (org_id,project_id,account_id,installation_id,generation,environment,app_key,session_ref,
        recording_id,segment_id,sequence,part,parts,event_time,received_at,route,data,digest)
        VALUES (${scope.orgId},${scope.projectId},${scope.accountId},${scope.installationId},${scope.generation},
        ${project.environment},${project.appKey},${ref},${String(p.recordingId)},${String(p.segmentId)},
        ${Number(p.sequence)},${Number(p.part)},${Number(p.parts)},${e.ts},${Date.now()},${e.path ?? "/"},${String(p.data)},${hash})
        ON CONFLICT DO NOTHING RETURNING recording_id`;
      if (!result.length) {
        const old = await tx`SELECT digest FROM cco_visual_chunks WHERE org_id=${scope.orgId}
          AND project_id=${scope.projectId} AND recording_id=${String(p.recordingId)}
          AND segment_id=${String(p.segmentId)} AND part=${Number(p.part)}`;
        if (old[0]?.digest !== hash) throw new CcoError("visual_identity_conflict", 409);
      }
    }
  });
}

export async function readRecordings(
  sql: postgres.Sql,
  config: CcoConfig,
  accountId: string,
  recordingId?: string,
  projectId?: string,
): Promise<unknown> {
  const projects = config.projects.map((p) => p.projectId);
  if (!recordingId) {
    const rows =
      await sql`SELECT org_id,project_id,recording_id,app_key,environment,installation_id,generation,
      min(event_time)::float8 started_at,max(event_time)::float8 last_at,min(route) route,
      count(*)::int chunks FROM cco_visual_chunks WHERE account_id=${accountId}
      AND project_id=ANY(${projects}::text[]) GROUP BY org_id,project_id,recording_id,app_key,environment,installation_id,generation
      ORDER BY max(event_time) DESC LIMIT 50`;
    return {
      recordings: rows.filter((row) =>
        config.projects.some(
          (p) =>
            p.orgId === row.org_id &&
            p.projectId === row.project_id &&
            p.appKey === row.app_key &&
            p.environment === row.environment,
        ),
      ),
    };
  }
  if (!projectId || !projects.includes(projectId))
    throw new CcoError("invalid_recording_scope", 403);
  const rows = await sql`SELECT * FROM cco_visual_chunks WHERE account_id=${accountId}
    AND project_id=${projectId} AND recording_id=${recordingId} ORDER BY sequence,part LIMIT 10001`;
  if (!rows.length) throw new CcoError("recording_not_found", 404);
  if (rows.length > 10000) throw new CcoError("recording_too_large", 413);
  const project = config.projects.find((p) => p.projectId === projectId);
  if (!project) throw new CcoError("invalid_recording_scope", 403);
  if (
    rows.some(
      (r) =>
        r.org_id !== project.orgId ||
        r.app_key !== project.appKey ||
        r.environment !== project.environment ||
        r.session_ref !== rows[0]?.session_ref ||
        r.installation_id !== rows[0]?.installation_id ||
        String(r.generation) !== String(rows[0]?.generation),
    )
  )
    throw new CcoError("visual_scope_conflict", 409);
  const groups = new Map<number, Array<(typeof rows)[number]>>();
  for (const row of rows) {
    const seq = Number(row.sequence);
    const group = groups.get(seq) ?? [];
    group.push(row);
    groups.set(seq, group);
  }
  const events: unknown[] = [];
  let missing = 0;
  let previous = -1;
  let bytes = 0;
  for (const [seq, group] of groups) {
    if (seq !== previous + 1) {
      missing += seq - previous - 1;
      break;
    }
    previous = seq;
    const parts = Number(group[0]?.parts);
    if (
      group.length !== parts ||
      group.some(
        (r, i) =>
          Number(r.part) !== i ||
          Number(r.parts) !== parts ||
          r.segment_id !== group[0]?.segment_id,
      )
    ) {
      missing++;
      break;
    }
    const raw = gunzipSync(Buffer.from(group.map((r) => r.data).join(""), "base64"), {
      maxOutputLength: 8 * 1024 * 1024,
    });
    bytes += raw.length;
    if (bytes > 24 * 1024 * 1024) {
      missing++;
      break;
    }
    const decoded: unknown = JSON.parse(raw.toString("utf8"));
    if (!Array.isArray(decoded) || decoded.length > 1000)
      throw new CcoError("invalid_recording_segment");
    for (const value of decoded) {
      const e = object(value);
      integer(e.type, 0, 6);
      integer(e.timestamp, 1, Date.now() + 120000);
      events.push(e);
    }
  }
  return {
    recordingId,
    projectId,
    appKey: rows[0]?.app_key,
    environment: rows[0]?.environment,
    installationId: rows[0]?.installation_id,
    generation: rows[0]?.generation,
    missingSegments: missing,
    complete: missing === 0,
    events,
  };
}
