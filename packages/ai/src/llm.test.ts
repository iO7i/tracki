import { afterEach, describe, expect, it, vi } from "vitest";
import { HeuristicClient, assertLLM } from "./llm";

// vi.stubEnv mutates process.env for the test; unstubAllEnvs restores it.
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("assertLLM (Audit 00-07 X1 — fail closed on heuristic in prod)", () => {
  it("is a no-op outside production (offline dev/test/CI keep the heuristic)", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("ANTHROPIC_API_KEY", undefined);
    expect(() => assertLLM()).not.toThrow();
  });

  it("passes in production when a real model is configured", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-xxx");
    expect(() => assertLLM()).not.toThrow();
  });

  it("throws in production with no key (refuses to ship the heuristic to users)", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ANTHROPIC_API_KEY", undefined);
    vi.stubEnv("TRACKI_ALLOW_HEURISTIC_LLM", undefined);
    expect(() => assertLLM()).toThrow(/ANTHROPIC_API_KEY is required in production/);
  });

  it("boots with a warning when the heuristic is explicitly allowed in prod", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ANTHROPIC_API_KEY", undefined);
    vi.stubEnv("TRACKI_ALLOW_HEURISTIC_LLM", "1");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(() => assertLLM()).not.toThrow();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe("HeuristicClient is precision-first (never fabricates) — the property prod's real model must also keep", () => {
  const candidates = [
    { id: "pay", text: "How to pay — Pay by card on the checkout page payment" },
    { id: "ship", text: "Shipping — Your order arrives within 3 business days delivery" },
  ];

  it("grounds a clear in-vocabulary query", async () => {
    const r = await new HeuristicClient().chat({
      message: "how do I pay",
      history: [],
      candidates,
    });
    expect(r.grounded).toBe(true);
    expect(r.citationId).toBe("pay");
  });

  it("never returns a citation for an out-of-scope query (no fabrication)", async () => {
    const r = await new HeuristicClient().chat({
      message: "what is the capital of France",
      history: [],
      candidates,
    });
    // Heuristic may under-answer, but must NEVER cite when nothing grounds.
    expect(r.grounded).toBe(false);
    expect(r.citationId).toBe("");
  });
});
