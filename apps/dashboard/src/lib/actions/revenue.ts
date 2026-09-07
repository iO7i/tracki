"use server";

import { db } from "@/db";
import { projects } from "@/db/schema";
import { requireMembership, requireProject } from "@/lib/tenancy";
import { MANAGER_ROLES, revenueSettingsSchema } from "@tracki/shared";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

function localeFrom(formData: FormData): string {
  return formData.get("locale") === "en" ? "en" : "ar";
}

/** MANAGER: set the project's currency, average order value, and conversion event. */
export async function updateRevenueSettingsAction(formData: FormData): Promise<void> {
  const locale = localeFrom(formData);
  const orgSlug = String(formData.get("orgSlug") ?? "");
  const projectSlug = String(formData.get("projectSlug") ?? "");
  await requireMembership(locale, orgSlug, MANAGER_ROLES);
  const ctx = await requireProject(locale, orgSlug, projectSlug);

  const parsed = revenueSettingsSchema.safeParse({
    currency: formData.get("currency"),
    avgOrderValue: formData.get("avgOrderValue"),
    conversionEvent: formData.get("conversionEvent"),
  });
  if (!parsed.success) return; // invalid input — leave settings unchanged

  await db
    .update(projects)
    .set({
      currency: parsed.data.currency,
      avgOrderValue: parsed.data.avgOrderValue,
      conversionEvent: parsed.data.conversionEvent,
    })
    .where(and(eq(projects.id, ctx.project.id), eq(projects.orgId, ctx.org.id)));

  revalidatePath(`/${locale}/orgs/${orgSlug}/revenue`);
}
