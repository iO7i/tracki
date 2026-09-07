import { assertLLM } from "@tracki/ai";
import { assertConfig } from "@tracki/whatsapp";
import { config } from "./config.js";
import { closePg } from "./pg.js";
import { closeRedis } from "./redis.js";
import { buildServer } from "./server.js";
import { startWorker } from "./worker.js";

async function main(): Promise<void> {
  assertConfig(); // fail closed on partial Meta config (Audit 07 B1/B2)
  assertLLM(); // fail closed: require a real LLM in prod, not the heuristic (Audit 00-07 X1)
  let worker: { stop: () => void } | null = null;
  if (config.runWorker) worker = startWorker();

  let app: Awaited<ReturnType<typeof buildServer>> | null = null;
  if (config.runServer) {
    app = buildServer();
    await app.listen({ port: config.port, host: config.host });
    console.info(`ingest listening on http://${config.host}:${config.port}`);
  }

  const shutdown = async () => {
    worker?.stop();
    await app?.close();
    await closeRedis();
    await closePg();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("ingest failed to start", err);
  process.exit(1);
});
