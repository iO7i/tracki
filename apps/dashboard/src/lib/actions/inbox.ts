"use server";

import { db } from "@/db";
import { waConversations, waMessages } from "@/db/schema";
import { requireMembership, requireProject } from "@/lib/tenancy";
import { MANAGER_ROLES, maskPii } from "@tracki/shared";
import { getProvider } from "@tracki/whatsapp";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function localeFrom(formData: FormData): string {
  return formData.get("locale") === "en" ? "en" : "ar";
}

/** Load a conversation strictly within the resolved project (no cross-tenant). */
async function loadConvo(projectId: string, conversationId: string) {
  if (!UUID_RE.test(conversationId)) return null;
  const rows = await db
    .select({
      id: waConversations.id,
      waId: waConversations.waId,
      takeover: waConversations.takeover,
    })
    .from(waConversations)
    .where(and(eq(waConversations.id, conversationId), eq(waConversations.projectId, projectId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function sendWaReplyAction(formData: FormData): Promise<void> {
  const locale = localeFrom(formData);
  const orgSlug = String(formData.get("orgSlug") ?? "");
  const projectSlug = String(formData.get("projectSlug") ?? "");
  const conversationId = String(formData.get("conversationId") ?? "");
  const text = String(formData.get("text") ?? "")
    .trim()
    .slice(0, 2000);
  await requireMembership(locale, orgSlug, MANAGER_ROLES);
  const ctx = await requireProject(locale, orgSlug, projectSlug);
  const convo = await loadConvo(ctx.project.id, conversationId);
  if (!convo || !text) return;

  let status = "sent";
  try {
    await getProvider().sendText(convo.waId, text);
  } catch {
    status = "failed"; // Audit M2: surface non-delivery to the operator
  }
  await db.insert(waMessages).values({
    conversationId: convo.id,
    direction: "outbound",
    author: "operator",
    content: maskPii(text),
    status,
  });
  await db
    .update(waConversations)
    .set({ lastAt: new Date() })
    .where(eq(waConversations.id, convo.id));
  revalidatePath(`/${locale}/orgs/${orgSlug}/inbox`);
}

export async function toggleTakeoverAction(formData: FormData): Promise<void> {
  const locale = localeFrom(formData);
  const orgSlug = String(formData.get("orgSlug") ?? "");
  const projectSlug = String(formData.get("projectSlug") ?? "");
  const conversationId = String(formData.get("conversationId") ?? "");
  const next = formData.get("next") === "true" ? "true" : "false";
  await requireMembership(locale, orgSlug, MANAGER_ROLES);
  const ctx = await requireProject(locale, orgSlug, projectSlug);
  const convo = await loadConvo(ctx.project.id, conversationId);
  if (!convo) return;
  await db.update(waConversations).set({ takeover: next }).where(eq(waConversations.id, convo.id));
  revalidatePath(`/${locale}/orgs/${orgSlug}/inbox`);
}
