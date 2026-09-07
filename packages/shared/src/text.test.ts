import { describe, expect, it } from "vitest";
import { normalizeArabic, normalizeText, scoreArticle, searchTokens } from "./text";

describe("normalizeArabic", () => {
  it("strips tashkeel/diacritics", () => {
    expect(normalizeArabic("الخِدْمَة")).toBe(normalizeArabic("الخدمة"));
  });

  it("folds alef variants to bare alef", () => {
    expect(normalizeArabic("أحمد")).toBe("احمد");
    expect(normalizeArabic("إيمان")).toBe("ايمان");
    expect(normalizeArabic("آsiya".replace("siya", "سيا"))).toContain("ا");
  });

  it("folds teh-marbuta to heh and alef-maksura to yeh", () => {
    expect(normalizeArabic("خدمة")).toBe("خدمه");
    expect(normalizeArabic("مصطفى")).toBe("مصطفي");
  });

  it("removes tatweel/kashida", () => {
    expect(normalizeArabic("خــدمة")).toBe("خدمه");
  });

  it("leaves Latin and digits intact", () => {
    expect(normalizeArabic("Order 123")).toBe("Order 123");
  });
});

describe("normalizeText", () => {
  it("lowercases, folds, and collapses whitespace", () => {
    expect(normalizeText("  الخِدْمَة   ABC  ")).toBe("الخدمه abc");
  });

  it("makes spelling variants converge (search robustness)", () => {
    const variants = ["خدمة", "خدمه", "الخِدمة", "خــدمة"].map(normalizeText);
    // All contain the same normalized core token.
    for (const v of variants) expect(v.replace("ال", "")).toContain("خدمه");
  });
});

describe("searchTokens", () => {
  it("splits a normalized query into tokens", () => {
    expect(searchTokens("  الخدمة  السريعة ")).toEqual(["الخدمه", "السريعه"]);
  });
  it("drops empties", () => {
    expect(searchTokens("   ")).toEqual([]);
  });
});

describe("scoreArticle", () => {
  const search = normalizeText("الخدمة السريعة كيفية الدفع service payment");
  it("boosts title hits over body hits", () => {
    const tokens = searchTokens("الخدمة");
    const titleHit = scoreArticle("الخِدمة السريعة", search, tokens);
    const bodyOnly = scoreArticle("شيء آخر", search, tokens);
    expect(titleHit).toBeGreaterThan(bodyOnly);
  });
  it("boost works for diacritic-bearing titles (normalized internally)", () => {
    expect(scoreArticle("الخِدْمَة", search, searchTokens("خدمه"))).toBeGreaterThanOrEqual(5);
  });
  it("is zero with no tokens", () => {
    expect(scoreArticle("anything", search, [])).toBe(0);
  });
});
