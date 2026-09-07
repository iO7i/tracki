import { describe, expect, it } from "vitest";
import { coverage, createFaqSchema } from "./faq";

const base = {
  status: "published" as const,
  tags: ["billing"],
  ar: { title: "الدفع", body: "كيفية الدفع" },
  en: { title: "Payment", body: "How to pay" },
};

describe("createFaqSchema", () => {
  it("accepts a bilingual article", () => {
    expect(createFaqSchema.safeParse(base).success).toBe(true);
  });

  it("accepts an article with only one locale title", () => {
    expect(createFaqSchema.safeParse({ ...base, en: { title: "", body: "" } }).success).toBe(true);
  });

  it("rejects an article with no title in either locale", () => {
    const r = createFaqSchema.safeParse({
      ...base,
      ar: { title: "", body: "x" },
      en: { title: "", body: "y" },
    });
    expect(r.success).toBe(false);
  });

  it("defaults tags to an empty array", () => {
    const r = createFaqSchema.safeParse({
      status: "draft",
      ar: { title: "س", body: "" },
      en: { title: "", body: "" },
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.tags).toEqual([]);
  });
});

describe("coverage", () => {
  it("flags missing translations", () => {
    expect(coverage({ title: "x" }, { title: "" })).toEqual({ ar: true, en: false });
    expect(coverage({ title: "" }, { title: "y" })).toEqual({ ar: false, en: true });
    expect(coverage({ title: "x" }, { title: "y" })).toEqual({ ar: true, en: true });
  });
});
