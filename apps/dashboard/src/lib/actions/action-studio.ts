"use server";

import { db } from "@/db";
import { actionProposals, actions } from "@/db/schema";
import { generateActionProposals } from "@/lib/action-studio";
import { requireMembership, requireProject } from "@/lib/tenancy";
import { MANAGER_ROLES, actionProposalDraftSchema } from "@tracki/shared";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function localeFrom(formData: FormData): string {
  return formData.get("locale") === "en" ? "en" : "ar";
}

/** MANAGER: run Autopilot — draft pending action proposals from the friction report. */
export async function generateActionProposalsAction(formData: FormData): Promise<void> {
  const locale = localeFrom(formData);
  const orgSlug = String(formData.get("orgSlug") ?? "");
  const projectSlug = String(formData.get("projectSlug") ?? "");
  await requireMembership(locale, orgSlug, MANAGER_ROLES);
  const ctx = await requireProject(locale, orgSlug, projectSlug);
  await generateActionProposals(ctx.org.id, ctx.project.id);
  revalidatePath(`/${locale}/orgs/${orgSlug}/actions`);
}

/**
 * MANAGER: approve a proposal — create the action as a **draft** (the only path
 * to `live` stays the manual toggle; never auto-live, slice-9 principle), then
 * mark the proposal approved and link the action. Tenancy: the proposal must
 * belong to the resolved project. The stored draft is re-validated against the
 * action schema before insert (defense vs stale/hand-edited jsonb).
 */
export async function approveActionProposalAction(formData: FormData): Promise<void> {
  const locale = localeFrom(formData);
  const orgSlug = String(formData.get("orgSlug") ?? "");
  const projectSlug = String(formData.get("projectSlug") ?? "");
  const proposalId = String(formData.get("proposalId") ?? "");
  await requireMembership(locale, orgSlug, MANAGER_ROLES);
  const ctx = await requireProject(locale, orgSlug, projectSlug);
  if (!UUID_RE.test(proposalId)) return;

  const rows = await db
    .select({
      id: actionProposals.id,
      status: actionProposals.status,
      draft: actionProposals.draft,
    })
    .from(actionProposals)
    .where(and(eq(actionProposals.id, proposalId), eq(actionProposals.projectId, ctx.project.id)))
    .limit(1);
  if (!rows[0] || rows[0].status !== "pending") return; // already handled / cross-tenant

  const parsed = actionProposalDraftSchema.safeParse(rows[0].draft);
  if (!parsed.success) return; // stale/invalid stored draft — stays pending

  const inserted = await db
    .insert(actions)
    .values({
      projectId: ctx.project.id,
      name: parsed.data.name,
      type: parsed.data.definition.type,
      status: "draft", // NEVER live from Autopilot
      definition: parsed.data.definition,
    })
    .returning({ id: actions.id });

  await db
    .update(actionProposals)
    .set({ status: "approved", actionId: inserted[0]?.id ?? null, updatedAt: new Date() })
    .where(and(eq(actionProposals.id, proposalId), eq(actionProposals.projectId, ctx.project.id)));

  revalidatePath(`/${locale}/orgs/${orgSlug}/actions`);
}

/** MANAGER: reject a proposal (kept for audit, removed from the queue). */
export async function rejectActionProposalAction(formData: FormData): Promise<void> {
  const locale = localeFrom(formData);
  const orgSlug = String(formData.get("orgSlug") ?? "");
  const projectSlug = String(formData.get("projectSlug") ?? "");
  const proposalId = String(formData.get("proposalId") ?? "");
  await requireMembership(locale, orgSlug, MANAGER_ROLES);
  const ctx = await requireProject(locale, orgSlug, projectSlug);
  if (!UUID_RE.test(proposalId)) return;
  await db
    .update(actionProposals)
    .set({ status: "rejected", updatedAt: new Date() })
    .where(and(eq(actionProposals.id, proposalId), eq(actionProposals.projectId, ctx.project.id)));
  revalidatePath(`/${locale}/orgs/${orgSlug}/actions`);
}
