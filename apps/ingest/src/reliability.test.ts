import { type EventBatch, eventBatchSchema } from "@tracki/shared";
import { describe, expect, it } from "vitest";
import { detectBatch } from "./detector";
import { normalizeBatch } from "./normalize";
import { scrubString, scrubValue } from "./scrub";
import { InMemoryStateStore } from "./state";

const now = 1_800_000_000_000;
const ref = { orgId: "org", projectId: "project" };
function batch(offsets = [0, 4000, 8000]): EventBatch {
  return {
    key: "pk_test",
    anonId: "anon",
    sessionId: "session",
    sentAt: now,
    events: offsets.map((t, i) => ({
      eventId: `evt_${i}`,
      type: "click",
      ts: now - 8000 + t,
      path: "/buy",
      props: { tag: "button", id: "buy" },
    })),
  };
}
describe("normalization and detection regression", () => {
  it.each([
    ["otp_fail", "otp_failure_loop", 2, 300_000, {}],
    ["payment_fail", "repeated_payment_failure", 2, 600_000, {}],
    ["app_foreground", "app_restart_loop", 3, 600_000, { launch: "cold" }],
    ["screen_view", "rapid_screen_switching", 6, 30_000, {}],
    ["error", "repeated_error", 2, 60_000, {}],
    ["form_submit", "repeated_submit", 2, 90_000, {}],
    ["pageview", "thrashing", 6, 30_000, {}],
    ["biometric_fail", "biometric_failure_loop", 2, 300_000, {}],
    ["back_nav", "repeated_back_navigation", 4, 30_000, {}],
    ["permission_denied", "permission_denial_loop", 2, 600_000, {}],
  ] as const)("uses event time for %s", async (type, signal, count, window, props) => {
    for (const fast of [false, true]) {
      const input = batch();
      input.events = Array.from({ length: count }, (_, i) => ({
        eventId: `window_${i}`,
        type,
        props,
        ts: now - (count - 1 - i) * (fast ? 100 : window + 1),
      }));
      const detections = await detectBatch(
        new InMemoryStateStore(() => now),
        normalizeBatch(input, ref, "", now),
      );
      expect(detections.some((d) => d.type === signal)).toBe(fast);
    }
  });
  it("keeps legacy exact replays stable without collapsing identical legitimate events", () => {
    const input = batch();
    const source = input.events[0];
    if (!source) throw new Error("missing fixture");
    const { eventId, ...legacy } = source;
    input.events = [legacy, { ...legacy }];
    const ids = normalizeBatch(input, ref, "", now).map((e) => e.event_id);
    expect(new Set(ids).size).toBe(2);
    expect(normalizeBatch(input, ref, "", now + 100).map((e) => e.event_id)).toEqual(ids);
    input.events = [
      { ...legacy, eventId: "first" },
      { ...legacy, eventId: "second" },
    ];
    expect(new Set(normalizeBatch(input, ref, "", now).map((e) => e.event_id)).size).toBe(2);
  });
  it("keeps onboarding explicit and the legacy dead_click signal observational", async () => {
    const input = batch([7000, 7500, 8000]);
    for (const e of input.events) e.props = { tag: "div" };
    const signals = await detectBatch(
      new InMemoryStateStore(() => now),
      normalizeBatch(input, ref, "", now),
    );
    expect(signals[0]?.type).toBe("dead_click");
    expect(signals[0]?.reason).toContain("responsiveness unknown");
    input.events = [
      { type: "flow_abandon", eventId: "onboard", ts: now, props: { flow: "onboarding" } },
    ];
    expect(
      (await detectBatch(new InMemoryStateStore(() => now), normalizeBatch(input, ref, "", now)))[0]
        ?.type,
    ).toBe("onboarding_abandonment");
  });
  it("does not turn eight seconds of clicks into a three-second burst", async () => {
    expect(
      await detectBatch(new InMemoryStateStore(() => now), normalizeBatch(batch(), ref, "", now)),
    ).toEqual([]);
  });
  it("detects a genuine burst even when submitted out of order", async () => {
    const input = batch([8000, 7000, 7500]);
    expect(
      (await detectBatch(new InMemoryStateStore(() => now), normalizeBatch(input, ref, "", now)))[0]
        ?.type,
    ).toBe("rage_click");
  });
  it("preserves spacing under bounded positive clock skew", () => {
    const input = batch();
    input.sentAt += 60_000;
    for (const e of input.events) e.ts += 60_000;
    expect(normalizeBatch(input, ref, "", now).map((e) => e.ts)).toEqual(
      batch().events.map((e) => e.ts),
    );
  });
  it("rejects expired, missing, invalid and far-future times", () => {
    for (const ts of [0, Number.NaN, now - 86_400_001, now + 120_001]) {
      const input = batch();
      if (input.events[0]) input.events[0].ts = ts;
      expect(() => normalizeBatch(input, ref, "", now)).toThrow();
    }
    expect(eventBatchSchema.safeParse({ ...batch(), events: [{ type: "click" }] }).success).toBe(
      false,
    );
  });
  it("keeps event identities stable for partial retry and scopes them to tenants", () => {
    const a = normalizeBatch(batch(), ref, "", now);
    const input = batch();
    input.sentAt += 1000;
    input.events = input.events.slice(1);
    expect(normalizeBatch(input, ref, "", now + 1000).map((e) => e.event_id)).toEqual(
      a.slice(1).map((e) => e.event_id),
    );
    expect(normalizeBatch(batch(), { ...ref, projectId: "other" }, "", now)[0]?.event_id).not.toBe(
      a[0]?.event_id,
    );
  });
  it("rejects abusive session identifiers", () => {
    for (const sessionId of ["", "x".repeat(65), "other:session", "a\nb", "a/b"]) {
      expect(eventBatchSchema.safeParse({ ...batch(), sessionId }).success).toBe(false);
    }
  });
});
describe("privacy regressions", () => {
  it.each([
    "PASSWORD",
    "passwd",
    "pwd",
    "secret",
    "token",
    "access_token",
    "refresh_token",
    "id_token",
    "authorization",
    "cookie",
    "set-cookie",
    "api_key",
    "apiKey",
    "apikey",
    "client_secret",
    "private_key",
  ])("redacts sensitive key %s", (key) => {
    expect(scrubValue({ nested: [{ [key]: "opaque-demo" }] })).toEqual({
      nested: [{ [key]: "[redacted]" }],
    });
  });
  it("redacts credentials recursively independent of their values", () => {
    const result = scrubValue({
      password: "demo-password",
      authorization: "Bearer exampleOpaqueToken",
      nested: [{ Api_Key: "opaque", CLIENTsecret: 123, refresh_token: "value" }],
    });
    expect(JSON.stringify(result)).not.toMatch(/demo-password|exampleOpaqueToken|opaque|123|value/);
    expect(JSON.stringify(result)).toContain("[redacted]");
  });
  it("scrubs encoded query keys and values while preserving harmless structure", () => {
    const safe = scrubString(
      "https://example.test/path?q=hello%20world&email=person%40example.test&%70assword=demo-password",
    );
    expect(safe).toContain("q=hello%20world");
    expect(safe).not.toContain("person%40");
    expect(safe).not.toContain("demo-password");
    expect(decodeURIComponent(safe)).toContain("password=[redacted]");
  });
});
