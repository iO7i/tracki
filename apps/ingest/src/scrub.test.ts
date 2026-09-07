import { describe, expect, it } from "vitest";
import { scrubString, scrubValue } from "./scrub.js";

describe("scrubValue", () => {
  it("masks PII in nested props", () => {
    const out = scrubValue({
      note: "reach me at ahmad@test.sa",
      phones: ["+966501234567"],
      nested: { contact: "sara@x.io" },
    }) as Record<string, unknown>;
    const json = JSON.stringify(out);
    expect(json).not.toContain("ahmad@test.sa");
    expect(json).not.toContain("+966501234567");
    expect(json).not.toContain("sara@x.io");
  });

  it("leaves non-PII values intact", () => {
    expect(scrubValue({ qty: 3, sku: "ABC-123" })).toEqual({ qty: 3, sku: "ABC-123" });
  });

  it("stops recursing past max depth without throwing", () => {
    const deep: Record<string, unknown> = {};
    let cur = deep;
    for (let i = 0; i < 20; i++) {
      cur.child = {};
      cur = cur.child as Record<string, unknown>;
    }
    expect(() => scrubValue(deep)).not.toThrow();
  });

  it("masks PII nested deeper than the traversal cap (Audit B1)", () => {
    // Build an object with an email string 10 levels deep.
    const root: Record<string, unknown> = {};
    let cur = root;
    for (let i = 0; i < 10; i++) {
      const next: Record<string, unknown> = {};
      cur.child = next;
      cur = next;
    }
    cur.leaf = "deep ahmad@test.sa";
    const json = JSON.stringify(scrubValue(root));
    expect(json).not.toContain("ahmad@test.sa");
  });

  it("masks PII used as an object KEY (Audit B2)", () => {
    const out = scrubValue({ "buyer@bank.sa": "converted" }) as Record<string, unknown>;
    const json = JSON.stringify(out);
    expect(json).not.toContain("buyer@bank.sa");
    expect(json).toContain("converted");
  });
});

describe("scrubString", () => {
  it("masks emails in URLs", () => {
    expect(scrubString("https://x.sa/c?email=test@demo.sa")).not.toContain("test@demo.sa");
  });
  it("returns empty string for undefined", () => {
    expect(scrubString(undefined)).toBe("");
  });
});
