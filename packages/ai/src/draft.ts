import { type ArticleDraft, type LLMClient, getLLM } from "./llm";

export interface DraftCandidate {
  title: string;
  body: string;
}

function looksArabic(s: string): boolean {
  return /[؀-ۿ]/.test(s);
}

/**
 * Sentinel phrases the offline review-stub bodies always contain. Exported so
 * the approve flow can refuse to PUBLISH a draft whose body is still the
 * untouched stub (Audit 09 M1) — a human must write a real answer first.
 */
export const REVIEW_STUB_AR = "مسودة بحاجة لمراجعة بشرية قبل النشر";
export const REVIEW_STUB_EN = "Draft pending human review before publishing";

/** True if a body is empty or still the un-completed review stub. */
export function isReviewStubBody(s: string): boolean {
  const t = s.trim();
  return t === "" || t.includes(REVIEW_STUB_AR) || t.includes(REVIEW_STUB_EN);
}

/**
 * Deterministic, offline draft — a clearly-marked REVIEW STUB, never a
 * confident answer. It restates the question as the title and leaves a
 * "pending review" body (echoing a related snippet when available) so a human
 * completes it before publishing. Honest by construction: the heuristic cannot
 * write facts, so it doesn't pretend to.
 */
function heuristicDraft(question: string, snippets: string[]): ArticleDraft {
  const q = question.trim().slice(0, 120);
  const ar = looksArabic(q);
  const snippet = snippets[0]?.slice(0, 280) ?? "";
  const arBody = snippet ? `${REVIEW_STUB_AR}. سياق ذو صلة: ${snippet}` : `${REVIEW_STUB_AR}.`;
  const enBody = snippet ? `${REVIEW_STUB_EN}. Related context: ${snippet}` : `${REVIEW_STUB_EN}.`;
  return {
    titleAr: ar ? q : `سؤال: ${q}`,
    bodyAr: arBody,
    titleEn: ar ? `Question: ${q}` : q,
    bodyEn: enBody,
  };
}

function isEmpty(d: ArticleDraft): boolean {
  return !((d.titleAr || d.titleEn).trim() && (d.bodyAr || d.bodyEn).trim());
}

/**
 * Draft a bilingual FAQ proposal for a recurring unanswered question. Uses the
 * semantic model when available (grounded in candidate snippets), else a
 * deterministic review stub. The result is ALWAYS a proposal for human approval
 * — this function never publishes anything.
 */
export async function draftArticle(
  input: { question: string; candidates?: DraftCandidate[] },
  llm: LLMClient = getLLM(),
): Promise<ArticleDraft> {
  const snippets = (input.candidates ?? [])
    .map((c) => `${c.title} — ${c.body}`.slice(0, 300))
    .slice(0, 5);
  if (llm.draftArticle) {
    try {
      const d = await llm.draftArticle({ question: input.question, snippets });
      if (!isEmpty(d)) return d;
    } catch {
      /* model error → safe deterministic stub */
    }
  }
  return heuristicDraft(input.question, snippets);
}
