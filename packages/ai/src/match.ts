import { type GroundResult, type LLMClient, getLLM } from "./llm";
import { GROUND_RERANK } from "./prompts";

export interface Candidate {
  id: string;
  title: string;
  body: string;
}

export interface MatchAnswer {
  mode: "answer";
  articleId: string;
  confidence: number;
  reason: string;
  promptVersion: string;
}
export interface MatchFallback {
  mode: "fallback";
  confidence: number;
  reason: string;
}
export type MatchResult = MatchAnswer | MatchFallback;

/**
 * Ground a context against FAQ candidates. Returns an answer ONLY when the LLM
 * (or heuristic) is confident AND grounded — otherwise fallback. This is the
 * "never hallucinate" gate. Logs the call with prompt id+version.
 */
export async function groundedMatch(
  context: string,
  candidates: Candidate[],
  opts: { signals?: string; llm?: LLMClient } = {},
): Promise<MatchResult> {
  const llm = opts.llm ?? getLLM();
  if (candidates.length === 0) {
    return { mode: "fallback", confidence: 0, reason: "no candidates" };
  }
  let result: GroundResult;
  try {
    result = await llm.ground({
      context,
      signals: opts.signals,
      candidates: candidates.map((c) => ({
        id: c.id,
        text: `${c.title} — ${c.body}`.slice(0, 600),
      })),
    });
  } catch (err) {
    // Any LLM failure → safe fallback, never a guess.
    return { mode: "fallback", confidence: 0, reason: `llm error: ${(err as Error).message}` };
  }

  // Structured log (prompt version + decision) — no raw PII (candidates are
  // already-scrubbed FAQ content; context is path/struggle metadata).
  console.info(
    `[ai] ${GROUND_RERANK.id}@${GROUND_RERANK.version} llm=${llm.name} grounded=${result.grounded} conf=${result.confidence.toFixed(2)} best=${result.bestId}`,
  );

  if (!result.grounded || !candidates.some((c) => c.id === result.bestId)) {
    return { mode: "fallback", confidence: result.confidence, reason: result.reason };
  }
  return {
    mode: "answer",
    articleId: result.bestId,
    confidence: result.confidence,
    reason: result.reason,
    promptVersion: `${GROUND_RERANK.id}@${GROUND_RERANK.version}`,
  };
}
