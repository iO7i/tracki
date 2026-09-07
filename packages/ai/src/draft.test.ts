import { describe, expect, it } from "vitest";
import { draftArticle, isReviewStubBody } from "./draft";
import type { ArticleDraft } from "./llm";

const HEURISTIC = { name: "heuristic" } as never;

describe("isReviewStubBody (Audit 09 M1 — guards publishing un-completed drafts)", () => {
  it("flags empty and stub bodies", async () => {
    expect(isReviewStubBody("")).toBe(true);
    expect(isReviewStubBody("   ")).toBe(true);
    const d = await draftArticle({ question: "how do I get a refund" }, HEURISTIC);
    expect(isReviewStubBody(d.bodyEn)).toBe(true);
    expect(isReviewStubBody(d.bodyAr)).toBe(true);
  });

  it("accepts a real answer body", () => {
    expect(isReviewStubBody("You can request a refund within 14 days.")).toBe(false);
    expect(isReviewStubBody("يمكنك طلب الاسترجاع خلال ١٤ يوماً.")).toBe(false);
  });
});

describe("draftArticle (heuristic review stub — offline)", () => {
  it("produces a bilingual stub from an English question, marked for review", async () => {
    const d = await draftArticle({ question: "how do I get a refund" }, HEURISTIC);
    expect(d.titleEn).toBe("how do I get a refund");
    expect(d.titleAr).toContain("سؤال");
    expect(d.bodyEn.toLowerCase()).toContain("review");
    expect(d.bodyAr).toContain("مراجعة");
  });

  it("puts an Arabic question in the Arabic title", async () => {
    const d = await draftArticle({ question: "كيف أسترجع أموالي" }, HEURISTIC);
    expect(d.titleAr).toBe("كيف أسترجع أموالي");
    expect(d.titleEn).toContain("Question:");
  });

  it("echoes a candidate snippet into the body when available", async () => {
    const d = await draftArticle(
      {
        question: "refund window",
        candidates: [{ title: "Returns", body: "Return items within 14 days for a refund" }],
      },
      HEURISTIC,
    );
    expect(d.bodyEn).toContain("14 days");
  });
});

describe("draftArticle (semantic provider)", () => {
  const claude = (impl: () => Promise<ArticleDraft>) =>
    ({
      name: "claude",
      ground: async () => ({ bestId: "", confidence: 0, grounded: false, reason: "" }),
      chat: async () => ({ reply: "", citationId: "", grounded: false, confidence: 0 }),
      draftArticle: impl,
    }) as never;

  it("uses the model draft when it returns content", async () => {
    const d = await draftArticle(
      { question: "shipping time" },
      claude(async () => ({
        titleAr: "مدة الشحن",
        bodyAr: "٣ أيام عمل",
        titleEn: "Shipping time",
        bodyEn: "3 business days",
      })),
    );
    expect(d.titleEn).toBe("Shipping time");
    expect(d.bodyAr).toContain("أيام");
  });

  it("falls back to the stub when the model returns an empty draft", async () => {
    const d = await draftArticle(
      { question: "shipping time" },
      claude(async () => ({ titleAr: "", bodyAr: "", titleEn: "", bodyEn: "" })),
    );
    expect(d.bodyEn.toLowerCase()).toContain("review");
  });

  it("falls back to the stub when the model throws", async () => {
    const d = await draftArticle(
      { question: "shipping time" },
      claude(async () => {
        throw new Error("api down");
      }),
    );
    expect(d.bodyEn.toLowerCase()).toContain("review");
  });
});
