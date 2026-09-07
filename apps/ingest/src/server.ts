import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import cors from "@fastify/cors";
import { createClickHouse } from "@tracki/clickhouse";
import {
  chatRequestSchema,
  eventBatchSchema,
  handoffRequestSchema,
  surfaceMatches,
} from "@tracki/shared";
import { simulateAllowed, verifySignature } from "@tracki/whatsapp";
import Fastify, { type FastifyInstance } from "fastify";
import { getManifest } from "./actions.js";
import { popAssist } from "./assist.js";
import { handleChat } from "./chat.js";
import { REDIS_KEYS } from "./config.js";
import { acceptEvents } from "./inbox";
import { allowRequest, resolveKey } from "./keys.js";
import { normalizeBatch } from "./normalize.js";
import {
  faqArticlesForProject,
  peekHandoffProject,
  pg,
  projectForWaId,
  upsertIdentity,
} from "./pg.js";
import { redis } from "./redis.js";
import { handleHandoff, handleInbound, resolveInboundProject } from "./whatsapp.js";

export function buildServer(): FastifyInstance {
  const app = Fastify({ logger: false, bodyLimit: 256 * 1024 });

  // The snippet runs on arbitrary customer origins → open CORS for ingest only.
  void app.register(cors, { origin: true, methods: ["POST", "GET", "OPTIONS"] });

  // Retain the raw JSON body so the WhatsApp webhook can verify Meta's HMAC
  // signature over the exact bytes.
  app.addContentTypeParser("application/json", { parseAs: "string" }, (req, body, done) => {
    (req as { rawBody?: string }).rawBody = body as string;
    try {
      done(null, body ? JSON.parse(body as string) : {});
    } catch (err) {
      done(err as Error, undefined);
    }
  });

  // Serve the built snippet (dev/self-host; prod would put this on a CDN).
  const snippetPath =
    process.env.SNIPPET_FILE ??
    join(
      dirname(fileURLToPath(import.meta.url)),
      "../../../packages/snippet/dist/tracki.global.js",
    );
  app.get("/tracki.js", async (_req, reply) => {
    try {
      const js = await readFile(snippetPath, "utf8");
      return reply
        .header("content-type", "application/javascript; charset=utf-8")
        .header("cache-control", "public, max-age=300")
        .send(js);
    } catch {
      return reply.code(404).send("// snippet not built");
    }
  });

  // Audit N4: health checks all three dependencies, not just Redis.
  const healthCh = createClickHouse();
  app.addHook("onClose", async () => healthCh.close());
  app.get("/health", async () => {
    const checks = { redis: false, postgres: false, clickhouse: false };
    await Promise.all([
      redis()
        .ping()
        .then((r) => {
          checks.redis = r === "PONG";
        })
        .catch(() => {}),
      pg()`SELECT 1`
        .then(() => {
          checks.postgres = true;
        })
        .catch(() => {}),
      healthCh
        .ping()
        .then((r) => {
          checks.clickhouse = r.success;
        })
        .catch(() => {}),
    ]);
    const ok = checks.redis && checks.postgres && checks.clickhouse;
    return { ok, checks };
  });

  // Action manifest for the snippet + mobile SDKs. Unknown key → empty array
  // (never leak key validity). Only live, in-schedule actions, client-facing
  // fields only. implementation: one cached manifest, filtered per surface here —
  // ?surface=mobile for the SDKs; anything else (incl. absent) ⇒ web, so the
  // web snippet never receives tour/drawer actions it can't render.
  app.get("/v1/actions", async (request, reply) => {
    const { key = "", surface } = request.query as { key?: string; surface?: string };
    if (!key) return reply.send({ actions: [] });
    const ref = await resolveKey(key);
    if (!ref) return reply.send({ actions: [] });
    const requested: "web" | "mobile" = surface === "mobile" ? "mobile" : "web";
    const actions = (await getManifest(ref.projectId)).filter((a) => surfaceMatches(a, requested));
    return reply.send({ actions });
  });

  // FAQ search/list for the widget + help center. Published only, resolved
  // project only, unknown key → empty. CORS-open like the rest of /v1.
  app.get("/v1/faq", async (request, reply) => {
    const { key = "", q = "" } = request.query as { key?: string; q?: string };
    if (!key) return reply.send({ articles: [] });
    const ref = await resolveKey(key);
    if (!ref) return reply.send({ articles: [] });
    const articles = await faqArticlesForProject(ref.projectId, q);
    return reply.send({ articles });
  });

  // Tracki Connect (implementation): escalate → mint inquiry code + wa.me deep link.
  app.post("/v1/handoff", async (request, reply) => {
    const parsed = handoffRequestSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid" });
    if (!(await allowRequest(parsed.data.key))) return reply.code(429).send({ error: "rate" });
    const ref = await resolveKey(parsed.data.key);
    if (!ref) return reply.code(404).send({ error: "unknown" });
    return reply.send(await handleHandoff(ref, parsed.data));
  });

  // Meta webhook verification handshake.
  app.get("/v1/whatsapp/webhook", async (request, reply) => {
    const q = request.query as Record<string, string>;
    if (
      q["hub.mode"] === "subscribe" &&
      q["hub.verify_token"] === process.env.WHATSAPP_VERIFY_TOKEN
    ) {
      return reply.send(q["hub.challenge"]);
    }
    return reply.code(403).send("forbidden");
  });

  // Meta webhook: inbound messages.
  app.post("/v1/whatsapp/webhook", async (request, reply) => {
    const raw = (request as { rawBody?: string }).rawBody ?? "";
    if (!verifySignature(raw, request.headers["x-hub-signature-256"] as string | undefined)) {
      return reply.code(401).send({ error: "bad signature" });
    }
    const body = request.body as {
      entry?: {
        changes?: { value?: { messages?: { from?: string; text?: { body?: string } }[] } }[];
      }[];
    };
    for (const entry of body.entry ?? []) {
      for (const change of entry.changes ?? []) {
        for (const msg of change.value?.messages ?? []) {
          const from = msg.from ?? "";
          const text = msg.text?.body ?? "";
          if (!from || !text) continue;
          // Audit B1: per-sender throttle (defense-in-depth vs forged floods).
          if (!(await allowRequest(`wh:${from}`))) continue;
          try {
            const projectId = await resolveInboundProject(
              text,
              from,
              peekHandoffProject,
              projectForWaId,
            );
            if (projectId) await handleInbound(projectId, from, text);
          } catch (err) {
            // Audit M3: one bad message must not fail the whole batch.
            console.error("whatsapp inbound failed", err);
          }
        }
      }
    }
    return reply.send({ ok: true });
  });

  // Simulator-only inbound injection (exercises the flow offline/CI). Audit B2:
  // allowed only outside production AND in simulator mode — never in prod.
  app.post("/v1/whatsapp/simulate", async (request, reply) => {
    if (!simulateAllowed()) return reply.code(404).send({ error: "not found" });
    const { key, from, text } = (request.body ?? {}) as {
      key?: string;
      from?: string;
      text?: string;
    };
    if (!key || !from || !text) return reply.code(400).send({ error: "invalid" });
    const ref = await resolveKey(key);
    if (!ref) return reply.code(404).send({ error: "unknown" });
    await handleInbound(ref.projectId, from, text);
    return reply.send({ ok: true });
  });

  // Tracki Agent (implementation): one grounded conversational turn.
  app.post("/v1/chat", async (request, reply) => {
    const parsed = chatRequestSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid" });
    const body = parsed.data;
    if (!(await allowRequest(body.key))) return reply.code(429).send({ error: "rate" });
    const ref = await resolveKey(body.key);
    // Audit N2: don't leak key validity (parity with /v1/events) — a benign
    // escalation reply, not a 404.
    if (!ref) {
      return reply.send({
        conversationId: "",
        reply: /[؀-ۿ]/.test(body.message)
          ? "عذراً، حدث خطأ. حاول مرة أخرى لاحقاً."
          : "Sorry, something went wrong. Please try again later.",
        escalate: true,
      });
    }
    const result = await handleChat(ref, {
      anonId: body.anonId,
      userId: body.userId,
      sessionId: body.sessionId,
      conversationId: body.conversationId,
      message: body.message,
      path: body.path,
    });
    return reply.send(result);
  });

  app.post("/v1/events", async (request, reply) => {
    // Always 202 on the happy path and on benign drops — never leak key validity
    // or validation detail to arbitrary origins.
    const parsed = eventBatchSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid event batch" });
    const batch = parsed.data;

    if (!(await allowRequest(batch.key))) return reply.code(429).send({ ok: false });

    const ref = await resolveKey(batch.key);
    if (!ref) return reply.code(202).send({ ok: true });

    const ua = request.headers["user-agent"] ?? "";
    let normalized: ReturnType<typeof normalizeBatch>;
    try {
      normalized = normalizeBatch(batch, ref, ua, Date.now());
    } catch {
      return reply.code(400).send({ error: "invalid event time" });
    }
    const events = await acceptEvents(normalized);

    // Full rows go to the CH buffer; the live channel gets only a projection —
    // never the raw row (Audit M1: no UA / org_id / received_at to the client).
    const channel = REDIS_KEYS.liveChannel(ref.projectId);
    const pipeline = redis().pipeline();
    for (const e of events) {
      pipeline.publish(
        channel,
        JSON.stringify({
          event_id: e.event_id,
          type: e.type,
          path: e.path,
          anon_id: e.anon_id,
          user_id: e.user_id,
          session_id: e.session_id,
          // Coarse surface label for the live feed (00-14 N2) — still no UA/org_id.
          platform: e.platform,
          ts: e.ts,
        }),
      );
    }
    // The database commit is the durable acknowledgment; pub/sub is optional.
    await pipeline.exec().catch(() => {});

    for (const e of events) {
      if (e.type === "identify" && e.user_id) {
        void upsertIdentity(ref.projectId, e.anon_id, e.user_id).catch(() => {});
      }
    }

    // implementation: deliver any pending Live Assist for this session (pop-and-clear).
    const assist = await popAssist(ref.projectId, batch.sessionId).catch(() => null);
    return reply.code(202).send(assist ? { ok: true, assist } : { ok: true });
  });

  return app;
}
