import type { OrgRole } from "@tracki/shared";
import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const sessions = pgTable("sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  // Only the SHA-256 hash of the browser token is stored.
  tokenHash: text("token_hash").notNull().unique(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const organizations = pgTable("organizations", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const memberships = pgTable(
  "memberships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role").$type<OrgRole>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("memberships_org_user_idx").on(t.orgId, t.userId)],
);

export const invitations = pgTable("invitations", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  role: text("role").$type<OrgRole>().notNull(),
  token: text("token").notNull().unique(),
  invitedById: uuid("invited_by_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const projects = pgTable(
  "projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    // Embedded in customer sites via the snippet tag (implementation consumes it).
    publicKey: text("public_key").notNull().unique(),
    siteUrl: text("site_url"),
    // implementation — Revenue Impact: merchant-set inputs that turn measured friction
    // into money. avgOrderValue is in major currency units; 0 ⇒ "set your AOV".
    currency: text("currency").notNull().default("SAR"),
    avgOrderValue: integer("avg_order_value").notNull().default(0),
    conversionEvent: text("conversion_event").notNull().default("purchase"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("projects_org_slug_idx").on(t.orgId, t.slug)],
);

/**
 * Anon→user identity mapping (implementation). Written by the ingest service on
 * `identify` events; read by the dashboard to merge a visitor's pre/post-login
 * timeline. One row per (project, anon_id).
 */
export const identities = pgTable(
  "identities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    anonId: text("anon_id").notNull(),
    userId: text("user_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("identities_project_anon_idx").on(t.projectId, t.anonId),
    index("identities_project_user_idx").on(t.projectId, t.userId),
  ],
);

/**
 * Saved audience segments (implementation). `definition` is a SegmentDefinition
 * (validated by @tracki/shared Zod before write); evaluated against ClickHouse
 * to count matching visitors. Consumed by implementation to target actions.
 */
export const segments = pgTable(
  "segments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    definition: jsonb("definition").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("segments_project_idx").on(t.projectId)],
);

/**
 * No-code on-site actions (implementation). `definition` is an ActionDefinition
 * (validated by @tracki/shared Zod before write). Live actions are served to
 * the snippet via the ingest manifest; tracking events flow back through CH.
 */
export const actions = pgTable(
  "actions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    type: text("type").notNull(),
    status: text("status").notNull().default("draft"),
    definition: jsonb("definition").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("actions_project_status_idx").on(t.projectId, t.status)],
);

/**
 * Bilingual FAQ / knowledge-base articles (implementation). `search_text` is the
 * Arabic-normalized concatenation of all title/body/tags, built on write and
 * matched against the normalized query (lexical search). Consumed by the help
 * center, the snippet widget, and (implementation) AI retrieval.
 */
export const faqArticles = pgTable(
  "faq_articles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    category: text("category").notNull().default(""),
    tags: text("tags").array().notNull().default([]),
    status: text("status").notNull().default("draft"),
    titleAr: text("title_ar").notNull().default(""),
    bodyAr: text("body_ar").notNull().default(""),
    titleEn: text("title_en").notNull().default(""),
    bodyEn: text("body_en").notNull().default(""),
    searchText: text("search_text").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("faq_project_slug_idx").on(t.projectId, t.slug),
    index("faq_project_status_idx").on(t.projectId, t.status),
  ],
);

/**
 * Tracki Agent conversations (implementation). Messages stored PII-masked. `status`
 * is the resolution tag (open / self_resolved / escalated / abandoned).
 */
