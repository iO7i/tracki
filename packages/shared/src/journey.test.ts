import { describe, expect, it } from "vitest";
import { journeyScore } from "./journey";

const base = { struggleScoreSum: 0, flowsAbandoned: 0, flowsCompleted: 0, converted: false };

describe("journeyScore", () => {
  it("a clean session scores 100", () => {
    const r = journeyScore(base);
    expect(r.score).toBe(100);
    expect(r.completionProbability).toBe(1);
    expect(r.abandonProbability).toBe(0);
  });

  it("a converted session pins probabilities to 1/0 even with friction", () => {
    const r = journeyScore({ ...base, struggleScoreSum: 80, converted: true });
    expect(r.completionProbability).toBe(1);
    expect(r.abandonProbability).toBe(0);
    expect(r.score).toBeGreaterThan(journeyScore({ ...base, struggleScoreSum: 80 }).score);
  });

  it("an OTP loop dents the score; a payment loop + abandon tanks it", () => {
    const otp = journeyScore({ ...base, struggleScoreSum: 75 });
    expect(otp.score).toBeLessThan(85);
    expect(otp.score).toBeGreaterThan(50);
    const bad = journeyScore({ ...base, struggleScoreSum: 200, flowsAbandoned: 2 });
    expect(bad.score).toBeLessThanOrEqual(20);
    expect(bad.abandonProbability).toBeGreaterThanOrEqual(0.8);
  });

  it("friction and abandonment penalties are capped (never below 0)", () => {
    const r = journeyScore({ ...base, struggleScoreSum: 10_000, flowsAbandoned: 50 });
    expect(r.score).toBe(15); // 100 − 55 (cap) − 30 (cap)
    const floor = journeyScore({
      ...base,
      struggleScoreSum: 10_000,
      flowsAbandoned: 50,
      converted: false,
    });
    expect(floor.score).toBeGreaterThanOrEqual(0);
  });

  it("completed flows add a small capped bonus", () => {
    const one = journeyScore({ ...base, struggleScoreSum: 75, flowsCompleted: 1 });
    const many = journeyScore({ ...base, struggleScoreSum: 75, flowsCompleted: 9 });
    expect(one.score).toBeGreaterThan(journeyScore({ ...base, struggleScoreSum: 75 }).score);
    expect(many.score - one.score).toBeLessThanOrEqual(5);
  });

  it("never leaves 0–100 and probabilities always sum to 1", () => {
    for (const s of [0, 35, 75, 160, 400]) {
      for (const a of [0, 1, 3]) {
        const r = journeyScore({ ...base, struggleScoreSum: s, flowsAbandoned: a });
        expect(r.score).toBeGreaterThanOrEqual(0);
        expect(r.score).toBeLessThanOrEqual(100);
        expect(r.completionProbability + r.abandonProbability).toBeCloseTo(1, 10);
      }
    }
  });
});
