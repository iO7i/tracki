"use server";

import { db, isUniqueViolation } from "@/db";
import { invitations, memberships, organizations } from "@/db/schema";
import type { ActionState } from "@/lib/action-state";
import { getCurrentUser } from "@/lib/auth";
import { requireMembership } from "@/lib/tenancy";
import {
  INVITATION_LIFETIME_MS,
  MANAGER_ROLES,
  createOrgSchema,
  inviteSchema,
  randomToken,
  slugify,
} from "@tracki/shared";
import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

function localeFrom(formData: FormData): string {
  return formData.get("locale") === "en" ? "en" : "ar";
}

export async function createOrgAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const locale = localeFrom(formData);
  const user = await getCurrentUser();
  if (!user) redirect(`/${locale}/login`);

  const parsed = createOrgSchema.safeParse({ name: formData.get("name") });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "errors.generic" };
  }

  // Audit M1: org + owner membership are atomic (one transaction); only slug
  // unique-violations are retried — real DB failures propagate.
  let slug = slugify(parsed.data.name);
  let createdSlug: string | null = null;
  for (let attempt = 0; attempt < 3 && !createdSlug; attempt++) {
    try {
      createdSlug = await db.transaction(async (tx) => {
        const inserted = await tx
          .insert(organizations)
          .values({ name: parsed.data.name, slug })
          .returning({ id: organizations.id, slug: organizations.slug });
        // biome-ignore lint/style/noNonNullAssertion: insert returns exactly one row
        const org = inserted[0]!;
        await tx.insert(memberships).values({ orgId: org.id, userId: user.id, role: "owner" });
        return org.slug;
      });
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      slug = `${slugify(parsed.data.name)}-${randomToken(4).toLowerCase()}`;
    }
  }
  if (!createdSlug) return { error: "errors.generic" };
  redirect(`/${locale}/orgs/${createdSlug}`);
}

export async function inviteAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const locale = localeFrom(formData);
  const orgSlug = String(formData.get("orgSlug") ?? "");
  const ctx = await requireMembership(locale, orgSlug, MANAGER_ROLES);

  const parsed = inviteSchema.safeParse({
    email: formData.get("email"),
    role: formData.get("role"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "errors.generic" };
  }

  await db.insert(invitations).values({
    orgId: ctx.org.id,
    email: parsed.data.email,
    role: parsed.data.role,
    token: randomToken(32),
    invitedById: ctx.user.id,
    expiresAt: new Date(Date.now() + INVITATION_LIFETIME_MS),
  });

  revalidatePath(`/${locale}/orgs/${orgSlug}/settings`);
  return undefined;
}

export async function acceptInviteAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const locale = localeFrom(formData);
  const token = String(formData.get("token") ?? "");
  const user = await getCurrentUser();
  if (!user) redirect(`/${locale}/login?next=/${locale}/invite/${token}`);

  const rows = await db
    .select({
      id: invitations.id,
      orgId: invitations.orgId,
      email: invitations.email,
      role: invitations.role,
      expiresAt: invitations.expiresAt,
      orgSlug: organizations.slug,
    })
    .from(invitations)
    .innerJoin(organizations, eq(invitations.orgId, organizations.id))
    .where(and(eq(invitations.token, token), isNull(invitations.acceptedAt)))
    .limit(1);

  const invite = rows[0];
  if (!invite) return { error: "errors.inviteInvalid" };
  if (invite.expiresAt.getTime() <= Date.now()) return { error: "errors.inviteExpired" };
  if (invite.email !== user.email) return { error: "errors.inviteWrongEmail" };

  const existing = await db
    .select({ id: memberships.id })
    .from(memberships)
    .where(and(eq(memberships.orgId, invite.orgId), eq(memberships.userId, user.id)))
    .limit(1);

  if (existing.length === 0) {
    await db.insert(memberships).values({
      orgId: invite.orgId,
      userId: user.id,
      role: invite.role,
    });
  }
  await db.update(invitations).set({ acceptedAt: new Date() }).where(eq(invitations.id, invite.id));

  redirect(`/${locale}/orgs/${invite.orgSlug}`);
}
