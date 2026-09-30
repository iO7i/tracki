import Fastify from "fastify";
import { configuration } from "./cco/config";
import { registerCcoRoutes } from "./cco/routes";
import { PostgresCcoStore } from "./cco/store";
import { ensureInbox } from "./inbox";
import { closePg, pg } from "./pg";

/** Server-authenticated CCO collector. Public snippet/AI/analytics APIs are not mounted. */
async function main(): Promise<void> {
  if (process.env.NODE_ENV !== "production" || !process.env.DATABASE_URL)
    throw new Error("production_database_configuration_required");
  const config = configuration();
  if (!config) throw new Error("cco_configuration_required");
  const retentionDays = Number(process.env.TRACKI_CCO_RETENTION_DAYS ?? "30");
  if (!Number.isInteger(retentionDays) || retentionDays < 1 || retentionDays > 90)
    throw new Error("invalid_retention_days");
  await ensureInbox();
  const sql = pg();
  const app = Fastify({ logger: false, bodyLimit: 256 * 1024, requestTimeout: 15000 });
  registerCcoRoutes(app, new PostgresCcoStore(sql), config);
  let retentionHealthy = false;
  let pruning = false;
  const prune = async () => {
    if (pruning) return;
    pruning = true;
    try {
      const cutoff = Date.now() - retentionDays * 86400000;
      await sql.begin(async (tx) => {
        await tx`DELETE FROM cco_records WHERE received_at < ${cutoff}`;
        await tx`DELETE FROM cco_bindings WHERE expires_at < ${cutoff}`;
        await tx`DELETE FROM telemetry_inbox WHERE created_at < to_timestamp(${cutoff} / 1000.0)`;
        await tx`DELETE FROM telemetry_state WHERE expires_at < now()`;
      });
      retentionHealthy = true;
    } catch {
      retentionHealthy = false;
      console.error("cco_retention_failed");
    } finally {
      pruning = false;
    }
  };
  await prune();
  app.get("/health", async (_request, reply) => {
    try {
      await sql`SELECT 1`;
      return reply.code(retentionHealthy ? 200 : 503).send({
        ok: retentionHealthy,
        mode: "cco-collector",
        storage: "postgresql",
        retentionDays,
        analyticsWorker:
          process.env.TRACKI_CCO_ANALYTICS_WORKER === "external"
            ? "external-configured"
            : "not-enabled",
        release: process.env.RAILWAY_GIT_COMMIT_SHA ?? "unknown",
      });
    } catch {
      return reply.code(503).send({ ok: false, mode: "cco-collector", storage: "unavailable" });
    }
  });
  const timer = setInterval(() => void prune(), 3600000);
  timer.unref();
  const shutdown = async () => {
    clearInterval(timer);
    await app.close();
    await closePg();
  };
  process.once("SIGTERM", () => void shutdown());
  process.once("SIGINT", () => void shutdown());
  await app.listen({ host: "0.0.0.0", port: Number(process.env.PORT ?? "4000") });
  console.info("cco_collector_listening");
}
main().catch(() => {
  console.error("cco_collector_start_failed");
  process.exitCode = 1;
});
