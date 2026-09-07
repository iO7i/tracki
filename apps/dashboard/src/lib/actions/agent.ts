"use server";

import { db } from "@/db";
import { conversations } from "@/db/schema";
import { requireMembership, requireProject } from "@/lib/tenancy";
import { CHAT_RESOLUTIONS, type ChatResolution, MANAGER_ROLES } from "@tracki/shared";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function setResolutionAction(formData: FormData): Promise<void> {
  const locale = formData.get("locale") === "en" ? "en" : "ar";
  const orgSlug = String(formData.get("orgSlug") ?? "");
  const projectSlug = String(formData.get("projectSlug") ?? "");
  const conversationId = String(formData.get("conversationId") ?? "");
  const status = String(formData.get("status") ?? "");
  await requireMembership(locale, orgSlug, MANAGER_ROLES);
  const ctx = await requireProject(locale, orgSlug, projectSlug);

  if (UUID_RE.test(conversationId) && CHAT_RESOLUTIONS.includes(status as ChatResolution)) {
    // Scoped to the resolved project — no cross-tenant writes.
    await db
      .update(conversations)
      .set({ status })
      .where(
        and(eq(conversations.id, conversationId), eq(conversations.projectId, ctx.project.id)),
      );
  }
  revalidatePath(`/${locale}/orgs/${orgSlug}/agent`);
}
