import "server-only";
import { db } from "@/db";
import { actionProposals, faqArticles } from "@/db/schema";
import { clickhouse } from "@/lib/analytics";
import { gatherVoc } from "@/lib/voc";
import {
  type StudioFaqCandidate,
  type StudioFrictionRow,
  type StudioGap,
  draftActionFromSeed,
  proposeSeeds,
} from "@tracki/ai";
import { frictionSeeds } from "@tracki/clickhouse";
import type { ActionProposalDraft, ActionProposalEvidence } from "@tracki/shared";
import { and, desc, eq, sql } from "drizzle-orm";

export interface ActionProposalView {
  id: string;
  seedKey: string;
  evidence: ActionProposalEvidence;
  draft: ActionProposalDraft;
}

/**
 * Tracki Autopilot (slice 12): turn the friction report into pending action
 * proposals — the QANT Web "campaign auto-generation" loop. Seeds come from
 * slice-11 struggle data (paths ranked by summed friction, dominant type +
 * element), reinforced by VoC gaps; copy is drafted by Claude (or the offline
 * GCC playbook); a manager approves into a *draft* action. Never auto-live.
 * Project-scoped; evidence is masked/aggregate only. Returns # created.
 */
export async function generateActionProposals(orgId: string, projectId: string): Promise<number> {
  const [seedRows, voc] = await Promise.all([
    frictionSeeds(clickhouse(), orgId, projectId, 30, 12).catch(() => []),
    // Gaps only reinforce seeds — VoC being unavailable must not block Autopilot.
    gatherVoc(orgId, projectId, 30, 50).catch(() => null),
  ]);
  const friction: StudioFrictionRow[] = seedRows.map((r) => ({
    path: r.path,
    struggleType: r.top_type,
    count: Number(r.count),
    score: Number(r.friction),
    element: r.top_element || undefined,
    // Audit 00-14 M2: dominant platform → mobile-only seeds target the mobile surface.
    platform: r.top_platform || undefined,
  }));
  const gaps: StudioGap[] = (voc?.gaps ?? []).map((g) => ({
    question: g.question,
    count: g.count,
  }));
  const seeds = proposeSeeds(friction, gaps);
  if (seeds.length === 0) return 0;

  const existing = await db
    .select({ key: actionProposals.seedKey })
    .from(actionProposals)
    .where(eq(actionProposals.projectId, projectId));
  const seen = new Set(existing.map((e) => e.key));

  // Published FAQ candidates ground the faq-CTA suggestion (loaded once).
  const articles: StudioFaqCandidate[] = await db
    .select({
      id: faqArticles.id,
      titleAr: faqArticles.titleAr,
      bodyAr: faqArticles.bodyAr,
      titleEn: faqArticles.titleEn,
      bodyEn: faqArticles.bodyEn,
      searchText: faqArticles.searchText,
    })
    .from(faqArticles)
    .where(and(eq(faqArticles.projectId, projectId), eq(faqArticles.status, "published")))
    .limit(50);

  let created = 0;
  for (const seed of seeds) {
    if (seen.has(seed.seedKey)) continue;
    seen.add(seed.seedKey);
    const { draft, evidence } = await draftActionFromSeed(seed, articles);
    // Audit 12 N3: count actual inserts — a concurrent generation hitting the
    // unique (project_id, seed_key) conflict must not inflate the count.
    const inserted = await db
      .insert(actionProposals)
      .values({
        projectId,
        seedKey: seed.seedKey,
        status: "pending",
        evidence,
        draft,
      })
      .onConflictDoNothing({ target: [actionProposals.projectId, actionProposals.seedKey] })
      .returning({ id: actionProposals.id });
    if (inserted.length > 0) created++;
  }
  return created;
}

/** Pending Autopilot proposals for one project, highest friction first. */
export async function gatherActionProposals(projectId: string): Promise<ActionProposalView[]> {
  const rows = await db
    .select({
      id: actionProposals.id,
      seedKey: actionProposals.seedKey,
      evidence: actionProposals.evidence,
      draft: actionProposals.draft,
    })
    .from(actionProposals)
    .where(and(eq(actionProposals.projectId, projectId), eq(actionProposals.status, "pending")))
    .orderBy(desc(sql`(${actionProposals.evidence}->>'score')::int`))
    .limit(20);
  return rows.map((r) => ({
    id: r.id,
    seedKey: r.seedKey,
    evidence: r.evidence as ActionProposalEvidence,
    draft: r.draft as ActionProposalDraft,
  }));
}
