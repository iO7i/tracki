import { describe, expect, it } from "vitest";
import { clusterTopics, clusterTopicsHeuristic, rankGaps } from "./voc";

describe("clusterTopicsHeuristic", () => {
  it("returns no themes for an empty corpus", () => {
    expect(clusterTopicsHeuristic([])).toEqual([]);
  });

  it("clusters by the dominant shared content token and ranks by count", () => {
    const docs = [
      { id: "a", text: "how do I pay by card" },
      { id: "b", text: "i want to pay now" },
      { id: "c", text: "can I pay with apple pay" },
      { id: "d", text: "where is my shipping" },
    ];
    const themes = clusterTopicsHeuristic(docs);
    // "pay" appears in 3 docs → top theme (the heuristic is lexical, not stemmed);
    // shipping in 1.
    expect(themes[0]?.label).toBe("pay");
    expect(themes[0]?.count).toBe(3);
    expect(themes.some((t) => t.label === "shipping")).toBe(true);
  });

  it("clusters Arabic (normalized) content the same way", () => {
    const docs = [
      { id: "a", text: "كيف ادفع بالبطاقة" },
      { id: "b", text: "فشل الدفع في صفحة الدفع" },
      { id: "c", text: "متى يصل الشحن" },
    ];
    const themes = clusterTopicsHeuristic(docs);
    expect(themes[0]?.count).toBeGreaterThanOrEqual(1);
    expect(themes[0]?.exampleId).toBeTruthy();
  });

  it("picks the shortest assigned doc as the example", () => {
    const docs = [
      { id: "long", text: "i really need help to pay for my order please" },
      { id: "short", text: "pay now" },
    ];
    const themes = clusterTopicsHeuristic(docs);
    const pay = themes.find((t) => t.label === "pay");
    expect(pay?.exampleId).toBe("short");
  });
});

describe("clusterTopics (async, heuristic fallback)", () => {
  it("falls back to the heuristic when the client cannot relabel", async () => {
    const docs = [
      { id: "a", text: "pay by card" },
      { id: "b", text: "card declined" },
    ];
    const heuristic = clusterTopicsHeuristic(docs);
    const out = await clusterTopics(docs, { name: "heuristic" } as never);
    expect(out).toEqual(heuristic);
  });

  it("uses Claude labels but keeps real counts/examples", async () => {
    const docs = [
      { id: "a", text: "pay by card" },
      { id: "b", text: "payment failed" },
      { id: "c", text: "shipping time" },
    ];
    const heuristic = clusterTopicsHeuristic(docs);
    const fakeClaude = {
      name: "claude",
      ground: async () => ({ bestId: "", confidence: 0, grounded: false, reason: "" }),
      chat: async () => ({ reply: "", citationId: "", grounded: false, confidence: 0 }),
      labelThemes: async (input: { themes: unknown[] }) =>
        input.themes.map((_, i) => ({ label: `Topic ${i}` })),
    };
    const out = await clusterTopics(docs, fakeClaude as never);
    expect(out.map((t) => t.label)).toEqual(heuristic.map((_, i) => `Topic ${i}`));
    expect(out.map((t) => t.count)).toEqual(heuristic.map((t) => t.count));
    expect(out.map((t) => t.exampleId)).toEqual(heuristic.map((t) => t.exampleId));
  });

  it("falls back if Claude returns the wrong number of labels", async () => {
    const docs = [
      { id: "a", text: "pay by card" },
      { id: "b", text: "shipping time" },
    ];
    const bad = {
      name: "claude",
      ground: async () => ({ bestId: "", confidence: 0, grounded: false, reason: "" }),
      chat: async () => ({ reply: "", citationId: "", grounded: false, confidence: 0 }),
      labelThemes: async () => [{ label: "only one" }],
    };
    const out = await clusterTopics(docs, bad as never);
    expect(out).toEqual(clusterTopicsHeuristic(docs));
  });
});

describe("rankGaps", () => {
  it("merges no-result searches with ungrounded escalations, ranked by count", () => {
    const gaps = rankGaps(
      [
        { term: "refund time", count: 5 },
        { term: "delivery to oman", count: 2 },
      ],
      ["how long is the refund", "refund time", "what about oman delivery"],
    );
    // "refund time" appears as a search (5) and an escalation (1) → 6, ranked first.
    expect(gaps[0]?.question).toBe("refund time");
    expect(gaps[0]?.count).toBe(6);
    expect(gaps[0]?.source).toBe("search");
  });

  it("dedupes by normalized text and respects the limit", () => {
    const gaps = rankGaps([], ["Pay   by Card", "pay by card", "shipping"], 1);
    expect(gaps.length).toBe(1);
    expect(gaps[0]?.count).toBe(2); // the two "pay by card" variants merged
  });

  it("ignores empty questions", () => {
    const gaps = rankGaps([{ term: "", count: 9 }], ["   "]);
    expect(gaps).toEqual([]);
  });
});
