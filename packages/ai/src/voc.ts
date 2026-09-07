import { searchTokens } from "@tracki/shared";
import { type LLMClient, STOPWORDS, getLLM } from "./llm";

/**
 * Voice of Customer (slice 8) — descriptive analytics over what customers
 * actually said. This is NOT answer generation: it never fabricates a reply, it
 * only clusters and ranks already-captured (PII-masked) customer language. The
 * heuristic path is deterministic and offline; Claude (when keyed) only relabels
 * the same clusters more readably. Inputs are assumed masked at the source.
 */

export interface VocDoc {
  id: string;
  text: string;
}

export interface VocTheme {
  /** Human-ish label (a content keyword in heuristic mode; a phrase via Claude). */
  label: string;
  /** Number of input docs assigned to this theme. */
  count: number;
  /** Id of a representative doc (for an example snippet in the UI). */
  exampleId: string;
}

export interface GapItem {
  question: string;
  count: number;
  source: "search" | "escalation";
}

const MIN_TOKEN_LEN = 3;

// VoC theming needs a wider net than the chat grounder: chat keeps its stopword
// list deliberately small (so it doesn't drop query signal), but topic labels
// must be content words, never fillers. Extend, don't mutate, the shared set.
const VOC_STOPWORDS = new Set<string>([
  ...STOPWORDS,
  // English fillers
  "by",
  "with",
  "your",
  "our",
  "this",
  "that",
  "it",
  "its",
  "at",
  "as",
  "or",
  "and",
  "but",
  "if",
  "so",
  "will",
  "would",
  "want",
  "need",
  "get",
  "got",
  "have",
  "has",
  "had",
  "does",
  "did",
  "was",
  "were",
  "be",
  "been",
  "am",
  "about",
  "there",
  "here",
  "then",
  "than",
  "into",
  "out",
  "not",
  "no",
  "yes",
  "hi",
  "hello",
  "hey",
  "thanks",
  "thank",
  "offer",
  "any",
  "some",
  "from",
  // Arabic fillers
  "هذا",
  "هذه",
  "ذلك",
  "مع",
  "عن",
  "الي",
  "او",
  "ثم",
  "قد",
  "كان",
  "ايضا",
  "لكن",
  "عند",
  "اريد",
  "ابي",
  "ابغي",
  "عايز",
  "لو",
  "عايزه",
  "بدي",
]);

/** Content tokens of a doc: Arabic-normalized, stopworded, de-noised. */
function contentTokens(text: string): string[] {
  return searchTokens(text).filter((t) => t.length >= MIN_TOKEN_LEN && !VOC_STOPWORDS.has(t));
}

/**
 * Cluster customer messages into ranked themes. Deterministic heuristic:
 * count content-token document-frequency across the corpus, take the top seed
 * tokens, then assign each doc to the seed it carries with the highest corpus
 * frequency. A theme's count is the number of docs assigned; its example is the
 * shortest assigned doc (most likely a crisp, representative phrasing).
 */
export function clusterTopicsHeuristic(docs: VocDoc[], maxThemes = 8): VocTheme[] {
  if (docs.length === 0) return [];
  const tokenized = docs.map((d) => ({ d, toks: new Set(contentTokens(d.text)) }));

  // Document frequency per token.
  const df = new Map<string, number>();
  for (const { toks } of tokenized) {
    for (const t of toks) df.set(t, (df.get(t) ?? 0) + 1);
  }
  // Seed tokens: most common content words, deterministic tiebreak by token.
  const seeds = [...df.entries()]
    .filter(([, n]) => n >= 1)
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, maxThemes)
    .map(([tok]) => tok);
  if (seeds.length === 0) return [];

  const buckets = new Map<string, VocDoc[]>();
  for (const { d, toks } of tokenized) {
    // Assign to the seed this doc carries with the highest corpus frequency.
    let best = "";
    let bestDf = -1;
    for (const s of seeds) {
      if (toks.has(s)) {
        const n = df.get(s) ?? 0;
        if (n > bestDf || (n === bestDf && s < best)) {
          best = s;
          bestDf = n;
        }
      }
    }
    if (!best) continue; // doc shares no seed token — leave it un-themed
    const arr = buckets.get(best) ?? [];
    arr.push(d);
    buckets.set(best, arr);
  }

  return [...buckets.entries()]
    .map(([label, ds]) => {
      const example = ds.reduce((a, b) => (a.text.length <= b.text.length ? a : b));
      return { label, count: ds.length, exampleId: example.id };
    })
    .sort((a, b) => b.count - a.count || (a.label < b.label ? -1 : 1));
}

/**
 * Cluster topics — Claude when keyed (nicer labels over a capped sample), else
 * the deterministic heuristic. The Claude path maps its labels back onto the
 * heuristic buckets' counts/examples so output is always grounded in real docs
 * (no invented themes or counts); any failure falls back to the heuristic.
 */
export async function clusterTopics(
  docs: VocDoc[],
  llm: LLMClient = getLLM(),
  maxThemes = 8,
): Promise<VocTheme[]> {
  const heuristic = clusterTopicsHeuristic(docs, maxThemes);
  if (llm.name !== "claude" || heuristic.length === 0) return heuristic;
  try {
    const relabel = await llm.labelThemes?.({
      themes: heuristic.map((t) => ({
        seed: t.label,
        example: docs.find((d) => d.id === t.exampleId)?.text ?? "",
      })),
    });
    if (!relabel || relabel.length !== heuristic.length) return heuristic;
    // Re-label only — counts/examples stay tied to the real buckets.
    return heuristic.map((t, i) => ({ ...t, label: relabel[i]?.label?.trim() || t.label }));
  } catch {
    return heuristic;
  }
}

/**
 * Rank knowledge gaps: questions customers asked that Tracki could not answer —
 * no-result FAQ searches plus escalated conversations whose user turns were
 * never grounded. Merged, de-duplicated by normalized text, ranked by count.
 */
export function rankGaps(
  noResultTerms: { term: string; count: number }[],
  ungroundedQuestions: string[],
  limit = 10,
): GapItem[] {
  const byKey = new Map<string, GapItem>();
  const add = (question: string, count: number, source: GapItem["source"]) => {
    const key = searchTokens(question).join(" ");
    if (!key) return;
    const prev = byKey.get(key);
    if (prev) {
      prev.count += count;
      // Prefer a search-sourced label (already a clean term) for display.
      if (source === "search") prev.source = "search";
    } else {
      byKey.set(key, { question: question.trim(), count, source });
    }
  };
  for (const { term, count } of noResultTerms) add(term, count, "search");
  for (const q of ungroundedQuestions) add(q, 1, "escalation");

  return [...byKey.values()]
    .sort((a, b) => b.count - a.count || (a.question < b.question ? -1 : 1))
    .slice(0, limit);
}
