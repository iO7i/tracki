"use server";

import { db, isUniqueViolation } from "@/db";
import { projects } from "@/db/schema";
import type { ActionState } from "@/lib/action-state";
import { requireMembership } from "@/lib/tenancy";
import {
  MANAGER_ROLES,
  createProjectSchema,
  generatePublicKey,
  randomToken,
  slugify,
} from "@tracki/shared";
import { redirect } from "next/navigation";

function localeFrom(formData: FormData): string {
  return formData.get("locale") === "en" ? "en" : "ar";
}

export async function createProjectAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const locale = localeFrom(formData);
  const orgSlug = String(formData.get("orgSlug") ?? "");
  const ctx = await requireMembership(locale, orgSlug, MANAGER_ROLES);

  const parsed = createProjectSchema.safeParse({
    name: formData.get("name"),
    siteUrl: formData.get("siteUrl") ?? "",
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "errors.generic" };
  }

  // Audit M1: only per-org slug unique-violations are retried — real DB
  // failures propagate.
  let slug = slugify(parsed.data.name);
  let createdSlug: string | null = null;
  for (let attempt = 0; attempt < 3 && !createdSlug; attempt++) {
    try {
      const inserted = await db
        .insert(projects)
        .values({
          orgId: ctx.org.id,
          name: parsed.data.name,
          slug,
          publicKey: generatePublicKey(),
          siteUrl: parsed.data.siteUrl,
        })
        .returning({ slug: projects.slug });
      // biome-ignore lint/style/noNonNullAssertion: insert returns exactly one row
      createdSlug = inserted[0]!.slug;
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      slug = `${slugify(parsed.data.name)}-${randomToken(4).toLowerCase()}`;
    }
  }
  if (!createdSlug) return { error: "errors.generic" };
  redirect(`/${locale}/orgs/${orgSlug}/projects/${createdSlug}`);
}