export const conversations = pgTable(
  "conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    anonId: text("anon_id").notNull().default(""),
    userId: text("user_id").notNull().default(""),
    sessionId: text("session_id").notNull().default(""),
    status: text("status").notNull().default("open"),
    escalated: text("escalated").notNull().default("false"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastAt: timestamp("last_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("conversations_project_idx").on(t.projectId, t.lastAt)],
);

export const chatMessages = pgTable(
  "chat_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    content: text("content").notNull(),
    citationArticleId: text("citation_article_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("chat_messages_conversation_idx").on(t.conversationId, t.createdAt)],
);

/**
 * Tracki Connect — WhatsApp bridge (implementation). A `handoff` snapshots the
 * visitor's web context under an inquiry code; the inbound WhatsApp message
 * carrying that code links to it so the customer never repeats themselves.
 */
export const handoffs = pgTable(
  "handoffs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    inquiryCode: text("inquiry_code").notNull().unique(),
    anonId: text("anon_id").notNull().default(""),
    sessionId: text("session_id").notNull().default(""),
    context: jsonb("context").notNull(),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("handoffs_project_idx").on(t.projectId)],
);

export const waConversations = pgTable(
  "wa_conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    waId: text("wa_id").notNull(), // customer phone (operational); displayed masked
    handoffId: uuid("handoff_id").references(() => handoffs.id, { onDelete: "set null" }),
    status: text("status").notNull().default("open"),
    language: text("language").notNull().default("ar"),
    takeover: text("takeover").notNull().default("false"),
    lastAt: timestamp("last_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("wa_conversations_project_idx").on(t.projectId, t.lastAt),
    uniqueIndex("wa_conversations_project_waid_idx").on(t.projectId, t.waId),
  ],
);

export const waMessages = pgTable(
  "wa_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => waConversations.id, { onDelete: "cascade" }),
    direction: text("direction").notNull(),
    author: text("author").notNull(),
    content: text("content").notNull(), // PII-masked
    // Outbound delivery status (sent | failed) so the inbox never shows an
    // undelivered reply as sent (Audit M2). Inbound rows are always 'sent'.
    status: text("status").notNull().default("sent"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("wa_messages_conversation_idx").on(t.conversationId, t.createdAt)],
);

/**
 * Public "Book a demo" / contact leads from the marketing site. Not tenant data
 * — these are prospective customers' own contact details, submitted voluntarily
 * for sales follow-up (so they're stored as given, not masked). No FK; a lead
 * exists before any account.
 */
export const demoRequests = pgTable(
  "demo_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    company: text("company").notNull().default(""),
    message: text("message").notNull().default(""),
    locale: text("locale").notNull().default("ar"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("demo_requests_created_idx").on(t.createdAt)],
);

/**
 * Tracki Autopilot (implementation). Each row is an AI-drafted *action proposal*
 * generated from the friction report (implementation struggle data + VoC gaps). It is
 * NEVER auto-live: a manager approves (creating a *draft* action, linked via
 * `actionId` — the only path to `live` stays the manual toggle) or rejects.
 * `seedKey` is `path|struggleType` — unique per project so re-running
 * generation can't duplicate a seen seed (implementation pattern).
 */
export const actionProposals = pgTable(
  "action_proposals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    seedKey: text("seed_key").notNull(), // path|struggleType dedup key
    status: text("status").notNull().default("pending"), // pending | approved | rejected
    evidence: jsonb("evidence").notNull(), // ActionProposalEvidence (masked/aggregate only)
    draft: jsonb("draft").notNull(), // ActionProposalDraft { name, definition }
    actionId: uuid("action_id").references(() => actions.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("action_proposals_project_seed_idx").on(t.projectId, t.seedKey),
    index("action_proposals_project_status_idx").on(t.projectId, t.status),
  ],
);

/**
 * Self-improving knowledge (implementation). Each row is an AI-drafted FAQ *proposal*
 * generated from a recurring VoC gap (a question Tracki couldn't answer). It is
 * NEVER auto-published: a manager reviews/edits the bilingual `draft`, then
 * approves (creating a real faq_article, linked via `articleId`) or rejects.
 * `questionKey` is the normalized question — unique per project so re-running
 * generation can't create duplicates.
 */
export const faqProposals = pgTable(
  "faq_proposals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    question: text("question").notNull(), // the gap (already PII-masked at source)
    questionKey: text("question_key").notNull(), // normalized dedup key
    source: text("source").notNull().default("search"), // search | escalation
    occurrences: integer("occurrences").notNull().default(1),
    status: text("status").notNull().default("pending"), // pending | approved | rejected
    draft: jsonb("draft").notNull(), // { titleAr, bodyAr, titleEn, bodyEn }
    articleId: uuid("article_id").references(() => faqArticles.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("faq_proposals_project_qkey_idx").on(t.projectId, t.questionKey),
    index("faq_proposals_project_status_idx").on(t.projectId, t.status),
  ],
);
