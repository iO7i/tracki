import { normalizeText } from "@tracki/shared";
import {
  CHAT_GROUND,
  type ChatGroundInput,
  DRAFT_ACTION,
  DRAFT_ARTICLE,
  type DraftActionInput,
  type DraftArticleInput,
  GROUND_RERANK,
  type GroundInput,
  type ThemeLabelInput,
  VOC_THEMES,
} from "./prompts";

export interface ArticleDraft {
  titleAr: string;
  bodyAr: string;
  titleEn: string;
  bodyEn: string;
}

/** Bilingual action copy drafted by Autopilot (slice 12) — words only; the
 * targeting/trigger/channel are decided in code, never by the model. */
export interface ActionCopyDraft {
  name: string;
  titleAr: string;
  bodyAr: string;
  ctaLabelAr: string;
  titleEn: string;
  bodyEn: string;
  ctaLabelEn: string;
}

export interface GroundResult {
  bestId: string;
  confidence: number;
  grounded: boolean;
  reason: string;
}

export interface ChatResult {
  reply: string;
  citationId: string;
  grounded: boolean;
  confidence: number;
}

export interface LLMClient {
  readonly name: string;
  /** Re-rank candidates against the context and return a grounded best. */
  ground(input: GroundInput): Promise<GroundResult>;
  /** Grounded conversational reply over candidate help articles. */
  chat(input: ChatGroundInput): Promise<ChatResult>;
  /**
   * Optional (VoC, slice 8): relabel pre-formed topic clusters. Returns one
   * label per input cluster, in order. Only the semantic providers implement
   * it; the heuristic omits it and callers fall back to seed labels.
   */
  labelThemes?(input: ThemeLabelInput): Promise<{ label: string }[]>;
  /**
   * Optional (Knowledge Hub, slice 9): draft a bilingual FAQ from a recurring
   * question. Only semantic providers implement it; the heuristic omits it and
   * callers fall back to a clearly-marked review stub. Output is ALWAYS a
   * proposal for human approval — never published directly.
   */
  draftArticle?(input: DraftArticleInput): Promise<ArticleDraft>;
  /**
   * Optional (Action Studio, slice 12): draft the bilingual COPY of a support
   * action from a friction seed. Only semantic providers implement it; the
   * heuristic omits it and callers fall back to deterministic GCC playbook
   * templates. Output is ALWAYS a proposal for human approval.
   */
  draftAction?(input: DraftActionInput): Promise<ActionCopyDraft>;
}

/** Minimum confidence below which the matcher must NOT surface an answer. */
export const MIN_CONFIDENCE = 0.45;

/**
 * Higher floor for the conversational Agent (Audit 06 M1): a short query that
 * reduces to one content token can incidentally hit the wrong article at exactly
 * 0.5 overlap. Requiring > half the content tokens to match means a lone
 * incidental token can't surface a confidently-wrong FAQ; legitimate queries
 * (e.g. "how do I pay" → 1.0, "shipping delivery time" → 0.67) still pass.
 */
export const CHAT_MIN_CONFIDENCE = 0.6;

// Common stopwords dropped from the heuristic overlap denominator so a natural
// question ("how do I pay") isn't diluted by function words. (Heuristic path
// only; the safety guards — grounding flag, candidate membership, floor — are
// unchanged.) Also reused by VoC theming (slice 8) to seed topics from content
// words rather than function words.
export const STOPWORDS = new Set([
  "how",
  "do",
  "i",
  "to",
  "for",
  "a",
  "an",
  "the",
  "is",
  "are",
  "my",
  "can",
  "what",
  "where",
  "when",
  "of",
  "on",
  "in",
  "you",
  "me",
  "please",
  "كيف",
  "كيفيه",
  "ما",
  "هل",
  "من",
  "في",
  "علي",
  "و",
  "هي",
  "هو",
  "ازاي",
  "وش",
  "متى",
]);

/**
 * Deterministic, offline fallback. Scores each candidate by normalized
 * token-overlap with the context; confidence = overlap ratio of the best
 * candidate; grounded iff confidence ≥ MIN_CONFIDENCE. No network, no key.
 */
export class HeuristicClient implements LLMClient {
  readonly name = "heuristic";

