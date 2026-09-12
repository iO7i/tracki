import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetMetrics, snapshot } from "./metrics";

const fakes = vi.hoisted(() => {
  const pipeline = {
    publish: vi.fn(),
    exec: vi.fn(() => Promise.resolve([])),
  };
  pipeline.publish.mockReturnValue(pipeline);
  const redisClient = { pipeline: vi.fn(() => pipeline) };
  const pgQuery = vi.fn(() => Promise.resolve([]));
  const clickhouse = {
    close: vi.fn(() => Promise.resolve()),
    ping: vi.fn(() => Promise.resolve({ success: false })),
  };
  return {
    acceptEvents: vi.fn(),
    allowRequest: vi.fn(),
    createClickHouse: vi.fn(() => clickhouse),
    handleHandoff: vi.fn(),
    handleInbound: vi.fn(),
    peekHandoffProject: vi.fn(),
    pg: vi.fn(() => pgQuery),
    pipeline,
    popAssist: vi.fn(),
    projectForWaId: vi.fn(),
    redis: vi.fn(() => redisClient),
    resolveInboundProject: vi.fn(),
    resolveKey: vi.fn(),
    upsertIdentity: vi.fn(),
  };
});

vi.mock("@tracki/clickhouse", () => ({ createClickHouse: fakes.createClickHouse }));
vi.mock("@tracki/whatsapp", () => ({
  simulateAllowed: vi.fn(() => false),
  verifySignature: vi.fn(() => true),
}));
vi.mock("./assist.js", () => ({ popAssist: fakes.popAssist }));
vi.mock("./inbox", () => ({ acceptEvents: fakes.acceptEvents }));
vi.mock("./keys.js", () => ({
  allowRequest: fakes.allowRequest,
  resolveKey: fakes.resolveKey,
}));
vi.mock("./pg.js", () => ({
  faqArticlesForProject: vi.fn(),
  peekHandoffProject: fakes.peekHandoffProject,
  pg: fakes.pg,
  projectForWaId: fakes.projectForWaId,
  upsertIdentity: fakes.upsertIdentity,
}));
vi.mock("./redis.js", () => ({ redis: fakes.redis }));
vi.mock("./whatsapp.js", () => ({
  handleHandoff: fakes.handleHandoff,
  handleInbound: fakes.handleInbound,
  resolveInboundProject: fakes.resolveInboundProject,
}));

const { buildServer } = await import("./server");

const ref = { orgId: "org_contract", projectId: "project_contract" };

function batch(overrides: Record<string, unknown> = {}) {
  const sentAt = Date.now() - 1_000;
  return {
    protocolVersion: 1,
    key: "pk_contract",
    anonId: "anon_contract",
    sessionId: "session_contract",
    sentAt,
    events: [
      {
        eventId: "evt_contract_1",
        type: "click",
        ts: sentAt,
        path: "/checkout",
        props: { tag: "button", id: "pay" },
      },
    ],
    ...overrides,
  };
}

describe("ingest HTTP contract", () => {
  let app: Awaited<ReturnType<typeof buildServer>>;

  beforeEach(() => {
    resetMetrics();
    vi.clearAllMocks();
    fakes.allowRequest.mockResolvedValue(true);
    fakes.resolveKey.mockResolvedValue(ref);
    fakes.acceptEvents.mockResolvedValue([
      { event_id: "stored_contract_1", type: "click", path: "/checkout" },
    ]);
    fakes.popAssist.mockResolvedValue(null);
    fakes.pipeline.exec.mockResolvedValue([]);
    fakes.pipeline.publish.mockReturnValue(fakes.pipeline);
    app = buildServer();
  });

  afterEach(async () => {
    await app.close();
  });

  it.each([
    ["malformed body", { key: "pk_contract" }, 400, "events_rejected_total"],
    ["unsupported future protocol", batch({ protocolVersion: 99 }), 400, "events_rejected_total"],
  ])("rejects %s before calling dependencies", async (_name, payload, status, metric) => {
    const response = await app.inject({ method: "POST", url: "/v1/events", payload });

    expect(response.statusCode).toBe(status);
    expect(fakes.allowRequest).not.toHaveBeenCalled();
    expect(snapshot().counters[metric]).toBe(1);
  });

  it("returns 429 and records rate limiting", async () => {
    fakes.allowRequest.mockResolvedValue(false);

    const response = await app.inject({ method: "POST", url: "/v1/events", payload: batch() });

    expect(response.statusCode).toBe(429);
    expect(response.json()).toEqual({ ok: false });
    expect(snapshot().counters).toMatchObject({
      http_events_requests_total: 1,
      events_rate_limited_total: 1,
    });
  });

  it("returns a benign 202 for an unknown key", async () => {
    fakes.resolveKey.mockResolvedValue(null);

    const response = await app.inject({ method: "POST", url: "/v1/events", payload: batch() });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({ ok: true });
    expect(snapshot().counters.events_unknown_key_total).toBe(1);
  });

  it("returns 202 and exposes only aggregate metrics on acceptance", async () => {
    const response = await app.inject({ method: "POST", url: "/v1/events", payload: batch() });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({ ok: true });
    expect(fakes.pipeline.publish).toHaveBeenCalledTimes(1);
    expect(snapshot().counters).toMatchObject({
      events_accepted_total: 1,
      events_duplicate_total: 0,
    });
    expect(snapshot().histograms.event_acceptance_latency_ms?.count).toBe(1);

    const metrics = await app.inject({ method: "GET", url: "/metrics" });
    expect(metrics.statusCode).toBe(200);
    expect(metrics.headers["content-type"]).toContain("text/plain");
    expect(metrics.body).toContain("tracki_events_accepted_total 1");
    expect(metrics.body).not.toContain("pk_contract");
    expect(metrics.body).not.toContain("anon_contract");
  });

  it("returns 202 for exact durable duplicates and counts them", async () => {
    fakes.acceptEvents.mockResolvedValue([]);

    const response = await app.inject({ method: "POST", url: "/v1/events", payload: batch() });

    expect(response.statusCode).toBe(202);
    expect(snapshot().counters).toMatchObject({
      events_accepted_total: 0,
      events_duplicate_total: 1,
    });
  });

  it("returns 409 when the same explicit ID appears with different content", async () => {
    const first = batch().events[0];
    const events = [first, { ...first, props: { tag: "button", id: "refund" } }];

    const response = await app.inject({
      method: "POST",
      url: "/v1/events",
      payload: batch({ events }),
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: "event id conflict" });
    expect(fakes.acceptEvents).not.toHaveBeenCalled();
    expect(snapshot().counters.events_identity_conflicts_total).toBe(1);
  });

  it("returns retryable 503 and records storage failures", async () => {
    fakes.acceptEvents.mockRejectedValue(new Error("database unavailable"));

    const response = await app.inject({ method: "POST", url: "/v1/events", payload: batch() });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ ok: false, error: "temporarily unavailable" });
    expect(snapshot().counters.events_acceptance_failures_total).toBe(1);
  });
});
