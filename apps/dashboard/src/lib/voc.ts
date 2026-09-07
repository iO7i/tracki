import "server-only";
import { db } from "@/db";
import { chatMessages, conversations, waConversations, waMessages } from "@/db/schema";
import { clickhouse } from "@/lib/analytics";
import { type GapItem, type VocTheme, clusterTopics, rankGaps } from "@tracki/ai";
import { type PathCountRow, faqReport, struggleCountsByPath } from "@tracki/clickhouse";
import { and, desc, eq, gte, inArray, isNotNull, or, sql } from "drizzle-orm";

export interface VocTotals {
  inquiries: number;
  selfResolutionRate: number; // 0..1 of chat conversations
  escalationRate: number; // 0..1 of chat conversations
  unanswered: number; // distinct knowledge-gap signals
}

export interface VocThemeView {
  label: string;
  count: number;
  example: string;
}

export interface VocInsights {
  totals: VocTotals;
  themes: VocThemeView[];
  gaps: GapItem[];
  friction: PathCountRow[];
}

const MAX_DOCS = 500;
const MAX_CHAT_DOCS = 400;
const MAX_WA_DOCS = 200;
const MAX_ESCALATED = 50;

/**
 * Voice of Customer synthesis for one project over the last `days`. Reads only
 * already-PII-masked stored content (chat/WhatsApp messages are masked at
 * ingest), reuses the FAQ + struggle analytics, and runs the deterministic /
 * Claude-optional clustering in @tracki/ai. Every query is scoped to projectId.
 */
export async function gatherVoc(
  orgId: string,
  projectId: string,
  days = 14,
  gapLimit = 10,
): Promise<VocInsights> {
  const cutoff = new Date(Date.now() - days * 86_400_000);

  // --- Conversation counts (the Agent funnel drives the rates) ---
  const [chatAgg] = await db
    .select({
      total: sql<number>`count(*)`,
      escalated: sql<number>`count(*) filter (where ${conversations.escalated} = 'true')`,
    })
    .from(conversations)
    .where(and(eq(conversations.projectId, projectId), gte(conversations.createdAt, cutoff)));

  // Self-resolution is a DERIVED deflection signal (Audit 08 M1): the
  // `self_resolved` status is only ever set by a manual manager tag, so counting
  // it would read ~0% forever and misrepresent the Agent's real performance.
  // A conversation counts as self-resolved if a manager tagged it OR it was not
  // escalated AND received at least one grounded (cited) Agent answer.
  const [deflectAgg] = await db
    .select({ deflected: sql<number>`count(distinct ${conversations.id})` })
    .from(conversations)
    .leftJoin(
      chatMessages,
      and(
        eq(chatMessages.conversationId, conversations.id),
        eq(chatMessages.role, "assistant"),
        isNotNull(chatMessages.citationArticleId),
      ),
    )
    .where(
      and(
        eq(conversations.projectId, projectId),
        gte(conversations.createdAt, cutoff),
        or(
          eq(conversations.status, "self_resolved"),
          and(eq(conversations.escalated, "false"), isNotNull(chatMessages.id)),
        ),
      ),
    );

  const [waAgg] = await db
    .select({ total: sql<number>`count(*)` })
    .from(waConversations)
    .where(and(eq(waConversations.projectId, projectId), gte(waConversations.createdAt, cutoff)));

  const chatTotal = Number(chatAgg?.total ?? 0);
  const escalated = Number(chatAgg?.escalated ?? 0);
  const selfResolved = Number(deflectAgg?.deflected ?? 0);
  const inquiries = chatTotal + Number(waAgg?.total ?? 0);

  // --- Customer language for theming (masked content, capped) ---
  const chatDocs = await db
    .select({ id: chatMessages.id, text: chatMessages.content })
    .from(chatMessages)
    .innerJoin(conversations, eq(chatMessages.conversationId, conversations.id))
    .where(
      and(
        eq(conversations.projectId, projectId),
        eq(chatMessages.role, "user"),
        gte(chatMessages.createdAt, cutoff),
      ),
    )
    .orderBy(desc(chatMessages.createdAt))
    .limit(MAX_CHAT_DOCS);

  const waDocs = await db
    .select({ id: waMessages.id, text: waMessages.content })
    .from(waMessages)
    .innerJoin(waConversations, eq(waMessages.conversationId, waConversations.id))
    .where(
      and(
        eq(waConversations.projectId, projectId),
        eq(waMessages.direction, "inbound"),
        eq(waMessages.author, "customer"),
        gte(waMessages.createdAt, cutoff),
      ),
    )
    .orderBy(desc(waMessages.createdAt))
    .limit(MAX_WA_DOCS);

  const docs = [...chatDocs, ...waDocs].filter((d) => d.text.trim().length > 0).slice(0, MAX_DOCS);
  const docText = new Map(docs.map((d) => [d.id, d.text]));
  const themesRaw: VocTheme[] = await clusterTopics(docs);
  const themes: VocThemeView[] = themesRaw.map((t) => ({
    label: t.label,
    count: t.count,
    example: docText.get(t.exampleId) ?? "",
  }));

  // --- Knowledge gaps: ungrounded escalations + no-result searches ---
  const escalatedConvos = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(
      and(
        eq(conversations.projectId, projectId),
        eq(conversations.escalated, "true"),
        gte(conversations.createdAt, cutoff),
      ),
    )
    .orderBy(desc(conversations.lastAt))
    .limit(MAX_ESCALATED);

  let ungrounded: string[] = [];
  if (escalatedConvos.length > 0) {
    const rows = await db
      .select({ text: chatMessages.content })
      .from(chatMessages)
      .where(
        and(
          inArray(
            chatMessages.conversationId,
            escalatedConvos.map((c) => c.id),
          ),
          eq(chatMessages.role, "user"),
        ),
      )
      .limit(MAX_ESCALATED * 2);
    ungrounded = rows.map((r) => r.text);
  }

  let topNoResults: { term: string; count: number }[] = [];
  let friction: PathCountRow[] = [];
  try {
    const ch = clickhouse();
    const [report, paths] = await Promise.all([
      faqReport(ch, orgId, projectId, days),
      struggleCountsByPath(ch, orgId, projectId, days, 8),
    ]);
    topNoResults = report.topNoResults.map((r) => ({ term: r.term, count: Number(r.count) }));
    friction = paths;
  } catch {
    // analytics store unavailable → degrade gracefully (gaps still use chat)
  }

  // Count ALL distinct gaps for the headline (Audit 08 m2 — don't let the stat
  // saturate at the display limit), then take the top N for the list.
  const allGaps = rankGaps(topNoResults, ungrounded, 1000);
  const gaps = allGaps.slice(0, gapLimit);

  return {
    totals: {
      inquiries,
      selfResolutionRate: chatTotal > 0 ? selfResolved / chatTotal : 0,
      escalationRate: chatTotal > 0 ? escalated / chatTotal : 0,
      unanswered: allGaps.length,
    },
    themes,
    gaps,
    friction,
  };
}