  async ground({ context, candidates, signals }: GroundInput): Promise<GroundResult> {
    const ctxTokens = new Set(
      normalizeText(context)
        .split(" ")
        .filter((tok) => tok && !STOPWORDS.has(tok)),
    );
    if (ctxTokens.size === 0 || candidates.length === 0) {
      return { bestId: "", confidence: 0, grounded: false, reason: "no context/candidates" };
    }
    // Secondary behavioral signals (struggle intent, element, recent screens):
    // tokens NOT already in the primary context. They add to the numerator but
    // NOT the denominator, so a matching signal can only RAISE confidence and a
    // missing one never dilutes it — fixing the "page-path-only" grounding gap
    // without re-introducing the never-matching-token penalty.
    const signalTokens = new Set(
      normalizeText(signals ?? "")
        .split(" ")
        .filter((tok) => tok && !STOPWORDS.has(tok) && !ctxTokens.has(tok)),
    );
    let best = { id: "", score: 0 };
    for (const c of candidates) {
      const cand = new Set(normalizeText(c.text).split(" ").filter(Boolean));
      let hits = 0;
      for (const tok of ctxTokens) if (cand.has(tok)) hits++;
      let signalHits = 0;
      for (const tok of signalTokens) if (cand.has(tok)) signalHits++;
      const score = (hits + signalHits) / ctxTokens.size;
      if (score > best.score) best = { id: c.id, score };
    }
    const confidence = Math.min(1, best.score);
    return {
      bestId: best.id,
      confidence,
      grounded: confidence >= MIN_CONFIDENCE && best.id !== "",
      reason: `token-overlap ${confidence.toFixed(2)}`,
    };
  }

  /** Retrieval "bot": ground the latest message to the best candidate; the reply
   * is that candidate's text. No generation — deterministic and grounded. */
  async chat({ message, candidates }: ChatGroundInput): Promise<ChatResult> {
    const g = await this.ground({ context: message, candidates });
    const best = candidates.find((c) => c.id === g.bestId);
    return {
      reply: g.grounded && best ? best.text : "",
      citationId: g.grounded && best ? best.id : "",
      grounded: g.grounded && !!best,
      confidence: g.confidence,
    };
  }
}

/** Anthropic Messages API client (used only when ANTHROPIC_API_KEY is set). */
export class ClaudeClient implements LLMClient {
  readonly name = "claude";
  constructor(
    private apiKey: string,
    private model: string = process.env.TRACKI_LLM_MODEL ?? "claude-haiku-4-5-20251001",
  ) {}

