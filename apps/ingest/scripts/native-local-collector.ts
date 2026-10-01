/** LOCAL SYNTHETIC FIXTURE. Never production telemetry or production authentication. */
import Fastify from "fastify";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { nativeTestDb } from "../src/cco/native-test-db";
import { ensureCco, PostgresCcoStore } from "../src/cco/store";
import { ensureInbox } from "../src/inbox";
import { registerCcoRoutes } from "../src/cco/routes";
const project = {
  orgId: "fixture-org",
  projectId: "fixture-native",
  appKey: "seo",
  environment: "staging",
  producerKey: randomBytes(32).toString("hex"),
};
const config = { readKey: randomBytes(32).toString("hex"), projects: [project] };
process.env.TRACKI_CCO_ENABLED = "true";
process.env.TRACKI_CCO_READ_KEY = config.readKey;
process.env.TRACKI_CCO_PROJECTS_JSON = JSON.stringify(config.projects);
const { db, sql } = await nativeTestDb();
await ensureCco(sql);
await ensureInbox(sql);
const app = Fastify({ logger: false });
registerCcoRoutes(app, new PostgresCcoStore(sql), config, () => sql);
const now = Date.now(),
  anon = randomUUID(),
  scopeTag = "f".repeat(64);
let session = randomUUID();
const protocol = {
  sdkVersion: "0.2.0",
  schemaVersion: 2,
  capabilities: [
    "capture-health-v1",
    "operation-correlation-v1",
    "sampling-v1",
    "build-identity-v1",
  ],
};
const binding = {
  actorKind: "human",
  capturePolicy: { diagnostics: true, activity: false },
  targetAppKey: "seo",
  accountId: "fixture-merchant",
  installationId: "fixture-install",
  generation: 1,
  anonId: anon,
  sessionId: session,
  validFrom: now - 60000,
  expiresAt: now + 600000,
};
const headers = { authorization: "Bearer " + project.producerKey };
const health = {
  reporterId: randomUUID(),
  revision: 1,
  observedAt: now,
  observed: 81,
  sampledOut: 0,
  droppedCapacity: 0,
  droppedExpired: 0,
  rejected: 0,
  storageFailures: 0,
  unsupportedSchema: 0,
  accepted: 81,
  queueDepth: 0,
  queueBytes: 0,
  retryingCount: 0,
  routineSuccessSampleRate: 1,
  lastAttemptAt: now,
  lastSuccessAt: now,
  lastResponseCategory: "accepted",
};
const requestId = "a".repeat(32),
  operationId = "b".repeat(32),
  jobId = "c".repeat(32),
  timeoutOp = "d".repeat(32);
for (const release of ["fixture-baseline", "fixture-candidate"]) {
  session = randomUUID();
  binding.sessionId = session;
  const events = Array.from({ length: 40 }, (_, i) => ({
    type: "track",
    eventId: randomUUID(),
    ts: now - 5000 + i,
    path: "/products",
    sampleRate: 1,
    correlation: {
      clientRequestId: i === 0 && release === "fixture-candidate" ? requestId : randomUUID(),
      ...(i === 0 && release === "fixture-candidate" ? { operationId, stage: "request" } : {}),
    },
    props: {
      name: "cco_response",
      durationMs: release === "fixture-candidate" ? 900 : 120,
      statusCode: release === "fixture-candidate" && i >= 20 ? 500 : 200,
    },
  }));
  const result = await app.inject({
    method: "POST",
    url: "/internal/cco/native-batches",
    headers,
    payload: {
      binding,
      authorizedAt: now,
      batch: {
        anonId: anon,
        sessionId: session,
        scopeTag,
        protocol,
        build: { buildId: release },
        device: { platform: "ios", sdk: "react-native", appVersion: "1.0.0" },
        sentAt: now,
        events,
      },
    },
  });
  if (result.statusCode !== 202)
    throw new Error(
      "FIXTURE_NATIVE_INGEST_FAILED_" +
        result.statusCode +
        "_" +
        String(result.json().error).replace(/[^A-Za-z_]/g, ""),
    );
}
const timeout = await app.inject({
  method: "POST",
  url: "/internal/cco/native-batches",
  headers,
  payload: {
    binding,
    authorizedAt: now,
    batch: {
      anonId: anon,
      sessionId: session,
      scopeTag,
      protocol,
      build: { buildId: "fixture-candidate" },
      device: { platform: "ios", sdk: "react-native" },
      sentAt: now,
      events: [
        {
          type: "track",
          eventId: randomUUID(),
          ts: now - 1000,
          path: "/products",
          sampleRate: 1,
          correlation: {
            operationId: timeoutOp,
            stage: "request",
            outcomeState: "unknown",
            outcomeSource: "client",
          },
          props: { name: "cco_network_failure", code: "NETWORK_FAILURE" },
        },
      ],
    },
  },
});
if (timeout.statusCode !== 202)
  throw new Error("FIXTURE_TIMEOUT_INGEST_FAILED_" + timeout.statusCode);
const report = await app.inject({
  method: "POST",
  url: "/internal/cco/native-health",
  headers,
  payload: {
    binding,
    authorizedAt: now,
    report: {
      anonId: anon,
      sessionId: session,
      scopeTag,
      protocol,
      health,
      build: { buildId: "fixture-candidate" },
    },
  },
});
if (report.statusCode !== 202) throw new Error("FIXTURE_HEALTH_INGEST_FAILED_" + report.statusCode);
const backend = await app.inject({
  method: "POST",
  url: "/internal/cco/events",
  headers,
  payload: {
    events: [
      {
        eventId: "fixture-operation",
        accountId: "fixture-merchant",
        installationId: "fixture-install",
        generation: 1,
        operation: "products.update",
        outcome: "observed",
        occurredAt: now - 900,
        correlation: {
          operationId,
          jobId,
          stage: "operation",
          outcomeState: "accepted",
          outcomeSource: "backend",
        },
      },
      {
        eventId: "fixture-job",
        accountId: "fixture-merchant",
        installationId: "fixture-install",
        generation: 1,
        operation: "products.update",
        outcome: "failed",
        errorCode: "JOB_FAILED",
        occurredAt: now - 800,
        correlation: { jobId, stage: "job", outcomeState: "failed", outcomeSource: "job" },
      },
      {
        eventId: "fixture-readback",
        accountId: "fixture-merchant",
        installationId: "fixture-install",
        generation: 1,
        operation: "products.update",
        outcome: "succeeded",
        occurredAt: now - 700,
        correlation: {
          operationId: timeoutOp,
          stage: "outcome",
          outcomeState: "succeeded",
          outcomeSource: "readback",
        },
      },
    ],
  },
});
if (backend.statusCode !== 202)
  throw new Error("FIXTURE_BACKEND_INGEST_FAILED_" + backend.statusCode);
await mkdir("D:/Vertex-CCO-native-20261001/evidence", { recursive: true });
await writeFile(
  "D:/Vertex-CCO-native-20261001/evidence/native-local-collector.env",
  `TRACKI_CCO_URL=http://127.0.0.1:5490\nTRACKI_CCO_READ_KEY=${config.readKey}\n`,
);
await app.listen({ host: "127.0.0.1", port: 5490 });
console.log(
  "Synthetic local collector ready at 127.0.0.1:5490; credentials saved to local evidence env file.",
);
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    void app
      .close()
      .then(() => db.close())
      .then(() => process.exit(0));
  });
