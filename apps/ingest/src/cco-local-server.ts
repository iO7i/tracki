import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { eventBatchSchema } from "@tracki/shared";
/** Local diagnostic collector. Reuses real validation, acceptance, CCO SQL and authenticated routes.
 * No Redis/ClickHouse or assistance worker is started. Pending analytics stay visible.
 */
import Fastify from "fastify";
import { configuration } from "./cco/config";
import { registerCcoRoutes } from "./cco/routes";
import { PostgresCcoStore } from "./cco/store";
import { acceptEvents, ensureInbox } from "./inbox";
import { normalizeBatch } from "./normalize";
import { closePg, pg } from "./pg";
async function main() {
  if (process.env.NODE_ENV === "production")
    throw new Error("local_diagnostic_mode_not_for_production");
  const url = new URL(process.env.DATABASE_URL ?? "");
  if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
    throw new Error("local_database_required");
  const config = configuration();
  if (!config || config.projects.some((p) => p.environment === "production"))
    throw new Error("development_project_required");
  await ensureInbox();
  const app = Fastify({ bodyLimit: 256 * 1024, logger: false });
  registerCcoRoutes(app, new PostgresCcoStore(pg()), config);
  app.get("/health", async () => ({
    ok: true,
    mode: "local-diagnostic",
    analyticsWorker: "not-running",
    productionVerified: false,
  }));
  app.post("/v1/events", async (request, reply) => {
    const parsed = eventBatchSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid" });
    if (parsed.data.key !== process.env.CCO_LOCAL_PUBLIC_KEY)
      return reply.code(202).send({ ok: true });
    const scope = config.projects[0];
    if (!scope) return reply.code(503).send({ error: "no_scope" });
    try {
      const events = normalizeBatch(parsed.data, scope, "local-diagnostic", Date.now());
      await acceptEvents(events);
      return reply.code(202).send({ ok: true });
    } catch {
      return reply.code(400).send({ error: "invalid_event" });
    }
  });
  app.get("/tracki.js", async (_, reply) =>
    reply
      .type("application/javascript")
      .send(await readFile(resolve("packages/snippet/dist/tracki.global.js"), "utf8")),
  );
  for (const route of ["/v1/actions", "/v1/faq"])
    app.get(route, async () => ({ actions: [], articles: [] }));
  app.get("/demo", async (_, reply) =>
    reply
      .type("text/html")
      .send(
        `<!doctype html><html lang="en"><head><title>CCO local browser proof</title></head><body><h1>Local CCO browser proof</h1><p>Development fixture only. No production account.</p><button id="probe">Run a same-origin request</button><script src="/tracki.js" data-key="${process.env.CCO_LOCAL_PUBLIC_KEY}" data-consent="granted" data-chat="off"></script><script>document.querySelector('#probe').onclick=()=>window.tracki.tracedFetch('/probe');</script></body></html>`,
      ),
  );
  app.get("/probe", async (request) => ({
    ok: true,
    traceReceived: typeof request.headers.traceparent === "string",
  }));
  await app.listen({ host: "127.0.0.1", port: 4400 });
  process.stdout.write("CCO local diagnostic collector: http://127.0.0.1:4400\n");
  const stop = async () => {
    await app.close();
    await closePg();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}
main().catch((error) => {
  console.error(error instanceof Error ? error.message : "local_collector_failed");
  process.exit(1);
});
