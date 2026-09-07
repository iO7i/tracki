import { describe, expect, it } from "vitest";
import { createSegmentSchema, segmentDefinitionSchema, struggleIntentTokens } from "./struggles";

describe("struggleIntentTokens", () => {
  it("maps money/auth struggles to bilingual FAQ-vocabulary intent words", () => {
    expect(struggleIntentTokens("repeated_payment_failure")).toContain("payment");
    expect(struggleIntentTokens("repeated_payment_failure")).toContain("دفع");
    expect(struggleIntentTokens("otp_failure_loop")).toMatch(/otp|رمز/);
  });
  it("returns no intent for types with no clear self-service need (no noise)", () => {
    expect(struggleIntentTokens("rage_click")).toBe("");
    expect(struggleIntentTokens("rapid_screen_switching")).toBe("");
    expect(struggleIntentTokens("unknown_type")).toBe("");
  });
});

describe("segmentDefinitionSchema", () => {
  it("accepts a mix of valid conditions", () => {
    const ok = segmentDefinitionSchema.safeParse({
      conditions: [
        { kind: "struggle", struggleType: "form_abandon" },
        { kind: "identified", value: true },
        { kind: "event", eventType: "track", pathContains: "/checkout" },
      ],
    });
    expect(ok.success).toBe(true);
  });

  it("rejects unknown struggle types", () => {
    const bad = segmentDefinitionSchema.safeParse({
      conditions: [{ kind: "struggle", struggleType: "explode" }],
    });
    expect(bad.success).toBe(false);
  });

  it("requires at least one condition", () => {
    expect(segmentDefinitionSchema.safeParse({ conditions: [] }).success).toBe(false);
  });

  it("rejects unknown condition kinds", () => {
    const bad = segmentDefinitionSchema.safeParse({
      conditions: [{ kind: "magic", foo: 1 }],
    });
    expect(bad.success).toBe(false);
  });
});

describe("createSegmentSchema", () => {
  it("validates name + definition together", () => {
    expect(
      createSegmentSchema.safeParse({
        name: "Checkout strugglers",
        definition: { conditions: [{ kind: "identified", value: false }] },
      }).success,
    ).toBe(true);
  });

  it("rejects a too-short name with an i18n key", () => {
    const r = createSegmentSchema.safeParse({
      name: "x",
      definition: { conditions: [{ kind: "identified", value: true }] },
    });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.message).toBe("errors.nameTooShort");
  });
});
