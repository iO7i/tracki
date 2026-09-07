import { createClickHouse, insertEvents, insertStruggles } from "@tracki/clickhouse";
import type { StoredEvent } from "@tracki/shared";
import { computeAssist } from "./assist.js";
import { REDIS_KEYS } from "./config.js";
import { detectBatch } from "./detector.js";
import { redis } from "./redis.js";
import { RedisStateStore } from "./state.js";

const BATCH = 1000;
const IDLE_MS = 1000;

function parse(items: string[]): StoredEvent[] {
  const out: StoredEvent[] = [];
  for (const item of items) {
    try {
      out.push(JSON.parse(item) as StoredEvent);
    } catch {
      /* skip malformed */
    }
  }
  return out;
}

/**
 * ClickHouse writer loop with a reliable-queue pattern (Audit M4): events are
 * atomically moved buffer → processing, inserted, then trimmed from processing
 * only on success. A crash mid-insert leaves the batch in `processing`, which
 * is recovered back to the buffer on next startup — no silent loss. Insert
 * failures dead-letter the batch. Runs in-process (dev) or standalone (prod).
 */
export function startWorker(): { stop: () => void } {
  const ch = createClickHouse();
  const detectorStore = new RedisStateStore();
  let running = true;
  let timer: ReturnType<typeof setTimeout> | null = null;

  // Run struggle detection over an already-inserted batch. Failures here never
  // affect event durability (events are already in ClickHouse).
  const runDetection = async (events: StoredEvent[]) => {
    try {
      const struggles = await detectBatch(detectorStore, events);
      if (struggles.length === 0) return;
      await insertStruggles(ch, struggles);
      const pipe = redis().pipeline();
      for (const s of struggles) {
        pipe.publish(REDIS_KEYS.struggleChannel(s.project_id), JSON.stringify(s));
      }
      await pipe.exec();
      // implementation (S3): each struggle may arm a Live Assist for the session,
      // delivered on the visitor's next event flush. Off the ack path.
      for (const s of struggles) await computeAssist(ch, s);
    } catch (err) {
      console.error("struggle detection failed", err);
    }
  };

  // Recover any batch left in `processing` by a previous crash (Audit B1).
  // We re-insert the events idempotently (events is ReplacingMergeTree keyed on
  // event_id) but DO NOT re-run detection: the pre-crash run already emitted any
  // struggles, and re-detecting would duplicate them once debounce flags expire.
  // (A crash that happened *before* the first insert means that batch misses
  // detection — a rare, bounded miss, far preferable to corrupt counts.)
  const recover = async () => {
    try {
      const orphaned = await redis().lrange(REDIS_KEYS.processing, 0, -1);
      if (orphaned.length > 0) {
        await insertEvents(ch, parse(orphaned));
        await redis().del(REDIS_KEYS.processing);
        console.info(
          `recovered ${orphaned.length} orphaned events (re-inserted, detection skipped)`,
        );
      }
    } catch (err) {
      console.error("processing recovery failed", err);
    }
  };

  const drainToProcessing = async (): Promise<string[]> => {
    const moved: string[] = [];
    // Atomically move up to BATCH items from buffer head to processing tail.
    for (let i = 0; i < BATCH; i++) {
      const item = (await redis().lmove(
        REDIS_KEYS.buffer,
        REDIS_KEYS.processing,
        "LEFT",
        "RIGHT",
      )) as string | null;
      if (item == null) break;
      moved.push(item);
    }
    return moved;
  };

  const tick = async () => {
    if (!running) return;
    try {
      const raw = await drainToProcessing();
      if (raw.length > 0) {
        const events = parse(raw);
        try {
          await insertEvents(ch, events);
          await runDetection(events);
        } catch (err) {
          console.error("ClickHouse insert failed; dead-lettering batch", err);
          await redis().rpush(REDIS_KEYS.dead, ...raw);
        }
        // Only now clear what we took from processing (we drained it whole).
        await redis().del(REDIS_KEYS.processing);
        if (running) timer = setTimeout(tick, 0);
        return;
      }
    } catch (err) {
      console.error("worker tick error", err);
    }
    if (running) timer = setTimeout(tick, IDLE_MS);
  };

  void recover().then(() => {
    if (running) void tick();
  });

  return {
    stop() {
      running = false;
      if (timer) clearTimeout(timer);
      void ch.close();
    },
  };
}
