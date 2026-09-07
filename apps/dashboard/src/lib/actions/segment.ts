"use server";

import { db } from "@/db";
import { segments } from "@/db/schema";
import type { ActionState } from "@/lib/action-state";
import { clickhouse } from "@/lib/analytics";
import { allowRate } from "@/lib/redis";
import { requireMembership, requireProject } from "@/lib/tenancy";
import { segmentVisitorIds } from "@tracki/clickhouse";
import { MANAGER_ROLES, createSegmentSchema, segmentDefinitionSchema } from "@tracki/shared";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

function localeFrom(formData: FormData): string {
  return formData.get("locale") === "en" ? "en" : "ar";
}

/**
 * Live preview: count distinct visitors matching a candidate definition.
 * Audit M2: gated to MANAGER_ROLES (only managers build segments) + a per-user
 * rate limit, since this is a directly-callable server action that runs several
 * 30-day ClickHouse scans.
 */
export async function previewSegmentAction(
  locale: string,
  orgSlug: string,
  projectSlug: string,
  rawDefinition: unknown,
): Promise<{ count: number } | { error: string }> {
  await requireMembership(locale, orgSlug, MANAGER_ROLES);
  const ctx = await requireProject(locale, orgSlug, projectSlug);
  if (!(await allowRate(`segpreview:${ctx.user.id}`, 20, 10))) {
    return { error: "errors.generic" };
  }
  const parsed = segmentDefinitionSchema.safeParse(rawDefinition);
  if (!parsed.success) return { error: "errors.generic" };
  try {
    const ids = await segmentVisitorIds(clickhouse(), ctx.org.id, ctx.project.id, parsed.data);
    return { count: ids.size };
  } catch {
    return { error: "errors.generic" };
  }
}

export async function createSegmentAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const locale = localeFrom(formData);
  const orgSlug = String(formData.get("orgSlug") ?? "");
  const projectSlug = String(formData.get("projectSlug") ?? "");
  await requireMembership(locale, orgSlug, MANAGER_ROLES);
  const ctx = await requireProject(locale, orgSlug, projectSlug);

  let definition: unknown;
  try {
    definition = JSON.parse(String(formData.get("definition") ?? ""));
  } catch {
    return { error: "errors.generic" };
  }

  const parsed = createSegmentSchema.safeParse({
    name: formData.get("name"),
    definition,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "errors.generic" };
  }

  await db.insert(segments).values({
    projectId: ctx.project.id,
    name: parsed.data.name,
    definition: parsed.data.definition,
  });

  revalidatePath(`/${locale}/orgs/${orgSlug}/segments`);
  return undefined;
}

export async function deleteSegmentAction(formData: FormData): Promise<void> {
  const locale = localeFrom(formData);
  const orgSlug = String(formData.get("orgSlug") ?? "");
  const projectSlug = String(formData.get("projectSlug") ?? "");
  const segmentId = String(formData.get("segmentId") ?? "");
  await requireMembership(locale, orgSlug, MANAGER_ROLES);
  const ctx = await requireProject(locale, orgSlug, projectSlug);

  // Audit N2: a malformed (non-UUID) segmentId must be a clean no-op, not an
  // unhandled Postgres type error.
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (UUID_RE.test(segmentId)) {
    // Scope the delete to the resolved project — no cross-tenant deletes.
    await db
      .delete(segments)
      .where(and(eq(segments.id, segmentId), eq(segments.projectId, ctx.project.id)));
  }

  revalidatePath(`/${locale}/orgs/${orgSlug}/segments`);
}
