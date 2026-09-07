import { isBlocked } from "@tracki/shared";
import { CHAT_MIN_CONFIDENCE, type LLMClient, getLLM } from "./llm";
import { CHAT_GROUND, type ChatTurn } from "./prompts";

export interface ChatCandidate {
  id: string;
  title: string;
  body: string;
}

export interface ChatAnswer {
  reply: string;
  citationId?: string;
  citationTitle?: string;
  escalate: boolean;
  grounded: boolean;
  promptVersion: string;
}

const ESCALATE_AR = "لم أجد إجابة مؤكدة لسؤالك. هل تحب أن أحوّلك إلى أحد ممثّلينا؟";
const ESCALATE_EN =
  "I couldn't find a confident answer to that. Would you like me to connect you with a person?";

function looksArabic(s: string): boolean {
  return /[؀-ۿ]/.test(s);
}

function escalation(message: string): ChatAnswer {
  return {
    reply: looksArabic(message) ? ESCALATE_AR : ESCALATE_EN,
    escalate: true,
    grounded: false,
    promptVersion: `${CHAT_GROUND.id}@${CHAT_GROUND.version}`,
  };
}

/**
 * Grounded conversational answer. Order: blocked-topics screen → (Claude |
 * heuristic) grounded reply over retrieved FAQ candidates. NEVER returns a
 * factual reply that isn't tied to a candidate — unanswerable ⇒ escalate.
 */
export async function chatAnswer(
  input: { message: string; history?: ChatTurn[]; candidates: ChatCandidate[] },
  llm: LLMClient = getLLM(),
): Promise<ChatAnswer> {
  // Guardrail 1: blocked / prompt-injection → refuse + escalate before anything.
  if (isBlocked(input.message)) return escalation(input.message);
  // Guardrail 2: no knowledge to ground in → escalate, don't invent.
  if (input.candidates.length === 0) return escalation(input.message);

  let res: { reply: string; citationId: string; grounded: boolean; confidence: number };
  try {
    res = await llm.chat({
      message: input.message,
      history: input.history ?? [],
      candidates: input.candidates.map((c) => ({
        id: c.id,
        text: `${c.title} — ${c.body}`.slice(0, 800),
      })),
    });
  } catch {
    return escalation(input.message); // LLM failure → safe escalation
  }

  // Guardrail 3: grounding-required — the cited article must be a real candidate
  // and confidence must clear the floor, else escalate (never a free claim).
  const cited = input.candidates.find((c) => c.id === res.citationId);
  if (!res.grounded || !cited || res.confidence < CHAT_MIN_CONFIDENCE || !res.reply.trim()) {
    return escalation(input.message);
  }
  return {
    reply: res.reply,
    citationId: cited.id,
    citationTitle: cited.title,
    escalate: false,
    grounded: true,
    promptVersion: `${CHAT_GROUND.id}@${CHAT_GROUND.version}`,
  };
}
