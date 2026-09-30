import { createClickHouse, migrate } from "@tracki/clickhouse";
import Fastify from "fastify";
import { configuration } from "./cco/config";
import { closePg, pg } from "./pg";
import { startWorker } from "./worker";

/** Dedicated diagnostics worker; no public snippet, assistance, or product APIs. */
async function main(): Promise<void> {
  if (
    process.env.NODE_ENV !== "production" ||
    !process.env.DATABASE_URL ||
    !process.env.CLICKHOUSE_URL ||
    !process.env.CLICKHOUSE_USER ||
    !process.env.CLICKHOUSE_PASSWORD ||
    !process.env.CLICKHOUSE_DB ||
    !configuration()
  ) {
    throw new Error("cco_analytics_configuration_required");
  }
  // Apply idempotent migrations to the dedicated telemetry database before
  // starting the writer. Collector ingestion remains independent throughout.
  await migrate();
  const sql = pg();
  await sql`SELECT 1 FROM telemetry_inbox LIMIT 1`;
  const ch = createClickHouse();
  const worker = startWorker({ liveAssistance: false });
  const app = Fastify({ logger: false, requestTimeout: 15000 });
  let reporting = false;
  let lastProgress = "";
  const inspect = async () => {
    const [inbox, stored] = await Promise.all([
      sql`SELECT count(*) FILTER (WHERE completed_at IS NULL AND dead_at IS NULL)::int AS pending,
          count(*) FILTER (WHERE dead_at IS NOT NULL)::int AS dead_letters,
          count(*) FILTER (WHERE completed_at IS NOT NULL)::int AS completed FROM telemetry_inbox`,
      ch.query({ query: "SELECT count() AS persisted_events FROM events", format: "JSONEachRow" }),
    ]);
    const rows = await stored.json<{ persisted_events: string }>();
    const progress = { ...inbox[0], persistedEvents: Number(rows[0]?.persisted_events ?? 0) };
    const signature = JSON.stringify(progress);
    if (signature !== lastProgress) {
      console.info(JSON.stringify({ event: "cco_analytics_progress", ...progress }));
      lastProgress = signature;
    }
    return {
      ...progress,
      ok: true,
      mode: "cco-analytics-worker",
      release: process.env.CCO_RELEASE_SHA ?? process.env.RAILWAY_GIT_COMMIT_SHA ?? "unknown",
    };
  };
  app.get("/health", async (_request, reply) => {
    try {
      return await inspect();
    } catch {
      return reply.code(503).send({ ok: false, mode: "cco-analytics-worker" });
    }
  });
  const timer = setInterval(async () => {
    if (reporting) return;
    reporting = true;
    try {
      await inspect();
    } catch {
      console.error("cco_analytics_inspection_unavailable");
    } finally {
      reporting = false;
    }
  }, 30000);
  timer.unref();
  let stopping = false;
  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    clearInterval(timer);
    await app.close();
    await worker.stop();
    await ch.close();
    await closePg();
  };
  process.once("SIGTERM", () => void shutdown());
  process.once("SIGINT", () => void shutdown());
  await app.listen({ host: "0.0.0.0", port: Number(process.env.PORT ?? "4000") });
  console.info("cco_analytics_worker_started");
}
main().catch(() => {
  console.error("cco_analytics_worker_start_failed");
  process.exitCode = 1;
});
