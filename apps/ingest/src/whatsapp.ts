import { chatAnswer } from "@tracki/ai";
import { createClickHouse, latestStruggleType } from "@tracki/clickhouse";
import {
  type HandoffContext,
  type HandoffRequest,
  buildWhatsAppDeepLink,
  generateInquiryCode,
  maskPii,
  parseInquiryCode,
} from "@tracki/shared";
import { BUSINESS_NUMBER, getProvider } from "@tracki/whatsapp";
import {
  type ProjectRef,
  appendWaMessage,
  claimHandoff,
  conversationUserSummary,
  createHandoff,
  faqArticlesForProject,
  getOrCreateWaConversation,
} from "./pg.js";

const ch = createClickHouse();

function detectLang(text: string): "ar" | "en" {
  return /[؀-ۿ]/.test(text) ? "ar" : "en";
}

/** Mint an inquiry code, snapshot the visitor's web context, return the deep link. */
export async function handleHandoff(
  ref: ProjectRef,
  input: HandoffRequest,
): Promise<{ inquiryCode: string; deepLink: string }> {
  const code = generateInquiryCode();
  let struggle: string | undefined;
  try {
    struggle =
      (await latestStruggleType(ch, ref.orgId, ref.projectId, input.sessionId)) ?? undefined;
  } catch {
    /* best-effort */
  }
  const agentSummary = input.conversationId
    ? await conversationUserSummary(input.conversationId, ref.projectId)
    : "";
  const context: HandoffContext = {
    path: input.path ? maskPii(input.path) : undefined,
    struggle,
    agentSummary, // already PII-masked at chat-store time
    platform: input.platform, // schema-bounded enum; absent ⇒ web (00-14 N2)
  };
  await createHandoff(ref.projectId, code, input.anonId, input.sessionId, context);
  return {
    inquiryCode: code,
    deepLink: buildWhatsAppDeepLink(BUSINESS_NUMBER, code, input.locale ?? "ar"),
  };
}

/**
 * Process one inbound WhatsApp message for a resolved project: link any handoff
 * via the inquiry code, persist (PII-masked), and — unless a human has taken
 * over — send a grounded Agent reply. The Agent reuses the implementation no-fabricate
 * guarantee (out-of-scope ⇒ escalate, no invention).
 */
export async function handleInbound(
  projectId: string,
  fromWaId: string,
  text: string,
): Promise<void> {
  const code = parseInquiryCode(text);
  const handoff = code ? await claimHandoff(code) : null;
  // Only link a handoff that belongs to THIS project (defense in depth).
  const handoffId = handoff && handoff.project_id === projectId ? handoff.id : null;

  const convo = await getOrCreateWaConversation(projectId, fromWaId, handoffId, detectLang(text));
  await appendWaMessage(convo.id, "inbound", "customer", maskPii(text));

  if (convo.takeover === "true") return; // human is driving — no auto-reply

  const candidates = await faqArticlesForProject(projectId, text, "any");
  const answer = await chatAnswer({
    message: text,
    history: [],
    candidates: candidates.map((c) => ({
      id: c.id,
      title: c.ar.title || c.en.title,
      body: `${c.ar.title} ${c.en.title} ${c.ar.body} ${c.en.body}`.trim(),
    })),
  });
  let sent = true;
  try {
    await getProvider().sendText(fromWaId, answer.reply);
  } catch {
    sent = false; // record as failed so the inbox shows it wasn't delivered
  }
  await appendWaMessage(
    convo.id,
    "outbound",
    "agent",
    maskPii(answer.reply),
    sent ? "sent" : "failed",
  );
}

/**
 * Resolve the project for an inbound WITHOUT consuming the handoff claim (that
 * happens once, in handleInbound): by inquiry code (peek) first, else by the
 * wa_id's most-recent conversation. Used by the real Meta webhook.
 */
export async function resolveInboundProject(
  text: string,
  fromWaId: string,
  peekHandoffProject: (code: string) => Promise<string | null>,
  projectForWaId: (waId: string) => Promise<string | null>,
): Promise<string | null> {
  const code = parseInquiryCode(text);
  if (code) {
    const pid = await peekHandoffProject(code);
    if (pid) return pid;
  }
  return projectForWaId(fromWaId);
}
