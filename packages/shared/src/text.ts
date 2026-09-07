/**
 * Arabic-aware text normalization for search. Applied identically when building
 * an article's search_text and when normalizing a query, so spelling variants
 * (diacritics, alef/teh-marbuta/alef-maksura forms, tatweel) all match.
 */

const ALEF = /[أإآ]/g; // أ إ آ → ا
const TEH_MARBUTA = /ة/g; // ة → ه
const ALEF_MAKSURA = /ى/g; // ى → ي
const TATWEEL = /ـ/g; // ـ (kashida)

export function normalizeArabic(input: string): string {
  return input
    .normalize("NFKC")
    .replace(/\p{M}/gu, "") // strip combining marks (tashkeel/diacritics)
    .replace(TATWEEL, "")
    .replace(ALEF, "ا")
    .replace(TEH_MARBUTA, "ه")
    .replace(ALEF_MAKSURA, "ي");
}

/** Full search normalization: Arabic fold + lowercase + whitespace collapse. */
export function normalizeText(input: string): string {
  return normalizeArabic(input.toLowerCase()).replace(/\s+/g, " ").trim();
}

/** Split a normalized query into search tokens. */
export function searchTokens(query: string): string[] {
  return normalizeText(query)
    .split(" ")
    .filter((t) => t.length > 0);
}

/**
 * Single source of truth for FAQ relevance ranking (Audit M1) — used by the
 * help center, the snippet widget's manifest, and slice-5 retrieval. Title
 * matches are boosted; body matches counted by frequency. The title is
 * normalized internally so the boost works for diacritic-bearing titles.
 * `searchText` must already be normalized (it is built with normalizeText).
 */
export function scoreArticle(title: string, searchText: string, tokens: string[]): number {
  if (tokens.length === 0) return 0;
  const normTitle = normalizeText(title);
  let score = 0;
  for (const tok of tokens) {
    if (normTitle.includes(tok)) score += 5;
    score += searchText.split(tok).length - 1;
  }
  return score;
}
