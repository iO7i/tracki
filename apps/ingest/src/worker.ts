import { createClickHouse, insertEvents, insertStruggles } from "@tracki/clickhouse";
import type { StoredEvent, StruggleDetection } from "@tracki/shared";
import type postgres from "postgres";
import { computeAssist } from "./assist";
import { REDIS_KEYS } from "./config";
import { detectBatch } from "./detector";
import { DurableStateStore } from "./durable-state";
import { maintainInbox } from "./inbox";
import { pg } from "./pg";
import { redis } from "./redis";

export interface WorkerIO {
  events(events: StoredEvent[]): Promise<void>;
  struggles(struggles: StruggleDetection[]): Promise<void>;
  beforeAck?(tx: postgres.TransactionSql): Promise<void>;
}

/** Row locks are ownership; connection death rolls back and releases work immediately.
 * Per-project transaction advisory locks serialize detection state across sessions.
 * CH inserts may repeat after a crash, with stable IDs and explicit read deduplication.
 */
export async function processOne(sql: postgres.Sql, io: WorkerIO): Promise<boolean> {
  let owned: { project: string; id: string } | undefined;
  try {
    return (await sql.begin(async (tx) => {
      await tx`SET LOCAL idle_in_transaction_session_timeout = '60s'`;
      await tx`SET LOCAL statement_timeout = '30s'`;
      const rows = await tx`SELECT i.* FROM telemetry_inbox i
        WHERE i.completed_at IS NULL AND i.dead_at IS NULL AND i.available_at <= now()
          AND NOT EXISTS (SELECT 1 FROM telemetry_inbox earlier
            WHERE earlier.project_id=i.project_id AND earlier.completed_at IS NULL AND earlier.dead_at IS NULL
              AND (earlier.event_time,earlier.event_id)<(i.event_time,i.event_id))
        ORDER BY i.event_time,i.event_id LIMIT 1 FOR UPDATE OF i SKIP LOCKED`;
      const row = rows[0];
      if (!row) return false;
      const lock =
        await tx`SELECT pg_try_advisory_xact_lock(hashtextextended(${row.project_id},0)) AS ok`;
      if (!lock[0]?.ok) return false;
      owned = { project: row.project_id as string, id: row.event_id as string };
      const e = row.payload as StoredEvent;
      if (
        !e ||
        e.project_id !== row.project_id ||
        e.org_id !== row.org_id ||
        e.event_id !== row.event_id
      )
        throw new Error("invalid inbox record");
      const state = new DurableStateStore(tx, e.ts);
      // Late arrivals remain visible in analytics, but never rewrite prior detections.
      const watermarkKey = `watermark:${e.org_id}:${e.project_id}:${e.anon_id}`;
      const watermark = Number((await state.read(watermarkKey)) ?? 0);
      const detections = e.ts < watermark ? [] : await detectBatch(state, [e]);
      await state.write(watermarkKey, Math.max(watermark, e.ts));
      await io.events([e]);
      await io.struggles(detections);
      await io.beforeAck?.(tx);
      await tx`UPDATE telemetry_inbox SET completed_at=now(),payload=NULL WHERE project_id=${e.project_id} AND event_id=${e.event_id}`;
      return true;
    })) as boolean;
  } catch {
    if (owned) {
      await sql`UPDATE telemetry_inbox SET attempts=attempts+1,
        available_at=now()+least(300,power(2,attempts+1))*interval '1 second',
        dead_at=CASE WHEN attempts+1>=5 THEN now() ELSE NULL END
        WHERE project_id=${owned.project} AND event_id=${owned.id} AND completed_at IS NULL AND dead_at IS NULL`;
    }
    // Do not log provider errors/payloads; dead-letter IDs are available to operators.
    console.error("telemetry processing failed; retry scheduled or item dead-lettered");
    return false;
  }
}

export function startWorker(): { stop: () => Promise<void> } {
  const ch = createClickHouse();
  let running = true;
  const sql = pg();
  const loop = (async () => {
    let maintenanceAt = 0;
    while (running) {
      if (Date.now() >= maintenanceAt) {
        try {
          await maintainInbox(sql);
        } catch {
          console.error("telemetry maintenance unavailable");
        }
        maintenanceAt = Date.now() + 300_000;
      }
      const detections: StruggleDetection[] = [];
      const done = await processOne(sql, {
        events: (e) => insertEvents(ch, e),
        struggles: async (s) => {
          await insertStruggles(ch, s);
          detections.push(...s);
        },
      });
      // Optional live delivery is best effort; durable analytics are already committed.
      if (done)
        for (const s of detections) {
          try {
            await redis().publish(REDIS_KEYS.struggleChannel(s.project_id), JSON.stringify(s));
            await computeAssist(ch, s);
          } catch {
            console.error("optional live assistance unavailable");
          }
        }
      if (!done) await new Promise((resolve) => setTimeout(resolve, 250));
    }
  })();
  return {
    async stop() {
      running = false;
      await loop;
      await ch.close();
    },
  };
}
