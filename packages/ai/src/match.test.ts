import { describe, expect, it } from "vitest";
import { HeuristicClient, type LLMClient, MIN_CONFIDENCE } from "./llm";
import { groundedMatch } from "./match";
import { GROUND_RERANK } from "./prompts";

const candidates = [
  {
    id: "a1",
    title: "كيفية الدفع",
    body: "خطوات الدفع وإتمام الشراء في صفحة الدفع checkout payment",
  },
  { id: "a2", title: "سياسة الإرجاع", body: "كيفية إرجاع المنتجات returns refund" },
];

describe("groundedMatch (heuristic / offline)", () => {
  it("returns a grounded answer when context clearly matches a candidate", async () => {
    const r = await groundedMatch("checkout payment الدفع", candidates, {
      llm: new HeuristicClient(),
    });
    expect(r.mode).toBe("answer");
    if (r.mode === "answer") {
      expect(r.articleId).toBe("a1");
      expect(r.confidence).toBeGreaterThanOrEqual(MIN_CONFIDENCE);
      expect(r.promptVersion).toBe(`${GROUND_RERANK.id}@${GROUND_RERANK.version}`);
    }
  });

  it("falls back (never guesses) when nothing matches", async () => {
    const r = await groundedMatch("zzz totally unrelated quantum", candidates, {
      llm: new HeuristicClient(),
    });
    expect(r.mode).toBe("fallback");
  });

  it("falls back with no candidates", async () => {
    const r = await groundedMatch("anything", [], { llm: new HeuristicClient() });
    expect(r.mode).toBe("fallback");
  });

  it("never returns an answer below MIN_CONFIDENCE", async () => {
    // A weak partial-overlap context.
    const r = await groundedMatch("الشراء", candidates, { llm: new HeuristicClient() });
    if (r.mode === "answer") expect(r.confidence).toBeGreaterThanOrEqual(MIN_CONFIDENCE);
  });

  it("falls back safely when the LLM throws", async () => {
    const broken: LLMClient = {
      name: "broken",
      ground: () => Promise.reject(new Error("boom")),
      chat: () => Promise.reject(new Error("boom")),
    };
    const r = await groundedMatch("checkout payment", candidates, { llm: broken });
    expect(r.mode).toBe("fallback");
    expect(r.reason).toContain("llm error");
  });

  it("secondary signals lift a page-only miss to a grounded behavioral match", async () => {
    const llm = new HeuristicClient();
    const pageOnly = await groundedMatch("profile", candidates, { llm });
    expect(pageOnly.mode).toBe("fallback");
    const withSignals = await groundedMatch("profile", candidates, {
      llm,
      signals: "payment الدفع",
    });
    expect(withSignals.mode).toBe("answer");
    if (withSignals.mode === "answer") expect(withSignals.articleId).toBe("a1");
  });

  it("a non-matching signal never dilutes an already-grounded match", async () => {
    const llm = new HeuristicClient();
    const base = await groundedMatch("checkout payment الدفع", candidates, { llm });
    const noisy = await groundedMatch("checkout payment الدفع", candidates, {
      llm,
      signals: "zzz quantum unrelated",
    });
    expect(noisy.mode).toBe("answer");
    if (base.mode === "answer" && noisy.mode === "answer") {
      expect(noisy.confidence).toBeGreaterThanOrEqual(base.confidence);
    }
  });

  it("ignores a hallucinated bestId not in candidates", async () => {
    const liar: LLMClient = {
      name: "liar",
      ground: async () => ({ bestId: "ghost", confidence: 0.9, grounded: true, reason: "x" }),
      chat: async () => ({ reply: "x", citationId: "ghost", grounded: true, confidence: 0.9 }),
    };
    const r = await groundedMatch("checkout", candidates, { llm: liar });
    expect(r.mode).toBe("fallback");
  });
});
