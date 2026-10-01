import { describe, expect, it } from "vitest";
import { event } from "./contract";
import {
  classifyEvidence,
  incidentIdentity,
  operationTimelines,
  releaseComparisons,
} from "./native-engine";
import { nativeHealth, nativeProtocol, operationCorrelation, deliveryFailure } from "./native-meta";
import type { NativeDiagnosticEvent, NativeSession } from "./native-read-model";
const now = Date.now(),
  id = "a".repeat(32),
  op = "b".repeat(32),
  job = "c".repeat(32);
function observed(override: Partial<NativeDiagnosticEvent> = {}): NativeDiagnosticEvent {
  return event({
    version: 1,
    eventId: "e",
    orgId: "org",
    projectId: "p",
    accountId: "merchant",
    appKey: "seo",
    environment: "staging",
    installationId: "install",
    generation: 1,
    sessionRef: "sess",
    traceId: id,
    spanId: "a".repeat(16),
    parentSpanId: null,
    causedBy: null,
    authority: "observed",
    source: "tracki.native",
    operation: "cco_response",
    outcome: "failed",
    errorCode: "JS_ERROR",
    route: "/products",
    release: "one",
    occurredAt: now,
    receivedAt: now,
    replay: null,
    ...override,
  });
}
const report = {
  reporterId: "12345678-1234-4234-8234-123456789abc",
  revision: 1,
  observedAt: now,
  observed: 10,
  sampledOut: 0,
  droppedCapacity: 0,
  droppedExpired: 0,
  rejected: 0,
  storageFailures: 0,
  unsupportedSchema: 0,
  accepted: 10,
  queueDepth: 0,
  queueBytes: 0,
  retryingCount: 0,
  routineSuccessSampleRate: 1,
  lastResponseCategory: "accepted",
};
function session(health = report): NativeSession {
  return {
    sessionRef: "s",
    appKey: "seo",
    environment: "staging",
    accountId: "merchant",
    installationId: null,
    firstSeen: now,
    lastSeen: now,
    build: {},
    release: "one",
    protocol: nativeProtocol(null),
    evidenceHealth: "healthy",
    receivedEventCount: 10,
    reportedHealth: health,
  };
}
describe("native diagnostics semantics", () => {
  it("distinguishes legacy and current schema and rejects required unknown capabilities", () => {
    expect(nativeProtocol(undefined).compatibility).toBe("older-capability-set");
    expect(nativeProtocol({ sdkVersion: "0.1.0", schemaVersion: 1 }).compatibility).toBe(
      "deprecated",
    );
    expect(
      nativeProtocol({ sdkVersion: "0.2.0", schemaVersion: 2, capabilities: ["capture-health-v1"] })
        .compatibility,
    ).toBe("fully-supported");
    expect(() => nativeProtocol({ sdkVersion: "0.2.0", schemaVersion: 3 })).toThrow();
    expect(() =>
      nativeProtocol({
        sdkVersion: "0.2.0",
        schemaVersion: 2,
        capabilities: ["future"],
        requiredCapabilities: ["future"],
      }),
    ).toThrow();
    expect(
      nativeProtocol({ sdkVersion: "0.2.0", schemaVersion: 2, capabilities: ["future"] })
        .compatibility,
    ).toBe("older-capability-set");
  });
  it("does not equate silence with no incidents", () =>
    expect(classifyEvidence([], 0, now)).toMatchObject({
      status: "unavailable",
      completeness: "unknown",
      reason: "no_evidence_received",
    }));
  it("distinguishes loss, sampling and delayed queues", () => {
    expect(classifyEvidence([session({ ...report, droppedCapacity: 1 })], 10, now).status).toBe(
      "incomplete",
    );
    expect(classifyEvidence([session({ ...report, sampledOut: 1 })], 10, now).completeness).toBe(
      "sampled",
    );
    expect(classifyEvidence([session({ ...report, queueDepth: 1 })], 10, now).status).toBe(
      "delayed",
    );
    expect(classifyEvidence([session({ ...report, unsupportedSchema: 1 })], 10, now).status).toBe(
      "misconfigured",
    );
  });
  it("rejects health fields containing user input and invalid counter bounds", () => {
    expect(() => nativeHealth({ ...report, observed: -1 }, now)).toThrow();
    expect(
      JSON.stringify(nativeHealth({ ...report, password: "secret", body: "secret" }, now)),
    ).not.toContain("secret");
  });
  it("groups deterministically and separates app/environment/release/route", () => {
    const base = incidentIdentity(observed())!.incidentId;
    expect(incidentIdentity(observed({ eventId: "other" }))!.incidentId).toBe(base);
    for (const change of [
      { release: "two" },
      { environment: "production" },
      { appKey: "cro" },
      { route: "/orders" },
    ])
      expect(incidentIdentity(observed(change))!.incidentId).not.toBe(base);
  });
  it("never accepts a client readback as authoritative", () => {
    const client = observed({
      correlation: {
        operationId: op,
        stage: "outcome",
        outcomeState: "succeeded",
        outcomeSource: "readback",
      },
    });
    expect(client.correlation?.outcomeSource).toBe("client");
    expect(operationTimelines([client])[0]).toMatchObject({
      authoritativeOutcome: false,
      incompleteChain: true,
    });
  });
  it("supports HTTP200 then job failure without pretending finality", () => {
    const start = observed({
      eventId: "request",
      outcome: "observed",
      httpStatus: 200,
      errorCode: null,
      correlation: { operationId: op, clientRequestId: id, stage: "request" },
    });
    const backend = observed({
      eventId: "backend",
      occurredAt: now + 1,
      source: "server.seo",
      authority: "server-reported",
      correlation: {
        operationId: op,
        jobId: job,
        stage: "operation",
        outcomeState: "accepted",
        outcomeSource: "backend",
      },
    });
    const failed = observed({
      eventId: "job",
      occurredAt: now + 2,
      source: "server.seo",
      authority: "server-reported",
      correlation: { jobId: job, stage: "job", outcomeState: "failed", outcomeSource: "job" },
    });
    expect(operationTimelines([start, backend, failed])[0]).toMatchObject({
      observedOutcome: "failed",
      authoritativeOutcome: false,
      incompleteChain: true,
    });
  });
  it("supports timed-out client followed by authoritative readback success", () => {
    const timeout = observed({
      eventId: "request",
      operation: "cco_network_failure",
      correlation: {
        operationId: op,
        stage: "request",
        outcomeState: "unknown",
        outcomeSource: "client",
      },
    });
    const readback = observed({
      eventId: "readback",
      occurredAt: now + 1,
      source: "server.seo",
      authority: "server-reported",
      outcome: "succeeded",
      correlation: {
        operationId: op,
        stage: "outcome",
        outcomeState: "succeeded",
        outcomeSource: "readback",
      },
    });
    expect(operationTimelines([timeout, readback])[0]).toMatchObject({
      observedOutcome: "succeeded",
      authoritativeOutcome: true,
      incompleteChain: false,
    });
  });
  it("never joins opaque operation IDs across merchants", () =>
    expect(
      operationTimelines([
        observed({ correlation: { operationId: op } }),
        observed({ eventId: "other", accountId: "other", correlation: { operationId: op } }),
      ]),
    ).toHaveLength(2));
  it("never joins opaque IDs across stores or installation generations", () => {
    for (const change of [{ installationId: "other-store" }, { generation: 2 }])
      expect(
        operationTimelines([
          observed({ correlation: { operationId: op } }),
          observed({ eventId: "other", ...change, correlation: { operationId: op } }),
        ]),
      ).toHaveLength(2);
  });
  it("does not treat authoritative pending readback as business finality", () =>
    expect(
      operationTimelines([
        observed({
          source: "server.seo",
          authority: "server-reported",
          correlation: {
            operationId: op,
            stage: "outcome",
            outcomeState: "pending",
            outcomeSource: "readback",
          },
        }),
      ])[0],
    ).toMatchObject({ authoritativeOutcome: false, incompleteChain: true }));
  it("requires sample size and known sampling probability for release claims", () => {
    const rows = [observed({ release: "one" }), observed({ eventId: "two", release: "two" })];
    expect(releaseComparisons(rows, "one", "two", now - 1000, now, false)[0]?.result).toBe(
      "insufficient evidence",
    );
  });
  it("labels sample-adjusted material increases without claiming causation", () => {
    const rows = Array.from({ length: 80 }, (_, i) =>
      observed({
        eventId: `r${i}`,
        spanId: (i + 1).toString(16).padStart(16, "0"),
        release: i < 40 ? "one" : "two",
        errorCode: null,
        outcome: i >= 60 ? "failed" : "observed",
        sampleRate: 1,
        httpStatus: i >= 60 ? 500 : 200,
      }),
    );
    expect(releaseComparisons(rows, "one", "two", now - 1000, now, false)[0]).toMatchObject({
      result: "material increase observed",
      causationEstablished: false,
    });
    expect(releaseComparisons(rows, "one", "two", now - 1000, now, true)[0]?.result).toBe(
      "insufficient evidence",
    );
  });
  it("classifies permanent and retryable failures", () => {
    expect(deliveryFailure(422)).toMatchObject({
      category: "unsupported_schema",
      retryable: false,
    });
    expect(deliveryFailure(429)).toMatchObject({ category: "rate_limited", retryable: true });
    expect(deliveryFailure(410)).toMatchObject({ category: "expired", retryable: false });
    expect(deliveryFailure()).toMatchObject({ category: "network_unavailable", retryable: true });
  });
  it("rejects plain business text as an operation reference", () =>
    expect(() => operationCorrelation({ operationId: "customer-private" })).toThrow());
});
