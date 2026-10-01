import { afterEach, describe, expect, it } from "vitest";
import { createTracki, type KeyValueStorage } from "@io7i/tracki-mobile-core";
import { createCcoNativeBridge, type CcoNativeBridge } from "./cco";
const bridges: CcoNativeBridge[] = [];
afterEach(() => { for (const bridge of bridges.splice(0)) bridge.dispose(); });
async function fixture(options: { healthAck?: boolean; eventStatus?: number; signedIn?: boolean } = {}) {
  const data = new Map<string, string>();
  const storage: KeyValueStorage = { get: async key => data.get(key) ?? null, set: async (key, value) => { data.set(key, value); }, remove: async key => { data.delete(key); } };
  const calls: { url: string; body: Record<string, unknown>; headers: Headers }[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = String(input); const body = init?.body && url.includes("/api/cco/native/") ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
    calls.push({ url, body, headers: new Headers(init?.headers) });
    if (url.endsWith("/bootstrap")) return Response.json({ token: "fixture-not-a-real-grant-xxxxxxxxxx", scopeTag: "a".repeat(64), expiresAt: Date.now() + 600000, capturePolicy: { diagnostics: true, activity: false } });
    if (url.endsWith("/health")) {
      const health = body.health as { reporterId: string; revision: number };
      return Response.json({ acceptedHealth: { reporterId: health.reporterId, revision: health.revision + (options.healthAck === false ? 1 : 0) } });
    }
    if (url.endsWith("/events")) {
      if (options.eventStatus) return Response.json({}, { status: options.eventStatus });
      const batch = body.batch as { events: { eventId: string }[] };
      return Response.json({ acceptedClientIds: batch.events.map(event => event.eventId) });
    }
    return Response.json({ private: "domain-response-is-never-in-diagnostics" }, { headers: { "x-request-id": "1".repeat(32), "x-operation-id": "2".repeat(32), "x-job-id": "3".repeat(32) } });
  };
  const bridge = await createCcoNativeBridge({ apiOrigin: "https://app.test", namespace: "hr:staging:fixture", grantStorage: storage, getAuthorization: async () => options.signedIn === false ? null : "Bearer fixture-not-a-real-session", fetch: fetcher, createTraceContext: () => ({ traceId: "4".repeat(32), spanId: "5".repeat(16) }) });
  bridges.push(bridge);
  const client = await createTracki({ key: "pk_fixture", endpoint: "https://app.test", storage, device: { platform: "android" }, environment: "staging" });
  return { bridge, client, calls, data };
}
describe("authenticated native bridge", () => {
  it("rejects non-finite timer configuration before creating resources", async () => {
    for (const timing of [{ timeoutMs: NaN }, { timeoutMs: Infinity }, { healthIntervalMs: NaN }, { healthIntervalMs: Infinity }]) {
      await expect(createCcoNativeBridge({ apiOrigin: "https://app.test", namespace: "hr:staging", grantStorage: { get: async () => null, set: async () => {}, remove: async () => {} }, getAuthorization: async () => null, ...timing })).rejects.toMatchObject({ code: "invalid-configuration" });
    }
  });
  it("sends health without manufacturing events and accepts only exact receipts", async () => {
    const f = await fixture(); await f.bridge.connect(f.client); await f.bridge.reportHealth();
    const report = f.calls.find(call => call.url.endsWith("/health"));
    expect(report?.body).toMatchObject({ scopeTag: "a".repeat(64), protocol: { schemaVersion: 2 }, health: { queueDepth: 0 } });
    expect(report?.body).not.toHaveProperty("events");
    expect(f.calls.filter(call => call.url.endsWith("/events"))).toHaveLength(0);
    expect(f.client.queueHealth().lastSuccessAt).toBeGreaterThan(0);
  });
  it("records a mismatched health receipt as delivery failure", async () => {
    const f = await fixture({ healthAck: false }); await f.bridge.connect(f.client);
    await expect(f.bridge.reportHealth()).rejects.toMatchObject({ code: "invalid-acknowledgment" });
    expect(f.client.queueHealth().lastResponseCategory).toBe("invalid_acknowledgment");
  });
  it("correlates opaque headers while HTTP acceptance remains client observed", async () => {
    const f = await fixture(); await f.bridge.connect(f.client);
    await f.bridge.tracedFetch("https://app.test/api/orders?email=private", { method: "POST", body: "private input" });
    await f.client.flush();
    const batch = f.calls.find(call => call.url.endsWith("/events"))?.body.batch as { events: { correlation: unknown }[] };
    expect(batch.events[1]?.correlation).toMatchObject({ requestId: "1".repeat(32), operationId: "2".repeat(32), jobId: "3".repeat(32), outcomeSource: "client", outcomeState: "accepted" });
    expect(JSON.stringify(batch)).not.toContain("private");
    const app = f.calls.find(call => call.url.includes("/api/orders"));
    expect(app?.headers.get("x-client-request-id")).toBe("5".repeat(16));
  });
  it("fails closed without session authority", async () => {
    const f = await fixture({ signedIn: false });
    await expect(f.bridge.connect(f.client)).rejects.toMatchObject({ code: "authentication-required" });
    expect(f.client.capturePolicy()).toEqual({ diagnostics: false, activity: false });
    expect(f.calls).toHaveLength(0);
  });
  it("purges grants, identity and queue after collector authentication rejection", async () => {
    const f = await fixture({ eventStatus: 401 }); await f.bridge.connect(f.client); const previous = f.client.anonId();
    f.client.error("JS_ERROR"); await f.client.flush();
    expect(f.client.captureScope()).toBeNull(); expect(f.client.anonId()).not.toBe(previous);
    expect(f.client.queueHealth().queueDepth).toBe(0);
    expect([...f.data.values()].some(value => value.includes("fixture-not-a-real-grant"))).toBe(false);
  });
});
