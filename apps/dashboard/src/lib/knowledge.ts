import "server-only";
import { db } from "@/db";
import { faqArticles, faqProposals } from "@/db/schema";
import { gatherVoc } from "@/lib/voc";
import { type ArticleDraft, draftArticle } from "@tracki/ai";
import { searchTokens } from "@tracki/shared";
import { and, desc, eq, sql } from "drizzle-orm";

export interface ProposalView {
  id: string;
  question: string;
  source: string;
  occurrences: number;
  draft: ArticleDraft;
}

export interface KnowledgeHealth {
  published: number;
  missingLocale: number;
  stale: number;
}

export interface KnowledgeInsights {
  proposals: ProposalView[];
  health: KnowledgeHealth;
}

const STALE_DAYS = 90;

/** Normalized dedup key for a gap question. */
function questionKey(q: string): string {
  return searchTokens(q).join(" ");
}

/**
 * Turn recurring VoC gaps (seen ≥ threshold) into AI-drafted, pending FAQ
 * proposals — skipping any question that already has a proposal. Never
 * publishes: every row is `pending` for human review. Project-scoped.
 * Returns the number of new proposals created.
 */
export async function generateProposals(
  orgId: string,
  projectId: string,
  threshold = 3,
): Promise<number> {
  // gapLimit well above the display cap so generation isn't limited to the top
  // 10 gaps shown on the VoC page (Audit 09 M2).
  const voc = await gatherVoc(orgId, projectId, 30, 100);
  const candidates = voc.gaps.filter((g) => g.count >= threshold && questionKey(g.question));
  if (candidates.length === 0) return 0;

  const existing = await db
    .select({ key: faqProposals.questionKey })
    .from(faqProposals)
    .where(eq(faqProposals.projectId, projectId));
  const seen = new Set(existing.map((e) => e.key));

  let created = 0;
  for (const g of candidates) {
    const key = questionKey(g.question);
    if (seen.has(key)) continue;
    seen.add(key);
    const draft = await draftArticle({ question: g.question });
    await db
      .insert(faqProposals)
      .values({
        projectId,
        question: g.question,
        questionKey: key,
        source: g.source,
        occurrences: g.count,
        status: "pending",
        draft,
      })
      .onConflictDoNothing({
        target: [faqProposals.projectId, faqProposals.questionKey],
      });
    created++;
  }
  return created;
}

/** Pending proposals + a knowledge-health snapshot for one project. */
export async function gatherKnowledge(projectId: string): Promise<KnowledgeInsights> {
  const rows = await db
    .select({
      id: faqProposals.id,
      question: faqProposals.question,
      source: faqProposals.source,
      occurrences: faqProposals.occurrences,
      draft: faqProposals.draft,
    })
    .from(faqProposals)
    .where(and(eq(faqProposals.projectId, projectId), eq(faqProposals.status, "pending")))
    .orderBy(desc(faqProposals.occurrences))
    .limit(50);

  // Bind an ISO string, not a Date: inside a raw `sql` template there's no column
  // type to tell the postgres driver how to encode a Date (it throws otherwise).
  const staleCutoff = new Date(Date.now() - STALE_DAYS * 86_400_000).toISOString();
  const [health] = await db
    .select({
      published: sql<number>`count(*) filter (where ${faqArticles.status} = 'published')`,
      missingLocale: sql<number>`count(*) filter (where ${faqArticles.status} = 'published' and (${faqArticles.titleAr} = '' or ${faqArticles.titleEn} = ''))`,
      stale: sql<number>`count(*) filter (where ${faqArticles.status} = 'published' and ${faqArticles.updatedAt} < ${staleCutoff})`,
    })
    .from(faqArticles)
    .where(eq(faqArticles.projectId, projectId));

  return {
    proposals: rows.map((r) => ({
      id: r.id,
      question: r.question,
      source: r.source,
      occurrences: r.occurrences,
      draft: r.draft as ArticleDraft,
    })),
    health: {
      published: Number(health?.published ?? 0),
      missingLocale: Number(health?.missingLocale ?? 0),
      stale: Number(health?.stale ?? 0),
    },
  };
}
