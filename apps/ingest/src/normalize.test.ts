import type { EventBatch, ProjectRef } from "@tracki/shared";
import { describe, expect, it } from "vitest";
import { coarsenUA, normalizeBatch } from "./normalize.js";

const ref: ProjectRef = { projectId: "proj_1", orgId: "org_1" };

const batch: EventBatch = {
  key: "pk_x",
  anonId: "anon_1",
  userId: "user_9",
  sessionId: "sess_1",
  sentAt: 1_700_000_000_000,
  events: [
    {
      type: "pageview",
      ts: 1_700_000_000_000,
      url: "https://shop.sa/checkout?email=buyer@shop.sa",
      path: "/checkout",
      props: { coupon: "SAVE10", phone: "+971501234567" },
    },
  ],
};

describe("normalizeBatch", () => {
  it("scrubs PII from url and props and never stores raw", () => {
    const [e] = normalizeBatch(batch, ref, "UA/1.0", 1_700_000_001_000);
    expect(e).toBeDefined();
    if (!e) return;
    expect(e.url).not.toContain("buyer@shop.sa");
    expect(e.props).not.toContain("+971501234567");
    expect(e.props).toContain("SAVE10");
  });

  it("stamps org/project/identity and a fresh event id", () => {
    const [e] = normalizeBatch(batch, ref, "UA/1.0", 1_700_000_001_000);
    if (!e) return;
    expect(e.org_id).toBe("org_1");
    expect(e.project_id).toBe("proj_1");
    expect(e.user_id).toBe("user_9");
    expect(e.received_at).toBe(1_700_000_001_000);
    expect(e.event_id).toMatch(/[0-9a-f-]{36}/);
  });

  it("defaults user_id to empty for anonymous batches", () => {
    const anon = { ...batch, userId: undefined };
    const [e] = normalizeBatch(anon, ref, "UA/1.0", 1);
    expect(e?.user_id).toBe("");
  });

  // Slice 14 — mobile device context.
  it("stamps device context onto every row and builds a coarse app UA", () => {
    const mobile: EventBatch = {
      ...batch,
      device: {
        platform: "android",
        osVersion: "14",
        appVersion: "3.2.1",
        model: "SM-S918B",
        sdk: "flutter",
      },
    };
    const [e] = normalizeBatch(mobile, ref, "okhttp/4.12.0", 1);
    expect(e?.platform).toBe("android");
    expect(e?.app_version).toBe("3.2.1");
    expect(e?.device_model).toBe("SM-S918B");
    // Never the raw network UA for app traffic — a server-built coarse pair.
    expect(e?.ua).toBe("App android/14");
  });

  it("web batches (no device block) default platform to web with empty fields", () => {
    const [e] = normalizeBatch(batch, ref, "Mozilla/5.0 (Windows NT 10.0) Chrome/120.0", 1);
    expect(e?.platform).toBe("web");
    expect(e?.app_version).toBe("");
    expect(e?.device_model).toBe("");
  });

  it("coarsens the User-Agent rather than storing it raw (Audit M1)", () => {
    const ua =
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML) Version/17.0 Mobile Safari/604.1";
    const [e] = normalizeBatch(batch, ref, ua, 1);
    expect(e?.ua).toBe("Safari/iOS");
    expect(e?.ua).not.toContain("AppleWebKit");
  });
});

describe("normalizeBatch — Vertex named-event allowlist", () => {
  it("keeps only allowlisted props on a recognized Vertex track event and drops the rest", () => {
    const vertex: EventBatch = {
      ...batch,
      events: [
        {
          type: "track",
          ts: 1_700_000_000_000,
          props: {
            name: "signup_completed",
            platformInterest: "salla",
            userId: "usr_abc",
            // must be dropped — not on the allowlist / raw PII:
            email: "buyer@shop.sa",
            oauthToken: "eyJhbGciOiJIUzI1NiJ9.payload.sig",
            orderTotal: 1299,
          },
        },
      ],
    };
    const [e] = normalizeBatch(vertex, ref, "UA/1.0", 1);
    if (!e) return;
    expect(e.props).toContain("signup_completed");
    expect(e.props).toContain("salla");
    expect(e.props).toContain("usr_abc");
    expect(e.props).not.toContain("buyer@shop.sa");
    expect(e.props).not.toContain("eyJhbGciOiJIUzI1NiJ9");
    expect(e.props).not.toContain("orderTotal");
  });

  it("leaves unrecognized track names to the generic scrub", () => {
    const other: EventBatch = {
      ...batch,
      events: [{ type: "track", ts: 1, props: { name: "custom_thing", label: "SAVE10" } }],
    };
    const [e] = normalizeBatch(other, ref, "UA/1.0", 1);
    expect(e?.props).toContain("custom_thing");
    expect(e?.props).toContain("SAVE10");
  });
});

describe("coarsenUA", () => {
  it("maps common browser/OS families", () => {
    expect(coarsenUA("Mozilla/5.0 (Windows NT 10.0) Chrome/120.0")).toBe("Chrome/Windows");
    expect(coarsenUA("Mozilla/5.0 (Linux; Android 14) Chrome/120")).toBe("Chrome/Android");
    expect(coarsenUA("")).toBe("");
  });
});
