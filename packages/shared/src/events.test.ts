import { describe, expect, it } from "vitest";
import {
  BEHAVIORAL_EVENT_TYPES,
  EVENT_TYPES,
  MOBILE_EVENT_TYPES,
  deviceContextSchema,
  eventBatchSchema,
  eventInputSchema,
} from "./events";

const validEvent = {
  type: "pageview" as const,
  ts: 1_700_000_000_000,
  path: "/",
  url: "https://x.sa/",
};

describe("eventInputSchema", () => {
  it("accepts a valid event", () => {
    expect(eventInputSchema.safeParse(validEvent).success).toBe(true);
  });

  it("rejects unknown event types", () => {
    expect(eventInputSchema.safeParse({ ...validEvent, type: "explode" }).success).toBe(false);
  });

  it("rejects oversized props", () => {
    const big = { type: "track" as const, ts: 1, props: { blob: "x".repeat(9000) } };
    expect(eventInputSchema.safeParse(big).success).toBe(false);
  });
});

describe("eventBatchSchema", () => {
  const batch = {
    key: "pk_abcdefghijklmnopqrstuvwx",
    anonId: "anon_1",
    sessionId: "sess_1",
    sentAt: 1_700_000_000_000,
    events: [validEvent],
  };

  it("accepts a valid batch", () => {
    expect(eventBatchSchema.safeParse(batch).success).toBe(true);
  });

  it("rejects empty event arrays", () => {
    expect(eventBatchSchema.safeParse({ ...batch, events: [] }).success).toBe(false);
  });

  it("rejects batches over the size cap", () => {
    const events = Array.from({ length: 51 }, () => validEvent);
    expect(eventBatchSchema.safeParse({ ...batch, events }).success).toBe(false);
  });

  it("requires a key", () => {
    const { key, ...noKey } = batch;
    expect(eventBatchSchema.safeParse(noKey).success).toBe(false);
  });

  // Slice 14 — mobile device context.
  it("accepts a batch with a device block", () => {
    const r = eventBatchSchema.safeParse({
      ...batch,
      device: {
        platform: "ios",
        osVersion: "17.4",
        appVersion: "2.1.0",
        model: "iPhone15,2",
        sdk: "react-native",
      },
    });
    expect(r.success).toBe(true);
  });

  it("rejects unknown platforms and oversized device fields", () => {
    expect(deviceContextSchema.safeParse({ platform: "windows-phone" }).success).toBe(false);
    expect(
      deviceContextSchema.safeParse({ platform: "android", appVersion: "x".repeat(33) }).success,
    ).toBe(false);
  });
});

// Slice 14 — mobile event vocabulary.
describe("mobile event types", () => {
  it("every mobile type is a valid EVENT_TYPE and counts as behavioral", () => {
    for (const t of MOBILE_EVENT_TYPES) {
      expect(EVENT_TYPES).toContain(t);
      expect(BEHAVIORAL_EVENT_TYPES).toContain(t);
    }
  });

  it("accepts mobile events through the input schema", () => {
    for (const [type, props] of [
      ["screen_view", undefined],
      ["otp_fail", undefined],
      ["screen_leave", { durationMs: 4200 }],
      ["flow_abandon", { flow: "checkout" }],
      ["permission_denied", { permission: "notifications" }],
      ["deep_link", { url: "app://promo", ok: false }],
    ] as const) {
      const r = eventInputSchema.safeParse({
        type,
        ts: 1_700_000_000_000,
        path: "/checkout",
        props,
      });
      expect(r.success, type).toBe(true);
    }
  });
});
