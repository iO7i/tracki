"use server";

import { db } from "@/db";
import { actions } from "@/db/schema";
import type { ActionState } from "@/lib/action-state";
import { clearManifestCache } from "@/lib/redis";
import { requireMembership, requireProject } from "@/lib/tenancy";
import { MANAGER_ROLES, createActionSchema } from "@tracki/shared";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function localeFrom(formData: FormData): string {
  return formData.get("locale") === "en" ? "en" : "ar";
}

export async function createActionAction(
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

  const parsed = createActionSchema.safeParse({
    name: formData.get("name"),
    status: formData.get("status"),
    definition,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "errors.generic" };
  }

  await db.insert(actions).values({
    projectId: ctx.project.id,
    name: parsed.data.name,
    type: parsed.data.definition.type,
    status: parsed.data.status,
    definition: parsed.data.definition,
  });

  if (parsed.data.status === "live") await clearManifestCache(ctx.project.id);
  revalidatePath(`/${locale}/orgs/${orgSlug}/actions`);
  return undefined;
}

/**
 * implementation — edit-in-place: update an existing action's name/status/definition.
 * Same validation as create; manifest cache always cleared (the action may be
 * live, or transitioning either way).
 */
export async function updateActionAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const locale = localeFrom(formData);
  const orgSlug = String(formData.get("orgSlug") ?? "");
  const projectSlug = String(formData.get("projectSlug") ?? "");
  const actionId = String(formData.get("actionId") ?? "");
  await requireMembership(locale, orgSlug, MANAGER_ROLES);
  const ctx = await requireProject(locale, orgSlug, projectSlug);
  if (!UUID_RE.test(actionId)) return { error: "errors.generic" };

  let definition: unknown;
  try {
    definition = JSON.parse(String(formData.get("definition") ?? ""));
  } catch {
    return { error: "errors.generic" };
  }

  const parsed = createActionSchema.safeParse({
    name: formData.get("name"),
    status: formData.get("status"),
    definition,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "errors.generic" };
  }

  await db
    .update(actions)
    .set({
      name: parsed.data.name,
      type: parsed.data.definition.type,
      status: parsed.data.status,
      definition: parsed.data.definition,
    })
    .where(and(eq(actions.id, actionId), eq(actions.projectId, ctx.project.id)));

  await clearManifestCache(ctx.project.id);
  revalidatePath(`/${locale}/orgs/${orgSlug}/actions`);
  return undefined;
}

export async function toggleActionAction(formData: FormData): Promise<void> {
  const locale = localeFrom(formData);
  const orgSlug = String(formData.get("orgSlug") ?? "");
  const projectSlug = String(formData.get("projectSlug") ?? "");
  const actionId = String(formData.get("actionId") ?? "");
  const next = formData.get("next") === "live" ? "live" : "draft";
  await requireMembership(locale, orgSlug, MANAGER_ROLES);
  const ctx = await requireProject(locale, orgSlug, projectSlug);

  if (UUID_RE.test(actionId)) {
    await db
      .update(actions)
      .set({ status: next })
      .where(and(eq(actions.id, actionId), eq(actions.projectId, ctx.project.id)));
    await clearManifestCache(ctx.project.id);
  }
  revalidatePath(`/${locale}/orgs/${orgSlug}/actions`);
}

export async function deleteActionAction(formData: FormData): Promise<void> {
  const locale = localeFrom(formData);
  const orgSlug = String(formData.get("orgSlug") ?? "");
  const projectSlug = String(formData.get("projectSlug") ?? "");
  const actionId = String(formData.get("actionId") ?? "");
  await requireMembership(locale, orgSlug, MANAGER_ROLES);
  const ctx = await requireProject(locale, orgSlug, projectSlug);

  if (UUID_RE.test(actionId)) {
    await db
      .delete(actions)
      .where(and(eq(actions.id, actionId), eq(actions.projectId, ctx.project.id)));
    await clearManifestCache(ctx.project.id);
  }
  revalidatePath(`/${locale}/orgs/${orgSlug}/actions`);
}
