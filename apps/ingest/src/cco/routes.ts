import type { FastifyInstance } from "fastify";
import type postgres from "postgres";
import { acceptEvents } from "../inbox";
import { pg } from "../pg";
import { type CcoConfig, constantEqual } from "./config";
import { CcoError, event, id, integer, object } from "./contract";
import { nativeRejectionCategory } from "./native-meta";
import { readNativeDiagnostics, setNativeIncidentStatus } from "./native-store";
import { readRecordings } from "./recordings";
import { type CcoStore, parseBinding } from "./store";
import { acceptTrustedBrowser } from "./trusted-browser";
import { acceptTrustedNative, acceptTrustedNativeHealth } from "./trusted-native";
export function registerCcoRoutes(
  app: FastifyInstance,
  store: CcoStore,
  config: CcoConfig,
  sqlProvider: () => postgres.Sql = pg,
): void {
  const key = (header: unknown) =>
    typeof header === "string" && header.startsWith("Bearer ") ? header.slice(7) : "";
  const failure = (error: unknown) =>
    error instanceof CcoError
      ? { status: error.status, code: error.code }
      : { status: 503, code: "cco_storage_unavailable" };
  app.get("/internal/cco/native-diagnostics", async (req, reply) => {
    reply.header("cache-control", "no-store");
    if (!constantEqual(key(req.headers.authorization), config.readKey))
      return reply.code(403).send({ error: "forbidden" });
    try {
      const q = object(req.query);
      const now = Date.now();
      return await readNativeDiagnostics(sqlProvider(), config, {
        now,
        since:
          q.since == null ? now - 7 * 86400000 : integer(Number(q.since), now - 30 * 86400000, now),
        ...(q.appKey == null ? {} : { appKey: id(q.appKey) }),
        ...(q.environment == null ? {} : { environment: id(q.environment) }),
        ...(q.accountId == null ? {} : { accountId: id(q.accountId) }),
        ...(q.incidentId == null ? {} : { incidentId: id(q.incidentId) }),
        ...(q.baselineRelease == null ? {} : { baselineRelease: id(q.baselineRelease) }),
        ...(q.candidateRelease == null ? {} : { candidateRelease: id(q.candidateRelease) }),
      });
    } catch (error) {
      const f = failure(error);
      return reply.code(f.status).send({ error: f.code });
    }
  });
  app.put("/internal/cco/native-incidents/:incidentId/status", async (req, reply) => {
    reply.header("cache-control", "no-store");
    if (!constantEqual(key(req.headers.authorization), config.readKey))
      return reply.code(403).send({ error: "forbidden" });
    try {
      const body = object(req.body);
      const params = object(req.params);
      if (!["open", "acknowledged", "resolved"].includes(String(body.status)))
        throw new CcoError("invalid_incident_status");
      return await setNativeIncidentStatus(
        sqlProvider(),
        config,
        id(params.incidentId),
        body.status as "open" | "acknowledged" | "resolved",
        integer(body.revision, 1),
        Date.now(),
      );
    } catch (error) {
      const f = failure(error);
      return reply.code(f.status).send({ error: f.code });
    }
  });
  app.post("/internal/cco/native-health", async (req, reply) => {
    reply.header("cache-control", "no-store");
    const project = config.projects.find((p) =>
      constantEqual(key(req.headers.authorization), p.producerKey),
    );
    if (!project)
      return reply
        .header("x-cco-rejection", "authentication_rejected")
        .code(403)
        .send({ error: "forbidden" });
    try {
      return reply
        .code(202)
        .send(await acceptTrustedNativeHealth(req.body, project, sqlProvider()));
    } catch (error) {
      const f = failure(error);
      return reply
        .header("x-cco-rejection", nativeRejectionCategory(f.status, f.code))
        .code(f.status)
        .send({ error: f.code });
    }
  });
  app.get("/internal/cco/recordings", async (req, reply) => {
    reply.header("cache-control", "no-store");
    if (!constantEqual(key(req.headers.authorization), config.readKey))
      return reply.code(403).send({ error: "forbidden" });
    try {
      const q = object(req.query);
      return await readRecordings(
        sqlProvider(),
        config,
        id(q.accountId),
        q.recordingId == null ? undefined : id(q.recordingId),
        q.projectId == null ? undefined : id(q.projectId),
      );
    } catch (error) {
      const f = failure(error);
      return reply.code(f.status).send({ error: f.code });
    }
  });
  app.post("/internal/cco/browser-batches", async (request, reply) => {
    const scope = config.projects.find((p) =>
      constantEqual(key(request.headers.authorization), p.producerKey),
    );
    if (!scope) return reply.code(config ? 403 : 404).send({ error: "forbidden" });
    try {
      return reply.code(202).send(await acceptTrustedBrowser(request.body, scope));
    } catch (error) {
      const result = failure(error);
      return reply.code(result.status).send({ error: result.code });
    }
  });
  app.get("/internal/cco/snapshot", async (req, reply) => {
    reply.header("cache-control", "no-store");
    if (!constantEqual(key(req.headers.authorization), config.readKey))
      return reply.code(403).send({ error: "forbidden" });
    try {
      const query = object(req.query);
      const now = Date.now();
      const accountId = query.accountId == null ? null : id(query.accountId);
      const since =
        query.since == null
          ? now - 7 * 86400000
          : integer(Number(query.since), now - 90 * 86400000, now);
      return await store.snapshot(config, accountId, since, now);
    } catch (e) {
      const f = failure(e);
      return reply.code(f.status).send({ error: f.code });
    }
  });
  app.post("/internal/cco/native-batches", async (request, reply) => {
    reply.header("cache-control", "no-store");
    const scope = config.projects.find((p) =>
      constantEqual(key(request.headers.authorization), p.producerKey),
    );
    if (!scope)
      return reply
        .header("x-cco-rejection", "authentication_rejected")
        .code(403)
        .send({ error: "forbidden" });
    try {
      return reply
        .code(202)
        .send(
          await acceptTrustedNative(request.body, scope, (events, verified, metadata) =>
            acceptEvents(events, sqlProvider(), verified, metadata),
          ),
        );
    } catch (error) {
      const result = failure(error);
      return reply
        .header("x-cco-rejection", nativeRejectionCategory(result.status, result.code))
        .code(result.status)
        .send({ error: result.code });
    }
  });
  app.post("/internal/cco/bindings", async (req, reply) => {
    reply.header("cache-control", "no-store");
    const scope = config.projects.find((p) =>
      constantEqual(key(req.headers.authorization), p.producerKey),
    );
    if (!scope) return reply.code(403).send({ error: "forbidden" });
    try {
      const binding = parseBinding(req.body, scope);
      await store.bind(binding);
      return reply.code(201).send({
        sessionRef: binding.sessionRef,
        accountId: binding.accountId,
        validFrom: binding.validFrom,
        expiresAt: binding.expiresAt,
      });
    } catch (e) {
      const f = failure(e);
      return reply.code(f.status).send({ error: f.code });
    }
  });
  app.post("/internal/cco/events", async (req, reply) => {
    reply.header("cache-control", "no-store");
    const scope = config.projects.find((p) =>
      constantEqual(key(req.headers.authorization), p.producerKey),
    );
    if (!scope) return reply.code(403).send({ error: "forbidden" });
    try {
      const body = object(req.body);
      if (!Array.isArray(body.events) || body.events.length < 1 || body.events.length > 50)
        throw new CcoError("invalid_batch");
      const now = Date.now();
      const events = body.events.map((raw) => {
        const r = object(raw);
        const occurredAt = integer(r.occurredAt, now - 86400000, now + 120000);
        // All authority, source and project metadata come from authenticated producer configuration.
        return event({
          ...r,
          version: 1,
          orgId: scope.orgId,
          projectId: scope.projectId,
          appKey: scope.appKey,
          environment: scope.environment,
          accountId: r.accountId == null ? null : id(r.accountId),
          authority: "server-reported",
          source: `server.${scope.appKey}`,
          occurredAt,
          receivedAt: now,
        });
      });
      await store.append(events);
      return reply.code(202).send({ accepted: events.map((e) => e.eventId) });
    } catch (e) {
      const f = failure(e);
      return reply.code(f.status).send({ error: f.code });
    }
  });
}
