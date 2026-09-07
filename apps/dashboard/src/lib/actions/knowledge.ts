"use server";

import { db } from "@/db";
import { faqArticles, faqProposals } from "@/db/schema";
import { generateProposals } from "@/lib/knowledge";
import { requireMembership, requireProject } from "@/lib/tenancy";
import { type ArticleDraft, isReviewStubBody } from "@tracki/ai";
import { MANAGER_ROLES, normalizeText, randomToken, slugify } from "@tracki/shared";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function localeFrom(formData: FormData): string {
  return formData.get("locale") === "en" ? "en" : "ar";
}

/** MANAGER: draft pending FAQ proposals from recurring VoC gaps (seen ≥3×). */
export async function generateProposalsAction(formData: FormData): Promise<void> {
  const locale = localeFrom(formData);
  const orgSlug = String(formData.get("orgSlug") ?? "");
  const projectSlug = String(formData.get("projectSlug") ?? "");
  await requireMembership(locale, orgSlug, MANAGER_ROLES);
  const ctx = await requireProject(locale, orgSlug, projectSlug);
  await generateProposals(ctx.org.id, ctx.project.id, 3);
  revalidatePath(`/${locale}/orgs/${orgSlug}/knowledge`);
}

/**
 * MANAGER: approve a proposal — create a published FAQ article from the
 * (possibly edited) draft, then mark the proposal approved and link the article.
 * Tenancy: the proposal must belong to the resolved project.
 */
export async function approveProposalAction(formData: FormData): Promise<void> {
  const locale = localeFrom(formData);
  const orgSlug = String(formData.get("orgSlug") ?? "");
  const projectSlug = String(formData.get("projectSlug") ?? "");
  const proposalId = String(formData.get("proposalId") ?? "");
  await requireMembership(locale, orgSlug, MANAGER_ROLES);
  const ctx = await requireProject(locale, orgSlug, projectSlug);
  if (!UUID_RE.test(proposalId)) return;

  const rows = await db
    .select({ id: faqProposals.id, status: faqProposals.status })
    .from(faqProposals)
    .where(and(eq(faqProposals.id, proposalId), eq(faqProposals.projectId, ctx.project.id)))
    .limit(1);
  if (!rows[0] || rows[0].status !== "pending") return; // already handled / cross-tenant

  // Edited draft from the review form (falls back to nothing → validated below).
  const draft: ArticleDraft = {
    titleAr: String(formData.get("titleAr") ?? "").slice(0, 300),
    bodyAr: String(formData.get("bodyAr") ?? "").slice(0, 5000),
    titleEn: String(formData.get("titleEn") ?? "").slice(0, 300),
    bodyEn: String(formData.get("bodyEn") ?? "").slice(0, 5000),
  };
  const title = draft.titleEn || draft.titleAr;
  if (!title.trim()) return; // nothing to publish
  // Audit 09 M1: never publish an un-completed review stub. A human must write a
  // real answer in at least one language; otherwise the Agent would later serve
  // the "pending review" placeholder back as a confidently-cited answer. The
  // proposal stays pending so it remains in the queue.
  if (isReviewStubBody(draft.bodyAr) && isReviewStubBody(draft.bodyEn)) return;

  const searchText = normalizeText(
    [draft.titleAr, draft.bodyAr, draft.titleEn, draft.bodyEn].join(" "),
  );
  const inserted = await db
    .insert(faqArticles)
    .values({
      projectId: ctx.project.id,
      slug: `${slugify(title)}-${randomToken(6).toLowerCase()}`,
      status: "published",
      titleAr: draft.titleAr,
      bodyAr: draft.bodyAr,
      titleEn: draft.titleEn,
      bodyEn: draft.bodyEn,
      searchText,
    })
    .returning({ id: faqArticles.id });

  await db
    .update(faqProposals)
    .set({ status: "approved", articleId: inserted[0]?.id ?? null, updatedAt: new Date() })
    .where(and(eq(faqProposals.id, proposalId), eq(faqProposals.projectId, ctx.project.id)));

  revalidatePath(`/${locale}/orgs/${orgSlug}/knowledge`);
  revalidatePath(`/${locale}/orgs/${orgSlug}/faq`);
}

/** MANAGER: reject a proposal (kept for audit, removed from the queue). */
export async function rejectProposalAction(formData: FormData): Promise<void> {
  const locale = localeFrom(formData);
  const orgSlug = String(formData.get("orgSlug") ?? "");
  const projectSlug = String(formData.get("projectSlug") ?? "");
  const proposalId = String(formData.get("proposalId") ?? "");
  await requireMembership(locale, orgSlug, MANAGER_ROLES);
  const ctx = await requireProject(locale, orgSlug, projectSlug);
  if (!UUID_RE.test(proposalId)) return;
  await db
    .update(faqProposals)
    .set({ status: "rejected", updatedAt: new Date() })
    .where(and(eq(faqProposals.id, proposalId), eq(faqProposals.projectId, ctx.project.id)));
  revalidatePath(`/${locale}/orgs/${orgSlug}/knowledge`);
}
