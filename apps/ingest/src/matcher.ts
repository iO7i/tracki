import { groundedMatch } from "@tracki/ai";
import { type ClickHouseClient, recentSessionPaths } from "@tracki/clickhouse";
import { normalizeText, struggleIntentTokens } from "@tracki/shared";
import { faqArticlesForProject } from "./pg.js";

export interface AssistArticle {
  ar: { title: string; body: string };
  en: { title: string; body: string };
}

export type ContextMatch =
  | { mode: "answer"; articleId: string; article: AssistArticle; confidence: number }
  | { mode: "fallback"; confidence: number };

/** Words from a path/screen: "/checkout/step-2" → "checkout step 2". */
function pathWords(path: string): string {
  return path.replace(/[/_?&=#.-]+/g, " ").trim();
}

/** Meaningful tokens from an element signature (tag|id|class) — drops the tag
 *  and structural noise so "button|pay-now|cta" contributes "pay now". */
function elementWords(element: string): string {
  const [, id = "", cls = ""] = element.split("|");
  return `${id} ${cls}`
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .split(" ")
    .filter((w) => w.length >= 3 && !["btn", "cta", "div", "span", "input"].includes(w))
    .join(" ");
}

/**
 * The page is the PRIMARY grounding context. Struggle intent, the interacted
 * element, and the visitor's recent screens are SECONDARY behavioral signals —
 * they reinforce a match (numerator-only in the heuristic; "recent behavior" in
 * the Claude prompt) but never dilute it, so grounding genuinely reflects "what
 * the customer was just doing" without the never-matching-token penalty that
 * previously forced page-path-only matching (Audit: shallow-grounding fix).
 */
async function buildContext(
  projectId: string,
  opts: {
    path: string;
    struggleType: string;
    element?: string;
    orgId?: string;
    sessionId?: string;
  },
  ch?: ClickHouseClient,
): Promise<{ query: string; context: string; signals: string }> {
  const path = pathWords(opts.path);
  let recent = "";
  if (ch && opts.orgId && opts.sessionId) {
    try {
      const paths = await recentSessionPaths(ch, opts.orgId, projectId, opts.sessionId, 5);
      recent = paths.map(pathWords).join(" ");
    } catch {
      /* recent-events grounding is best-effort; never block the match */
    }
  }
  const signals = [
    struggleIntentTokens(opts.struggleType),
    elementWords(opts.element ?? ""),
    recent,
  ]
    .filter(Boolean)
    .join(" ")
    .trim();
  return {
    // Retrieval recall is widened by the signals (a payment FAQ surfaces even
    // when the path is generic); grounding precision is still gated downstream.
    query: `${path} ${signals}`.trim(),
    context: normalizeText(path),
    signals: normalizeText(signals),
  };
}

/**
 * Find the best-grounded FAQ for a struggling visitor's context. Candidates come
 * from the implementation Arabic-aware search; grounding/confidence from packages/ai.
 * Returns an answer ONLY when grounded & confident — otherwise fallback.
 */
export async function matchForContext(
  projectId: string,
  opts: {
    path: string;
    struggleType: string;
    element?: string;
    orgId?: string;
    sessionId?: string;
  },
  ch?: ClickHouseClient,
): Promise<ContextMatch> {
  const { query, context, signals } = await buildContext(projectId, opts, ch);
  const candidates = await faqArticlesForProject(projectId, query);
  if (candidates.length === 0) return { mode: "fallback", confidence: 0 };

  const result = await groundedMatch(
    context,
    candidates.map((c) => ({
      id: c.id,
      title: `${c.ar.title} ${c.en.title}`.trim(),
      body: `${c.ar.body} ${c.en.body}`.trim(),
    })),
    { signals },
  );
  if (result.mode === "fallback") return { mode: "fallback", confidence: result.confidence };

  const chosen = candidates.find((c) => c.id === result.articleId);
  if (!chosen) return { mode: "fallback", confidence: result.confidence };
  return {
    mode: "answer",
    articleId: chosen.id,
    article: { ar: chosen.ar, en: chosen.en },
    confidence: result.confidence,
  };
}
