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
  app.get("/health", async (_request, reply) => {
    try {
      const [inbox, ping] = await Promise.all([
        sql`SELECT count(*) FILTER (WHERE completed_at IS NULL AND dead_at IS NULL)::int AS pending,
          count(*) FILTER (WHERE dead_at IS NOT NULL)::int AS dead_letters,
          count(*) FILTER (WHERE completed_at IS NOT NULL)::int AS completed FROM telemetry_inbox`,
        ch.ping(),
      ]);
      if (!ping.success) throw new Error("analytics_storage_unavailable");
      return {
        ok: true,
        mode: "cco-analytics-worker",
        release: process.env.CCO_RELEASE_SHA ?? process.env.RAILWAY_GIT_COMMIT_SHA ?? "unknown",
        ...inbox[0],
      };
    } catch {
      return reply.code(503).send({ ok: false, mode: "cco-analytics-worker" });
    }
  });
  let stopping = false;
  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
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
