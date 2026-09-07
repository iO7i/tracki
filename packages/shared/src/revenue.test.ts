import { describe, expect, it } from "vitest";
import { revenueImpactFrom, revenueSettingsSchema } from "./revenue";

describe("revenueImpactFrom", () => {
  it("multiplies measured session counts by AOV", () => {
    const r = revenueImpactFrom({ struggling: 20, converted: 9, recovered: 6, atRisk: 11 }, 250);
    expect(r.atRiskMoney).toBe(11 * 250);
    expect(r.recoveredMoney).toBe(6 * 250);
    expect(r.recoveryRate).toBeCloseTo(6 / 17, 5); // recovered / (recovered + atRisk)
  });

  it("yields zero money when AOV is unset (0)", () => {
    const r = revenueImpactFrom({ struggling: 5, converted: 1, recovered: 1, atRisk: 4 }, 0);
    expect(r.atRiskMoney).toBe(0);
    expect(r.recoveredMoney).toBe(0);
    expect(r.recoveryRate).toBeCloseTo(1 / 5, 5);
  });

  it("recoveryRate is 0 with no struggling sessions (no divide-by-zero)", () => {
    expect(
      revenueImpactFrom({ struggling: 0, converted: 0, recovered: 0, atRisk: 0 }, 250).recoveryRate,
    ).toBe(0);
  });

  it("floors AOV and clamps negatives", () => {
    const r = revenueImpactFrom({ struggling: 2, converted: 0, recovered: 0, atRisk: 2 }, 99.9);
    expect(r.atRiskMoney).toBe(2 * 99);
  });
});

describe("revenueSettingsSchema", () => {
  it("accepts a GCC currency + integer AOV + conversion event", () => {
    const r = revenueSettingsSchema.safeParse({
      currency: "SAR",
      avgOrderValue: "300",
      conversionEvent: "purchase",
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.avgOrderValue).toBe(300);
  });

  it("rejects an unknown currency and empty conversion event", () => {
    expect(
      revenueSettingsSchema.safeParse({ currency: "BTC", avgOrderValue: 1, conversionEvent: "x" })
        .success,
    ).toBe(false);
    expect(
      revenueSettingsSchema.safeParse({ currency: "AED", avgOrderValue: 1, conversionEvent: "" })
        .success,
    ).toBe(false);
  });
});
