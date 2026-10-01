import type { StoredEvent } from "@tracki/shared";
import type postgres from "postgres";
import { configuration } from "./cco/config";
import { CcoError, digest } from "./cco/contract";
import { projectBehavior } from "./cco/projection";
import { appendCco, ensureCco } from "./cco/store";
import type { TrustedBrowserScope } from "./cco/trusted-browser";
import { acceptNativeMetadata, type NativeAcceptanceMetadata } from "./cco/native-store";
import { pg } from "./pg";

function inboxPayloadDigest(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  // This timestamp is assigned by Tracki when it accepts a delivery. A retry
  // has a new receipt time, but must retain the same observed event payload.
  const stable = Object.fromEntries(Object.entries(value).filter(([key]) => key !== "received_at"));
  return digest(stable);
}

export function assertInboxRetryMatches(storedPayload: unknown, incoming: StoredEvent): void {
  const storedDigest = inboxPayloadDigest(storedPayload);
  const incomingDigest = inboxPayloadDigest(incoming);
  if (!storedDigest || storedDigest !== incomingDigest)
    throw new CcoError("telemetry_event_identity_conflict", 409);
}

/** Durable ledger: completed identities are retained; project erasure requires operator cleanup. */
export async function ensureInbox(sql: postgres.Sql = pg()): Promise<void> {
  if (configuration()) await ensureCco(sql);
  await sql`CREATE TABLE IF NOT EXISTS telemetry_inbox (
    project_id text NOT NULL, event_id text NOT NULL, org_id text NOT NULL,
    event_time bigint NOT NULL, payload jsonb, completed_at timestamptz,
    attempts integer NOT NULL DEFAULT 0, available_at timestamptz NOT NULL DEFAULT now(),
    dead_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (project_id, event_id))`;
  await sql`CREATE INDEX IF NOT EXISTS telemetry_pending ON telemetry_inbox (available_at, event_time)
    WHERE completed_at IS NULL AND dead_at IS NULL`;
  await sql`CREATE INDEX IF NOT EXISTS telemetry_project_order ON telemetry_inbox (project_id,event_time,event_id)
    WHERE completed_at IS NULL AND dead_at IS NULL`;
  await sql`CREATE TABLE IF NOT EXISTS telemetry_state (
    key text PRIMARY KEY, value jsonb NOT NULL, expires_at timestamptz NOT NULL)`;
}

/** One transaction accepts the batch, including concurrent/reordered partial retries. */
export async function acceptEvents(
  events: StoredEvent[],
  sql: postgres.Sql = pg(),
  trustedBrowser?: TrustedBrowserScope,
  nativeMetadata?: NativeAcceptanceMetadata,
): Promise<StoredEvent[]> {
  return sql.begin(async (tx) => {
    const accepted: StoredEvent[] = [];
    // Stable lock order prevents overlapping batches from deadlocking each other.
    for (const e of [...events].sort((a, b) => a.event_id.localeCompare(b.event_id))) {
      const rows =
        await tx`INSERT INTO telemetry_inbox (project_id,event_id,org_id,event_time,payload)
        VALUES (${e.project_id},${e.event_id},${e.org_id},${e.ts},${tx.json(e as unknown as postgres.JSONValue)})
        ON CONFLICT (project_id,event_id) DO NOTHING RETURNING event_id`;
      if (rows.length) accepted.push(e);
      else {
        const existing = await tx`SELECT payload FROM telemetry_inbox
          WHERE project_id=${e.project_id} AND event_id=${e.event_id} FOR UPDATE`;
        assertInboxRetryMatches(existing[0]?.payload, e);
      }
    }
    const cco = configuration();
    if (cco) {
      const projected = accepted.flatMap((e) => {
        const scope = cco.projects.find(
          (p) => p.orgId === e.org_id && p.projectId === e.project_id,
        );
        if (!scope) return [];
        const projection = projectBehavior(e, scope);
        if (trustedBrowser) {
          if (trustedBrowser.orgId !== scope.orgId || trustedBrowser.projectId !== scope.projectId)
            throw new Error("trusted_browser_scope_mismatch");
          Object.assign(projection, {
            accountId: trustedBrowser.accountId,
            installationId: trustedBrowser.installationId,
            generation: trustedBrowser.generation,
            actorKind: "human",
            targetAppKey: scope.appKey,
          });
        }
        return [projection];
      });
      await appendCco(tx, projected);
      if (nativeMetadata && trustedBrowser)
        await acceptNativeMetadata(tx, trustedBrowser, nativeMetadata);
    }
    return accepted;
  }) as Promise<StoredEvent[]>;
}

export async function maintainInbox(sql: postgres.Sql = pg()): Promise<void> {
  await sql`DELETE FROM telemetry_state WHERE expires_at < now()`;
  await sql`UPDATE telemetry_inbox SET payload=NULL WHERE dead_at < now()-interval '7 days' AND payload IS NOT NULL`;
}
