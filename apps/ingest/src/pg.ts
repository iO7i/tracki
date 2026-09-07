import { type ProjectRef, scoreArticle, searchTokens } from "@tracki/shared";
import postgres from "postgres";
import { config } from "./config.js";

export type { ProjectRef };

let sql: postgres.Sql | null = null;

export function pg(): postgres.Sql {
  if (!sql) sql = postgres(config.databaseUrl);
  return sql;
}

/** Resolve a public key (pk_…) to its project/org, or null if unknown. */
export async function lookupProjectByKey(key: string): Promise<ProjectRef | null> {
  const rows = await pg()<{ id: string; org_id: string }[]>`
    SELECT id, org_id FROM projects WHERE public_key = ${key} LIMIT 1`;
  const row = rows[0];
  return row ? { projectId: row.id, orgId: row.org_id } : null;
}

export interface ActionRow {
  id: string;
  definition: unknown;
}

/** Live actions for a project (manifest source). Draft actions are excluded. */
export async function liveActionsForProject(projectId: string): Promise<ActionRow[]> {
  return pg()<ActionRow[]>`
    SELECT id, definition FROM actions
    WHERE project_id = ${projectId} AND status = 'live'`;
}

/** Live Live-Assist actions (server-driven, trigger.kind = 'struggle'). */
export async function liveStruggleActionsForProject(projectId: string): Promise<ActionRow[]> {
  return pg()<ActionRow[]>`
    SELECT id, definition FROM actions
    WHERE project_id = ${projectId} AND status = 'live'
      AND definition->'trigger'->>'kind' = 'struggle'`;
}

/** A saved segment's definition, scoped to the project. */
export async function getSegmentDefinition(
  segmentId: string,
  projectId: string,
): Promise<unknown | null> {
  const rows = await pg()<{ definition: unknown }[]>`
    SELECT definition FROM segments
    WHERE id = ${segmentId} AND project_id = ${projectId} LIMIT 1`;
  return rows[0]?.definition ?? null;
}

interface FaqRow {
  id: string;
  slug: string;
  category: string;
  tags: string[];
  title_ar: string;
  body_ar: string;
  title_en: string;
  body_en: string;
  search_text: string;
}

/**
 * Published articles for a project. With a query, AND-matches the
 * Arabic-normalized tokens against search_text (parameterized LIKE) and ranks
 * by token hits (title boosted). Without a query, returns recent published.
 */
