import { afterEach, describe, expect, it } from "vitest";
import Fastify from "fastify";
import { nativeTestDb } from "./native-test-db";
import { ensureCco, PostgresCcoStore } from "./store";
import {
  acceptNativeMetadata,
  readNativeDiagnostics,
  setNativeIncidentStatus,
} from "./native-store";
import { nativeProtocol } from "./native-meta";
import { registerCcoRoutes } from "./routes";
import { event, sessionRef } from "./contract";
import { ensureInbox } from "../inbox";
import type { CcoConfig } from "./config";
const now = Date.now(),
  anon = "12345678-1234-4234-8234-123456789abc",
  session = "22345678-1234-4234-8234-123456789abc";
const project = {
  orgId: "fixture-org",
  projectId: "fixture-native",
  appKey: "seo",
  environment: "staging",
  producerKey: "producer-fixture-".repeat(4),
};
const config: CcoConfig = { readKey: "reader-fixture-".repeat(4), projects: [project] };
const protocol = nativeProtocol({
  sdkVersion: "0.2.0",
  schemaVersion: 2,
  capabilities: ["capture-health-v1", "sampling-v1"],
});
const scope = {
  orgId: project.orgId,
  projectId: project.projectId,
  accountId: "fixture-merchant",
  installationId: "fixture-install",
  generation: 1,
};
const health = {
  reporterId: anon,
  revision: 1,
  observedAt: now,
  observed: 2,
  sampledOut: 0,
  droppedCapacity: 0,
  droppedExpired: 0,
  rejected: 0,
  storageFailures: 0,
  unsupportedSchema: 0,
  accepted: 2,
  queueDepth: 0,
  queueBytes: 0,
  retryingCount: 0,
  routineSuccessSampleRate: 1,
  lastResponseCategory: "accepted",
};
const metadata = {
  project,
  anonId: anon,
  sessionId: session,
  scopeTag: "a".repeat(64),
  protocol,
  build: { buildId: "fixture-v1" },
  health,
  firstSeen: now,
  lastSeen: now,
  receivedAt: now,
};
const closers: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  await Promise.all(closers.splice(0).map((fn) => fn()));
});
async function fixture() {
  const f = await nativeTestDb();
  closers.push(() => f.db.close());
  await ensureCco(f.sql);
  return f;
}
function observation(eventId: string, time = now) {
  return event({
    version: 1,
    eventId,
    orgId: project.orgId,
    projectId: project.projectId,
    accountId: scope.accountId,
    appKey: project.appKey,
    environment: project.environment,
    installationId: scope.installationId,
    generation: 1,
    sessionRef: sessionRef(project.orgId, project.projectId, anon, session),
    traceId: null,
    spanId: null,
    parentSpanId: null,
    causedBy: null,
    authority: "observed",
    source: "tracki.native",
    operation: "cco_js_error",
    outcome: "failed",
    errorCode: "JS_ERROR",
    route: "/products",
    release: "fixture-v1",
    occurredAt: time,
    receivedAt: now,
    replay: null,
    nativeProtocol: protocol,
    sampleRate: 1,
  });
}
describe("real PostgreSQL native diagnostics", () => {
  it("migrates idempotently and rejects replayed changed/regressed reports atomically", async () => {
    const f = await fixture();
    await ensureCco(f.sql);
    await f.sql.begin((tx) => acceptNativeMetadata(tx, scope, metadata));
    await f.sql.begin((tx) => acceptNativeMetadata(tx, scope, metadata));
    await expect(
      f.sql.begin((tx) =>
        acceptNativeMetadata(tx, scope, { ...metadata, health: { ...health, observed: 3 } }),
      ),
    ).rejects.toThrow("native_health_identity_conflict");
    await expect(
      f.sql.begin((tx) =>
        acceptNativeMetadata(tx, scope, {
          ...metadata,
          health: { ...health, revision: 2, observed: 1 },
        }),
      ),
    ).rejects.toThrow("native_health_counter_regression");
    const rows = await f.sql`SELECT revision,body FROM cco_native_health`;
    expect(rows).toHaveLength(1);
    expect(Number(rows[0]!.revision)).toBe(1);
    await expect(
      f.sql.begin((tx) =>
        acceptNativeMetadata(tx, { ...scope, accountId: "other-merchant" }, metadata),
      ),
    ).rejects.toThrow("native_session_identity_conflict");
    await expect(
      f.sql.begin((tx) =>
        acceptNativeMetadata(tx, { ...scope, installationId: "other-store" }, metadata),
      ),
    ).rejects.toThrow("native_session_identity_conflict");
    await expect(
      f.sql.begin((tx) => acceptNativeMetadata(tx, { ...scope, generation: 2 }, metadata)),
    ).rejects.toThrow("native_session_identity_conflict");
    await expect(
      f.sql.begin((tx) =>
        acceptNativeMetadata(tx, scope, { ...metadata, build: { buildId: "new-build" } }),
      ),
    ).rejects.toThrow("native_session_identity_conflict");
  });
  it("persists status revisions, deduplicates events and reopens only after resolution", async () => {
    const f = await fixture(),
      store = new PostgresCcoStore(f.sql);
    await store.append([observation("failure-one")]);
    await store.append([observation("failure-one")]);
    let read = await readNativeDiagnostics(f.sql, config, {
      since: now - 100000,
      now: now + 10000,
    });
    expect(read.incidents[0]!.occurrenceCount).toBe(1);
    const original = read.incidents[0]!;
    const resolved = await setNativeIncidentStatus(
      f.sql,
      config,
      original.incidentId,
      "resolved",
      original.revision,
      now + 1000,
    );
    await expect(
      setNativeIncidentStatus(
        f.sql,
        config,
        original.incidentId,
        "acknowledged",
        original.revision,
        now + 2000,
      ),
    ).rejects.toThrow("incident_revision_conflict");
    await store.append([observation("offline-old", now - 1000)]);
    read = await readNativeDiagnostics(f.sql, config, { since: now - 100000, now: now + 10000 });
    expect(read.incidents[0]!.status).toBe("resolved");
    await store.append([observation("failure-later", now + 2000)]);
    read = await readNativeDiagnostics(f.sql, config, { since: now - 100000, now: now + 10000 });
    expect(read.incidents[0]).toMatchObject({
      status: "reopened",
      occurrenceCount: 3,
      revision: resolved.revision + 2,
    });
    expect(await f.sql`SELECT * FROM cco_native_incident_transitions`).toHaveLength(3);
  });
  it("serves authenticated health-only receipts and scoped read models over actual routes", async () => {
    const f = await fixture(),
      app = Fastify();
    closers.push(() => app.close());
    registerCcoRoutes(app, new PostgresCcoStore(f.sql), config, () => f.sql);
    const body = {
      authorizedAt: now,
      binding: {
        actorKind: "human",
        capturePolicy: { diagnostics: true, activity: false },
        accountId: scope.accountId,
        installationId: scope.installationId,
        generation: 1,
        anonId: anon,
        sessionId: session,
        validFrom: now - 10000,
        expiresAt: now + 600000,
        targetAppKey: "seo",
      },
      report: {
        anonId: anon,
        sessionId: session,
        scopeTag: metadata.scopeTag,
        protocol,
        health,
        build: metadata.build,
      },
    };
    expect(
      (await app.inject({ method: "POST", url: "/internal/cco/native-health", payload: body }))
        .statusCode,
    ).toBe(403);
    const accepted = await app.inject({
      method: "POST",
      url: "/internal/cco/native-health",
      headers: { authorization: "Bearer " + project.producerKey },
      payload: body,
    });
    expect(accepted.statusCode, accepted.body).toBe(202);
    expect(accepted.json()).toEqual({ acceptedHealth: { reporterId: anon, revision: 1 } });
    const read = await app.inject({
      url: "/internal/cco/native-diagnostics?accountId=" + scope.accountId,
      headers: { authorization: "Bearer " + config.readKey },
    });
    expect(read.statusCode, read.body).toBe(200);
    expect(read.json().health[0]).toMatchObject({
      reporterCount: 1,
      collectorReceivedEvents: 0,
      status: "healthy",
    });
    expect(read.json().sessions).toHaveLength(1);
    const unrelated = await app.inject({
      url: "/internal/cco/native-diagnostics?accountId=other-merchant",
      headers: { authorization: "Bearer " + config.readKey },
    });
    expect(unrelated.json().sessions).toHaveLength(0);
    expect(unrelated.json().health[0]).toMatchObject({ counters: null, status: "unavailable" });
  });
  it("rolls back event acceptance when attached health identity conflicts", async () => {
    const previous = {
      enabled: process.env.TRACKI_CCO_ENABLED,
      key: process.env.TRACKI_CCO_READ_KEY,
      projects: process.env.TRACKI_CCO_PROJECTS_JSON,
    };
    process.env.TRACKI_CCO_ENABLED = "true";
    process.env.TRACKI_CCO_READ_KEY = config.readKey;
    process.env.TRACKI_CCO_PROJECTS_JSON = JSON.stringify(config.projects);
    try {
      const f = await fixture();
      await ensureInbox(f.sql);
      const app = Fastify();
      closers.push(() => app.close());
      registerCcoRoutes(app, new PostgresCcoStore(f.sql), config, () => f.sql);
      const binding = {
        actorKind: "human",
        capturePolicy: { diagnostics: true, activity: false },
        accountId: scope.accountId,
        installationId: scope.installationId,
        generation: 1,
        anonId: anon,
        sessionId: session,
        validFrom: now - 10000,
        expiresAt: now + 600000,
        targetAppKey: "seo",
      };
      const batch = {
        anonId: anon,
        sessionId: session,
        scopeTag: metadata.scopeTag,
        protocol,
        health,
        build: metadata.build,
        device: { platform: "ios", sdk: "react-native" },
        sentAt: now,
        events: [
          {
            eventId: "atomic-first",
            ts: now,
            type: "track",
            path: "/products",
            sampleRate: 1,
            props: { name: "cco_response", statusCode: 200 },
          },
        ],
      };
      const first = await app.inject({
        method: "POST",
        url: "/internal/cco/native-batches",
        headers: { authorization: "Bearer " + project.producerKey },
        payload: { binding, authorizedAt: now, batch },
      });
      expect(first.statusCode, first.body).toBe(202);
      expect(first.json().acceptedClientIds).toEqual(["atomic-first"]);
      const persistedBefore = await f.sql`SELECT event_id FROM telemetry_inbox`,
        projectedBefore = await f.sql`SELECT event_id FROM cco_records`;
      const rejected = await app.inject({
        method: "POST",
        url: "/internal/cco/native-batches",
        headers: { authorization: "Bearer " + project.producerKey },
        payload: {
          binding,
          authorizedAt: now,
          batch: {
            ...batch,
            health: { ...health, observed: 3 },
            events: [{ ...batch.events[0], eventId: "atomic-rejected" }],
          },
        },
      });
      expect(rejected.statusCode, rejected.body).toBe(409);
      expect(rejected.headers["x-cco-rejection"]).toBe("revoked_context");
      expect(persistedBefore).toHaveLength(1);
      expect(projectedBefore).toHaveLength(1);
      expect(await f.sql`SELECT event_id FROM telemetry_inbox`).toEqual(persistedBefore);
      expect(await f.sql`SELECT event_id FROM cco_records`).toEqual(projectedBefore);
    } finally {
      for (const [key, value] of Object.entries({
        TRACKI_CCO_ENABLED: previous.enabled,
        TRACKI_CCO_READ_KEY: previous.key,
        TRACKI_CCO_PROJECTS_JSON: previous.projects,
      }))
        if (value == null) delete process.env[key];
        else process.env[key] = value;
    }
  });
});
