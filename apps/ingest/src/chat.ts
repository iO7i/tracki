import { chatAnswer } from "@tracki/ai";
import { type ChatReply, MAX_TURNS, maskPii } from "@tracki/shared";
import {
  appendMessage,
  conversationHistory,
  faqArticlesForProject,
  getOrCreateConversation,
  markEscalated,
} from "./pg.js";
import type { ProjectRef } from "./pg.js";

export interface ChatInput {
  anonId: string;
  userId?: string;
  sessionId: string;
  conversationId?: string;
  message: string;
  /** Page the visitor is on — used as retrieval context (e.g. /checkout). */
  path?: string;
}

/** Path → recall tokens: "/ar/checkout/step-2" → "checkout step 2". Bounded. */
function pathHint(path?: string): string {
  if (!path) return "";
  return path
    .replace(/[/?&=#._-]+/g, " ")
    .replace(/[^\p{L}\p{N} ]+/gu, "")
    .trim()
    .slice(0, 120);
}

/**
 * One Agent turn: resolve/issue a project-scoped conversation, retrieve FAQ
 * candidates, produce a GROUNDED reply (or escalate), and persist both messages
 * PII-masked. Max-turns forces escalation rather than unbounded chat.
 */
export async function handleChat(ref: ProjectRef, input: ChatInput): Promise<ChatReply> {
  const convo = await getOrCreateConversation(
    ref.projectId,
    input.conversationId,
    input.anonId,
    input.userId,
    input.sessionId,
  );

  // Read history BEFORE persisting the current turn (Audit N1: otherwise the
  // current message appears twice in the prompt — masked in history + raw).
  const history = await conversationHistory(convo.id, 10);

  // Persist the user message PII-masked (never store raw PII).
  await appendMessage(convo.id, "user", maskPii(input.message), null);

  // Max-turns guard → escalate.
  if (convo.turns + 1 > MAX_TURNS) {
    await markEscalated(convo.id);
    const reply = /[؀-ۿ]/.test(input.message)
      ? "هذه المحادثة طويلة — سأحوّلك إلى أحد ممثّلينا."
      : "This conversation is long — let me connect you with a person.";
    await appendMessage(convo.id, "assistant", reply, null);
    return { conversationId: convo.id, reply, escalate: true };
  }

  // Broad recall for the Agent (any-token); grounding gates precision. Page path
  // is folded into the recall query so a page-specific question (e.g. a vague
  // "this isn't working" on /checkout) surfaces the right article — the cited
  // article still has to genuinely answer the message to clear the grounding gate.
  const recallQuery = `${input.message} ${pathHint(input.path)}`.trim();
  const candidates = await faqArticlesForProject(ref.projectId, recallQuery, "any");

  const answer = await chatAnswer({
    message: input.message,
    history,
    candidates: candidates.map((c) => ({
      id: c.id,
      // Clean display title for the citation…
      title: c.ar.title || c.en.title,
      // …but match against BOTH locales' title + body (so an EN title word
      // isn't lost when the AR title is shown).
      body: `${c.ar.title} ${c.en.title} ${c.ar.body} ${c.en.body}`.trim(),
    })),
  });

  // Assistant reply is grounded FAQ text (already published, no PII) — mask
  // defensively anyway before storage.
  await appendMessage(convo.id, "assistant", maskPii(answer.reply), answer.citationId ?? null);
  if (answer.escalate) await markEscalated(convo.id);

  const citation =
    answer.citationId && answer.citationTitle
      ? { articleId: answer.citationId, title: answer.citationTitle }
      : undefined;
  return { conversationId: convo.id, reply: answer.reply, citation, escalate: answer.escalate };
}