export async function faqArticlesForProject(
  projectId: string,
  query: string,
  mode: "all" | "any" = "all",
) {
  const tokens = searchTokens(query).slice(0, 8);
  const sql = pg();
  let q = sql<FaqRow[]>`
    SELECT id, slug, category, tags, title_ar, body_ar, title_en, body_en, search_text
    FROM faq_articles
    WHERE project_id = ${projectId} AND status = 'published'`;
  if (mode === "any" && tokens.length > 0) {
    // Broad recall (the Agent): match ANY token; grounding gates precision.
    let clause = sql`${sql`search_text LIKE ${`%${tokens[0]}%`}`}`;
    for (const t of tokens.slice(1)) {
      clause = sql`${clause} OR search_text LIKE ${`%${t}%`}`;
    }
    q = sql<FaqRow[]>`${q} AND (${clause})`;
  } else {
    // Precise (help-center widget search): match ALL tokens.
    for (const t of tokens) {
      q = sql<FaqRow[]>`${q} AND search_text LIKE ${`%${t}%`}`;
    }
  }
  // Empty-query list is deterministic (Audit N1); search results are re-ranked.
  const rows = await sql<FaqRow[]>`${q} ORDER BY updated_at DESC LIMIT 50`;

  const ranked = rows
    .map((r) => ({
      r,
      score: scoreArticle(`${r.title_ar} ${r.title_en}`, r.search_text, tokens),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 20)
    .map(({ r }) => ({
      id: r.id,
      slug: r.slug,
      category: r.category,
      tags: r.tags,
      ar: { title: r.title_ar, body: r.body_ar },
      en: { title: r.title_en, body: r.body_en },
    }));
  return ranked;
}

/** Record an anon→user mapping for identity merge (idempotent). */
export async function upsertIdentity(
  projectId: string,
  anonId: string,
  userId: string,
): Promise<void> {
  await pg()`
    INSERT INTO identities (project_id, anon_id, user_id)
    VALUES (${projectId}, ${anonId}, ${userId})
    ON CONFLICT (project_id, anon_id) DO UPDATE SET user_id = EXCLUDED.user_id`;
}

// --- Tracki Agent (implementation) conversation persistence ---

export interface ConvoRow {
  id: string;
  turns: number;
}

/** Resolve an existing conversation for the project, or create a new one. */
export async function getOrCreateConversation(
  projectId: string,
  conversationId: string | undefined,
  anonId: string,
  userId: string | undefined,
  sessionId: string,
): Promise<ConvoRow> {
  if (conversationId) {
    const rows = await pg()<{ id: string; turns: string }[]>`
      SELECT c.id, count(m.id) FILTER (WHERE m.role = 'user') AS turns
      FROM conversations c
      LEFT JOIN chat_messages m ON m.conversation_id = c.id
      WHERE c.id = ${conversationId} AND c.project_id = ${projectId}
      GROUP BY c.id LIMIT 1`;
    const row = rows[0];
    if (row) return { id: row.id, turns: Number(row.turns) };
    // Unknown / cross-project id → fall through to create a fresh one.
  }
  const created = await pg()<{ id: string }[]>`
    INSERT INTO conversations (project_id, anon_id, user_id, session_id)
    VALUES (${projectId}, ${anonId}, ${userId ?? ""}, ${sessionId})
    RETURNING id`;
  // biome-ignore lint/style/noNonNullAssertion: insert returns one row
  return { id: created[0]!.id, turns: 0 };
}

/** Recent turns for context (oldest→newest). */
export async function conversationHistory(
  conversationId: string,
  limit = 10,
): Promise<{ role: "user" | "assistant"; content: string }[]> {
  const rows = await pg()<{ role: "user" | "assistant"; content: string }[]>`
    SELECT role, content FROM chat_messages
    WHERE conversation_id = ${conversationId}
    ORDER BY created_at DESC LIMIT ${limit}`;
  return rows.reverse();
}

export async function appendMessage(
  conversationId: string,
  role: "user" | "assistant",
  content: string,
  citationArticleId: string | null,
): Promise<void> {
  await pg()`
    INSERT INTO chat_messages (conversation_id, role, content, citation_article_id)
    VALUES (${conversationId}, ${role}, ${content}, ${citationArticleId})`;
  await pg()`UPDATE conversations SET last_at = now() WHERE id = ${conversationId}`;
}

export async function markEscalated(conversationId: string): Promise<void> {
  await pg()`
    UPDATE conversations SET escalated = 'true', status = 'escalated'
    WHERE id = ${conversationId}`;
}

// --- Tracki Connect (implementation) WhatsApp bridge ---

/** Last few user messages of a chat conversation (Agent transcript summary). */
export async function conversationUserSummary(
  conversationId: string,
  projectId: string,
): Promise<string> {
  const rows = await pg()<{ content: string }[]>`
    SELECT m.content FROM chat_messages m
    JOIN conversations c ON c.id = m.conversation_id
    WHERE m.conversation_id = ${conversationId} AND c.project_id = ${projectId} AND m.role = 'user'
    ORDER BY m.created_at DESC LIMIT 3`;
  return rows
    .map((r) => r.content)
    .reverse()
    .join(" · ");
}

export async function createHandoff(
  projectId: string,
  inquiryCode: string,
  anonId: string,
  sessionId: string,
  context: unknown,
): Promise<void> {
  await pg()`
    INSERT INTO handoffs (project_id, inquiry_code, anon_id, session_id, context)
    VALUES (${projectId}, ${inquiryCode}, ${anonId}, ${sessionId}, ${pg().json(context as never)})`;
}

export interface HandoffRow {
  id: string;
  project_id: string;
  context: unknown;
}

/** Look up a handoff by inquiry code and mark it claimed (single-use linking). */
export async function claimHandoff(inquiryCode: string): Promise<HandoffRow | null> {
  const rows = await pg()<HandoffRow[]>`
    UPDATE handoffs SET claimed_at = now()
    WHERE inquiry_code = ${inquiryCode} AND claimed_at IS NULL
    RETURNING id, project_id, context`;
  return rows[0] ?? null;
}

export interface WaConvoRow {
  id: string;
  takeover: string;
  msg_count: string;
}

/** Get/create a WhatsApp conversation for (project, wa_id); optionally link a handoff. */
export async function getOrCreateWaConversation(
  projectId: string,
  waId: string,
  handoffId: string | null,
  language: string,
): Promise<WaConvoRow> {
  // Audit M3: atomic upsert so two concurrent Meta deliveries for a new
  // (project, wa_id) can't both INSERT and trip the UNIQUE index (the loser
  // would 500 the webhook → Meta redelivers → duplicate Agent replies). On
  // conflict we bump last_at and adopt a freshly-provided handoff without
  // clobbering an existing one (COALESCE) or changing the original language.
  const upserted = await pg()<{ id: string }[]>`
    INSERT INTO wa_conversations (project_id, wa_id, handoff_id, language)
    VALUES (${projectId}, ${waId}, ${handoffId}, ${language})
    ON CONFLICT (project_id, wa_id) DO UPDATE
      SET last_at = now(),
          handoff_id = COALESCE(EXCLUDED.handoff_id, wa_conversations.handoff_id)
    RETURNING id`;
  // biome-ignore lint/style/noNonNullAssertion: upsert always returns one row
  const id = upserted[0]!.id;
  const counts = await pg()<{ takeover: string; msg_count: string }[]>`
    SELECT c.takeover, count(m.id) AS msg_count
    FROM wa_conversations c LEFT JOIN wa_messages m ON m.conversation_id = c.id
    WHERE c.id = ${id} GROUP BY c.takeover`;
  return { id, takeover: counts[0]?.takeover ?? "false", msg_count: counts[0]?.msg_count ?? "0" };
}

export async function appendWaMessage(
  conversationId: string,
  direction: "inbound" | "outbound",
  author: "customer" | "agent" | "operator",
  content: string,
  status: "sent" | "failed" = "sent",
): Promise<void> {
  await pg()`
    INSERT INTO wa_messages (conversation_id, direction, author, content, status)
    VALUES (${conversationId}, ${direction}, ${author}, ${content}, ${status})`;
  await pg()`UPDATE wa_conversations SET last_at = now() WHERE id = ${conversationId}`;
}

/** Non-consuming lookup of a handoff's project by code (webhook routing). */
export async function peekHandoffProject(inquiryCode: string): Promise<string | null> {
  const rows = await pg()<{ project_id: string }[]>`
    SELECT project_id FROM handoffs WHERE inquiry_code = ${inquiryCode} LIMIT 1`;
  return rows[0]?.project_id ?? null;
}

/**
 * Fallback routing for a codeless inbound (Audit A01 / X3): resolve the wa_id to
 * a project ONLY when it is unambiguous — i.e. that number has talked to exactly
 * one project. If it's known to two+ projects we return null and DON'T guess,
 * rather than risk routing one tenant's customer into another tenant's inbox.
 * (The full multi-number fix routes by the received metadata.phone_number_id.)
 */
export async function projectForWaId(waId: string): Promise<string | null> {
  const rows = await pg()<{ project_id: string }[]>`
    SELECT DISTINCT project_id FROM wa_conversations WHERE wa_id = ${waId} LIMIT 2`;
  return rows.length === 1 ? (rows[0]?.project_id ?? null) : null;
}

export async function closePg(): Promise<void> {
  await sql?.end();
  sql = null;
}
