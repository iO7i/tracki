import { describe, expect, it } from "vitest";
import {
  VERTEX_EVENTS,
  classifyReferrer,
  isVertexEvent,
  sanitizeVertexTrack,
} from "./vertex";

describe("vertex event registry", () => {
  it("recognizes exactly the 23 named events", () => {
    expect(VERTEX_EVENTS).toHaveLength(23);
    expect(isVertexEvent("booking_completed")).toBe(true);
    expect(isVertexEvent("nope")).toBe(false);
    expect(isVertexEvent(undefined)).toBe(false);
  });
});

describe("sanitizeVertexTrack", () => {
  it("passes through unrecognized names untouched (ok=false)", () => {
    const r = sanitizeVertexTrack({ name: "custom_thing", foo: "bar" });
    expect(r.ok).toBe(false);
    expect(r.name).toBeNull();
  });

  it("keeps allowlisted scalar props and preserves name", () => {
    const r = sanitizeVertexTrack({
      name: "pricing_plan_selected",
      planId: "growth",
      currency: "SAR",
      platformInterest: "salla",
      path: "/pricing",
    });
    expect(r.ok).toBe(true);
    expect(r.props).toMatchObject({
      name: "pricing_plan_selected",
      planId: "growth",
      currency: "SAR",
      platformInterest: "salla",
      path: "/pricing",
    });
  });

  it("drops non-allowlisted props and reports them", () => {
    const r = sanitizeVertexTrack({ name: "signup_completed", secretToken: "abc", orderTotal: 999 });
    expect(r.props.secretToken).toBeUndefined();
    expect(r.props.orderTotal).toBeUndefined();
    expect(r.dropped).toEqual(expect.arrayContaining(["secretToken", "orderTotal"]));
  });

  it("masks PII that leaks into an allowlisted string prop", () => {
    // email accidentally shoved into a surrogate-id slot must not survive
    const r = sanitizeVertexTrack({ name: "signup_completed", userId: "buyer@example.com" });
    expect(r.props.userId).not.toContain("buyer@example.com");
  });

  it("drops nested objects/arrays (only scalars survive)", () => {
    const r = sanitizeVertexTrack({ name: "store_connected", storeId: { id: 1 }, region: ["riyadh"] });
    expect(r.props.storeId).toBeUndefined();
    expect(r.props.region).toBeUndefined();
  });

  it("coerces out-of-range categoricals to their safe default", () => {
    const r = sanitizeVertexTrack({ name: "platform_selected", platformInterest: "shopify", deviceClass: "watch" });
    expect(r.props.platformInterest).toBe("unknown");
    expect(r.props.deviceClass).toBe("unknown");
  });
});

describe("classifyReferrer", () => {
  it("classifies by host and click id", () => {
    expect(classifyReferrer(undefined, false)).toBe("direct");
    expect(classifyReferrer("www.google.com", false)).toBe("search");
    expect(classifyReferrer("l.facebook.com", false)).toBe("social");
    expect(classifyReferrer("anything", true)).toBe("ads");
    expect(classifyReferrer("tryvertex.io", false)).toBe("internal");
    expect(classifyReferrer("someblog.com", false)).toBe("referral");
  });
});