  async ground(input: GroundInput): Promise<GroundResult> {
    const text = await this.call(GROUND_RERANK.render(input));
    const json = JSON.parse(
      text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1),
    ) as Partial<GroundResult>;
    // Audit B1: clamp to [0,1] — a model over-reporting (e.g. 5) must NOT be
    // able to defeat the MIN_CONFIDENCE floor; non-finite → 0 (fail safe).
    const raw = json.confidence;
    const confidence =
      typeof raw === "number" && Number.isFinite(raw) ? Math.max(0, Math.min(1, raw)) : 0;
    return {
      bestId: json.bestId ?? "",
      confidence,
      grounded: json.grounded === true && confidence >= MIN_CONFIDENCE && !!json.bestId,
      reason: json.reason ?? "",
    };
  }

  async chat(input: ChatGroundInput): Promise<ChatResult> {
    const text = await this.call(CHAT_GROUND.render(input));
    const json = JSON.parse(
      text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1),
    ) as Partial<ChatResult>;
    const raw = json.confidence;
    const confidence =
      typeof raw === "number" && Number.isFinite(raw) ? Math.max(0, Math.min(1, raw)) : 0;
    return {
      reply: typeof json.reply === "string" ? json.reply : "",
      citationId: typeof json.citationId === "string" ? json.citationId : "",
      grounded: json.grounded === true && confidence >= MIN_CONFIDENCE,
      confidence,
    };
  }

  async labelThemes(input: ThemeLabelInput): Promise<{ label: string }[]> {
    const text = await this.call(VOC_THEMES.render(input));
    const arr = JSON.parse(text.slice(text.indexOf("["), text.lastIndexOf("]") + 1)) as {
      label?: unknown;
    }[];
    return arr.map((x) => ({ label: typeof x.label === "string" ? x.label : "" }));
  }

  async draftArticle(input: DraftArticleInput): Promise<ArticleDraft> {
    const text = await this.call(DRAFT_ARTICLE.render(input));
    const json = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)) as Partial<
      Record<keyof ArticleDraft, unknown>
    >;
    const str = (v: unknown) => (typeof v === "string" ? v : "");
    return {
      titleAr: str(json.titleAr),
      bodyAr: str(json.bodyAr),
      titleEn: str(json.titleEn),
      bodyEn: str(json.bodyEn),
    };
  }

  async draftAction(input: DraftActionInput): Promise<ActionCopyDraft> {
    const text = await this.call(DRAFT_ACTION.render(input));
    const json = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)) as Partial<
      Record<keyof ActionCopyDraft, unknown>
    >;
    // Clamp to the action schema's content limits — an over-long model output
    // must not make the drafted definition fail validation downstream.
    const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");
    return {
      name: str(json.name, 60),
      titleAr: str(json.titleAr, 60),
      bodyAr: str(json.bodyAr, 200),
      ctaLabelAr: str(json.ctaLabelAr, 30),
      titleEn: str(json.titleEn, 60),
      bodyEn: str(json.bodyEn, 200),
      ctaLabelEn: str(json.ctaLabelEn, 30),
    };
  }

  /** Shared Anthropic Messages call returning the first text block. */
  private async call(prompt: string): Promise<string> {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: 512,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!res.ok) throw new Error(`anthropic ${res.status}`);
    const data = (await res.json()) as { content?: { text?: string }[] };
    return data.content?.[0]?.text ?? "{}";
  }
}

let cached: LLMClient | null = null;

/** Claude when ANTHROPIC_API_KEY is set, deterministic heuristic otherwise. */
export function getLLM(): LLMClient {
  if (cached) return cached;
  const key = process.env.ANTHROPIC_API_KEY;
  cached = key ? new ClaudeClient(key) : new HeuristicClient();
  return cached;
}

/**
 * Boot-time fail-closed guard (Audit 00-07 X1) — mirrors the WhatsApp
 * `assertConfig` pattern. The `HeuristicClient` is a *lexical* retrieval
 * fallback for offline dev / test / CI: by design it is precision-first and
 * escalates rather than risk a wrong answer, so it cannot do the semantic
 * matching real customer phrasing needs ("how do I pay for my order", "when
 * will my package arrive"). Shipping it to real users inverts the product's
 * "grounded AI that deflects tickets" promise — every AI surface (chat Agent,
 * WhatsApp auto-reply, Live Assist) shares this client. So in production we
 * REQUIRE a real model and refuse to start without one. The deterministic
 * fallback stays available for offline runs (NODE_ENV!=="production").
 *
 * Escape hatch: set `TRACKI_ALLOW_HEURISTIC_LLM=1` to deliberately run the
 * heuristic in production (e.g. an air-gapped GCC deployment that accepts the
 * reduced answer quality) — it boots with a loud warning instead of throwing.
 */
export function assertLLM(): void {
  if (process.env.NODE_ENV !== "production") return; // offline dev/test/CI: heuristic OK
  if (process.env.ANTHROPIC_API_KEY) return; // real semantic model configured
  if (["1", "true"].includes(process.env.TRACKI_ALLOW_HEURISTIC_LLM ?? "")) {
    console.warn(
      "[ai] WARNING: running the deterministic heuristic LLM in production (TRACKI_ALLOW_HEURISTIC_LLM set). " +
        "Natural-language questions will over-escalate to human handoff.",
    );
    return;
  }
  throw new Error(
    "AI: ANTHROPIC_API_KEY is required in production — the deterministic heuristic over-escalates real " +
      "customer phrasing and would invert the grounded-deflection promise. Set ANTHROPIC_API_KEY, or set " +
      "TRACKI_ALLOW_HEURISTIC_LLM=1 to deliberately accept the reduced-quality offline fallback (refusing to start).",
  );
}

/** Test seam. */
export function __setLLM(client: LLMClient | null): void {
  cached = client;
}
